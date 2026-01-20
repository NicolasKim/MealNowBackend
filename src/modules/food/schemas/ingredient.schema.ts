import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IngredientDocument = Ingredient & Document;

@Schema({ _id: false })
export class IngredientNutrient {
  @Prop({ required: true })
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
