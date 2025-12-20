import { Module } from '@nestjs/common'
import { PaymentResolver } from './payment.resolver'
import { AppStoreService } from './app-store.service'

import { AppStoreWebhookController } from './app-store-webhook.controller'
import { BillingModule } from '../billing/billing.module'

@Module({ imports: [BillingModule], providers: [PaymentResolver, AppStoreService], controllers: [AppStoreWebhookController] })
export class PaymentModule { }
