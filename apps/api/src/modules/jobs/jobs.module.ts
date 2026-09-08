import { Module } from '@nestjs/common';

import { BillingModule } from '@/modules/billing/billing.module';
import { JobsService } from './jobs.service';

/**
 * Registers queue handlers and scheduled sweeps.
 *
 * Kept as its own module so a deployment can run web replicas with
 * WORKERS_ENABLED=false and dedicated worker replicas with it on, without any
 * other module needing to know.
 */
@Module({
  imports: [BillingModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
