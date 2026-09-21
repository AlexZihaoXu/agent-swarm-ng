FROM oven/bun:1.3.6 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json

FROM base AS development
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY backend backend
WORKDIR /app/backend
ENV HOST=0.0.0.0
RUN mkdir -p /app/.local && chown bun:bun /app/.local
USER bun
EXPOSE 3000
CMD ["bun", "run", "dev"]

FROM base AS production
RUN bun install --frozen-lockfile --production
COPY backend/src backend/src
WORKDIR /app/backend
ENV NODE_ENV=production HOST=0.0.0.0
RUN mkdir -p /app/.local && chown bun:bun /app/.local
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
