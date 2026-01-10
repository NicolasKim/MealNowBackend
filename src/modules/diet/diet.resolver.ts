import { Args, Mutation, Query, Resolver } from '@nestjs/graphql'
import { UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { UserDocument } from '../auth/schemas/user.schema'
import { CurrentClientInfo, ClientInfo } from '../../common/decorators/client-info.decorator'
import { DietService } from './diet.service'

@Resolver()
export class DietResolver {
  constructor(private readonly diet: DietService) {}

  @Query('dietEntries')
  @UseGuards(JwtAuthGuard)
  async dietEntries(
    @CurrentUser() user: UserDocument,
    @Args('dateFrom') dateFrom: string,
    @Args('dateTo') dateTo: string
  ) {
    return this.diet.getEntries(user._id.toString(), dateFrom, dateTo)
  }

  @Query('dietEntriesByDate')
  @UseGuards(JwtAuthGuard)
  async dietEntriesByDate(@CurrentUser() user: UserDocument, @Args('date') date: string) {
    return this.diet.getEntriesByDate(user._id.toString(), date)
  }

  @Query('dietEntriesByMeal')
  @UseGuards(JwtAuthGuard)
  async dietEntriesByMeal(
    @CurrentUser() user: UserDocument,
    @Args('date') date: string,
    @Args('mealType') mealType: string
  ) {
    return this.diet.getEntriesByMeal(user._id.toString(), date, mealType)
  }

  @Query('dietNutritionByDate')
  @UseGuards(JwtAuthGuard)
  async dietNutritionByDate(
    @CurrentUser() user: UserDocument,
    @Args('date') date: string,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    return this.diet.getNutritionByDate(user._id.toString(), date, clientInfo.language)
  }

  @Query('dietNutritionByMeal')
  @UseGuards(JwtAuthGuard)
  async dietNutritionByMeal(
    @CurrentUser() user: UserDocument,
    @Args('date') date: string,
    @Args('mealType') mealType: string,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    return this.diet.getNutritionByMeal(user._id.toString(), date, mealType, clientInfo.language)
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
}
