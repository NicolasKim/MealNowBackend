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

type Message = { role: 'user' | 'system' | 'assistant'; content: any }

const INGREDIENT_OUTPUT_STRUCTURE_ZH = `{
    "name": "食材名称(简体中文)",
    "quantity": "估计数量(number)",
    "unit": "单位(如:个,g,ml,根,袋,瓶 等)，注意不要用模糊的计量单位",
    "category": "分类(蔬菜/肉类/水果/海鲜/调料/其他)",
    "estimatedExpireDate": "(number)根据食材的状态和成色，判断还有多少天过期（数字），如果已过期请返回 -1"
}`

const INGREDIENT_OUTPUT_STRUCTURE_EN = `{
    "name": "Ingredient name (English)",
    "quantity": "Estimated quantity (number)",
    "unit": "Units (e.g., piece, g, ml, stalk, sachet, bottle, etc.). Avoid using vague or ambiguous measurement units.",
    "category": "Category (Vegetable/Meat/Fruit/Seafood/Seasoning/Other)",
    "estimatedExpireDate": "(number)Estimated days until expiration based on condition (number), return -1 if already expired"
}`

const NUTRITION_OUTPUT_STRUCTURE = `{
  "totalCalories": 250,
  "nutritionInfo": [
    {
      "type": "protein",
      "amount": 20,
      "unit": "g"
    }
  ]
}`

