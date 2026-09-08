import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { FinancierMatcherService } from '@/modules/financier/financier-matcher.service';
import { AggregatorVehicleRegistryProvider } from './providers/aggregator-registry.provider';
import { MockVehicleRegistryProvider } from './providers/mock-registry.provider';
import { VehicleRegistryProvider } from './vehicle-registry.provider';
import { VehicleRegistryService } from './vehicle-registry.service';

/**
 * Binds the configured registry provider to the abstract token.
 *
 * Switching from the simulator to a licensed aggregator is a single
 * environment variable. No domain code changes, which is the whole point of
 * requirement S11.
 */
@Global()
@Module({
  providers: [
    MockVehicleRegistryProvider,
    AggregatorVehicleRegistryProvider,
    FinancierMatcherService,
    {
      provide: VehicleRegistryProvider,
      inject: [APP_CONFIG, MockVehicleRegistryProvider, AggregatorVehicleRegistryProvider],
      useFactory: (
        config: AppConfig,
        mock: MockVehicleRegistryProvider,
        aggregator: AggregatorVehicleRegistryProvider,
      ): VehicleRegistryProvider =>
        config.registry.provider === 'aggregator' ? aggregator : mock,
    },
    VehicleRegistryService,
  ],
  exports: [VehicleRegistryService, VehicleRegistryProvider, FinancierMatcherService],
})
export class RegistryModule {}
