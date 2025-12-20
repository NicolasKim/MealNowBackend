import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TastePreference, TastePreferenceDocument } from './taste-preference.schema';

@Injectable()
export class PreferenceService implements OnModuleInit {
  private readonly logger = new Logger(PreferenceService.name);

  // Predefined taste preference options definitions
  private readonly TASTE_PREFERENCE_DEFINITIONS = [
    // Spice Level
    { category: 'spiceLevel', value: 'spice_none', icon: '🍃', label: { en: 'Non-spicy', zh: '不辣' } },
    { category: 'spiceLevel', value: 'spice_mild', icon: '🌶️', label: { en: 'Mild', zh: '微辣' } },
    { category: 'spiceLevel', value: 'spice_medium', icon: '🌶️🌶️', label: { en: 'Medium', zh: '中辣' } },
    { category: 'spiceLevel', value: 'spice_hot', icon: '🔥', label: { en: 'Hot', zh: '重辣' } },

    // Dietary Restrictions
    { category: 'dietary', value: 'no_beef', icon: '🐄', label: { en: 'No Beef', zh: '不吃牛肉' } },
    { category: 'dietary', value: 'no_pork', icon: '🐷', label: { en: 'No Pork', zh: '不吃猪肉' } },
    { category: 'dietary', value: 'vegetarian', icon: '🥬', label: { en: 'Vegetarian', zh: '素食' } },
    { category: 'dietary', value: 'vegan', icon: '🌱', label: { en: 'Vegan', zh: '纯素' } },
    { category: 'dietary', value: 'gluten_free', icon: '🌾', label: { en: 'Gluten Free', zh: '无麸质' } },
    { category: 'dietary', value: 'nut_free', icon: '🥜', label: { en: 'Nut Free', zh: '无坚果' } },
    { category: 'dietary', value: 'no_seafood', icon: '🦐', label: { en: 'No Seafood', zh: '海鲜过敏' } },

    // Cuisine Preferences
    { category: 'cuisine', value: 'cuisine_sichuan', icon: '🍜', label: { en: 'Sichuan Cuisine', zh: '川菜' } },
    { category: 'cuisine', value: 'cuisine_cantonese', icon: '🥡', label: { en: 'Cantonese Cuisine', zh: '粤菜' } },
    { category: 'cuisine', value: 'cuisine_japanese', icon: '🍱', label: { en: 'Japanese Cuisine', zh: '日料' } },
    { category: 'cuisine', value: 'cuisine_western', icon: '🍝', label: { en: 'Western Cuisine', zh: '西餐' } },
    { category: 'cuisine', value: 'cuisine_korean', icon: '🍲', label: { en: 'Korean Cuisine', zh: '韩餐' } },
    { category: 'cuisine', value: 'cuisine_thai', icon: '🍛', label: { en: 'Thai Cuisine', zh: '泰餐' } },
  ];

  constructor(
    @InjectModel(TastePreference.name) private tastePreferenceModel: Model<TastePreferenceDocument>,
  ) {}

  async onModuleInit() {
    await this.seedPreferences();
  }

  private async seedPreferences() {
    try {
      const count = await this.tastePreferenceModel.countDocuments();
      if (count === 0) {
        this.logger.log('Seeding taste preferences...');
        await this.tastePreferenceModel.insertMany(this.TASTE_PREFERENCE_DEFINITIONS);
        this.logger.log('Taste preferences seeded successfully.');
      } else {
        // Optional: Check if we need to add new ones?
        // For now, just skip if any exist, as per "if not in database" requirement.
        this.logger.log('Taste preferences already exist. Skipping seed.');
      }
    } catch (error: any) {
      this.logger.error(`Failed to seed taste preferences: ${error.message}`, error.stack);
    }
  }

  async getAllPreferences(): Promise<TastePreference[]> {
    return this.tastePreferenceModel.find().lean();
  }
}
