/**
 * Environment configuration.
 *
 * Two hard rules, both enforced here rather than by convention:
 *
 *   1. The process refuses to start on an invalid configuration. A typo in a
 *      duration or a missing secret must fail at boot, loudly, not at 02:00
 *      during a charge accrual run.
 *   2. Nothing in production may run on a development default. The
 *      `productionSafetyChecks` pass rejects template secrets, mock providers,
 *      pretty logging and permissive CORS when NODE_ENV=production.
 *
 * Business configuration does NOT live here - rates, free days, billing rules
 * and thresholds are database rows (see `SystemSetting` and the contract
 * tables), because they change without a deploy. This file holds only
 * infrastructure and integration wiring.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Coercion helpers                                                    */
/* ------------------------------------------------------------------ */

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const intFromString = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

const floatFromString = (min: number, max: number) =>
  z.coerce.number().min(min).max(max);

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: intFromString(1, 65535).default(3000),
  API_PREFIX: z.string().default('api'),
  APP_VERSION: z.string().default('0.0.0'),
  CORS_ORIGINS: csv,

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  LOG_PRETTY: booleanFromString.default(false),
  LOG_REQUEST_SAMPLE_RATE: floatFromString(0, 1).default(1),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: intFromString(1, 200).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: intFromString(1000, 600000).default(15000),

  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('smartpark'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('smartpark-enterprise'),
  JWT_AUDIENCE: z.string().default('smartpark-console'),
  JWT_ACCESS_TTL_SECONDS: intFromString(60, 86400).default(900),
  JWT_REFRESH_TTL_SECONDS: intFromString(300, 31536000).default(2592000),

  ENCRYPTION_KEY: z.string().min(1),

  AUTH_MAX_FAILED_ATTEMPTS: intFromString(1, 100).default(5),
  AUTH_LOCKOUT_MINUTES: intFromString(1, 1440).default(15),
  AUTH_PASSWORD_MIN_LENGTH: intFromString(8, 128).default(12),
  AUTH_SCRYPT_LOG_N: intFromString(12, 20).default(15),
  AUTH_SCRYPT_R: intFromString(1, 32).default(8),
  AUTH_SCRYPT_P: intFromString(1, 16).default(2),

  RATE_LIMIT_WINDOW_SECONDS: intFromString(1, 3600).default(60),
  RATE_LIMIT_MAX_REQUESTS: intFromString(1, 100000).default(300),
  RATE_LIMIT_LOGIN_MAX: intFromString(1, 1000).default(10),
  RATE_LIMIT_ANPR_MAX: intFromString(1, 100000).default(600),

  QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
  WORKERS_ENABLED: booleanFromString.default(true),
  JOB_CHARGE_ACCRUAL_CRON: z.string().default('0 30 0 * * *'),
  JOB_OUTBOX_RELAY_INTERVAL_MS: intFromString(250, 600000).default(2000),
  JOB_NOTIFICATION_RETRY_INTERVAL_MS: intFromString(1000, 3600000).default(30000),
  JOB_REGISTRY_RETRY_INTERVAL_MS: intFromString(1000, 3600000).default(60000),

  OBJECT_STORAGE_DRIVER: z.enum(['s3', 'filesystem']).default('filesystem'),
  OBJECT_STORAGE_BUCKET: z.string().default('smartpark'),
  OBJECT_STORAGE_REGION: z.string().default('us-east-1'),
  OBJECT_STORAGE_ENDPOINT: z.string().default(''),
  OBJECT_STORAGE_FORCE_PATH_STYLE: booleanFromString.default(true),
  OBJECT_STORAGE_ACCESS_KEY: z.string().default(''),
  OBJECT_STORAGE_SECRET_KEY: z.string().default(''),
  OBJECT_STORAGE_LOCAL_PATH: z.string().default('./var/storage'),
  OBJECT_STORAGE_URL_TTL_SECONDS: intFromString(30, 86400).default(300),
  UPLOAD_MAX_BYTES: intFromString(1024, 104857600).default(15728640),
  UPLOAD_ALLOWED_MIME: csv,

  ANPR_PROVIDER: z.enum(['mock', 'generic-webhook']).default('mock'),
  ANPR_CONFIDENCE_THRESHOLD: floatFromString(0, 1).default(0.85),
  ANPR_DEDUPE_WINDOW_SECONDS: intFromString(0, 86400).default(120),
  ANPR_MAX_CLOCK_SKEW_SECONDS: intFromString(0, 86400).default(300),
  ANPR_REQUIRE_SIGNATURE: booleanFromString.default(false),
  ANPR_MOCK_INTERVAL_SECONDS: intFromString(0, 86400).default(0),

  VEHICLE_REGISTRY_PROVIDER: z.enum(['mock', 'aggregator']).default('mock'),
  VEHICLE_REGISTRY_BASE_URL: z.string().default(''),
  VEHICLE_REGISTRY_API_KEY: z.string().default(''),
  VEHICLE_REGISTRY_TIMEOUT_MS: intFromString(500, 120000).default(8000),
  VEHICLE_REGISTRY_MAX_ATTEMPTS: intFromString(1, 10).default(3),
  VEHICLE_REGISTRY_BREAKER_THRESHOLD: intFromString(1, 1000).default(5),
  VEHICLE_REGISTRY_BREAKER_COOLDOWN_SECONDS: intFromString(1, 3600).default(60),
  VEHICLE_REGISTRY_RATE_LIMIT_PER_MINUTE: intFromString(1, 100000).default(60),
  VEHICLE_REGISTRY_CACHE_TTL_HOURS: intFromString(0, 100000).default(720),

  PAYMENT_PROVIDER: z.enum(['manual', 'mock']).default('manual'),
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),
  PAYMENT_PROVIDER_KEY_ID: z.string().default(''),
  PAYMENT_PROVIDER_KEY_SECRET: z.string().default(''),
  PAYMENT_CALLBACK_BASE_URL: z.string().default(''),

  SMS_PROVIDER: z.enum(['mock']).default('mock'),
  EMAIL_PROVIDER: z.enum(['mock']).default('mock'),
  WHATSAPP_PROVIDER: z.enum(['mock']).default('mock'),
  NOTIFICATION_FROM_EMAIL: z.string().default('no-reply@example.invalid'),
  NOTIFICATION_FROM_NAME: z.string().default('SmartPark'),
  NOTIFICATION_SMS_SENDER_ID: z.string().default(''),
  SMS_PROVIDER_API_KEY: z.string().default(''),
  EMAIL_PROVIDER_API_KEY: z.string().default(''),
  WHATSAPP_PROVIDER_API_KEY: z.string().default(''),
  WHATSAPP_BUSINESS_PHONE_ID: z.string().default(''),
  NOTIFICATIONS_ENABLED: booleanFromString.default(true),

  SEED_ADMIN_EMAIL: z.string().default('admin@smartpark.local'),
  SEED_ADMIN_PASSWORD: z.string().default(''),
  SEED_DEFAULT_PASSWORD: z.string().default(''),
  SEED_VEHICLE_COUNT: intFromString(0, 100000).default(60),
});

