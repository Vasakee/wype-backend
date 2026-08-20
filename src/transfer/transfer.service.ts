import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { EmailService } from '../email/email.service';
import { EscrowService, ESCROW_DURATION_MS } from '../escrow/escrow.service';
import { FeesService } from '../fees/fees.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import type { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateEmailTransferDto } from './dto/create-email-transfer.dto';
import { CreateWhatsappTransferDto } from './dto/create-whatsapp-transfer.dto';
import { QuoteTransferDto } from './dto/quote-transfer.dto';
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
  requestId?: string;
  senderWalletAddress?: string;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly blockchainService: BlockchainService,
    private readonly escrowService: EscrowService,
    private readonly emailService: EmailService,
    private readonly feesService: FeesService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    @Inject('WHATSAPP_SERVICE')
    private readonly whatsappService: WhatsappService,
  ) {}

  async quote(userId: string, dto: QuoteTransferDto) {
    const amount = toMinorUnits(dto.amount);
    if (BigInt(amount) <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    const recipient = dto.recipientEmail
      ? await this.usersService.findByEmail(dto.recipientEmail)
      : dto.recipientUsername
        ? await this.usersService.findByUsername(dto.recipientUsername)
        : null;
    if (recipient && recipient._id.toString() === userId) {
      throw new BadRequestException('You cannot send money to yourself');
    }

    const mode = recipient ? 'direct' : 'escrow';
    const fee = this.feesService.calculate(dto.amount);
    const total = Number(dto.amount) + Number(fee);
    const totalStr = total.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

    return {
      fee,
      total: totalStr,
      mode,
      expiryDays:
        mode === 'escrow' ? ESCROW_DURATION_MS / 86_400_000 : undefined,
    };
  }

  async findById(
    userId: string,
    transferId: string,
  ): Promise<TransferDocument> {
    const [transfer, user] = await Promise.all([
      this.transferModel.findById(transferId).exec(),
      this.usersService.findById(userId),
    ]);

    if (!transfer) {
      throw new NotFoundException('Transaction not found');
    }

    const isSender = transfer.sender?.toString() === userId;
    const isRecipient = transfer.recipient?.toString() === userId;
    const isEmailRecipient =
      !!transfer.recipientEmail &&
      transfer.recipientEmail.toLowerCase() === user?.email?.toLowerCase();
    const isWhatsappRecipient =
      !!transfer.recipientWhatsapp &&
      transfer.recipientWhatsapp === user?.phoneNumber;

    if (
      !isSender &&
      !isRecipient &&
      !isEmailRecipient &&
      !isWhatsappRecipient
    ) {
      throw new NotFoundException('Transaction not found');
    }

    return transfer;
  }

  /**
   * Cancels an escrowed transfer the caller sent, returning the money to the
   * sender's custodial balance.
   */
  async cancel(userId: string, transferId: string, pin: string) {
    await this.usersService.verifyTransactionPin(userId, pin);

    const transfer = await this.transferModel.findById(transferId).exec();
    if (!transfer || transfer.sender?.toString() !== userId) {
      throw new NotFoundException('Transaction not found');
    }
    if (transfer.status !== TransferStatus.Escrowed) {
      throw new BadRequestException('This transfer cannot be cancelled');
    }
    if (
      transfer.escrowExpiry &&
      transfer.escrowExpiry.getTime() <= Date.now()
    ) {
      throw new BadRequestException('This escrow has expired');
    }

    if (!transfer.escrowId) {
      throw new BadRequestException('This transfer cannot be cancelled');
    }

    const receipt = await this.blockchainService.cancelEscrow(
      transfer.escrowId,
    );

    await this.walletService.credit(userId, transfer.amount);

    await this.transferModel.create({
      sender: transfer.sender,
      recipientEmail: transfer.recipientEmail,
      recipientWhatsapp: transfer.recipientWhatsapp,
      amount: transfer.amount,
      currency: transfer.currency,
      channel: transfer.channel,
      type: TransferType.Reverse,
      status: TransferStatus.Reversed,
      escrowExpiry: transfer.escrowExpiry,
      escrowId: transfer.escrowId,
      txHash: receipt.txHash,
    });

    transfer.status = TransferStatus.Reversed;
    transfer.cancelledAt = new Date();
    await transfer.save();

    return { ok: true, refundedAmount: fromMinorUnits(transfer.amount) };
  }

  /**
   * Re-sends the claim invite email for an escrowed transfer the caller sent.
   */
  async resendInvite(userId: string, transferId: string) {
    const transfer = await this.transferModel.findById(transferId).exec();
    if (!transfer || transfer.sender?.toString() !== userId) {
      throw new NotFoundException('Transaction not found');
    }
    if (transfer.status !== TransferStatus.Escrowed) {
      throw new BadRequestException('This transfer is not waiting on a claim');
    }

    if (transfer.recipientEmail && transfer.claimToken) {
      this.notifyEscrowRecipient(transfer);
    }

    return { ok: true, cooldownSeconds: 30 };
  }

  /** Public claim-link status, used by the cold-start /claim/[token] page. */
  async claimStatus(claimToken: string) {
    const transfer = await this.transferModel.findOne({ claimToken }).exec();

    if (!transfer) {
      return { status: 'invalid-token' };
    }

    const sender = transfer.sender
      ? await this.usersService.findById(transfer.sender.toString())
      : null;

    const now = Date.now();
    const isExpired =
      transfer.escrowExpiry && transfer.escrowExpiry.getTime() <= now;

    let status: string;
    if (transfer.status === TransferStatus.Completed && transfer.claimedAt) {
      status = 'already-claimed';
    } else if (
      transfer.status === TransferStatus.Reversed &&
      transfer.cancelledAt
    ) {
      status = 'cancelled';
    } else if (transfer.status === TransferStatus.Reversed || isExpired) {
      status = 'expired';
    } else if (transfer.status === TransferStatus.Escrowed) {
      status = 'valid';
    } else {
      status = 'invalid-token';
    }

    return {
      status,
      amount: fromMinorUnits(transfer.amount),
      currency: transfer.currency,
      senderEmail: sender?.email,
      recipientEmail: transfer.recipientEmail,
      expiresAt: transfer.escrowExpiry?.toISOString(),
    };
  }

  /** Public claim-start: mails a claim-bound magic link to the recipient. */
  async startClaim(claimToken: string) {
    const transfer = await this.transferModel.findOne({ claimToken }).exec();

    if (!transfer || transfer.status !== TransferStatus.Escrowed) {
      throw new NotFoundException('This claim link is no longer valid');
    }
    if (!transfer.recipientEmail) {
      throw new BadRequestException(
        'This transfer was sent to a WhatsApp number and cannot be claimed by email',
      );
    }
    if (
      transfer.escrowExpiry &&
      transfer.escrowExpiry.getTime() <= Date.now()
    ) {
      throw new BadRequestException('This claim link has expired');
    }

    return this.authService.issueClaimLink(transfer.recipientEmail, claimToken);
  }

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
      recipientUsername: dto.recipientUsername,
      requestId: dto.requestId,
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

  async getHistory(userId: string): Promise<TransferDocument[]> {
    const user = await this.usersService.findById(userId);
    const or: Record<string, unknown>[] = [
      { sender: userId },
      { recipient: userId },
    ];
    if (user?.email) or.push({ recipientEmail: user.email.toLowerCase() });
    if (user?.phoneNumber) or.push({ recipientWhatsapp: user.phoneNumber });

    return this.transferModel
      .find({ $or: or, type: { $ne: TransferType.Claim } })
      .select('sender recipient recipientEmail recipientWhatsapp amount currency channel type status createdAt escrowExpiry')
      .populate('sender', 'email fullName')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
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
    params.senderWalletAddress = senderWallet.address;

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
    const toAddress = recipient.walletAddress;
    if (!toAddress) {
      throw new BadRequestException('Recipient has not linked a wallet yet');
    }

    // Debit/credit the custodial ledger immediately — this is the source of
    // truth for Wype balances and completes in milliseconds.
    await this.walletService.debit(params.userId, amount);
    await this.walletService.credit(recipient._id.toString(), amount);

    // Create the transfer record as "completed" from the user's perspective.
    const transfer = await this.transferModel.create({
      sender: new Types.ObjectId(params.userId),
      recipient: recipient._id,
      recipientEmail: params.recipientEmail,
      recipientWhatsapp: params.recipientWhatsapp,
      amount,
      currency: params.currency,
      channel: params.channel,
      type: TransferType.Send,
      status: TransferStatus.Completed,
      requestId: params.requestId,
      pinVerifiedAt: new Date(),
    });

    // Fire off the on-chain transfer in the background. If it fails, we log
    // it but the custodial ledger is already settled.
    this.blockchainService
      .directTransfer(toAddress, amount)
      .then(async (receipt) => {
        transfer.txHash = receipt.txHash;
        await transfer.save();
        this.logger.log(
          `DirectTransfer ${transfer._id} confirmed: ${receipt.txHash}`,
        );
      })
      .catch((e: unknown) => {
        this.logger.error(
          `DirectTransfer ${transfer._id} failed`,
          e instanceof Error ? e.stack : String(e),
        );
      });

    return transfer;
  }

  private async runEscrowTransfer(
    params: ExecuteTransferParams,
    amount: string,
  ): Promise<TransferDocument> {
    const escrowKey = params.recipientEmail ?? params.recipientWhatsapp;
    if (!escrowKey) {
      throw new BadRequestException('Recipient is required');
    }

    const claimToken = randomBytes(32).toString('hex');
    const commitment = this.blockchainService.commitmentFor(
      this.blockchainService.hashEmail(escrowKey),
      claimToken,
    );

    // Debit the sender immediately — ledger is the source of truth.
    await this.walletService.debit(params.userId, amount);

    // Derive the expiry from the chain's clock.
    const expirySeconds =
      (await this.blockchainService.chainNow()) + ESCROW_DURATION_MS / 1000;

    // Create the transfer record before the blockchain tx so the user
    // sees it immediately. The txHash is filled in after broadcast.
    const transfer = await this.transferModel.create({
      sender: new Types.ObjectId(params.userId),
      recipientEmail: params.recipientEmail,
      recipientWhatsapp: params.recipientWhatsapp,
      amount,
      currency: params.currency,
      channel: params.channel,
      type: TransferType.Send,
      status: TransferStatus.Escrowed,
      escrowExpiry: new Date(expirySeconds * 1000),
      escrowId: commitment,
      claimToken,
      pinVerifiedAt: new Date(),
    });

    // Fire off the on-chain deposit in the background.
    this.blockchainService
      .depositToEscrow(commitment, amount, expirySeconds)
      .then(async (receipt) => {
        transfer.txHash = receipt.txHash;
        await transfer.save();
        this.logger.log(
          `EscrowDeposit ${transfer._id} confirmed: ${receipt.txHash}`,
        );
      })
      .catch((e: unknown) => {
        this.logger.error(
          `EscrowDeposit ${transfer._id} failed`,
          e instanceof Error ? e.stack : String(e),
        );
      });

    return transfer;
  }

  private notifyEscrowRecipient(transfer: TransferDocument): void {
    if (!transfer.recipientEmail) return;

    const amount = `${fromMinorUnits(transfer.amount)} ${transfer.currency}`;
    const claimUrl = transfer.claimToken
      ? `${this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'}/claim/${transfer.claimToken}`
      : undefined;

    void this.emailService.send(
      transfer.recipientEmail,
      'You received money on Wype',
      claimUrl
        ? `You received ${amount} via Wype. Claim it here within 7 days: ${claimUrl}`
        : `You received ${amount} via Wype. Create an account with ${transfer.recipientEmail} within 7 days to claim it.`,
    );
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
      this.notifyEscrowRecipient(transfer);
    }
  }
}
