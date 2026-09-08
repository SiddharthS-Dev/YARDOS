import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';

/**
 * Redis access for short-lived, reconstructible state only.
 *
 * Deliberate rule: nothing here is a system of record. ANPR de-duplication
 * windows, rate-limit counters, reference-data caches and circuit-breaker state
 * all degrade safely if Redis is empty or unavailable - the database remains
 * the authority. That is why `withLock` and the cache helpers fail open rather
 * than taking the API down with them.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: ScopedLogger;
  private client: Redis;
  private available = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Redis');
    this.client = new Redis(config.redis.url, {
      keyPrefix: `${config.redis.keyPrefix}:`,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.client.on('error', (error) => {
      if (this.available) {
        this.logger.warn('Redis connection error', { message: error.message });
      }
      this.available = false;
    });
    this.client.on('ready', () => {
      this.available = true;
      this.logger.info('Redis connection ready');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.available = true;
    } catch (error) {
      // Non-fatal: the platform runs without Redis, just without caching and
      // with the queue driver degraded. Failing to boot would be worse.
      this.logger.warn('Redis unavailable at startup; continuing without cache', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /** The raw client, for BullMQ and other libraries that need one. */
  get raw(): Redis {
    return this.client;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async ping(): Promise<number> {
    const started = Date.now();
    await this.client.ping();
    return Date.now() - started;
  }

  async get(key: string): Promise<string | null> {
    if (!this.available) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.available) return;
    try {
      if (ttlSeconds && ttlSeconds > 0) await this.client.set(key, value, 'EX', ttlSeconds);
      else await this.client.set(key, value);
    } catch (error) {
      this.logger.debug('Redis set failed; continuing', {
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.available || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      // Cache eviction failure is not actionable; the TTL will clear it.
    }
  }

  /**
   * Sets the key only if it does not exist.
   *
   * Returns true when this caller won the race. This is the primitive behind
   * ANPR de-duplication windows: the first frame of a vehicle wins, subsequent
   * frames inside the window are recognised as the same physical arrival.
   *
   * Fails OPEN (returns true) when Redis is down, because the database unique
   * index on `dedupeKey` is the real guarantee - Redis only saves the round
   * trip.
   */
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.available) return true;
    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return true;
    }
  }

  /** Atomic counter with expiry, used by rate limiters. */
  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    if (!this.available) return 0;
    try {
      const pipeline = this.client.multi();
      pipeline.incr(key);
      pipeline.expire(key, ttlSeconds, 'NX');
      const results = await pipeline.exec();
      const value = results?.[0]?.[1];
      return typeof value === 'number' ? value : 0;
    } catch {
      return 0;
    }
  }

  /** Reads through a JSON cache, populating it on a miss. */
  async cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const hit = await this.get(key);
    if (hit !== null) {
      try {
        return JSON.parse(hit) as T;
      } catch {
        await this.del(key);
      }
    }
    const value = await loader();
    await this.set(key, JSON.stringify(value), ttlSeconds);
    return value;
  }

  /** Invalidates every key under a prefix. Used when reference data changes. */
  async invalidatePrefix(prefix: string): Promise<void> {
    if (!this.available) return;
    const match = `${this.config.redis.keyPrefix}:${prefix}*`;
    try {
      // SCAN rather than KEYS: KEYS blocks the server, which is unacceptable
      // on a shared instance.
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          // Strip the prefix; ioredis re-applies it via keyPrefix.
          const stripped = keys.map((k) => k.slice(this.config.redis.keyPrefix.length + 1));
          await this.client.del(...stripped);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logger.debug('Cache invalidation failed', {
        prefix,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
