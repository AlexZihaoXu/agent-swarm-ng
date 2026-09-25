FROM node:22-bookworm-slim AS base
COPY --from=oven/bun:1.3.6 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN bun install --frozen-lockfile --network-concurrency=8
COPY tsconfig.base.json ./
COPY frontend frontend
WORKDIR /app/frontend

FROM base AS development
EXPOSE 5173
CMD ["bun", "run", "dev"]

FROM base AS build
RUN bun run build

# Keep the pinned browser-client adaptation independent of app source changes
# so both package extraction and the audited HTTP/JPEG patch cache separately.
FROM node:22-bookworm-slim AS trusted-selkies-client
COPY --from=agent-swarm-default:stage2 /opt/selkies/lib/python3.12/site-packages/selkies/selkies_web /srv/selkies
COPY scripts/patch-selkies-http-client.mjs /tmp/patch-selkies-http-client.mjs
RUN node /tmp/patch-selkies-http-client.mjs /srv/selkies

FROM caddy:2-alpine AS production
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY frontend/Caddyfile.computers /etc/caddy/ComputerRoutes
COPY --from=build /app/frontend/dist /srv
# Runtime guest sudo cannot edit this immutable client copy. Update the pinned
# Selkies version, hashes, and trusted wrapper together on upstream upgrades.
COPY --from=trusted-selkies-client /srv/selkies /srv/selkies
EXPOSE 80 443
