import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PreferenceResolver } from './preference.resolver';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { AuthModule } from '../auth/auth.module';

import { PreferenceService } from './preference.service';
import { TastePreference, TastePreferenceSchema } from './taste-preference.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: User.name, schema: UserSchema },
            { name: TastePreference.name, schema: TastePreferenceSchema }
        ]),
        AuthModule,
    ],
    providers: [PreferenceResolver, PreferenceService],
})
export class PreferenceModule { }
