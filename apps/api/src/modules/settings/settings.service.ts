import { Injectable } from '@nestjs/common';
import { Prisma, SettingDataType } from '@prisma/client';

import { ErrorCode } from '@smartpark/contracts';
import { AppException, notFound } from '@/common/errors/app-exception';
import { AuthenticatedUser } from '@/common/decorators/auth.decorators';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';

/**
 * Business configuration.
 *
 * Requirement S41: operational behaviour must change without a code change or
 * a redeploy. Thresholds, policy switches and workflow toggles live in
 * `system_settings` and are read through here.
 *
 * Reads are cached briefly in Redis, because settings are read on hot paths
 * (every release eligibility check, every gate admission) and change rarely.
 * The cache is invalidated on write, and a cache miss simply hits the database
 * — correctness never depends on Redis being up.
 *
 * Site-scoped values override global ones, so one yard can run a different
 * threshold without affecting the estate.
 */
@Injectable()
export class SettingsService {
  private readonly logger: ScopedLogger;
  private static readonly CACHE_TTL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('Settings');
  }

  /**
   * Reads a setting, preferring a site-scoped value over the global one.
   *
   * Returns `fallback` when the key is absent. A missing setting must never
   * throw on a hot path — an unconfigured threshold should degrade to a
   * sensible default, not stop a vehicle at the gate.
   */
  async get<T>(
    organizationId: string,
    key: string,
    fallback: T,
    siteId?: string | null,
  ): Promise<T> {
    const cacheKey = `settings:${organizationId}:${siteId ?? 'GLOBAL'}:${key}`;

    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const rows = await this.prisma.systemSetting.findMany({
      where: {
        organizationId,
        key,
        siteScopeKey: siteId ? { in: [siteId, 'GLOBAL'] } : 'GLOBAL',
      },
    });

    // Site-specific wins over global.
    const chosen =
      rows.find((row) => siteId && row.siteScopeKey === siteId) ??
      rows.find((row) => row.siteScopeKey === 'GLOBAL');

    if (!chosen) {
      this.logger.debug('Setting not configured; using fallback', { key, siteId });
      return fallback;
    }

    const value = chosen.valueJson as T;
    await this.redis.set(cacheKey, JSON.stringify(value), SettingsService.CACHE_TTL_SECONDS);
    return value;
  }

  async getBoolean(
    organizationId: string,
    key: string,
    fallback: boolean,
    siteId?: string | null,
  ): Promise<boolean> {
    const value = await this.get<unknown>(organizationId, key, fallback, siteId);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
    return fallback;
  }

  async getNumber(
    organizationId: string,
    key: string,
    fallback: number,
    siteId?: string | null,
  ): Promise<number> {
    const value = await this.get<unknown>(organizationId, key, fallback, siteId);
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  async getString(
    organizationId: string,
    key: string,
    fallback: string,
    siteId?: string | null,
  ): Promise<string> {
    const value = await this.get<unknown>(organizationId, key, fallback, siteId);
    return typeof value === 'string' ? value : fallback;
  }

  /* ---------------------------------------------------------------- */
  /* Administration                                                    */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthenticatedUser, siteId?: string): Promise<SettingItem[]> {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(siteId ? { siteScopeKey: { in: [siteId, 'GLOBAL'] } } : {}),
      },
      include: { site: { select: { name: true, code: true } } },
      orderBy: [{ key: 'asc' }, { siteScopeKey: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      scope: row.scope,
      siteId: row.siteId,
      siteName: row.site?.name ?? null,
      dataType: row.dataType,
      description: row.description,
      // A secret's value is never returned; only whether one is set.
      value: row.isSecret ? null : (row.valueJson as unknown),
      isSecret: row.isSecret,
      isSet: row.valueJson !== null,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /**
   * Updates a setting.
   *
   * Every change is audited with the before and after value, because these
   * values alter what customers are charged and who may leave the yard.
   */
  async update(
    actor: AuthenticatedUser,
    settingId: string,
    value: unknown,
    reason: string,
  ): Promise<SettingItem> {
    const updated = await this.prisma.transaction(async (tx) => {
      const setting = await tx.systemSetting.findFirst({
        where: { id: settingId, organizationId: actor.organizationId },
      });
      if (!setting) throw notFound('Setting', settingId);

      this.assertTypeMatches(setting.dataType, value, setting.key);

      const next = await tx.systemSetting.update({
        where: { id: settingId },
        data: { valueJson: value as Prisma.InputJsonValue, updatedById: actor.id },
        include: { site: { select: { name: true, code: true } } },
      });

      await this.audit.record(tx, {
        action: AuditAction.SETTING_CHANGED,
        entityType: 'SystemSetting',
        entityId: settingId,
        organizationId: actor.organizationId,
        siteId: setting.siteId,
        beforeState: { key: setting.key, value: setting.isSecret ? '[REDACTED]' : setting.valueJson },
        afterState: { key: setting.key, value: setting.isSecret ? '[REDACTED]' : value },
        reason,
      });

      return next;
    });

    // Invalidate every scope for this key: a global change affects sites that
    // do not override it.
    await this.redis.invalidatePrefix(`settings:${actor.organizationId}:`);

    return {
      id: updated.id,
      key: updated.key,
      scope: updated.scope,
      siteId: updated.siteId,
      siteName: updated.site?.name ?? null,
      dataType: updated.dataType,
      description: updated.description,
      value: updated.isSecret ? null : (updated.valueJson as unknown),
      isSecret: updated.isSecret,
      isSet: true,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /** Rejects a value whose shape does not match the declared data type. */
  private assertTypeMatches(dataType: SettingDataType, value: unknown, key: string): void {
    const fail = (expected: string): never => {
      throw new AppException(
        ErrorCode.SETTING_TYPE_MISMATCH,
        `Setting "${key}" expects a ${expected}.`,
        { details: { key, dataType, received: typeof value } },
      );
    };

    switch (dataType) {
      case SettingDataType.BOOLEAN:
        if (typeof value !== 'boolean') fail('boolean');
        break;
      case SettingDataType.NUMBER:
      case SettingDataType.DURATION_MINUTES:
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('number');
        break;
      case SettingDataType.STRING:
        if (typeof value !== 'string') fail('string');
        break;
      case SettingDataType.JSON:
        if (value === null || typeof value !== 'object') fail('JSON object');
        break;
      default:
        break;
    }
  }
}

export interface SettingItem {
  id: string;
  key: string;
  scope: string;
  siteId: string | null;
  siteName: string | null;
  dataType: string;
  description: string;
  value: unknown;
  isSecret: boolean;
  isSet: boolean;
  updatedAt: string;
}
