import { Global, Module } from '@nestjs/common';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';

export const PUB_SUB = 'PUB_SUB';

@Global()
@Module({
  providers: [
    {
      provide: PUB_SUB,
      useFactory: () => {
        return new RedisPubSub({
          publisher: new Redis(process.env.REDIS_URI || 'redis://localhost:6379'),
          subscriber: new Redis(process.env.REDIS_URI || 'redis://localhost:6379'),
        });
      },
    },
  ],
  exports: [PUB_SUB],
})
export class PubSubModule {}
