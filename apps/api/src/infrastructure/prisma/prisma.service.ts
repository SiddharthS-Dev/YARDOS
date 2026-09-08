import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { concurrentModification } from '@/common/errors/app-exception';

/**
 * Transaction client type. Every repository method accepts this so it can run
 * either standalone or enlisted in a caller's transaction - which is what makes
 * "admit the vehicle, open the session, write the timeline event and enqueue
 * the outbox message, all or nothing" expressible (requirement S55).
 */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Anything that can execute a query: the root client or a transaction. */
export type PrismaExecutor = PrismaClient | PrismaTransaction;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    logger: AppLogger,
  ) {
    super({
      datasources: { db: { url: config.database.url } },
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
        ...(config.log.level === 'trace' || config.log.level === 'debug'
          ? ([{ emit: 'event', level: 'query' }] as const)
          : []),
      ],
      errorFormat: config.isProduction ? 'minimal' : 'pretty',
    });

    this.logger = logger.forContext('Prisma');

    // Query logging is opt-in via LOG_LEVEL because it is high volume and can
    // contain business values; it is never enabled in production by default.
    if (config.log.level === 'trace' || config.log.level === 'debug') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$on('query', (event: Prisma.QueryEvent) => {
        if (event.duration > 200) {
          this.logger.debug('Slow query', {
            durationMs: event.duration,
            query: event.query.slice(0, 500),
          });
        }
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on('warn', (event: Prisma.LogEvent) => {
      this.logger.warn('Database warning', { message: event.message });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on('error', (event: Prisma.LogEvent) => {
      this.logger.error('Database error', undefined, { message: event.message });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // A runaway query must not hold a connection open indefinitely and starve
    // the gate endpoints, which have a hard latency budget.
    await this.$executeRawUnsafe(
      `SET statement_timeout = ${this.config.database.statementTimeoutMs}`,
    );
    this.logger.info('Database connection established', {
      statementTimeoutMs: this.config.database.statementTimeoutMs,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Database connection closed');
  }

  /** Liveness probe for the health endpoint. */
  async ping(): Promise<number> {
    const started = Date.now();
    await this.$queryRaw`SELECT 1`;
    return Date.now() - started;
  }

  /**
   * Runs `work` inside a transaction.
   *
   * SERIALIZABLE is not the default: it would make every gate admission
   * contend. Instead, correctness under concurrency comes from partial unique
   * indexes and optimistic version checks, which are cheaper and fail
   * deterministically. Callers that genuinely need serialisable ordering pass
   * the isolation level explicitly.
   */
  async transaction<T>(
    work: (tx: PrismaTransaction) => Promise<T>,
    options: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      timeoutMs?: number;
      maxWaitMs?: number;
    } = {},
  ): Promise<T> {
    return this.$transaction(work, {
      isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: options.timeoutMs ?? 15000,
      maxWait: options.maxWaitMs ?? 5000,
    });
  }

  /**
   * Runs `work` in a SERIALIZABLE transaction, retrying on serialisation
   * failures with exponential backoff.
   *
   * Reserved for the few places where lost-update anomalies are otherwise
   * possible and a unique index cannot express the rule - for example
   * allocating the next invoice number in a gap-free series.
   */
  async serializableTransaction<T>(
    work: (tx: PrismaTransaction) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
          maxWait: 5000,
        });
      } catch (error) {
        lastError = error;
        if (!isRetryableTransactionError(error) || attempt === maxRetries) throw error;
        const backoffMs = 25 * 2 ** (attempt - 1) + Math.floor(Math.random() * 25);
        this.logger.warn('Serialisation failure; retrying transaction', {
          attempt,
          maxRetries,
          backoffMs,
        });
        await sleep(backoffMs);
      }
    }
    throw lastError;
  }

  /**
   * Optimistic-locking update helper.
   *
   * Every mutable aggregate carries a `version`. This performs
   * `UPDATE ... WHERE id = ? AND version = ?` and raises
   * CONCURRENT_MODIFICATION when no row matched, which means another
   * transaction changed the record between our read and our write.
   *
   * @throws AppException CONCURRENT_MODIFICATION
   */
  async updateWithVersion<T>(
    tx: PrismaExecutor,
    model: VersionedModel,
    entityLabel: string,
    id: string,
    expectedVersion: number,
    data: Record<string, unknown>,
  ): Promise<T> {
    // `updateMany` is used rather than `update` because it returns a count and
    // does not throw on "no rows matched", letting us distinguish a version
    // conflict from a genuinely missing row.
    const delegate = (
      tx as unknown as Record<
        string,
        | {
            updateMany: (args: unknown) => Promise<{ count: number }>;
            findUnique: (args: unknown) => Promise<unknown>;
          }
        | undefined
      >
    )[model];

    if (!delegate) {
      throw new Error(`Unknown versioned model "${model}" passed to updateWithVersion.`);
    }

    const result = (await delegate.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    })) as { count: number };

    if (result.count === 0) {
      throw concurrentModification(entityLabel, id);
    }

    return (await delegate.findUnique({ where: { id } })) as T;
  }
}

/** Prisma delegate names that carry a `version` column. */
export type VersionedModel =
  | 'site'
  | 'parkingSpace'
  | 'user'
  | 'financier'
  | 'vehicle'
  | 'contract'
  | 'contractVersion'
  | 'ratePlan'
  | 'parkingSession'
  | 'invoice'
  | 'payment'
  | 'releaseRequest'
  | 'auction'
  | 'auctionLot'
  | 'auctionRegistration'
  | 'auctionSettlement'
  | 'bidder';

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: write conflict or deadlock detected.
    if (error.code === 'P2034') return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /could not serialize access|deadlock detected/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
