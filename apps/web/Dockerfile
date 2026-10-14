# syntax=docker/dockerfile:1.7
# GovServe web: the Vite build served by unprivileged nginx, which also proxies /api to the API.
ARG NODE_IMAGE=node:22.20.0-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29.1-alpine@sha256:27985295bdb22a1ef8f712863210bd5877c0f3006494a593e86b3fe0fa55467e

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@12.11.2 && pnpm --version
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile
RUN pnpm --filter @govserve/shared build && pnpm --filter web build \
 && find apps/web/dist -name '*.map' -delete

FROM ${NGINX_IMAGE} AS runtime
# Alpine security fixes released after the pinned base digest (CI scans the result).
USER root
RUN apk upgrade --no-cache
ARG RELEASE=dev
LABEL org.opencontainers.image.title="govserve-web" org.opencontainers.image.revision="${RELEASE}"
COPY infra/nginx/default.conf.template infra/nginx/security-headers.inc.template /etc/nginx/templates/
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Filled in at start (nginx envsubst templates): API upstream and the object store's public origin.
ENV API_UPSTREAM=api:3000 OBJECT_STORE_ORIGIN=""
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]
