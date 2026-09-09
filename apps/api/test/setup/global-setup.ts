import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Prepares the database once, before any database-backed suite runs.
 *
 * Fails with an instruction rather than a connection stack trace: the most
 * common reason a new contributor's tests fail is that the docker stack is not
 * running, and that should be obvious from the first line of output.
 */
export default async function globalSetup(): Promise<void> {
  loadRootEnv();

  const databaseUrl = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env at the repository root.',
    );
  }
  process.env['DATABASE_URL'] = databaseUrl;
  process.env['NODE_ENV'] = 'test';
  // Tests must observe the full effect of an operation synchronously.
  process.env['QUEUE_DRIVER'] = 'inline';
  process.env['OBJECT_STORAGE_DRIVER'] ??= 'filesystem';
  process.env['OBJECT_STORAGE_LOCAL_PATH'] ??= './var/test-storage';
  process.env['LOG_LEVEL'] ??= 'error';
  process.env['LOG_PRETTY'] = 'false';

  // The gateway simulator, with a signing secret, so the signed-callback path
  // is genuinely exercised. The manual provider refuses every webhook, which
  // would let the signature suite pass without verifying anything.
  //
  // This secret is a test fixture. It authenticates nothing outside this run,
  // and `productionSafetyChecks` refuses PAYMENT_PROVIDER=mock in production.
  process.env['PAYMENT_PROVIDER'] = 'mock';
  process.env['PAYMENT_WEBHOOK_SECRET'] ||= 'test-fixture-webhook-secret-not-a-credential';

  const apiRoot = path.resolve(__dirname, '../..');

  try {
    execSync('npx prisma migrate deploy', {
      cwd: apiRoot,
      stdio: 'pipe',
      env: process.env,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Could not apply database migrations for the test run.\n\n' +
        'Is the local stack running?  npm run stack:up\n\n' +
        `Underlying error:\n${detail}`,
    );
  }
}

/** Loads the repository-root .env without adding a dotenv dependency here. */
function loadRootEnv(): void {
  const envPath = path.resolve(__dirname, '../../../../.env');
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
