import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OutboxStatus, Prisma } from '@prisma/client';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { PrismaExecutor, PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainEvent, DomainEventType } from './domain-events';

/**
 * Transactional outbox.
 *
 * The problem it solves: a business operation changes state AND needs to tell
 * the rest of the system. Doing both without a shared transaction gives two
 * failure modes, and both are real:
 *
 *   - publish then commit -> a subscriber reacts to something that was rolled
 *     back (an invoice emailed for a stay that never opened);
 *   - commit then publish -> the process dies in between and the reaction is
 *     lost forever (a vehicle admitted but never enriched).
 *
 * So the event row is written in the SAME transaction as the state change, and
 * a relay publishes it afterwards, at-least-once. Handlers must therefore be
 * idempotent - which is required of them anyway (S56).
 *
 * The relay currently publishes in-process via EventEmitter2. Moving to Kafka
 * or RabbitMQ means changing only `publish()`; no domain service is aware of
 * the transport (S5).
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger: ScopedLogger;
  private timer?: NodeJS.Timeout;
  private draining = false;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Outbox');
  }

  /**
   * Records an event. MUST be called with the caller's transaction client so
   * the event and the state change commit together.
   */
  async record<T extends Record<string, unknown>>(
    tx: PrismaExecutor,
    event: {
      eventType: DomainEventType;
      aggregateType: string;
      aggregateId: string;
      payload: T;
      correlationId?: string;
    },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as Prisma.InputJsonValue,
        correlationId: event.correlationId ?? RequestContextStore.correlationId(),
        status: OutboxStatus.PENDING,
        nextAttemptAt: new Date(),
      },
    });
  }

  /** Convenience for recording several events in one transaction. */
  async recordMany(
    tx: PrismaExecutor,
    events: Array<{
      eventType: DomainEventType;
      aggregateType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (events.length === 0) return;
    const correlationId = RequestContextStore.correlationId();
    await tx.outboxEvent.createMany({
      data: events.map((event) => ({
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as Prisma.InputJsonValue,
        correlationId,
        status: OutboxStatus.PENDING,
        nextAttemptAt: new Date(),
      })),
    });
  }

  onApplicationBootstrap(): void {
    if (!this.config.jobs.workersEnabled) {
      this.logger.info('Outbox relay disabled on this replica');
      return;
    }
    const interval = this.config.jobs.outboxRelayIntervalMs;
    this.timer = setInterval(() => {
      void this.drain();
    }, interval);
    // Do not hold the process open purely for the relay.
    this.timer.unref?.();
    this.logger.info('Outbox relay started', { intervalMs: interval });
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Publishes a batch of due events.
   *
   * Exposed so tests and the admin "flush now" endpoint can drive it
   * deterministically instead of sleeping.
   */
  async drain(batchSize = 100): Promise<{ published: number; failed: number }> {
    if (this.draining || this.stopped) return { published: 0, failed: 0 };
    this.draining = true;

    let published = 0;
    let failed = 0;

    try {
      // FOR UPDATE SKIP LOCKED lets several replicas relay concurrently without
      // any of them publishing the same event twice.
      const due = await this.prisma.$queryRaw<
        Array<{
          id: string;
          eventType: string;
          aggregateType: string;
          aggregateId: string;
          payload: unknown;
          correlationId: string;
          attempts: number;
          maxAttempts: number;
          occurredAt: Date;
        }>
      >`
        SELECT "id", "eventType", "aggregateType", "aggregateId", "payload",
               "correlationId", "attempts", "maxAttempts", "occurredAt"
        FROM "outbox_events"
        WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
        ORDER BY "occurredAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      for (const row of due) {
        const context = RequestContextStore.forJob('outbox-relay', row.correlationId);
        const outcome = await RequestContextStore.run(context, () => this.publishRow(row));
        if (outcome === 'published') published++;
        else failed++;
      }
    } catch (error) {
      this.logger.error('Outbox drain failed', error);
    } finally {
      this.draining = false;
    }

    return { published, failed };
  }

  private async publishRow(row: {
    id: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
    correlationId: string;
    attempts: number;
    maxAttempts: number;
    occurredAt: Date;
  }): Promise<'published' | 'failed'> {
    const event: DomainEvent = {
      eventType: row.eventType as DomainEventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      occurredAt: row.occurredAt,
      correlationId: row.correlationId,
    };

    try {
      // emitAsync so a handler that throws is observable here rather than
      // becoming an unhandled rejection.
      await this.emitter.emitAsync(row.eventType, event);

      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          status: OutboxStatus.PUBLISHED,
          publishedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      return 'published';
    } catch (error) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= row.maxAttempts;
      // Exponential backoff, capped at five minutes.
      const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));

      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          attempts,
          status: exhausted ? OutboxStatus.DEAD_LETTER : OutboxStatus.PENDING,
          nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 512),
        },
      });

      const detail = { eventType: row.eventType, aggregateId: row.aggregateId, attempts };
      if (exhausted) {
        this.logger.error('Outbox event dead-lettered after exhausting retries', error, detail);
      } else {
        this.logger.warn('Outbox event publish failed; will retry', { ...detail, error: String(error) });
      }
      return 'failed';
    }
  }

  /** Backlog metrics for the health endpoint and the admin console. */
  async backlog(): Promise<{ pending: number; deadLetter: number; oldestPendingAgeSeconds: number }> {
    const [pending, deadLetter, oldest] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: OutboxStatus.PENDING } }),
      this.prisma.outboxEvent.count({ where: { status: OutboxStatus.DEAD_LETTER } }),
      this.prisma.outboxEvent.findFirst({
        where: { status: OutboxStatus.PENDING },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ]);

    return {
      pending,
      deadLetter,
      oldestPendingAgeSeconds: oldest
        ? Math.floor((Date.now() - oldest.occurredAt.getTime()) / 1000)
        : 0,
    };
  }

  /** Requeues dead-lettered events after the underlying fault is fixed. */
  async replayDeadLetters(limit = 100): Promise<number> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { status: OutboxStatus.DEAD_LETTER },
      data: { status: OutboxStatus.PENDING, attempts: 0, nextAttemptAt: new Date() },
    });
    this.logger.info('Dead-lettered outbox events requeued', { count: result.count, limit });
    return result.count;
  }
}
