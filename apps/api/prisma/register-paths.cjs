/**
 * Runtime resolution for the `@/*` path alias.
 *
 * Used by the handful of scripts that execute TypeScript directly through
 * ts-node rather than running the compiled output: the seed and the OpenAPI
 * export. Everything else resolves `@/*` at build time (tsc + tsc-alias) or
 * through Jest's own moduleNameMapper, neither of which needs this.
 *
 * Why this file exists at all, rather than `-r tsconfig-paths/register`:
 *
 * `tsconfig-paths/register` reads `baseUrl` and `paths` out of tsconfig.json.
 * `baseUrl` is deprecated in TypeScript 6 and is removed in 7, so it cannot
 * stay in the config - but the runtime resolver still needs to know where the
 * alias points. Declaring that here keeps the mapping explicit and keeps every
 * tsconfig free of a compiler option that is on its way out.
 *
 * The mapping must mirror `paths` in apps/api/tsconfig.json. There is only one
 * entry, and the seed fails loudly at startup if it is wrong, so the
 * duplication is cheap and self-policing.
 */

const path = require('node:path');
const { register } = require('tsconfig-paths');

// __dirname is apps/api/prisma, so the API root is one level up. Derived
// rather than hard-coded so this keeps working whatever the current working
// directory happens to be when npm invokes the script.
const apiRoot = path.resolve(__dirname, '..');

register({
  baseUrl: apiRoot,
  paths: {
    '@/*': ['src/*'],
  },
});
