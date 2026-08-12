import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { Transfer, TransferStatus } from './schemas/transfer.schema';
import type { TransferDocument } from './schemas/transfer.schema';

@Injectable()
export class TransferService {
  constructor(
    @InjectModel(Transfer.name)
    private readonly transferModel: Model<TransferDocument>,
    private readonly usersService: UsersService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async create(
    senderId: string,
    dto: CreateTransferDto,
  ): Promise<TransferDocument> {
    const recipientIdentifier = dto.recipientEmail ?? dto.recipientWhatsapp;
    if (!recipientIdentifier) {
      throw new BadRequestException(
        'Provide a recipient email or WhatsApp number',
      );
    }

    const recipient =
      await this.usersService.findByIdentity(recipientIdentifier);

    if (!recipient) {
      throw new NotFoundException('Recipient is not registered on Wype yet');
    }

    const transfer = new this.transferModel({
      sender: new Types.ObjectId(senderId),
      recipient: recipient._id,
      recipientEmail: dto.recipientEmail,
      recipientWhatsapp: dto.recipientWhatsapp,
      amount: dto.amount,
      currency: dto.currency ?? 'QUAI',
      status: TransferStatus.Pending,
    });

    const saved = await transfer.save();

    if (recipient.whatsappNumber) {
      await this.whatsappService
        .sendMessage(
          recipient.whatsappNumber,
          `You received ${saved.amount} ${saved.currency} via Wype. Reply to this message to claim it.`,
        )
        .catch(() => undefined);
    }

    return saved;
  }

  findByUser(userId: string): Promise<TransferDocument[]> {
    return this.transferModel
      .find({ $or: [{ sender: userId }, { recipient: userId }] })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  findById(id: string): Promise<TransferDocument | null> {
    return this.transferModel.findById(id).exec();
  }
}
