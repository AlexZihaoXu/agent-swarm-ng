# Development

## Local setup

Requires Bun 1.3.6 and Node.js 22.12+ (Vite/test tooling).

```sh
bun install --frozen-lockfile
bun run dev:backend
# In another terminal:
bun run dev:frontend
```

Open http://localhost:5173. Vite proxies `/api` to the backend on localhost:3000.

## Checks

```sh
bun run api:generate
bun run api:check
bun run typecheck
bun run test
bun run build
```

API generation does not require a running server. Commit both `backend/openapi.json` and `frontend/src/api/schema.d.ts` when the contract changes. CI checks generated files for drift.

For browser tests (Git Bash/Linux):

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright"
(cd frontend && bun x playwright install chromium)
bun run test:e2e
```

Playwright starts its own backend and frontend; stop existing instances on ports 3000 and 5173 first. Browser tests cover the connected dashboard and backend failure state. PWA installation, offline caching, and updates still need production-browser validation.

## Docker Compose

Requires Docker with Compose 2.24.4+ (`!override` support).

```sh
# Development: http://localhost:5173
docker compose -f compose.yaml -f compose.dev.yaml up --build

# Production-style local build: https://localhost
docker compose up --build -d
```

Development bind-mounts source for hot reload. Rebuild after dependency changes. File watching through Docker Desktop bind mounts may need platform-specific tuning.

Caddy serves the built frontend and proxies `/api` in production. Local HTTPS uses Caddy’s local CA, which your browser will not trust automatically. Trust its certificate explicitly for local PWA testing, or use localhost development without HTTPS. Do not bypass certificate errors as a production setup.

Ports bind to loopback by default. `.env.example` documents the settings; authentication is not implemented, so **do not expose this scaffold publicly**. Public-domain HTTPS configuration and access control must be completed before external deployment.

The backend has no Docker socket mount or container-management endpoints yet. `templates/default/` contains a placeholder template definition and an Ubuntu GNOME package foundation—not a desktop-ready environment. Compose does not build or start it.

## Default environment image

The image uses Ubuntu 24.04 and explicitly installs the Ubuntu GNOME session, Ubuntu Dock, app indicators, Yaru themes, Ubuntu fonts, terminal, file manager, settings, and D-Bus support. `--no-install-recommends` avoids pulling in the full desktop application bundle. Required transitive dependencies still install; do not remove GNOME dependencies merely because their names resemble optional apps.

No office suite, games, email client, or media player is explicitly installed. The final package inventory needs inspection after building. Package references: [Ubuntu session](https://packages.ubuntu.com/noble/ubuntu-session) and [GNOME settings](https://packages.ubuntu.com/noble/gnome-control-center).

Once Docker is running:

```sh
docker build -t agent-swarm-default:dev templates/default
# Verify desktop essentials and absence of common bundled applications:
docker run --rm -i agent-swarm-default:dev sh < templates/default/test-packages.sh
# Test a non-root GNOME compositor at the fixed 1920x1080 resolution:
# MSYS_NO_PATHCONV prevents Git Bash from rewriting /run on Windows.
MSYS_NO_PATHCONV=1 docker run --rm --init --tmpfs /run --shm-size=256m -i agent-swarm-default:dev sh < templates/default/test-desktop.sh
# Inspect the full installed package inventory:
docker run --rm agent-swarm-default:dev dpkg-query -W
```

The image currently idles without starting GNOME. The compositor test uses a non-root user, software rendering, and D-Bus readiness checks. Mount a fresh `/run` tmpfs: package installation leaves systemd seat directories in the image, which otherwise cause GNOME to expect a running systemd-logind service.

Desktop resolution is fixed at 1920x1080, independent of browser viewport size. The test does not establish hardware encoding, 120 fps, streaming, or a complete desktop session. Optional-service warnings remain (including calendar, screencast, input-method, and authentication services). Production session startup and the desktop toggle are not implemented.
