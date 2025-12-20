import { Module } from '@nestjs/common'
import { BillingService } from './billing.service'
import { MongooseModule } from '@nestjs/mongoose'
import { Subscription, SubscriptionSchema } from './schemas/subscription.schema'
import { UsageRecord, UsageRecordSchema } from './schemas/usage-record.schema'
import { UserSubscriptionResolver } from './user-subscription.resolver'
import { BillingResolver } from './billing.resolver'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: UsageRecord.name, schema: UsageRecordSchema }
    ])
  ],
  providers: [BillingService, UserSubscriptionResolver, BillingResolver],
  exports: [BillingService]
})
export class BillingModule {}
