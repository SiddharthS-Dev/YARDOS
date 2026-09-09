/**
 * Shared harness for database-backed suites.
 *
 * Boots the real Nest application against the real database - no mocked
 * repositories, no stubbed guards. A test that passes here has exercised the
 * same guards, pipes, filters, transactions, constraints and triggers that a
 * production request would.
 *
 * The one substitution is the queue driver: `QUEUE_DRIVER=inline` runs a job
 * on the calling thread instead of handing it to BullMQ. That keeps async
 * enrichment observable within a test without changing what the job does.
 */

import { createHash } from 'node:crypto';

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '@/app.module';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  http: () => request.Agent;
  close: () => Promise<void>;
}

/** Boots the application once for a suite. */
export async function createTestContext(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });

  // Mirrors main.ts. If these diverge, a test can pass against a pipeline the
  // production process does not have.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      disableErrorMessages: false,
      validationError: { target: false, value: false },
    }),
  );
  // GlobalExceptionFilter is registered through APP_FILTER in AppModule, so it
  // is already in the pipeline here - registering it again would double-handle.

  await app.init();

  const prisma = new PrismaClient();
  await prisma.$connect();

  return {
    app,
    prisma,
    http: () => request.agent(app.getHttpServer() as App),
    close: async () => {
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

/** The seeded accounts these suites sign in as. */
export const SEED_USERS = {
  admin: process.env['SEED_ADMIN_EMAIL'] ?? 'admin@srijpsmartpark.example',
  management: 'management@srijpsmartpark.example',
  yardChennai: 'yard.chennai@srijpsmartpark.example',
  yardCoimbatore: 'yard.coimbatore@srijpsmartpark.example',
  finance: 'finance@srijpsmartpark.example',
  auctions: 'auctions@srijpsmartpark.example',
} as const;

export const SEED_PASSWORDS = {
  admin: process.env['SEED_ADMIN_PASSWORD'] ?? 'ChangeMe!Admin2025',
  default: process.env['SEED_DEFAULT_PASSWORD'] ?? 'ChangeMe!Demo2025',
} as const;

export interface Session {
  accessToken: string;
  userId: string;
  email: string;
  auth: () => [string, string];
}

/**
 * Tokens already obtained, keyed on email.
 *
 * Login is rate limited to RATE_LIMIT_LOGIN_MAX per window - deliberately, so
 * an attacker cannot grind passwords. A suite that signs in inside every test
 * would trip that limit and fail for a reason that has nothing to do with what
 * it is testing, so a session is fetched once and reused. Tests that need to
 * exercise the login endpoint itself use `signInFresh`.
 */
const sessionCache = new Map<string, Session>();

/** Signs in and returns a bearer token, failing loudly if the seed is absent. */
export async function signIn(
  ctx: TestContext,
  email: string,
  password: string = SEED_PASSWORDS.default,
): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;

  const session = await signInFresh(ctx, email, password);
  sessionCache.set(email, session);
  return session;
}

/** Signs in without consulting the cache, for tests about login itself. */
export async function signInFresh(
  ctx: TestContext,
  email: string,
  password: string = SEED_PASSWORDS.default,
): Promise<Session> {
  const response = await ctx.http().post('/api/v1/auth/login').send({ email, password });

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(
      `Could not sign in as ${email} (HTTP ${response.status}). ` +
        `Has the database been seeded?  npm run db:seed\n` +
        JSON.stringify(response.body),
    );
  }

  const accessToken = response.body.accessToken as string;
  const userId = response.body.user?.id as string;

  return {
    accessToken,
    userId,
    email,
    auth: () => ['Authorization', `Bearer ${accessToken}`],
  };
}

/**
 * The financiers the seed gives a portal user to. Isolation tests need two,
 * so each can be pointed at the other's portfolio.
 */
export const PORTAL_FINANCIERS = ['NVF', 'SCF'] as const;

