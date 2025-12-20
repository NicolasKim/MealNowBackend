import { Module } from '@nestjs/common'
import { VisionController } from './vision.controller'
import { StorageModule } from '../storage/storage.module'
import { AiModule } from '../ai/ai.module'

@Module({
  imports: [StorageModule, AiModule],
  controllers: [VisionController]
})
export class VisionModule {}

