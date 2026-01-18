import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type NutrientDefinitionDocument = NutrientDefinition & Document

export type LocalizedText = Record<string, string>

@Schema({ timestamps: true })
export class NutrientDefinition {
  @Prop({ required: true, unique: true, index: true })
  nutritionId!: number

  @Prop({ required: true, unique: true, index: true })
  type!: string

  @Prop({ required: true })
  category!: string

  @Prop({ required: true })
  categoryOrder!: number

  @Prop({ required: true })
  typeOrder!: number

  @Prop({ type: Object, required: true })
  categoryName!: LocalizedText

  @Prop({ type: Object, required: true })
  name!: LocalizedText

  @Prop({ required: true })
  unit!: string

  @Prop({ required: true })
  dailyValue!: number
}

export const NutrientDefinitionSchema = SchemaFactory.createForClass(NutrientDefinition)
