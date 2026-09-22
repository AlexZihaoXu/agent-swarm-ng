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

For browser tests (Git Bash/Linux), read the [Windows launch precautions](#windows-browser-launch-safety) first when running on the Windows host:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright"
(cd frontend && bun x playwright install chromium)
bun run test:e2e
```

Playwright starts its own backend and frontend; stop existing instances on ports 3000 and 5173 first. Browser tests cover rendering, transitions, saved-history restoration/pagination, and Settings with mocked API/provider and ChatGPT device-login results. PWA installation, offline caching, and updates still need production-browser validation.

### Windows browser launch safety

The owner's security investigation reproduced one Windows failed logon (Event 4625, status `0xC000006A`) from the top-level Chrome process during a single run of `.cache/check-codex-settings.mjs`. The reported cause is Chromium's empty-password account probe through `LogonUser()` at startup, not a website sign-in or an attack. Child processes did not produce additional failed logons in that capture. Treat this as a finding for this Windows host, not a guarantee about every browser/version.

The reported local policy locks the account after **10 failed attempts within 10 minutes**. A running desktop session can continue while the account is locked, hiding the problem until the next sign-in.

- Launch one dedicated automation browser and reuse it for the batch. Use new contexts/pages for clean test state, not repeated browser launches; never reuse the user's personal profile. Keep any automation control endpoint local-only.
- Serialize all Windows browser work, including other agents/scripts. For Playwright, use `bun run --cwd frontend test:e2e --workers=1 --retries=0`. This reduces launches but does not guarantee one: failures can replace workers and launch another browser. Do not run repeated suites or retry loops without checking headroom.
- Budget conservatively: stay below eight new launches per rolling ten minutes, accounting for existing failed logons and other browser users. Check the local counter before a browser-heavy batch (read-only PowerShell, for this host):

  ```powershell
  ([ADSI]"WinNT://./Alex,user").BadPasswordAttempts
  ```

  If the counter is unavailable, elevated, or near the threshold, stop and coordinate with the owner rather than guessing. The investigation reported a reset after ten quiet minutes; recheck instead of assuming elapsed time cleared it.
- Changing `channel: 'chrome'` to bundled Chromium is **not** a verified workaround because the probe may be shared. Do not alter Windows credentials or lockout policy to make tests pass. Prefer non-browser checks while launch headroom is uncertain.

These are operating rules; the current scripts/configuration do not enforce a shared launch budget automatically.

## Endpoint connection tests

In **Settings → API endpoints**, add a name, base URL (including an API prefix such as `/v1`), and optional API key. **Test connection** makes a backend `GET <base URL>/models`, using Bearer authentication when a key is provided. It lists model IDs only; it does not send an inference request or configure an agent.

Use **Save endpoint** to persist its name, URL, and key on the backend. Local development stores these in Git-ignored `.local/endpoints.json`; Docker uses the `platform_data` volume at `/app/.local`. The file contains plaintext keys with restrictive file permissions where supported; this is not an encrypted vault, and Windows access depends on the containing folder's ACL. Do not share or back up the file casually. It is excluded from Docker build contexts. The API returns only a `hasApiKey` flag, never the saved key. A blank replacement preserves a saved key; **Clear saved key** followed by Save removes it. Changing the URL clears the old key unless a replacement is supplied.

Unsaved edits still disappear on refresh. Keys are not stored in browser storage. Keys travel to the backend and the explicitly chosen endpoint; use HTTPS for remote providers. Localhost addresses refer to the **backend's** network namespace, including when it runs in Docker.

The test has a 10-second timeout, rejects redirects and URLs containing credentials/query parameters/fragments, bounds responses to 1 MiB and 1,000 model entries, and does not return raw provider errors. Local/private endpoints are intentionally supported, so this unauthenticated route can reach the backend's network: keep the platform loopback-only and do not expose it publicly. Authentication and network-access policy are prerequisites for external deployment.

## ChatGPT subscription connection

In **Settings → OpenAI Codex**, choose **Connect ChatGPT**, open the OpenAI sign-in link, and enter the displayed one-time code. Enable **device code login** in ChatGPT's security settings if required. Settings polls until login completes; you can cancel or disconnect there. Login expires after 15 minutes. This device flow works with both the local backend and Docker without forwarding an OAuth callback port.

Once connected, select **OpenAI Codex (ChatGPT)** in the new-agent form, then a model and thinking level. Pi's native `openai-codex` OAuth provider and Codex Responses transport use the subscription—not the separately billed OpenAI API endpoint. Model names come from Pi's bundled catalog; actual account access and usage limits are enforced by OpenAI. Agents share the account's allowance. There is no automatic paid-API fallback. Existing local-model agents are unchanged.

Tokens are held only by the backend in ignored `.local/openai-auth.json` (alongside the configured SQLite file), with Pi's locked token refresh and restrictive file permissions where supported. The UI gets connection metadata and a temporary device code, never access/refresh tokens. Disconnect removes the local credential; already running requests may finish. This is provider sign-in, not platform-user authentication: keep the dashboard loopback-only. Pi provides this third-party integration; it is not a promise of a stable public subscription API. See [OpenAI authentication](https://developers.openai.com/codex/auth).

## Pi agents and channels

Create an agent from the agent panel's context menu, then choose a saved endpoint or connected ChatGPT provider, model, and supported thinking level. Agents and published history survive refresh and backend restart. The dashboard displays only saved agents; an empty database starts with an empty agent list. Sample agents exist only in browser-test API fixtures, not in the app or database. Previously browser-only chats are not imported automatically.

Pi SDK 0.85.1 uses OpenAI-compatible Chat Completions for API endpoints or native Codex Responses for the connected ChatGPT subscription, with explicitly granted **`send_message`**, **`read_messages`**, and **`search_messages`**, bound to the current platform-chat channel, plus four web tools from **[Pi Web Access](https://github.com/nicobailon/pi-web-access) 0.30.0**: `web_search`, `source_check`, `fetch_content`, and `get_search_content`. Default coding tools, resource discovery, skills, prompt expansion, global settings, and inherited credentials remain disabled. Endpoint keys are literal values, never Pi's command/environment configuration syntax.

Web search uses keyless Exa MCP; queries go to Exa and public-page fetches contact their target websites. A dedicated Bun subprocess per turn keeps the extension's global configuration/result caches separate. It receives a minimal environment and generated configuration, not developer Pi settings, browser cookies, or endpoint credentials. Only public HTTP(S) readable/raw fetches are granted; the extension's private-network/redirect protections remain enabled. Local files, repository cloning, interactive browser workflows, extra model calls, and caller-supplied auth/proxies are disabled. Result IDs are turn-local; temporary files under `.local/web-turns` are removed on normal cleanup (a backend crash may leave leftovers). This is process/configuration isolation, not an OS sandbox. Agents still have no computer, shell, or interactive browser access.

Right-click an agent and choose **Delete agent**. The confirmation dialog requires its exact name (case and whitespace included); the backend checks it again. Deleting an agent permanently removes its channels and chat messages, but not shared provider connections. An active turn blocks deletion: stop it and wait before retrying. Local drafts, activity, and cached history are cleared when deletion succeeds.

Incoming user context includes a compact channel/message/timestamp header. The system prompt puts delivery first: acknowledge actionable tasks through `send_message` with `final:false` before planning or using tools, continue working, then publish the actual result with `final:true` (the default, which ends the turn). Simple questions should receive a direct answer without an extra acknowledgment. Substantial answers should be chat-sized: lead with the takeaway, split by topic into a few focused messages (normally 1–3 short paragraphs or a compact list each), and await each publication. Intermediate answer parts use `final:false`; only the last uses `final:true`. Keep tables/code/quotations intact, citations and caveats near their claims, and short answers in one bubble; honor requests for one consolidated response. There is no automatic character-based splitting. This guides model behavior; it does not guarantee response latency or model compliance.

Only successful channel-tool publications become agent chat messages, and the database commit precedes tool success and browser delivery. User messages are saved before inference and appear as sent after the save acknowledgment; inference failure does not erase an accepted message. Unacknowledged sends retain their draft and reuse the same ID on retry. After an uncertain connection failure, reload history before sending a replacement. Message IDs reject duplicate submissions, and a single backend process allows one main execution per agent, with at most one temporary triage fork. Accepted work belongs to the backend: refreshing, closing the dashboard, or losing its connection does not cancel inference or prevent publication. **Stop** explicitly targets the initiating message ID, so a stale command cannot stop a newer run.

The dashboard submits with `Prefer: respond-async` and receives a `202` save acknowledgment, then observes a shared `/api/events` NDJSON feed. A new connection starts with active-run/typing state; reconnects reload saved history and merge any newer live publications. Event IDs suppress duplicate delivery, and recovered history stays silent. The legacy per-request stream remains available but also observes backend-owned work. Slow clients are disconnected rather than allowed to block a run.

There is no automatic run deadline by default. Set `AGENT_RUN_TIMEOUT_MS` to a positive integer to impose one (`0` disables it); web-tool and credential-request limits still apply. Shutdown stops active work and cleans up sessions/workers. Agent identities and published messages survive backend restarts, but in-progress inference does not resume. Keep the backend running for continuous availability; autonomous schedules, durable job recovery, and an always-thinking loop are not implemented.

Each new run creates a fresh in-memory Pi session with the **full incoming message** and the **eight most recent published message previews**, up to 1,000 characters each. Previews include IDs, authors, timestamps, and explicit continuation offsets. This is bounded context, not summarization or long-term memory; private reasoning/tool context is not replayed into unrelated later runs. Follow-ups accepted during an active run continue its existing in-memory session. Before normal completion, a missing final publication receives at most one private delivery reminder—even if an acknowledgment was already sent. If that remains unresolved after an acknowledgment, the run reports the missing final reply rather than silently treating it as delivered. Intentional silence without any publication remains possible. Raw output is never a chat fallback.

### New messages during work

Messages are saved immediately, then inference waits for a **1.5-second quiet period**. Rapid messages are combined without losing their IDs or text. During active work, a temporary **full-context fork** advises whether new messages should interrupt or wait; it has only a decision tool and cannot publish. Interruptions cancel/join the main generation before continuing that same session with the new messages and a brief decision justification. Uncertainty/failure queues the messages; main-first completion cancels triage. Stop cancels the entire run, including pending continuations. The dashboard supports sending follow-ups while retaining its Stop control.

The `202` acknowledgment's `message.id` identifies the newly saved message; `run.clientMessageId` remains the original request/Stop target. Saves are serialized per agent; a competing save can return 409, retaining the unsent draft. See [assumptions, fork semantics, and limitations](message-interruption.md).

### Agent chat-history tools

- **`read_messages`** opens the latest 20 messages by default (`at: "now"`/`"latest"` are equivalent). Choose one anchor: an ISO timestamp with timezone in `at`, a `messageId` to open surrounding context, or an exclusive sequence cursor in `before`/`after`. Sections are chronological, include their actual time/sequence range and navigation cursors, and contain at most 40 messages / 20,000 preview characters.
- Long messages are explicitly truncated. Use `read_messages({ messageId, offset: nextOffset })` to retrieve the next chunk, up to 6,000 characters; use the returned offsets rather than guessing character positions.
- **`search_messages`** searches a literal phrase, newest first, with optional `author` (`user`/`assistant`), inclusive `since`/`until` ISO timestamps, and a `before` continuation cursor. It returns up to 20 hits with 320-character snippets. Open a hit with `read_messages({ messageId })` to see its surrounding conversation. Search is ASCII case-insensitive; other characters match literally. Results are bounded, but substring search can scan the selected channel; this is not a full-text search index.

These tools expose structured text, not screenshots or an entire transcript. Every anchor, fragment, and search is checked against the agent's current channel; internal activity and other channels are excluded. Reading/searching does not mark messages read or create an unread cursor. Timestamp jumps use a channel/time/sequence index; navigation uses stable sequence cursors.

### Activity and rendering

The activity header shows the **latest main-session context estimate**: tokens / configured context window and percentage. One updatable **Context usage** activity entry per run includes the explanatory notes. It refreshes at message boundaries and after each request batch, not on every streamed token. This uses Pi's `getContextUsage()` (latest valid provider usage plus estimated trailing messages). When the provider supplies no usage, the message-based estimate can omit system-prompt/tool-schema overhead. Unknown values are not displayed as zero; unknown model capacities use the runtime's configured fallback window, not a discovered endpoint limit. It is not cumulative billing and excludes temporary triage forks. Metrics are ephemeral like other activity; after refresh, wait for a new runtime update.

**Agent activity** is a separate, browser-memory-only inspector for provider-exposed thinking/output, tools, reminders, publications, and errors. It collects new activity while the inspector is closed. Reconnecting restores live observation, not a persisted activity log or hidden provider reasoning. Typing starts when streamed metadata identifies `send_message`; draft arguments stay out of the channel. Green avatar dots indicate readiness, not monitored endpoint uptime. Active requests turn the badge aqua with smoothly changing, independently randomized liquid contours rather than a fixed star/rotation loop; typing takes priority with the aqua three-dot pill. Completion settles it back into the original green circle. Reduced motion uses a static irregular working badge; animation pauses in hidden tabs and stops when idle or unmounted. Both sidebar and chat-header badges use the channel's busy/typing state.

New tool-published agent messages play `frontend/public/sounds/aqua-drop.mp3` once per new message ID. User messages, typing, internal activity, duplicate deliveries, and restored history are silent. Browser audio is enabled by the first pointer/keyboard interaction; blocked or unavailable audio never fails chat. This is an in-page sound, not an OS/push notification. The owner-provided bottle clip was formatted with FFmpeg (`loudnorm=I=-20:TP=-3:LRA=7`, mono, 44.1 kHz, 96 kb/s MP3, metadata removed); the ~0.82-second asset is precached with the app.

Chat and compact card previews share Markdown parsing, including formatting, lists, quotes, tables, code, and spoilers. Chat code blocks have highlighting/copy controls; previews remain non-interactive and hide spoilers. Raw HTML is disabled, unsafe link protocols are rejected, and remote images are links rather than automatic third-party requests. Stored text and the composer are unchanged; this is not a complete Discord syntax implementation.

Thinking-level controls use Pi's known OpenAI model metadata and standard `reasoning_effort`; unknown support is disabled rather than guessed. Listing `/models` does not guarantee tool-calling compatibility. Local OpenAI-compatible fixtures and a user-authorized Qwen endpoint have been tested; other provider families are not claimed to work.

## Platform storage

- **Prisma 7.9.1 + SQLite:** identities, channels, and user/tool-published messages in ignored `.local/platform.db`. Bun uses the libSQL adapter; no separate database service is needed.
- **Provider credentials:** API endpoint keys remain in `.local/endpoints.json`; ChatGPT OAuth credentials use `.local/openai-auth.json`. Neither is copied into chat records or returned by the API.
- **Ephemeral:** drafts, typing, operator activity, and Pi sessions. No JSONL sessions are written. External providers may retain inference requests according to their policies.
- **Docker:** both backend targets run as `bun` and use `platform_data` at `/app/.local`. Replacing a container preserves data; deleting the volume is destructive.

Backend startup applies committed migrations with `prisma migrate deploy`; development also generates the client. Apply new migrations with the backend stopped: a live libSQL connection on Windows can cause Prisma's migration engine to report `database is locked`. Coordinate a restart rather than interrupting active runs or forcing the lock. `bun run api:generate`, `bun run typecheck`, and `bun run test` generate it as needed. Generated client files, database files, and WAL/SHM files are not committed. Unit tests use isolated databases and remove them after workers exit, including on Windows.

```sh
bun run --cwd backend db:generate
bun run --cwd backend db:deploy
# For an intentional schema change, from backend/:
bun node_modules/prisma/build/index.js migrate dev --name describe_change
bun run db:generate
```

`DATABASE_URL` optionally overrides the local SQLite file. Relative paths resolve from the backend working directory; use container paths under `/app/.local` for Compose. Do not use a network share or multiple backend processes with this implementation.

WAL mode, a five-second busy timeout, foreign keys, and the `(channelId, sequence)` index support short writes and cursor pagination. Messages load 50 at a time (API maximum 100); agent lists load up to 100 at a time. Card previews use indexed latest-message lookups, never full conversation loads. SQLite still serializes writers; Prisma does not remove that limit or make a future Postgres/data migration automatic.

Storage is plaintext, not an encrypted vault. Restrictive permissions are used where supported; Windows access depends on folder ACLs. For a simple consistent backup, stop the backend and copy the entire `.local` directory or snapshot `platform_data`, including any WAL files and endpoint preferences. Do not copy only the main database while it is running. Protect backups as sensitive data.

Authentication and multi-host coordination remain unimplemented. Keep this single-backend platform loopback-only; persistent IDs are not authorization tokens.

## Docker Compose

Requires Docker with Compose 2.24.4+ (`!override` support).

```sh
# Development: http://localhost:5173
docker compose -f compose.yaml -f compose.dev.yaml up --build

# Production-style local build: https://localhost
docker compose up --build -d
```

Development bind-mounts source and Prisma files. Generate the client after schema changes; rebuild images after dependency changes and before production deployment. File watching through Docker Desktop bind mounts may need platform-specific tuning.

Caddy serves the built frontend and proxies `/api` in production. Local HTTPS uses Caddy’s local CA, which your browser will not trust automatically. Trust its certificate explicitly for local PWA testing, or use localhost development without HTTPS. Do not bypass certificate errors as a production setup.

Ports bind to loopback by default. `.env.example` documents the settings; authentication is not implemented, so **do not expose this scaffold publicly**. Public-domain HTTPS configuration and access control must be completed before external deployment.

The backend has no Docker socket mount or container-management endpoints yet. `templates/default/` contains a placeholder template definition and an Ubuntu GNOME package foundation—not a desktop-ready environment. Platform Compose does not build or start it; the standalone workspace Compose file below does.

## Default environment image

The image uses Ubuntu 24.04 and explicitly installs the Ubuntu GNOME session, Ubuntu Dock, app indicators, Yaru themes, Ubuntu fonts, terminal, file manager, settings, and D-Bus support. Ubuntu visual defaults, Noble wallpapers, SVG icon rendering, and dock menu support are included to preserve the standard desktop appearance; “lean” means omitting extra applications, not stripping desktop assets. The image sets `LANG=C.UTF-8`, since GNOME Terminal cannot start under the plain C/ASCII locale. `--no-install-recommends` avoids pulling in the full desktop application bundle. Required transitive dependencies still install; do not remove GNOME dependencies merely because their names resemble optional apps.

No office suite, games, email client, or media player is explicitly installed. Package tests check the agreed exclusions; inspect the full inventory when reviewing dependency changes. Package references: [Ubuntu session](https://packages.ubuntu.com/noble/ubuntu-session) and [GNOME settings](https://packages.ubuntu.com/noble/gnome-control-center).

Once Docker is running:

```sh
docker build -t agent-swarm-default:dev templates/default
# Verify desktop essentials and absence of common bundled applications:
docker run --rm -i agent-swarm-default:dev sh < templates/default/test-packages.sh
# Test a non-root GNOME compositor at the fixed 1920x1080 resolution:
# MSYS_NO_PATHCONV prevents Git Bash from rewriting /run on Windows.
MSYS_NO_PATHCONV=1 docker run --rm --user root --init --tmpfs /run --shm-size=256m -i agent-swarm-default:dev sh < templates/default/test-desktop.sh
# Inspect the full installed package inventory:
docker run --rm agent-swarm-default:dev dpkg-query -W
```

## Workspace tools and persistence

The image includes Chrome, VS Code, Git, curl, C/C++ build tools, Node.js 22 with npm, Bun 1.3.6, Python 3 with venv support, uv 0.9.18, and tmux. Chrome and VS Code use their signed vendor apt repositories rather than Snap. The workspace Compose configuration enables the [Chromium-compatible seccomp profile](../templates/default/security/README.md) and `no-new-privileges`. Chrome runs as the non-root workspace user with its namespace and Seccomp-BPF sandboxes enabled; it does not use `--no-sandbox`, privileged mode, or added `SYS_ADMIN` capability. This permits namespace syscalls throughout the container, so revalidate the trade-off and host-specific restrictions on the Linux deployment target. VS Code's WSL installation prompt is suppressed because the Linux editor is intentional inside this container.

The default process runs as `ubuntu`, with `/home/ubuntu` as its home and `/workspace` as its working directory. No agent harnesses or credentials are installed. Use the same Compose project name to reconnect replacement containers to their data; use a different name for a separate environment:

```sh
docker compose -p swarm-demo -f templates/default/compose.yaml up --build -d
docker compose -p swarm-demo -f templates/default/compose.yaml exec workspace bash
# Reconnect to a terminal session while the container remains running:
docker compose -p swarm-demo -f templates/default/compose.yaml exec workspace tmux new-session -A -s main
# Remove the container/network but retain both named volumes:
docker compose -p swarm-demo -f templates/default/compose.yaml down
```

Home and workspace use separate, project-scoped named volumes. Fresh volumes inherit the image directory contents and ownership; existing volumes are not overwritten. Container removal retains them. Deleting data requires an explicit volume-deletion operation; `down --volumes` is destructive. tmux survives client disconnection, **not** container restart or replacement.

```sh
docker run --rm -i agent-swarm-default:dev sh < templates/default/test-workspace.sh
sh templates/default/test-persistence.sh
# With the standalone workspace running, verify Chrome's reported sandbox state:
docker compose -p swarm-demo -f templates/default/compose.yaml exec -T workspace sh < templates/default/test-browser-sandbox.sh
```

The persistence test creates its own uniquely named project, verifies files survive container replacement, and deletes only that test project's volumes afterward. The dashboard does not yet manage these volumes.

## Desktop validation status

The image currently idles without starting GNOME. Temporary noVNC preview files under ignored `.cache/` are local experiments, not part of the supported startup path. The compositor test uses a non-root user, software rendering, and D-Bus readiness checks. Mount a fresh `/run` tmpfs: package installation leaves systemd seat directories in the image, which otherwise cause GNOME to expect a running systemd-logind service.

Desktop resolution is fixed at 1920x1080, independent of browser viewport size. The test does not establish hardware encoding, 120 fps, streaming, or a complete desktop session. Optional-service warnings remain (including calendar, screencast, input-method, and authentication services). Production session startup and the desktop toggle are not implemented.
