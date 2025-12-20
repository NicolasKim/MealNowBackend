import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { GraphQLModule } from '@nestjs/graphql'
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo'
import { MongooseModule } from '@nestjs/mongoose'
import { ScheduleModule } from '@nestjs/schedule'
import { AiModule } from './modules/ai/ai.module'
import { ServeStaticModule } from '@nestjs/serve-static'
import * as path from 'path'
import { StorageModule } from './modules/storage/storage.module'
import { VisionModule } from './modules/vision/vision.module'
import { RecipeModule } from './modules/recipe/recipe.module'
import { PantryModule } from './modules/pantry/pantry.module'
import { PreferenceModule } from './modules/preference/preference.module'
import { ShoppingModule } from './modules/shopping/shopping.module'
import { PaymentModule } from './modules/payment/payment.module'
import { RedisModule } from './modules/redis/redis.module'
import { MetricsModule } from './modules/metrics/metrics.module'
import { BillingModule } from './modules/billing/billing.module'
import { AuthModule } from './modules/auth/auth.module'
import { User, UserSchema } from './modules/auth/schemas/user.schema'
import { TimezoneInterceptor } from './common/interceptors/timezone.interceptor'
import { AcceptLanguageResolver, I18nModule, QueryResolver, HeaderResolver } from 'nestjs-i18n';

@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(__dirname, '/i18n/'),
        watch: true,
      },
      resolvers: [
        new HeaderResolver(['x-user-language']),
        { use: QueryResolver, options: ['lang'] },
        AcceptLanguageResolver,
      ],
    }),
    ServeStaticModule.forRoot({

      rootPath: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
      serveRoot: '/static'
    }, {
      rootPath: path.resolve(__dirname, '..', 'public'),
      serveRoot: '/legal'
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: false,
      typePaths: ['./src/graphql/*.graphql'],
      path: '/graphql',
      subscriptions: {
        'graphql-ws': true
      }
    }),
    MongooseModule.forRoot(process.env.MONGO_URI || 'mongodb://localhost:27017/cuisine'),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    ScheduleModule.forRoot(),
    AuthModule,
    RedisModule,
    MetricsModule,
    AiModule,
    RecipeModule,
    PantryModule,
    PreferenceModule,
    ShoppingModule,
    PaymentModule,
    BillingModule,
    StorageModule,
    VisionModule
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TimezoneInterceptor,
    },
  ],
})
export class AppModule { }
