import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { fromMinorUnits, toMinorUnits } from '../transfer/units';
import { TransferService } from '../transfer/transfer.service';
import { UsersService } from '../users/users.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { Request, RequestDocument, RequestStatus } from './request.schema';

export const REQUEST_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Request money from another Wype user. Accepting a request is just a transfer
 * from the payer to the requester, executed with the payer's Transaction PIN.
 */
@Injectable()
export class RequestService {
  constructor(
    @InjectModel(Request.name)
    private readonly requestModel: Model<RequestDocument>,
    private readonly usersService: UsersService,
    private readonly transferService: TransferService,
  ) {}

  async create(userId: string, dto: CreateRequestDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const amount = toMinorUnits(dto.amount);
    if (BigInt(amount) <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    const recipientEmail = dto.recipientEmail.toLowerCase().trim();
    if (recipientEmail === user.email?.toLowerCase()) {
      throw new BadRequestException('You cannot request money from yourself');
    }

    const recipient = await this.usersService.findByEmail(recipientEmail);

    const request = new this.requestModel({
      sender: new Types.ObjectId(userId),
      senderEmail: user.email,
      recipient: recipient?._id,
      recipientEmail,
      amount,
      currency: dto.currency ?? 'QUAI',
      note: dto.note,
      status: RequestStatus.Pending,
      expiresAt: new Date(Date.now() + REQUEST_EXPIRY_MS),
    });

    return request.save();
  }

  async list(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    await this.expireOverdue();

    const [outgoing, incoming] = await Promise.all([
      this.requestModel
        .find({ sender: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
        .exec(),
      this.requestModel
        .find({
          $or: [
            { recipient: new Types.ObjectId(userId) },
            { recipientEmail: user.email?.toLowerCase() },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
        .exec(),
    ]);

    return { outgoing, incoming };
  }

  async accept(userId: string, requestId: string, pin: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const request = await this.requestModel.findById(requestId).exec();
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== RequestStatus.Pending) {
      throw new BadRequestException('This request is no longer pending');
    }
    if (request.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This request has expired');
    }

    const isIntendedRecipient =
      request.recipient?.toString() === userId ||
      request.recipientEmail.toLowerCase() === user.email?.toLowerCase();
    if (!isIntendedRecipient) {
      throw new NotFoundException('Request not found');
    }

    const transfer = await this.transferService.sendByEmail(userId, {
      recipientEmail: request.senderEmail,
      amount: fromMinorUnits(request.amount),
      currency: request.currency,
      pin,
      requestId: request._id.toString(),
    });

    request.status = RequestStatus.Accepted;
    request.acceptedAt = new Date();
    await request.save();

    return { requestId: request._id.toString(), transfer };
  }

  async decline(userId: string, requestId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const request = await this.requestModel.findById(requestId).exec();
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== RequestStatus.Pending) {
      throw new BadRequestException('This request is no longer pending');
    }

    const isIntendedRecipient =
      request.recipient?.toString() === userId ||
      request.recipientEmail.toLowerCase() === user.email?.toLowerCase();
    if (!isIntendedRecipient) {
      throw new NotFoundException('Request not found');
    }

    request.status = RequestStatus.Declined;
    request.declinedAt = new Date();
    await request.save();

    return { ok: true, requestId: request._id.toString() };
  }

  private async expireOverdue(): Promise<void> {
    await this.requestModel
      .updateMany(
        {
          status: RequestStatus.Pending,
          expiresAt: { $lt: new Date() },
        },
        { $set: { status: RequestStatus.Expired } },
      )
      .exec();
  }
}
