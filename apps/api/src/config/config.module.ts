import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig, loadConfiguration } from './configuration';

/**
 * Loads and validates configuration exactly once, at process start.
 *
 * Global so that any provider can inject `APP_CONFIG` without importing a
 * module; configuration is genuinely cross-cutting and injecting it beats
 * reading `process.env` from a hundred places (which would be untestable and
 * unvalidated).
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfiguration(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
