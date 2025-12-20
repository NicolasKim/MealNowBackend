import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';
import { PubSubModule } from '../../common/pubsub.module';

@Module({
  imports: [PubSubModule],
  providers: [NotificationService, NotificationResolver],
  exports: [NotificationService],
})
export class NotificationModule {}
