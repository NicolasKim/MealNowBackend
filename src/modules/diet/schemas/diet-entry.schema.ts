import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Schema as MongooseSchema } from 'mongoose'
import { User } from '../../auth/schemas/user.schema'

export type DietEntryDocument = DietEntry & Document

@Schema({ timestamps: true })
export class DietEntry {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  user!: User

  @Prop({ required: true, index: true })
  date!: string

  @Prop({ required: true, index: true })
  mealType!: string

  @Prop({ index: true })
  recipeId?: string

  @Prop({ type: Object, required: true })
  nutrition!: any
}

export const DietEntrySchema = SchemaFactory.createForClass(DietEntry)
