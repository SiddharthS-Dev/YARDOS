import { Inject, Injectable } from '@nestjs/common';

import { FuelType, HypothecationStatus, VehicleClass } from '@smartpark/contracts';
import { APP_CONFIG, AppConfig } from '@/config/configuration';
import {
  RegistryLookupResult,
  RegistryProviderError,
  VehicleRegistryProvider,
  VehicleRegistryRecord,
} from '../vehicle-registry.provider';

/**
 * HTTP adapter for a licensed VAHAN aggregator.
 *
 * STATUS: the transport, timeout, error mapping and normalisation are complete
 * and production-shaped. What is NOT settled is which aggregator Sri JP will
 * contract with (docs/open-items.md OI-01), and therefore the exact request and
 * response shapes.
 *
 * The response mapping below is written against a conventional aggregator JSON
 * shape and is deliberately DEFENSIVE - it reads several plausible field names
 * for each value and returns null when none is present. When the provider is
 * chosen, `mapResponse` is the single function to adjust; nothing else in the
 * platform changes.
 *
 * This adapter never invents data. If a field is absent it stays null, and the
 * vehicle simply shows that field as unknown.
 */
@Injectable()
export class AggregatorVehicleRegistryProvider extends VehicleRegistryProvider {
  readonly name = 'aggregator';
  readonly authoritative = true;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  get configured(): boolean {
    return Boolean(this.config.registry.baseUrl && this.config.registry.apiKey);
  }

