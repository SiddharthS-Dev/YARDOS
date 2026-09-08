import { Module } from '@nestjs/common';

import { RateResolutionService } from './rate-resolution.service';

/**
 * Contracts and rating.
 *
 * Exports only the resolution service for now; contract authoring endpoints
 * live alongside it and share the same module boundary.
 */
@Module({
  providers: [RateResolutionService],
  exports: [RateResolutionService],
})
export class ContractModule {}
