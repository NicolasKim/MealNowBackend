import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';
import { PubSubModule } from '../../common/pubsub.module';
import { User, UserSchema } from '../auth/schemas/user.schema';

@Module({
  imports: [
    PubSubModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])
  ],
  providers: [NotificationService, NotificationResolver],
  exports: [NotificationService],
})
export class NotificationModule {}
