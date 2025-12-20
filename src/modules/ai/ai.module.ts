import { Module } from '@nestjs/common'
import { AiService } from './ai.service'
import { RedisModule } from '../redis/redis.module'
import { StorageModule } from '../storage/storage.module'

@Module({ imports: [RedisModule, StorageModule], providers: [AiService], exports: [AiService] })
export class AiModule {}
