import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PantryResolver } from './pantry.resolver';
import { PantryService } from './pantry.service';
import { AiModule } from '../ai/ai.module';
import { PantryItem, PantryItemSchema } from './schemas/pantry-item.schema';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PantryItem.name, schema: PantryItemSchema }]),
    AiModule,
    AuthModule,
    BillingModule,
  ],
  providers: [PantryResolver, PantryService],
  exports: [PantryService],
})
export class PantryModule {}
