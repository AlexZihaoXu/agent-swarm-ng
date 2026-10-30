# COMPUTER_VIEWER=off builds a chat-only dashboard without the desktop image (the desktop viewer shows "unavailable").
# With the default (on), the pinned Selkies browser client is copied from the approved desktop image.
ARG COMPUTER_VIEWER=on
ARG SELKIES_SOURCE_IMAGE=agent-swarm-default:stage2
FROM node:22-bookworm-slim AS base
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
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
# Inside the dev container only (reached through caddy-dev on loopback); on a host, dev listens on 127.0.0.1.
CMD ["bun", "run", "dev:container"]

FROM base AS build
ARG VITE_COMPUTER_PORTAL_FREE=false
ENV VITE_COMPUTER_PORTAL_FREE=$VITE_COMPUTER_PORTAL_FREE
RUN bun run build

# Keep the pinned browser-client adaptation independent of app source changes
# so both package extraction and the audited HTTP/JPEG patch cache separately.
FROM ${SELKIES_SOURCE_IMAGE} AS selkies-source
FROM node:22-bookworm-slim AS trusted-selkies-client-on
COPY --from=selkies-source /opt/selkies/lib/python3.12/site-packages/selkies/selkies_web /srv/selkies
COPY scripts/patch-selkies-http-client.mjs /tmp/patch-selkies-http-client.mjs
RUN node /tmp/patch-selkies-http-client.mjs /srv/selkies

FROM node:22-bookworm-slim AS trusted-selkies-client-off
RUN mkdir -p /srv/selkies

FROM trusted-selkies-client-${COMPUTER_VIEWER} AS trusted-selkies-client

# Caddy is rebuilt from source: the official release binary of v2.11.7 was compiled with Go 1.26.8 and x/net v0.59.0,
# which predate the October 2026 Go security fixes (Go 1.26.9/1.27.2: HTTP/2 and HTTP/1 server DoS and smuggling;
# Go 1.26.10/1.27.3: crypto/x509 distrust of compromised intermediates, GO-2026-6809; x/net v0.60.0/v0.62.0). The
# builder image's toolchain is at least Go 1.27.3. Bump the pins together and re-run `govulncheck -mode=binary`.
FROM caddy:2.11.7-builder-alpine@sha256:95a5e7e2692b5eb9545aadc5b90a39f6f509bee59c9508a493f83ee902eaef63 AS caddy-build
RUN xcaddy build v2.11.7 --replace golang.org/x/net=golang.org/x/net@v0.62.0 --output /usr/bin/caddy

FROM caddy:2.11.7-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5 AS production
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY frontend/Caddyfile.computers /etc/caddy/ComputerRoutes
COPY --from=build /app/frontend/dist /srv
# Runtime guest sudo cannot edit this immutable client copy. Update the pinned
# Selkies version, hashes, and trusted wrapper together on upstream upgrades.
COPY --from=trusted-selkies-client /srv/selkies /srv/selkies
# The commit this image was built from (scripts/compose.sh). At start it is handed to the backend through the shared
# versions volume, so a frontend-only update is announced too (docs/notifications.md).
ARG APP_VERSION=dev
ARG APP_SUMMARY=
RUN printf '{"version":"%s","summary":"%s"}\n' "$APP_VERSION" "$(printf '%s' "$APP_SUMMARY" | sed 's/["\\]//g')" > /etc/caddy/version.json
CMD ["sh", "-c", "cp /etc/caddy/version.json /versions/frontend.json 2>/dev/null || true; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
EXPOSE 80 443
