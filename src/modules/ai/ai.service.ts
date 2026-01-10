import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import * as sharp from 'sharp'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { RedisService } from '../redis/redis.service'
import { StorageService } from '../storage/storage.service'
import { Recipe, RecipeDocument } from '../recipe/schemas/recipe.schema'
import { NutrientDefinition, NutrientDefinitionDocument } from '../diet/schemas/nutrient-definition.schema'
import { TemplateService } from '../template/template.service'

type Message = { role: 'user' | 'system' | 'assistant'; content: any }

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  private key = process.env.OPENROUTER_API_KEY || ''
  constructor(
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly templateService: TemplateService,
    @InjectModel(Recipe.name) private recipeModel: Model<RecipeDocument>,
    @InjectModel(NutrientDefinition.name) private nutrientDefinitionModel: Model<NutrientDefinitionDocument>
  ) { }

  private async getNutrientDefinitionsForPrompt(): Promise<Array<{ type: string; unit: string }>> {
    const cacheKey = 'nutrition:nutrient_definitions:v1'
    const cached = await this.redis.get().get(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed)) {
          return parsed
            .map((v: any) => ({ type: String(v?.type || ''), unit: String(v?.unit || '') }))
            .filter((v: any) => v.type && v.unit)
        }
      } catch (e) { }
    }

    const rows = await this.nutrientDefinitionModel
      .find({})
      .select({ type: 1, unit: 1, _id: 0 })
      .lean()
      .exec()

    const list = (rows as any[])
      .map((r) => ({ type: String(r?.type || ''), unit: String(r?.unit || '') }))
      .filter((v) => v.type && v.unit)
      .sort((a, b) => a.type.localeCompare(b.type))

    await this.redis.get().setex(cacheKey, 3600, JSON.stringify(list))
    return list
  }

  async chat(model: string, messages: Message[]) {
    console.log('ai_request', JSON.stringify(messages))
    const url = `${this.base}/chat/completions`
    const res = await axios.post(
      url,
      { model, messages },
      { headers: { Authorization: `Bearer ${this.key}` } }
    )
    console.log('ai_response', JSON.stringify(res.data))
    return res.data
  }

  async recognizeIngredientsFromImage(imageUrl: string, lang: string = 'zh') {
    const model = process.env.AI_MODEL_VISION || 'openai/gpt-4o'
    const key = `vision:ingredients:v2:${lang}:${imageUrl}`
    const cached = await this.redis.get().get(key)
    if (cached) return JSON.parse(cached)
    const systemPrompt = this.templateService.renderFromFile('ingredient-recognition.mustache', {
      isZh: lang === 'zh'
    })
    
    const userPrompt = lang === 'zh' ? '请识别图中的食材并生成 JSON 清单' : 'Please identify the ingredients in the image and generate a JSON list';

    const messages: Message[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ]
    const data = await this.chat(model, messages)
    const content = data?.choices?.[0]?.message?.content
    if (!content) return []

    try {
      let ingredients = this.parseJsonFromContent(content)

      // Convert days to date string
      if (Array.isArray(ingredients)) {
        let baseDate = new Date()
        

        ingredients = ingredients.map((item: any) => {

          if (typeof item.quantity !== 'number') {
            const parsed = Number(item.quantity)
            item.quantity = isNaN(parsed) ? 1 : parsed
          }

          if (typeof item.estimatedExpireDate !== 'number' && item.estimatedExpireDate != null) {
            const parsed = Number(item.estimatedExpireDate)
            if (!isNaN(parsed)) {
              item.estimatedExpireDate = parsed
            }
          }

          if (typeof item.estimatedExpireDate === 'number') {
            const date = new Date(baseDate)
            if (item.estimatedExpireDate === -1) {
              date.setDate(date.getDate() - 1)
            } else {
              date.setDate(date.getDate() + item.estimatedExpireDate)
            }
            const year = date.getFullYear()
            const month = String(date.getMonth() + 1).padStart(2, '0')
            const day = String(date.getDate()).padStart(2, '0')
            item.estimatedExpireDate = `${year}-${month}-${day}`
          }
          return item
        })
      }

      await this.redis.get().setex(key, 600, JSON.stringify(ingredients))
      this.logger.log('recognizeIngredientsFromImage:', ingredients)
      return ingredients
    } catch (e) {
      this.logger.error('Failed to parse ingredients', e)
      return []
    }
  }

  async generateRecipes(payload: {
    ingredientNames: string[]
    preference?: {
      spicyLevel: number
      dietaryRestrictions: string[]
      dislikedIngredients: string[]
      cookTimeMin: number
      cookTimeMax: number
    }
    count: number
  }, lang: string = 'zh') {
    const model = process.env.AI_MODEL_RECIPE || 'anthropic/claude-3.5-sonnet'
    const prompt = JSON.stringify(payload)
    const key = `recipe:processed:${lang}:${prompt}` // Changed key to avoid collision with raw data
    const cached = await this.redis.get().get(key)
    if (cached) return JSON.parse(cached)

    const systemPrompt = this.templateService.renderFromFile('recipe-gen.mustache', {
      language: lang === 'zh' ? '简体中文' : 'English',
      count: payload.count,
    })

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]
    const data = await this.chat(model, messages)
    const recipes = await this.processAiResponse(data)
    await this.redis.get().setex(key, 300, JSON.stringify(recipes))
    return recipes
  }

  async generateSurpriseRecipes(payload: {
    expiringIngredients: { name: string; quantity: number; unit: string }[]
    freshIngredients: { name: string; quantity: number; unit: string }[]
    preference?: any
    count: number
    mealType?: string
    excludedDishes?: string[]
  }, lang: string = 'zh') {
    const model = process.env.AI_MODEL_RECIPE || 'anthropic/claude-3.7-sonnet:thinking'
    
    const systemPrompt = await this.templateService.renderFromFile('recipe-surprise.mustache', {
      mealType: payload.mealType, // 可为 undefined
      excludedDishes: {
        length: (payload.excludedDishes?.length ?? 0) > 0,
        list: payload.excludedDishes?.join(', ')
      },
      count: payload.count,
      language: lang === 'zh' ? '简体中文' : 'English',
    })


    const messages: Message[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: JSON.stringify({
          mealType: payload.mealType,
          expiring: payload.expiringIngredients,
          fresh: payload.freshIngredients,
          preferences: payload.preference
        })
      }
    ]


    const data = await this.chat(model, messages)

    return this.processAiResponse(data)
  }

  async generateDailyRecommendations(payload: {
    mealType: string
    style: string
    expiringIngredients: { name: string; quantity: number; unit: string }[]
    freshIngredients: { name: string; quantity: number; unit: string }[]
    preference?: string[]
  }, lang: string = 'zh') {
    const model = process.env.AI_MODEL_RECIPE || 'anthropic/claude-3.5-sonnet'

    const systemPrompt = await this.templateService.renderFromFile('recipe-daily-recommand.mustache', {
      mealType: payload.mealType,
      style: payload.style,
      language: lang === 'zh' ? '简体中文' : 'English'
    })

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          mealType: payload.mealType,
          style: payload.style,
          expiring: payload.expiringIngredients,
          fresh: payload.freshIngredients,
          preferences: payload.preference
        })
      }
    ]

    const data = await this.chat(model, messages)
    return this.processAiResponse(data)
  }

  private async processAiResponse(data: any): Promise<any[]> {
    const text = data?.choices?.[0]?.message?.content || '[]'
    try {
      const parsed = this.parseJsonFromContent(text)

      if (!Array.isArray(parsed)) return []

      const recipes = await Promise.all(parsed.map(async (recipe: any) => {
        const id = randomUUID()
        let imageUrl = recipe.imageUrl

        try {
          if (!imageUrl) {
            // Check existing image by title to avoid duplicate generation
            const existingRecipe = await this.recipeModel.findOne({
              title: recipe.title,
              imageUrl: { $exists: true, $ne: '' }
            }).select('imageUrl').exec();

            if (existingRecipe && existingRecipe.imageUrl) {
              this.logger.log(`Found existing image for recipe: ${recipe.title}`);
              imageUrl = existingRecipe.imageUrl;
            } else {
              this.logger.log(`Generating image for recipe: ${recipe.title}`)
              const imagePrompt = `A delicious, professional food photography of ${recipe.title}, ${recipe.ingredients?.map((i: any) => i.name).join(', ')}. High resolution, appetizing lighting.`
              const imageBuffer = await this.generateImage(imagePrompt)

              if (imageBuffer) {
                const compressedBuffer = await sharp(imageBuffer)
                  .jpeg({ quality: 80 })
                  .toBuffer()

                const { url } = await this.storage.uploadBuffer(compressedBuffer, 'image/jpeg')
                imageUrl = url
                // The URL will be saved when the recipe is saved by the caller
              }
            }
          }
        } catch (err) {
          this.logger.error(`Failed to generate image for ${recipe.title}`, err)
        }

        return {
          ...recipe,
          id,
          imageUrl
        }
      }))

      return recipes
    } catch (e) {
      this.logger.error('Failed to parse AI response', e)
      return []
    }
  }

  async generateImage(prompt: string): Promise<Buffer | null> {
    try {
      const model = process.env.AI_MODEL_IMAGE || 'google/gemini-2.0-flash-001'

      // OpenRouter Image Generation (e.g. Gemini, etc.)
      // Doc: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
      const url = `${this.base}/chat/completions`
      const messages = [{ role: 'user', content: prompt }]

      console.log('Generating image with OpenRouter:', model, prompt);

      const res = await axios.post(
        url,
        {
          model,
          messages,
          modalities: ['image', 'text'],
          image_config: {
            aspect_ratio: '1:1',
          }
        },
        { headers: { Authorization: `Bearer ${this.key}` } }
      )

      // Check for OpenRouter/Gemini style image response
      const message = res.data?.choices?.[0]?.message
      if (message?.images?.length > 0) {
        const dataUrl = message.images[0].image_url.url // e.g. "data:image/png;base64,..."
        const base64Data = dataUrl.split(';base64,').pop()
        if (base64Data) {
          return Buffer.from(base64Data, 'base64')
        }
      }

      console.log('No image in response:', JSON.stringify(res.data, null, 2))
      return null
    } catch (e) {
      console.error('Failed to generate image', e)
      return null
    }
  }

  async analyzeNutrition(ingredients: { name: string; amount: number; unit: string }[]): Promise<any> {
    const model = process.env.AI_MODEL_NUTRITION || 'openai/gpt-4o-mini'
    const nutrients = await this.getNutrientDefinitionsForPrompt()
    
    const systemPrompt = this.templateService.renderFromFile('nutrition-recognition.mustache', {
      types: nutrients.map((n) => n.type).join(', '),
      units: nutrients.map((n) => `  - ${n.type}: ${n.unit}`).join('\n')
    })

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(ingredients) }
    ]

    const data = await this.chat(model, messages)
    const content = data?.choices?.[0]?.message?.content
    if (!content) return { totalCalories: 0, nutritionInfo: [] }

    try {
      const parsed = this.parseJsonFromContent(content)
      //macronutrient：carbohydrate, protein, fat
      //vitamins：vitamin_a, vitamin_d, vitamin_c, vitamin_e, vitamin_k, vitamin_b
      //minerals：calcium, magnesium, sodium, phosphorus, iron, zinc, copper, manganese, salt
      //fiber: fiber
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { totalCalories: 0, nutritionInfo: [] }

      const nutritionInfo = (parsed as any).nutritionInfo
      if (!Array.isArray(nutritionInfo)) {
        return {
          ...(parsed as any),
          totalCalories: Number((parsed as any).totalCalories) || 0,
          nutritionInfo: [],
        }
      }

      const first = nutritionInfo[0]
      const isAlreadyGrouped =
        first &&
        typeof first === 'object' &&
        !Array.isArray(first) &&
        typeof (first as any).category === 'string' &&
        Array.isArray((first as any).nutritionInfo)

      if (isAlreadyGrouped) {
        return {
          ...(parsed as any),
          totalCalories: Number((parsed as any).totalCalories) || 0,
        }
      }

      return {
        ...(parsed as any),
        totalCalories: Number((parsed as any).totalCalories) || 0,
        nutritionInfo,
      }
    } catch (e) {
      this.logger.error('Failed to parse nutrition response', e)
      return { totalCalories: 0, nutritionInfo: [] }
    }
  }

  async calculateMissingIngredients(
    recipeIngredients: { name: string; amount: number; unit: string }[],
    pantryItems: { name: string; quantity: number; unit: string }[],
    lang: string = 'zh'
  ): Promise<{ name: string; requiredAmount: number; unit: string }[]> {
    const model = process.env.AI_MODEL_MISSING_INGREDIENTS || 'qwen/qwen-2.5-vl-7b-instruct:free'

    const systemPrompt = this.templateService.renderFromFile('ingredient-miss-recognition.mustache', { isZh: lang === 'zh' })

    const userPrompt = JSON.stringify({
      recipeIngredients,
      pantryItems
    });

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const data = await this.chat(model, messages);
    const content = data?.choices?.[0]?.message?.content;
    
    if (!content) return [];

    try {
      const result = this.parseJsonFromContent(content);
      if (Array.isArray(result)) {
        return result.map(item => ({
          name: String(item.name),
          requiredAmount: Number(item.requiredAmount) || 0,
          unit: String(item.unit)
        }));
      }
      return [];
    } catch (e) {
      this.logger.error('Failed to parse missing ingredients response', e);
      return [];
    }
  }
  private parseJsonFromContent(content: string): any {
    // 1. Try to find the JSON block using braces/brackets (most robust for single object/array)
    const firstOpenBrace = content.indexOf('{')
    const firstOpenBracket = content.indexOf('[')
    let start = -1

    if (firstOpenBrace !== -1 && firstOpenBracket !== -1) {
      start = Math.min(firstOpenBrace, firstOpenBracket)
    } else if (firstOpenBrace !== -1) {
      start = firstOpenBrace
    } else if (firstOpenBracket !== -1) {
      start = firstOpenBracket
    }

    if (start !== -1) {
      const lastCloseBrace = content.lastIndexOf('}')
      const lastCloseBracket = content.lastIndexOf(']')
      const end = Math.max(lastCloseBrace, lastCloseBracket)

      if (end > start) {
        try {
          const jsonStr = content.substring(start, end + 1)
          return JSON.parse(jsonStr)
        } catch (e) {
          // Ignore error and try next method
        }
      }
    }

    // 2. Try regex for markdown code blocks
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      try {
        return JSON.parse(match[1])
      } catch (e) {
        // Ignore
      }
    }

    // 3. Fallback to original cleanup
    return JSON.parse(content.replace(/```json\n?|\n?```/g, ''))
  }
}
