import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FoodController } from './food.controller';
import { FoodService } from './food.service';
import { FoodSeedService } from './food.seed.service';
import { NutrientDefinition, NutrientDefinitionSchema } from './schemas/nutrient-definition.schema';
import { Ingredient, IngredientSchema } from './schemas/ingredient.schema';
import { AiModule } from '../ai/ai.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NutrientDefinition.name, schema: NutrientDefinitionSchema },
      { name: Ingredient.name, schema: IngredientSchema },
    ]),
    AiModule,
    RedisModule,
  ],
  controllers: [FoodController],
  providers: [FoodService, FoodSeedService],
  exports: [FoodService],
})
export class FoodModule {}
