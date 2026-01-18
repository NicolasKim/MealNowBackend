import { Injectable, NotFoundException, Inject } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { RedisPubSub } from 'graphql-redis-subscriptions'
import { PUB_SUB } from '../../common/pubsub.module'
import { AiService } from '../ai/ai.service'
import { RedisService } from '../redis/redis.service'
import { Recipe } from '../recipe/schemas/recipe.schema'
import { DietEntry, DietEntryDocument, DietNutritionItem } from './schemas/diet-entry.schema'
import { DietLimit, DietLimitDocument } from './schemas/diet-limit.schema'
import { User, UserDocument } from '../auth/schemas/user.schema'
import { NutrientDefinition, NutrientDefinitionDocument } from '../food/schemas/nutrient-definition.schema'
import { FoodService } from '../food/food.service'


@Injectable()
export class DietService {
  constructor(
    @InjectModel(DietEntry.name) private readonly dietEntryModel: Model<DietEntryDocument>,
    @InjectModel(Recipe.name) private readonly recipeModel: Model<Recipe>,
    @InjectModel(DietLimit.name) private readonly dietLimitModel: Model<DietLimitDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(PUB_SUB) private readonly pubSub: RedisPubSub,
    private readonly aiService: AiService,
    private readonly foodService: FoodService,
  ) {}

  async generateDietLimits(userId: string, profileInput?: any) {
    // 1. Update User Profile if input provided
    let user = await this.userModel.findById(userId)
    if (!user) throw new NotFoundException('User not found')
    
    if (profileInput) {
      if (profileInput.height) user.height = profileInput.height
      if (profileInput.weight) user.weight = profileInput.weight
      if (profileInput.gender) user.gender = profileInput.gender
      if (profileInput.specialPeriods) user.specialPeriods = profileInput.specialPeriods
      if (profileInput.chronicDiseases) user.chronicDiseases = profileInput.chronicDiseases
      
      if (user.isModified()) {
          await user.save()
      } else {
          return [];
      }
    }

    // 2. Prepare Nutrients
    const nutrientDefs = await this.foodService.getAllNutrientDefinitions()
    // Extract English names for AI prompt
    const targetNutrients = nutrientDefs.map(d => ({
        name: d.name['en'] || d.type, 
        unit: d.unit
    }));
    
    const totalSteps = targetNutrients.length + 1

    // Notify Start
    this.pubSub.publish('dietLimitGenerationProgress', {
       dietLimitGenerationProgress: { status: 'PENDING', message: 'Starting analysis...', step: 0, totalSteps }
    })

    // 3. Process Each Nutrient
    const finalLimits: any[] = []
    const defMap = new Map<string, number>()
    nutrientDefs.forEach(d => {
       defMap.set(d.name['en']?.toLowerCase(), d.nutritionId)
       defMap.set(d.type.toLowerCase(), d.nutritionId) 
    })

    // Start async generation in background
    this.generateDietLimitsAsync(userId, nutrientDefs, finalLimits);

    // Return list of nutrients to be generated
    return nutrientDefs;
  }

  private async generateDietLimitsAsync(userId: string, nutrientDefs: any[], finalLimits: any[]) {
    let step = 0;
    const totalSteps = nutrientDefs.length + 1;
    
    // Need user data for AI
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) return;
    
    const lang = user.language || 'en';

    // Loop through nutrients one by one
    for (const nutrientDef of nutrientDefs) {
       const nutrientName = nutrientDef.name[lang] || nutrientDef.name['en'] || nutrientDef.type;
       const nutrientUnit = nutrientDef.unit;
       
       // Publish Processing status
       await this.pubSub.publish('dietLimitGenerationProgress', {
          dietLimitGenerationProgress: { 
            nutrient: nutrientDef.nutritionId, 
            status: 'PROCESSING', 
            message: `Generating limit for ${nutrientName}`,
            step: step + 1, 
            totalSteps,
            result: {
                nutritionId: nutrientDef.nutritionId,
                min: 0,
                max: 0,
                unit: nutrientUnit
            }
          }
       })

       try {
         // Call AI for SINGLE nutrient
         const aiResult = await this.aiService.generateDietLimits({
            height: user.height,
            weight: user.weight,
            gender: user.gender,
            specialPeriods: user.specialPeriods,
            chronicDiseases: user.chronicDiseases,
         }, [{ name: nutrientName, unit: nutrientUnit }]) // Single item array

         // Process result
         if (aiResult && aiResult.length > 0) {
            const l = aiResult[0];
            const id = nutrientDef.nutritionId;
            
            const limitResult = {
              nutritionId: id,
              min: l.min,
              max: l.max,
              unit: nutrientUnit
            };

            finalLimits.push(limitResult)

            await this.pubSub.publish('dietLimitGenerationProgress', {
              dietLimitGenerationProgress: { 
                nutrient: nutrientDef.nutritionId, 
                status: 'COMPLETED', 
                message: `Generated limit for ${nutrientName}`,
                step: step + 1, 
                totalSteps,
                result: limitResult
              }
           })
         } else {
            throw new Error('No result generated');
         }
       } catch (e: any) {
         console.error(`Failed to generate limit for ${nutrientName}`, e);
         await this.pubSub.publish('dietLimitGenerationProgress', {
            dietLimitGenerationProgress: { 
              nutrient: nutrientDef.nutritionId, 
              status: 'FAILED', 
              message: `Failed: ${e.message}`,
              step: step + 1, 
              totalSteps 
            }
         })
       }
       
       step++;
    }

