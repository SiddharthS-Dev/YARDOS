import { Module } from '@nestjs/common';

import { FinancierMatcherService } from './financier-matcher.service';

@Module({
  providers: [FinancierMatcherService],
  exports: [FinancierMatcherService],
})
export class FinancierModule {}
