import { Inject, Injectable } from '@nestjs/common';
import {
  ActorType,
  AdmissionMethod,
  AnprEventStatus,
  DeviceStatus,
  IntegrationCallStatus,
  IntegrationKind,
  Prisma,
  TravelDirection,
} from '@prisma/client';

import {
  ErrorCode,
  TimelineEventType,
  maskRegistrationNumber,
  normalizeRegistrationNumber,
} from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import { AppException } from '@/common/errors/app-exception';
import { AppLogger, ScopedLogger } from '@/common/logging/logger.service';
import { RequestContextStore } from '@/common/context/request-context';
import { sha256 } from '@/common/util/hash';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { AuditAction, AuditService } from '@/modules/audit/audit.service';
import { GateDecision, GateService } from '@/modules/parking/gate.service';
import { AnprProvider } from './anpr.provider';

export interface IngestResult {
  anprEventId: string;
  status: AnprEventStatus;
  /** Present when the capture was processed through the gate. */
  decision: GateDecision | null;
  /** Set when the capture went to the review queue instead. */
  reviewReason: string | null;
  duplicateOf?: string;
}

/**
 * ANPR ingestion.
 *
 * Four defences apply before a capture is allowed to move a vehicle, in this
 * order, because each is cheaper than the next:
 *
 *   1. DEVICE      The device must exist, be active, and belong to a live site.
 *   2. SIGNATURE   HMAC over "{timestamp}.{body}", when enforcement is on.
 *   3. FRESHNESS   A timestamp outside the skew window is a replay or a broken
 *                  camera clock; either way it must not open a barrier.
 *   4. DUPLICATE   Two independent keys - the provider's event id, and a
 *                  windowed hash of (device, plate, direction). The first stops
 *                  a retried webhook delivery; the second stops one physical
 *                  arrival producing five sessions because the camera fired
 *                  five frames.
 *
 * Only then is confidence considered. Below the threshold the capture is
 * queued for a human rather than guessed at - admitting the wrong vehicle
 * attaches a stay, and eventually an invoice, to the wrong financier.
 */
