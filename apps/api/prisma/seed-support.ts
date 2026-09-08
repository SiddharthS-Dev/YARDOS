/**
 * Shared helpers for the seed.
 *
 * Kept separate so the seed orchestrator (`seed.ts`) and the operational data
 * builder (`seed-operations.ts`) share one Prisma client, one deterministic
 * random source, and one set of text helpers.
 */

import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const prisma = new PrismaClient();

/** Copied into every placeholder commercial value so it cannot be mistaken. */
export const PLACEHOLDER =
  'PLACEHOLDER VALUE - not a Sri JP commercial term. See docs/open-items.md.';

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-randomness                                     */
/* ------------------------------------------------------------------ */

/**
 * An xorshift generator with a fixed seed, so two runs produce the same estate.
 * Demos, screenshots and test expectations all depend on that stability;
 * `Math.random()` would make the seed unreproducible.
 */
let randomState = 0x2f6e2b1;

export function nextRandom(): number {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return Math.abs(randomState) / 2_147_483_647;
}

export function resetRandom(seed = 0x2f6e2b1): void {
  randomState = seed;
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(nextRandom() * items.length) % items.length] as T;
}

export function intBetween(min: number, max: number): number {
  return min + Math.floor(nextRandom() * (max - min + 1));
}

export function chance(probability: number): boolean {
  return nextRandom() < probability;
}

export function daysAgo(days: number, jitterHours = 0): Date {
  const base = Date.now() - days * 86_400_000;
  return new Date(base - Math.floor(nextRandom() * jitterHours) * 3_600_000);
}

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

/**
 * Must produce the same format `PasswordHasher` verifies:
 * `scrypt$N$r$p$<base64 salt>$<base64 hash>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const N = 2 ** 15;
  const r = 8;
  const p = 2;
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, { N, r, p, maxmem: 256 * N * r });
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Mirrors FinancierMatcherService.normalizeCompanyName. */
export function normalizeCompanyName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(PRIVATE|PVT|LIMITED|LTD|LLP|INC|CORPORATION|CORP|COMPANY|CO)\b/g, ' ')
    .replace(/\s+/g, '');
}

export function humaniseRole(code: string): string {
  return code
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

export function describeRole(code: string): string {
  const descriptions: Record<string, string> = {
    SYSTEM_ADMINISTRATOR: 'Full platform control, including users, roles and integrations.',
    MANAGEMENT:
      'Business visibility and reporting across every site. Can approve releases but does ' +
      'not create financial records, keeping sign-off separate from execution.',
    YARD_STAFF:
      'Gate and yard floor operations: admit, allocate, hold and request release. Cannot ' +
      'approve a release or touch money.',
    FINANCE_OFFICER:
      'Owns contracts, rates and the billing lifecycle end to end.',
    AUCTION_ADMINISTRATOR:
      'Runs auctions and settlement. Cannot issue invoices or record payments, keeping ' +
      'disposal separate from cash collection.',
    FINANCIER_USER:
      'Financier portal. Every read is narrowed to their own financier.',
    DEVICE_SERVICE_ACCOUNT:
      'Machine principal for ANPR gateways. Ingest only - no read access at all.',
  };
  return descriptions[code] ?? code;
}

export function describePermission(code: string): string {
  const [resource = '', action = '', qualifier] = code.split(':');
  const verbs: Record<string, string> = {
    read: 'View',
    write: 'Create and edit',
    approve: 'Approve',
    place: 'Place',
    issue: 'Issue',
    void: 'Void',
    send: 'Send',
    generate: 'Generate',
    record: 'Record',
    refund: 'Refund',
    publish: 'Publish',
    open: 'Open',
    close: 'Close',
    selectwinner: 'Select the winning bid for',
    request: 'Request',
    execute: 'Execute',
    admit: 'Admit',
    allocate: 'Allocate',
    hold: 'Place a hold on',
    recalculate: 'Recalculate',
    ingest: 'Ingest',
    review: 'Review',
    lookup: 'Perform a lookup against',
    trigger: 'Trigger',
    impersonate: 'Impersonate',
    export: 'Export',
    portal: 'Access the portal for',
    device: 'Manage devices for',
    event: 'Access events for',
    template: 'Manage templates for',
    pii: 'View personal data on',
    timeline: 'View the timeline of',
    access: 'Access',
    verify: 'Verify',
  };
  const verb = verbs[action] ?? action;
  const subject = resource.replace(/([a-z])([A-Z])/g, '$1 $2');
  return qualifier ? `${verb} ${subject} (${qualifier}).` : `${verb} ${subject}.`;
}

/** Registration numbers for the demo estate, spread across states and series. */
export function generatePlate(index: number): string {
  const states = ['TN', 'KA', 'AP', 'TS', 'KL', 'MH'];
  const state = states[index % states.length] as string;
  const district = String((index % 89) + 1).padStart(2, '0');
  const letters = String.fromCharCode(65 + (index % 26)) + String.fromCharCode(65 + ((index * 7) % 26));
  const number = String(1000 + ((index * 137) % 9000));
  return `${state}${district}${letters}${number}`;
}
