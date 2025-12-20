import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from '../../auth/schemas/user.schema';

export type PantryItemDocument = PantryItem & Document;

@Schema({ timestamps: true })
export class PantryItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: User;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  quantity!: number;

  @Prop({ required: true })
  unit!: string;

  @Prop()
  category?: string;

  @Prop()
  expiryDate?: Date;
}

export const PantryItemSchema = SchemaFactory.createForClass(PantryItem);
