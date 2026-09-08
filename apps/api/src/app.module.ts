import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { APP_CONFIG, AppConfig, AppConfigModule } from '@/config';
import { CorrelationMiddleware } from '@/common/context/correlation.middleware';
import { GlobalExceptionFilter } from '@/common/errors/global-exception.filter';
import { LoggerModule } from '@/common/logging/logger.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { CryptoModule } from '@/infrastructure/crypto/crypto.module';
import { HealthModule } from '@/infrastructure/health/health.module';
import { OutboxModule } from '@/infrastructure/outbox/outbox.module';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { QueueModule } from '@/infrastructure/queue/queue.module';
import { RedisModule } from '@/infrastructure/redis/redis.module';
import { StorageModule } from '@/infrastructure/storage/storage.module';
import { AnprModule } from '@/modules/anpr/anpr.module';
import { BillingModule } from '@/modules/billing/billing.module';
import { ContractModule } from '@/modules/contract/contract.module';
import { FinancierModule } from '@/modules/financier/financier.module';
import { IdentityModule } from '@/modules/identity/identity.module';
import { JobsModule } from '@/modules/jobs/jobs.module';
import { ParkingModule } from '@/modules/parking/parking.module';
import { RegistryModule } from '@/modules/registry/registry.module';
import { VehicleModule } from '@/modules/vehicle/vehicle.module';
import { JwtAuthGuard, PermissionsGuard } from '@/modules/identity/guards';

/**
 * Application composition root.
 *
 * The platform is a MODULAR MONOLITH (requirement S4): business modules have
 * hard boundaries and talk through domain events on the transactional outbox
 * rather than reaching into each other's tables, so any one of them can be
 * lifted into its own service later without rewriting the others.
 *
 * Three guards are registered globally, in this order:
 *   1. ThrottlerGuard    - rate limiting, before any work is done
 *   2. JwtAuthGuard      - authentication; routes are private unless @Public()
 *   3. PermissionsGuard  - authorisation against the permission catalogue
 *
 * Registering them globally means a new endpoint is protected by default.
 * Object-level scoping (site grants, financier isolation) is enforced inside
 * services, where the loaded record is available.
 */
@Module({
  imports: [
    // Infrastructure (all @Global)
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    StorageModule,
    QueueModule,
    OutboxModule,
    AuditModule,

    EventEmitterModule.forRoot({
      // Event names are dotted (`parking.session.opened`) so subscribers can
      // wildcard a whole area.
      wildcard: true,
      delimiter: '.',
      maxListeners: 50,
      verboseMemoryLeak: true,
    }),
    ScheduleModule.forRoot(),

    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimit.windowSeconds * 1000,
            limit: config.rateLimit.maxRequests,
          },
          {
            name: 'login',
            ttl: 60_000,
            limit: config.rateLimit.loginMax,
          },
          {
            name: 'anpr',
            ttl: 60_000,
            limit: config.rateLimit.anprMax,
          },
        ],
      }),
    }),

    // Business modules. Ordered as the vertical slices they implement:
    // identity, then topology and vehicles, then capture, then rating and
    // billing, then operations.
    HealthModule,
    IdentityModule,
    FinancierModule,
    RegistryModule,
    VehicleModule,
    ContractModule,
    BillingModule,
    ParkingModule,
    AnprModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs before everything so even a request rejected by the rate limiter
    // still has a correlation id in its log line and response header.
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
