import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UsageRecordDocument = UsageRecord & Document;

@Schema({ timestamps: true })
export class UsageRecord {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  type!: string; // 'generation', 'recognition', 'trial', 'pack_purchase', etc.

  @Prop({ required: true })
  amount!: number; // e.g. -1, +10

  @Prop()
  description?: string;

  @Prop()
  relatedId?: string; // e.g. recipeId, paymentId
}

export const UsageRecordSchema = SchemaFactory.createForClass(UsageRecord);
