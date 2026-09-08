import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger } from '@/common/logging/logger.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { BullMqQueueService, InlineQueueService, QueueService } from './queue.service';

@Global()
@Module({
  providers: [
    {
      provide: QueueService,
      inject: [APP_CONFIG, RedisService, AppLogger],
      useFactory: (config: AppConfig, redis: RedisService, logger: AppLogger): QueueService => {
        // Falling back to inline when Redis is down keeps the platform working
        // (synchronously, more slowly) instead of silently dropping every
        // enrichment and notification.
        if (config.jobs.queueDriver === 'inline' || !redis.isAvailable) {
          return new InlineQueueService(logger);
        }
        return new BullMqQueueService(config, redis, logger);
      },
    },
  ],
  exports: [QueueService],
})
export class QueueModule {}
