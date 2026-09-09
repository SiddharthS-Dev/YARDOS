import { Module } from '@nestjs/common';

import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { VehicleModule } from '@/modules/vehicle/vehicle.module';
import { AuctionController } from './auction.controller';
import { AuctionService } from './auction.service';

@Module({
  imports: [VehicleModule, InvoiceModule],
  controllers: [AuctionController],
  providers: [AuctionService],
  exports: [AuctionService],
})
export class AuctionModule {}
