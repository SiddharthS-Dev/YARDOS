/**
 * The production safety guard is the last thing standing between a hurried
 * deploy and a production system that fabricates ANPR reads, invents registry
 * data, or signs tokens with a secret published in `.env.example`.
 *
 * These tests exist because that guard is easy to weaken accidentally: a new
 * mock provider, a new template secret, a relaxed default. Each case below
 * pins one refusal, so removing it fails here rather than in production.
 */

import { environmentSchema, loadConfiguration, productionSafetyChecks } from './configuration';

/** A configuration that is genuinely safe for production. */
const SAFE_PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://smartpark:test-fixture-db-password-not-a-credential@db.internal:5432/smartpark',
  REDIS_URL: 'redis://cache.internal:6379',
  JWT_ACCESS_SECRET: 'test-fixture-access-secret-not-a-credential-0001',
  JWT_REFRESH_SECRET: 'test-fixture-refresh-secret-not-a-credential-002',
  ENCRYPTION_KEY: 'dGVzdC1maXh0dXJlLWtleS1ub3QtYS1jcmVkZW50aWFsMDE=',
  CORS_ORIGINS: 'https://console.example.com',
  LOG_PRETTY: 'false',
  ANPR_PROVIDER: 'generic-webhook',
  VEHICLE_REGISTRY_PROVIDER: 'aggregator',
  VEHICLE_REGISTRY_BASE_URL: 'https://registry.example.com',
  VEHICLE_REGISTRY_API_KEY: 'not-a-real-key-but-non-empty',
  PAYMENT_PROVIDER: 'manual',
  NOTIFICATIONS_ENABLED: 'false',
  OBJECT_STORAGE_DRIVER: 's3',
  OBJECT_STORAGE_BUCKET: 'smartpark-prod',
  QUEUE_DRIVER: 'bullmq',
} as const;

/** Parses an override on top of the safe baseline. */
const check = (overrides: Record<string, string> = {}): string[] =>
  productionSafetyChecks(environmentSchema.parse({ ...SAFE_PRODUCTION, ...overrides }));

