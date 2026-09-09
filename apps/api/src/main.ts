import 'reflect-metadata';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/configuration';
import { AppLogger } from './common/logging/logger.service';

/**
 * API entry point.
 *
 * Everything configured here is a production concern: security headers, strict
 * input validation, API versioning, CORS, request size limits and graceful
 * shutdown. None of it is optional, so none of it is behind a flag.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Nest's own bootstrap logs are buffered until our structured logger is
    // available, so startup output is JSON like everything else.
    bufferLogs: true,
    // The global filter owns every error response.
    abortOnError: false,
    // Keeps the undecoded request bytes on `req.rawBody`. Signed callbacks
    // (ANPR, payment gateway) MUST verify their HMAC against these bytes:
    // re-serialising the parsed body with JSON.stringify produces a different
    // byte sequence whenever the sender's key order, spacing or unicode
    // escaping differs from Node's, so the signature would be checked against
    // something the sender never signed.
    rawBody: true,
  });

  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get(AppLogger);
  app.useLogger(logger);
  const log = logger.forContext('Bootstrap');

  /* --- Security headers ------------------------------------------- */
  app.use(
    helmet({
      // The API serves JSON and PDFs, never HTML, so the strictest CSP applies.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );
  // Do not advertise the framework.
  app.disable('x-powered-by');

  /* --- Proxy awareness -------------------------------------------- */
  // Required for correct client IPs (audit trail, rate limiting) behind the
  // reverse proxy described in docs/deployment.md. Trusting only the first hop
  // stops a client spoofing its own X-Forwarded-For.
  app.set('trust proxy', 1);

  /* --- Body limits ------------------------------------------------- */
  // ANPR payloads embed a base64 plate crop; 2 MB is generous for that and far
  // below anything that could be used to exhaust memory.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: true });

  /* --- CORS -------------------------------------------------------- */
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Correlation-Id',
      'X-Anpr-Signature',
      'X-Anpr-Timestamp',
    ],
    exposedHeaders: ['X-Correlation-Id'],
    maxAge: 600,
  });

  /* --- Routing ----------------------------------------------------- */
  app.setGlobalPrefix(config.apiPrefix, {
    // Probes must be reachable without the version segment so an orchestrator
    // never has to be reconfigured when the API version changes.
    exclude: ['health', 'health/live', 'health/ready'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  /* --- Validation --------------------------------------------------- */
  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties rather than trusting them...
      whitelist: true,
      // ...and reject the request outright if any were sent, so a client
      // silently posting the wrong shape finds out immediately.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // Detailed messages are safe: they describe the caller's own payload.
      disableErrorMessages: false,
      validationError: { target: false, value: false },
    }),
  );

  /* --- OpenAPI ------------------------------------------------------ */
  // Served outside production: the schema is a precise map of the attack
  // surface, and there is no reason to publish it from the live system.
  if (!config.isProduction) {
    const documentConfig = new DocumentBuilder()
      .setTitle('SmartPark Enterprise API')
      .setDescription(
        'Vehicle yard, parking, billing, auction and financier intelligence platform ' +
          'for Sri JP Smartpark India Pvt Ltd.\n\n' +
          '**Money** crosses the wire as decimal strings, never JSON numbers.\n\n' +
          '**Errors** always use the shape documented on `ApiErrorDto`: a stable `code`, a ' +
          'human `message`, and a `correlationId` to quote when reporting a problem.\n\n' +
          '**Idempotency**: unsafe operations that create money or move a vehicle accept an ' +
          '`Idempotency-Key` header; retrying with the same key replays the original result.',
      )
      .setVersion(config.version)
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .addTag('Authentication', 'Sign-in, token rotation and password management')
      .addTag('Users & roles', 'Identity administration and RBAC')
      .addTag('Health', 'Liveness, readiness and component health')
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
      customSiteTitle: 'SmartPark Enterprise API',
    });
    log.info('OpenAPI documentation mounted', { path: `/${config.apiPrefix}/docs` });
  }

  /* --- Lifecycle ----------------------------------------------------- */
  // Lets Nest run onModuleDestroy hooks (close the database pool, drain the
  // queue workers) instead of dying mid-transaction on SIGTERM.
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');

  log.info('SmartPark Enterprise API started', {
    port: config.port,
    env: config.env,
    version: config.version,
    apiPrefix: config.apiPrefix,
    queueDriver: config.jobs.queueDriver,
    workersEnabled: config.jobs.workersEnabled,
    storageDriver: config.storage.driver,
    anprProvider: config.anpr.provider,
    registryProvider: config.registry.provider,
    paymentProvider: config.payment.provider,
  });

  // Mock adapters are legitimate in development and forbidden in production by
  // the config guard, but they should never be a silent surprise.
  const mocks = [
    config.anpr.provider === 'mock' ? 'ANPR' : null,
    config.registry.provider === 'mock' ? 'vehicle registry (VAHAN)' : null,
    config.payment.provider === 'mock' ? 'payment' : null,
  ].filter(Boolean);
  if (mocks.length > 0) {
    log.warn(
      `Running with MOCK adapters for: ${mocks.join(', ')}. ` +
        'These fabricate data and must never be used against real operations.',
    );
  }
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet if configuration itself failed, so this one
  // place writes to stderr directly.
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      service: 'smartpark-api',
      time: new Date().toISOString(),
      msg: 'API failed to start',
      error: message,
      stack,
    })}\n`,
  );
  process.exit(1);
});
