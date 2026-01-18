import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { FoodService } from './food.service';
import { StandardizeIngredientDto } from './dto/standardize-ingredient.dto';
import { StandardizedIngredient } from './interfaces/food.interface';

@Controller('food')
export class FoodController {
  constructor(private readonly foodService: FoodService) {}

  @Get('standardize')
  async standardizeIngredient(@Query() dto: StandardizeIngredientDto): Promise<StandardizedIngredient | StandardizedIngredient[]> {
    if (dto.names && dto.names.length > 0) {
      return this.foodService.foodsInfo(dto.names);
    }
    
    if (dto.name) {
      return this.foodService.foodInfo(dto.name);
    }

    throw new Error('Either name or names must be provided');
  }
}
