import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { RedisService } from '@/infrastructure/redis/redis.service';

/**
 * Asynchronous work that must not block a request.
 *
 * The gate is the reason this exists. Requirement S9: admission must not wait
 * on a slow external system. Registry enrichment, notification delivery and PDF
 * rendering are therefore enqueued, and the vehicle goes through the gate.
 */
export const JobName = {
  /** VAHAN / aggregator enrichment for a newly captured vehicle. */
  REGISTRY_ENRICHMENT: 'registry.enrichment',
  /** Deliver one notification over SMS / email / WhatsApp. */
  NOTIFICATION_DISPATCH: 'notification.dispatch',
  /** Render an invoice PDF and attach it as a document. */
  INVOICE_PDF: 'invoice.pdf',
  /** Publish one outbox event to in-process subscribers. */
  OUTBOX_PUBLISH: 'outbox.publish',
  /** Recompute the accrued charge for one open parking session. */
  CHARGE_ACCRUAL_SESSION: 'charge.accrual.session',
} as const;
export type JobName = (typeof JobName)[keyof typeof JobName];

export interface EnqueueOptions {
  /**
   * Deduplication id. Enqueuing the same id twice while the first is still
   * pending is a no-op, which is what makes retried webhooks safe (S56).
   */
  jobId?: string;
  delayMs?: number;
  attempts?: number;
  /** Higher runs first. */
  priority?: number;
}

export type JobHandler<T> = (payload: T, meta: { attempt: number; jobId: string }) => Promise<void>;

/**
 * Queue abstraction.
 *
 * Two drivers:
 *   bullmq - Redis-backed, with retries, backoff and a dead-letter queue.
 *   inline - executes the handler immediately, in-process. Used by tests so a
 *            single assertion can observe the full effect of an operation
 *            without polling, and as a fallback when Redis is unavailable.
 *
 * The domain never knows which one it is using.
 */
export abstract class QueueService {
  abstract enqueue<T>(name: JobName, payload: T, options?: EnqueueOptions): Promise<void>;
  abstract registerHandler<T>(name: JobName, handler: JobHandler<T>): void;
  abstract stats(): Promise<Record<string, { waiting: number; active: number; failed: number }>>;
  abstract close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* BullMQ driver                                                       */
/* ------------------------------------------------------------------ */

@Injectable()
export class BullMqQueueService extends QueueService implements OnModuleDestroy {
  private readonly logger: ScopedLogger;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private readonly handlers = new Map<string, JobHandler<unknown>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
    logger: AppLogger,
  ) {
    super();
    this.logger = logger.forContext('Queue');
  }

  private queueFor(name: JobName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.redis.raw.options,
        prefix: `${this.config.redis.keyPrefix}:bull`,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          // Keep a window of history for diagnosis without unbounded growth.
          removeOnComplete: { age: 3600, count: 1000 },
          // Failures are kept far longer: they are the ones worth inspecting.
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue<T>(name: JobName, payload: T, options: EnqueueOptions = {}): Promise<void> {
    const correlationId = RequestContextStore.correlationId();
    try {
      await this.queueFor(name).add(
        name,
        { payload, correlationId },
        {
          ...(options.jobId ? { jobId: options.jobId } : {}),
          ...(options.delayMs ? { delay: options.delayMs } : {}),
          ...(options.attempts ? { attempts: options.attempts } : {}),
          ...(options.priority ? { priority: options.priority } : {}),
        },
      );
      this.logger.debug('Job enqueued', { job: name, jobId: options.jobId });
    } catch (error) {
      // Losing an async job must never fail the business operation that
      // triggered it. Registry enrichment and notifications are additionally
      // backed by database retry sweeps, so the work is recovered.
      this.logger.error('Failed to enqueue job; retry sweep will recover it', error, {
        job: name,
      });
    }
  }

  registerHandler<T>(name: JobName, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<unknown>);

    if (!this.config.jobs.workersEnabled) {
      this.logger.debug('Workers disabled on this replica; handler registered but idle', {
        job: name,
      });
      return;
    }
    if (this.workers.has(name)) return;

    const worker = new Worker(
      name,
      async (job: Job<{ payload: T; correlationId?: string }>) => {
        const context = RequestContextStore.forJob(name, job.data?.correlationId);
        await RequestContextStore.run(context, async () => {
          await handler(job.data.payload, {
            attempt: job.attemptsMade + 1,
            jobId: job.id ?? 'unknown',
          });
        });
      },
      {
        connection: this.redis.raw.options,
        prefix: `${this.config.redis.keyPrefix}:bull`,
        concurrency: 5,
      },
    );

    worker.on('failed', (job, error) => {
      const exhausted = (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 1);
      const detail = { job: name, jobId: job?.id, attempt: job?.attemptsMade };
      if (exhausted) {
        this.logger.error('Job exhausted all retries (dead-lettered)', error, detail);
      } else {
        this.logger.warn('Job attempt failed; will retry', { ...detail, error: String(error) });
      }
    });
    worker.on('error', (error) => {
      this.logger.error('Worker error', error, { job: name });
    });

    this.workers.set(name, worker);
    this.logger.info('Worker started', { job: name });
  }

  async stats(): Promise<Record<string, { waiting: number; active: number; failed: number }>> {
    const out: Record<string, { waiting: number; active: number; failed: number }> = {};
    for (const [name, queue] of this.queues) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'failed');
        out[name] = {
          waiting: counts['waiting'] ?? 0,
          active: counts['active'] ?? 0,
          failed: counts['failed'] ?? 0,
        };
      } catch {
        out[name] = { waiting: -1, active: -1, failed: -1 };
      }
    }
    return out;
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      ...Array.from(this.workers.values()).map((w) => w.close()),
      ...Array.from(this.queues.values()).map((q) => q.close()),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}

/* ------------------------------------------------------------------ */
/* Inline driver (tests, and Redis-less fallback)                      */
/* ------------------------------------------------------------------ */

@Injectable()
export class InlineQueueService extends QueueService {
  private readonly logger: ScopedLogger;
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly seenJobIds = new Set<string>();

  constructor(logger: AppLogger) {
    super();
    this.logger = logger.forContext('InlineQueue');
  }

  async enqueue<T>(name: JobName, payload: T, options: EnqueueOptions = {}): Promise<void> {
    // Honour jobId de-duplication so tests exercise the same idempotency the
    // real driver provides.
    if (options.jobId) {
      const key = `${name}:${options.jobId}`;
      if (this.seenJobIds.has(key)) return;
      this.seenJobIds.add(key);
    }

    const handler = this.handlers.get(name);
    if (!handler) {
      this.logger.debug('No handler registered for job; dropped', { job: name });
      return;
    }

    const context = RequestContextStore.forJob(name, RequestContextStore.correlationId());
    try {
      await RequestContextStore.run(context, () =>
        handler(payload, { attempt: 1, jobId: options.jobId ?? 'inline' }),
      );
    } catch (error) {
      // Mirrors the async driver: the caller's transaction has already
      // committed, so a handler failure must not propagate.
      this.logger.error('Inline job handler failed', error, { job: name });
    }
  }

  registerHandler<T>(name: JobName, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<unknown>);
  }

  async stats(): Promise<Record<string, { waiting: number; active: number; failed: number }>> {
    return {};
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.seenJobIds.clear();
  }
}
