import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { AiModule } from '../ai/ai.module'
import { RedisModule } from '../redis/redis.module'
import { RecipeModule } from '../recipe/recipe.module'
import { DietResolver } from './diet.resolver'
import { DietService } from './diet.service'
import { DietEntry, DietEntrySchema } from './schemas/diet-entry.schema'
import { DietLimit, DietLimitSchema } from './schemas/diet-limit.schema'
import { NutrientDefinition, NutrientDefinitionSchema } from '../food/schemas/nutrient-definition.schema'
import { User, UserSchema } from '../auth/schemas/user.schema'
import { FoodModule } from '../food/food.module'
import { PubSubModule } from '../../common/pubsub.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DietEntry.name, schema: DietEntrySchema },
      { name: DietLimit.name, schema: DietLimitSchema },
      { name: NutrientDefinition.name, schema: NutrientDefinitionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
    AiModule,
    RedisModule,
    FoodModule,
    PubSubModule,
    RecipeModule
  ],
  providers: [DietResolver, DietService],
})
export class DietModule {}
