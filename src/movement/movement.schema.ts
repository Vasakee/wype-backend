import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum MovementType {
  SelfCustody = 'self-custody',
  Funding = 'funding',
}

export enum MovementStatus {
  Pending = 'pending',
  Completed = 'completed',
}

@Schema({ timestamps: true })
export class Movement {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  amount: string;

  @Prop({ required: true, default: 'QUAI' })
  currency: string;

  @Prop({ required: true })
  blipLink: string;

  @Prop()
  txHash?: string;

  @Prop({
    required: true,
    enum: MovementType,
    default: MovementType.SelfCustody,
    index: true,
  })
  type: MovementType;

  @Prop()
  sessionId?: string;

  @Prop()
  invoiceRef?: string;

  @Prop()
  amountCents?: number;

  @Prop({
    required: true,
    enum: MovementStatus,
    default: MovementStatus.Pending,
    index: true,
  })
  status: MovementStatus;
}

export type MovementDocument = HydratedDocument<Movement>;
export const MovementSchema = SchemaFactory.createForClass(Movement);

MovementSchema.index({ status: 1, type: 1 });
MovementSchema.index({ createdAt: -1 });
