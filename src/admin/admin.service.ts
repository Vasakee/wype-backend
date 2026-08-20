import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Transfer,
  TransferDocument,
  TransferStatus,
} from '../transfer/schemas/transfer.schema';
import {
  Movement,
  MovementDocument,
  MovementStatus,
} from '../movement/movement.schema';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Transfer.name) private transferModel: Model<TransferDocument>,
    @InjectModel(Movement.name) private movementModel: Model<MovementDocument>,
  ) {}

  async getDashboard() {
    const [
      totalUsers,
      verifiedUsers,
      usersWithWallet,
      usersWithUsername,
      totalTransfers,
      completedTransfers,
      escrowedTransfers,
      totalVolume,
      totalMovements,
      completedMovements,
      fundingVolume,
      recentTransfers,
      usersPerDay,
      transfersPerDay,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ isEmailVerified: true }),
      this.userModel.countDocuments({ walletAddress: { $exists: true, $ne: null } }),
      this.userModel.countDocuments({ username: { $exists: true, $ne: null } }),
      this.transferModel.countDocuments(),
      this.transferModel.countDocuments({ status: TransferStatus.Completed }),
      this.transferModel.countDocuments({ status: TransferStatus.Escrowed }),
      this.getVolume(),
      this.movementModel.countDocuments(),
      this.movementModel.countDocuments({ status: MovementStatus.Completed }),
      this.getFundingVolume(),
      this.getRecentTransfers(10),
      this.getUsersPerDay(30),
      this.getTransfersPerDay(30),
    ]);

    return {
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        withWallet: usersWithWallet,
        withUsername: usersWithUsername,
      },
      transfers: {
        total: totalTransfers,
        completed: completedTransfers,
        escrowed: escrowedTransfers,
        volume: totalVolume,
      },
      movements: {
        total: totalMovements,
        completed: completedMovements,
        fundingVolume,
      },
      recentTransfers,
      chart: {
        usersPerDay,
        transfersPerDay,
      },
    };
  }

  private async getVolume(): Promise<string> {
    const result = await this.transferModel.aggregate([
      { $match: { status: TransferStatus.Completed } },
      { $group: { _id: null, total: { $sum: { $toLong: '$amount' } } } },
    ]);
    return result[0]?.total?.toString() ?? '0';
  }

  private async getFundingVolume(): Promise<string> {
    const result = await this.movementModel.aggregate([
      {
        $match: {
          status: MovementStatus.Completed,
          type: 'funding',
          amountCents: { $exists: true },
        },
      },
      { $group: { _id: null, total: { $sum: '$amountCents' } } },
    ]);
    return result[0]?.total?.toString() ?? '0';
  }

  private async getRecentTransfers(limit: number) {
    return this.transferModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', 'email fullName')
      .populate('recipient', 'email fullName')
      .lean();
  }

  private async getUsersPerDay(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.userModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }

  private async getTransfersPerDay(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.transferModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          volume: { $sum: { $toLong: '$amount' } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }
}
