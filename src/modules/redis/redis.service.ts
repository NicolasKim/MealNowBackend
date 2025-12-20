import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis
  private readonly logger = new Logger(RedisService.name)

  onModuleInit() {
    const uri = process.env.REDIS_URI || 'redis://127.0.0.1:6379'
    this.logger.log(`Connecting to Redis...`)
    this.client = new Redis(uri)
    
    this.client.on('connect', () => {
      this.logger.log('Redis connected successfully')
    })

    this.client.on('error', (err) => {
      this.logger.error('Redis connection failed:', err)
    })
  }

  onModuleDestroy() {
    if (this.client) this.client.disconnect()
  }

  get() {
    return this.client
  }
}
