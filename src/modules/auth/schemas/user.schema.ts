import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
    @Prop()
    phone?: string;

    @Prop()
    email?: string;

    @Prop()
    authId?: string; // For third-party login ID or unique user ID

    @Prop()
    authProvider?: string; // 'phone', 'wechat', 'apple'

    @Prop({ select: false }) // Don't include in queries by default for security
    password?: string; // Hashed password for phone-based auth

    @Prop({ default: false })
    onboardingCompleted!: boolean;

    @Prop()
    nickname?: string;

    @Prop()
    gender?: string;

    @Prop()
    region?: string;

    @Prop()
    avatar?: string;

    @Prop({ type: [String], default: [] })
    tastePreferences!: string[]; // Selected preference IDs

    @Prop({ type: [{ type: String, ref: 'Recipe' }], default: [] })
    savedRecipes!: string[]; // IDs of saved recipes

    @Prop({ type: [String], default: [] })
    deviceTokens!: string[]; // APNs device tokens

    @Prop({ default: 'en' })
    language!: string;

    @Prop({ default: 'UTC' })
    timezone!: string;

    @Prop({ default: 'active', enum: ['active', 'frozen', 'deleted'] })
    status!: string;

    @Prop({ default: 0 })
    tokenVersion!: number;

    @Prop({ default: Date.now })
    lastActiveAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
