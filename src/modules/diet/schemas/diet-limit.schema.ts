import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { User } from '../../auth/schemas/user.schema';
import { NutrientDefinition } from '../../food/schemas/nutrient-definition.schema';

export type DietLimitDocument = DietLimit & Document;

@Schema({ _id: false })
export class NutrientLimit {
    @Prop({ required: true, ref: 'NutrientDefinition', type: String })
    type!: string;

    @Prop({ required: true })
    min!: number;

    @Prop({ required: true })
    max!: number;
}

const NutrientLimitSchema = SchemaFactory.createForClass(NutrientLimit);

@Schema({ timestamps: true })
export class DietLimit {
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true, unique: true })
    user!: User;

    @Prop({ type: [NutrientLimitSchema], default: [] })
    limits!: NutrientLimit[];
}

export const DietLimitSchema = SchemaFactory.createForClass(DietLimit);
