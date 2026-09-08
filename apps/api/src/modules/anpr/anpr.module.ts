import { Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { ParkingModule } from '@/modules/parking/parking.module';
import { AnprController } from './anpr.controller';
import { AnprIngestionService } from './anpr-ingestion.service';
import { AnprProvider } from './anpr.provider';
import { GenericWebhookAnprProvider } from './providers/generic-webhook.provider';
import { MockAnprProvider } from './providers/mock-anpr.provider';

/**
 * Binds the configured ANPR adapter to the abstract token, so no domain code
 * knows which camera vendor is in front of it (requirement S10).
 */
@Module({
  imports: [ParkingModule],
  controllers: [AnprController],
  providers: [
    MockAnprProvider,
    GenericWebhookAnprProvider,
    {
      provide: AnprProvider,
      inject: [APP_CONFIG, MockAnprProvider, GenericWebhookAnprProvider],
      useFactory: (
        config: AppConfig,
        mock: MockAnprProvider,
        webhook: GenericWebhookAnprProvider,
      ): AnprProvider => (config.anpr.provider === 'mock' ? mock : webhook),
    },
    AnprIngestionService,
  ],
  exports: [AnprIngestionService, AnprProvider, MockAnprProvider],
})
export class AnprModule {}
