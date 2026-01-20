import { Test, TestingModule } from '@nestjs/testing';
import { FoodService } from './food.service';
import { AiService } from '../ai/ai.service';
import { RedisService } from '../redis/redis.service';
import { getModelToken } from '@nestjs/mongoose';
import { NutrientDefinition } from './schemas/nutrient-definition.schema';
import { Ingredient } from './schemas/ingredient.schema';
import { IngredientStandardizationError } from './errors/ingredient-standardization.error';
import axios from 'axios';

jest.mock('axios');

describe('FoodService', () => {
  let service: FoodService;
  let aiService: AiService;
  let redisService: RedisService;
  let ingredientModel: any;
  let nutrientDefinitionModel: any;

  const mockAiService = {
    createEmbedding: jest.fn(),
    queryVectors: jest.fn(),
    translateToEnglish: jest.fn(),
    upsertVector: jest.fn(),
  };

  const mockRedisClient = {
    get: jest.fn(),
    setex: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn().mockReturnValue(mockRedisClient),
  };

  const mockNutrientDefinitionModel = {
    find: jest.fn(),
  };

  const mockQuery = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  const mockIngredientModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoodService,
        {
          provide: AiService,
          useValue: mockAiService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: getModelToken(NutrientDefinition.name),
          useValue: mockNutrientDefinitionModel,
        },
        {
          provide: getModelToken(Ingredient.name),
          useValue: mockIngredientModel,
        },
      ],
    }).compile();

    service = module.get<FoodService>(FoodService);
    aiService = module.get<AiService>(AiService);
    redisService = module.get<RedisService>(RedisService);
    ingredientModel = module.get(getModelToken(Ingredient.name));
    nutrientDefinitionModel = module.get(getModelToken(NutrientDefinition.name));
    
    // Mock environment variable
    process.env.USDA_API_KEY = 'test-api-key';
    
    mockNutrientDefinitionModel.find.mockReturnValue(mockQuery);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('foodInfo', () => {
    it('should return ingredient from vector search if match found and exists in DB', async () => {
      const name = 'apple';
      const embedding = [0.1, 0.2];
      const match = {
        metadata: {
            name: 'Apple, raw',
            fdcId: '12345',
        }
      };
      const ingredient = {
        name: 'Apple, raw',
        fdcId: 12345,
        nutrients: []
      };

      mockAiService.createEmbedding.mockResolvedValue(embedding);
      mockAiService.queryVectors.mockResolvedValue([match]);
      mockIngredientModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(ingredient)
      });

      const result = await service.foodInfo(name);

      expect(result).toEqual(ingredient);
      expect(mockAiService.createEmbedding).toHaveBeenCalledWith(name);
      expect(mockAiService.queryVectors).toHaveBeenCalledWith(embedding, 1, 0.82);
      expect(mockIngredientModel.findOne).toHaveBeenCalledWith({ fdcId: 12345 });
    });

    it('should fallback to USDA search if vector search fails', async () => {
      const name = 'unknown food';
      const embedding = [0.1, 0.2];
      
      mockAiService.createEmbedding.mockResolvedValue(embedding);
      mockAiService.queryVectors.mockResolvedValue([]); // No match
      mockAiService.translateToEnglish.mockResolvedValue(name); // No translation needed or same name
      
      const usdaResponse = {
        data: {
            foods: [{
                fdcId: 99999,
                description: 'Unknown Food, raw',
                foodNutrients: [
                    { nutrientId: 1003, nutrientName: 'Protein', value: 10, unitName: 'g' }
                ]
            }]
        }
      };
      
      (axios.post as jest.Mock).mockResolvedValue(usdaResponse);
      
      // Mock valid nutrient IDs
      mockQuery.exec.mockResolvedValue([
          { nutritionIds: [1003], type: 'protein' }
      ]);
      mockIngredientModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({})
      });
      mockAiService.createEmbedding.mockResolvedValueOnce(embedding).mockResolvedValueOnce([0.3, 0.4]); // Second call for upsert

      const result = await service.foodInfo(name);
      
      expect(result.fdcId).toBe(99999);
      expect(result.name).toBe('Unknown Food');
      expect(axios.post).toHaveBeenCalled();
      expect(mockIngredientModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('should translate Chinese name before USDA search', async () => {
        const name = '苹果';
        const translatedName = 'apple';
        const embedding = [0.1, 0.2];
        
        mockAiService.createEmbedding.mockResolvedValue(embedding);
        mockAiService.queryVectors.mockResolvedValue([]); 
        mockAiService.translateToEnglish.mockResolvedValue(translatedName);
        
        const usdaResponse = {
          data: {
              foods: [{
                  fdcId: 12345,
                  description: 'Apple, raw',
                  foodNutrients: []
              }]
          }
        };
        (axios.post as jest.Mock).mockResolvedValue(usdaResponse);
        mockQuery.exec.mockResolvedValue([]);
        mockIngredientModel.findOneAndUpdate.mockReturnValue({
            exec: jest.fn().mockResolvedValue({})
        });

        await service.foodInfo(name);
        
        expect(mockAiService.translateToEnglish).toHaveBeenCalledWith(name);
        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('api_key='),
            expect.objectContaining({ query: translatedName })
        );
    });
    
    it('should throw IngredientStandardizationError if all methods fail', async () => {
        const name = 'impossible food';
        mockAiService.createEmbedding.mockRejectedValue(new Error('AI Error'));
        (axios.post as jest.Mock).mockRejectedValue(new Error('USDA Error'));
        
        await expect(service.foodInfo(name)).rejects.toThrow(IngredientStandardizationError);
    });
  });

  describe('foodsInfo', () => {
    it('should return array filtering out failed requests', async () => {
        const names = ['apple', 'error_food'];
        
        jest.spyOn(service, 'foodInfo').mockImplementation(async (name) => {
            if (name === 'error_food') throw new Error('Failed');
            return { name: 'Apple', fdcId: 1, nutrients: [] };
        });

        const results = await service.foodsInfo(names);
        
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ name: 'Apple', fdcId: 1, nutrients: [] });
    });
  });
});