  async lookup(normalizedRegistrationNumber: string): Promise<RegistryLookupResult> {
    if (!this.configured) {
      throw new RegistryProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'The vehicle registry aggregator has no base URL or API key configured.',
        false,
      );
    }

    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.registry.timeoutMs);

    let response: Response;
    try {
      response = await fetch(
        `${this.config.registry.baseUrl.replace(/\/+$/, '')}/vehicle/${encodeURIComponent(
          normalizedRegistrationNumber,
        )}`,
        {
          method: 'GET',
          headers: {
            // Header name is aggregator-specific; adjust alongside mapResponse.
            'x-api-key': this.config.registry.apiKey,
            accept: 'application/json',
          },
          signal: controller.signal,
        },
      );
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new RegistryProviderError(
        aborted ? 'TIMEOUT' : 'TRANSPORT_ERROR',
        aborted
          ? `The registry did not respond within ${this.config.registry.timeoutMs}ms.`
          : 'Could not reach the vehicle registry.',
        true,
        null,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - started;

    if (response.status === 404) {
      return { outcome: 'NOT_FOUND', record: null, latencyMs, httpStatus: 404 };
    }
    if (response.status === 401 || response.status === 403) {
      // Not retryable: retrying a rejected credential just burns quota.
      throw new RegistryProviderError(
        'AUTHENTICATION_FAILED',
        'The registry rejected our credentials.',
        false,
        response.status,
      );
    }
    if (response.status === 429) {
      throw new RegistryProviderError(
        'RATE_LIMITED',
        'The registry rate limit was exceeded.',
        true,
        429,
      );
    }
    if (!response.ok) {
      throw new RegistryProviderError(
        'UPSTREAM_ERROR',
        `The registry returned HTTP ${response.status}.`,
        response.status >= 500,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new RegistryProviderError(
        'MALFORMED_RESPONSE',
        'The registry returned a response that was not valid JSON.',
        false,
        response.status,
        error,
      );
    }

    return {
      outcome: 'FOUND',
      record: this.mapResponse(normalizedRegistrationNumber, body),
      latencyMs,
      httpStatus: response.status,
    };
  }

  /**
   * Normalises an aggregator payload.
   *
   * THE ONE PLACE to change once the provider is chosen. Each field reads
   * several plausible key spellings and falls back to null - an unmapped field
   * shows as unknown rather than silently becoming wrong.
   */
  private mapResponse(registrationNumber: string, body: unknown): VehicleRegistryRecord {
    const data = unwrap(body);

    return {
      registrationNumber,
      vehicleClass: mapVehicleClass(str(data, 'vehicleClass', 'vehicle_class', 'vehicleCategory')),
      vehicleType: str(data, 'vehicleType', 'vehicle_type', 'bodyType'),
      make: str(data, 'make', 'manufacturer', 'maker'),
      model: str(data, 'model', 'vehicleModel', 'makerModel'),
      variant: str(data, 'variant', 'vehicleVariant'),
      color: str(data, 'color', 'colour', 'vehicleColour'),
      fuelType: mapFuelType(str(data, 'fuelType', 'fuel_type', 'fuel')),
      manufacturingYear: int(data, 'manufacturingYear', 'manufacturing_year', 'mfgYear'),
      registeredOwnerName: str(data, 'ownerName', 'owner_name', 'registeredOwner'),
      registeredOwnerAddress: str(data, 'permanentAddress', 'address', 'ownerAddress'),
      financierName: str(data, 'financier', 'financierName', 'hypothecatedTo', 'rcFinancer'),
      hypothecationStatus: mapHypothecation(
        str(data, 'financier', 'financierName', 'hypothecatedTo', 'rcFinancer'),
        str(data, 'hypothecationStatus', 'isHypothecated'),
      ),
      registrationDate: date(data, 'registrationDate', 'regDate', 'registration_date'),
      fitnessValidUpto: date(data, 'fitnessUpto', 'fitness_valid_upto', 'rcExpiryDate'),
      insuranceValidUpto: date(data, 'insuranceUpto', 'insurance_valid_upto'),
      // Only the tail is retained: the platform has no workflow needing the
      // full chassis or engine number, and storing them is needless exposure.
      chassisNumberLast4: last4(str(data, 'chassisNumber', 'chassis_no', 'chassis')),
      engineNumberLast4: last4(str(data, 'engineNumber', 'engine_no', 'engine')),
      source: 'AGGREGATOR',
      retrievedAt: new Date(),
      raw: redactRegistryPayload(data),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Defensive field readers                                             */
/* ------------------------------------------------------------------ */

/** Aggregators commonly wrap the payload in `data` or `result`. */
function unwrap(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  for (const key of ['data', 'result', 'response', 'vehicle']) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return record;
}

function str(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function int(data: Record<string, unknown>, ...keys: string[]): number | null {
  const raw = str(data, ...keys);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(data: Record<string, unknown>, ...keys: string[]): Date | null {
  const raw = str(data, ...keys);
  if (raw === null) return null;

  // Indian registry payloads commonly use DD-MM-YYYY or DD/MM/YYYY, which
  // JavaScript's Date parses as month-first or not at all.
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(raw);
  if (dmy) {
    return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function last4(value: string | null): string | null {
  if (!value) return null;
  return value.slice(-4);
}

function mapVehicleClass(value: string | null): VehicleClass | null {
  if (!value) return null;
  const v = value.toUpperCase();
  if (/(M-CYCLE|MOTOR ?CYCLE|SCOOTER|TWO|2W)/.test(v)) return VehicleClass.TWO_WHEELER;
  if (/(THREE|3W|AUTO|E-RICKSHAW)/.test(v)) return VehicleClass.THREE_WHEELER;
  if (/(SUV|MUV|JEEP)/.test(v)) return VehicleClass.SUV;
  if (/(BUS|OMNIBUS)/.test(v)) return VehicleClass.BUS;
  if (/(HGV|HEAVY|TRUCK|TRAILER|LORRY)/.test(v)) return VehicleClass.HCV;
  if (/(LGV|LIGHT|LMV-?GOODS|PICK ?UP|GOODS)/.test(v)) return VehicleClass.LCV;
  if (/TRACTOR/.test(v)) return VehicleClass.TRACTOR;
  if (/(CAR|LMV|MOTOR ?CAR)/.test(v)) return VehicleClass.CAR;
  return VehicleClass.UNKNOWN;
}

function mapFuelType(value: string | null): FuelType | null {
  if (!value) return null;
  const v = value.toUpperCase();
  if (v.includes('PETROL')) return FuelType.PETROL;
  if (v.includes('DIESEL')) return FuelType.DIESEL;
  if (v.includes('CNG')) return FuelType.CNG;
  if (v.includes('LPG')) return FuelType.LPG;
  if (v.includes('ELECTRIC') || v.includes('BATTERY')) return FuelType.ELECTRIC;
  if (v.includes('HYBRID')) return FuelType.HYBRID;
  return FuelType.UNKNOWN;
}

/**
 * Absence of a financier name is NOT proof there is no hypothecation - some
 * providers omit the field entirely. UNKNOWN is the honest answer, and the
 * console shows it as such rather than as "not hypothecated".
 */
function mapHypothecation(
  financierName: string | null,
  explicitStatus: string | null,
): HypothecationStatus {
  if (explicitStatus) {
    const v = explicitStatus.toUpperCase();
    if (v === 'TRUE' || v.includes('HYPOTHECAT')) return HypothecationStatus.HYPOTHECATED;
    if (v === 'FALSE' || v.includes('NOT') || v.includes('NONE')) {
      return HypothecationStatus.NOT_HYPOTHECATED;
    }
    if (v.includes('TERMINAT') || v.includes('CANCEL')) return HypothecationStatus.TERMINATED;
  }
  if (financierName && financierName.trim().length > 0) return HypothecationStatus.HYPOTHECATED;
  return HypothecationStatus.UNKNOWN;
}

/**
 * Strips fields we deliberately do not retain before the payload is stored.
 * Keeping a full chassis number in a JSON blob would defeat only storing its
 * last four characters in the column.
 */
function redactRegistryPayload(data: Record<string, unknown>): Record<string, unknown> {
  const dropped = new Set([
    'chassisNumber', 'chassis_no', 'chassis',
    'engineNumber', 'engine_no', 'engine',
    'aadhaar', 'aadhaarNumber', 'pan', 'panNumber',
    'mobileNumber', 'mobile', 'phone',
  ]);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    output[key] = dropped.has(key) ? '[NOT_RETAINED]' : value;
  }
  return output;
}
