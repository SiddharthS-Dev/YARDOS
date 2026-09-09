# syntax=docker/dockerfile:1.7
#
# SmartPark Enterprise operations console.
#
# Build from the REPOSITORY ROOT:
#   docker build -f docker/web.Dockerfile -t smartpark-web:local .
#
# Uses Next.js standalone output, which traces only the files actually needed
# at runtime - the resulting image is a fraction of a full node_modules copy.
#
# NOTE ON BUILD-TIME CONFIGURATION: NEXT_PUBLIC_* values are inlined into the
# client bundle at build time and are therefore visible to anyone who loads the
# page. Only the API base URL is passed this way, and it is not a secret. No
# credential may ever be a NEXT_PUBLIC_ variable.

# ---------------------------------------------------------------------------
# Stage 1 — dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspaces --include-workspace-root --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
ARG NEXT_PUBLIC_APP_NAME="SmartPark Enterprise"
ARG NEXT_PUBLIC_ORG_NAME="Sri JP Smartpark India Pvt Ltd"
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_ORG_NAME=$NEXT_PUBLIC_ORG_NAME \
    NEXT_TELEMETRY_DISABLED=1

# npm workspaces hoist dependencies to the ROOT node_modules.
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

# The console imports the compiled contracts package, so it must exist first.
RUN npm run build --workspace=@smartpark/contracts
RUN npm run build --workspace=@smartpark/web

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini wget

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# The standalone bundle, plus the static assets and public files it references.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3001/login || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
