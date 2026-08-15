import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum TransferStatus {
  Pending = 'pending',
  Completed = 'completed',
  Failed = 'failed',
  Escrowed = 'escrowed',
  Reversed = 'reversed',
}

export enum TransferType {
  Send = 'send',
  Claim = 'claim',
  Reverse = 'reverse',
}

export enum TransferChannel {
  Web = 'web',
  Whatsapp = 'whatsapp',
}

@Schema({ timestamps: true })
export class Transfer {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sender: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  recipient?: Types.ObjectId;

  @Prop({ lowercase: true, trim: true })
  recipientEmail?: string;

  @Prop({ trim: true })
  recipientWhatsapp?: string;

  @Prop({ required: true })
  amount: string;

  @Prop({ required: true, default: 'QUAI' })
  currency: string;

  @Prop({
    required: true,
    enum: TransferStatus,
    default: TransferStatus.Pending,
  })
  status: TransferStatus;

  @Prop({
    required: true,
    enum: TransferType,
    default: TransferType.Send,
  })
  type: TransferType;

  @Prop({
    required: true,
    enum: TransferChannel,
    default: TransferChannel.Web,
  })
  channel: TransferChannel;

  @Prop()
  escrowExpiry?: Date;

  @Prop()
  txHash?: string;

  @Prop()
  escrowId?: string;

  @Prop()
  pinVerifiedAt?: Date;

  @Prop()
  claimedAt?: Date;
}

export type TransferDocument = HydratedDocument<Transfer>;
export const TransferSchema = SchemaFactory.createForClass(Transfer);
