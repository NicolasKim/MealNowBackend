import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Schema as MongooseSchema } from 'mongoose'
import { User } from '../../auth/schemas/user.schema'
import { NutrientDefinition } from '../../food/schemas/nutrient-definition.schema'

export type DietEntryDocument = DietEntry & Document

export class DietNutritionItem extends NutrientDefinition {
  value!: number
  
  @Prop()
  min?: number;

  @Prop()
  max?: number;
}

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

  @Prop({ required: true })
  nutritions!: DietNutritionItem[]
}

export const DietEntrySchema = SchemaFactory.createForClass(DietEntry)
