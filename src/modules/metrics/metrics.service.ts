import { Injectable } from '@nestjs/common'

@Injectable()
export class MetricsService {
  record(name: string, value: number, tags?: Record<string, string>) {
    return true
  }
}
