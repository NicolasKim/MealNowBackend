import * as dotenv from 'dotenv'
dotenv.config({ path: process.env.ENV_FILE || '.env' })
// Polyfill crypto for Node < 19
if (!global.crypto) {
  // @ts-ignore
  global.crypto = require('crypto');
}
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import * as express from 'express'
import { Logger } from '@nestjs/common'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.enableCors({
    origin: true,
    credentials: true
  })
  
  // App Store Webhook 可能会比较大，增加 limit
  app.use(express.json({
    limit: '10mb',
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    }
  }))
  app.use(express.urlencoded({ extended: true, limit: '10mb' }))

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000, '0.0.0.0')
  Logger.log(`Application is running on: ${await app.getUrl()}`, 'Bootstrap');
}

bootstrap()
