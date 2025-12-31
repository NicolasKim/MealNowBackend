import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { AiModule } from '../ai/ai.module'
import { RedisModule } from '../redis/redis.module'
import { Recipe, RecipeSchema } from '../recipe/schemas/recipe.schema'
import { DietResolver } from './diet.resolver'
import { DietSeedService } from './diet.seed.service'
import { DietService } from './diet.service'
import { DietEntry, DietEntrySchema } from './schemas/diet-entry.schema'
import { NutrientDefinition, NutrientDefinitionSchema } from './schemas/nutrient-definition.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DietEntry.name, schema: DietEntrySchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: NutrientDefinition.name, schema: NutrientDefinitionSchema },
    ]),
    AuthModule,
    AiModule,
    RedisModule,
  ],
  providers: [DietResolver, DietService, DietSeedService],
})
export class DietModule {}
