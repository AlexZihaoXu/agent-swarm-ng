# Dashboard sign-in

The dashboard needs a signed-in person. There is one account, **Admin**, created by the migration without a password: the first visit shows **Set the Admin password**, and whoever completes it sets the password and is signed in. Set it right after deploying: until then anyone who can reach the dashboard could set it (the owner's choice, over a setup code). The same holds after `reset-password.ts`. Afterwards the dashboard shows **Sign in to Agent Swarm** (Kibo's Login Card, `card/standard/card-standard-2`, without its social sign-in and sign-up links).

## What is protected

- **Every backend request** (`backend/src/auth/routes.ts`, an `onRequest` hook registered before all routes): any path, WebSocket upgrades included, answers `401 {"message":"Sign in first."}` without a valid session. Public: `GET /api/health`, `GET /api/auth/session`, `POST /api/auth/login`, `POST /api/auth/setup`, `POST /api/auth/logout` (it only ends the sessions behind the cookies it is sent).
- **Computer desktops** reach their computers through Caddy, not the backend, so Caddy asks first: `forward_auth` on `/computers/<id>/desktop…` calls `GET /api/auth/check` (204 signed in, 401 not, 403 when the page's `Origin` is another site), without the WebSocket upgrade headers (`frontend/Caddyfile.computers`, shared by production and the dev proxy). The computer is untrusted: Caddy strips `Cookie`, `Authorization`, `X-Forwarded-For` and `X-Forwarded-Host` before anything reaches it, and drops `Set-Cookie`, `Clear-Site-Data`, `NEL`, `Report-To`, `Reporting-Endpoints`, `Strict-Transport-Security` and `Alt-Svc` from its answers. Other `/computers/…` paths are app pages and stay public like the app shell.
- **The app shell** (HTML, scripts, styles) stays public: it holds no data and draws the sign-in card.
- **Other sites:** besides `SameSite=Strict` cookies, a request that changes something (any method but GET/HEAD/OPTIONS) or opens a WebSocket is refused (403) when its `Origin` is not this dashboard. The `Host` allowlist (`ALLOWED_HOSTS`, [development](development.md#platform-storage)) still applies before anything else.

Agents, the controller, Discord and computers never call the dashboard API, so nothing else needs a session.

## Passwords and sessions

- Passwords: 8–256 characters, stored as scrypt hashes (N=2^17, r=8, p=1, 16-byte salt; `scrypt$N$r$p$salt$key`). An unknown name takes as long as a wrong password, and both get the same answer.
- Sessions: a random 256-bit token in an `HttpOnly`, `SameSite=Strict`, `Path=/` cookie: `swarm_session` on HTTP, `__Secure-swarm_session` (`Secure`) on HTTPS, so the two origins never overwrite each other; only its SHA-256 is stored (`UserSession`). A session lasts 30 days from its last use (renewed at most hourly) and at most 90 days from sign-in. Cookies are not port-scoped: other web services on the same host name receive them, so do not run untrusted services on the dashboard's host name.
- Open streams (agent run events, terminals) close when their session signs out or its password changes, and within a minute of a host reset. A desktop stream is checked only when it opens (Caddy to the computer, no backend in between): one already open keeps streaming and taking input until that viewer closes or reconnects, even after a sign-out elsewhere or a password change. Signing out in a browser closes its own viewers (the app unmounts); after a suspected leak, also restart the affected computers or the frontend container to cut open desktop streams.
- Wrong passwords: each attempt counts before the password is checked (a correct one is forgiven). After 10 for an account from one address, 30 from one address, or 100 for an account from everywhere within 15 minutes, sign-in answers 429 with `Retry-After` until the oldest is 15 minutes old (also for the right password); someone else's guesses therefore cannot lock the owner out from another address. At most 4 password checks run at once (scrypt is deliberately slow); more answer 429 busy. Counts live in memory (at most 10,000 keys); a restart forgets them. The client address is `X-Real-IP`, which Caddy sets to the visitor's address: behind a reverse proxy on a private or tailnet address (for example Nginx Proxy Manager behind Cloudflare), Caddy trusts its `CF-Connecting-IP` or `X-Forwarded-For` (`trusted_proxies` in the Caddyfiles). Add a public host name to `ALLOWED_HOSTS`, forward to the HTTPS port (so the cookie is `Secure`), and enable WebSockets with long read timeouts on the proxy.
- **Settings → Account** shows who is signed in, changes the password (needs the current one; signs out every other browser) and signs out (on HTTPS, also the plain HTTP session of the same host).
- Any API answer of 401 (session ended elsewhere, password changed, host reset) brings back the sign-in card; signing in again starts the app afresh with an empty cache.

## Forgotten password

On the host, in the project folder, with the stack you run (for example `tailnet-dual`):

```sh
scripts/compose.sh tailnet-dual exec backend bun scripts/reset-password.ts   # [name], default Admin
```

It clears the password and signs out every browser; the next visit sets a new one, as on the first day.

## Tests

Backend route tests of other features build the app with `requireLogin: false`; `backend/src/auth/auth.test.ts` covers sign-in. The Playwright suite's global setup (`frontend/tests/sign-in.setup.ts`) sets the throwaway backend's password and every test starts signed in; `tests/sign-in.spec.ts` covers the screens. The opt-in live configs sign in with `E2E_ADMIN_PASSWORD` when the password is already set.