describe('productionSafetyChecks', () => {
  it('accepts a production configuration with no development leftovers', () => {
    expect(check()).toEqual([]);
  });

  it('is inert outside production, so development is not obstructed', () => {
    const development = environmentSchema.parse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://smartpark:smartpark_dev_only@localhost:5432/smartpark',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'replace-me-with-a-48-byte-random-value-access-0000',
      JWT_REFRESH_SECRET: 'replace-me-with-a-48-byte-random-value-refresh-000',
      ENCRYPTION_KEY: 'cmVwbGFjZS1tZS0zMi1ieXRlLWtleS1iYXNlNjQtMDAwMDA=',
      ANPR_PROVIDER: 'mock',
      VEHICLE_REGISTRY_PROVIDER: 'mock',
      PAYMENT_PROVIDER: 'mock',
      QUEUE_DRIVER: 'inline',
      OBJECT_STORAGE_DRIVER: 'filesystem',
      LOG_PRETTY: 'true',
    });

    expect(productionSafetyChecks(development)).toEqual([]);
  });

  describe('secrets', () => {
    it.each([
      ['JWT_ACCESS_SECRET', 'replace-me-with-a-48-byte-random-value-access-0000'],
      ['JWT_REFRESH_SECRET', 'replace-me-with-a-48-byte-random-value-refresh-000'],
      ['ENCRYPTION_KEY', 'cmVwbGFjZS1tZS0zMi1ieXRlLWtleS1iYXNlNjQtMDAwMDA='],
    ])('rejects %s when it is still the .env.example value', (key, templateValue) => {
      expect(check({ [key]: templateValue })).toContainEqual(
        expect.stringContaining(`${key} is still set to the value from .env.example`),
      );
    });

    it('rejects reusing one secret for both access and refresh tokens', () => {
      const shared = 'test-fixture-shared-secret-not-a-credential-003';
      expect(check({ JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared })).toContainEqual(
        expect.stringContaining('must be different values'),
      );
    });

    it('rejects the development database password', () => {
      expect(
        check({ DATABASE_URL: 'postgresql://smartpark:smartpark_dev_only@db:5432/smartpark' }),
      ).toContainEqual(expect.stringContaining('development password'));
    });

    it('refuses a secret shorter than 32 characters at the schema level', () => {
      expect(() => environmentSchema.parse({ ...SAFE_PRODUCTION, JWT_ACCESS_SECRET: 'short' }))
        .toThrow(/at least 32 characters/);
    });
  });

  describe('mock adapters', () => {
    // Each of these would fabricate business data: invented number plates,
    // invented registry ownership, invented payment confirmations.
    it.each([
      ['ANPR_PROVIDER'],
      ['VEHICLE_REGISTRY_PROVIDER'],
      ['PAYMENT_PROVIDER'],
    ])('rejects %s=mock', (key) => {
      expect(check({ [key]: 'mock' })).toContainEqual(expect.stringContaining(`${key}=mock`));
    });

    it('names the open item when the registry provider is a mock', () => {
      expect(check({ VEHICLE_REGISTRY_PROVIDER: 'mock' })).toContainEqual(
        expect.stringContaining('OI-01'),
      );
    });

    it('rejects mock notification providers while notifications are enabled', () => {
      const problems = check({
        NOTIFICATIONS_ENABLED: 'true',
        SMS_PROVIDER: 'mock',
        EMAIL_PROVIDER: 'mock',
        WHATSAPP_PROVIDER: 'mock',
      });

      expect(problems).toContainEqual(expect.stringContaining('SMS_PROVIDER=mock'));
      expect(problems).toContainEqual(expect.stringContaining('EMAIL_PROVIDER=mock'));
      expect(problems).toContainEqual(expect.stringContaining('WHATSAPP_PROVIDER=mock'));
    });

    it('tolerates mock notification providers when notifications are switched off', () => {
      expect(
        check({ NOTIFICATIONS_ENABLED: 'false', SMS_PROVIDER: 'mock', EMAIL_PROVIDER: 'mock' }),
      ).toEqual([]);
    });

    it('requires the aggregator route to be fully configured', () => {
      const problems = check({
        VEHICLE_REGISTRY_PROVIDER: 'aggregator',
        VEHICLE_REGISTRY_BASE_URL: '',
        VEHICLE_REGISTRY_API_KEY: '',
      });

      expect(problems).toContainEqual(expect.stringContaining('VEHICLE_REGISTRY_BASE_URL'));
      expect(problems).toContainEqual(expect.stringContaining('VEHICLE_REGISTRY_API_KEY'));
    });
  });

  describe('exposure and durability', () => {
    it('rejects a wildcard CORS origin', () => {
      expect(check({ CORS_ORIGINS: '*' })).toContainEqual(expect.stringContaining('must not contain "*"'));
    });

    it('rejects an empty CORS allow-list', () => {
      expect(check({ CORS_ORIGINS: '' })).toContainEqual(
        expect.stringContaining('must list the exact console origins'),
      );
    });

    it('rejects a plaintext HTTP origin that is not localhost', () => {
      expect(check({ CORS_ORIGINS: 'http://console.example.com' })).toContainEqual(
        expect.stringContaining('plaintext HTTP'),
      );
    });

    it('rejects pretty logging, which breaks structured log ingestion', () => {
      expect(check({ LOG_PRETTY: 'true' })).toContainEqual(
        expect.stringContaining('must be false in production'),
      );
    });

    it('rejects filesystem object storage as non-durable', () => {
      expect(check({ OBJECT_STORAGE_DRIVER: 'filesystem' })).toContainEqual(
        expect.stringContaining('not durable'),
      );
    });

    it('rejects the inline queue driver, which would run jobs in the request path', () => {
      expect(check({ QUEUE_DRIVER: 'inline' })).toContainEqual(
        expect.stringContaining('for tests only'),
      );
    });
  });

  it('reports every problem at once rather than one per boot attempt', () => {
    const problems = check({
      ANPR_PROVIDER: 'mock',
      PAYMENT_PROVIDER: 'mock',
      QUEUE_DRIVER: 'inline',
      LOG_PRETTY: 'true',
      CORS_ORIGINS: '*',
    });

    expect(problems.length).toBeGreaterThanOrEqual(5);
  });
});

describe('loadConfiguration', () => {
  it('refuses to boot production on an unsafe configuration', () => {
    expect(() =>
      loadConfiguration({
        ...SAFE_PRODUCTION,
        PAYMENT_PROVIDER: 'mock',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/PAYMENT_PROVIDER=mock/);
  });

  it('reports validation failures with the offending key named', () => {
    expect(() =>
      loadConfiguration({
        DATABASE_URL: 'not-a-url',
        REDIS_URL: 'redis://localhost:6379',
        JWT_ACCESS_SECRET: 'test-fixture-access-secret-not-a-credential-0001',
        JWT_REFRESH_SECRET: 'test-fixture-refresh-secret-not-a-credential-002',
        ENCRYPTION_KEY: 'dGVzdC1maXh0dXJlLWtleS1ub3QtYS1jcmVkZW50aWFsMDE=',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });

  it('does not include any secret value in its error message', () => {
    let message = '';
    try {
      loadConfiguration({
        ...SAFE_PRODUCTION,
        DATABASE_URL: 'not-a-url',
      } as unknown as NodeJS.ProcessEnv);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain(SAFE_PRODUCTION.JWT_ACCESS_SECRET);
    expect(message).not.toContain(SAFE_PRODUCTION.JWT_REFRESH_SECRET);
    expect(message).not.toContain(SAFE_PRODUCTION.ENCRYPTION_KEY);
    expect(message).not.toContain('test-fixture-db-password-not-a-credential');
  });
});