export type Environment = z.infer<typeof environmentSchema>;

/* ------------------------------------------------------------------ */
/* Structured, typed application configuration                         */
/* ------------------------------------------------------------------ */

export interface AppConfig {
  env: Environment['NODE_ENV'];
  isProduction: boolean;
  isTest: boolean;
  port: number;
  apiPrefix: string;
  version: string;
  corsOrigins: string[];

  log: { level: string; pretty: boolean; requestSampleRate: number };

  database: { url: string; poolSize: number; statementTimeoutMs: number };

  redis: { url: string; keyPrefix: string };

  auth: {
    accessSecret: string;
    refreshSecret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    maxFailedAttempts: number;
    lockoutMinutes: number;
    passwordMinLength: number;
    scrypt: { logN: number; r: number; p: number };
  };

  encryptionKey: string;

  rateLimit: {
    windowSeconds: number;
    maxRequests: number;
    loginMax: number;
    anprMax: number;
  };

  jobs: {
    queueDriver: 'bullmq' | 'inline';
    workersEnabled: boolean;
    chargeAccrualCron: string;
    outboxRelayIntervalMs: number;
    notificationRetryIntervalMs: number;
    registryRetryIntervalMs: number;
  };

  storage: {
    driver: 's3' | 'filesystem';
    bucket: string;
    region: string;
    endpoint: string;
    forcePathStyle: boolean;
    accessKey: string;
    secretKey: string;
    localPath: string;
    urlTtlSeconds: number;
    uploadMaxBytes: number;
    allowedMimeTypes: string[];
  };

