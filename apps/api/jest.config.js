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
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/main.ts',
    '!src/worker.ts',
    '!src/tooling/**',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { statements: 20, branches: 15, functions: 20, lines: 20 },
    // The money paths carry the business risk, so they are held far higher.
    './src/modules/billing/domain/': {
      statements: 90, branches: 80, functions: 90, lines: 90,
    },
  },
};
