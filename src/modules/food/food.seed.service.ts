import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { NutrientDefinition, NutrientDefinitionDocument } from './schemas/nutrient-definition.schema'

@Injectable()
export class FoodSeedService implements OnModuleInit {
  private readonly logger = new Logger(FoodSeedService.name)

  private readonly NUTRIENT_DEFINITIONS: Array<Partial<NutrientDefinition>> = [
    {
      nutritionIds: [1008],
      type: 'energy',
      category: 'energy',
      categoryName: { zh: '热量', en: 'Energy' },
      name: { zh: '热量', en: 'Energy' },
      unit: 'kcal',
      categoryOrder: 1,
      typeOrder: 1,
      dailyValue: 2000
    },
    {
      nutritionIds: [1085],
      type: 'fat',
      category: 'macronutrients',
      categoryName: { zh: '宏量营养素', en: 'Macronutrients' },
      name: { zh: '脂肪', en: 'Fat' },
      unit: 'g',
      categoryOrder: 2,
      typeOrder: 1,
      dailyValue: 78
    },
    {
      nutritionIds: [1050,1005],
      type: 'carbohydrate',
      category: 'macronutrients',
      categoryName: { zh: '宏量营养素', en: 'Macronutrients' },
      name: { zh: '碳水', en: 'Carbohydrate' },
      unit: 'g',
      categoryOrder: 2,
      typeOrder: 2,
      dailyValue: 275
    },
    {
      nutritionIds: [1003],
      type: 'protein',
      category: 'macronutrients',
      categoryName: { zh: '宏量营养素', en: 'Macronutrients' },
      name: { zh: '蛋白质', en: 'Protein' },
      unit: 'g',
      categoryOrder: 2,
      typeOrder: 3,
      dailyValue: 50
    },
    {
      nutritionIds: [1079],
      type: 'dietary_fiber',
      category: 'macronutrients',
      categoryName: { zh: '宏量营养素', en: 'Macronutrients' },
      name: { zh: '膳食纤维', en: 'Dietary Fiber' },
      unit: 'g',
      categoryOrder: 2,
      typeOrder: 4,
      dailyValue: 28
    },

    {
      nutritionIds: [1106],
      type: 'vitamin_a',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素A', en: 'Vitamin A' },
      unit: 'ug',
      categoryOrder: 3,
      typeOrder: 1,
      dailyValue: 900
    },
    {
      nutritionIds: [1165],
      type: 'vitamin_b1',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素B1', en: 'Vitamin B1' },
      unit: 'mg',
      categoryOrder: 3,
      typeOrder: 2,
      dailyValue: 1.2
    },
    {
      nutritionIds: [1166],
      type: 'vitamin_b2',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素B2', en: 'Vitamin B2' },
      unit: 'mg',
      categoryOrder: 3,
      typeOrder: 3,
      dailyValue: 1.3
    },
    {
      nutritionIds: [1167],
      type: 'vitamin_b3',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素B3', en: 'Vitamin B3' },
      unit: 'mg',
      categoryOrder: 3,
      typeOrder: 4,
      dailyValue: 16
    },
    {
      nutritionIds: [1170],
      type: 'vitamin_b5',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素B5', en: 'Vitamin B5' },
      unit: 'mg',
      categoryOrder: 3,
      typeOrder: 5,
      dailyValue: 1.2 //TODO
    },
    {
      nutritionIds: [1175],
      type: 'vitamin_b6',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素B6', en: 'Vitamin B6' },
      unit: 'mg',
      categoryOrder: 3,
      typeOrder: 6,
      dailyValue: 1.7
    },
    {
      nutritionIds: [1177],
      type: 'vitamin_b9',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '叶酸', en: 'Vitamin B9 (Folate)' },
      unit: 'ug',
      categoryOrder: 3,
      typeOrder: 7,
      dailyValue: 400
    },
    {
      nutritionIds: [1178],
      type: 'vitamin_b12',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素B12', en: 'Vitamin B12' },
      unit: 'ug',
      categoryOrder: 3,
      typeOrder: 8,
      dailyValue: 2.4
    },
    {
      nutritionIds: [1162],
      type: 'vitamin_c',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素C', en: 'Vitamin C' },
      unit: 'mg',
      categoryOrder: 3,
      typeOrder: 9,
      dailyValue: 90
    },
    {
      nutritionIds: [1109],
      type: 'vitamin_e',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素E', en: 'Vitamin E' },
      unit: 'mg',
      categoryOrder: 3,
      typeOrder: 10,
      dailyValue: 15
    },
    {
      nutritionIds: [1184],
      type: 'vitamin_k',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素K1', en: 'Vitamin K1' },
      unit: 'ug',
      categoryOrder: 3,
      typeOrder: 11,
      dailyValue: 120
    },
    {
      nutritionIds: [1114],
      type: 'vitamin_d',
      category: 'vitamins',
      categoryName: { zh: '维生素', en: 'Vitamins' },
      name: { zh: '维生素D', en: 'Vitamin D' },
      unit: 'ug',
      categoryOrder: 3,
      typeOrder: 13,
      dailyValue: 20
    },
    {
      nutritionIds: [1087],
      type: 'calcium',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '钙', en: 'Calcium' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 1,
      dailyValue: 1300
    },
    {
      nutritionIds: [1092],
      type: 'potassium',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '钾', en: 'Potassium' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 2,
      dailyValue: 4700
    },
    {
      nutritionIds: [1095],
      type: 'zinc',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '锌', en: 'Zinc' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 3,
      dailyValue: 11
    },
    {
      nutritionIds: [1103],
      type: 'selenium',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '硒', en: 'Selenium' },
      unit: 'ug',
      categoryOrder: 4,
      typeOrder: 4,
      dailyValue: 55
    },
    {
      nutritionIds: [1089],
      type: 'iron',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '铁', en: 'Iron' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 5,
      dailyValue: 18
    },
    {
      nutritionIds: [1090],
      type: 'magnesium',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '镁', en: 'Magnesium' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 6,
      dailyValue: 420
    },
    {
      nutritionIds: [1091],
      type: 'phosphorus',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '磷', en: 'Phosphorus' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 7,
      dailyValue: 1250
    },
    {
      nutritionIds: [1093],
      type: 'sodium',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '钠', en: 'Sodium' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 8,
      dailyValue: 2300
    },
    {
      nutritionIds: [1098],
      type: 'copper',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '铜', en: 'Copper' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 9,
      dailyValue: 0.9
    },
    {
      nutritionIds: [1101],
      type: 'manganese',
      category: 'minerals',
      categoryName: { zh: '矿物质', en: 'Minerals' },
      name: { zh: '锰', en: 'Manganese' },
      unit: 'mg',
      categoryOrder: 4,
      typeOrder: 10,
      dailyValue: 2.3
    },
  ]

  constructor(
    @InjectModel(NutrientDefinition.name)
    private readonly nutrientDefinitionModel: Model<NutrientDefinitionDocument>
  ) {}

  async onModuleInit() {
    await this.seedNutrients()
  }

  private async seedNutrients() {
    try {
      const operations = this.NUTRIENT_DEFINITIONS.map((n) => ({
        updateOne: {
          filter: { type: n.type },
          update: { $set: n },
          upsert: true,
        },
      }))

      await this.nutrientDefinitionModel.bulkWrite(operations)
      this.logger.log(`Nutrient definitions seeded/updated: ${this.NUTRIENT_DEFINITIONS.length}`)
    } catch (error: any) {
      this.logger.error(`Failed to seed nutrient definitions: ${error?.message || String(error)}`, error?.stack)
    }
  }
}
