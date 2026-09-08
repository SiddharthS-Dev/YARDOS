import { TravelDirection, VehicleClass } from '@smartpark/contracts';

/**
 * The ANPR integration boundary.
 *
 * Requirement S10: "Do not couple the domain directly to a specific camera
 * manufacturer." Every recogniser has its own payload shape, its own field
 * names for confidence, and its own signing scheme. A provider's whole job is
 * to turn that into the one normalised event the platform understands.
 *
 * Nothing downstream of `normalize()` knows which camera vendor produced an
 * event, which is what makes swapping vendors - or running two vendors at
 * different sites - a configuration matter.
 */

/** The single event shape the domain works with. */
export interface NormalizedAnprEvent {
  /** The recogniser's own event id. The primary idempotency key. */
  providerEventId: string;
  /** Provider's device identifier, mapped to an AnprDevice row. */
  providerDeviceId: string;
  capturedAt: Date;
  plateNumberRaw: string;
  /** 0..1. Providers reporting 0-100 are rescaled by their adapter. */
  confidence: number;
  direction: TravelDirection;
  vehicleClassHint: VehicleClass | null;
  /** Base64 overview image, when the provider sends one inline. */
  imageBase64?: string | null;
  plateImageBase64?: string | null;
  /** Provider payload, retained for diagnosis. */
  raw: Record<string, unknown>;
}

export class AnprPayloadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AnprPayloadError';
  }
}

export abstract class AnprProvider {
  abstract readonly name: string;

  /**
   * Converts a provider payload into the normalised event.
   *
   * @throws AnprPayloadError when required fields are missing. A malformed
   *         payload is rejected loudly rather than admitted as a low-confidence
   *         capture, because a silently mis-parsed plate becomes the wrong
   *         vehicle in the yard.
   */
  abstract normalize(payload: unknown): NormalizedAnprEvent;

  /**
   * Verifies the request signature.
   *
   * Return true when the provider does not sign requests AND signature
   * enforcement is disabled; the ingestion service decides whether an unsigned
   * event is acceptable, based on configuration.
   */
  abstract verifySignature(input: {
    rawBody: string;
    signature: string | undefined;
    timestamp: string | undefined;
    sharedSecret: string | null;
  }): { valid: boolean; reason?: string };
}
