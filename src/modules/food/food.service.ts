import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiService } from '../ai/ai.service';
import { RedisService } from '../redis/redis.service';
import { IngredientStandardizationError } from './errors/ingredient-standardization.error';
import { StandardizedIngredient, FoodNutrient } from './interfaces/food.interface';
import { NutrientDefinition, NutrientDefinitionDocument } from './schemas/nutrient-definition.schema';
import { Ingredient, IngredientDocument } from './schemas/ingredient.schema';
import axios from 'axios';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);
  private readonly USDA_API_KEY = process.env.USDA_API_KEY;
  private readonly USDA_API_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

  constructor(
    private readonly aiService: AiService,
    private readonly redisService: RedisService,
    @InjectModel(NutrientDefinition.name) private readonly nutrientDefinitionModel: Model<NutrientDefinitionDocument>,
    @InjectModel(Ingredient.name) private readonly ingredientModel: Model<IngredientDocument>,
  ) {}

  async foodInfo(name: string): Promise<StandardizedIngredient> {
    try {
      // 1. Vector Search (Directly using the input name, relying on cross-lingual embedding)
      try {
        const embedding = await this.aiService.createEmbedding(name);
        if (embedding.length > 0) {
            // Lower threshold slightly for cross-lingual matches if needed, but 0.85 is usually fine for OpenAI embeddings
            const matches = await this.aiService.queryVectors(embedding, 1, 0.6);
            if (matches.length > 0) {
                this.logger.debug(`Vector match found for '${name}': ${matches[0].metadata?.name}`);
                
                const fdcId = Number(matches[0].metadata?.fdcId);
                if (fdcId) {
                  // Query database by fdcId to get complete nutrient information
                  const ingredient = await this.ingredientModel.findOne({ fdcId }).exec();
                  if (ingredient) {
                    return {
                      name: ingredient.name,
                      fdcId: ingredient.fdcId,
                      nutrients: ingredient.nutrients
                    };
                  }
                }

                // If no fdcId in metadata or not found in DB, fallback to metadata (if available) or continue to USDA search
                // Note: Previous implementation relied on metadata having full nutrients JSON which might be large/incomplete
                if (matches[0].metadata?.nutrients) {
                   // return {
                   //      name: matches[0].metadata?.name as string ?? "",
                   //      fdcId: matches[0].metadata?.fdcId as string,
                   //      nutrients: JSON.parse(matches[0].metadata?.nutrients as string) as FoodNutrient[]
                   //  };
                   throw new IngredientStandardizationError('Ingredient not found in database', 'vector');
                }
            } else {
              this.logger.warn(`No vector match found for '${name}'`);
            }
        } else {
          this.logger.warn(`Create Embedding failed for '${name}'`);
        }
      } catch (error) {
          this.logger.warn(`Vector search failed for ${name}`, error);
      }

      // 2. AI Translation (Fallback for USDA Search)
      // If vector search fails, we still need English for USDA API
      let englishName = name;
      try {
        if (/[\u4e00-\u9fa5]/.test(name)) {
            this.logger.log(`Translating '${name}' for USDA search...`);
            englishName = await this.aiService.translateToEnglish(name);
            this.logger.log(`Translated '${name}' to '${englishName}'`);
        }
      } catch (error: any) {
          this.logger.warn(`Translation failed for ${name}: ${error.message}`, error);
      }

      // 3. USDA API Search (Final Fallback)
      const usdaResult = await this.searchUsda(englishName);
      
      return {
          name: usdaResult.name,
          fdcId: usdaResult.fdcId,
          nutrients: usdaResult.nutrients
      };

    } catch (error) {
      if (error instanceof IngredientStandardizationError) {
        throw error;
      }
      throw new IngredientStandardizationError(
        'All standardization methods failed',
        'all',
        error
      );
    }
  }

  async foodsInfo(names: string[]): Promise<StandardizedIngredient[]> {
    const results = await Promise.allSettled(names.map(name => this.foodInfo(name)));
    return results
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<StandardizedIngredient>).value);
  }

  async getAllNutrientDefinitions(): Promise<NutrientDefinition[]> {
    return this.nutrientDefinitionModel.find().sort({ categoryOrder: 1, typeOrder: 1 }).lean().exec();
  }

  private async getValidNutrientTypes(): Promise<Set<string>> {
    const cacheKey = 'food:valid_nutrient_types';
    const cached = await this.redisService.get().get(cacheKey);
    if (cached) {
        return new Set(JSON.parse(cached));
    }

    const nutrients = await this.nutrientDefinitionModel.find().select('type').lean().exec();
    const types = nutrients.map(n => n.type);
    
    await this.redisService.get().setex(cacheKey, 3600, JSON.stringify(types));
    return new Set(types);
  }

  private async searchUsda(query: string): Promise<StandardizedIngredient> {
    if (!this.USDA_API_KEY) {
        // If no API key, we can't search USDA.
        throw new IngredientStandardizationError('USDA API Key not configured', 'usda');
    }

    try {
        const response = await axios.post(
            `${this.USDA_API_URL}?api_key=${this.USDA_API_KEY}`,
            {
                query: query,
                dataType: ['Foundation'],
                pageSize: 10,
                pageNumber: 1
            }
        );

        const foods = response.data.foods;
        
        if (foods && foods.length > 0) {
            let food = foods[0];

            // If there are multiple results, select the one most similar to the query via vector comparison
            if (foods.length > 1) {
                try {
                    this.logger.debug(`Comparing ${foods.length} USDA results for query '${query}'...`);
                    // Create embeddings for query and all candidate descriptions in one batch
                    const candidates = foods.map((f: any) => f.description);
                    const allTexts = [query, ...candidates];
                    const allEmbeddings = await this.aiService.createEmbeddings(allTexts);

                    if (allEmbeddings.length === allTexts.length) {
                        const queryEmbedding = allEmbeddings[0];
                        const candidateEmbeddings = allEmbeddings.slice(1);

                        let maxScore = -1;
                        let bestIndex = 0;

                        for (let i = 0; i < candidateEmbeddings.length; i++) {
                            const score = this.aiService.computeCosineSimilarity(queryEmbedding, candidateEmbeddings[i]);
                            // this.logger.debug(`Candidate ${i}: ${candidates[i]} - Score: ${score}`);
                            if (score > maxScore) {
                                maxScore = score;
                                bestIndex = i;
                            }
                        }

                        if (bestIndex !== 0) {
                             this.logger.log(`Vector comparison selected index ${bestIndex}: '${foods[bestIndex].description}' (score: ${maxScore.toFixed(4)}) over default '${foods[0].description}'`);
                        } else {
                             this.logger.debug(`Vector comparison confirmed first result is best match (score: ${maxScore.toFixed(4)})`);
                        }
                        food = foods[bestIndex];
                    }
                } catch (error) {
                    this.logger.warn(`Vector comparison failed, falling back to first result: ${error}`);
                }
            }

            const nutrients: FoodNutrient[] = (food.foodNutrients || []).map((n: any) => {
                return {
                    nutrientId: n.nutrientId, //这是最重要的
                    nutrientName: n.nutrientName,
                    nutrientNumber: n.nutrientNumber,
                    unitName: n.unitName,
                    value: n.value,
                };
            });

            // Parse description and translate
            const description = food.description;
            const shortName = description.split(',')[0].trim();

            const result: StandardizedIngredient = {
                name: shortName,
                fdcId: food.fdcId,
                nutrients: nutrients
            };

            // Save to database
            try {
                await this.ingredientModel.findOneAndUpdate(
                    { fdcId: food.fdcId },
                    { 
                        $set: {
                            name: shortName,
                            fdcId: food.fdcId,
                            nutrients: nutrients
                        }
                    },
                    { upsert: true, new: true }
                ).exec();
                this.logger.debug(`Saved ingredient '${shortName}' (fdcId: ${food.fdcId}) to database`);
            } catch (dbError) {
                this.logger.error(`Failed to save ingredient to database: ${dbError}`, dbError);
            }

            // 4. Upsert to Vector Database (Pinecone)
            try {
                // Generate embedding for the ingredient name (description)
                const embedding = await this.aiService.createEmbedding(food.description);
                if (embedding.length > 0) {
                    await this.aiService.upsertVector(
                        String(food.fdcId),
                        embedding,
                        {
                            name: shortName,
                            fdcId: food.fdcId
                        }
                    );
                    this.logger.debug(`Upserted '${food.description}' to Pinecone`);
                }
            } catch (vectorError) {
                this.logger.error('Failed to upsert to Pinecone', vectorError);
            }

            return result;
        }

        throw new IngredientStandardizationError('No matching ingredient found in USDA database', 'usda');

    } catch (error) {
         if (axios.isAxiosError(error)) {
             if (error.response?.status === 429) {
                 throw new IngredientStandardizationError('USDA API rate limit exceeded', 'usda', error);
             }
         }
         // If it's already our error, rethrow
         if (error instanceof IngredientStandardizationError) throw error;
         
         throw new IngredientStandardizationError('USDA API request failed', 'usda', error);
    }
  }

  
}
