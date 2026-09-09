import { Global, Module } from '@nestjs/common';

import { SettingsService } from './settings.service';

/**
 * Global: business configuration is read on hot paths across many modules
 * (release eligibility, gate admission, financier matching), and threading an
 * import through all of them would add noise without adding isolation.
 */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
