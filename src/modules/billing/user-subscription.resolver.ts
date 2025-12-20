import { Resolver, ResolveField, Parent } from '@nestjs/graphql'
import { BillingService } from './billing.service'
import { UserDocument } from '../auth/schemas/user.schema'

@Resolver('User')
export class UserSubscriptionResolver {
  constructor(private readonly billing: BillingService) {}

  @ResolveField('subscription')
  async subscription(@Parent() user: UserDocument) {
    return this.billing.getUserSubscription(String(user._id))
  }

  @ResolveField('usage')
  async usage(@Parent() user: UserDocument) {
    return this.billing.getUserStats(String(user._id))
  }
}

