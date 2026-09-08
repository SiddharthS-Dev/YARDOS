import { FuelType, HypothecationStatus, VehicleClass } from '@smartpark/contracts';

/**
 * The vehicle-registry integration boundary.
 *
 * Requirement S11: the domain must never contain VAHAN-specific logic. Nothing
 * outside this folder knows whether the data came from VAHAN directly, from a
 * licensed aggregator, or from the development simulator.
 *
 * IMPORTANT CONTEXT (docs/open-items.md OI-01 to OI-03):
 * Direct VAHAN access is regulated, and Sri JP has not yet confirmed the
 * authorised route or its commercial terms. Until that is settled, `mock` is
 * the only implemented provider. It is clearly labelled non-authoritative at
 * every layer - the record it produces carries `source: 'MOCK'`, the console
 * badges it, and the configuration guard refuses to boot production with it.
 * No code here fabricates a "VAHAN response"; it fabricates a *simulator*
 * response and says so.
 */

/** What a provider returns for one registration number. */
export interface VehicleRegistryRecord {
  registrationNumber: string;
  vehicleClass: VehicleClass | null;
  /** Free-text body type as the registry words it. */
  vehicleType: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  color: string | null;
  fuelType: FuelType | null;
  manufacturingYear: number | null;
  registeredOwnerName: string | null;
  registeredOwnerAddress: string | null;
  /** Hypothecation holder exactly as returned. Matching happens downstream. */
  financierName: string | null;
  hypothecationStatus: HypothecationStatus;
  registrationDate: Date | null;
  fitnessValidUpto: Date | null;
  insuranceValidUpto: Date | null;
  /** Last four characters only; the platform has no use for the full values. */
  chassisNumberLast4: string | null;
  engineNumberLast4: string | null;
  /** VAHAN | AGGREGATOR | MOCK - recorded on the ownership record. */
  source: string;
  retrievedAt: Date;
  /** Provider payload, already reduced. Retained for dispute resolution. */
  raw: Record<string, unknown>;
}

export interface RegistryLookupResult {
  outcome: 'FOUND' | 'NOT_FOUND';
  record: VehicleRegistryRecord | null;
  latencyMs: number;
  httpStatus: number | null;
}

/**
 * Raised for a lookup that failed rather than returned "not found".
 * `retryable` tells the caller whether another attempt could plausibly succeed.
 */
export class RegistryProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RegistryProviderError';
  }
}

export abstract class VehicleRegistryProvider {
  /** Stable key recorded on every lookup and ownership record. */
  abstract readonly name: string;

  /**
   * False when the provider cannot be used - typically missing credentials.
   * The service reports CONFIGURATION_REQUIRED rather than failing obscurely.
   */
  abstract readonly configured: boolean;

  /**
   * Whether records from this provider may be treated as authoritative.
   * The mock returns false, and everything downstream respects it: such a
   * record never sets `VAHAN_VERIFIED`, only `UNAVAILABLE`.
   */
  abstract readonly authoritative: boolean;

  /**
   * @throws RegistryProviderError on transport, auth, quota or timeout failure.
   *         A registration number that simply does not exist is NOT an error;
   *         it returns `outcome: 'NOT_FOUND'`.
   */
  abstract lookup(normalizedRegistrationNumber: string): Promise<RegistryLookupResult>;
}
