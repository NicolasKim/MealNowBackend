import { Resolver, Query, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../auth/schemas/user.schema';

@Resolver()
export class BillingResolver {
  constructor(private readonly billingService: BillingService) {}

  @Query('billingConfig')
  async billingConfig() {
    return this.billingService.getBillingConfig();
  }

  @Query('usageHistory')
  @UseGuards(JwtAuthGuard)
  async usageHistory(
    @CurrentUser() user: UserDocument,
    @Args('limit') limit?: number,
    @Args('offset') offset?: number
  ) {
    return this.billingService.getUsageHistory(user._id.toString(), limit, offset);
  }
}
