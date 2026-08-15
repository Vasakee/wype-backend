import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class EscrowService {
  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
  ) {}

  /**
   * Claim escrowed funds addressed to the calling user's email or phone number.
   * Expired escrows are reversed first so nothing expired is ever claimed.
   */
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
      .exec();

    if (escrows.length === 0) {
      throw new NotFoundException('No escrowed funds found for your account');
    }

    const claimed: string[] = [];
    for (const escrow of escrows) {
      const escrowKey = escrow.recipientEmail ?? escrow.recipientWhatsapp;
      if (!escrowKey) continue;

      const receipt = await this.blockchainService.claimEscrow(
        this.blockchainService.hashEmail(escrowKey),
      );

      await this.walletService.credit(userId, escrow.amount);

      await this.transferModel.create({
        sender: escrow.sender,
        recipient: user._id,
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

      escrow.recipient = user._id;
      escrow.status = TransferStatus.Completed;
      escrow.claimedAt = new Date();
      await escrow.save();

      claimed.push(escrow._id.toString());
    }

    return { claimed: claimed.length, transfers: claimed };
  }

  /**
   * Job: find every escrowed transfer past its 7-day expiry, release the funds
   * back to the original sender and mark both records as reversed.
   */
  async reverseExpiredEscrows(): Promise<number> {
    const now = new Date();
    const expired = await this.transferModel
      .find({
        status: TransferStatus.Escrowed,
        escrowExpiry: { $lt: now },
      })
      .exec();

    let reversed = 0;
    for (const escrow of expired) {
      const escrowKey = escrow.recipientEmail ?? escrow.recipientWhatsapp;
      if (!escrowKey) continue;

      const receipt = await this.blockchainService.reverseEscrow(
        this.blockchainService.hashEmail(escrowKey),
        escrow.amount,
      );

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

      escrow.status = TransferStatus.Reversed;
      await escrow.save();

      reversed += 1;
    }

    return reversed;
  }
}
