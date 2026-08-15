import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { USERNAME_PATTERN } from './username';

const BCRYPT_ROUNDS = 10;

export interface CreateUserParams {
  email: string;
  fullName?: string;
  phoneNumber?: string;
  passwordHash?: string;
  walletAddress?: string;
  encryptedPrivateKey?: string;
  isEmailVerified?: boolean;
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
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  findByPhoneNumber(phoneNumber: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phoneNumber }).exec();
  }

  findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).exec();
  }

  findByIdentity(identifier: string): Promise<UserDocument | null> {
    const query = {
      $or: [
        { email: identifier.toLowerCase().trim() },
        { phoneNumber: identifier },
      ],
    };
    return this.userModel.findOne(query).exec();
  }

  findByIdentityWithPassword(identifier: string): Promise<UserDocument | null> {
    const query = {
      $or: [
        { email: identifier.toLowerCase().trim() },
        { phoneNumber: identifier },
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
      .findByIdAndUpdate(
        userId,
        { transactionPin, isPinSet: true },
        { new: true },
      )
      .exec();
  }

  async setWallet(
    userId: string,
    walletAddress: string,
    encryptedPrivateKey?: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { walletAddress, encryptedPrivateKey },
        { new: true },
      )
      .exec();
  }

  /**
   * Verifies that the user exists, is email-verified and provided the correct
   * 4-digit Transaction PIN. Always required before moving money.
   */
  async verifyTransactionPin(
    userId: string,
    pin: string,
  ): Promise<UserDocument> {
    const user = await this.findByIdWithPin(userId);
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

  /**
   * Ties a WhatsApp phone number to a user account. Rejects the call when the
   * number is already linked to a different account.
   */
  async linkPhoneNumber(
    userId: string,
    phoneNumber: string,
  ): Promise<UserDocument> {
    const normalized = phoneNumber.trim();
    if (!normalized) {
      throw new BadRequestException('Phone number is required');
    }

    const holder = await this.findByPhoneNumber(normalized);
    if (holder && holder._id.toString() !== userId) {
      throw new ConflictException(
        'This WhatsApp number is linked to a different account',
      );
    }

    const updated = await this.userModel
      .findByIdAndUpdate(userId, { phoneNumber: normalized }, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return updated;
  }

  async markEmailVerified(userId: string): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { isEmailVerified: true }, { new: true })
      .exec();
  }

  async claimUsername(userId: string, username: string): Promise<UserDocument> {
    const normalized = username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(normalized)) {
      throw new BadRequestException(
        'Username must be 3-31 characters using lowercase letters, digits, dots, hyphens, underscores or @',
      );
    }

    const taken = await this.findByUsername(normalized);
    if (taken) {
      throw new ConflictException('Username is already taken');
    }

    try {
      const updated = await this.userModel
        .findByIdAndUpdate(
          userId,
          { username: normalized, usernameClaimedAt: new Date() },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new NotFoundException('User not found');
      }
      return updated;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Username is already taken');
      }
      throw error;
    }
  }

  async create(params: CreateUserParams): Promise<UserDocument> {
    const user = new this.userModel({
      ...params,
      email: params.email.toLowerCase().trim(),
      phoneNumber: params.phoneNumber?.trim(),
      fullName: params.fullName?.trim(),
      isEmailVerified: params.isEmailVerified ?? false,
    });

    return user.save();
  }
}
