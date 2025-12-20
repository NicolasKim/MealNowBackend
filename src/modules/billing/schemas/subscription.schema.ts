import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type SubscriptionDocument = Subscription & Document

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ required: true, index: true })
  userId!: string

  @Prop({ required: true })
  plan!: string

  @Prop({ default: 'active' })
  status!: string

  @Prop()
  startAt?: Date

  @Prop()
  endAt?: Date

  @Prop({ default: 0 })
  remainingTrials!: number

  @Prop({ index: true })
  appStoreOriginalTransactionId?: string

  @Prop({ default: true })
  autoRenew?: boolean
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription)

