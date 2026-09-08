import { Global, Module } from '@nestjs/common';

import { AppLogger } from './logger.service';

/** Global so every provider can inject the logger without module plumbing. */
@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