/** Signs in as the portal user of a given seeded financier. */
export async function signInAsFinancier(ctx: TestContext, financierCode: string): Promise<Session> {
  return signIn(ctx, `portal@${financierCode.toLowerCase()}.example`);
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A registration number that cannot collide with the seed or another test.
 *
 * Indian format: two-letter state, two-digit district, two-letter series, four
 * digits. The series letters are derived from a counter so parallel-ish suites
 * do not fight over the same plate.
 */
let plateCounter = 0;
export function uniquePlate(prefix = 'TN'): string {
  plateCounter += 1;
  const stamp = (Date.now() % 100000).toString().padStart(5, '0');
  const letters = String.fromCharCode(65 + (plateCounter % 26), 65 + ((plateCounter * 7) % 26));
  return `${prefix}09${letters}${stamp.slice(-4)}`;
}

/**
 * A unique plate the registry simulator will resolve to a hypothecated
 * vehicle, so the financier -> contract -> rate chain has something to bind to.
 *
 * The simulator is deterministic on a hash of the plate: roughly 3% of plates
 * raise a transient error, a further 4% come back NOT_FOUND, and 20% of the
 * remainder are unhypothecated. Those paths are all worth testing - but a test
 * about release and billing should not fail because its fixture happened to
 * land on one. This replicates the simulator's own hash and keeps drawing
 * until it finds a plate that lands on the path the test needs.
 *
 * Mirrors `hashToInt` and the roll thresholds in
 * `src/modules/registry/providers/mock-registry.provider.ts`. If those change,
 * this must change with them.
 */
export function hypothecatedPlate(prefix = 'TN'): string {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = uniquePlate(prefix);
    const seed = registrySeed(normalisePlate(candidate));

    const found = seed % 100 >= 7; // not a simulated error, not NOT_FOUND
    const hypothecated = seed % 10 < 8;

    if (found && hypothecated) return candidate;
  }
  throw new Error('Could not draw a plate the registry simulator will hypothecate.');
}

/** The registry simulator's plate hash. */
function registrySeed(normalizedPlate: string): number {
  return createHash('sha256').update(normalizedPlate).digest().readUInt32BE(0) % 2_147_483_647;
}

/** Strips separators and upper-cases, the way the platform normalises plates. */
export function normalisePlate(plate: string): string {
  return plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** Resolves the seeded site by code, so tests do not hard-code UUIDs. */
export async function siteByCode(ctx: TestContext, code: string) {
  const site = await ctx.prisma.site.findFirst({ where: { code } });
  if (!site) throw new Error(`Seeded site ${code} not found. Run npm run db:seed.`);
  return site;
}

/** Resolves the seeded financier by code. */
export async function financierByCode(ctx: TestContext, code: string) {
  const financier = await ctx.prisma.financier.findFirst({ where: { code } });
  if (!financier) throw new Error(`Seeded financier ${code} not found. Run npm run db:seed.`);
  return financier;
}

/** An online gate at a site, with its lanes, for ANPR simulation. */
export async function entryGate(ctx: TestContext, siteId: string) {
  const gate = await ctx.prisma.gate.findFirst({
    where: { siteId, status: 'ONLINE' },
    include: { lanes: true },
  });
  if (!gate) throw new Error('No online gate at the seeded site.');
  return gate;
}

/** A reachable ANPR device at a site, facing the requested direction. */
export async function anprDevice(
  ctx: TestContext,
  siteId: string,
  direction: 'ENTRY' | 'EXIT' = 'ENTRY',
) {
  const device = await ctx.prisma.anprDevice.findFirst({
    where: {
      siteId,
      status: { in: ['ONLINE', 'DEGRADED'] },
      direction: { in: [direction, 'BIDIRECTIONAL'] },
    },
  });
  if (!device) {
    throw new Error(`No reachable ${direction} ANPR device at the seeded site.`);
  }
  return device;
}

/** The recovery yard the Phase-1 suites operate against. */
export const CHENNAI_YARD = 'YRD-CHN-01';
export const COIMBATORE_YARD = 'YRD-CBE-01';
