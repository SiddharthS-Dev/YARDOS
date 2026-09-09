/**
 * Console tests.
 *
 * Deliberately scoped to the pure logic in `lib/` - the status vocabulary, the
 * formatters - rather than to rendered components.
 *
 * That is not laziness about coverage. Those modules are where a console defect
 * is genuinely dangerous: a status that maps to the wrong meaning shows an
 * operator green where the system said blocked, and a money formatter that
 * mis-groups digits turns Rs 1,23,456 into Rs 12,345.6 on an invoice. Both are
 * silent, both are wrong everywhere at once, and neither needs a DOM to test.
 *
 * Rendering tests would need jsdom and a testing library, which are new
 * dependencies; the brief asks not to introduce a framework unnecessarily. The
 * screens are instead covered by the 45 end-to-end tests that drive the real
 * API those screens consume. See docs/CONSOLE-TEST-PLAN.md for what that leaves
 * uncovered and how it would be closed.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  displayName: 'console',
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['<rootDir>/lib/**/*.spec.ts'],
  // The standalone build contains a second copy of package.json, which Jest's
  // module map reports as a naming collision.
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          module: 'CommonJS',
          moduleResolution: 'node',
          target: 'ES2022',
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  clearMocks: true,
};
