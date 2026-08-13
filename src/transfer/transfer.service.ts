import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { BlockchainService } from '../blockchain/blockchain.service';
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
}

@Injectable()
export class TransferService {
  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
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
    });
  }

  getHistory(userId: string): Promise<TransferDocument[]> {
    return this.transferModel
      .find({ $or: [{ sender: userId }, { recipient: userId }] })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async claimEscrow(userId: string, pin: string) {
    const user = await this.verifyUserAndPin(userId, pin);

    const identities: Array<Record<string, string>> = [];
    if (user.email) identities.push({ recipientEmail: user.email });
    if (user.phoneNumber) {
      identities.push({ recipientWhatsapp: user.phoneNumber });
    }

    const escrows = await this.transferModel
      .find({ status: TransferStatus.Escrowed, $or: identities })
      .exec();

    if (escrows.length === 0) {
      throw new NotFoundException('No escrowed funds found for your account');
    }

    const claimed: string[] = [];
    for (const escrow of escrows) {
      const escrowKey = escrow.recipientEmail ?? escrow.recipientWhatsapp;
      if (!escrowKey) continue;

      await this.blockchainService.claimEscrow(
        this.blockchainService.hashEmail(escrowKey),
      );
      await this.walletService.credit(userId, escrow.amount);

      escrow.recipient = user._id;
      escrow.status = TransferStatus.Completed;
      escrow.claimedAt = new Date();
      await escrow.save();

      claimed.push(escrow._id.toString());
    }

    return { claimed: claimed.length, transfers: claimed };
  }

  private async executeTransfer(
    params: ExecuteTransferParams,
  ): Promise<TransferDocument> {
    await this.verifyUserAndPin(params.userId, params.pin);

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
      : params.recipientWhatsapp
        ? await this.usersService.findByPhoneNumber(params.recipientWhatsapp)
        : null;

    if (!recipient && !params.recipientEmail) {
      throw new BadRequestException('Recipient is required');
    }

    if (recipient && recipient._id.toString() === params.userId) {
      throw new BadRequestException('You cannot send money to yourself');
    }

    const registeredAddress = await this.resolveRecipientAddress(
      params,
      recipient,
    );

    const transfer = registeredAddress
      ? await this.runDirectTransfer(
          params,
          recipient,
          registeredAddress,
          amount,
        )
      : await this.runEscrowTransfer(params, amount);

    await this.notifyRecipient(transfer, recipient);

    return transfer;
  }

  private async resolveRecipientAddress(
    params: ExecuteTransferParams,
    recipient: UserDocument | null,
  ): Promise<string | null> {
    if (params.recipientEmail) {
      const emailHash = this.blockchainService.hashEmail(params.recipientEmail);
      return this.blockchainService.resolveEmail(emailHash);
    }

    if (recipient) {
      return (
        (await this.walletService.findByUserId(recipient._id.toString()))
          ?.address ?? null
      );
    }

    return null;
  }

  private async runDirectTransfer(
    params: ExecuteTransferParams,
    recipient: UserDocument | null,
    toAddress: string,
    amount: string,
  ): Promise<TransferDocument> {
    const receipt = await this.blockchainService.directTransfer(
      toAddress,
      amount,
    );

    await this.walletService.debit(params.userId, amount);
    if (recipient) {
      await this.walletService.credit(recipient._id.toString(), amount);
    }

    return this.transferModel.create({
      sender: new Types.ObjectId(params.userId),
      recipient: recipient?._id,
      recipientEmail: params.recipientEmail,
      recipientWhatsapp: params.recipientWhatsapp,
      amount,
      currency: params.currency,
      channel: params.channel,
      type: TransferType.Direct,
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
      type: TransferType.Escrow,
      status: TransferStatus.Escrowed,
      escrowId: receipt.escrowId,
      txHash: receipt.txHash,
      pinVerifiedAt: new Date(),
    });
  }

  private async notifyRecipient(
    transfer: TransferDocument,
    recipient: UserDocument | null,
  ): Promise<void> {
    if (!recipient?.phoneNumber) return;

    const amount = `${fromMinorUnits(transfer.amount)} ${transfer.currency}`;
    const message =
      transfer.status === TransferStatus.Escrowed
        ? `${amount} was sent to you via Wype. Create an account to claim it.`
        : `You received ${amount} via Wype.`;

    await this.whatsappService
      .sendMessage(recipient.phoneNumber, message)
      .catch(() => undefined);
  }

  private async verifyUserAndPin(
    userId: string,
    pin: string,
  ): Promise<UserDocument> {
    const user = await this.usersService.findByIdWithPin(userId);
    if (!user || !user.isEmailVerified) {
      throw new UnauthorizedException('Unauthorized');
    }
    if (!user.transactionPin) {
      throw new BadRequestException(
        'Set a transaction PIN before sending money',
      );
    }
    if (!(await bcrypt.compare(pin, user.transactionPin))) {
      throw new UnauthorizedException('Invalid transaction PIN');
    }
    return user;
  }
}
