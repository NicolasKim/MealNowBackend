import { Module } from '@nestjs/common'
import { AppStoreService } from './app-store.service'

import { AppStoreWebhookController } from './app-store-webhook.controller'
import { RevenueCatWebhookController } from './revenue-cat-webhook.controller'
import { BillingModule } from '../billing/billing.module'

@Module({ imports: [BillingModule], providers: [AppStoreService], controllers: [AppStoreWebhookController, RevenueCatWebhookController] })
export class PaymentModule { }
