import { Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { InvoiceModule } from '@/modules/invoice/invoice.module';
import { PaymentController } from './payment.controller';
import { PaymentProvider, ManualPaymentProvider, MockGatewayPaymentProvider } from './payment.provider';
import { PaymentService } from './payment.service';

/**
 * Binds the configured payment provider to the abstract token.
 *
 * `manual` is the Phase 1 default and is genuinely authoritative - counter
 * collection recorded by finance staff. `mock-gateway` exists so the
 * asynchronous webhook path can be exercised in development; the configuration
 * guard refuses to boot production with it.
 */
@Module({
  imports: [InvoiceModule],
  controllers: [PaymentController],
  providers: [
    ManualPaymentProvider,
    MockGatewayPaymentProvider,
    {
      provide: PaymentProvider,
      inject: [APP_CONFIG, ManualPaymentProvider, MockGatewayPaymentProvider],
      useFactory: (
        config: AppConfig,
        manual: ManualPaymentProvider,
        mock: MockGatewayPaymentProvider,
      ): PaymentProvider => (config.payment.provider === 'mock' ? mock : manual),
    },
    PaymentService,
  ],
  exports: [PaymentService, PaymentProvider],
})
export class PaymentModule {}
