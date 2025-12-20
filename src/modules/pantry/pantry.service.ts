import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PantryItem, PantryItemDocument } from './schemas/pantry-item.schema';

export interface IngredientInput {
  name: string;
  quantity: number;
  unit: string;
  category?: string;
  expiryDate?: Date;
}

@Injectable()
export class PantryService {
  constructor(
    @InjectModel(PantryItem.name) private pantryModel: Model<PantryItemDocument>,
  ) {}

  async findAll(userId: string): Promise<PantryItem[]> {
    return this.pantryModel.find({ user: userId }).sort({ createdAt: -1 }).exec();
  }

  async addIngredient(userId: string, input: IngredientInput): Promise<PantryItem> {
    const now = new Date();
    // Try to find an existing valid (not expired) item with the same name and unit
    const existingItem = await this.pantryModel.findOne({
      user: userId,
      name: input.name,
      unit: input.unit,
      $or: [
        { expiryDate: { $gte: now } },
        { expiryDate: null },
        { expiryDate: { $exists: false } },
      ],
    });

    if (existingItem) {
      existingItem.quantity += input.quantity;
      return existingItem.save();
    }

    const newItem = new this.pantryModel({
      ...input,
      user: userId,
    });
    return newItem.save();
  }

  async updateIngredient(
    userId: string,
    id: string,
    input: IngredientInput,
  ): Promise<PantryItem | null> {
    return this.pantryModel
      .findOneAndUpdate({ _id: id, user: userId }, input, { new: true })
      .exec();
  }

  async removeIngredient(userId: string, id: string): Promise<boolean> {
    const result = await this.pantryModel
      .deleteOne({ _id: id, user: userId })
      .exec();
    return (result.deletedCount || 0) > 0;
  }
}
