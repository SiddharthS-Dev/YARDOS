import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobRunStatus } from '@prisma/client';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { JobName, QueueService } from '@/infrastructure/queue/queue.service';
import { ChargeService } from '@/modules/billing/charge.service';
import { VehicleRegistryService } from '@/modules/registry/vehicle-registry.service';

interface RegistryEnrichmentPayload {
  vehicleId: string;
  organizationId: string;
  normalizedRegistrationNumber: string;
  triggeredBy: string;
}

/**
 * Background work.
 *
 * Two kinds, deliberately separated:
 *
 *   QUEUE HANDLERS  React to something that just happened - a vehicle admitted
 *                   needs registry enrichment. Fast, per-item, retried by the
 *                   queue driver.
 *
 *   SWEEPS          Periodic reconciliation. These exist because a queue is
 *                   best-effort: if Redis was down when a vehicle was admitted,
 *                   the enqueue was lost, and only a sweep over the database
 *                   will find the work. The database, not the queue, is the
 *                   source of truth about what still needs doing.
 *
 * Every run is recorded in `job_runs` with counts and duration, so a job that
 * silently stops is visible rather than merely absent.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly registry: VehicleRegistryService,
    private readonly charges: ChargeService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Jobs');
  }

  onApplicationBootstrap(): void {
    this.queue.registerHandler<RegistryEnrichmentPayload>(
      JobName.REGISTRY_ENRICHMENT,
      async (payload) => {
        const request = await this.registry.requestEnrichment({
          vehicleId: payload.vehicleId,
          organizationId: payload.organizationId,
          normalizedRegistrationNumber: payload.normalizedRegistrationNumber,
          triggeredBy: payload.triggeredBy,
        });

        if (request.skipped || !request.lookupId) {
          this.logger.debug('Registry enrichment skipped', {
            vehicleId: payload.vehicleId,
            reason: request.reason,
          });
          return;
        }

        const result = await this.registry.executeLookup(request.lookupId);
        this.logger.debug('Registry enrichment finished', {
          vehicleId: payload.vehicleId,
          status: result.status,
          reason: result.reason,
        });
      },
    );

    this.logger.info('Job handlers registered', {
      workersEnabled: this.config.jobs.workersEnabled,
      driver: this.config.jobs.queueDriver,
    });
  }

  /**
   * Nightly charge accrual (requirement S14).
   *
   * Runs shortly after local midnight so a stay that crossed a calendar-day
   * boundary is priced for the new day. Idempotent: an unchanged inputs hash
   * writes no new calculation, so a retry or an overlapping run is harmless.
   */
  @Cron(process.env['JOB_CHARGE_ACCRUAL_CRON'] || '0 30 0 * * *', {
    name: 'charge-accrual',
    timeZone: 'Asia/Kolkata',
  })
  async chargeAccrual(): Promise<void> {
    if (!this.config.jobs.workersEnabled) return;

    await this.runTracked('charge-accrual', async () => {
      const organizations = await this.prisma.organization.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      let processed = 0;
      let failed = 0;
      for (const organization of organizations) {
        const result = await this.charges.runAccrual(organization.id);
        processed += result.processed;
        failed += result.failed;
      }
      return { itemsProcessed: processed, itemsFailed: failed };
    });
  }

  /**
   * Registry retry sweep.
   *
   * Picks up lookups the queue lost, that failed transiently, or that were
   * deferred because the circuit breaker was open.
   */
  @Cron('*/2 * * * *', { name: 'registry-retry' })
  async registryRetrySweep(): Promise<void> {
    if (!this.config.jobs.workersEnabled) return;

    const due = await this.registry.findDueLookups(25);
    if (due.length === 0) return;

    await this.runTracked('registry-retry', async () => {
      let processed = 0;
      let failed = 0;
      for (const lookupId of due) {
        const result = await this.registry.executeLookup(lookupId);
        if (result.status === 'SUCCEEDED') processed++;
        else failed++;
      }
      return { itemsProcessed: processed, itemsFailed: failed };
    });
  }

  /**
   * Finds vehicles admitted without registry enrichment.
   *
   * The safety net for the gate's never-block rule: if the enqueue was lost,
   * this catches the vehicle within the hour rather than leaving it
   * permanently unenriched.
   */
  @Cron('0 */15 * * * *', { name: 'registry-backfill' })
  async registryBackfill(): Promise<void> {
    if (!this.config.jobs.workersEnabled) return;

    const candidates = await this.prisma.vehicle.findMany({
      where: {
        vahanVerificationStatus: 'NOT_REQUESTED',
        // Only vehicles seen recently; an old unenriched record is a data
        // question, not an operational one, and backfilling the whole history
        // would burn aggregator quota.
        lastSeenAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      select: { id: true, organizationId: true, normalizedRegistrationNumber: true },
      take: 50,
    });

    if (candidates.length === 0) return;

    await this.runTracked('registry-backfill', async () => {
      for (const vehicle of candidates) {
        await this.queue.enqueue(
          JobName.REGISTRY_ENRICHMENT,
          {
            vehicleId: vehicle.id,
            organizationId: vehicle.organizationId,
            normalizedRegistrationNumber: vehicle.normalizedRegistrationNumber,
            triggeredBy: 'SCHEDULED_REFRESH',
          },
          { jobId: `registry-backfill:${vehicle.id}` },
        );
      }
      return { itemsProcessed: candidates.length, itemsFailed: 0 };
    });
  }

  /**
   * Expires idempotency records.
   *
   * One of the few tables where physical deletion is correct: these rows are
   * transient request bookkeeping, not business history.
   */
  @Cron('0 0 * * * *', { name: 'idempotency-cleanup' })
  async idempotencyCleanup(): Promise<void> {
    if (!this.config.jobs.workersEnabled) return;

    const result = await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.debug('Expired idempotency records removed', { count: result.count });
    }
  }

  /** Removes refresh tokens that expired more than 30 days ago. */
  @Cron('0 15 3 * * *', { name: 'token-cleanup' })
  async tokenCleanup(): Promise<void> {
    if (!this.config.jobs.workersEnabled) return;

    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.info('Expired refresh tokens removed', { count: result.count });
    }
  }

  /**
   * Runs a job under a fresh request context and records the outcome.
   *
   * The `job_runs` row is written even on failure, which is what makes "the
   * accrual has not succeeded for three nights" a question the console can
   * answer.
   */
  private async runTracked(
    jobName: string,
    work: () => Promise<{ itemsProcessed: number; itemsFailed: number }>,
    triggeredBy = 'SCHEDULE',
  ): Promise<void> {
    const context = RequestContextStore.forJob(jobName);

    await RequestContextStore.run(context, async () => {
      const run = await this.prisma.jobRun.create({
        data: {
          jobName,
          status: JobRunStatus.RUNNING,
          triggeredBy,
          correlationId: context.correlationId,
        },
      });

      const started = Date.now();
      try {
        const result = await work();
        await this.prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: result.itemsFailed > 0 ? JobRunStatus.FAILED : JobRunStatus.SUCCEEDED,
            finishedAt: new Date(),
            durationMs: Date.now() - started,
            itemsProcessed: result.itemsProcessed,
            itemsFailed: result.itemsFailed,
          },
        });
        this.logger.info('Job finished', { jobName, ...result, durationMs: Date.now() - started });
      } catch (error) {
        await this.prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: JobRunStatus.FAILED,
            finishedAt: new Date(),
            durationMs: Date.now() - started,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
          },
        });
        this.logger.error('Job failed', error, { jobName });
      }
    });
  }

  /** Manual trigger, used by the admin console and by tests. */
  async trigger(jobName: string, actorId: string): Promise<{ triggered: string }> {
    switch (jobName) {
      case 'charge-accrual':
        await this.runTracked('charge-accrual', async () => {
          const organizations = await this.prisma.organization.findMany({
            where: { isActive: true },
            select: { id: true },
          });
          let processed = 0;
          let failed = 0;
          for (const organization of organizations) {
            const result = await this.charges.runAccrual(organization.id);
            processed += result.processed;
            failed += result.failed;
          }
          return { itemsProcessed: processed, itemsFailed: failed };
        }, `MANUAL:${actorId}`);
        break;

      case 'registry-retry':
        await this.registryRetrySweep();
        break;

      case 'registry-backfill':
        await this.registryBackfill();
        break;

      default:
        throw new Error(`Unknown job "${jobName}".`);
    }
    return { triggered: jobName };
  }
}
