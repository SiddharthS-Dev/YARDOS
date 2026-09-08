import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthComponent, HealthResponse } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { Public } from '@/common/decorators/auth.decorators';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { ObjectStorageService } from '@/infrastructure/storage/object-storage';
import { OutboxService } from '@/infrastructure/outbox/outbox.service';

/**
 * Health and readiness.
 *
 * Three distinct endpoints because orchestrators need different answers:
 *
 *   /health/live   - is the process alive? Never touches a dependency, so a
 *                    database blip cannot cause Kubernetes to kill and restart
 *                    every pod at once and turn an outage into an outage plus
 *                    a thundering herd.
 *   /health/ready  - should this replica receive traffic? Fails when the
 *                    database is unreachable, since it can serve nothing.
 *   /health        - full component detail for dashboards and on-call.
 *
 * Deliberately public and deliberately terse: it reveals whether components are
 * up, never versions of dependencies, connection strings or credentials.
 */
@ApiTags('Health')
// VERSION_NEUTRAL: orchestrator probes and uptime monitors must not have to be
// reconfigured when the API version changes, so these live at /health, not
// /v1/health.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: ObjectStorageService,
    private readonly outbox: OutboxService,
  ) {}

  @Public()
  @Get('live')
  @ApiExcludeEndpoint()
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: this.uptimeSeconds() };
  }

  @Public()
  @Get('ready')
  @ApiExcludeEndpoint()
  async ready(): Promise<{ status: 'ok' | 'error'; database: 'up' | 'down' }> {
    try {
      await this.prisma.ping();
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'error', database: 'down' };
    }
  }

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Component health',
    description:
      'Reports each dependency. `degraded` means the platform still works but with reduced ' +
      'capability - for example Redis down disables caching but not gate operations.',
  })
  async health(): Promise<HealthResponse> {
    const components = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
      this.checkOutbox(),
    ]);

    const hasDown = components.some((c) => c.status === 'down');
    const hasDegraded = components.some((c) => c.status === 'degraded');

    return {
      status: hasDown ? 'error' : hasDegraded ? 'degraded' : 'ok',
      version: this.config.version,
      uptimeSeconds: this.uptimeSeconds(),
      components,
      timestamp: new Date().toISOString(),
    };
  }

  private uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  private async checkDatabase(): Promise<HealthComponent> {
    try {
      const latencyMs = await this.prisma.ping();
      return {
        name: 'database',
        // A responsive-but-slow database is worth surfacing before it fails.
        status: latencyMs > 1000 ? 'degraded' : 'up',
        latencyMs,
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'down',
        detail: error instanceof Error ? error.message.slice(0, 200) : 'unreachable',
      };
    }
  }

  private async checkRedis(): Promise<HealthComponent> {
    if (!this.redis.isAvailable) {
      return {
        name: 'redis',
        status: 'degraded',
        detail: 'Cache and queue unavailable; the API is serving without them.',
      };
    }
    try {
      const latencyMs = await this.redis.ping();
      return { name: 'redis', status: 'up', latencyMs };
    } catch {
      return { name: 'redis', status: 'degraded', detail: 'Ping failed.' };
    }
  }

  private async checkStorage(): Promise<HealthComponent> {
    const result = await this.storage.healthCheck();
    return {
      name: 'object-storage',
      // Storage down blocks document upload and invoice PDFs, but not the gate.
      status: result.healthy ? 'up' : 'degraded',
      ...(result.detail ? { detail: result.detail.slice(0, 200) } : {}),
    };
  }

  private async checkOutbox(): Promise<HealthComponent> {
    try {
      const backlog = await this.outbox.backlog();
      // A growing backlog means events are not reaching their handlers, which
      // shows up as missing notifications and un-enriched vehicles.
      const stalled = backlog.oldestPendingAgeSeconds > 300 || backlog.deadLetter > 0;
      return {
        name: 'outbox',
        status: stalled ? 'degraded' : 'up',
        detail:
          `pending=${backlog.pending} deadLetter=${backlog.deadLetter} ` +
          `oldestPendingAgeSeconds=${backlog.oldestPendingAgeSeconds}`,
      };
    } catch {
      return { name: 'outbox', status: 'down', detail: 'Could not read the outbox backlog.' };
    }
  }
}
