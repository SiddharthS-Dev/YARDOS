import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger } from '@/common/logging/logger.service';
import {
  FilesystemObjectStorageService,
  ObjectStorageService,
  S3ObjectStorageService,
} from './object-storage';

/**
 * Binds the configured storage driver to the abstract `ObjectStorageService`
 * token. Nothing in the domain knows which driver it is talking to, which is
 * what makes the swap from MinIO to S3 a configuration change.
 */
@Global()
@Module({
  providers: [
    {
      provide: ObjectStorageService,
      inject: [APP_CONFIG, AppLogger],
      useFactory: (config: AppConfig, logger: AppLogger): ObjectStorageService =>
        config.storage.driver === 's3'
          ? new S3ObjectStorageService(config, logger)
          : new FilesystemObjectStorageService(config, logger),
    },
  ],
  exports: [ObjectStorageService],
})
export class StorageModule {}
