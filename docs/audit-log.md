# Audit log

**Settings → Audit log** (`/settings/audit`, also in Portal) lists who did what, newest first, filtered by category (Sign-in, Agents, Computers, Organizations, System), 100 at a time with older events on request. Times show in the browser's zone (named) to the millisecond, as the request arrived; the exact UTC instant is in each time's tooltip. Every event is also written to the backend's server log (`audit <kind> <outcome>`).

## What is recorded

| Kind | When | Who / target | Detail |
| --- | --- | --- | --- |
| `auth.login` | every sign-in attempt, also those refused before the password is checked | the name typed (even unknown names) | reason when refused: wrong name or password, too many wrong passwords, busy, invalid request, another site or host name |
| `auth.setup` | the first sign-in setting the Admin password | the name typed | reason when refused |
| `auth.logout`, `auth.password` | sign-out, password change | the signed-in person | reason when a password change is refused |
| `organization.create` / `update` / `delete` / `move` | an organization made, renamed, deleted, or something moved into it (not move previews) | the organization | changed fields; what moved |
| `computer.create` / `update` / `delete` | a computer made (not a retried request), its settings changed or rebuilt, deleted | the computer | changed fields |
| `agent.create` / `update` / `delete` | an agent made, edited, deleted | the agent (its name before a rename or delete) | which part (agent, settings, computers, Discord, bot connected/removed, memory edited/removed/restored/cleared, sleep window), changed field names, a new name |
| `system.start` / `system.stop` | the backend starting (after it listens) and stopping on a signal | `system` | runtime and start-up time, signal |

Each event has the outcome `ok`, `failed` (refused, or an error: the HTTP status is kept) or `denied` (held back by the sign-in limits), the signed-in person (or the name given at sign-in), and the client address Caddy resolved (`X-Real-IP`; see [login](login.md)). Caddy believes `CF-Connecting-IP` and `X-Forwarded-For` from any private or tailnet address (so a reverse proxy can pass the visitor's address): a device on the LAN or tailnet, or a visitor reaching a proxy other than through Cloudflare, can choose the address that is logged. Refused attempts are logged at most 31 times per address in 15 minutes (the last one says so), so a flood cannot push real history out. **Values are never logged**: an edit lists field names, not instructions, tokens, keys or passwords.

## Storage and access

`AuditEvent` rows in the platform database (`backend/src/audit/store.ts`): append-only, kept 365 days and at most 200,000 events (pruned at start and hourly, in batches). A failed write never blocks or undoes the action it describes. `GET /api/audit?category=&before=&limit=` (signed-in only, at most 200 per page, `next` for older) serves the page. The route hooks live in `backend/src/audit/routes.ts`: a changed endpoint that should be audited must be added to its `RULES`.
