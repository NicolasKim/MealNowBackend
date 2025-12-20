import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { PantryService, IngredientInput } from './pantry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BillingService } from '../billing/billing.service';
import { CurrentClientInfo, ClientInfo } from '../../common/decorators/client-info.decorator';

@Resolver()
export class PantryResolver {
  constructor(
    private readonly ai: AiService,
    private readonly pantryService: PantryService,
    private readonly billing: BillingService,
  ) {}

  @Mutation('recognizeIngredients')
  @UseGuards(JwtAuthGuard)
  async recognizeIngredients(
    @Args('imageUrl') imageUrl: string, 
    @CurrentUser() user: any,
    @CurrentClientInfo() clientInfo: ClientInfo
  ) {
    const hasQuota = await this.billing.checkAndConsumeQuota(String(user._id), 'recognize_ingredients');
    if (!hasQuota) {
      throw new ForbiddenException('QUOTA_EXCEEDED');
    }
    return this.ai.recognizeIngredientsFromImage(imageUrl, clientInfo.language);
  }

  @Query('pantry')
  @UseGuards(JwtAuthGuard)
  async pantry(@CurrentUser() user: any) {
    return this.pantryService.findAll(user._id.toString());
  }

  @Mutation('addIngredient')
  @UseGuards(JwtAuthGuard)
  async addIngredient(
    @CurrentUser() user: any,
    @Args('input') input: IngredientInput,
  ) {
    return this.pantryService.addIngredient(user._id.toString(), input);
  }

  @Mutation('updateIngredient')
  @UseGuards(JwtAuthGuard)
  async updateIngredient(
    @CurrentUser() user: any,
    @Args('id') id: string,
    @Args('input') input: IngredientInput,
  ) {
    return this.pantryService.updateIngredient(user._id.toString(), id, input);
  }

  @Mutation('removeIngredient')
  @UseGuards(JwtAuthGuard)
  async removeIngredient(@CurrentUser() user: any, @Args('id') id: string) {
    return this.pantryService.removeIngredient(user._id.toString(), id);
  }
}
