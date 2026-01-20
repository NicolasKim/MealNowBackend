import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import * as sharp from 'sharp'
import axios from 'axios'
import { Pinecone } from '@pinecone-database/pinecone'
import { randomUUID } from 'crypto'
import { RedisService } from '../redis/redis.service'
import { StorageService } from '../storage/storage.service'
import { Recipe, RecipeDocument } from '../recipe/schemas/recipe.schema'
import { NutrientDefinition, NutrientDefinitionDocument } from '../food/schemas/nutrient-definition.schema'
import { TemplateService } from '../template/template.service'

type Message = { role: 'user' | 'system' | 'assistant'; content: any }

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  private key = process.env.OPENROUTER_API_KEY || ''
  private pinecone: Pinecone | null = null

  constructor(
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly templateService: TemplateService,
    @InjectModel(Recipe.name) private recipeModel: Model<RecipeDocument>,
    @InjectModel(NutrientDefinition.name) private nutrientDefinitionModel: Model<NutrientDefinitionDocument>
  ) {
    if (process.env.PINECONE_API_KEY) {
      this.pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
      })
    }
  }

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
    console.log('ai_request',this.base, this.key, JSON.stringify(messages))
    const url = `${this.base}/chat/completions`
    const res = await axios.post(
      url,
      { model, messages },
      {
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'User-Agent': 'MealNow/1.0'
        },
      },
    )
    console.log('ai_response', JSON.stringify(res.data))
    return res.data
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    const model = process.env.AI_MODEL_EMBEDDING || 'text-embedding-3-small'
    const url = `${this.base}/embeddings`
    try {
      const res = await axios.post(
        url,
        { model, input: texts, dimensions: 1024 },
        {
          headers: {
            Authorization: `Bearer ${this.key}`,
            'HTTP-Referer': 'https://mealnow.top', // Required by OpenRouter for rankings
            'X-Title': 'MealNow', // Required by OpenRouter for rankings
            'Content-Type': 'application/json',
            'User-Agent': 'MealNow/1.0',
          },
        },
      )
      // Ensure the order matches the input
      const data = res.data?.data || []
      return data.sort((a: any, b: any) => a.index - b.index).map((item: any) => item.embedding)
    } catch (e) {
      this.logger.error('Failed to create embeddings', e)
      return []
    }
  }

  computeCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i]
      normA += vecA[i] * vecA[i]
      normB += vecB[i] * vecB[i]
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  async createEmbedding(text: string): Promise<number[]> {
    const model = process.env.AI_MODEL_EMBEDDING || 'text-embedding-3-small'
    const url = `${this.base}/embeddings`
    try {
      const res = await axios.post(
        url,
        { model, input: text, dimensions: 1024 },
        {
          headers: {
            Authorization: `Bearer ${this.key}`,
            'HTTP-Referer': 'https://cuisine.app', // Required by OpenRouter for rankings
            'X-Title': 'Cuisine', // Required by OpenRouter for rankings
            'Content-Type': 'application/json',
            'User-Agent': 'Cuisine/1.0',
          },
        },
      )
      return res.data?.data?.[0]?.embedding || []
    } catch (e) {
      this.logger.error('Failed to create embedding', e)
      return []
    }
  }

  async translateToEnglish(text: string): Promise<string> {
    const model = process.env.AI_MODEL_TRANSLATION || 'openai/gpt-4o-mini'
    const messages: Message[] = [
      {
        role: 'system',
        content: 'You are a professional translator and nutrition expert. Translate the following ingredient name to English. Ensure the translation is as close as possible to the standard USDA food database terminology. Only return the English name, no other text.'
      },
      {
        role: 'user',
        content: text
      }
    ]
    const data = await this.chat(model, messages)
    return data?.choices?.[0]?.message?.content?.trim() || text
  }

  async translateToChinese(text: string): Promise<string> {
    const model = process.env.AI_MODEL_TRANSLATION || 'openai/gpt-4o-mini'
    const messages: Message[] = [
      {
        role: 'system',
        content: 'You are a professional translator. Translate the following ingredient name to Simplified Chinese. Only return the Chinese name, no other text.'
      },
      {
        role: 'user',
        content: text
      }
    ]
    const data = await this.chat(model, messages)
    return data?.choices?.[0]?.message?.content?.trim() || text
  }

  async queryVectors(vector: number[], topK: number = 1, minScore: number = 0.85, indexNameStr?: string) {
    if (!this.pinecone) {
      this.logger.warn('Pinecone client not initialized')
      return []
    }
    const indexName = indexNameStr || process.env.PINECONE_INDEX || 'ingredients'
    try {
      const index = this.pinecone.index(indexName)
      const queryResponse = await index.query({
        vector,
        topK,
        includeMetadata: true,
      })

      return queryResponse.matches
        .filter((match: any) => (match.score || 0) >= minScore)
    } catch (e) {
      this.logger.error('Failed to query Pinecone', e)
      return []
    }
  }

  async fetchVector(id: string, indexNameStr?: string) {
    if (!this.pinecone) {
      this.logger.warn('Pinecone client not initialized')
      return null
    }
    const indexName = indexNameStr || process.env.PINECONE_INDEX || 'ingredients'
    try {
      const index = this.pinecone.index(indexName)
      const result = await index.fetch([id])
      if (result.records && result.records[id]) {
        return result.records[id]
      }
      return null
    } catch (e) {
      this.logger.error('Failed to fetch from Pinecone', e)
      return null
    }
  }

  async upsertVector(id: string | undefined | null, vector: number[], metadata: Record<string, any>, indexNameStr?: string) {
    if (!this.pinecone) {
      this.logger.warn('Pinecone client not initialized')
      return
    }
    const indexName = indexNameStr || process.env.PINECONE_INDEX || 'ingredients'
    const finalId = id || randomUUID()

    try {
      const index = this.pinecone.index(indexName)
      await index.upsert([
        {
          id: finalId,
          values: vector,
          metadata
        }
      ])
      this.logger.log(`Upserted vector to ${indexName}: ${finalId}`)
    } catch (e: any) {
      this.logger.error(`Failed to upsert to Pinecone: ${e.message}`, e.response?.data || e)
    }
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
    
    const systemPrompt = this.templateService.renderFromFile('recipe-surprise.mustache', {
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

    const systemPrompt = this.templateService.renderFromFile('recipe-daily-recommand.mustache', {
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

  async generateDietLimits(profile: {
    height?: number
    weight?: number
    gender?: string
    specialPeriods?: string[]
    chronicDiseases?: string[]
    age?: number // Optional if we had DOB
  }, nutrients: { name: string; unit: string }[], lang: string = 'zh') {
    const model = process.env.AI_MODEL_DIET_LIMIT || 'anthropic/claude-3.5-sonnet'

    const nutrientListStr = nutrients.map(n => `- ${n.name} (${n.unit})`).join('\n');

    const systemPrompt = `You are a professional nutritionist.
    Generate daily nutrient intake limits (min and max) for a user based on their profile.
    Output must be a JSON array of objects with keys: "nutrient" (exact name from the list below), "min" (number), "max" (number).
    
    Target Nutrients:
    ${nutrientListStr}

    IMPORTANT: The values for "min" and "max" MUST strictly correspond to the units specified in parentheses above. Do not convert units (e.g. if unit is 'g', do not output 'mg').

    For special periods (pregnancy, etc.) or diseases, adjust the values accordingly.
    Only return the JSON array, no other text.`

    const userPrompt = JSON.stringify(profile)

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]

    const data = await this.chat(model, messages)
    const content = data?.choices?.[0]?.message?.content
    
    if (!content) return []
    try {
      const result = this.parseJsonFromContent(content)
      return Array.isArray(result) ? result : []
    } catch (e) {
      this.logger.error('Failed to parse diet limits', e)
      return []
    }
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

  // async analyzeNutrition(ingredients: { name: string; amount: number; unit: string }[]): Promise<any> {
  //   const model = process.env.AI_MODEL_NUTRITION || 'openai/gpt-4o-mini'
  //   const nutrients = await this.getNutrientDefinitionsForPrompt()
    
  //   const systemPrompt = this.templateService.renderFromFile('nutrition-recognition.mustache', {
  //     types: nutrients.map((n) => n.type).join(', '),
  //     units: nutrients.map((n) => `  - ${n.type}: ${n.unit}`).join('\n')
  //   })

  //   const messages: Message[] = [
  //     { role: 'system', content: systemPrompt },
  //     { role: 'user', content: JSON.stringify(ingredients) }
  //   ]

  //   const data = await this.chat(model, messages)
  //   const content = data?.choices?.[0]?.message?.content
  //   if (!content) return { totalCalories: 0, nutritionInfo: [] }

  //   try {
  //     const parsed = this.parseJsonFromContent(content)
  //     //macronutrient：carbohydrate, protein, fat
  //     //vitamins：vitamin_a, vitamin_d, vitamin_c, vitamin_e, vitamin_k, vitamin_b
  //     //minerals：calcium, magnesium, sodium, phosphorus, iron, zinc, copper, manganese, salt
  //     //fiber: fiber
  //     if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { totalCalories: 0, nutritionInfo: [] }

  //     const nutritionInfo = (parsed as any).nutritionInfo
  //     if (!Array.isArray(nutritionInfo)) {
  //       return {
  //         ...(parsed as any),
  //         totalCalories: Number((parsed as any).totalCalories) || 0,
  //         nutritionInfo: [],
  //       }
  //     }

  //     const first = nutritionInfo[0]
  //     const isAlreadyGrouped =
  //       first &&
  //       typeof first === 'object' &&
  //       !Array.isArray(first) &&
  //       typeof (first as any).category === 'string' &&
  //       Array.isArray((first as any).nutritionInfo)

  //     if (isAlreadyGrouped) {
  //       return {
  //         ...(parsed as any),
  //         totalCalories: Number((parsed as any).totalCalories) || 0,
  //       }
  //     }

  //     return {
  //       ...(parsed as any),
  //       totalCalories: Number((parsed as any).totalCalories) || 0,
  //       nutritionInfo,
  //     }
  //   } catch (e) {
  //     this.logger.error('Failed to parse nutrition response', e)
  //     return { totalCalories: 0, nutritionInfo: [] }
  //   }
  // }

  async convertUnitToGrams(name: string, amount: number, unit: string): Promise<number> {
    const model = process.env.AI_MODEL_CONVERSION || 'openai/gpt-4o-mini'
    const messages: Message[] = [
      {
        role: 'system',
        content: 'You are a culinary expert. Convert the following ingredient amount to grams. Return ONLY the number representing the amount in grams.\nIf the unit is a non-standard measure or a count (e.g., "piece", "slice", "whole", "root", "clove", "cup", "spoon", "bowl", etc.), estimate the weight in grams based on the typical average size of the ingredient.\nIf the conversion depends on density/size and is approximate, provide your best professional estimate.\nDo not return any units, explanation, or other text, just the raw number.'
      },
      {
        role: 'user',
        content: `Convert ${amount} ${unit} of ${name} to grams.`
      }
    ]
    
    try {
        const data = await this.chat(model, messages)
        const content = data?.choices?.[0]?.message?.content?.trim()
        // Remove any non-numeric characters except dot (in case AI returns "100g" or similar despite instructions)
        const numericStr = content?.replace(/[^0-9.]/g, '')
        const result = parseFloat(numericStr)
        if (isNaN(result)) {
             this.logger.warn(`Failed to convert ${amount} ${unit} of ${name} to grams: AI returned '${content}'`);
             return amount; // Fallback to original amount
        }
        return result;
    } catch (e) {
        this.logger.error(`Failed to convert ${amount} ${unit} of ${name} to grams`, e);
        return amount;
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