const RECIPE_OUTPUT_STRUCTURE = `{
  "title": "菜名",
  "type": "recommendation/special",
  "description": "简短描述（包含推荐理由）",
  "cookTimeMinutes": 30,
  "difficulty": "Easy/Medium/Hard",
  "matchRate": 85.5,
  "ingredients": [
      { "name": "食材名", "amount": 100, "unit": "g" }
  ],
  "steps": [
      { "order": 1, "instruction": "步骤说明" }
  ],
  "missing": [
      { "name": "缺失食材名", "requiredAmount": 10, "unit": "g", "category": "分类" }
  ]
}`

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)
  private base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  private key = process.env.OPENROUTER_API_KEY || ''
  constructor(
    private readonly redis: RedisService,
    private readonly storage: StorageService,
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
    const url = `${this.base}/chat/completions`
    const res = await axios.post(
      url,
      { model, messages },
      { headers: { Authorization: `Bearer ${this.key}` } }
    )
    return res.data
  }

  async recognizeIngredientsFromImage(imageUrl: string, lang: string = 'zh') {
    const model = process.env.AI_MODEL_VISION || 'openai/gpt-4o'
    const key = `vision:ingredients:v2:${lang}:${imageUrl}`
    const cached = await this.redis.get().get(key)
    if (cached) return JSON.parse(cached)

    const structure = lang === 'zh' ? INGREDIENT_OUTPUT_STRUCTURE_ZH : INGREDIENT_OUTPUT_STRUCTURE_EN;
    const systemPrompt = lang === 'zh'
      ? `你是一个专业的食材识别助手。请识别图片中的所有食材，并返回一个严格的 JSON 数组。
数据结构要求：
[
  ${structure}
]
请直接返回 JSON 字符串，严禁包含 Markdown 格式标记（如 \`\`\`json）或其他无关文本。如果不包含食材，返回 []。`
      : `You are a professional ingredient recognition assistant. Please identify all ingredients in the image and return a strict JSON array.
Data structure requirements:
[
  ${structure}
]
Please return the JSON string directly, strictly forbidding Markdown format markers (such as \`\`\`json) or other irrelevant text. If no ingredients are found, return [].`;

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
      const jsonStr = content.replace(/```json\n?|\n?```/g, '')
      let ingredients = JSON.parse(jsonStr)

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
    const systemPrompt = `你是一个专业的营养师和主厨AI。请根据用户提供的现有食材和偏好生成菜谱。

任务要求：
请生成 ${payload.count} 个菜谱：
1. 分析用户提供的 ingredients (现有食材) 和 preference (偏好)。
2. 生成高匹配度（matchRate > 60%）的实用家常菜肴。
3. 如果食材不足，可以适当推荐需要少量补充食材的菜谱 (missing ingredients)。

语言要求：
请使用 ${lang === 'zh' ? '简体中文' : 'English'} 生成所有内容。

返回格式要求：
请仅返回一个 JSON 数组，不要包含任何 Markdown 格式或额外文本。数组中每个对象包含以下字段：
${RECIPE_OUTPUT_STRUCTURE}`

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
    // Don't cache surprise recipes as inventory changes frequently
    // or cache with a short TTL if needed. For now, no cache to ensure freshness.

    const messages: Message[] = [
      {
        role: 'system',
        content: `你是一个创意大厨。请根据用户的现有食材和偏好${payload.mealType ? `为${payload.mealType}` : ''}生成创意食谱。
        
规则：
1. **搭配**：合理搭配"新鲜食材"，充分利用"即将过期食材"。
2. **偏好**：必须严格遵守用户的口味偏好（如辣度、禁忌等）。
3. **补充**：如果食材不够可以适当推荐需要少量补充食材的菜谱。
${payload.excludedDishes?.length ? `4. **排除**：请不要推荐以下菜品：${payload.excludedDishes.join(', ')}。` : ''}

语言要求：
请使用 ${lang === 'zh' ? '简体中文' : 'English'} 生成所有内容。

所有生成食谱的 type 字段请统一设置为 "recommendation"。

返回格式：
请返回一个 JSON 数组，包含 ${payload.count} 个食谱。每个食谱的结构如下：
${RECIPE_OUTPUT_STRUCTURE}
只返回 JSON，不要包含 Markdown 格式。`
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

    console.log('generateSurpriseRecipes Input:', JSON.stringify(messages, null, 2));
    const data = await this.chat(model, messages)
    console.log('generateSurpriseRecipes Output:', JSON.stringify(data, null, 2));
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

    const systemPrompt = `你是一个专业的营养师和主厨AI。请为用户生成 ${payload.mealType} 的菜谱推荐。
    
时段要求: ${payload.style}

任务要求：
请生成 4 个菜谱：
1. 3个 "推荐菜肴" (Pantry Match)：核心目标是"消耗库存"。请深度分析现有食材的组合可能性，生成高匹配度（matchRate > 60%）的实用家常菜肴，严格贴合用户口味偏好。对应 type 为 "recommendation"。
2. 1个 "今日精选" (Chef's Choice)：核心目标是"美味探索"。不受限于现有食材，请根据用户的口味画像推荐一道极具吸引力的特色菜或创意料理，旨在提供新鲜感和美食灵感。对应 type 为 "special"。

优先级规则：
1. **最高优先级**：必须尽可能多地使用"即将过期食材"（请参考食材的数量，尽可能消耗完）。
2. **次优先级**：合理搭配"新鲜食材"。
3. **偏好**：必须严格遵守用户的口味偏好。

语言要求：
请使用 ${lang === 'zh' ? '简体中文' : 'English'} 生成所有内容。

返回格式要求：
请仅返回一个 JSON 数组，不要包含任何 Markdown 格式或额外文本。数组中每个对象包含以下字段：
${RECIPE_OUTPUT_STRUCTURE}`

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
      const jsonStr = text.replace(/```json\n?|\n?```/g, '')
      const parsed = JSON.parse(jsonStr)

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
    const nutrientRules = nutrients.length
      ? `- type must be one of: ${nutrients.map((n) => n.type).join(', ')}.
- You MUST include ALL types above in the output. If a type is not applicable, still include it with amount set to 0.
- unit must match each type:
${nutrients.map((n) => `  - ${n.type}: ${n.unit}`).join('\n')}`
      : ''
    const systemPrompt = `You are a nutritionist assistant.
Given an ingredient list (each with name, amount, unit), estimate the total nutrition for the entire list.

Output requirements:
- Return ONLY a single JSON object (no markdown, no code fences, no extra text).
- The JSON must strictly match this structure (keys and nesting):
${NUTRITION_OUTPUT_STRUCTURE}
- Do not add extra keys.
${nutrientRules ? `${nutrientRules}\n` : ''}
- amount must be numbers.
If you cannot estimate a value, use 0.`

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(ingredients) }
    ]

    const data = await this.chat(model, messages)
    const content = data?.choices?.[0]?.message?.content
    if (!content) return { totalCalories: 0, nutritionInfo: [] }

    try {
      const jsonStr = content.replace(/```json\n?|\n?```/g, '')
      const parsed = JSON.parse(jsonStr)
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

      const typeToCategory: Record<string, 'macronutrient' | 'vitamins' | 'minerals' | 'fiber'> = {
        carbohydrate: 'macronutrient',
        protein: 'macronutrient',
        fat: 'macronutrient',
        vitamin_a: 'vitamins',
        vitamin_d: 'vitamins',
        vitamin_c: 'vitamins',
        vitamin_e: 'vitamins',
        vitamin_k: 'vitamins',
        vitamin_b: 'vitamins',
        calcium: 'minerals',
        magnesium: 'minerals',
        sodium: 'minerals',
        phosphorus: 'minerals',
        iron: 'minerals',
        zinc: 'minerals',
        copper: 'minerals',
        manganese: 'minerals',
        salt: 'minerals',
        fiber: 'fiber',
      }

      const buckets: Record<'macronutrient' | 'vitamins' | 'minerals' | 'fiber', any[]> = {
        macronutrient: [],
        vitamins: [],
        minerals: [],
        fiber: [],
      }

      for (const item of nutritionInfo) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const type = String((item as any).type || '')
        const category = typeToCategory[type] || 'macronutrient'
        buckets[category].push(item)
      }

      return {
        ...(parsed as any),
        totalCalories: Number((parsed as any).totalCalories) || 0,
        nutritionInfo: [
          { category: 'macronutrient', nutritionInfo: buckets.macronutrient },
          { category: 'vitamins', nutritionInfo: buckets.vitamins },
          { category: 'minerals', nutritionInfo: buckets.minerals },
          { category: 'fiber', nutritionInfo: buckets.fiber },
        ],
      }
    } catch (e) {
      this.logger.error('Failed to parse nutrition response', e)
      return { totalCalories: 0, nutritionInfo: [] }
    }
  }
}
