import { Args, Mutation, Query, Resolver, ResolveField, Parent, Subscription } from '@nestjs/graphql'
import { UseGuards, Inject } from '@nestjs/common'
import { RedisPubSub } from 'graphql-redis-subscriptions'
import { PUB_SUB } from '../../common/pubsub.module'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { UserDocument } from '../auth/schemas/user.schema'
import { CurrentClientInfo, ClientInfo } from '../../common/decorators/client-info.decorator'
import { DietService } from './diet.service'
import { DietNutritionItem, DietEntryDocument } from './schemas/diet-entry.schema'
import { LocalizedText } from '../food/schemas/nutrient-definition.schema'

export interface GroupedNutrition {
  category: string
  categoryName: LocalizedText
  categoryOrder: number
  items: DietNutritionItem[]
}

@Resolver('DietEntry')
export class DietResolver {
  constructor(
    private readonly diet: DietService,
    @Inject(PUB_SUB) private readonly pubSub: RedisPubSub
  ) {}

  @ResolveField('nutrition')
  getNutrition(@Parent() dietEntry: DietEntryDocument) {
    return dietEntry.nutritions
  }

  private groupNutrition(items: DietNutritionItem[]): GroupedNutrition[] {
    const groups = new Map<string, GroupedNutrition>()

    for (const item of items) {
      if (!groups.has(item.category)) {
        groups.set(item.category, {
          category: item.category,
          categoryName: item.categoryName,
          categoryOrder: item.categoryOrder,
          items: [],
        })
      }
      groups.get(item.category)!.items.push(item)
    }

    const result = Array.from(groups.values())

    // Sort categories by categoryOrder
    result.sort((a, b) => a.categoryOrder - b.categoryOrder)

    // Sort items within categories by typeOrder
    result.forEach((group) => {
      group.items.sort((a, b) => a.typeOrder - b.typeOrder)
    })

    return result
  }

  @Query('dietNutritionByDate')
  @UseGuards(JwtAuthGuard)
  async dietNutritionByDate(
    @CurrentUser() user: UserDocument,
    @Args('date') date: string
  ): Promise<GroupedNutrition[]> {
    const items = await this.diet.getNutritionByDate(user._id.toString(), date)
    return this.groupNutrition(items)
  }

  @Query('dietNutritionByMeal')
  @UseGuards(JwtAuthGuard)
  async dietNutritionByMeal(
    @CurrentUser() user: UserDocument,
    @Args('date') date: string,
    @Args('mealType') mealType: string
  ): Promise<GroupedNutrition[]> {
    const items = await this.diet.getNutritionByMeal(user._id.toString(), date, mealType)
    return this.groupNutrition(items)
  }

  @Query('dietMealStatus')
  @UseGuards(JwtAuthGuard)
  async dietMealStatus(
    @CurrentUser() user: UserDocument,
    @Args('dateFrom') dateFrom: string,
    @Args('dateTo') dateTo: string
  ) {
    return this.diet.getMealStatus(user._id.toString(), dateFrom, dateTo)
  }

  @Mutation('logRecipeNutrition')
  @UseGuards(JwtAuthGuard)
  async logRecipeNutrition(
    @CurrentUser() user: UserDocument,
    @Args('recipeId') recipeId: string,
    @Args('date') date: string,
    @Args('mealType') mealType: string,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    return this.diet.logRecipeNutrition(user._id.toString(), recipeId, date, mealType, clientInfo.language)
  }

  @Mutation('generateDietLimits')
  @UseGuards(JwtAuthGuard)
  async generateDietLimits(
    @CurrentUser() user: UserDocument,
    @Args('input') input?: any
  ): Promise<any[]> {
    // Returns list of nutrients to be generated
    return this.diet.generateDietLimits(user._id.toString(), input)
  }

  @Subscription('dietLimitGenerationProgress')
  dietLimitGenerationProgress() {
    return this.pubSub.asyncIterator('dietLimitGenerationProgress')
  }
}
