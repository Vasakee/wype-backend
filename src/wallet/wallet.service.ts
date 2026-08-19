import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BlockchainService } from '../blockchain/blockchain.service';
import { UsersService } from '../users/users.service';
import { Wallet, WalletDocument } from './schemas/wallet.schema';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    private readonly usersService: UsersService,
    private readonly blockchainService: BlockchainService,
  ) {}

  findById(id: string): Promise<WalletDocument | null> {
    return this.walletModel.findById(id).exec();
  }

  findByUserId(userId: string): Promise<WalletDocument | null> {
    return this.walletModel.findOne({ userId }).exec();
  }

  findByAddress(address: string): Promise<WalletDocument | null> {
    return this.walletModel.findOne({ address }).exec();
  }

  async create(userId: string, address: string): Promise<WalletDocument> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      throw new ConflictException('A wallet already exists for this user');
    }

    const wallet = new this.walletModel({ userId, address });
    const saved = await wallet.save();

    await this.usersService.setWallet(userId, saved.address);

    return saved;
  }

  async credit(userId: string, amount: string): Promise<WalletDocument> {
    const wallet = await this.getByUserIdOrThrow(userId);
    wallet.balance = (BigInt(wallet.balance) + BigInt(amount)).toString();
    return wallet.save();
  }

  async debit(userId: string, amount: string): Promise<WalletDocument> {
    const wallet = await this.getByUserIdOrThrow(userId);
    const next = BigInt(wallet.balance) - BigInt(amount);
    if (next < 0n) {
      throw new ConflictException('Insufficient wallet balance');
    }
    wallet.balance = next.toString();
    return wallet.save();
  }

  private async getByUserIdOrThrow(userId: string): Promise<WalletDocument> {
    const wallet = await this.findByUserId(userId);
    if (!wallet) {
      throw new NotFoundException('No wallet found for this user');
    }
    return wallet;
  }

  /**
   * Read the on-chain balance of the user's custodial wallet and credit any
   * new deposits to the off-chain ledger.  Returns the newly credited amount
   * (in minor units) or "0" if nothing new was found.
   */
  async checkDeposit(userId: string): Promise<{ credited: string; newBalance: string }> {
    const wallet = await this.getByUserIdOrThrow(userId);

    const onChainWei = BigInt(await this.blockchainService.getBalance(wallet.address));
    const ledgerWei = BigInt(wallet.balance);

    // The on-chain address only receives deposits; withdrawals come from the
    // treasury hot wallet, so on-chain >= ledger always holds for deposits.
    const diff = onChainWei - ledgerWei;
    if (diff <= 0n) {
      return { credited: '0', newBalance: wallet.balance };
    }

    wallet.balance = onChainWei.toString();
    await wallet.save();

    this.logger.log(
      `Credited ${diff} wei deposit for ${wallet.address} (on-chain ${onChainWei}, was ledger ${ledgerWei})`,
    );

    return { credited: diff.toString(), newBalance: wallet.balance };
  }
}
