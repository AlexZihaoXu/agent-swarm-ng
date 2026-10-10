FROM oven/bun:1.3.14 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
# Bound parallel downloads for reliable Docker Desktop installs.
RUN bun install --frozen-lockfile --production --network-concurrency=8

# Cache client generation separately from application source changes.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/prisma.config.ts
COPY backend/src/database-location.ts backend/src/database-location.ts
WORKDIR /app/backend
RUN bun run db:generate
RUN mkdir -p /app/.local && chmod 700 /app/.local && chown bun:bun /app/.local
ENV HOST=0.0.0.0 CHECKPOINT_DISABLE=1

FROM base AS development
WORKDIR /app
RUN bun install --frozen-lockfile --network-concurrency=8
COPY tsconfig.base.json ./
COPY backend backend
RUN chown -R bun:bun /app/backend/src/generated
WORKDIR /app/backend
USER bun
EXPOSE 3000
CMD ["bun", "run", "dev"]

FROM base AS production
# The commit this image was built from (scripts/compose.sh): a change tells people the Swarm was updated.
ARG APP_VERSION=dev
ARG APP_SUMMARY=
ENV APP_VERSION=$APP_VERSION APP_SUMMARY=$APP_SUMMARY
COPY backend/assets assets
COPY backend/src src
COPY backend/scripts/migrate.ts backend/scripts/reset-password.ts backend/scripts/unlock.ts scripts/
ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
