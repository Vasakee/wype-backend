import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BlockchainService } from '../blockchain/blockchain.service';
import { EmailService } from '../email/email.service';
import { EscrowService, ESCROW_DURATION_MS } from '../escrow/escrow.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import type { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateEmailTransferDto } from './dto/create-email-transfer.dto';
import { CreateWhatsappTransferDto } from './dto/create-whatsapp-transfer.dto';
import {
  Transfer,
  TransferChannel,
  TransferDocument,
  TransferStatus,
  TransferType,
} from './schemas/transfer.schema';
import { fromMinorUnits, toMinorUnits } from './units';

interface ExecuteTransferParams {
  userId: string;
  pin: string;
  amount: string;
  currency: string;
  channel: TransferChannel;
  recipientEmail?: string;
  recipientWhatsapp?: string;
  recipientUsername?: string;
}

@Injectable()
export class TransferService {
  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
    private readonly escrowService: EscrowService,
    private readonly emailService: EmailService,
    @Inject('WHATSAPP_SERVICE')
    private readonly whatsappService: WhatsappService,
  ) {}

  async sendByEmail(
    userId: string,
    dto: CreateEmailTransferDto,
  ): Promise<TransferDocument> {
    return this.executeTransfer({
      userId,
      pin: dto.pin,
      amount: dto.amount,
      currency: dto.currency ?? 'QUAI',
      channel: TransferChannel.Web,
      recipientEmail: dto.recipientEmail,
    });
  }

  async sendByWhatsapp(
    userId: string,
    dto: CreateWhatsappTransferDto,
  ): Promise<TransferDocument> {
    return this.executeTransfer({
      userId,
      pin: dto.pin,
      amount: dto.amount,
      currency: dto.currency ?? 'QUAI',
      channel: TransferChannel.Whatsapp,
      recipientWhatsapp: dto.recipientWhatsapp,
      recipientEmail: dto.recipientEmail,
      recipientUsername: dto.recipientUsername,
    });
  }

  getHistory(userId: string): Promise<TransferDocument[]> {
    return this.transferModel
      .find({ $or: [{ sender: userId }, { recipient: userId }] })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  claimEscrow(userId: string, pin: string) {
    return this.escrowService.claim(userId, pin);
  }

  private async executeTransfer(
    params: ExecuteTransferParams,
  ): Promise<TransferDocument> {
    await this.usersService.verifyTransactionPin(params.userId, params.pin);

    const amount = toMinorUnits(params.amount);
    if (BigInt(amount) <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    const senderWallet = await this.walletService.findByUserId(params.userId);
    if (!senderWallet) {
      throw new BadRequestException('Link a Quai wallet before sending money');
    }

    const recipient = params.recipientEmail
      ? await this.usersService.findByEmail(params.recipientEmail)
      : params.recipientUsername
        ? await this.usersService.findByUsername(params.recipientUsername)
        : params.recipientWhatsapp
          ? await this.usersService.findByPhoneNumber(params.recipientWhatsapp)
          : null;

    if (!recipient && params.recipientWhatsapp) {
      throw new BadRequestException(
        'Recipient WhatsApp number must be registered on Wype',
      );
    }
    if (!recipient && params.recipientUsername) {
      throw new BadRequestException(
        'Recipient username must be registered on Wype',
      );
    }
    if (!recipient && !params.recipientEmail) {
      throw new BadRequestException('Recipient is required');
    }

    if (recipient && recipient._id.toString() === params.userId) {
      throw new BadRequestException('You cannot send money to yourself');
    }

    const transfer = recipient
      ? await this.runDirectTransfer(params, recipient, amount)
      : await this.runEscrowTransfer(params, amount);

    if (transfer.status === TransferStatus.Escrowed) {
      void this.escrowService.reverseExpiredEscrows().catch(() => undefined);
    }

    await this.notifyRecipient(transfer, recipient);

    return transfer;
  }

  private async runDirectTransfer(
    params: ExecuteTransferParams,
    recipient: UserDocument,
    amount: string,
  ): Promise<TransferDocument> {
    const toAddress = (
      await this.walletService.findByUserId(recipient._id.toString())
    )?.address;
    if (!toAddress) {
      throw new BadRequestException('Recipient has not linked a wallet yet');
    }

    const receipt = await this.blockchainService.directTransfer(
      toAddress,
      amount,
    );

    await this.walletService.debit(params.userId, amount);
    await this.walletService.credit(recipient._id.toString(), amount);

    return this.transferModel.create({
      sender: new Types.ObjectId(params.userId),
      recipient: recipient._id,
      recipientEmail: params.recipientEmail,
      recipientWhatsapp: params.recipientWhatsapp,
      amount,
      currency: params.currency,
      channel: params.channel,
      type: TransferType.Send,
      status: TransferStatus.Completed,
      txHash: receipt.txHash,
      pinVerifiedAt: new Date(),
    });
  }

  private async runEscrowTransfer(
    params: ExecuteTransferParams,
    amount: string,
  ): Promise<TransferDocument> {
    const escrowKey = params.recipientEmail ?? params.recipientWhatsapp;
    if (!escrowKey) {
      throw new BadRequestException('Recipient is required');
    }

    const emailHash = this.blockchainService.hashEmail(escrowKey);
    const receipt = await this.blockchainService.depositToEscrow(
      emailHash,
      amount,
    );

    await this.walletService.debit(params.userId, amount);

    return this.transferModel.create({
      sender: new Types.ObjectId(params.userId),
      recipientEmail: params.recipientEmail,
      recipientWhatsapp: params.recipientWhatsapp,
      amount,
      currency: params.currency,
      channel: params.channel,
      type: TransferType.Send,
      status: TransferStatus.Escrowed,
      escrowExpiry: new Date(Date.now() + ESCROW_DURATION_MS),
      escrowId: receipt.escrowId,
      txHash: receipt.txHash,
      pinVerifiedAt: new Date(),
    });
  }

  private async notifyRecipient(
    transfer: TransferDocument,
    recipient: UserDocument | null,
  ): Promise<void> {
    const amount = `${fromMinorUnits(transfer.amount)} ${transfer.currency}`;

    if (recipient?.phoneNumber) {
      const message =
        transfer.status === TransferStatus.Escrowed
          ? `${amount} was sent to you via Wype. Create an account to claim it.`
          : `You received ${amount} via Wype.`;

      await this.whatsappService
        .sendMessage(recipient.phoneNumber, message)
        .catch(() => undefined);
    }

    if (
      transfer.status === TransferStatus.Escrowed &&
      transfer.recipientEmail
    ) {
      this.emailService.send(
        transfer.recipientEmail,
        'You received money on Wype',
        `You received ${amount} via Wype. Create an account with ${transfer.recipientEmail} within 7 days to claim it.`,
      );
    }
  }
}
