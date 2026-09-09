import { Module } from '@nestjs/common';

import { BillingModule } from '@/modules/billing/billing.module';
import { BillingPartyService } from './billing-party.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';

@Module({
  imports: [BillingModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, BillingPartyService],
  exports: [InvoiceService, BillingPartyService],
})
export class InvoiceModule {}
