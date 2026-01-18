import { Test, TestingModule } from '@nestjs/testing';
import { DietService } from './diet.service';
import { FoodService } from '../food/food.service';
import { getModelToken } from '@nestjs/mongoose';
import { DietEntry } from './schemas/diet-entry.schema';
import { Recipe } from '../recipe/schemas/recipe.schema';

describe('DietService', () => {
  let service: DietService;
  let foodService: FoodService;
  let dietEntryModel: any;
  let recipeModel: any;

  const mockFoodService = {
    foodInfo: jest.fn(),
    getAllNutrientDefinitions: jest.fn(),
  };

  const mockDietEntryModel = jest.fn().mockImplementation((dto) => ({
    ...dto,
    save: jest.fn().mockResolvedValue(dto),
  }));

  const mockRecipeModel = {
    findById: jest.fn(),
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
          provide: getModelToken(Recipe.name),
          useValue: mockRecipeModel,
        },
      ],
    }).compile();

    service = module.get<DietService>(DietService);
    foodService = module.get<FoodService>(FoodService);
    dietEntryModel = module.get(getModelToken(DietEntry.name));
    recipeModel = module.get(getModelToken(Recipe.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('logRecipeNutrition', () => {
    it('should include all nutrients with 0 value if not present in food', async () => {
      const nutrientDefs = [
        { nutritionId: 1, name: 'Protein' },
        { nutritionId: 2, name: 'Carbs' },
        { nutritionId: 3, name: 'Fat' },
      ];
      
      const recipe = {
        ingredients: [
          { name: 'Chicken', amount: 100 }
        ]
      };

      const foodInfo = {
        name: 'Chicken',
        nutrients: [
          { nutrientId: 1, value: 20 } // Only has protein
        ]
      };

      mockRecipeModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(recipe)
      });

      mockFoodService.getAllNutrientDefinitions.mockResolvedValue(nutrientDefs);
      mockFoodService.foodInfo.mockResolvedValue(foodInfo);

      const result = await service.logRecipeNutrition('user1', 'recipe1', '2023-01-01', 'dinner', 'en');

      expect(result.nutritions).toHaveLength(3);
      
      const protein = result.nutritions.find((n: any) => n.nutritionId === 1);
      const carbs = result.nutritions.find((n: any) => n.nutritionId === 2);
      const fat = result.nutritions.find((n: any) => n.nutritionId === 3);

      expect(protein?.value).toBe(20); // 20 * (100/100)
      expect(carbs?.value).toBe(0);
      expect(fat?.value).toBe(0);
    });
  });
});