  anpr: {
    provider: 'mock' | 'generic-webhook';
    confidenceThreshold: number;
    dedupeWindowSeconds: number;
    maxClockSkewSeconds: number;
    requireSignature: boolean;
    mockIntervalSeconds: number;
  };

  registry: {
    provider: 'mock' | 'aggregator';
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    maxAttempts: number;
    breakerThreshold: number;
    breakerCooldownSeconds: number;
    rateLimitPerMinute: number;
    cacheTtlHours: number;
  };

  payment: {
    provider: 'manual' | 'mock';
    webhookSecret: string;
    keyId: string;
    keySecret: string;
    callbackBaseUrl: string;
  };

  notification: {
    enabled: boolean;
    smsProvider: string;
    emailProvider: string;
    whatsappProvider: string;
    fromEmail: string;
    fromName: string;
    smsSenderId: string;
    smsApiKey: string;
    emailApiKey: string;
    whatsappApiKey: string;
    whatsappPhoneId: string;
  };

  seed: {
    adminEmail: string;
    adminPassword: string;
    defaultPassword: string;
    vehicleCount: number;
  };
}

/**
 * Values that ship in `.env.example`. Booting production with any of these
 * still in place is a deployment error, not a warning.
 */
const TEMPLATE_SECRETS = new Set([
  'replace-me-with-a-48-byte-random-value-access-0000',
  'replace-me-with-a-48-byte-random-value-refresh-000',
  'cmVwbGFjZS1tZS0zMi1ieXRlLWtleS1iYXNlNjQtMDAwMDA=',
  'smartpark_dev_only',
  'ChangeMe!Admin2025',
  'ChangeMe!Demo2025',
]);

/**
 * Refuses configurations that are unsafe for a production deployment.
 * Returns the list of problems; an empty list means the config is acceptable.
 */
