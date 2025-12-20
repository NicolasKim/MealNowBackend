import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TastePreferenceDocument = TastePreference & Document;

@Schema()
export class TastePreference {
    @Prop({ required: true })
    category!: string; // e.g., 'spiceLevel', 'dietary', 'cuisine'

    @Prop({ type: Object, required: true })
    label!: Record<string, string>; // e.g. { en: "Mild", zh: "微辣" }

    @Prop({ required: true })
    value!: string; // Unique identifier

    @Prop()
    icon?: string; // Optional icon name
}

export const TastePreferenceSchema = SchemaFactory.createForClass(TastePreference);
