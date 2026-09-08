import { Module } from '@nestjs/common';

import { ContractModule } from '@/modules/contract/contract.module';
import { ChargeService } from './charge.service';

@Module({
  imports: [ContractModule],
  providers: [ChargeService],
  exports: [ChargeService],
})
export class BillingModule {}