export function productionSafetyChecks(env: Environment): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  for (const [key, value] of [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
    ['ENCRYPTION_KEY', env.ENCRYPTION_KEY],
  ] as const) {
    if (TEMPLATE_SECRETS.has(value)) {
      problems.push(`${key} is still set to the value from .env.example.`);
    }
  }

  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.');
  }

  if (env.DATABASE_URL.includes('smartpark_dev_only')) {
    problems.push('DATABASE_URL still contains the development password.');
  }

  if (env.LOG_PRETTY) {
    problems.push('LOG_PRETTY must be false in production (logs must be structured JSON).');
  }

  if (env.CORS_ORIGINS.length === 0) {
    problems.push('CORS_ORIGINS must list the exact console origins in production.');
  }
  if (env.CORS_ORIGINS.includes('*')) {
    problems.push('CORS_ORIGINS must not contain "*" in production.');
  }
  for (const origin of env.CORS_ORIGINS) {
    if (origin.startsWith('http://') && !origin.startsWith('http://localhost')) {
      problems.push(`CORS origin "${origin}" is plaintext HTTP; use HTTPS in production.`);
    }
  }

  // Mock adapters exist so development is not blocked on unavailable external
  // systems. Shipping one to production would fabricate business data.
  if (env.ANPR_PROVIDER === 'mock') {
    problems.push('ANPR_PROVIDER=mock cannot be used in production.');
  }
  if (env.VEHICLE_REGISTRY_PROVIDER === 'mock') {
    problems.push(
      'VEHICLE_REGISTRY_PROVIDER=mock cannot be used in production; ' +
        'the authorised VAHAN/aggregator route must be configured first (open item OI-01).',
    );
  }
  if (env.PAYMENT_PROVIDER === 'mock') {
    problems.push('PAYMENT_PROVIDER=mock cannot be used in production.');
  }
  if (env.NOTIFICATIONS_ENABLED) {
    for (const [key, value] of [
      ['SMS_PROVIDER', env.SMS_PROVIDER],
      ['EMAIL_PROVIDER', env.EMAIL_PROVIDER],
      ['WHATSAPP_PROVIDER', env.WHATSAPP_PROVIDER],
    ] as const) {
      if (value === 'mock') {
        problems.push(`${key}=mock cannot be used in production while notifications are enabled.`);
      }
    }
  }

  if (env.VEHICLE_REGISTRY_PROVIDER === 'aggregator') {
    if (!env.VEHICLE_REGISTRY_BASE_URL) {
      problems.push('VEHICLE_REGISTRY_BASE_URL is required when using the aggregator provider.');
    }
    if (!env.VEHICLE_REGISTRY_API_KEY) {
      problems.push('VEHICLE_REGISTRY_API_KEY is required when using the aggregator provider.');
    }
  }

  if (env.OBJECT_STORAGE_DRIVER === 'filesystem') {
    problems.push(
      'OBJECT_STORAGE_DRIVER=filesystem is not durable; use s3 in production.',
    );
  }
  if (env.OBJECT_STORAGE_DRIVER === 's3' && !env.OBJECT_STORAGE_BUCKET) {
    problems.push('OBJECT_STORAGE_BUCKET is required for the s3 driver.');
  }

  if (env.QUEUE_DRIVER === 'inline') {
    problems.push('QUEUE_DRIVER=inline is for tests only; use bullmq in production.');
  }

  return problems;
}

