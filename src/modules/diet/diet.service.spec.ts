import { Test, TestingModule } from '@nestjs/testing';
import { DietService } from './diet.service';
import { FoodService } from '../food/food.service';
import { getModelToken } from '@nestjs/mongoose';
import { DietEntry } from './schemas/diet-entry.schema';
import { DietLimit } from './schemas/diet-limit.schema';
import { User } from '../auth/schemas/user.schema';
import { PUB_SUB } from '../../common/pubsub.module';
import { AiService } from '../ai/ai.service';
import { RecipeService } from '../recipe/recipe.service';
import { BillingService } from '../billing/billing.service';
import { ForbiddenException } from '@nestjs/common';

describe('DietService', () => {
  let service: DietService;
  let foodService: FoodService;
  let dietEntryModel: any;
  let recipeService: any;
  let billingService: any;

  const mockFoodService = {
    foodInfo: jest.fn(),
    getAllNutrientDefinitions: jest.fn(),
  };

  const mockDietEntryModel = jest.fn().mockImplementation((dto) => ({
    ...dto,
    save: jest.fn().mockResolvedValue(dto),
  }));

  const mockRecipeService = {
    getRecipeById: jest.fn(),
  };

  const mockBillingService = {
    hasActiveSubscription: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DietService,
        {
          provide: FoodService,
          useValue: mockFoodService,
        },
        {
          provide: getModelToken(DietEntry.name),
          useValue: mockDietEntryModel,
        },
        {
          provide: RecipeService,
          useValue: mockRecipeService,
        },
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
        {
          provide: getModelToken(DietLimit.name),
          useValue: {},
        },
        {
          provide: getModelToken(User.name),
          useValue: {},
        },
        {
          provide: PUB_SUB,
          useValue: { publish: jest.fn() },
        },
        {
          provide: AiService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<DietService>(DietService);
    foodService = module.get<FoodService>(FoodService);
    dietEntryModel = module.get(getModelToken(DietEntry.name));
    recipeService = module.get<RecipeService>(RecipeService);
    billingService = module.get<BillingService>(BillingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('logRecipeNutrition', () => {
    it('should throw ForbiddenException if user has no active subscription', async () => {
      mockBillingService.hasActiveSubscription.mockResolvedValue(false);
      
      await expect(
        service.logRecipeNutrition('user1', 'recipe1', '2024-01-01', 'breakfast', 'en')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should include all nutrients with 0 value if not present in food', async () => {
      mockBillingService.hasActiveSubscription.mockResolvedValue(true);
      const nutrientDefs = [
        { nutritionIds: [1], name: 'Protein', type: 'protein' },
        { nutritionIds: [2], name: 'Carbs', type: 'carbs' },
        { nutritionIds: [3], name: 'Fat', type: 'fat' },
      ];
      
      const recipe = {
        ingredients: [
          { name: 'Chicken', amount: 100, preciseAmount: 100 }
        ]
      };

      const foodInfo = {
        name: 'Chicken',
        nutrients: [
          { nutrientId: 1, value: 20 } // Only has protein
        ]
      };

      mockRecipeService.getRecipeById.mockResolvedValue(recipe);
      mockFoodService.getAllNutrientDefinitions.mockResolvedValue(nutrientDefs);
      mockFoodService.foodInfo.mockResolvedValue(foodInfo);

      await service.logRecipeNutrition('user1', 'recipe1', '2024-01-01', 'breakfast', 'en');

      expect(mockDietEntryModel).toHaveBeenCalled();
      const saveCall = mockDietEntryModel.mock.calls[0][0];
      expect(saveCall.nutritions).toHaveLength(3);
      
      const protein = saveCall.nutritions.find((n: any) => n.type === 'protein');
      const carbs = saveCall.nutritions.find((n: any) => n.type === 'carbs');
      const fat = saveCall.nutritions.find((n: any) => n.type === 'fat');

      expect(protein.value).toBe(20);
      expect(carbs.value).toBe(0);
      expect(fat.value).toBe(0);
    });

    it('should respect nutritionIds priority', async () => {
      mockBillingService.hasActiveSubscription.mockResolvedValue(true);
      const nutrientDefs = [
        { nutritionIds: [10, 20], name: 'Vitamin X', type: 'vitamin_x' }, // 10 is higher priority
      ];
      
      const recipe = {
        ingredients: [
          { name: 'SuperFood', amount: 100, preciseAmount: 100 }
        ]
      };

      const foodInfo = {
        name: 'SuperFood',
        nutrients: [
          { nutrientId: 20, value: 5 },  // Lower priority
          { nutrientId: 10, value: 100 } // Higher priority
        ]
      };

      mockRecipeService.getRecipeById.mockResolvedValue(recipe);
      mockFoodService.getAllNutrientDefinitions.mockResolvedValue(nutrientDefs);
      mockFoodService.foodInfo.mockResolvedValue(foodInfo);

      await service.logRecipeNutrition('user1', 'recipe1', '2023-01-01', 'dinner', 'en');

      expect(mockDietEntryModel).toHaveBeenCalled();
      const saveCall = mockDietEntryModel.mock.calls[0][0];
      const vitaminX = saveCall.nutritions.find((n: any) => n.type === 'vitamin_x');
      expect(vitaminX.value).toBe(100); // Should pick value from ID 10
    });
  });
});
