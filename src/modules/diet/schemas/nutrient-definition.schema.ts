import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type NutrientDefinitionDocument = NutrientDefinition & Document

export type LocalizedText = Record<string, string>

export type NutrientBenefits = {
  efficacy: LocalizedText
  deficiency: LocalizedText
  excess: LocalizedText
}

@Schema({ timestamps: true })
export class NutrientDefinition {
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
  name!: Record<string, string>

  @Prop({ type: Object, required: true })
  benefits!: NutrientBenefits

  @Prop({ required: true })
  unit!: string

  @Prop({ required: true })
  lowerRecommendedIntake!: number

  @Prop({ required: true })
  upperRecommendedIntake!: number
}

export const NutrientDefinitionSchema = SchemaFactory.createForClass(NutrientDefinition)
