// Database-backed suites talk to real PostgreSQL and boot the Nest container,
// which is far slower than Jest's 5s default.
jest.setTimeout(120_000);
