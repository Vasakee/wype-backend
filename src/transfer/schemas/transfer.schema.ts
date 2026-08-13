import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum TransferStatus {
  Pending = 'pending',
  Processing = 'processing',
  Escrowed = 'escrowed',
  Completed = 'completed',
  Failed = 'failed',
}

export enum TransferType {
  Direct = 'direct',
  Escrow = 'escrow',
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
    default: TransferType.Direct,
  })
  type: TransferType;

  @Prop({
    required: true,
    enum: TransferChannel,
    default: TransferChannel.Web,
  })
  channel: TransferChannel;

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
