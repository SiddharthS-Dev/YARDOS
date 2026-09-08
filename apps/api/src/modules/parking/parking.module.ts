import { Module, forwardRef } from '@nestjs/common';

import { BillingModule } from '@/modules/billing/billing.module';
import { ContractModule } from '@/modules/contract/contract.module';
import { VehicleModule } from '@/modules/vehicle/vehicle.module';
import { GateService } from './gate.service';
import { ParkingController } from './parking.controller';
import { ParkingSessionService } from './parking-session.service';

@Module({
  imports: [VehicleModule, ContractModule, forwardRef(() => BillingModule)],
  controllers: [ParkingController],
  providers: [GateService, ParkingSessionService],
  exports: [GateService, ParkingSessionService],
})
export class ParkingModule {}
