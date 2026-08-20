import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Transfer,
  TransferDocument,
  TransferStatus,
  TransferType,
} from '../transfer/schemas/transfer.schema';

const FEE_RATE = 0.005; // 0.5%
const FREE_TRANSACTIONS_PER_MONTH = 3;

@Injectable()
export class FeesService {
  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
  ) {}

  /** Fee in major units for display in the transfer confirmation. */
  async calculate(amount: string, userId?: string): Promise<string> {
    if (userId) {
      const count = await this.getMonthlyTransferCount(userId);
      if (count < FREE_TRANSACTIONS_PER_MONTH) {
        return '0';
      }
    }

    const fee = Number(amount) * FEE_RATE;
    return fee.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  private async getMonthlyTransferCount(userId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return this.transferModel.countDocuments({
      sender: userId,
      type: TransferType.Send,
      status: { $in: [TransferStatus.Completed, TransferStatus.Escrowed] },
      createdAt: { $gte: startOfMonth },
    }).exec();
  }
}
