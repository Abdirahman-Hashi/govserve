# syntax=docker/dockerfile:1.7
# GovServe API. Build from the repo root: docker build -f apps/api/Dockerfile .
# Targets: runtime (default, the API) and migrate (the one-off release job).
ARG NODE_IMAGE=node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true HUSKY=0
# Prisma's migration engine links OpenSSL; CA certificates for TLS to managed databases. The upgrade
# takes Debian security fixes released after the pinned base digest (CI scans the result).
RUN apt-get update && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.11.2 && pnpm --version
WORKDIR /repo

# Dependencies first, so a code change does not re-download them.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @govserve/shared build \
 && pnpm --filter api build \
 && pnpm --filter api deploy --prod --legacy /out \
 && rm -rf /out/src /out/test /out/scripts /out/prisma/migrations \
 # @prisma/client lists the Prisma CLI and TypeScript as peers, so pnpm installs them; the runtime
 # client (driver adapter, no engine binary) needs neither, nor the Studio tree they pull in.
 && cd /out/node_modules/.pnpm \
 && rm -rf prisma@* @prisma+studio-core@* @prisma+engines@* @prisma+engines-version@* @prisma+fetch-engine@* \
      @prisma+get-platform@* @prisma+dev@* @electric-sql+pglite@* effect@* typescript@* elkjs@* react@* react-dom@*

# The release job: migrations as the owner, the app role, reference data (scripts/migrate.sh).
FROM deps AS migrate
RUN pnpm --filter @govserve/shared build && pnpm --filter api exec prisma generate \
 && chown -R node:node /repo/apps/api \
 # migrate.sh calls the binaries directly; npm's bundled dependencies only add scanner findings.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
ENV NODE_ENV=production
CMD ["sh", "apps/api/scripts/migrate.sh"]

FROM ${NODE_IMAGE} AS runtime
# The API runs `node` only: npm and corepack are removed with their bundled dependencies.
RUN apt-get update && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
# Root-owned and read-only for the node user: the process cannot rewrite its own code.
COPY --from=build /out ./
ARG RELEASE=dev
ENV NODE_ENV=production APP_VERSION=${RELEASE} API_PORT=3000
LABEL org.opencontainers.image.source="https://github.com/govserve/govserve" \
      org.opencontainers.image.title="govserve-api" \
      org.opencontainers.image.revision="${RELEASE}"
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
