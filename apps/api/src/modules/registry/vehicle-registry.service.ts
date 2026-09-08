import { Inject, Injectable } from '@nestjs/common';
import {
  HypothecationStatus,
  IntegrationCallStatus,
  IntegrationKind,
  LookupStatus,
  Prisma,
  VahanVerificationStatus,
  VehicleStatus,
} from '@prisma/client';

import { ErrorCode, TimelineEventType } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppException } from '@/common/errors/app-exception';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { sha256 } from '@/common/util/hash';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { FinancierMatcherService } from '@/modules/financier/financier-matcher.service';
import {
  RegistryProviderError,
  VehicleRegistryProvider,
  VehicleRegistryRecord,
} from './vehicle-registry.provider';

export interface EnrichmentRequest {
  vehicleId: string;
  organizationId: string;
  normalizedRegistrationNumber: string;
  /** ANPR_ADMISSION | MANUAL | SCHEDULED_REFRESH | RETRY */
  triggeredBy: string;
  requestedById?: string | null;
  /** Ignores the freshness window. Used by an explicit "refresh" action. */
  force?: boolean;
}

/**
 * Vehicle registry enrichment.
 *
 * Resilience is the whole point of this class. Requirement S9 and S11 together
 * say the gate must never wait on the registry, and the registry must be
 * replaceable. So:
 *
 *   ASYNCHRONOUS   `requestEnrichment` only writes a QUEUED lookup row and
 *                  returns. The vehicle is admitted regardless.
 *   CACHED         A successful lookup is considered fresh for
 *                  VEHICLE_REGISTRY_CACHE_TTL_HOURS. Re-enrichment inside that
 *                  window is skipped, because aggregator calls are charged per
 *                  request and the open item OI-02 is exactly that cost.
 *   RATE LIMITED   A client-side token budget per minute, so we cannot breach
 *                  an aggregator quota and get the whole integration suspended.
 *   CIRCUIT BROKEN After N consecutive failures the circuit opens and calls
 *                  stop for a cooldown, instead of hammering a struggling
 *                  upstream and burning quota on certain failures.
 *   RETRIED        Transient failures are rescheduled with exponential backoff
 *                  up to a bounded attempt count, then left for manual retry.
 *   AUDITED        Every call writes an IntegrationLog row with latency and
 *                  outcome, which is the evidence base for choosing a provider.
 */
@Injectable()
export class VehicleRegistryService {
  private readonly logger: ScopedLogger;

