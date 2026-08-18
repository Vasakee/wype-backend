import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import * as quais from 'quais';
import { WYPE_ESCROW_ABI } from './wype-escrow.abi';

export interface BlockchainReceipt {
  txHash: string;
}

export interface EscrowReceipt extends BlockchainReceipt {
  escrowId: string;
}

export interface GeneratedWallet {
  address: string;
  encryptedPrivateKey: string;
}

/** Cyprus-1 is Quai zone 0x00. Addresses outside it are rejected by the zone. */
const CYPRUS_1 = quais.Zone.Cyprus1;

/**
 * The on-chain layer (Quai Network, Cyprus-1).
 *
 * Talks to WypeEscrow.sol when the chain is configured, and falls back to the
 * original in-memory simulation when it is not, so tests and local development
 * run without an RPC endpoint or a funded key. `isLive()` reports which mode is
 * active.
 *
 * Configuration (all required for live mode):
 *   QUAI_RPC_URL                bare host, e.g. https://orchard.rpc.quai.network
 *   WYPE_ESCROW_ADDRESS         deployed WypeEscrow
 *   WYPE_TREASURY_PRIVATE_KEY   funded key that locks and settles escrows
 *   ESCROW_VERIFIER_PK          key that signs claim authorisations
 */
@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly registry = new Map<string, string>();

  private readonly rpcUrl: string;
  private readonly escrowAddress: string;
  private readonly treasuryKey: string;
  private readonly verifierKey: string;

  private provider?: quais.JsonRpcProvider;
  private treasury?: quais.Wallet;
  private verifier?: quais.Wallet;
  private escrow?: quais.Contract;

  constructor(configService: ConfigService) {
    // quais appends the zone path itself, so it wants the bare host. A trailing
    // /cyprus1 (correct for curl and forge) would be doubled up and rejected.
    this.rpcUrl = (configService.get<string>('QUAI_RPC_URL') ?? '')
      .replace(/\/+$/, '')
      .replace(/\/(cyprus|paxos|hydra)\d$/i, '');
    this.escrowAddress = configService.get<string>('WYPE_ESCROW_ADDRESS') ?? '';
    this.treasuryKey =
      configService.get<string>('WYPE_TREASURY_PRIVATE_KEY') ?? '';
    this.verifierKey = configService.get<string>('ESCROW_VERIFIER_PK') ?? '';
  }

  onModuleInit(): void {
    if (!this.isLive()) {
      this.logger.warn(
        'Quai is not fully configured — using the in-memory simulation. ' +
          'Set QUAI_RPC_URL, WYPE_ESCROW_ADDRESS, WYPE_TREASURY_PRIVATE_KEY and ' +
          'ESCROW_VERIFIER_PK to settle on-chain.',
      );
      return;
    }

    this.provider = new quais.JsonRpcProvider(this.rpcUrl, undefined, {
      usePathing: true,
    });
    this.treasury = new quais.Wallet(this.treasuryKey, this.provider);
    this.verifier = new quais.Wallet(this.verifierKey, this.provider);
    this.escrow = new quais.Contract(
      this.escrowAddress,
      WYPE_ESCROW_ABI,
      this.treasury,
    );

    this.logger.log(
      `Quai live: escrow=${this.escrowAddress} treasury=${this.treasury.address}`,
    );
  }

  /** True when every piece needed to settle on-chain is configured. */
  isLive(): boolean {
    return Boolean(
      this.rpcUrl && this.escrowAddress && this.treasuryKey && this.verifierKey,
    );
  }

  /** Stable hash of an email or phone number. Never used alone as an escrow key. */
  hashEmail(email: string): string {
    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
  }

  /**
   * The opaque handle an escrow is stored under on-chain.
   *
   * Keying on the identity hash alone would publish who is owed money — anyone
   * can hash an email address and read the balance back. Mixing in a per-transfer
   * random salt (the claim token) makes the key meaningless to an observer while
   * staying reproducible for whoever holds the claim link.
   */
  commitmentFor(escrowKey: string, salt: string): string {
    return quais.keccak256(
      quais.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32'],
        [`0x${this.hashEmail(escrowKey)}`, quais.id(salt)],
      ),
    );
  }

  registerAddress(email: string, address: string): void {
    this.registry.set(this.hashEmail(email), address);
  }

  resolveEmail(emailHash: string): string | null {
    return this.registry.get(emailHash) ?? null;
  }

  /** Seconds as the EVM sees them. See the README for why getBlock() is wrong. */
  async chainNow(): Promise<number> {
    if (!this.provider) return Math.floor(Date.now() / 1000);
    const block = (await this.provider.send(
      'eth_getBlockByNumber',
      ['latest', false],
      quais.Shard.Cyprus1,
    )) as { timestamp: string };
    return Number(BigInt(block.timestamp));
  }

  async directTransfer(
    toAddress: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    if (!this.treasury) {
      return { txHash: this.mockHash('direct', amount) };
    }

    const tx = await this.treasury.sendTransaction({
      from: this.treasury.address,
      to: toAddress,
      value: BigInt(amount),
    });
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Locks funds against `commitment` until `expiry`.
   * @param commitment from {@link commitmentFor}
   * @param amount in QUAI wei
   */
  async depositToEscrow(
    commitment: string,
    amount: string,
    expirySeconds?: number,
  ): Promise<EscrowReceipt> {
    if (!this.escrow) {
      return { txHash: this.mockHash('escrow', amount), escrowId: commitment };
    }

    const expiry = expirySeconds ?? (await this.chainNow()) + 7 * 24 * 60 * 60;
    const tx = await this.escrow.deposit(commitment, expiry, {
      value: BigInt(amount),
    });
    await tx.wait();
    return { txHash: tx.hash, escrowId: commitment };
  }

  /**
   * Releases an escrow to `toAddress`, authorised by the verifier key.
   *
   * The signature binds the payout to one recipient and a short deadline, so it
   * cannot be redirected or replayed once the backend has issued it.
   */
  async claimEscrow(
    commitment: string,
    toAddress?: string,
  ): Promise<BlockchainReceipt> {
    if (!this.escrow || !this.verifier || !this.treasury) {
      return { txHash: this.mockHash('claim', commitment.slice(0, 10)) };
    }

    // Defaults to Wype's treasury: the custodial ledger stays the record of who
    // owns what, and the user moves it out later via moveToSelfCustody. Paying
    // the user's own address here instead would double-count against it.
    const recipient = toAddress ?? this.treasury.address;

    const deadline = (await this.chainNow()) + 3600;
    // Ask the contract for the digest so the encoding cannot drift out of sync.
    const digest = (await this.escrow.claimDigest(
      commitment,
      recipient,
      deadline,
    )) as string;
    const signature = await this.verifier.signMessage(quais.getBytes(digest));

    const tx = await this.escrow.claim(
      commitment,
      recipient,
      deadline,
      signature,
    );
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Returns an escrow to its depositor. Uses `cancel` while the escrow is still
   * live (only the depositor may) and `refund` once it has expired (anyone may).
   */
  async reverseEscrow(
    commitment: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    if (!this.escrow) {
      return { txHash: this.mockHash('reverse', amount) };
    }

    const record = (await this.escrow.getEscrow(commitment)) as {
      expiry: bigint;
    };
    const expired = (await this.chainNow()) > Number(record.expiry);

    const tx = expired
      ? await this.escrow.refund(commitment)
      : await this.escrow.cancel(commitment);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /** Moves funds from Wype's custody to the user's own wallet. */
  async moveToSelfCustody(
    toAddress: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    return this.directTransfer(toAddress, amount);
  }

  /**
   * Generates a Quai keypair in Cyprus-1.
   *
   * A random key lands in a random zone and Cyprus-1 would reject it, so this
   * grinds until the address carries the right prefix — roughly one attempt in
   * twelve hundred, a few hundred milliseconds.
   */
  generateWallet(): GeneratedWallet {
    for (let attempts = 0; attempts < 5_000_000; attempts++) {
      const wallet = new quais.Wallet(quais.hexlify(quais.randomBytes(32)));
      const address = wallet.address;

      if (
        quais.getZoneForAddress(address) === CYPRUS_1 &&
        quais.isQuaiAddress(address)
      ) {
        return {
          address,
          // TODO: encrypt with the user's password before storing.
          encryptedPrivateKey: `mock:v1:${Buffer.from(
            wallet.privateKey,
          ).toString('base64')}`,
        };
      }
    }

    throw new Error('Could not generate a Cyprus-1 address');
  }

  private mockHash(kind: string, detail: string): string {
    return `0xmock-${kind}-${detail}-${randomBytes(8).toString('hex')}`;
  }
}
