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

## Dashboard locations

Stable dashboard destinations live in the URL, so a refresh or copied link can reopen them and browser Back/Forward tracks navigation:

- `/agents`, `/agents/:id`, `/agents/:id/dm/:peerId` — agent list, human conversation, and agent-to-agent transcript. Agent editor sections and Channel → Swarm App → DM drilldowns live under `/agents/:id/edit/...`; create/delete dialogs have their own paths.
- `/chat`, `/chat/agents/:id`, `/chat/groups/:id` — chat list, human DM and group history. Group create/edit/delete dialogs use nested `/chat/groups/...` paths.
- `/computers`, `/computers/:id` — grid and human desktop viewer; create/delete dialogs use `/computers/new` and `/computers/:id/delete`. This **dashboard route is different from** the locked-down trusted Selkies iframe at `/computers/:id/desktop/`.
- `/settings`, `/settings/endpoints/new`, `/settings/endpoints/:id` — saved connections and the endpoint editor. The `/` entry redirects to Agents.

Only navigation is encoded: unsaved messages, searches, API keys, provider sign-in codes, consent/confirmation text and agent activity traces are **not** stored in URLs or restored after refresh. IDs in a path are not access grants; the existing backend authorization checks still apply. Unknown/deleted destinations show a return path rather than selecting a different resource. Production Caddy serves dashboard paths through the SPA fallback **after** its bounded `/api/*` and `/computers/:id/desktop/*` handlers; the PWA fallback also excludes those paths.

## Checks

```sh
bun run api:generate
bun run api:check
bun run typecheck
bun run test
bun run build
# Opt-in Linux/Docker computer lifecycle + browser E2E (unique test project; cleans its own resources):
sh scripts/test-computers-dev.sh
```

API generation does not require a running server. Commit both `backend/openapi.json` and `frontend/src/api/schema.d.ts` when the contract changes. CI checks generated files for drift.

