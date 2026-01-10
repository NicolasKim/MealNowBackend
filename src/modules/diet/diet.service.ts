import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { AiService } from '../ai/ai.service'
import { RedisService } from '../redis/redis.service'
import { Recipe } from '../recipe/schemas/recipe.schema'
import { DietEntry, DietEntryDocument } from './schemas/diet-entry.schema'
import { NutrientDefinition, NutrientDefinitionDocument } from './schemas/nutrient-definition.schema'

@Injectable()
export class DietService {
  constructor(
    @InjectModel(DietEntry.name) private readonly dietEntryModel: Model<DietEntryDocument>,
    @InjectModel(Recipe.name) private readonly recipeModel: Model<Recipe>,
    @InjectModel(NutrientDefinition.name) private readonly nutrientDefinitionModel: Model<NutrientDefinitionDocument>,
    private readonly ai: AiService,
    private readonly redis: RedisService
  ) {}

  private async getNutrientDefinitionMap() {
    const cacheKey = 'diet:nutrient_definitions:v2'
    const cached = await this.redis.get().get(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed)) {
          const map = new Map<string, any>()
          for (const row of parsed) {
            const type = String(row?.type || '')
            if (!type) continue
            map.set(type, row)
          }
          return map
        }
      } catch (e) {}
    }

    const rows = await this.nutrientDefinitionModel
      .find({})
      .select({
        type: 1,
        category: 1,
        categoryOrder: 1,
        typeOrder: 1,
        categoryName: 1,
        name: 1,
        unit: 1,
        lowerRecommendedIntake: 1,
        upperRecommendedIntake: 1,
        _id: 0,
      })
      .lean()
      .exec()

    await this.redis.get().setex(cacheKey, 3600, JSON.stringify(rows))

    const map = new Map<string, any>()
    for (const row of rows as any[]) {
      const type = String(row?.type || '')
      if (!type) continue
      map.set(type, row)
    }
    return map
  }

  private async enrichNutritionWithSeed(nutrition: any, lang: string) {
    if (!nutrition || typeof nutrition !== 'object') return nutrition

    const map = await this.getNutrientDefinitionMap()
    return this.enrichNutritionWithSeedUsingMap(nutrition, lang, map)
  }

  private enrichNutritionWithSeedUsingMap(nutrition: any, lang: string, map: Map<string, any>) {
    if (!nutrition || typeof nutrition !== 'object') return nutrition
    const raw = (nutrition as any).nutritionInfo
    if (!Array.isArray(raw)) return nutrition

    const first = raw[0]
    const isGrouped =
      first && typeof first === 'object' && !Array.isArray(first) && typeof (first as any).category === 'string' && Array.isArray((first as any).nutritionInfo)

    const localizeName = (def: any) => {
      const v = def?.name
      if (v && typeof v === 'object') {
        const byLang = (v as any)[lang]
        if (typeof byLang === 'string' && byLang) return byLang
        const en = (v as any).en
        if (typeof en === 'string' && en) return en
        const zh = (v as any).zh
        if (typeof zh === 'string' && zh) return zh
      }
      return undefined
    }

    const enrichItem = (item: any) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item
      const type = String(item.type || '')
      if (!type) return item

      const def = map.get(type)
      if (!def) return item

      const name = localizeName(def)
      return {
        ...item,
        name: name ?? item.name,
        unit: def.unit ?? item.unit,
        lowerRecommendedIntake:
          def.lowerRecommendedIntake != null ? Number(def.lowerRecommendedIntake) || 0 : item.lowerRecommendedIntake,
        upperRecommendedIntake:
          def.upperRecommendedIntake != null ? Number(def.upperRecommendedIntake) || 0 : item.upperRecommendedIntake,
        category: def.category ?? item.category,
        categoryName: def.categoryName ?? item.categoryName,
      }
    }

    if (!isGrouped) {
      return {
        ...(nutrition as any),
        nutritionInfo: raw.map(enrichItem),
      }
    }

    return {
      ...(nutrition as any),
      nutritionInfo: raw.map((group: any) => {
        const items = Array.isArray(group?.nutritionInfo) ? group.nutritionInfo : []
        return {
          ...group,
          nutritionInfo: items.map(enrichItem),
        }
      }),
    }
  }

  private async enrichEntriesWithSeed(entries: any[], lang: string) {
    if (!Array.isArray(entries) || !entries.length) return entries
    const map = await this.getNutrientDefinitionMap()
    return entries.map((e: any) => {
      const enriched = this.enrichNutritionWithSeedUsingMap(e?.nutrition, lang, map)
      if (enriched === e?.nutrition) return e
      return { ...e, nutrition: enriched }
    })
  }

  async getEntries(userId: string, dateFrom: string, dateTo: string) {
    const entries = await this.dietEntryModel
      .find({ user: userId, date: { $gte: dateFrom, $lte: dateTo } })
      .sort({ date: -1, createdAt: -1 })
      .lean()
      .exec()

    const enriched = await this.enrichEntriesWithSeed(entries as any[], 'zh')
    return enriched.map((e: any) => ({ ...e, id: e._id?.toString?.() ?? String(e._id) }))
  }

  async getEntriesByDate(userId: string, date: string) {
    const entries = await this.dietEntryModel
      .find({ user: userId, date })
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    const enriched = await this.enrichEntriesWithSeed(entries as any[], 'zh')
    return enriched.map((e: any) => ({ ...e, id: e._id?.toString?.() ?? String(e._id) }))
  }

  async getEntriesByMeal(userId: string, date: string, mealType: string) {
    const entries = await this.dietEntryModel
      .find({ user: userId, date, mealType })
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    const enriched = await this.enrichEntriesWithSeed(entries as any[], 'zh')
    return enriched.map((e: any) => ({ ...e, id: e._id?.toString?.() ?? String(e._id) }))
  }

  async getNutritionByDate(userId: string, date: string, lang: string = 'zh') {
    const entries = await this.dietEntryModel.find({ user: userId, date }).lean().exec()
    const map = await this.getNutrientDefinitionMap()
    const nutrition = await this.aggregateNutritionFromEntries(entries as any[])
    const enriched = this.enrichNutritionWithSeedUsingMap(nutrition, lang, map)
    return this.groupNutritionInfoByCategory(enriched, map)
  }

  async getNutritionByMeal(userId: string, date: string, mealType: string, lang: string = 'zh') {
    const entries = await this.dietEntryModel.find({ user: userId, date, mealType }).lean().exec()
    const map = await this.getNutrientDefinitionMap()
    const nutrition = await this.aggregateNutritionFromEntries(entries as any[])
    const enriched = this.enrichNutritionWithSeedUsingMap(nutrition, lang, map)
    return this.groupNutritionInfoByCategory(enriched, map)
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

  private async aggregateNutritionFromEntries(entries: any[]) {
    const totalsByType = new Map<
      string,
      {
        type: string
        name?: string
        amount: number
        unit?: string
        upperRecommendedIntake?: number
        lowerRecommendedIntake?: number
      }
    >()

    let totalCalories = 0

    for (const entry of entries) {
      const nutrition = entry?.nutrition
      if (!nutrition || typeof nutrition !== 'object') continue

      totalCalories += Number(nutrition?.totalCalories) || 0

      const list = this.flattenNutritionItems(nutrition)
      for (const item of list) {
        const type = String(item?.type || '')
        if (!type) continue

        const amount = Number(item?.amount) || 0
        const existing = totalsByType.get(type)
        if (existing) {
          existing.amount += amount
          if (!existing.name && item?.name) existing.name = String(item.name)
          if (!existing.unit && item?.unit) existing.unit = String(item.unit)
          if (existing.upperRecommendedIntake == null && item?.upperRecommendedIntake != null) {
            existing.upperRecommendedIntake = Number(item.upperRecommendedIntake) || 0
          }
          if (existing.lowerRecommendedIntake == null && item?.lowerRecommendedIntake != null) {
            existing.lowerRecommendedIntake = Number(item.lowerRecommendedIntake) || 0
          }
        } else {
          totalsByType.set(type, {
            type,
            name: item?.name != null ? String(item.name) : undefined,
            amount,
            unit: item?.unit != null ? String(item.unit) : undefined,
            upperRecommendedIntake:
              item?.upperRecommendedIntake != null ? Number(item.upperRecommendedIntake) || 0 : undefined,
            lowerRecommendedIntake:
              item?.lowerRecommendedIntake != null ? Number(item.lowerRecommendedIntake) || 0 : undefined,
          })
        }
      }
    }

    return {
      totalCalories,
      nutritionInfo: Array.from(totalsByType.values()),
    }
  }

  private groupNutritionInfoByCategory(nutrition: any, defMap?: Map<string, any>) {
    if (!nutrition || typeof nutrition !== 'object') return nutrition

    const raw = (nutrition as any).nutritionInfo
    if (!Array.isArray(raw)) return nutrition

    const first = raw[0]
    const isGrouped =
      first &&
      typeof first === 'object' &&
      !Array.isArray(first) &&
      typeof (first as any).category === 'string' &&
      Array.isArray((first as any).nutritionInfo)

    type CategoryGroup = { category: string; categoryName?: any; nutritionInfo: any[] }
    const byCategory = new Map<string, CategoryGroup>()
    const ensure = (category: string): CategoryGroup => {
      const key = category || 'macronutrient'
      const existing = byCategory.get(key)
      if (existing) return existing
      const created: CategoryGroup = { category: key, nutritionInfo: [] as any[] }
      byCategory.set(key, created)
      return created
    }

    if (!isGrouped) {
      for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const category = String((item as any).category || 'macronutrient')
        const g = ensure(category)
        if (g.categoryName == null && (item as any).categoryName != null) g.categoryName = (item as any).categoryName
        g.nutritionInfo.push(item)
      }
    } else {
      for (const group of raw) {
        const fallbackCategory = String((group as any)?.category || '')
        const items = Array.isArray((group as any)?.nutritionInfo) ? (group as any).nutritionInfo : []
        for (const item of items) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue
          const category = String((item as any).category || fallbackCategory || 'macronutrient')
          const g = ensure(category)
          if (g.categoryName == null && (item as any).categoryName != null) g.categoryName = (item as any).categoryName
          g.nutritionInfo.push(item)
        }
      }
    }

    const defaultCategoryOrder: Record<string, number> = {
      macronutrient: 1,
      vitamins: 2,
      minerals: 3,
      fiber: 4,
    }

    const getTypeOrder = (item: any) => {
      const type = String(item?.type || '')
      if (!type || !defMap) return 999
      const v = defMap.get(type)?.typeOrder
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : 999
    }

    const getCategoryOrder = (g: CategoryGroup) => {
      const byCategory = defaultCategoryOrder[g.category]
      if (!defMap) return byCategory ?? 999
      const items = Array.isArray(g?.nutritionInfo) ? g.nutritionInfo : []
      for (const item of items) {
        const type = String(item?.type || '')
        if (!type) continue
        const v = defMap.get(type)?.categoryOrder
        const n = typeof v === 'number' ? v : Number(v)
        if (Number.isFinite(n)) return n
      }
      return byCategory ?? 999
    }

    const groups = Array.from(byCategory.values())
      .filter((g) => Array.isArray(g.nutritionInfo) && g.nutritionInfo.length > 0)
      .map((g) => ({
        ...g,
        nutritionInfo: [...g.nutritionInfo].sort((a: any, b: any) => {
          const oa = getTypeOrder(a)
          const ob = getTypeOrder(b)
          if (oa !== ob) return oa - ob
          return String(a?.type || '').localeCompare(String(b?.type || ''))
        }),
      }))
      .sort((a, b) => {
        const oa = getCategoryOrder(a)
        const ob = getCategoryOrder(b)
        if (oa !== ob) return oa - ob
        return a.category.localeCompare(b.category)
      })

    return {
      ...(nutrition as any),
      nutritionInfo: groups,
    }
  }

  private flattenNutritionItems(nutrition: any) {
    const raw = nutrition?.nutritionInfo
    if (!Array.isArray(raw)) return []
    const first = raw[0]
    const isGrouped =
      first && typeof first === 'object' && !Array.isArray(first) && typeof first.category === 'string' && Array.isArray(first.nutritionInfo)

    if (!isGrouped) return raw

    const out: any[] = []
    for (const group of raw) {
      const items = group?.nutritionInfo
      if (!Array.isArray(items)) continue
      for (const item of items) out.push(item)
    }
    return out
  }

  async logRecipeNutrition(userId: string, recipeId: string, date: string, mealType: string, lang: string) {
    let ingredientsSource: any[] = []

    const recipe = await this.recipeModel.findById(recipeId).exec()
    if (recipe?.ingredients?.length) {
      ingredientsSource = recipe.ingredients as any[]
    } else {
      const today = new Date().toISOString().split('T')[0]
      const mealTypes = ['breakfast', 'lunch', 'dinner']
      let recipeData: any = null

      for (const mt of mealTypes) {
        const key = `recommendation:public:${lang}:${today}:${mt}`
        const cached = await this.redis.get().get(key)
        if (!cached) continue

        const recipes = JSON.parse(cached)
        if (!Array.isArray(recipes)) continue

        const found = recipes.find((r: any) => r?.id === recipeId || r?._id === recipeId)
        if (found) {
          recipeData = found
          break
        }
      }

      if (!recipeData) {
        const legacyKey = `recipe:${userId}:${recipeId}`
        const cached = await this.redis.get().get(legacyKey)
        if (cached) recipeData = JSON.parse(cached)
      }

      if (recipeData?.ingredients?.length) {
        ingredientsSource = recipeData.ingredients
      }
    }

    if (!ingredientsSource.length) throw new NotFoundException('Recipe not found')

    const ingredients = ingredientsSource
      .map((ing: any) => {
        const amountRaw = ing.amount ?? ing.quantity
        const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw)
        const unit = ing.unit || ''
        if (!ing?.name || !Number.isFinite(amount) || !unit) return null
        return { name: String(ing.name), amount, unit: String(unit) }
      })
      .filter(Boolean) as { name: string; amount: number; unit: string }[]

    const nutritionRaw = await this.ai.analyzeNutrition(ingredients)

    const entry = await this.dietEntryModel.create({
      user: userId,
      date,
      mealType,
      recipeId,
      nutrition: nutritionRaw,
    })

    const out = { ...entry.toObject(), id: entry._id.toString() }
    out.nutrition = await this.enrichNutritionWithSeed(out.nutrition, lang)
    return out
  }
}
