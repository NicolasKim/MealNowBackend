import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { RecipeResolver } from './recipe.resolver'
import { UserRecipeResolver } from './user-recipe.resolver'
import { RecipeSchedulerService } from './recipe.scheduler'
import { RecipeService } from './recipe.service'
import { AiModule } from '../ai/ai.module'
import { PantryModule } from '../pantry/pantry.module'
import { StorageModule } from '../storage/storage.module'
import { BillingModule } from '../billing/billing.module'
import { NotificationModule } from '../notification/notification.module'
import { PubSubModule } from '../../common/pubsub.module'
import { User, UserSchema } from '../auth/schemas/user.schema'
import { Recipe, RecipeSchema } from './schemas/recipe.schema'

@Module({ 
  imports: [
    AiModule, 
    PantryModule, 
    StorageModule,
    BillingModule,
    NotificationModule,
    PubSubModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Recipe.name, schema: RecipeSchema }
    ])
  ], 
  providers: [RecipeResolver, UserRecipeResolver, RecipeSchedulerService, RecipeService],
  exports: [RecipeService]
})
export class RecipeModule {}
