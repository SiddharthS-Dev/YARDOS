# syntax=docker/dockerfile:1.7
#
# SmartPark Enterprise API.
#
# Build from the REPOSITORY ROOT so the workspace and lockfile are in context:
#   docker build -f docker/api.Dockerfile -t smartpark-api:local .
#
# Properties this image deliberately has:
#   - deterministic: `npm ci` against the committed lockfile, never `npm install`
#   - scoped: only the API and contracts workspaces are installed. Installing
#     every workspace would drag the console's Next.js and image toolchain into
#     the API image and roughly triple its size.
#   - non-root: runs as an unprivileged user
#   - secret-free: every credential is injected at runtime, never baked in
#   - signal-correct: PID 1 is an init that reaps children and forwards SIGTERM,
#     so Nest's shutdown hooks run and in-flight transactions are not severed

# ---------------------------------------------------------------------------
# Stage 1 — build dependencies (includes the dev toolchain)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo

# Every workspace manifest is copied because `npm ci` validates them against
# the lockfile, but only two workspaces are actually installed.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund \
      --include-workspace-root \
      --workspace=@smartpark/contracts \
      --workspace=@smartpark/api

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

# npm workspaces hoist dependencies to the ROOT node_modules.
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# The shared contracts package must be built first: the API imports its
# compiled output, not its source.
RUN npm run build --workspace=@smartpark/contracts

# Prisma Client is generated code and must exist before the API compiles.
RUN cd apps/api && npx prisma generate

RUN npm run build --workspace=@smartpark/api

# ---------------------------------------------------------------------------
# Stage 3 — production dependencies only
# ---------------------------------------------------------------------------
# A clean install rather than `npm prune`, because prune across workspaces
# leaves hoisted dev packages behind. This stage is what keeps the runtime
# image honest: if it is not a production dependency, it is not here.
FROM node:22-alpine AS prod-deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
      --include-workspace-root \
      --workspace=@smartpark/contracts \
      --workspace=@smartpark/api

# ---------------------------------------------------------------------------
# Stage 4 — runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# tini: correct PID 1 behaviour. Without it Node receives SIGTERM as PID 1 and
# Nest's onModuleDestroy hooks may not run, so the database pool is not drained.
# wget: used by the container healthcheck below.
RUN apk add --no-cache tini wget

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS=--enable-source-maps

# Ownership is set on each COPY rather than with a later `RUN chown -R`.
# A recursive chown rewrites every file, which creates a second full copy of
# the tree as a new layer - on a 400 MB node_modules that alone doubled the
# image. node:alpine already provides an unprivileged `node` user (uid 1000).
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules

# The generated Prisma Client. It comes from the BUILD stage because the Prisma
# CLI that generates it is a dev dependency and is absent from prod-deps.
COPY --from=build --chown=node:node /repo/node_modules/.prisma ./node_modules/.prisma

COPY --from=build --chown=node:node /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/package.json

# Migrations and the schema ship with the image so `prisma migrate deploy` can
# be run as a release step against this exact build. The Prisma CLI itself is
# NOT installed here; run migrations with `npx prisma@<version> migrate deploy`
# from a job, or use the build stage as a migration image.
COPY --from=build --chown=node:node /repo/apps/api/prisma ./apps/api/prisma

USER node

EXPOSE 3000

# Hits the liveness probe, which deliberately touches no dependency - a
# database blip must not make the orchestrator kill every replica at once.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/health/live || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
