import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { NutrientDefinition } from './nutrient-definition.schema';

export type IngredientDocument = Ingredient & Document;

@Schema({ _id: false })
export class IngredientNutrient {
  @Prop({ required: true, ref: NutrientDefinition.name })
  nutrientId!: number;

  @Prop({ required: true })
  nutrientName!: string;

  @Prop({ required: true })
  nutrientNumber!: string;

  @Prop({ required: true })
  unitName!: string;

  @Prop({ required: true })
  value!: number;

  @Prop()
  indentLevel?: number;
}

const IngredientNutrientSchema = SchemaFactory.createForClass(IngredientNutrient);

// Virtual populate configuration
IngredientNutrientSchema.virtual('definition', {
  ref: 'NutrientDefinition',
  localField: 'nutrientId',
  foreignField: 'nutritionId',
  justOne: true,
});

@Schema({ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Ingredient {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  fdcId!: number;

  @Prop({ type: [IngredientNutrientSchema], default: [] })
  nutrients!: IngredientNutrient[];
}

export const IngredientSchema = SchemaFactory.createForClass(Ingredient);
