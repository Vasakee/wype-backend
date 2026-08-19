import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, expires: 900 }) // 15 min TTL
export class MagicLinkToken {
  @Prop({ required: true, unique: true, index: true })
  token: string;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop()
  fullName?: string;

  @Prop()
  phoneNumber?: string;

  @Prop()
  passwordHash?: string;

  @Prop()
  claimToken?: string;
}

export type MagicLinkTokenDocument = HydratedDocument<MagicLinkToken>;
export const MagicLinkTokenSchema =
  SchemaFactory.createForClass(MagicLinkToken);
