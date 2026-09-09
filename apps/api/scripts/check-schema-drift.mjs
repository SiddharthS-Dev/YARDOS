#!/usr/bin/env node
/**
 * Fails if `schema.prisma` has been edited without a matching migration.
 *
 * The obvious check - `prisma migrate diff --exit-code` - does not work on this
 * schema, and it is worth writing down why so nobody "fixes" it back.
 *
 * The integrity-guards migration adds objects Prisma's datamodel cannot
 * express: trigram (GIN) indexes, CHECK constraints, partial unique indexes and
 * immutability triggers. `migrate diff` compares the live database against the
 * datamodel, sees those objects as extra, and emits DROP statements for the
 * ones it understands. The diff is therefore permanently non-empty, so
 * `--exit-code` fails on every run and gates nothing - a check that is always
 * red is a check nobody reads.
 *
 * So: take the same diff as SQL, discard the statements that are explained by
 * an index the migrations deliberately create with `USING gin` or `USING gist`,
 * and fail on anything left. A forgotten migration shows up as a CREATE TABLE
 * or ALTER TABLE and is caught; a hand-written trigram index is not mistaken
 * for drift.
 *
 * Replayability - that the migration history applies cleanly to an empty
 * database - is proven separately, by `prisma migrate deploy` running against a
 * fresh database in CI before this script does.
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: a repository path containing a space comes
// back percent-encoded from pathname and every fs call then misses.
const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(API_ROOT, 'prisma', 'migrations');

/** Index names the migrations create with an access method Prisma cannot model. */
function unmodellableIndexes() {
  const names = new Set();

  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    let sql;
    try {
      sql = readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }

    // CREATE INDEX "name" ON "table" USING gin (...)
    //
    // [^;]* rather than [\s\S]*: a lazy any-character gap will happily run past
    // the end of a plain CREATE INDEX and pair its name with the USING GIN of
    // the NEXT statement, which silently drops one index from the allow-list.
    // A statement cannot contain a semicolon, so this cannot cross one.
    const pattern = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+"?([\w-]+)"?\s+ON[^;]*?USING\s+(gin|gist)/gi;
    for (const match of sql.matchAll(pattern)) names.add(match[1]);
  }

  return names;
}

function diffScript() {
  // Every argument is a static literal, so this command string carries no
  // untrusted input. execSync rather than execFileSync because npx is a .cmd
  // shim on Windows, which needs a shell - and passing an args array with
  // shell:true is deprecated (DEP0190) precisely because it does not escape.
  return execSync(
    'npx prisma migrate diff' +
      ' --from-schema-datasource prisma/schema.prisma' +
      ' --to-schema-datamodel prisma/schema.prisma' +
      ' --script',
    { encoding: 'utf8', cwd: API_ROOT },
  );
}

const allowed = unmodellableIndexes();
const script = diffScript();

const unexplained = script
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
  .filter((line) => {
    const dropped = /^DROP INDEX\s+"?([\w-]+)"?\s*;?$/i.exec(line);
    return !(dropped && allowed.has(dropped[1]));
  });

if (unexplained.length > 0) {
  console.error('::error::schema.prisma has drifted from the migration history.');
  console.error('');
  console.error('The database built from the migrations differs from the datamodel by:');
  console.error('');
  for (const line of unexplained) console.error(`    ${line}`);
  console.error('');
  console.error('If you edited schema.prisma, create a migration:  npm run db:migrate');
  console.error('If you added a hand-written index Prisma cannot model, this script');
  console.error('recognises GIN and GiST indexes automatically - check the CREATE INDEX.');
  process.exit(1);
}

console.log(
  `No schema drift. ${allowed.size} hand-written index(es) Prisma cannot model were ` +
    'recognised and ignored:',
);
for (const name of [...allowed].sort()) console.log(`  - ${name}`);