  /** Circuit breaker state, per process. Redis-backed where available. */
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly provider: VehicleRegistryProvider,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly matcher: FinancierMatcherService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('VehicleRegistry');
  }

  get providerName(): string {
    return this.provider.name;
  }

  get isAuthoritative(): boolean {
    return this.provider.authoritative;
  }

  /**
   * Queues an enrichment. Returns the lookup id, or null when skipped because
   * existing data is still fresh.
   *
   * Never throws for provider reasons - it does not call the provider at all.
   */
  async requestEnrichment(request: EnrichmentRequest): Promise<{ lookupId: string | null; skipped: boolean; reason?: string }> {
    if (!this.provider.configured) {
      // Recorded, not thrown: an unconfigured registry must not stop admission.
      this.logger.warn('Registry provider is not configured; enrichment skipped', {
        provider: this.provider.name,
      });
      return { lookupId: null, skipped: true, reason: 'PROVIDER_NOT_CONFIGURED' };
    }

    if (!request.force) {
      const fresh = await this.hasFreshRecord(request.vehicleId);
      if (fresh) {
        return { lookupId: null, skipped: true, reason: 'CACHED_RECORD_STILL_FRESH' };
      }
    }

    // An in-flight lookup for the same vehicle makes a second one waste money.
    const inFlight = await this.prisma.vehicleRegistryLookup.findFirst({
      where: {
        vehicleId: request.vehicleId,
        status: { in: [LookupStatus.QUEUED, LookupStatus.IN_PROGRESS] },
      },
      select: { id: true },
    });
    if (inFlight) {
      return { lookupId: inFlight.id, skipped: true, reason: 'ALREADY_IN_FLIGHT' };
    }

    const lookup = await this.prisma.vehicleRegistryLookup.create({
      data: {
        vehicleId: request.vehicleId,
        normalizedRegistrationNumber: request.normalizedRegistrationNumber,
        provider: this.provider.name,
        status: LookupStatus.QUEUED,
        maxAttempts: this.config.registry.maxAttempts,
        triggeredBy: request.triggeredBy,
        requestedById: request.requestedById ?? null,
        correlationId: RequestContextStore.correlationId(),
        nextRetryAt: new Date(),
      },
    });

    await this.prisma.vehicle.updateMany({
      where: { id: request.vehicleId, vahanVerificationStatus: VahanVerificationStatus.NOT_REQUESTED },
      data: { vahanVerificationStatus: VahanVerificationStatus.PENDING },
    });

    return { lookupId: lookup.id, skipped: false };
  }

  /**
   * Executes one queued lookup. Called by the background worker.
   *
   * Always resolves - failures are recorded on the lookup row and rescheduled -
   * so a job runner never sees an unhandled rejection for an upstream problem.
   */
  async executeLookup(lookupId: string): Promise<{ status: LookupStatus; reason?: string }> {
    const lookup = await this.prisma.vehicleRegistryLookup.findUnique({ where: { id: lookupId } });
    if (!lookup) return { status: LookupStatus.CANCELLED, reason: 'LOOKUP_NOT_FOUND' };
    if (lookup.status === LookupStatus.SUCCEEDED) {
      return { status: LookupStatus.SUCCEEDED, reason: 'ALREADY_COMPLETE' };
    }

    if (this.isCircuitOpen()) {
      await this.rescheduleForCircuit(lookup.id);
      await this.logIntegrationCall({
        operation: 'lookup',
        status: IntegrationCallStatus.CIRCUIT_OPEN,
        latencyMs: 0,
        attempt: lookup.attempt,
        entityId: lookup.vehicleId,
        errorCode: 'CIRCUIT_OPEN',
      });
      return { status: LookupStatus.QUEUED, reason: 'CIRCUIT_OPEN' };
    }

    if (!(await this.consumeRateLimitToken())) {
      await this.prisma.vehicleRegistryLookup.update({
        where: { id: lookup.id },
        data: { nextRetryAt: new Date(Date.now() + 30_000) },
      });
      await this.logIntegrationCall({
        operation: 'lookup',
        status: IntegrationCallStatus.RATE_LIMITED,
        latencyMs: 0,
        attempt: lookup.attempt,
        entityId: lookup.vehicleId,
        errorCode: 'LOCAL_RATE_LIMIT',
      });
      return { status: LookupStatus.QUEUED, reason: 'RATE_LIMITED' };
    }

    await this.prisma.vehicleRegistryLookup.update({
      where: { id: lookup.id },
      data: { status: LookupStatus.IN_PROGRESS, startedAt: new Date() },
    });

    try {
      const result = await this.provider.lookup(lookup.normalizedRegistrationNumber);
      this.recordSuccess();

      await this.logIntegrationCall({
        operation: 'lookup',
        status: IntegrationCallStatus.SUCCESS,
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
        attempt: lookup.attempt,
        entityId: lookup.vehicleId,
        responseSummary: { outcome: result.outcome },
      });

      if (result.outcome === 'NOT_FOUND' || !result.record) {
        await this.completeNotFound(lookup.id, lookup.vehicleId, result.latencyMs);
        return { status: LookupStatus.SUCCEEDED, reason: 'NOT_FOUND' };
      }

      await this.applyRecord(lookup.id, lookup.vehicleId, result.record, result.latencyMs);
      return { status: LookupStatus.SUCCEEDED };
    } catch (error) {
      return this.handleLookupFailure(lookup.id, lookup.attempt, lookup.maxAttempts, lookup.vehicleId, error);
    }
  }

  /**
   * Records a manual verification by a member of staff.
   *
   * The escape hatch for when the registry has no record, is wrong, or is
   * unavailable indefinitely. Deliberately audited and marked as
   * MANUALLY_VERIFIED - never indistinguishable from a registry-sourced record.
   */
  async recordManualVerification(input: {
    vehicleId: string;
    organizationId: string;
    actorId: string;
    registeredOwnerName?: string | null;
    registeredOwnerAddress?: string | null;
    financierId?: string | null;
    financierNameRaw?: string | null;
    hypothecationStatus: HypothecationStatus;
    reason: string;
  }): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });

      await tx.vehicleOwnershipRecord.updateMany({
        where: { vehicleId: input.vehicleId, isCurrent: true },
        data: { isCurrent: false },
      });

      const record = await tx.vehicleOwnershipRecord.create({
        data: {
          vehicleId: input.vehicleId,
          provider: 'manual',
          source: 'MANUAL',
          registeredOwnerName: input.registeredOwnerName ?? null,
          registeredOwnerAddress: input.registeredOwnerAddress ?? null,
          financierNameRaw: input.financierNameRaw ?? null,
          matchedFinancierId: input.financierId ?? null,
          hypothecationStatus: input.hypothecationStatus,
          retrievedAt: new Date(),
          isCurrent: true,
          rawResponse: { manualEntry: true, reason: input.reason },
        },
      });

      await tx.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          registeredOwnerName: input.registeredOwnerName ?? vehicle.registeredOwnerName,
          registeredOwnerAddress: input.registeredOwnerAddress ?? vehicle.registeredOwnerAddress,
          hypothecationStatus: input.hypothecationStatus,
          vahanVerificationStatus: VahanVerificationStatus.MANUALLY_VERIFIED,
          vahanVerifiedAt: new Date(),
          ...(input.financierId
            ? {
                currentFinancierId: input.financierId,
                financierMatchMethod: 'MANUAL',
                financierMatchConfidence: new Prisma.Decimal(1),
              }
            : {}),
        },
      });

      if (input.financierId) {
        await this.openFinancierHistory(tx, {
          vehicleId: input.vehicleId,
          financierId: input.financierId,
          financierNameRaw: input.financierNameRaw ?? null,
          matchMethod: 'MANUAL',
          confidence: 1,
          reason: input.reason,
          createdById: input.actorId,
          ownershipRecordId: record.id,
        });

        // Teach the matcher, so the next vehicle from this RTO matches exactly.
        if (input.financierNameRaw) {
          await this.matcher.learnAlias(
            tx,
            input.financierId,
            input.financierNameRaw,
            input.actorId,
            'MANUAL_CONFIRMED',
          );
        }
      }

      await tx.vehicleTimelineEvent.create({
        data: {
          organizationId: input.organizationId,
          vehicleId: input.vehicleId,
          type: TimelineEventType.OWNERSHIP_UPDATED,
          occurredAt: new Date(),
          actorId: input.actorId,
          actorType: 'USER',
          title: 'Ownership manually verified',
          description: input.reason.slice(0, 1000),
          correlationId: RequestContextStore.correlationId(),
        },
      });

      await this.audit.record(tx, {
        action: AuditAction.REGISTRY_MANUAL_VERIFICATION,
        entityType: 'Vehicle',
        entityId: input.vehicleId,
        organizationId: input.organizationId,
        reason: input.reason,
        afterState: {
          hypothecationStatus: input.hypothecationStatus,
          financierId: input.financierId ?? null,
        },
      });
    });
  }

  /** Requeues a failed or exhausted lookup. */
  async retryLookup(lookupId: string): Promise<void> {
    const lookup = await this.prisma.vehicleRegistryLookup.findUnique({ where: { id: lookupId } });
    if (!lookup) throw new AppException(ErrorCode.NOT_FOUND, 'Lookup not found.');
    if (lookup.status === LookupStatus.SUCCEEDED) {
      throw new AppException(ErrorCode.CONFLICT, 'That lookup already succeeded.');
    }
    await this.prisma.vehicleRegistryLookup.update({
      where: { id: lookupId },
      data: { status: LookupStatus.QUEUED, attempt: 1, nextRetryAt: new Date(), errorCode: null, errorMessage: null },
    });
  }

  /** Lookups due for execution. Polled by the retry sweep. */
  async findDueLookups(limit = 25): Promise<string[]> {
    const rows = await this.prisma.vehicleRegistryLookup.findMany({
      where: {
        status: { in: [LookupStatus.QUEUED, LookupStatus.FAILED] },
        nextRetryAt: { lte: new Date() },
        attempt: { lte: this.config.registry.maxAttempts },
      },
      orderBy: { requestedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Provider health for the console's integration page. */
  circuitState(): { open: boolean; consecutiveFailures: number; reopensInSeconds: number | null } {
    if (!this.circuitOpenedAt) {
      return { open: false, consecutiveFailures: this.consecutiveFailures, reopensInSeconds: null };
    }
    const elapsed = (Date.now() - this.circuitOpenedAt) / 1000;
    const remaining = Math.max(0, this.config.registry.breakerCooldownSeconds - elapsed);
    return {
      open: remaining > 0,
      consecutiveFailures: this.consecutiveFailures,
      reopensInSeconds: Math.ceil(remaining),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private async applyRecord(
    lookupId: string,
    vehicleId: string | null,
    record: VehicleRegistryRecord,
    latencyMs: number,
  ): Promise<void> {
    if (!vehicleId) return;

    await this.prisma.transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle) return;

      const match = await this.matcher.match(tx, vehicle.organizationId, record.financierName);
      const threshold = this.matcher.autoAcceptThreshold();
      const autoAccept = match.financierId !== null && match.confidence >= threshold;

      await tx.vehicleOwnershipRecord.updateMany({
        where: { vehicleId, isCurrent: true },
        data: { isCurrent: false },
      });

      const ownership = await tx.vehicleOwnershipRecord.create({
        data: {
          vehicleId,
          provider: this.provider.name,
          source: record.source,
          registeredOwnerName: record.registeredOwnerName,
          registeredOwnerAddress: record.registeredOwnerAddress,
          financierNameRaw: record.financierName,
          matchedFinancierId: autoAccept ? match.financierId : null,
          hypothecationStatus: record.hypothecationStatus,
          vehicleClass: record.vehicleClass,
          vehicleType: record.vehicleType,
          make: record.make,
          model: record.model,
          variant: record.variant,
          color: record.color,
          fuelType: record.fuelType,
          manufacturingYear: record.manufacturingYear,
          registrationDate: record.registrationDate,
          fitnessValidUpto: record.fitnessValidUpto,
          insuranceValidUpto: record.insuranceValidUpto,
          rawResponse: record.raw as Prisma.InputJsonValue,
          retrievedAt: record.retrievedAt,
          isCurrent: true,
        },
      });

      // A non-authoritative provider (the simulator) must NEVER mark a vehicle
      // as registry-verified. This is the single guard that keeps mock data
      // from being mistaken for the real thing anywhere in the platform.
      const verificationStatus = this.provider.authoritative
        ? VahanVerificationStatus.VERIFIED
        : VahanVerificationStatus.UNAVAILABLE;

      const nextStatus = pickVehicleStatusAfterEnrichment(vehicle.status, autoAccept);

      await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          vehicleClass: record.vehicleClass ?? vehicle.vehicleClass,
          vehicleType: record.vehicleType ?? vehicle.vehicleType,
          make: record.make ?? vehicle.make,
          model: record.model ?? vehicle.model,
          variant: record.variant ?? vehicle.variant,
          color: record.color ?? vehicle.color,
          fuelType: record.fuelType ?? vehicle.fuelType,
          manufacturingYear: record.manufacturingYear ?? vehicle.manufacturingYear,
          chassisNumberLast4: record.chassisNumberLast4 ?? vehicle.chassisNumberLast4,
          engineNumberLast4: record.engineNumberLast4 ?? vehicle.engineNumberLast4,
          registeredOwnerName: record.registeredOwnerName ?? vehicle.registeredOwnerName,
          registeredOwnerAddress: record.registeredOwnerAddress ?? vehicle.registeredOwnerAddress,
          hypothecationStatus: record.hypothecationStatus,
          vahanVerificationStatus: verificationStatus,
          vahanVerifiedAt: new Date(),
          ...(autoAccept
            ? {
                currentFinancierId: match.financierId,
                financierMatchMethod: match.method,
                financierMatchConfidence: new Prisma.Decimal(match.confidence.toFixed(4)),
              }
            : {
                financierMatchMethod: match.method,
                financierMatchConfidence:
                  match.confidence > 0 ? new Prisma.Decimal(match.confidence.toFixed(4)) : null,
              }),
          ...(nextStatus ? { status: nextStatus } : {}),
        },
      });

      if (autoAccept && match.financierId) {
        await this.openFinancierHistory(tx, {
          vehicleId,
          financierId: match.financierId,
          financierNameRaw: record.financierName,
          matchMethod: match.method,
          confidence: match.confidence,
          reason: match.explanation,
          createdById: null,
          ownershipRecordId: ownership.id,
        });
        await this.matcher.learnAlias(tx, match.financierId, record.financierName ?? '', null);
      }

      await tx.vehicleRegistryLookup.update({
        where: { id: lookupId },
        data: {
          status: LookupStatus.SUCCEEDED,
          completedAt: new Date(),
          latencyMs,
          httpStatus: 200,
          responseHash: sha256(JSON.stringify(record.raw)),
          ownershipRecordId: ownership.id,
        },
      });

      await tx.vehicleTimelineEvent.createMany({
        data: [
          {
            organizationId: vehicle.organizationId,
            vehicleId,
            type: TimelineEventType.VAHAN_LOOKUP_SUCCEEDED,
            occurredAt: new Date(),
            actorType: 'INTEGRATION',
            actorLabel: `registry:${this.provider.name}`,
            title: this.provider.authoritative
              ? 'Registry lookup completed'
              : 'Registry lookup completed (simulated, non-authoritative)',
            description: [record.make, record.model].filter(Boolean).join(' ') || null,
            payload: {
              provider: this.provider.name,
              authoritative: this.provider.authoritative,
              hypothecationStatus: record.hypothecationStatus,
            },
            correlationId: RequestContextStore.correlationId(),
          },
          ...(match.financierId
            ? [
                {
                  organizationId: vehicle.organizationId,
                  vehicleId,
                  type: TimelineEventType.FINANCIER_MATCHED,
                  occurredAt: new Date(),
                  actorType: 'SYSTEM' as const,
                  title: autoAccept
                    ? `Financier matched: ${match.financierName}`
                    : `Possible financier: ${match.financierName} (needs review)`,
                  description: match.explanation,
                  payload: {
                    confidence: match.confidence,
                    method: match.method,
                    autoAccepted: autoAccept,
                  },
                  correlationId: RequestContextStore.correlationId(),
                },
              ]
            : []),
        ],
      });

      await this.audit.record(tx, {
        action: AuditAction.REGISTRY_LOOKUP_COMPLETED,
        entityType: 'Vehicle',
        entityId: vehicleId,
        organizationId: vehicle.organizationId,
        afterState: {
          provider: this.provider.name,
          authoritative: this.provider.authoritative,
          hypothecationStatus: record.hypothecationStatus,
          financierMatched: autoAccept,
          matchConfidence: match.confidence,
        },
      });
    });
  }

  /** Closes any open financier assignment and opens a new one. */
  private async openFinancierHistory(
    tx: Prisma.TransactionClient,
    input: {
      vehicleId: string;
      financierId: string;
      financierNameRaw: string | null;
      matchMethod: Prisma.VehicleFinancierHistoryCreateInput['matchMethod'];
      confidence: number;
      reason: string;
      createdById: string | null;
      ownershipRecordId: string | null;
    },
  ): Promise<void> {
    const open = await tx.vehicleFinancierHistory.findFirst({
      where: { vehicleId: input.vehicleId, effectiveTo: null },
    });

    // Nothing changed: do not churn the history with duplicate rows.
    if (open && open.financierId === input.financierId) return;

    if (open) {
      await tx.vehicleFinancierHistory.update({
        where: { id: open.id },
        data: { effectiveTo: new Date() },
      });
    }

    await tx.vehicleFinancierHistory.create({
      data: {
        vehicleId: input.vehicleId,
        financierId: input.financierId,
        financierNameRaw: input.financierNameRaw,
        matchMethod: input.matchMethod,
        confidence: new Prisma.Decimal(input.confidence.toFixed(4)),
        effectiveFrom: new Date(),
        sourceOwnershipRecordId: input.ownershipRecordId,
        reason: input.reason.slice(0, 512),
        createdById: input.createdById,
      },
    });
  }

  private async completeNotFound(
    lookupId: string,
    vehicleId: string | null,
    latencyMs: number,
  ): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await tx.vehicleRegistryLookup.update({
        where: { id: lookupId },
        data: {
          status: LookupStatus.SUCCEEDED,
          completedAt: new Date(),
          latencyMs,
          httpStatus: 404,
          errorCode: 'RECORD_NOT_FOUND',
        },
      });
      if (vehicleId) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { vahanVerificationStatus: VahanVerificationStatus.UNAVAILABLE },
        });
      }
    });
  }

  private async handleLookupFailure(
    lookupId: string,
    attempt: number,
    maxAttempts: number,
    vehicleId: string | null,
    error: unknown,
  ): Promise<{ status: LookupStatus; reason?: string }> {
    const providerError =
      error instanceof RegistryProviderError
        ? error
        : new RegistryProviderError('UNKNOWN', 'Unexpected registry failure.', true, null, error);

    this.recordFailure();

    await this.logIntegrationCall({
      operation: 'lookup',
      status:
        providerError.code === 'TIMEOUT'
          ? IntegrationCallStatus.TIMEOUT
          : IntegrationCallStatus.FAILURE,
      latencyMs: 0,
      httpStatus: providerError.httpStatus,
      attempt,
      entityId: vehicleId,
      errorCode: providerError.code,
      errorMessage: providerError.message,
    });

    const nextAttempt = attempt + 1;
    const exhausted = !providerError.retryable || nextAttempt > maxAttempts;
    const backoffSeconds = Math.min(600, 15 * 2 ** (attempt - 1));

    await this.prisma.transaction(async (tx) => {
      await tx.vehicleRegistryLookup.update({
        where: { id: lookupId },
        data: {
          status: exhausted ? LookupStatus.EXHAUSTED : LookupStatus.FAILED,
          attempt: nextAttempt,
          completedAt: exhausted ? new Date() : null,
          errorCode: providerError.code,
          errorMessage: providerError.message.slice(0, 512),
          nextRetryAt: exhausted ? null : new Date(Date.now() + backoffSeconds * 1000),
        },
      });

      if (exhausted && vehicleId) {
        const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
        if (vehicle) {
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: { vahanVerificationStatus: VahanVerificationStatus.FAILED },
          });
          await tx.vehicleTimelineEvent.create({
            data: {
              organizationId: vehicle.organizationId,
              vehicleId,
              type: TimelineEventType.VAHAN_LOOKUP_FAILED,
              occurredAt: new Date(),
              actorType: 'INTEGRATION',
              actorLabel: `registry:${this.provider.name}`,
              title: 'Registry lookup failed',
              description:
                `${providerError.code}: ${providerError.message}. ` +
                'The vehicle can still be processed; verify ownership manually if needed.',
              correlationId: RequestContextStore.correlationId(),
            },
          });
        }
      }
    });

    this.logger.warn(exhausted ? 'Registry lookup exhausted' : 'Registry lookup failed; will retry', {
      lookupId,
      attempt,
      code: providerError.code,
      retryable: providerError.retryable,
      backoffSeconds: exhausted ? null : backoffSeconds,
    });

    return {
      status: exhausted ? LookupStatus.EXHAUSTED : LookupStatus.FAILED,
      reason: providerError.code,
    };
  }

  private async hasFreshRecord(vehicleId: string): Promise<boolean> {
    const ttlHours = this.config.registry.cacheTtlHours;
    if (ttlHours <= 0) return false;

    const cutoff = new Date(Date.now() - ttlHours * 3_600_000);
    const record = await this.prisma.vehicleOwnershipRecord.findFirst({
      where: { vehicleId, isCurrent: true, retrievedAt: { gte: cutoff } },
      select: { id: true },
    });
    return record !== null;
  }

  /* --- Circuit breaker ------------------------------------------- */

  private isCircuitOpen(): boolean {
    if (this.circuitOpenedAt === null) return false;
    const elapsedSeconds = (Date.now() - this.circuitOpenedAt) / 1000;
    if (elapsedSeconds >= this.config.registry.breakerCooldownSeconds) {
      // Half-open: allow one probe through. A success closes the circuit.
      this.circuitOpenedAt = null;
      this.consecutiveFailures = 0;
      this.logger.info('Registry circuit breaker moved to half-open');
      return false;
    }
    return true;
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (
      this.consecutiveFailures >= this.config.registry.breakerThreshold &&
      this.circuitOpenedAt === null
    ) {
      this.circuitOpenedAt = Date.now();
      this.logger.error('Registry circuit breaker opened', undefined, {
        consecutiveFailures: this.consecutiveFailures,
        cooldownSeconds: this.config.registry.breakerCooldownSeconds,
      });
    }
  }

  private recordSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.logger.info('Registry recovered', { afterFailures: this.consecutiveFailures });
    }
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
  }

  private async rescheduleForCircuit(lookupId: string): Promise<void> {
    const { reopensInSeconds } = this.circuitState();
    await this.prisma.vehicleRegistryLookup.update({
      where: { id: lookupId },
      data: { nextRetryAt: new Date(Date.now() + (reopensInSeconds ?? 60) * 1000) },
    });
  }

  /**
   * Client-side quota guard.
   *
   * Fails OPEN when Redis is unavailable: throttling is a courtesy to the
   * aggregator, and losing it is far less damaging than blocking every
   * enrichment because the cache is down.
   */
  private async consumeRateLimitToken(): Promise<boolean> {
    if (!this.redis.isAvailable) return true;
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const key = `registry:ratelimit:${this.provider.name}:${minuteBucket}`;
    const used = await this.redis.incrementWithExpiry(key, 120);
    return used === 0 || used <= this.config.registry.rateLimitPerMinute;
  }

  private async logIntegrationCall(input: {
    operation: string;
    status: IntegrationCallStatus;
    latencyMs: number;
    attempt: number;
    entityId: string | null;
    httpStatus?: number | null;
    errorCode?: string;
    errorMessage?: string;
    responseSummary?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.integrationLog.create({
        data: {
          kind: IntegrationKind.VEHICLE_REGISTRY,
          provider: this.provider.name,
          operation: input.operation,
          direction: 'OUTBOUND',
          status: input.status,
          httpStatus: input.httpStatus ?? null,
          latencyMs: input.latencyMs,
          attempt: input.attempt,
          // Summaries only: never the registration number, never the payload.
          requestSummary: { authoritative: this.provider.authoritative },
          responseSummary: (input.responseSummary ?? {}) as Prisma.InputJsonValue,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage?.slice(0, 512) ?? null,
          entityType: 'Vehicle',
          entityId: input.entityId,
          correlationId: RequestContextStore.correlationId(),
        },
      });
    } catch (error) {
      this.logger.error('Failed to write integration log', error);
    }
  }
}

/**
 * Advances the vehicle lifecycle after enrichment, without ever moving it
 * backwards. A vehicle already PARKED must not be dragged back to
 * FINANCIER_MATCHED just because a late registry response arrived.
 */
function pickVehicleStatusAfterEnrichment(
  current: VehicleStatus,
  financierMatched: boolean,
): VehicleStatus | null {
  const preAdmission: VehicleStatus[] = [
    VehicleStatus.CAPTURED,
    VehicleStatus.IDENTIFIED,
    VehicleStatus.VAHAN_PENDING,
    VehicleStatus.VAHAN_FAILED,
  ];
  if (!preAdmission.includes(current)) return null;
  return financierMatched ? VehicleStatus.FINANCIER_MATCHED : VehicleStatus.VAHAN_VERIFIED;
}
