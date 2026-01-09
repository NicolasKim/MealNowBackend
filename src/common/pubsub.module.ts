import { Global, Module } from '@nestjs/common';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { RedisService } from '../modules/redis/redis.service';
import { RedisModule } from '../modules/redis/redis.module';

export const PUB_SUB = 'PUB_SUB';

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: PUB_SUB,
      useFactory: (redisService: RedisService) => {
        return new RedisPubSub({
          publisher: redisService.get(),
          subscriber: redisService.duplicate(),
        });
      },
      inject: [RedisService],
    },
  ],
  exports: [PUB_SUB],
})
export class PubSubModule {}