/** Parses and validates `process.env`, then shapes it into `AppConfig`. */
export function loadConfiguration(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration. The API will not start.\n${details}\n\n` +
        'See .env.example for the full list of supported variables.',
    );
  }

  const env = parsed.data;

  const problems = productionSafetyChecks(env);
  if (problems.length > 0) {
    throw new Error(
      'Refusing to start: the configuration is not safe for production.\n' +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }

  // Validated separately because the message is more useful than a zod issue.
  let encryptionKey: Buffer;
  try {
    encryptionKey = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  } catch {
    throw new Error('ENCRYPTION_KEY must be valid base64.');
  }
  if (encryptionKey.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${encryptionKey.length}). ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    version: env.APP_VERSION,
    corsOrigins: env.CORS_ORIGINS,

    log: {
      level: env.LOG_LEVEL,
      pretty: env.LOG_PRETTY,
      requestSampleRate: env.LOG_REQUEST_SAMPLE_RATE,
    },

    database: {
      url: env.DATABASE_URL,
      poolSize: env.DATABASE_POOL_SIZE,
      statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    },

    redis: { url: env.REDIS_URL, keyPrefix: env.REDIS_KEY_PREFIX },

    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
      maxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
      passwordMinLength: env.AUTH_PASSWORD_MIN_LENGTH,
      scrypt: {
        logN: env.AUTH_SCRYPT_LOG_N,
        r: env.AUTH_SCRYPT_R,
        p: env.AUTH_SCRYPT_P,
      },
    },

    encryptionKey: env.ENCRYPTION_KEY,

    rateLimit: {
      windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      loginMax: env.RATE_LIMIT_LOGIN_MAX,
      anprMax: env.RATE_LIMIT_ANPR_MAX,
    },

    jobs: {
      queueDriver: env.QUEUE_DRIVER,
      workersEnabled: env.WORKERS_ENABLED,
      chargeAccrualCron: env.JOB_CHARGE_ACCRUAL_CRON,
      outboxRelayIntervalMs: env.JOB_OUTBOX_RELAY_INTERVAL_MS,
      notificationRetryIntervalMs: env.JOB_NOTIFICATION_RETRY_INTERVAL_MS,
      registryRetryIntervalMs: env.JOB_REGISTRY_RETRY_INTERVAL_MS,
    },

    storage: {
      driver: env.OBJECT_STORAGE_DRIVER,
      bucket: env.OBJECT_STORAGE_BUCKET,
      region: env.OBJECT_STORAGE_REGION,
      endpoint: env.OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      accessKey: env.OBJECT_STORAGE_ACCESS_KEY,
      secretKey: env.OBJECT_STORAGE_SECRET_KEY,
      localPath: env.OBJECT_STORAGE_LOCAL_PATH,
      urlTtlSeconds: env.OBJECT_STORAGE_URL_TTL_SECONDS,
      uploadMaxBytes: env.UPLOAD_MAX_BYTES,
      allowedMimeTypes:
        env.UPLOAD_ALLOWED_MIME.length > 0
          ? env.UPLOAD_ALLOWED_MIME
          : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    },

    anpr: {
      provider: env.ANPR_PROVIDER,
      confidenceThreshold: env.ANPR_CONFIDENCE_THRESHOLD,
      dedupeWindowSeconds: env.ANPR_DEDUPE_WINDOW_SECONDS,
      maxClockSkewSeconds: env.ANPR_MAX_CLOCK_SKEW_SECONDS,
      requireSignature: env.ANPR_REQUIRE_SIGNATURE,
      mockIntervalSeconds: env.ANPR_MOCK_INTERVAL_SECONDS,
    },

    registry: {
      provider: env.VEHICLE_REGISTRY_PROVIDER,
      baseUrl: env.VEHICLE_REGISTRY_BASE_URL,
      apiKey: env.VEHICLE_REGISTRY_API_KEY,
      timeoutMs: env.VEHICLE_REGISTRY_TIMEOUT_MS,
      maxAttempts: env.VEHICLE_REGISTRY_MAX_ATTEMPTS,
      breakerThreshold: env.VEHICLE_REGISTRY_BREAKER_THRESHOLD,
      breakerCooldownSeconds: env.VEHICLE_REGISTRY_BREAKER_COOLDOWN_SECONDS,
      rateLimitPerMinute: env.VEHICLE_REGISTRY_RATE_LIMIT_PER_MINUTE,
      cacheTtlHours: env.VEHICLE_REGISTRY_CACHE_TTL_HOURS,
    },

    payment: {
      provider: env.PAYMENT_PROVIDER,
      webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
      keyId: env.PAYMENT_PROVIDER_KEY_ID,
      keySecret: env.PAYMENT_PROVIDER_KEY_SECRET,
      callbackBaseUrl: env.PAYMENT_CALLBACK_BASE_URL,
    },

    notification: {
      enabled: env.NOTIFICATIONS_ENABLED,
      smsProvider: env.SMS_PROVIDER,
      emailProvider: env.EMAIL_PROVIDER,
      whatsappProvider: env.WHATSAPP_PROVIDER,
      fromEmail: env.NOTIFICATION_FROM_EMAIL,
      fromName: env.NOTIFICATION_FROM_NAME,
      smsSenderId: env.NOTIFICATION_SMS_SENDER_ID,
      smsApiKey: env.SMS_PROVIDER_API_KEY,
      emailApiKey: env.EMAIL_PROVIDER_API_KEY,
      whatsappApiKey: env.WHATSAPP_PROVIDER_API_KEY,
      whatsappPhoneId: env.WHATSAPP_BUSINESS_PHONE_ID,
    },

    seed: {
      adminEmail: env.SEED_ADMIN_EMAIL,
      adminPassword: env.SEED_ADMIN_PASSWORD,
      defaultPassword: env.SEED_DEFAULT_PASSWORD,
      vehicleCount: env.SEED_VEHICLE_COUNT,
    },
  };
}

/** Injection token for the typed configuration object. */
export const APP_CONFIG = 'APP_CONFIG';
