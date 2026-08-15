import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';

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

/**
 * Mock of the on-chain layer (Quai Network).
 *
 * Implements the same surface a real integration will expose once it talks
 * to the Registry.sol / Escrow.sol contracts via quais.js. Nothing here moves
 * real funds — it only simulates transaction hashes and an in-memory
 * email-hash → wallet-address registry.
 */
@Injectable()
export class BlockchainService {
  private readonly registry = new Map<string, string>();
  private readonly rpcUrl: string;

  constructor(configService: ConfigService) {
    this.rpcUrl = configService.get<string>('QUAI_RPC_URL') ?? '';
  }

  hashEmail(email: string): string {
    return createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
  }

  registerAddress(email: string, address: string): void {
    this.registry.set(this.hashEmail(email), address);
  }

  resolveEmail(emailHash: string): string | null {
    return this.registry.get(emailHash) ?? null;
  }

  async directTransfer(
    toAddress: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    this.ensureConfigured();
    await this.simulateLatency();
    return {
      txHash: `0xmock-direct-${amount}-${toAddress.slice(-4)}-${this.randomId()}`,
    };
  }

  async depositToEscrow(
    emailHash: string,
    amount: string,
  ): Promise<EscrowReceipt> {
    this.ensureConfigured();
    await this.simulateLatency();
    return {
      txHash: `0xmock-escrow-${amount}-${this.randomId()}`,
      escrowId: emailHash,
    };
  }

  async claimEscrow(emailHash: string): Promise<BlockchainReceipt> {
    this.ensureConfigured();
    await this.simulateLatency();
    return {
      txHash: `0xmock-claim-${emailHash.slice(0, 8)}-${this.randomId()}`,
    };
  }

  async reverseEscrow(
    emailHash: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    this.ensureConfigured();
    await this.simulateLatency();
    return {
      txHash: `0xmock-reverse-${amount}-${this.randomId()}`,
    };
  }

  /**
   * Mock of moving funds from Wype's custodial address to the user's own
   * self-custody wallet. A real integration will send the balance on-chain so
   * the user can manage it in a non-custodial wallet like Blip Pay.
   */
  async moveToSelfCustody(
    toAddress: string,
    amount: string,
  ): Promise<BlockchainReceipt> {
    this.ensureConfigured();
    await this.simulateLatency();
    return {
      txHash: `0xmock-selfcustody-${amount}-${toAddress.slice(-4)}-${this.randomId()}`,
    };
  }

  /**
   * Mock of key generation + client-side encryption. A real integration will
   * generate a Quai keypair (quais.js), encrypt the private key with the user's
   * password, and store the ciphertext.
   */
  generateWallet(): GeneratedWallet {
    const address = `0x${randomBytes(20).toString('hex')}`;
    const privateKey = `0x${randomBytes(32).toString('hex')}`;
    const encryptedPrivateKey = `mock:v1:${Buffer.from(privateKey).toString(
      'base64',
    )}`;
    return { address, encryptedPrivateKey };
  }

  private async simulateLatency(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  private ensureConfigured(): void {
    if (!this.rpcUrl) {
      throw new Error(
        'QUAI_RPC_URL is not configured. Set it before performing blockchain operations.',
      );
    }
  }

  private randomId(): string {
    return randomBytes(8).toString('hex');
  }
}