For browser tests (Git Bash/Linux), read the [Windows launch precautions](#windows-browser-launch-safety) first when running on the Windows host:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.scratch/ms-playwright"
(cd frontend && bun x playwright install chromium)
bun run test:e2e
```

Disposable development experiments, inspected external checkouts, and test outputs belong under ignored `.scratch/`; persistent app data and credentials stay in `.local/`. Playwright starts its own backend and frontend; stop existing instances on ports 3000 and 5173 first. Browser tests cover rendering, transitions, saved-history restoration/pagination, and Settings with mocked API/provider and ChatGPT device-login results. PWA installation, offline caching, and updates still need production-browser validation.

### Windows browser launch safety

The owner's security investigation reproduced one Windows failed logon (Event 4625, status `0xC000006A`) from the top-level Chrome process during a one-off Chrome startup check. The reported cause is Chromium's empty-password account probe through `LogonUser()` at startup, not a website sign-in or an attack. Child processes did not produce additional failed logons in that capture. Treat this as a finding for this Windows host, not a guarantee about every browser/version.

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

Once connected, select **OpenAI Codex (ChatGPT)** in the new-agent form, then a model and thinking level. Pi's native `openai-codex` OAuth provider and Codex Responses transport use the subscription—not the separately billed OpenAI API endpoint. Model names and thinking capabilities come from Pi's live provider catalog, with the bundled catalog as fallback. Connected status/model-selection/inference-admission requests refresh the Codex catalog automatically when its five-minute cache expires; refreshes are coalesced, limited to five seconds, and scoped to `openai-codex`. Failures retain the last known catalog and back off for one minute. The SDK persists metadata in ignored `.local/openai-models.json`, separately from credentials. This is Pi's supported catalog service, not a direct OpenAI `/models` entitlement check; actual account access and usage limits are enforced by OpenAI. Agents share the account's allowance. There is no automatic paid-API fallback. Existing local-model agents are unchanged.

Tokens are held only by the backend in ignored `.local/openai-auth.json` (alongside the configured SQLite file), with Pi's locked token refresh and restrictive file permissions where supported. The UI gets connection metadata and a temporary device code, never access/refresh tokens. Disconnect removes the local credential; already running requests may finish. This is provider sign-in, not platform-user authentication: keep the dashboard loopback-only. Pi provides this third-party integration; it is not a promise of a stable public subscription API. See [OpenAI authentication](https://developers.openai.com/codex/auth).

## Pi agents and channels

Create an agent from the agent panel's context menu, then choose a saved endpoint or connected ChatGPT provider, model, and supported thinking level. Agents and published history survive refresh and backend restart. The dashboard displays only saved agents; an empty database starts with an empty agent list. Sample agents exist only in browser-test API fixtures, not in the app or database. Previously browser-only chats are not imported automatically.

Pi SDK 0.85.1 uses OpenAI-compatible Chat Completions for API endpoints or native Codex Responses for the connected ChatGPT subscription, with explicitly granted **`send_message`**, **`read_messages`**, and **`search_messages`**, bound to the current platform-chat channel, plus four web tools from **[Pi Web Access](https://github.com/nicobailon/pi-web-access) 0.30.0**: `web_search`, `source_check`, `fetch_content`, and `get_search_content`. Default coding tools, resource discovery, skills, prompt expansion, global settings, and inherited credentials remain disabled. Endpoint keys are literal values, never Pi's command/environment configuration syntax.

Agent communication grants also include `search_emojis` (bounded local emoji name/keyword search plus the agent's four saved recent choices), `read_reactions`, and `react_to_message`. [Message replies](message-replies.md) add an optional, server-validated same-conversation target to `send_message`/`send_dm`; bounded history and incoming context show its author/excerpt without granting another channel. A new human-added reaction is offered to a bounded, decision-only branch before any normal agent turn; see [reaction delivery and picker behavior](chat-and-groups.md#reaction-context-menu). These grants do not add shell, computer, or operator administration access.

Web search uses keyless Exa MCP; queries go to Exa and public-page fetches contact their target websites. A dedicated Bun subprocess per turn keeps the extension's global configuration/result caches separate. It receives a minimal environment and generated configuration, not developer Pi settings, browser cookies, or endpoint credentials. Only public HTTP(S) readable/raw fetches are granted; the extension's private-network/redirect protections remain enabled. Local files, repository cloning, interactive browser workflows, extra model calls, and caller-supplied auth/proxies are disabled. Result IDs are turn-local; temporary files under `.local/web-turns` are removed on normal cleanup (a backend crash may leave leftovers). This is process/configuration isolation, not an OS sandbox. Agents still have no computer, shell, or interactive browser access.

Right-click an agent and choose **Delete agent**. The confirmation dialog requires its exact name (case and whitespace included); the backend checks it again. Deleting an agent permanently removes its channels and chat messages, but not shared provider connections. An active turn blocks deletion: stop it and wait before retrying. Local drafts, activity, and cached history are cleared when deletion succeeds.

Incoming user context includes a compact channel/message/timestamp header. The system prompt puts delivery first: acknowledge actionable tasks through `send_message` with `final:false` before planning or using tools, continue working, then publish the actual result with `final:true` (the default, which ends the turn). Simple questions should receive a direct answer without an extra acknowledgment. Substantial answers should be chat-sized: lead with the takeaway, split by topic into a few focused messages (normally 1–3 short paragraphs or a compact list each), and await each publication. Intermediate answer parts use `final:false`; only the last uses `final:true`. Keep tables/code/quotations intact, citations and caveats near their claims, and short answers in one bubble; honor requests for one consolidated response. There is no automatic character-based splitting. This guides model behavior; it does not guarantee response latency or model compliance.

Only successful channel-tool publications become agent chat messages, and the database commit precedes tool success and browser delivery. User messages are saved before inference and appear as sent after the save acknowledgment; inference failure does not erase an accepted message. Unacknowledged sends retain their draft and reuse the same ID on retry. After an uncertain connection failure, reload history before sending a replacement. Message IDs reject duplicate submissions, and a single backend process allows one main execution per agent, with at most one temporary triage fork. Accepted work belongs to the backend: refreshing, closing the dashboard, or losing its connection does not cancel inference or prevent publication. **Stop** explicitly targets the initiating message ID, so a stale command cannot stop a newer run.

The dashboard submits with `Prefer: respond-async` and receives a `202` save acknowledgment, then observes a shared `/api/events` NDJSON feed. A new connection starts with active-run/typing state; reconnects reload saved history and merge any newer live publications. Event IDs suppress duplicate delivery, and recovered history stays silent. The legacy per-request stream remains available but also observes backend-owned work. Slow clients are disconnected rather than allowed to block a run.

There is no automatic run deadline by default. Set `AGENT_RUN_TIMEOUT_MS` to a positive integer to impose one (`0` disables it); web-tool and credential-request limits still apply. Shutdown stops active work and cleans up sessions/workers. Agent identities and published messages survive backend restarts, but in-progress inference does not resume. Keep the backend running for continuous availability; autonomous schedules, durable job recovery, and an always-thinking loop are not implemented.

Each new run reconstructs the same agent's private Pi working context from indexed SQLite entries, then receives the **full incoming message**. Agents without a checkpoint bootstrap once from the **eight most recent published message previews**, up to 1,000 characters each, with IDs, authors, timestamps and continuation offsets. Completed Pi turns/tool results are checkpointed separately from chat; Pi compaction saves a summary and retained active tail while older private entries remain archived, not all injected into the prompt. Recent publications committed after a private checkpoint are reconciled as prior context, never retried automatically. The system prompt and current tool grants are rebuilt on every run. This is working-session continuity, not independent long-term memory or unlimited context. Follow-ups accepted during an active run continue its existing in-memory session. Before normal completion, a missing final publication receives at most one private delivery reminder—even if an acknowledgment was already sent. If that remains unresolved after an acknowledgment, the run reports the missing final reply rather than silently treating it as delivered. Intentional silence without any publication remains possible. Raw output is never a chat fallback.

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

**Agent activity** is a separate, browser-memory-only inspector for provider-exposed thinking/output, tools, reminders, publications, and errors. It collects new activity while the inspector is closed. Reconnecting restores live observation, not a persisted activity log or hidden provider reasoning. Typing starts when streamed metadata identifies `send_message`; draft arguments stay out of the channel. Green avatar dots indicate readiness, not monitored endpoint uptime. Active requests turn the badge into an aqua opacity-pulsing dot with the same dimensions as idle green; typing takes priority with the aqua three-dot pill. Completion restores the static green dot. Reduced motion disables the pulse, and hidden tabs pause it. Agent avatars separately use seeded outline movement, blinks and glances; creation and right-click **Edit agent → Avatar** share the saved appearance editor. See [agent avatars](agent-avatars.md). Both agents shown in a peer-chat header have live status indicators. Received peer messages are source-labelled bubbles, not fabricated replies to the human, and remain silent. **Edit agent → Settings → Channels → Swarm App** configures mutual connections. **Chat with** defaults to **You** and switches the main history to the selected peer; only agent choices have avatars. The selected agent stays left, with sender-tinted bubbles in peer mode. See [agent communication](agent-communication.md) for scoped tools, shared chain limits, queueing, and restart/cancellation semantics.

New tool-published agent messages play `frontend/public/sounds/aqua-drop.mp3` once per new message ID. User messages, typing, internal activity, duplicate deliveries, and restored history are silent. Browser audio is enabled by the first pointer/keyboard interaction; blocked or unavailable audio never fails chat. This is an in-page sound, not an OS/push notification. The owner-provided bottle clip was formatted with FFmpeg (`loudnorm=I=-20:TP=-3:LRA=7`, mono, 44.1 kHz, 96 kb/s MP3, metadata removed); the ~0.82-second asset is precached with the app.

Chat and compact card previews share Markdown parsing, including formatting, lists, quotes, tables, code, and spoilers. Chat code blocks have highlighting/copy controls; previews remain non-interactive and hide spoilers. Raw HTML is disabled, unsafe link protocols are rejected, and remote images are links rather than automatic third-party requests. Stored text and the composer are unchanged; this is not a complete Discord syntax implementation.

Thinking-level controls use Pi's known OpenAI model metadata and standard `reasoning_effort`; unknown support is disabled rather than guessed. Listing `/models` does not guarantee tool-calling compatibility. Local OpenAI-compatible fixtures and a user-authorized Qwen endpoint have been tested; other provider families are not claimed to work.

## Platform storage

- **Prisma 7.9.1 + SQLite:** identities, channels, user/tool-published messages, same-conversation reply references, reactions, agent-specific recent emoji choices, and private indexed Pi session entries/checkpoints in ignored `.local/platform.db`. Bun uses the libSQL adapter; no separate database service is needed.
- **Provider credentials:** API endpoint keys remain in `.local/endpoints.json`; ChatGPT OAuth credentials use `.local/openai-auth.json`. Neither is copied into chat records or returned by the API.
- **Ephemeral:** drafts, typing, operator activity, and the active provider stream. Private completed Pi working context survives restarts in the database; no Pi JSONL sessions are written. Those private records can include provider-exposed reasoning and tool results, so the whole database and its backups are sensitive even though internal entries never become chat/API history. External providers may retain inference requests according to their policies.
- **Docker:** both backend targets run as `bun`. Default Compose uses `platform_data` at `/app/.local`; the Tailnet override bind-mounts the existing project `.local` there instead. Replacing a container preserves data; deleting the default Compose volume is destructive.

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

The **historical stage-1** Tailnet instance used `compose.tailscale.yaml`: it bind-mounts project-local `.local` and serves HTTP only on loopback and the explicitly chosen Tailscale IPv4 address, TCP 19090. Do **not** deploy the stage-2 H.264/WebCodecs viewer with only that HTTP overlay: remote non-localhost HTTP is not a browser secure context. One stage-2 option adds `compose.tailscale-https.yaml`, a trusted certificate/key for the exact Tailnet DNS name under `.local/certs/` (0700 directory, 0600 key), and `TAILSCALE_DNS_NAME`. Tailscale currently denies certificate issuance for this account; enabling HTTPS certificates in Tailscale Admin Console → DNS publishes the machine/tailnet name in Certificate Transparency. Never use a browser certificate/security bypass. This overlay retains only loopback plus Tailnet **TCP 19090**.

If the operator wants the existing encrypted Tailnet transport without a browser-trusted certificate, **HTTP/JPEG on Tailnet** is available via `compose.yaml` + `compose.tailscale.yaml` + `compose.tailscale-http-jpeg.yaml`. The last overlay builds/selects `agent-swarm-default:http-jpeg`; it keeps the same `.local` mount and publishes only loopback and the chosen Tailnet IPv4 on TCP 19090. Tailscale protects device-to-device packets, but HTTP is still an insecure browser origin, so the verified `createImageBitmap` JPEG decoder is used instead of WebCodecs. Any peer allowed to reach the Tailnet address can operate the unauthenticated dashboard. This original Wayland/JPEG overlay alone retains GNOME portal consent and is now a rollback option; the deployed fourth X11 overlay below bypasses it.

The **deployed portal-free Tailnet HTTP/JPEG variant** adds `compose.tailscale-http-jpeg-x11.yaml` after the three existing Tailnet HTTP/JPEG files. Build the Stage2 and JPEG base images, egress/media and the distinct X11 image **with direct `docker build` commands** in that order before building the frontend; its Vite build flag hides the obsolete GNOME permission preview only in this selected mode. The distinct `agent-swarm-default:http-jpeg-x11` image retains Ubuntu GNOME but runs it on a container-local Xvfb X11 display; Selkies captures/injects input via X11 instead of GNOME's permission portal. The guest already has passwordless sudo, but this path does not request a host input device or Docker access. Isolated and live Tailnet browser E2E verified real GNOME video, cursor, mouse drag and keyboard with no portal click or sharing indicator; measured JPEG latency was not meaningfully lower. X11 loses Wayland's isolation between applications inside the already sudo-capable guest. The unauthenticated dashboard's allowed Tailnet peers would be able to control it without a second GNOME consent gate; explicitly accept that access scope and coordinate a volume-preserving restart of any running Wayland computer before migration. The opt-in reproducible gate is `sh scripts/test-computers-x11-dev.sh`; it uses only a uniquely labelled disposable project and one Linux browser worker, never `.local` or the owner's browser profile.

A separate **operator-opt-in private-LAN HTTP/JPEG** option uses `compose.lan-http.yaml`: an explicitly selected `LAN_IP` publishes only that trusted LAN IPv4 plus loopback on TCP 19090; its distinct `agent-swarm-default:http-jpeg` image locks Selkies to JPEG, decoded with browser `createImageBitmap` rather than WebCodecs. It does not require Tailnet or a browser security flag. The browser client contains a SHA-checked, frontend-only adaptation of the pinned Selkies core; guest sudo still cannot edit executable frontend bytes. Real video and pointer/keyboard input passed an isolated browser test at an insecure remote HTTP origin, but LAN deployment and phone behavior were not verified. **There is no app authentication; HTTP exposes desktop video, input, management APIs and other platform data in plaintext to anyone able to reach that LAN address.** Do not set `LAN_IP=0.0.0.0` or expose a public interface without an explicit access policy and owner decision. Build shared images **directly** before the frontend: `docker build -t agent-swarm-default:stage2 templates/default`, `docker build -t agent-swarm-default:http-jpeg --build-arg COMPUTER_STREAM_ENCODER=jpeg templates/default`, `docker build -t agent-swarm-computer-egress:dev -f templates/default/egress.Dockerfile templates/default`, and `docker build -t agent-swarm-computer-media:stage2 -f templates/default/media.Dockerfile templates/default`. Never bake disposable Compose-project labels into those shared tags. This is not permission to interrupt an existing computer or skip the backup/authorization gates.

Before any live restart, check `/api/events` for active runs; stopping the sole backend cancels in-progress inference. Build the fixed stage-2 computer/egress/media images **before** the production frontend, since it copies the pinned Selkies browser client from the computer image. Stop the backend for a consistent restricted `.local` backup including WAL and credentials, then build/smoke-test new images using disposable data before replacing live containers. Existing stage-1 computers are **not** upgraded by merely replacing the controller image: coordinate a non-destructive, volume-preserving container migration and the loss of current desktop processes with the owner. Verify either a real HTTPS certificate or the deliberately selected Tailnet/private-LAN HTTP/JPEG mode, plus preserved counts, correct encoder, same-port routing and bind addresses after deployment. Never delete user home/workspace volumes as an upgrade shortcut.

An earlier Bun 1.3.6 Docker build crashed during backend Prisma generation, requiring a host-specific checksum-matched dependency/runtime-layer workaround. During the **2026-09-24 stage-1 Computers rollout**, the regular production Docker Compose backend build succeeded (with cached layers) and passed an isolated production-image migration/health smoke test before replacing the live image; the old workaround is not a checked-in replacement for `backend/Dockerfile` or a promise that future cold builds succeed. For backend source or schema changes, regenerate the client, build and smoke-test a new backend image before restarting; never reuse a frontend-only shortcut for a changed backend. For frontend-only changes to the **current** portal-free Tailnet HTTP/JPEG stack, include all **four** overlays in both commands: `TAILSCALE_IP="$(tailscale ip -4)" docker compose -f compose.yaml -f compose.tailscale.yaml -f compose.tailscale-http-jpeg.yaml -f compose.tailscale-http-jpeg-x11.yaml build frontend`, then `TAILSCALE_IP="$(tailscale ip -4)" docker compose -f compose.yaml -f compose.tailscale.yaml -f compose.tailscale-http-jpeg.yaml -f compose.tailscale-http-jpeg-x11.yaml up --no-build --no-deps -d frontend` after checking live runs. Omitting either JPEG or X11 overlay would select an incompatible capture/consent mode.

The stage-1 rollout checked `/api/events` for zero active runs, stopped backend/frontend for a consistent mode-0600 `.local/backups/` archive including WAL and credentials, applied the additive computer migration, and verified the existing agent/message counts and only loopback/Tailnet TCP 19090 binding. It did **not** create/delete a computer on the live data stack or run a browser against the live site. The 2026-09-25 stage-2 Tailnet HTTP/JPEG rollout again checked zero active runs and saved counts, stopped backend/controller and the one running stage-1 desktop with owner approval, saved fresh protected archives of `.local` and both named volumes plus local image rollback tags, then replaced only the desktop image. Its UUID, named home/workspace volumes, GNOME preview and saved Agent/Message/Computer/Migration counts (1/6/1/11) survived. The live dashboard served a valid static viewer, patched trusted JS, restricted JSON/API paths and an HTTP 101 media upgrade on only loopback plus Tailnet TCP 19090. A dedicated Linux browser confirmed HTTP is an insecure origin and create-computer dialogs center at 1280/320px without creating any live computer. The operator did **not** auto-click GNOME's first-run screen-sharing dialog; visible live frames/input on this user computer remain unconfirmed until the human viewer grants consent. This is **not** a public deployment: the platform has no user authentication, and every Tailnet peer allowed to reach it can operate it. Container services use `restart: unless-stopped`; verify the Tailnet URL after reboot, since binding its IPv4 depends on the interface being ready. Never expose port 19090 to a public interface.

The later **portal-free X11 migration** was approved by the owner for Swarm-owned containers (not data deletion). The new tracked isolated harness passed genuine remote HTTP/JPEG browser video, GNOME cursor, Files click, held window drag, Meta keyboard and phone pan; the original Wayland API + eight real browser tests and all 185 unit/integration tests passed. A separate disposable stage2 JPEG→X11 rehearsal preserved home/workspace sentinels, UUID, isolation and rollback. Immediately before the live restart `/api/events` again showed zero active runs; the backend was stopped for a fresh mode-0600 `.local` archive, then controller and owned desktop stopped for separate protected home/workspace archives. A stopped-container/overlay rollback image and all prior service-image tags were retained. Only the owned stale media relay was removed; the new X11 desktop reused the named volumes, and the old stopped duplicate container was removed without `-v` after preview and media checks. The portal-free frontend was swapped last, without restarting the new GNOME session. Live Tailnet Chromium then confirmed frames, exact cursor image/hotspot, real click+drag+Meta and mobile pan with zero logged browser errors; the upper-right screenshot band had zero orange share-indicator pixels. Backend/controller/frontend remained healthy, saved counts were **1/6/1/11**, and only loopback plus Tailnet IPv4 bound TCP19090. The owner still needs to judge their own device's feel; the measured JPEG latency does not establish a speed gain. Do not remove the restricted backups/rollback images without owner approval; never silently switch to a public bind. A post-rollout audit found **old live gateway/media sidecars** had inherited `com.docker.compose.project` labels from shared images built under earlier disposable test projects, even though their authoritative `swarm.ng.namespace` is `agent-swarm-ng`. Direct-build the shared egress/media image tags (now clean), and the controller refuses such image metadata on future child creation. Test cleanup checks for foreign managed namespaces before `compose down`; never delete a live sidecar based only on its inherited Compose-project label. Replacing the already-running gateway to remove its historical label would stop the desktop under the controller's filtered-egress recovery rule; coordinate that separate maintenance rather than doing it as cosmetic cleanup.

The later owner-approved **GPU/DPI X11 replacement** retained the same Workspace UUID and named home/workspace volumes. This time the owner explicitly waived a new backup; that waiver is not a standing policy for future restarts. The old desktop/controller image tags were retained locally. The operator's ignored, mode-0600 project `.env` now fixes `COMPUTER_RENDER_DEVICE=/dev/dri/renderD128`, while the new X11 image locks Selkies to DPI96. Do not omit that Compose setting during future controller recreation: a mismatch intentionally stops the owned desktop rather than leaving a revoked device grant running. A disposable old-X11/no-GPU→GPU/DPI migration rehearsal and live DPR-1/DPR-2 Tailnet/WebGL checks passed; the same guest still streams **CPU JPEG** at a 120-fps target, not a proven sustained 120. See [Computers](computers.md) for precise acceptance and the insecure-origin HEVC/AV1 limitation.

Development bind-mounts source and Prisma files. Generate the client after schema changes; rebuild images after dependency changes and before production deployment. File watching through Docker Desktop bind mounts may need platform-specific tuning.

Caddy serves the built frontend and proxies `/api` in production. Local HTTPS uses Caddy’s local CA, which your browser will not trust automatically. Trust its certificate explicitly for local PWA testing, or use localhost development without HTTPS. Do not bypass certificate errors as a production setup.

Ports bind to loopback by default. `.env.example` documents the settings; authentication is not implemented, so **do not expose this scaffold publicly**. Public-domain HTTPS configuration and access control must be completed before external deployment.

The backend exposes typed computer-management routes but **does not** mount the Docker socket. An internal-only `computer-controller` service has the socket and no app `.local` or provider credential mount; it accepts only fixed-template, label-checked lifecycle requests. Platform Compose does not automatically build the managed computer/egress/media images: build the `computer-image`, `computer-egress-image` and `computer-media-image` profile services before the production frontend and before creating computers. The standalone workspace Compose file below still idles without desktop startup. The managed runtime boots GNOME/PipeWire, passwordless sudo and, in the stage-2 image, Selkies H.264/WebCodecs or opt-in JPEG HTTP behind the isolated media relay; see [Computers](computers.md) for its isolation and E2E checks.

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

The standalone default process runs as `ubuntu`, with `/home/ubuntu` as its home and `/workspace` as its working directory. The managed-computer controller instead starts a mapped-root bootstrap and drops into the Ubuntu user's headless GNOME session. No agent harnesses or credentials are installed. Use the same Compose project name to reconnect replacement containers to their data; use a different name for a separate environment:

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

The standalone workspace image still idles without starting GNOME. The separate managed-computer startup runs headless GNOME/PipeWire; sparse JPEG previews and stage-2 interactive Selkies video/control passed isolated development E2E. The Tailnet deployment now serves portal-free GNOME/X11 HTTP/JPEG on TCP19090 after the existing computer's image was migrated with its named volumes preserved. A sandboxed live Tailnet browser verified visible decoded frames, mouse drag and keyboard without a GNOME consent prompt; owner-device behavior remains for the human to confirm. Temporary noVNC files under ignored `.scratch/` remain old local experiments, not a supported startup path. The compositor test uses a non-root user, software rendering, and D-Bus readiness checks. Mount a fresh `/run` tmpfs: package installation leaves systemd seat directories in the image, which otherwise cause GNOME to expect a running systemd-logind service.

Desktop resolution is fixed at 1920x1080, independent of browser viewport size. The compositor smoke test alone does not establish hardware encoding, 120 fps, streaming, or a complete desktop session. Managed-runtime probes additionally verified a PipeWire screenshot and noVNC-free preview; optional-service warnings remain. The interactive viewer opens directly into the deployed Tailnet X11/JPEG desktop, without the former portal-consent toggle. No lower-latency claim is made for JPEG on this host.
