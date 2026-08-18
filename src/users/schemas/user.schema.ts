import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true })
export class User {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email: string;

  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ required: false, unique: true, sparse: true, trim: true })
  phoneNumber?: string;

  @Prop({
    required: false,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  username?: string;

  @Prop()
  usernameClaimedAt?: Date;

  @Prop({ trim: true })
  fullName?: string;

  @Prop({ trim: true })
  walletAddress?: string;

  @Prop({ select: false })
  encryptedPrivateKey?: string;

  @Prop({ select: false })
  transactionPin?: string;

  @Prop({ default: false })
  isPinSet: boolean;

  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ default: 'en', enum: ['en', 'pcm'] })
  lang: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
