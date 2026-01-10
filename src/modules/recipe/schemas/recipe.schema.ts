import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type RecipeDocument = Recipe & Document;

@Schema()
class Ingredient {
  @Prop({ required: true })
  name!: string;

  @Prop()
  amount?: number;

  @Prop()
  quantity?: number; // Compatible with some variations

  @Prop()
  unit?: string;
}

@Schema()
class Step {
  @Prop()
  order?: number;

  @Prop()
  instruction!: string;

  @Prop()
  stepName?: string;

  @Prop()
  durationSeconds?: number;
}

@Schema({ timestamps: true })
export class Recipe {
  @Prop({ alias: 'id', type: String })
  _id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop()
  imageUrl?: string;

  @Prop()
  type?: string;

  @Prop()
  description?: string;

  @Prop()
  mealType?: string;

  @Prop()
  cookTimeMinutes?: number;

  @Prop()
  difficulty?: string;

  @Prop()
  matchRate?: number;

  @Prop({ type: [SchemaFactory.createForClass(Ingredient)] })
  ingredients?: Ingredient[];

  @Prop({ type: [SchemaFactory.createForClass(Step)] })
  steps?: Step[];
}

export const RecipeSchema = SchemaFactory.createForClass(Recipe);
