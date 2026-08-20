import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BlockchainService } from '../blockchain/blockchain.service';
import {
  Transfer,
  TransferDocument,
  TransferStatus,
  TransferType,
} from '../transfer/schemas/transfer.schema';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';

export const ESCROW_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const REVERSE_BATCH_SIZE = 5;

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
  ) {}

  async claim(
    userId: string,
    pin: string,
  ): Promise<{ claimed: number; transfers: string[] }> {
    const user = await this.usersService.verifyTransactionPin(userId, pin);

    await this.reverseExpiredEscrows();

    const identities: Array<Record<string, string>> = [];
    if (user.email) identities.push({ recipientEmail: user.email });
    if (user.phoneNumber) {
      identities.push({ recipientWhatsapp: user.phoneNumber });
    }

    const escrows = await this.transferModel
      .find({
        status: TransferStatus.Escrowed,
        escrowExpiry: { $gt: new Date() },
        $or: identities,
      })
      .lean()
      .exec();

    if (escrows.length === 0) {
      throw new NotFoundException('No escrowed funds found for your account');
    }

    if (!user.walletAddress) {
      throw new NotFoundException(
        'No wallet found. Link a Quai wallet before claiming.',
      );
    }

    const walletAddress = user.walletAddress;
    const results = await Promise.allSettled(
      escrows.map((escrow) =>
        this.claimOne(escrow, userId, walletAddress),
      ),
    );

    const claimed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        claimed.push(escrows[i]._id.toString());
      } else {
        this.logger.error(
          `Failed to claim escrow ${escrows[i]._id}: ${(results[i] as PromiseRejectedResult).reason}`,
        );
      }
    }

    return { claimed: claimed.length, transfers: claimed };
  }

  async claimByToken(
    userId: string,
    claimToken: string,
  ): Promise<string | undefined> {
    const user = await this.usersService.findById(userId);
    if (!user?.isEmailVerified) {
      throw new NotFoundException('Account not found');
    }

    const escrow = await this.transferModel
      .findOne({
        status: TransferStatus.Escrowed,
        claimToken,
        escrowExpiry: { $gt: new Date() },
      })
      .lean()
      .exec();

    if (!escrow) return undefined;

    const keyMatches =
      (escrow.recipientEmail &&
        escrow.recipientEmail.toLowerCase() === user.email?.toLowerCase()) ||
      (escrow.recipientWhatsapp &&
        escrow.recipientWhatsapp === user.phoneNumber);
    if (!keyMatches) return undefined;

    if (!user.walletAddress) {
      throw new NotFoundException(
        'No wallet found. Link a Quai wallet before claiming.',
      );
    }

    if (!escrow.escrowId) return '0';

    const receipt = await this.blockchainService.claimEscrow(
      escrow.escrowId,
      user.walletAddress,
    );

    await this.walletService.credit(userId, escrow.amount);

    await this.transferModel.create({
      sender: escrow.sender,
      recipient: userId,
      recipientEmail: escrow.recipientEmail,
      recipientWhatsapp: escrow.recipientWhatsapp,
      amount: escrow.amount,
      currency: escrow.currency,
      channel: escrow.channel,
      type: TransferType.Claim,
      status: TransferStatus.Completed,
      escrowExpiry: escrow.escrowExpiry,
      escrowId: escrow.escrowId,
      txHash: receipt.txHash,
    });

    await this.transferModel.updateOne(
      { _id: escrow._id },
      {
        $set: {
          recipient: userId,
          status: TransferStatus.Completed,
          claimedAt: new Date(),
        },
      },
    );

    return escrow.amount;
  }

  private async claimOne(
    escrow: TransferDocument,
    userId: string,
    walletAddress: string,
  ): Promise<string> {
    if (!escrow.escrowId) return '0';

    const receipt = await this.blockchainService.claimEscrow(
      escrow.escrowId,
      walletAddress,
    );

    await this.walletService.credit(userId, escrow.amount);

    await this.transferModel.create({
      sender: escrow.sender,
      recipient: userId,
      recipientEmail: escrow.recipientEmail,
      recipientWhatsapp: escrow.recipientWhatsapp,
      amount: escrow.amount,
      currency: escrow.currency,
      channel: escrow.channel,
      type: TransferType.Claim,
      status: TransferStatus.Completed,
      escrowExpiry: escrow.escrowExpiry,
      escrowId: escrow.escrowId,
      txHash: receipt.txHash,
    });

    await this.transferModel.updateOne(
      { _id: escrow._id },
      {
        $set: {
          recipient: userId,
          status: TransferStatus.Completed,
          claimedAt: new Date(),
        },
      },
    );

    return escrow.amount;
  }

  async reverseExpiredEscrows(): Promise<number> {
    const expired = await this.transferModel
      .find({
        status: TransferStatus.Escrowed,
        escrowExpiry: { $lt: new Date() },
      })
      .limit(50)
      .lean()
      .exec();

    if (expired.length === 0) return 0;

    let reversed = 0;
    for (let i = 0; i < expired.length; i += REVERSE_BATCH_SIZE) {
      const batch = expired.slice(i, i + REVERSE_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((escrow) => this.reverseOne(escrow)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') reversed++;
      }
    }

    return reversed;
  }

  private async reverseOne(escrow: TransferDocument): Promise<void> {
    if (!escrow.escrowId) return;

    const receipt = await this.blockchainService.refundEscrow(escrow.escrowId);

    await this.walletService.credit(escrow.sender.toString(), escrow.amount);

    await this.transferModel.create({
      sender: escrow.sender,
      recipientEmail: escrow.recipientEmail,
      recipientWhatsapp: escrow.recipientWhatsapp,
      amount: escrow.amount,
      currency: escrow.currency,
      channel: escrow.channel,
      type: TransferType.Reverse,
      status: TransferStatus.Reversed,
      escrowExpiry: escrow.escrowExpiry,
      escrowId: escrow.escrowId,
      txHash: receipt.txHash,
    });

    await this.transferModel.updateOne(
      { _id: escrow._id },
      { $set: { status: TransferStatus.Reversed } },
    );
  }
}
