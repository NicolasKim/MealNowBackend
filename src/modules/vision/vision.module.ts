import { Module } from '@nestjs/common'
import { VisionController } from './vision.controller'
import { StorageModule } from '../storage/storage.module'
import { AiModule } from '../ai/ai.module'

import { BillingModule } from '../billing/billing.module'

@Module({
  imports: [StorageModule, AiModule, BillingModule],
  controllers: [VisionController]
})
export class VisionModule {}