@Injectable()
export class AnprIngestionService {
  private readonly logger: ScopedLogger;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly provider: AnprProvider,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gate: GateService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.forContext('AnprIngestion');
  }

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Ingests one capture.
   *
   * @throws AppException for device, signature and freshness failures - these
   *         are the caller's problem and must be visible. Everything after that
   *         resolves to a recorded event with a status.
   */
  async ingest(input: {
    payload: unknown;
    rawBody: string;
    signature?: string;
    timestamp?: string;
  }): Promise<IngestResult> {
    const normalized = this.provider.normalize(input.payload);

    /* --- 1. Device ------------------------------------------------- */
    const device = await this.prisma.anprDevice.findUnique({
      where: {
        provider_providerDeviceId: {
          provider: this.provider.name,
          providerDeviceId: normalized.providerDeviceId,
        },
      },
      include: { site: true, gate: true, lane: true },
    });

    if (!device) {
      await this.logIntegrationCall('ingest', IntegrationCallStatus.FAILURE, {
        errorCode: ErrorCode.ANPR_DEVICE_UNKNOWN,
        providerDeviceId: normalized.providerDeviceId,
      });
      throw new AppException(
        ErrorCode.ANPR_DEVICE_UNKNOWN,
        'No ANPR device is registered with that identifier.',
        { details: { providerDeviceId: normalized.providerDeviceId } },
      );
    }

    if (!device.isActive || device.status === DeviceStatus.DECOMMISSIONED) {
      throw new AppException(
        ErrorCode.ANPR_DEVICE_DISABLED,
        'That ANPR device is disabled and cannot submit captures.',
        { details: { deviceCode: device.code } },
      );
    }

    if (device.site.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.SITE_NOT_ACTIVE,
        `Site ${device.site.name} is not active, so captures are not accepted.`,
        { details: { siteCode: device.site.code, status: device.site.status } },
      );
    }

    /* --- 2. Signature ---------------------------------------------- */
    if (this.config.anpr.requireSignature) {
      const verification = this.provider.verifySignature({
        rawBody: input.rawBody,
        signature: input.signature,
        timestamp: input.timestamp,
        sharedSecret: device.sharedSecretHash,
      });
      if (!verification.valid) {
        await this.audit.recordFailure({
          action: AuditAction.ANPR_EVENT_INGESTED,
          entityType: 'AnprDevice',
          entityId: device.id,
          organizationId: device.site.organizationId,
          siteId: device.siteId,
          errorCode: ErrorCode.ANPR_SIGNATURE_INVALID,
          reason: verification.reason ?? 'Signature verification failed.',
        });
        throw new AppException(
          ErrorCode.ANPR_SIGNATURE_INVALID,
          'The capture signature could not be verified.',
        );
      }
    }

    /* --- 3. Freshness ---------------------------------------------- */
    const skewSeconds = Math.abs(Date.now() - normalized.capturedAt.getTime()) / 1000;
    if (skewSeconds > this.config.anpr.maxClockSkewSeconds) {
      this.logger.warn('Capture rejected: timestamp outside the accepted window', {
        deviceCode: device.code,
        skewSeconds: Math.round(skewSeconds),
        maxSkewSeconds: this.config.anpr.maxClockSkewSeconds,
      });
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'The capture timestamp is too far from the current time. ' +
          'Check the camera clock, or resubmit with the correct time.',
        {
          details: {
            capturedAt: normalized.capturedAt.toISOString(),
            skewSeconds: Math.round(skewSeconds),
            maxSkewSeconds: this.config.anpr.maxClockSkewSeconds,
          },
        },
      );
    }

    /* --- 4. Duplicates --------------------------------------------- */
    // (a) The provider's own event id. A webhook redelivery lands here.
    const existing = await this.prisma.anprEvent.findUnique({
      where: {
        deviceId_providerEventId: {
          deviceId: device.id,
          providerEventId: normalized.providerEventId,
        },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      this.logger.debug('Capture already ingested; returning the original outcome', {
        anprEventId: existing.id,
      });
      return {
        anprEventId: existing.id,
        status: existing.status,
        decision: null,
        reviewReason: null,
        duplicateOf: existing.id,
      };
    }

    const plate = normalizeRegistrationNumber(normalized.plateNumberRaw);
    const direction = resolveDirection(normalized.direction, device.direction);
    const dedupeKey = this.buildDedupeKey(device.id, plate, direction, normalized.capturedAt);

    // (b) The windowed key. Redis answers first as a cheap short-circuit, but
    // the unique index on dedupeKey is the actual guarantee - Redis may be
    // down, and correctness must not depend on a cache.
    const wonWindow = await this.redis.setIfAbsent(
      `anpr:dedupe:${dedupeKey}`,
      '1',
      Math.max(1, this.config.anpr.dedupeWindowSeconds),
    );
    if (!wonWindow) {
      const original = await this.prisma.anprEvent.findUnique({
        where: { dedupeKey },
        select: { id: true, status: true },
      });
      if (original) {
        return {
          anprEventId: original.id,
          status: AnprEventStatus.DUPLICATE,
          decision: null,
          reviewReason: null,
          duplicateOf: original.id,
        };
      }
    }

    /* --- Persist the capture --------------------------------------- */
    const threshold =
      device.confidenceThreshold?.toNumber() ?? this.config.anpr.confidenceThreshold;
    const needsReview = normalized.confidence < threshold || plate.length < 4;

    let anprEvent;
    try {
      anprEvent = await this.prisma.anprEvent.create({
        data: {
          organizationId: device.site.organizationId,
          deviceId: device.id,
          siteId: device.siteId,
          gateId: device.gateId,
          laneId: device.laneId,
          providerEventId: normalized.providerEventId,
          capturedAt: normalized.capturedAt,
          plateNumberRaw: normalized.plateNumberRaw,
          normalizedPlate: plate,
          confidence: new Prisma.Decimal(normalized.confidence.toFixed(4)),
          direction,
          vehicleClassHint: normalized.vehicleClassHint,
          status: needsReview ? AnprEventStatus.PENDING_REVIEW : AnprEventStatus.RECEIVED,
          dedupeKey,
          rawPayload: normalized.raw as Prisma.InputJsonValue,
          correlationId: RequestContextStore.correlationId(),
        },
      });
    } catch (error) {
      // The unique index caught a duplicate that slipped past the cache. This
      // is the authoritative check, and reaching it is normal, not an error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const original = await this.prisma.anprEvent.findFirst({
          where: { OR: [{ dedupeKey }, { deviceId: device.id, providerEventId: normalized.providerEventId }] },
          select: { id: true, status: true },
        });
        if (original) {
          return {
            anprEventId: original.id,
            status: AnprEventStatus.DUPLICATE,
            decision: null,
            reviewReason: null,
            duplicateOf: original.id,
          };
        }
      }
      throw error;
    }

    await this.prisma.anprDevice.update({
      where: { id: device.id },
      data: { lastEventAt: new Date(), status: DeviceStatus.ONLINE },
    });

    await this.logIntegrationCall('ingest', IntegrationCallStatus.SUCCESS, {
      deviceCode: device.code,
      confidence: normalized.confidence,
      needsReview,
    });

    /* --- Route: review queue, or straight through the gate ---------- */
    if (needsReview) {
      const reason =
        plate.length < 4
          ? 'The recognised plate is too short to be usable.'
          : `Confidence ${(normalized.confidence * 100).toFixed(1)}% is below the ` +
            `${(threshold * 100).toFixed(0)}% threshold for this device.`;

      this.logger.info('Capture queued for manual review', {
        anprEventId: anprEvent.id,
        plate: maskRegistrationNumber(plate),
        confidence: normalized.confidence,
      });

      return {
        anprEventId: anprEvent.id,
        status: AnprEventStatus.PENDING_REVIEW,
        decision: null,
        reviewReason: reason,
      };
    }

    const decision = await this.gate.processCapture({
      anprEvent,
      site: device.site,
      direction,
      plateNumber: plate,
      vehicleClassHint: normalized.vehicleClassHint,
      admissionMethod: AdmissionMethod.ANPR_AUTO,
      actorType: ActorType.DEVICE,
    });

    return {
      anprEventId: anprEvent.id,
      status: AnprEventStatus.PROCESSED,
      decision,
      reviewReason: null,
    };
  }

  /**
   * Resolves a capture that was queued for review.
   *
   * Requirement S30: manual intervention is permitted only when recognition
   * genuinely failed, and every override is audited with the operator, the
   * original reading and the corrected one. That record is what makes an
   * operator correcting plates to admit vehicles that were never there
   * detectable afterwards.
   */
  async resolveReview(input: {
    anprEventId: string;
    correctedPlate: string;
    actorId: string;
    organizationId: string;
    notes: string;
    /** Reject instead of admitting - a misfire, or a vehicle that turned away. */
    reject?: boolean;
  }): Promise<IngestResult> {
    const event = await this.prisma.anprEvent.findFirst({
      where: { id: input.anprEventId, organizationId: input.organizationId },
      include: { site: true, device: true },
    });
    if (!event) throw new AppException(ErrorCode.NOT_FOUND, 'Capture event not found.');

    if (event.status !== AnprEventStatus.PENDING_REVIEW) {
      throw new AppException(
        ErrorCode.ANPR_EVENT_ALREADY_RESOLVED,
        `That capture is already ${event.status} and cannot be reviewed again.`,
        { details: { status: event.status } },
      );
    }

    if (input.reject) {
      await this.prisma.transaction(async (tx) => {
        await tx.anprEvent.update({
          where: { id: event.id },
          data: {
            status: AnprEventStatus.REJECTED,
            reviewedById: input.actorId,
            reviewedAt: new Date(),
            reviewNotes: input.notes.slice(0, 512),
            processedAt: new Date(),
          },
        });
        await this.audit.record(tx, {
          action: AuditAction.ANPR_EVENT_REVIEWED,
          entityType: 'AnprEvent',
          entityId: event.id,
          organizationId: input.organizationId,
          siteId: event.siteId,
          beforeState: { status: event.status, plate: event.normalizedPlate },
          afterState: { status: AnprEventStatus.REJECTED },
          reason: input.notes,
        });
      });

      return {
        anprEventId: event.id,
        status: AnprEventStatus.REJECTED,
        decision: null,
        reviewReason: null,
      };
    }

    const corrected = normalizeRegistrationNumber(input.correctedPlate);
    if (corrected.length < 4) {
      throw new AppException(
        ErrorCode.INVALID_REGISTRATION_NUMBER,
        'The corrected registration number is not usable.',
      );
    }

    const plateChanged = corrected !== event.normalizedPlate;

    await this.prisma.transaction(async (tx) => {
      await tx.anprEvent.update({
        where: { id: event.id },
        data: {
          correctedPlate: corrected,
          reviewedById: input.actorId,
          reviewedAt: new Date(),
          reviewNotes: input.notes.slice(0, 512),
        },
      });

      await this.audit.record(tx, {
        action: plateChanged ? AuditAction.ANPR_MANUAL_OVERRIDE : AuditAction.ANPR_EVENT_REVIEWED,
        entityType: 'AnprEvent',
        entityId: event.id,
        organizationId: input.organizationId,
        siteId: event.siteId,
        beforeState: {
          recognisedPlate: event.normalizedPlate,
          confidence: event.confidence.toFixed(4),
        },
        afterState: { confirmedPlate: corrected, plateChanged },
        reason: input.notes,
      });
    });

    const decision = await this.gate.processCapture({
      anprEvent: { ...event, normalizedPlate: corrected },
      site: event.site,
      direction: event.direction,
      plateNumber: corrected,
      vehicleClassHint: event.vehicleClassHint,
      // Recorded distinctly from ANPR_AUTO so operations can measure how often
      // recognition needed a human, and which devices are responsible.
      admissionMethod: AdmissionMethod.ANPR_REVIEWED,
      actorId: input.actorId,
      actorType: ActorType.USER,
    });

    if (decision.vehicleId) {
      await this.prisma.vehicleTimelineEvent.create({
        data: {
          organizationId: input.organizationId,
          vehicleId: decision.vehicleId,
          sessionId: decision.sessionId,
          siteId: event.siteId,
          type: TimelineEventType.ANPR_MANUALLY_RESOLVED,
          occurredAt: new Date(),
          actorId: input.actorId,
          actorType: ActorType.USER,
          title: plateChanged
            ? `Plate corrected from ${event.normalizedPlate} to ${corrected}`
            : 'Low-confidence capture confirmed by an operator',
          description: input.notes.slice(0, 1000),
          payload: {
            originalPlate: event.normalizedPlate,
            confirmedPlate: corrected,
            originalConfidence: event.confidence.toFixed(4),
          },
          correlationId: RequestContextStore.correlationId(),
        },
      });
    }

    return {
      anprEventId: event.id,
      status: AnprEventStatus.PROCESSED,
      decision,
      reviewReason: null,
    };
  }

  /**
   * The de-duplication key.
   *
   * Bucketing the timestamp is what makes it a WINDOW rather than an exact
   * match: every frame of one arrival lands in the same bucket and collapses to
   * one event, while a genuine re-entry an hour later gets a different bucket
   * and is correctly treated as a new arrival.
   */
  private buildDedupeKey(
    deviceId: string,
    plate: string,
    direction: TravelDirection,
    capturedAt: Date,
  ): string {
    const windowSeconds = Math.max(1, this.config.anpr.dedupeWindowSeconds);
    const bucket = Math.floor(capturedAt.getTime() / 1000 / windowSeconds);
    return sha256(`${deviceId}|${plate}|${direction}|${bucket}`).slice(0, 64);
  }

  private async logIntegrationCall(
    operation: string,
    status: IntegrationCallStatus,
    summary: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.integrationLog.create({
        data: {
          kind: IntegrationKind.ANPR,
          provider: this.provider.name,
          operation,
          direction: 'INBOUND',
          status,
          latencyMs: 0,
          // Never the plate: this table is widely readable for diagnostics.
          requestSummary: summary as Prisma.InputJsonValue,
          errorCode: (summary['errorCode'] as string) ?? null,
          correlationId: RequestContextStore.correlationId(),
        },
      });
    } catch (error) {
      this.logger.error('Failed to write ANPR integration log', error);
    }
  }
}

/**
 * A capture whose direction the recogniser could not determine takes the
 * device's configured direction. A bidirectional device with an ambiguous
 * capture defaults to ENTRY, which is the safe choice: a wrong ENTRY creates a
 * duplicate stay that is visible and correctable, whereas a wrong EXIT could
 * contribute to releasing a repossessed vehicle.
 */
function resolveDirection(
  captured: TravelDirection,
  deviceDirection: TravelDirection,
): TravelDirection {
  if (captured !== TravelDirection.BIDIRECTIONAL) return captured;
  if (deviceDirection !== TravelDirection.BIDIRECTIONAL) return deviceDirection;
  return TravelDirection.ENTRY;
}
