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
    { category: 'cuisine', value: 'cuisine_sichuan', icon: '🌶️', label: { en: 'Sichuan Cuisine', zh: '川菜' } },
    { category: 'cuisine', value: 'cuisine_cantonese', icon: '🇲🇴', label: { en: 'Cantonese Cuisine', zh: '粤菜' } },
    { category: 'cuisine', value: 'cuisine_xiang', icon: '🥘', label: { en: 'Hunan Cuisine', zh: '湘菜' } },
    { category: 'cuisine', value: 'cuisine_jiangzhe', icon: '🦐', label: { en: 'Jiangzhe Cuisine', zh: '江浙菜' } },
    { category: 'cuisine', value: 'cuisine_northern', icon: '🥯', label: { en: 'Northern Cuisine', zh: '北方菜' } },
    { category: 'cuisine', value: 'cuisine_japanese', icon: '🍱', label: { en: 'Japanese Cuisine', zh: '日料' } },
    { category: 'cuisine', value: 'cuisine_korean', icon: '🇰🇷', label: { en: 'Korean Cuisine', zh: '韩餐' } },
    { category: 'cuisine', value: 'cuisine_thai', icon: '🥥', label: { en: 'Thai Cuisine', zh: '泰餐' } },
    { category: 'cuisine', value: 'cuisine_vietnamese', icon: '🍜', label: { en: 'Vietnamese', zh: '越南菜' } },
    { category: 'cuisine', value: 'cuisine_indian', icon: '🍛', label: { en: 'Indian', zh: '印度菜' } },
    { category: 'cuisine', value: 'cuisine_italian', icon: '🍕', label: { en: 'Italian', zh: '意式料理' } },
    { category: 'cuisine', value: 'cuisine_french', icon: '🥐', label: { en: 'French', zh: '法式料理' } },
    { category: 'cuisine', value: 'cuisine_american', icon: '🍔', label: { en: 'American', zh: '美式料理' } },
    { category: 'cuisine', value: 'cuisine_mexican', icon: '🌮', label: { en: 'Mexican', zh: '墨西哥菜' } },
    { category: 'cuisine', value: 'cuisine_western', icon: '🍝', label: { en: 'Western Cuisine', zh: '西餐' } },
  ];

  constructor(
    @InjectModel(TastePreference.name) private tastePreferenceModel: Model<TastePreferenceDocument>,
  ) {}

  async onModuleInit() {
    await this.seedPreferences();
  }

  private async seedPreferences() {
    try {
      this.logger.log('Seeding/Updating taste preferences...');
      
      const operations = this.TASTE_PREFERENCE_DEFINITIONS.map(pref => ({
        updateOne: {
          filter: { category: pref.category, value: pref.value },
          update: { $set: pref },
          upsert: true
        }
      }));

      await this.tastePreferenceModel.bulkWrite(operations);
      
      this.logger.log('Taste preferences seeded/updated successfully.');
    } catch (error: any) {
      this.logger.error(`Failed to seed taste preferences: ${error.message}`, error.stack);
    }
  }

  async getAllPreferences(): Promise<TastePreference[]> {
    return this.tastePreferenceModel.find().lean();
  }
}
