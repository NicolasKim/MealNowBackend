import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { User, UserSchema } from '../auth/schemas/user.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    ],
    controllers: [EmailController],
    providers: [EmailService],
    exports: [EmailService],
})
export class EmailModule {}
