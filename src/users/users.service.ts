import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

const BCRYPT_ROUNDS = 10;

export interface CreateUserParams {
  name: string;
  email?: string;
  whatsappNumber?: string;
  passwordHash: string;
  transactionPin?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  findByIdWithPin(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('+transactionPin').exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  findByWhatsappNumber(whatsappNumber: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ whatsappNumber }).exec();
  }

  findByIdentity(identifier: string): Promise<UserDocument | null> {
    const query = {
      $or: [
        { email: identifier.toLowerCase() },
        { whatsappNumber: identifier },
      ],
    };
    return this.userModel.findOne(query).exec();
  }

  findByIdentityWithPassword(identifier: string): Promise<UserDocument | null> {
    const query = {
      $or: [
        { email: identifier.toLowerCase() },
        { whatsappNumber: identifier },
      ],
    };
    return this.userModel.findOne(query).select('+passwordHash').exec();
  }

  async setTransactionPin(
    userId: string,
    pin: string,
  ): Promise<UserDocument | null> {
    const transactionPin = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    return this.userModel
      .findByIdAndUpdate(userId, { transactionPin }, { new: true })
      .exec();
  }

  async create(params: CreateUserParams): Promise<UserDocument> {
    const user = new this.userModel({
      ...params,
      email: params.email?.toLowerCase().trim(),
      whatsappNumber: params.whatsappNumber?.trim(),
    });

    return user.save();
  }
}
