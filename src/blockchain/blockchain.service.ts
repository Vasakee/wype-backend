import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  quais,
  QuaiHDWallet,
  Mnemonic,
  Zone,
  Contract,
  Wallet,
} from 'quais';
import { WYPE_ESCROW_ABI } from './wype-escrow.abi';
import { WYPE_REGISTRY_ABI } from './wype-registry.abi';

// ---------------------------------------------------------------------------
// Types — every consumer depends on these shapes
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);

  private readonly provider: quais.JsonRpcProvider;
  private readonly hotWallet: QuaiHDWallet | null = null;
  private readonly hotWalletAddress: string = '';
  private readonly hasMnemonic: boolean;

  private readonly escrowAddress: string;
  private readonly escrowContract: Contract | null = null;
  private readonly registryAddress: string;
  private readonly registryContract: Contract | null = null;
  private readonly verifierWallet: Wallet | null = null;
  private readonly rpcUrl: string;

  constructor(configService: ConfigService) {
    const rpcUrl =
      configService.get<string>('QUAI_RPC_URL') ?? 'https://rpc.quai.network';
    const mnemonic = configService.get<string>('WYPE_TREASURY_PRIVATE_KEY');
    const verifierPk = configService.get<string>('ESCROW_VERIFIER_PK');

    this.escrowAddress =
      configService.get<string>('WYPE_ESCROW_ADDRESS') ?? '';
    this.registryAddress =
      configService.get<string>('WYPE_REGISTRY_ADDRESS') ?? '';

    // Provider — always initialised so reads work without keys
    this.rpcUrl = rpcUrl;
    this.provider = new quais.JsonRpcProvider(rpcUrl, undefined, {
      usePathing: true,
    });

    // Hot wallet (treasury key)
    if (mnemonic && mnemonic !== '0x...') {
      // Support both a raw private key and a mnemonic phrase
      if (mnemonic.includes(' ')) {
        const phrase = Mnemonic.fromPhrase(mnemonic);
        const hd = QuaiHDWallet.fromMnemonic(phrase);
        hd.connect(this.provider);
        this.hotWallet = hd;
      } else {
        // Raw private key — wrap in a Wallet that has sendTransaction
        const w = new Wallet(mnemonic, this.provider);
        // We store the address and use a thin shim; see getSigner()
        this.hotWalletAddress = w.address;
        this.hasMnemonic = true;
        // Assign to hotWallet via a signer-compatible wrapper
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).hotWallet = w;
      }
      if (!this.hotWalletAddress) {
        const addrInfo = (
          this.hotWallet as QuaiHDWallet
        ).getNextAddressSync(0, Zone.Cyprus1);
        this.hotWalletAddress = addrInfo.address;
      }
      this.hasMnemonic = true;
      this.logger.log(`Hot wallet loaded: ${this.hotWalletAddress}`);
    } else {
      this.hasMnemonic = false;
      this.logger.warn(
        'WYPE_TREASURY_PRIVATE_KEY is not set. On-chain writes will fail.',
      );
    }

    // Verifier wallet (signs claim authorisations)
    if (verifierPk && verifierPk !== '0x...') {
      this.verifierWallet = new Wallet(verifierPk, this.provider);
      this.logger.log(`Verifier loaded: ${this.verifierWallet.address}`);
    } else {
      this.logger.warn(
        'ESCROW_VERIFIER_PK is not set. Claim signing will fail.',
      );
    }

    // Escrow contract
    if (this.escrowAddress) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signer = this.getSigner() as any;
      this.escrowContract = new quais.Contract(
        this.escrowAddress,
        WYPE_ESCROW_ABI,
        signer,
      );
    }

    // Registry contract
    if (this.registryAddress) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signer = this.getSigner() as any;
      this.registryContract = new quais.Contract(
        this.registryAddress,
        WYPE_REGISTRY_ABI,
        signer,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Get a signer-compatible object for contract interactions. */
  private getSigner(): QuaiHDWallet | Wallet {
    return (this.hotWallet as QuaiHDWallet | Wallet) ?? null;
  }

  /** SHA-256 of a lowercased, trimmed email / phone identifier. */
  hashEmail(email: string): string {
    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
  }

  /**
   * Derive the on-chain commitment from an identity hash and a random salt.
   * Matches the contract's keccak256(abi.encodePacked(identityHash, salt)).
   */
  commitmentFor(identityHash: string, salt: string): string {
    // identityHash and salt are hex strings; pack them as raw bytes
    const identityBytes = quais.getBytes('0x' + identityHash);
    const saltBytes = quais.getBytes('0x' + salt);
    const packed = new Uint8Array(identityBytes.length + saltBytes.length);
    packed.set(identityBytes, 0);
    packed.set(saltBytes, identityBytes.length);
    return quais.keccak256(packed);
  }

  /**
   * Read the chain's current block timestamp via the raw RPC, NOT via
   * provider.getBlock() which returns a Quai work-object timestamp that
   * can be hours ahead of the EVM's block.timestamp.
   */
  async chainNow(): Promise<number> {
    const block = await this.provider.send(
      'eth_getBlockByNumber',
      ['latest', false],
      quais.Shard.Cyprus1,
    );
    const seconds = Number(BigInt(block.timestamp));
    if (!Number.isFinite(seconds)) {
      throw new Error(
        `Could not read a block timestamp (got ${block?.timestamp})`,
      );
    }
    return seconds;
  }

  private ensureConfigured(): void {
    if (!this.hasMnemonic) {
      throw new Error(
        'WYPE_TREASURY_PRIVATE_KEY is not configured. ' +
          'Generate a key with: node contracts/script/quai-keygen.mjs',
      );
    }
  }

  private ensureEscrow(): void {
    if (!this.escrowContract) {
      throw new Error(
        'WYPE_ESCROW_ADDRESS must be set. ' +
          'Deploy the contract first, then add the address to .env.',
      );
    }
  }

  private ensureVerifier(): void {
    if (!this.verifierWallet) {
      throw new Error(
        'ESCROW_VERIFIER_PK is not configured. ' +
          'Generate a verifier key with: node contracts/script/quai-keygen.mjs',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Direct transfer
  // -----------------------------------------------------------------------

  async directTransfer(
    toAddress: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    this.ensureConfigured();
    const signer = this.getSigner();
    const tx = await (
      signer as Wallet | QuaiHDWallet
    ).sendTransaction({
      from: this.hotWalletAddress,
      to: toAddress,
      value: BigInt(amount),
    });
    this.logger.log(`Direct transfer tx broadcast: ${tx.hash}`);
    // Don't block on confirmation — let the transfer service return immediately.
    tx.wait().catch((e) =>
      this.logger.error(`Direct transfer tx ${tx.hash} failed on-chain`, e),
    );
    return { txHash: tx.hash };
  }

  // -----------------------------------------------------------------------
  // Escrow — deposit
  // -----------------------------------------------------------------------

  async depositToEscrow(
    commitment: string,
    amount: string,
    expirySeconds: number,
  ): Promise<EscrowReceipt> {
    this.ensureEscrow();
    const tx = await this.escrowContract!.deposit(
      commitment,
      Math.floor(expirySeconds),
      { value: BigInt(amount) },
    );
    this.logger.log(`Escrow deposit tx broadcast: ${tx.hash}`);
    tx.wait().catch((e: unknown) =>
      this.logger.error(`Escrow deposit tx ${tx.hash} failed on-chain`, e),
    );
    return { txHash: tx.hash, escrowId: commitment };
  }

  // -----------------------------------------------------------------------
  // Escrow — claim (requires verifier signature)
  // -----------------------------------------------------------------------

  async claimEscrow(
    commitment: string,
    toAddress: string,
  ): Promise<BlockchainReceipt> {
    this.ensureEscrow();
    this.ensureVerifier();

    const deadline = (await this.chainNow()) + 3600; // 1-hour signature window
    const digest: string = await this.escrowContract!.claimDigest(
      commitment,
      toAddress,
      deadline,
    );
    const signature = await this.verifierWallet!.signMessage(
      quais.getBytes(digest),
    );

    const tx = await this.escrowContract!.claim(
      commitment,
      toAddress,
      deadline,
      signature,
    );
    this.logger.log(`Escrow claim tx: ${tx.hash}`);
    await tx.wait();
    return { txHash: tx.hash };
  }

  // -----------------------------------------------------------------------
  // Escrow — cancel (depositor only, pre-expiry)
  // -----------------------------------------------------------------------

  async cancelEscrow(commitment: string): Promise<BlockchainReceipt> {
    this.ensureEscrow();
    const tx = await this.escrowContract!.cancel(commitment);
    this.logger.log(`Escrow cancel tx: ${tx.hash}`);
    await tx.wait();
    return { txHash: tx.hash };
  }

  // -----------------------------------------------------------------------
  // Escrow — refund (permissionless, post-expiry)
  // -----------------------------------------------------------------------

  async refundEscrow(commitment: string): Promise<BlockchainReceipt> {
    this.ensureEscrow();
    const tx = await this.escrowContract!.refund(commitment);
    this.logger.log(`Escrow refund tx: ${tx.hash}`);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /**
   * Legacy alias used by escrow.service.ts (post-expiry) and
   * transfer.service.ts (pre-expiry cancel). Dispatches to the correct
   * on-chain function based on whether the escrow has expired.
   */
  async reverseEscrow(
    commitment: string,
    _amount: string,
  ): Promise<BlockchainReceipt> {
    this.ensureEscrow();

    // Try to read the on-chain state to decide cancel vs refund
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const escrow: any = await (this.escrowContract as any).getEscrow(
        commitment,
      );
      const expiry = Number(escrow.expiry);
      const now = await this.chainNow();

      if (now > expiry) {
        return this.refundEscrow(commitment);
      }
      return this.cancelEscrow(commitment);
    } catch {
      // If we can't read state, default to refund (post-expiry path)
      return this.refundEscrow(commitment);
    }
  }

  // -----------------------------------------------------------------------
  // Read-only helpers
  // -----------------------------------------------------------------------

  /** Read the on-chain QUAI balance (in wei) for an arbitrary address. */
  async getBalance(address: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [address, 'latest'],
          id: 1,
        }),
        signal: controller.signal,
      });
      const json = (await res.json()) as { result?: string; error?: { message: string } };
      if (json.error) {
        throw new Error(json.error.message);
      }
      return BigInt(json.result ?? '0x0').toString();
    } finally {
      clearTimeout(timer);
    }
  }

  // -----------------------------------------------------------------------
  // Self-custody
  // -----------------------------------------------------------------------

  async moveToSelfCustody(
    toAddress: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    return this.directTransfer(toAddress, amount);
  }

  // -----------------------------------------------------------------------
  // Name registry
  // -----------------------------------------------------------------------

  private ensureRegistry(): void {
    if (!this.registryContract) {
      throw new Error(
        'WYPE_REGISTRY_ADDRESS must be set. ' +
          'Deploy the registry first, then add the address to .env.',
      );
    }
  }

  /** Register a username on-chain. Only callable by the hot wallet (owner). */
  async registerName(
    name: string,
    walletAddress: string,
  ): Promise<BlockchainReceipt> {
    this.ensureConfigured();
    this.ensureRegistry();
    const tx = await this.registryContract!.register(name, walletAddress);
    this.logger.log(`Registry register tx: ${tx.hash}`);
    await tx.wait();
    return { txHash: tx.hash };
  }

  /** Resolve a username to a wallet address on-chain. */
  async resolveName(name: string): Promise<string> {
    this.ensureRegistry();
    const address: string = await this.registryContract!.resolve(name);
    return address;
  }

  /** Clear a username on-chain. */
  async clearName(name: string): Promise<BlockchainReceipt> {
    this.ensureConfigured();
    this.ensureRegistry();
    const tx = await this.registryContract!.clear(name);
    this.logger.log(`Registry clear tx: ${tx.hash}`);
    await tx.wait();
    return { txHash: tx.hash };
  }

  // -----------------------------------------------------------------------
  // Wallet generation (for new users)
  // -----------------------------------------------------------------------

  generateWallet(): GeneratedWallet {
    const entropy = randomBytes(32);
    const phrase = Mnemonic.fromEntropy(entropy);
    const wallet = QuaiHDWallet.fromMnemonic(phrase);
    const addrInfo = wallet.getNextAddressSync(0, Zone.Cyprus1);

    // Encrypt the mnemonic with a dedicated server-side key
    const serverSecret =
      process.env.WALLET_ENCRYPTION_KEY ??
      process.env.JWT_SECRET ??
      'dev-fallback-secret-do-not-use-in-prod';
    const key = createHash('sha256').update(serverSecret).digest();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(phrase.phrase, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const encryptedPrivateKey = `enc:v1:${iv.toString('hex')}:${encrypted}`;

    return {
      address: addrInfo.address,
      encryptedPrivateKey,
    };
  }
}
