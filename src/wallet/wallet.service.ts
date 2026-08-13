import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BlockchainService } from '../blockchain/blockchain.service';
import { UsersService } from '../users/users.service';
import { Wallet, WalletDocument } from './schemas/wallet.schema';

@Injectable()
export class WalletService {
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

    const user = await this.usersService.findById(userId);
    if (user?.email) {
      this.blockchainService.registerAddress(user.email, saved.address);
    }

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
}
