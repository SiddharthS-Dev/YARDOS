import { Module } from '@nestjs/common';

import { BillingModule } from '@/modules/billing/billing.module';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { ParkingModule } from '@/modules/parking/parking.module';
import { VehicleModule } from '@/modules/vehicle/vehicle.module';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';

@Module({
  imports: [BillingModule, InvoiceModule, ParkingModule, VehicleModule],
  controllers: [ReleaseController],
  providers: [ReleaseService],
  exports: [ReleaseService],
})
export class ReleaseModule {}
