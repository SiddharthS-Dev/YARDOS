/**
 * Three test projects with deliberately different scopes:
 *
 *   unit        - pure domain logic (charge engine, state machines, rate
 *                 resolution, billing rules). No database, no Nest container,
 *                 runs in milliseconds.
 *   integration - real PostgreSQL, real Prisma, real repositories. Verifies
 *                 constraints, triggers and transaction behaviour.
 *   e2e         - the whole Nest application over HTTP with supertest, walking
 *                 the business workflows end to end.
 *
 * Integration and e2e need the docker stack up (`npm run stack:up`) and the
 * migrations applied; `test/setup/global-setup.ts` verifies that and fails with
 * an actionable message rather than a connection stack trace.
 */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^@/(.*)\.js$': '<rootDir>/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  clearMocks: true,
};

const databaseBacked = {
  ...base,
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/long-timeout.ts'],
  maxWorkers: 1,
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      ...databaseBacked,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
    },
    {
      ...databaseBacked,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.spec.ts'],
    },
  ],
  // Coverage is collected over the code the UNIT suite is responsible for:
  // pure, deterministic logic that needs no database. That is a deliberate
  // scope, not a convenience.
  //
  // The service and controller layers are absent because unit tests are the
  // wrong instrument for them - they are gated instead by the integration and
  // e2e projects, which exercise the real guards, transactions, constraints
  // and triggers. Measuring them here produced a global figure that fell every
  // time a well-tested service was added, and a number that punishes good work
  // is a number people learn to ignore.
  collectCoverageFrom: [
    'src/modules/billing/domain/**/*.ts',
    'src/modules/shared/state-machine.ts',
    'src/modules/financier/financier-matcher.service.ts',
    'src/common/money/**/*.ts',
    'src/config/configuration.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.types.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { statements: 85, branches: 75, functions: 85, lines: 85 },
    // The money paths carry the business risk, so they are held higher still.
    './src/modules/billing/domain/': {
      statements: 90, branches: 80, functions: 90, lines: 90,
    },
    './src/common/money/': {
      statements: 90, branches: 80, functions: 90, lines: 90,
    },
  },
};
