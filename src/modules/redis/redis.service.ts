import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis
  private readonly logger = new Logger(RedisService.name)

  constructor() {
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

  onModuleInit() {
    // Client initialized in constructor
  }

  onModuleDestroy() {
    if (this.client) this.client.disconnect()
  }

  get() {
    return this.client
  }

  duplicate() {
    return this.client.duplicate()
  }

  async createTask(userId: string, taskId: string, type: string, name: string, metadata?: any) {
    const task = {
      id: taskId,
      userId,
      type,
      status: 'IN_PROGRESS',
      name,
      createdAt: new Date().toISOString(),
      data: null,
      message: null,
      metadata: metadata || null
    };
    
    const multi = this.client.multi();
    // Store task detail with 24h expiration
    multi.set(`task:${taskId}`, JSON.stringify(task), 'EX', 86400);
    // Add to user's task list (use LPUSH to put newest first)
    multi.lpush(`user:${userId}:tasks`, taskId);
    // Trim user list to keep only last 50 tasks
    multi.ltrim(`user:${userId}:tasks`, 0, 49);
    
    await multi.exec();
    return task;
  }

  async updateTask(taskId: string, status: string, data?: any, message?: string) {
    const key = `task:${taskId}`;
    const currentStr = await this.client.get(key);
    if (!currentStr) return null;

    const current = JSON.parse(currentStr);
    const updated = {
      ...current,
      status,
      data: data || current.data,
      message: message || current.message
    };

    await this.client.set(key, JSON.stringify(updated), 'EX', 86400);
    return updated;
  }

  async getUserTasks(userId: string) {
    // Get all task IDs
    const taskIds = await this.client.lrange(`user:${userId}:tasks`, 0, -1);
    if (!taskIds.length) return [];

    // Fetch all tasks
    const keys = taskIds.map(id => `task:${id}`);
    const tasksJson = await this.client.mget(keys);

    return tasksJson
      .filter(json => json !== null)
      .map(json => JSON.parse(json as string))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async deleteTask(userId: string, taskId: string) {
    const multi = this.client.multi();
    // Remove from user's task list
    multi.lrem(`user:${userId}:tasks`, 0, taskId);
    // Delete task detail
    multi.del(`task:${taskId}`);
    
    await multi.exec();
    return true;
  }
}
