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

The backend has no Docker socket mount or container-management endpoints yet. `templates/default/` is a nonfunctional template definition plus a minimal image placeholder—not a desktop-ready environment. Compose does not build or start it.
