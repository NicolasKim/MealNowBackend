import { Resolver, Subscription, Mutation, Args } from '@nestjs/graphql';
import { Inject, Logger } from '@nestjs/common';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import { PUB_SUB } from '../../common/pubsub.module';

@Resolver()
export class NotificationResolver {
  private readonly logger = new Logger(NotificationResolver.name);

  constructor(@Inject(PUB_SUB) private readonly pubSub: RedisPubSub) {}

  @Subscription('taskCompleted', {
    resolve: (payload) => payload.taskCompleted,
    filter: (payload, variables) => {
        // Filter by userId if provided
        if (variables.userId) {
            return payload.taskCompleted.userId === variables.userId;
        }
        return true; 
    }
  })
  taskCompleted(@Args('userId') userId?: string) {
    return this.pubSub.asyncIterator('taskCompleted');
  }

  // @Mutation('testNotification')
  // async testNotification(@Args('userId') userId: string) {
  //   const payload = { 
  //       taskCompleted: { 
  //           userId, 
  //           taskId: 'test-' + Date.now(), 
  //           type: 'test', 
  //           status: 'completed', 
  //           data: { message: 'Test notification' } 
  //       } 
  //   };
  //   await this.pubSub.publish('taskCompleted', payload);
  //   return true;
  // }
}
