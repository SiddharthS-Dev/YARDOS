import { Injectable } from '@nestjs/common';

import { TravelDirection, VehicleClass } from '@smartpark/contracts';
import { hmacSha256, safeEqual } from '@/common/util/hash';
import { AnprPayloadError, AnprProvider, NormalizedAnprEvent } from '../anpr.provider';

/**
 * Adapter for a conventional webhook-style ANPR gateway.
 *
 * This is the production adapter. It accepts the field spellings the common
 * gateways use, because standardising the camera fleet is not realistic and
 * being liberal here is cheaper than an adapter per vendor.
 *
 * Signature scheme: HMAC-SHA256 over `"{timestamp}.{rawBody}"`, hex-encoded,
 * with a per-device shared secret. Including the timestamp inside the signed
 * material is what makes replay protection possible - an attacker who captures
 * a valid request cannot re-send it later with a fresh timestamp, because the
 * signature would no longer match.
 */
@Injectable()
export class GenericWebhookAnprProvider extends AnprProvider {
  readonly name = 'generic-webhook';

  normalize(payload: unknown): NormalizedAnprEvent {
    if (!payload || typeof payload !== 'object') {
      throw new AnprPayloadError('MALFORMED_PAYLOAD', 'The capture payload was not an object.');
    }
    const data = payload as Record<string, unknown>;

    const providerEventId = str(data, 'eventId', 'event_id', 'id', 'captureId');
    if (!providerEventId) {
      throw new AnprPayloadError(
        'MISSING_EVENT_ID',
        'The capture payload has no event id, so it cannot be de-duplicated.',
      );
    }

    const providerDeviceId = str(data, 'deviceId', 'device_id', 'cameraId', 'camera_id', 'sn');
    if (!providerDeviceId) {
      throw new AnprPayloadError('MISSING_DEVICE_ID', 'The capture payload has no device id.');
    }

    const plateNumberRaw = str(data, 'plateNumber', 'plate_number', 'plate', 'licensePlate', 'lpr');
    if (!plateNumberRaw) {
      throw new AnprPayloadError('MISSING_PLATE', 'The capture payload has no plate number.');
    }

    return {
      providerEventId: providerEventId.slice(0, 128),
      providerDeviceId: providerDeviceId.slice(0, 128),
      capturedAt: parseTimestamp(data),
      plateNumberRaw: plateNumberRaw.slice(0, 32),
      confidence: parseConfidence(data),
      direction: parseDirection(data),
      vehicleClassHint: parseVehicleClass(str(data, 'vehicleType', 'vehicle_type', 'class')),
      imageBase64: str(data, 'image', 'imageBase64', 'snapshot') ?? null,
      plateImageBase64: str(data, 'plateImage', 'plateImageBase64', 'plateCrop') ?? null,
      raw: stripImages(data),
    };
  }

  verifySignature(input: {
    rawBody: string;
    signature: string | undefined;
    timestamp: string | undefined;
    sharedSecret: string | null;
  }): { valid: boolean; reason?: string } {
    if (!input.sharedSecret) {
      return { valid: false, reason: 'The device has no shared secret configured.' };
    }
    if (!input.signature) {
      return { valid: false, reason: 'The request carried no signature header.' };
    }
    if (!input.timestamp) {
      return { valid: false, reason: 'The request carried no timestamp header.' };
    }

    const expected = hmacSha256(input.sharedSecret, `${input.timestamp}.${input.rawBody}`);
    // Constant-time comparison: a fast-fail on the first differing character
    // would let an attacker recover a valid signature byte by byte.
    return safeEqual(expected, input.signature.trim().toLowerCase())
      ? { valid: true }
      : { valid: false, reason: 'The signature did not match.' };
  }
}

/* ------------------------------------------------------------------ */

function str(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Confidence, rescaled to 0..1.
 *
 * Gateways disagree: some report 0-1, others 0-100. A value above 1 is
 * therefore assumed to be a percentage. A missing value becomes 0, which routes
 * the capture to manual review rather than silently admitting it as certain.
 */
function parseConfidence(data: Record<string, unknown>): number {
  const raw = str(data, 'confidence', 'score', 'plateConfidence', 'accuracy');
  if (raw === null) return 0;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  const scaled = parsed > 1 ? parsed / 100 : parsed;
  return Math.min(1, scaled);
}

function parseTimestamp(data: Record<string, unknown>): Date {
  const raw = str(data, 'capturedAt', 'captured_at', 'timestamp', 'time', 'eventTime');
  if (raw) {
    // Epoch seconds or milliseconds.
    if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
    if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  // Falling back to receipt time keeps a vehicle moving; the skew check on the
  // ingestion path is what catches a genuinely broken camera clock.
  return new Date();
}

function parseDirection(data: Record<string, unknown>): TravelDirection {
  const raw = str(data, 'direction', 'flow', 'movement')?.toUpperCase() ?? '';
  if (raw.includes('EXIT') || raw.includes('OUT') || raw === 'DEPARTURE') {
    return TravelDirection.EXIT;
  }
  if (raw.includes('ENTRY') || raw.includes('IN') || raw === 'ARRIVAL') {
    return TravelDirection.ENTRY;
  }
  // Unknown direction resolves from the device's configured direction later.
  return TravelDirection.BIDIRECTIONAL;
}

function parseVehicleClass(value: string | null): VehicleClass | null {
  if (!value) return null;
  const v = value.toUpperCase();
  if (/(MOTORCYCLE|BIKE|TWO|2W|SCOOTER)/.test(v)) return VehicleClass.TWO_WHEELER;
  if (/(AUTO|THREE|3W|RICKSHAW)/.test(v)) return VehicleClass.THREE_WHEELER;
  if (/(SUV|JEEP)/.test(v)) return VehicleClass.SUV;
  if (/BUS/.test(v)) return VehicleClass.BUS;
  if (/(TRUCK|HEAVY|LORRY|TRAILER)/.test(v)) return VehicleClass.HCV;
  if (/(VAN|PICKUP|LIGHT|LCV)/.test(v)) return VehicleClass.LCV;
  if (/(CAR|SEDAN|HATCH)/.test(v)) return VehicleClass.CAR;
  return null;
}

/** Images live in object storage; keeping base64 in the JSON column would bloat it. */
function stripImages(data: Record<string, unknown>): Record<string, unknown> {
  const imageKeys = new Set([
    'image', 'imageBase64', 'snapshot', 'plateImage', 'plateImageBase64', 'plateCrop',
  ]);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (imageKeys.has(key)) {
      output[key] = typeof value === 'string' ? `[image:${value.length}b]` : '[image]';
    } else {
      output[key] = value;
    }
  }
  return output;
}
