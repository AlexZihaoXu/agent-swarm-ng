# Dashboard sign-in

The dashboard needs a signed-in person. There is one account, **Admin**, created by the migration without a password: the first visit shows **Set the Admin password**, and whoever completes it sets the password and is signed in. Set it right after deploying (until then anyone who can reach the dashboard could set it). Afterwards the dashboard shows **Sign in to Agent Swarm** (Kibo's Login Card, `card/standard/card-standard-2`, without its social sign-in and sign-up links).

## What is protected

- **Every backend request** (`backend/src/auth/routes.ts`, an `onRequest` hook registered before all routes): any path, WebSocket upgrades included, answers `401 {"message":"Sign in first."}` without a valid session. Public: `GET /api/health`, `GET /api/auth/session`, `POST /api/auth/login`, `POST /api/auth/setup`.
- **Computer desktops** reach their computers through Caddy, not the backend, so Caddy asks first: `forward_auth` on `/computers/*` calls `GET /api/auth/check` (204 signed in, 401 not), without the WebSocket upgrade headers (`frontend/Caddyfile.computers`, shared by production and the dev proxy).
- **The app shell** (HTML, scripts, styles) stays public: it holds no data and draws the sign-in card.
- **Other sites:** besides `SameSite=Strict` cookies, a request that changes something (any method but GET/HEAD/OPTIONS) or opens a WebSocket is refused (403) when its `Origin` is not this dashboard. The `Host` allowlist (`ALLOWED_HOSTS`, development.md) still applies before anything else.

Agents, the controller, Discord and computers never call the dashboard API, so nothing else needs a session.

## Passwords and sessions

- Passwords: 8–256 characters, stored as scrypt hashes (N=2^17, r=8, p=1, 16-byte salt; `scrypt$N$r$p$salt$key`). An unknown name takes as long as a wrong password, and both get the same answer.
- Sessions: a random 256-bit token in the `swarm_session` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` on the HTTPS origin); only its SHA-256 is stored (`UserSession`). A session lasts 30 days from its last use (renewed at most hourly). The HTTP (19090) and HTTPS (19091) origins sign in separately when the cookie is `Secure`.
- Wrong passwords: after 10 failures for an account, or 30 from one address, within 15 minutes, sign-in answers 429 with `Retry-After` until the oldest failure is 15 minutes old (also for the right password). Counts live in memory; a restart forgets them. The client address is the last `X-Forwarded-For` entry, which Caddy sets.
- **Settings → Account** shows who is signed in, changes the password (needs the current one; signs out every other browser) and signs out.
- Any API answer of 401 (session ended elsewhere, password changed, host reset) brings back the sign-in card; signing in again starts the app afresh with an empty cache.

## Forgotten password

On the host, in the project folder:

```sh
docker compose exec backend bun scripts/reset-password.ts   # [name], default Admin
```

It clears the password and signs out every browser; the next visit sets a new one, as on the first day.

## Tests

Backend route tests of other features build the app with `requireLogin: false`; `backend/src/auth/auth.test.ts` covers sign-in. The Playwright suite's global setup (`frontend/tests/sign-in.setup.ts`) sets the throwaway backend's password and every test starts signed in; `tests/sign-in.spec.ts` covers the screens. The opt-in live configs sign in with `E2E_ADMIN_PASSWORD` when the password is already set.