    // 4. Save All Results
    await this.dietLimitModel.findOneAndUpdate(
      { user: userId },
      { user: userId, limits: finalLimits },
      { upsert: true, new: true }
    )

    this.pubSub.publish('dietLimitGenerationProgress', {
        dietLimitGenerationProgress: { status: 'ALL_COMPLETED', message: 'Generation Complete', step: totalSteps, totalSteps }
    })
  }

  private async aggregateNutrition(entries: DietEntryDocument[], userId?: string): Promise<DietNutritionItem[]> {
    const nutrientTotals = new Map<number, { def: NutrientDefinition; value: number }>()

    const allDefs = await this.foodService.getAllNutrientDefinitions()
    const defMap = new Map<number, NutrientDefinition>()
    for (const d of allDefs) {
      defMap.set(d.nutritionId, d)
    }

    for (const entry of entries) {
      if (!entry.nutritions) continue
      for (const item of entry.nutritions) {
        const def = defMap.get(item.nutritionId)
        if (!def) continue

        if (nutrientTotals.has(item.nutritionId)) {
          nutrientTotals.get(item.nutritionId)!.value += item.value
        } else {
          nutrientTotals.set(item.nutritionId, { def, value: item.value })
        }
      }
    }

    // Load limits if userId is provided
    let userLimits = new Map<number, { min: number; max: number }>();
    if (userId) {
        const limits = await this.dietLimitModel.findOne({ user: userId }).lean().exec();
        if (limits && limits.limits) {
            limits.limits.forEach(l => {
                userLimits.set(l.nutritionId, { min: l.min, max: l.max });
            });
        }
    }

    const nutritions = Array.from(nutrientTotals.values()).map(({ def, value }) => {
      const limit = userLimits.get(def.nutritionId);
      return {
        ...def,
        value,
        min: limit?.min,
        max: limit?.max
      };
    })

    // Sort by category and type order
    nutritions.sort((a, b) => {
      if (a.categoryOrder !== b.categoryOrder) return a.categoryOrder - b.categoryOrder
      return a.typeOrder - b.typeOrder
    })

    return nutritions
  }

  async getNutritionByDate(userId: string, date: string): Promise<DietNutritionItem[]> {
    const entries = await this.dietEntryModel.find({ user: userId, date }).lean().exec()
    return this.aggregateNutrition(entries as unknown as DietEntryDocument[], userId)
  }

  async getNutritionByMeal(userId: string, date: string, mealType: string): Promise<DietNutritionItem[]> {
    const entries = await this.dietEntryModel.find({ user: userId, date, mealType }).lean().exec()
    return this.aggregateNutrition(entries as unknown as DietEntryDocument[], userId)
  }

  async getMealStatus(userId: string, dateFrom: string, dateTo: string) {
    const rows = await this.dietEntryModel
      .find({ user: userId, date: { $gte: dateFrom, $lte: dateTo } })
      .select({ date: 1, mealType: 1 })
      .lean()
      .exec()

    const byDate = new Map<string, Set<string>>()
    for (const r of rows as any[]) {
      const date = String(r?.date || '')
      const mealType = String(r?.mealType || '')
      if (!date || !mealType) continue
      const set = byDate.get(date) || new Set<string>()
      set.add(mealType)
      byDate.set(date, set)
    }

    const out = Array.from(byDate.entries()).map(([date, meals]) => ({
      date,
      meals: Array.from(meals.values()),
    }))

    out.sort((a, b) => a.date.localeCompare(b.date))
    return out
  }


  async logRecipeNutrition(
    userId: string,
    recipeId: string,
    date: string,
    mealType: string,
    lang: string,
  ): Promise<DietEntryDocument> {


    const recipe = await this.recipeModel.findById(recipeId).exec()
    if (!recipe) throw new NotFoundException('Recipe not found')
    let ingredients = recipe.ingredients || []
    
    // Get standardized ingredient info
    const foodPromises = ingredients.map(async (ingredient) => {
      try {
        const food = await this.foodService.foodInfo(ingredient.name);
        return { ingredient, food };
      } catch (e) {
        return { ingredient, food: null };
      }
    });

    const results = await Promise.all(foodPromises);
    const nutrients = await this.foodService.getAllNutrientDefinitions()
    const nutrientTotals = new Map<number, { def: NutrientDefinition; value: number }>()

    // Initialize all nutrients with 0 value
    for (const n of nutrients) {
      nutrientTotals.set(n.nutritionId, { def: n, value: 0 })
    }

    for (const { ingredient, food } of results) {
      if (!food || !food.nutrients) continue

      for (const n of food.nutrients) {
        if (!nutrientTotals.has(n.nutrientId)) continue

        // Calculate value based on 100g standard
        // n.value is per 100g
        const value = (n.value / 100) * (ingredient.amount || 0)

        nutrientTotals.get(n.nutrientId)!.value += value
      }
    }

    const nutritions = Array.from(nutrientTotals.values()).map(({ def, value }) => ({
      ...def,
      value,
    }))

    const entry = new this.dietEntryModel({
      user: userId,
      date,
      mealType,
      recipeId,
      nutritions,
    })

    return entry.save()
  }
}
