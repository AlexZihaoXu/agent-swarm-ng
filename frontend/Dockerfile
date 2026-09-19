FROM node:22-bookworm-slim AS base
COPY --from=oven/bun:1.3.6 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY frontend frontend
WORKDIR /app/frontend

FROM base AS development
EXPOSE 5173
CMD ["bun", "run", "dev"]

FROM base AS build
RUN bun run build

FROM caddy:2-alpine AS production
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
EXPOSE 80 443
