import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum RequestStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Declined = 'declined',
  Expired = 'expired',
}

@Schema({ timestamps: true })
export class Request {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sender: Types.ObjectId;

  @Prop({ required: true })
  senderEmail: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  recipient?: Types.ObjectId;

  @Prop({ required: true, index: true })
  recipientEmail: string;

  @Prop({ required: true })
  amount: string;

  @Prop({ required: true, default: 'QUAI' })
  currency: string;

  @Prop()
  note?: string;

  @Prop({
    required: true,
    enum: RequestStatus,
    default: RequestStatus.Pending,
  })
  status: RequestStatus;

  @Prop()
  expiresAt: Date;

  @Prop()
  acceptedAt?: Date;

  @Prop()
  declinedAt?: Date;
}

export type RequestDocument = HydratedDocument<Request>;
export const RequestSchema = SchemaFactory.createForClass(Request);
