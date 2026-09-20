# syntax=docker/dockerfile:1

# Pinned Node 20 bookworm slim for reproducible non-production builds.
FROM node:20.20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20.20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20.20-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="vendure-ai-pipeline"
LABEL org.opencontainers.image.description="Isolated non-production pipeline runner"
LABEL org.opencontainers.image.source="https://github.com/rootevil/vendure-ai-pipeline"

ENV NODE_ENV=development \
    PIPELINE_ENV=nonprod \
    PIPELINE_MODE=acceptance \
    PIPELINE_ARTIFACTS_DIR=/pipeline/artifacts \
    PIPELINE_WORKSPACE_DIR=/pipeline/workspace \
    PIPELINE_ALLOW_NETWORK=false \
    PIPELINE_LOG_LEVEL=info \
    PIPELINE_HEALTH_REQUIRE_DEPS=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    postgresql-client \
    redis-tools \
    tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 pipeline \
  && useradd --system --uid 10001 --gid pipeline --create-home --home-dir /home/pipeline pipeline \
  && mkdir -p /pipeline/artifacts /pipeline/workspace /pipeline/fixtures \
  && chown -R pipeline:pipeline /pipeline

WORKDIR /app
COPY --from=build --chown=pipeline:pipeline /app/package.json /app/package-lock.json ./
COPY --from=build --chown=pipeline:pipeline /app/node_modules ./node_modules
COPY --from=build --chown=pipeline:pipeline /app/dist ./dist
COPY --chown=pipeline:pipeline fixtures ./fixtures
COPY --chown=pipeline:pipeline scripts/docker ./scripts/docker

USER pipeline

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/scripts/docker/keep-alive.mjs"]
