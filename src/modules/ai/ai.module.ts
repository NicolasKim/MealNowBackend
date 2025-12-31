import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AiService } from './ai.service'
import { RedisModule } from '../redis/redis.module'
import { StorageModule } from '../storage/storage.module'
import { Recipe, RecipeSchema } from '../recipe/schemas/recipe.schema'
import { NutrientDefinition, NutrientDefinitionSchema } from '../diet/schemas/nutrient-definition.schema'

@Module({
  imports: [
    RedisModule,
    StorageModule,
    MongooseModule.forFeature([
      { name: Recipe.name, schema: RecipeSchema },
      { name: NutrientDefinition.name, schema: NutrientDefinitionSchema },
    ])
  ],
  providers: [AiService],
  exports: [AiService]
})
export class AiModule {}
