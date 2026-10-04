# Development

## Architecture

### Stack

- **Frontend:** TypeScript, React + Vite, shadcn/ui + Tailwind CSS, React Router, and TanStack Query. Kibo UI is configured as an on-demand component registry.
- **Backend:** TypeScript, Bun + Fastify.
- **API contract:** TypeBox + `@fastify/swagger`; generated client types with `openapi-typescript` and requests through `openapi-fetch`.
- **PWA:** `vite-plugin-pwa`.
- **Docker integration:** a separate, narrow Bun controller uses the Docker Engine Unix-socket API; the chat/backend process never mounts the Docker socket.
- **Testing:** Vitest for unit/integration tests; Playwright for essential browser workflows. On the Windows development host, follow the [browser launch safety rules](#windows-browser-launch-safety) to avoid account lockout.
- **Deployment:** Docker Compose with development overrides; Caddy for production HTTPS and reverse proxying.
- **Interactive desktop streaming:** pinned Selkies H.264/WebCodecs requires HTTPS outside localhost; an operator-built JPEG/createImageBitmap mode also passed isolated real video/input tests over non-localhost HTTP, suitable for a deliberately trusted private LAN or the existing encrypted Tailnet transport. Both use the dashboard's single TCP port, not WebRTC/UDP or per-computer host ports. The Radeon 680M VA-API encoder remains opt-in because x264 was lower-latency in the H.264 trial. The deployed Tailnet stack serves portal-free X11 over HTTP/JPEG and, on a self-signed HTTPS port, H.265/H.264; see [Computers](computers.md) for verification and residual risks.

Prisma + SQLite stores agents, channels, and published chat history. This single-backend setup uses WAL, indexed cursor pagination, and bounded model context; durable chat is not long-term agent memory.

### Project structure

Core layout of this `agent-swarm-ng` repository (the older v2 project is separate):

```text
agent-swarm-ng/
├── AGENTS.md
├── README.md
├── compose.yaml
├── compose.dev.yaml
├── frontend/
│   ├── Dockerfile
│   └── src/
├── backend/
│   ├── Dockerfile
│   └── src/
├── computer-controller/
│   ├── Dockerfile
│   └── src/
├── templates/
│   └── default/
│       ├── template.yaml
│       ├── compose.yaml
│       └── Dockerfile
└── docs/
```

- **`frontend/`** — saved agent creation/chat with paginated history, Settings with API endpoints and ChatGPT subscription sign-in, and PWA setup. The dashboard reconnects to backend-owned runs after refresh; drafts clear, while new operator activity is durably archived with paged history. Only explicitly published agent messages enter chat. Select an agent in **Agents** to configure [agent connections](agent-communication.md) and its [animated avatar](agent-avatars.md) in one centered, width-bounded scrolling pane, without section tabs. The visible **Channels → Swarm App** controls manage mutual connections; scroll down to adjust silhouette, color, eye shape and motion variation. Agents has a visible **+** to create an agent; each agent's settings hold its name, endpoint, model and thinking level (**Model**), computers, avatar and a Delete action. **Chat** holds human DMs and the **Chat with** selector for read-only agent-to-agent history, plus searchable chats, member-selected groups, Discord-style author grouping and persisted reactions; see [Chat and groups](chat-and-groups.md).
- **`backend/`** — Pi SDK chat with channel-bound publication/history tools, read-only [Swarm Knowledge](swarm-knowledge.md) exploration, and Pi Web Access search/fetch tools, Prisma/SQLite migrations and history, endpoint preferences, and an OpenAPI contract. No implicit host file/shell access. Assigned-computer tools act only on a claimed guest desktop. Private working-session entries and operator activity persist separately from chat; interrupted runs do not replay. Includes 1.5-second message debounce and temporary-fork interruption triage for follow-ups. See [chat and storage](#pi-agents-and-channels) and [interruption assumptions](message-interruption.md).
- **`computer-controller/`** — internal Docker-socket service for constrained computer lifecycle, owned volumes, filtered egress, bounded consent previews/input and an opt-in render-node grant. The API/backend has no socket mount.
- **`templates/default/`** — Ubuntu GNOME image and standalone Compose configuration. The managed runtime boots GNOME/PipeWire, renders passive JPEG previews and serves interactive H.264 behind an isolated media relay.
- **`docs/`** — [swarm vision](vision.md), development instructions, and reference material. The [local Kibo reference entry guide](references/kibo/README.md) provides pinned source, searchable indexes, and adaptation notes.

Root Compose files run the platform; the backend requests fixed-template computer creation through an internal controller. Computer use requires an explicit per-agent assignment plus an active claim. `templates/default/compose.yaml` provides a standalone workspace with persistent home and workspace volumes. Keep tests beside their code where supported. Add no shared packages or separate services without a concrete need.

Desktop resolution is fixed at **1920×1080**; do not resize it automatically to match the browser viewport. Passive grid previews are 480×270 JPEGs requested at 2 fps (every 500 ms) per visible card, only while the card is on screen and the tab is visible. The interactive video/input path shares the dashboard's one external TCP port. Local input-to-decoded-video trials and the AMD hardware/software trade-off are documented in [Computers](computers.md); 120 fps and optical glass-to-glass latency are not promises.

### Progressive web app

Make the frontend installable with a web app manifest and icons. PWA capabilities require a secure context: production uses HTTPS; localhost is supported for development.

- Cache static application assets only; do not cache API responses or queue management actions offline.
- Show a clear disconnected state. Container operations and desktop streaming require connectivity.
- Prompt before applying updates to avoid interrupting active sessions.
- The service worker registers on page load (`frontend/src/lib/pwa.ts`), so the app installs from the sign-in screen; the update prompt shows once signed in. Icons are authored as SVG in `frontend/public/` (`icon.svg`, `icon-maskable.svg`, full-bleed with its art inside the central 80% safe zone, and `favicon.svg`, the same art as `icon.svg`); the PNGs beside them (192/512 any and maskable, 180 px opaque `apple-touch-icon.png`, `favicon-32.png`) are rendered from those (and `frontend/icons/apple-touch-icon.svg`) with headless Chromium: `node scripts/render-icons.mjs` in `frontend/` (Playwright installed). Re-render them after editing an SVG. `frontend/tests/pwa.spec.ts` builds the app, serves it with `vite preview` and checks the manifest, icons, signed-out service worker and Chromium installability.
- Push notifications are a future requirement, not part of the initial implementation. Notification triggers, permissions, and delivery infrastructure remain to be designed.

### API contract

Use a code-first OpenAPI contract, with backend schemas as the single source of truth:

- **TypeBox** defines request and response schemas for Fastify validation and response serialization.
- **`@fastify/swagger`** generates the OpenAPI specification.
- **`openapi-typescript`** generates frontend types; **`openapi-fetch`** provides the typed client.
- Regenerate types when the contract changes; CI checks for stale generated types. Do not hand-edit generated files or duplicate API interfaces.

Generated TypeScript types do not provide client-side runtime validation; add that only where needed.

## Local setup

Requires Bun 1.3.6 and Node.js 22.12+ (Vite/test tooling).

```sh
bun install --frozen-lockfile
bun run dev:backend
# In another terminal:
bun run dev:frontend
```

Open http://localhost:5173. Vite proxies `/api` to the backend on 127.0.0.1:3000.

## Dashboard locations

Stable dashboard destinations live in the URL, so a refresh or copied link can reopen them and browser Back/Forward tracks navigation:

- `/dashboard` — the [Dashboard](dashboard.md) (`/`, `/agents` and the rest below are unchanged).
- `/agents`, `/agents/:id` — agent picker (a list on phones) and selected agent's centered, width-bounded scrolling Channels/Avatar form. Older `/agents/:id/edit/avatar` and `/edit/settings/channels/...` bookmarks still open the relevant scroll section or DM transcript without restoring section tabs. Old `/agents/:id/dm/:peerId` links redirect to Chat; create/delete dialogs keep their own paths.
- `/chat`, `/chat/agents/:id`, `/chat/agents/:id/dm/:peerId`, `/chat/groups/:id` — chat list, human DM, read-only agent-peer history and group history. Group create/edit/delete dialogs use nested `/chat/groups/...` paths.
- `/computers`, `/computers/:id` — grid and human desktop viewer; create/delete dialogs use `/computers/new` and `/computers/:id/delete`. This **dashboard route is different from** the locked-down trusted Selkies iframe at `/computers/:id/desktop/`.
- `/settings`, `/settings/endpoints/new`, `/settings/endpoints/:id`, `/settings/knowledge`, `/settings/audit`, `/settings/access` — saved connections, the endpoint editor, Swarm Knowledge, the [audit log](audit-log.md) and the [access log](access-log.md). The `/` entry redirects to Agents.

Only navigation is encoded: unsaved messages, searches, API keys, provider sign-in codes, consent/confirmation text are **not** stored in URLs or restored after refresh. Operator activity is separately saved server-side and restored through bounded archive reads. IDs in a path are not access grants; the existing backend authorization checks still apply. Unknown/deleted destinations show a return path rather than selecting a different resource. Production Caddy serves dashboard paths through the SPA fallback **after** its bounded `/api/*` and `/computers/:id/desktop/*` handlers; the PWA fallback also excludes those paths.

## Checks

```sh
bun run api:generate
bun run api:check
bun run typecheck
bun run test
bun run build
# Opt-in Linux/Docker computer lifecycle + browser E2E (unique test project; cleans its own resources):
sh scripts/test-computers-dev.sh
# Opt in to the single validated render node for that gate (off by default, so the
# disposable controller and its host-side device assertions always agree):
TEST_RENDER_DEVICE=/dev/dri/renderD128 sh scripts/test-computers-dev.sh
# Xorg dummy 120 Hz variant of the portal-free gate (builds its own X11 base tag):
TEST_DISPLAY_SERVER=xorg120 TEST_RENDER_DEVICE=/dev/dri/renderD128 sh scripts/test-computers-x11-dev.sh
```

API generation does not require a running server. Commit both `backend/openapi.json` and `frontend/src/api/schema.d.ts` when the contract changes. CI checks generated files for drift.

For browser tests (Git Bash/Linux), read the [Windows launch precautions](#windows-browser-launch-safety) first when running on the Windows host:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.scratch/ms-playwright"
(cd frontend && bun x playwright install chromium)
bun run test:e2e
```

Disposable development experiments, inspected external checkouts, and test outputs belong under ignored `.scratch/`; persistent app data and credentials stay in `.local/`. Playwright starts its own backend and frontend; stop existing instances on ports 3000 and 5173 first. Browser tests cover rendering, transitions, saved-history restoration/pagination, and Settings with mocked API/provider and ChatGPT device-login results. `tests/pwa.spec.ts` checks the production build's manifest, icons, signed-out service-worker registration, offline shell and Chromium installability (it builds into `.scratch/pwa-dist` and serves it on port 4317); real-device install (Android, iOS) and the update prompt still need production-browser validation.

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

Saved endpoints rest collapsed as a one-line summary (type, base URL, whether a key is saved); **Edit** expands the form with a height transition, **Done** folds it (it reads **Cancel** and reverts when there are unsaved edits), and a successful save folds it again. New endpoints and ones opened by link start expanded. Use **Save endpoint** to persist its name, URL, and key on the backend. Local development stores these in Git-ignored `.local/endpoints.json`; Docker uses the `platform_data` volume at `/app/.local`. The file contains plaintext keys with restrictive file permissions where supported; this is not an encrypted vault, and Windows access depends on the containing folder's ACL. Do not share or back up the file casually. It is excluded from Docker build contexts. The API returns only a `hasApiKey` flag, never the saved key. A blank replacement preserves a saved key; **Clear saved key** followed by Save removes it. Changing the URL clears the old key unless a replacement is supplied.

Unsaved edits still disappear on refresh. Keys are not stored in browser storage. Keys travel to the backend and the explicitly chosen endpoint; use HTTPS for remote providers. Localhost addresses refer to the **backend's** network namespace, including when it runs in Docker.

The test has a 10-second timeout, rejects redirects and URLs containing credentials/query parameters/fragments, bounds responses to 1 MiB (4 MiB for the canonical OpenRouter catalog) and 1,000 model entries, and does not return raw provider errors. Local/private endpoints are intentionally supported, so this route (signed-in only, [login](login.md)) can reach the backend's network: whoever can sign in can probe it.

## OpenRouter connection

Choose **Settings → Add OpenRouter**, enter your OpenRouter API key, then **Save endpoint**. The preset uses `https://openrouter.ai/api/v1`; an existing endpoint with that exact origin/path is also recognized. **Test connection** lists tool-capable text models (including vision models) without inference; listing is not proof of credits or access to every model. Create an agent using the saved OpenRouter endpoint and its slash-qualified model ID, then select a supported thinking level. OpenRouter inference uses API credits, separate from ChatGPT subscription access. No key is bundled and no existing agent is switched automatically.

The runtime uses Pi's native OpenRouter model identity and adapters: Anthropic Messages for Pi's known Claude models, Chat Completions with OpenRouter reasoning formatting for other models. Known Pi metadata preserves native thinking maps/protocol compatibility; successful model-list reads refresh bounded vision/reasoning/context/pricing metadata in a five-minute in-memory cache. Newer models absent from Pi's registry can load the public catalog and use Chat Completions. Unknown models with unavailable/invalid metadata fail clearly instead of inventing vision or reasoning support. Output remains capped at 4,096 tokens per request (or the model's lower limit). Advertised capability/price metadata is not a guarantee of model behavior, provider routing, availability or final billing.

Keys use the existing restrictive backend endpoint file, not browser storage or developer environment variables. Missing keys fail rather than falling back to Codex or another provider. Inference is restricted to OpenRouter's exact endpoint paths, with redirects rejected (the native Anthropic adapter's fixed `beta=true` query is allowed). Catalog metadata is untrusted data, never instructions. Only explicitly granted tools run and only channel-tool publications become chat. Mock-provider tests cover both native protocols, credentials, reasoning and publication; paid live model testing requires the operator's key and is not implied by those checks.

## ChatGPT subscription connection

In **Settings → OpenAI Codex**, choose **Connect ChatGPT**, open the OpenAI sign-in link, and enter the displayed one-time code. Enable **device code login** in ChatGPT's security settings if required. Settings polls until login completes; you can cancel or disconnect there. Login expires after 15 minutes. This device flow works with both the local backend and Docker without forwarding an OAuth callback port.

Once connected, select **OpenAI Codex (ChatGPT)** in the new-agent form, then a model and thinking level. Pi's native `openai-codex` OAuth provider and Codex Responses transport use the subscription—not the separately billed OpenAI API endpoint. Model names and thinking capabilities come from Pi's live provider catalog, with the bundled catalog as fallback. Connected status/model-selection/inference-admission requests refresh the Codex catalog automatically when its five-minute cache expires; refreshes are coalesced, limited to five seconds, and scoped to `openai-codex`. Failures retain the last known catalog and back off for one minute. The SDK persists metadata in ignored `.local/openai-models.json`, separately from credentials. This is Pi's supported catalog service, not a direct OpenAI `/models` entitlement check; actual account access and usage limits are enforced by OpenAI. Agents share the account's allowance. There is no automatic paid-API fallback. Existing local-model agents are unchanged.

Tokens are held only by the backend in ignored `.local/openai-auth.json` (alongside the configured SQLite file), with Pi's locked token refresh and restrictive file permissions where supported. The UI gets connection metadata and a temporary device code, never access/refresh tokens. Disconnect removes the local credential; already running requests may finish. This is provider sign-in, separate from the dashboard [sign-in](login.md). Pi provides this third-party integration; it is not a promise of a stable public subscription API. See [OpenAI authentication](https://developers.openai.com/codex/auth).

## Pi agents and channels

Create an agent from the agent panel's context menu, then choose a saved endpoint or connected ChatGPT provider, model, and supported thinking level. Agents and published history survive refresh and backend restart. The dashboard displays only saved agents; an empty database starts with an empty agent list. Sample agents exist only in browser-test API fixtures, not in the app or database. Previously browser-only chats are not imported automatically.

Pi SDK 0.85.1 uses OpenAI-compatible Chat Completions for generic API endpoints, native OpenRouter adapters for its canonical endpoint, or native Codex Responses for the connected ChatGPT subscription, with explicitly granted **`send_message`**, **`read_messages`**, and **`search_messages`**, bound to the current platform-chat channel, plus four web tools from **[Pi Web Access](https://github.com/nicobailon/pi-web-access) 0.30.0**: `web_search`, `source_check`, `fetch_content`, and `get_search_content`. Default coding tools, Pi resource discovery, skills, prompt expansion, global settings, and inherited credentials remain disabled. A first-party [Swarm Knowledge](swarm-knowledge.md) plugin explicitly grants `list_knowledge`, `search_knowledge`, and `read_knowledge` to every normal agent turn; each call rechecks the agent's current existence. Those read-only reference tools provide no host/file/computer access. Separate [computer-use tools](agent-computer-use.md) list/claim explicitly assigned guest desktops, capture screenshots and run bounded input combos; the current assignment, claim and fresh-look allowance are enforced on execution. The custom `read`, `edit`, `write`, and synchronous `bash` tools also require that current computer claim and execute inside its guest account, never on the platform host. Synchronous commands use a private PID/mount namespace and bounded supervision. Separate [persistent tmux terminal tools](persistent-terminals.md) permit guest programs to outlive a call/turn/release; they reuse execution-time authorization but intentionally do not use that synchronous PID namespace. No background-job scheduler is added; every agent also gets `current_time`, `set_timer`, `set_reminder`, `list_timers` and `cancel_timer` ([agent time](agent-time.md)), whose firings wake it with platform events. See [guest file/shell semantics](agent-computer-use.md#guest-file-and-shell-tools). Endpoint keys are literal values, never Pi's command/environment configuration syntax.

Agent communication grants also include `search_emojis` (bounded local emoji name/keyword search plus the agent's four saved recent choices), `read_reactions`, and `react_to_message`. [Message replies](message-replies.md) add an optional, server-validated same-conversation target to `send_message`/`send_dm`; bounded history and incoming context show its author/excerpt without granting another channel. A new human-added reaction is offered to a bounded, decision-only branch before any normal agent turn; see [reaction delivery and picker behavior](chat-and-groups.md#reaction-context-menu). These grants do not add shell, computer, or operator administration access.

Web search uses keyless Exa MCP; queries go to Exa and public-page fetches contact their target websites. A dedicated Bun subprocess per turn keeps the extension's global configuration/result caches separate. It receives a minimal environment and generated configuration, not developer Pi settings, browser cookies, or endpoint credentials. Only public HTTP(S) readable/raw fetches are granted; the extension's private-network/redirect protections remain enabled. Local files, repository cloning, interactive browser workflows, extra model calls, and caller-supplied auth/proxies are disabled. Result IDs are turn-local; temporary files under `.local/web-turns` are removed on normal cleanup (a backend crash may leave leftovers). This is process/configuration isolation, not an OS sandbox. Web tools grant no computer, shell or interactive-browser capability; assigned desktop control uses the separate computer-use plugin.

Use **Delete agent** at the bottom of the agent's settings, or right-click an agent in the list. The confirmation dialog requires its exact name (case and whitespace included); the backend checks it again. Deleting an agent permanently removes its channels and chat messages, but not shared provider connections. An active turn blocks deletion: stop it and wait before retrying. Local drafts, activity, and cached history are cleared when deletion succeeds.

Incoming user context includes a compact channel/message/timestamp header. The system prompt puts delivery first: acknowledge actionable tasks through `send_message` with `final:false` before planning or using tools, then consult relevant Swarm Knowledge before substantive work when it has not already been read in retained context; publish the actual result with `final:true` (the default, which ends the turn). The Knowledge check is model guidance, not an enforced once-only read ledger. Simple questions should receive a direct answer without an extra acknowledgment. Substantial answers should be chat-sized: lead with the takeaway, split by topic into a few focused messages (normally 1–3 short paragraphs or a compact list each), and await each publication. Intermediate answer parts use `final:false`; only the last uses `final:true`. Keep tables/code/quotations intact, citations and caveats near their claims, and short answers in one bubble; honor requests for one consolidated response. There is no automatic character-based splitting. This guides model behavior; it does not guarantee response latency or model compliance.

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

See the [activity capture and inspector reference](agent-activity.md) for the event coverage, main/fork separation, safe diagnostics, state labels, bounded expansion, image handling and unrecoverable historical/provider/tool limits.

The activity header shows the **latest main-session context estimate**: tokens / configured context window and percentage. One updatable **Context usage** activity entry per run includes the explanatory notes. It refreshes at message boundaries and after each request batch, not on every streamed token. This uses Pi's `getContextUsage()` (latest valid provider usage plus estimated trailing messages). When the provider supplies no usage, the message-based estimate can omit system-prompt/tool-schema overhead. Unknown values are not displayed as zero; unknown model capacities use the runtime's configured fallback window, not a discovered endpoint limit. It is not cumulative billing and excludes temporary triage forks. Context metrics are saved with activity and restored after refresh; they remain an estimate at that historical boundary, not a new measurement.

**Agent activity** is a separate durable operator archive for new provider-exposed thinking/output, tools, reminders, publications, and backend run status/errors. It records while the dashboard is closed and restores across refresh/backend restart, with indexed 30-entry pages, bounded 6,000-byte UTF-8 text fragments and stable revisions for live/snapshot reconciliation. Text history has no age/count expiry. Coalesced writes precede live activity delivery; a sudden crash can lose not-yet-committed deltas, but interrupted runs are labelled without replay. No hidden provider reasoning or already-discarded historical traces are reconstructed. Browser-only request errors are visibly labelled ephemeral Dashboard request alerts. Recorded screenshot metadata can open an image while it remains in the separate 50-MB disk pool; expired images do not erase their text entry. Typing starts when streamed metadata identifies `send_message`; draft arguments stay out of the channel. Green avatar dots indicate readiness, not monitored endpoint uptime. Active requests turn the badge into an aqua opacity-pulsing dot with the same dimensions as idle green; typing takes priority with the aqua three-dot pill. Completion restores the static green dot. Reduced motion disables the pulse, and hidden tabs pause it. Agent avatars separately use seeded outline movement, blinks and glances; creation and the inline **Agents → Avatar** section share the saved appearance editor. See [agent avatars](agent-avatars.md). Both agents shown in a peer-chat header have live status indicators. Received peer messages are source-labelled bubbles, not fabricated replies to the human, and remain silent. **Agents → Channels → Swarm App** displays mutual-connection controls inline above the Avatar section. **Chat with** defaults to **You** and switches the main history to the selected peer; only agent choices have avatars. The selected agent stays left, with sender-tinted bubbles in peer mode. See [agent communication](agent-communication.md) for scoped tools, shared chain limits, queueing, and restart/cancellation semantics.

New tool-published agent messages play `frontend/public/sounds/aqua-drop.mp3` once per new message ID. User messages, typing, internal activity, duplicate deliveries, and restored history are silent. Browser audio is enabled by the first pointer/keyboard interaction; blocked or unavailable audio never fails chat. This is an in-page sound, not an OS/push notification. The owner-provided bottle clip was formatted with FFmpeg (`loudnorm=I=-20:TP=-3:LRA=7`, mono, 44.1 kHz, 96 kb/s MP3, metadata removed); the ~0.82-second asset is precached with the app.

Chat and compact card previews share Markdown parsing, including formatting, lists, quotes, tables, code, and spoilers. Chat code blocks have highlighting/copy controls; previews remain non-interactive and hide spoilers. Raw HTML is disabled, unsafe link protocols are rejected, and remote images are links rather than automatic third-party requests. Stored text and the composer are unchanged; this is not a complete Discord syntax implementation.

Thinking-level controls use provider-specific Pi metadata (plus bounded OpenRouter catalog capabilities). Generic OpenAI-compatible endpoints use known OpenAI metadata and standard `reasoning_effort`; unknown support is disabled rather than guessed. Listing `/models` does not guarantee tool-calling behavior. Local OpenAI-compatible fixtures and a user-authorized Qwen endpoint have been tested; OpenRouter has mocked native-protocol coverage and public-catalog validation, with live paid model testing left to the operator.

## Platform storage

- **Prisma 7.9.1 + SQLite:** identities, channels, user/tool-published messages, same-conversation reply references, reactions, agent-specific recent emoji choices, private indexed Pi session entries/checkpoints, the [Dashboard](dashboard.md)'s resource samples, model usage and run spans, the [audit](audit-log.md) and [access](access-log.md) logs, known addresses, the lockdown and critical-event banners in ignored `.local/platform.db`. Bun uses the libSQL adapter; no separate database service is needed.
- **Provider credentials:** API endpoint keys remain in `.local/endpoints.json`; ChatGPT OAuth credentials use `.local/openai-auth.json`. Neither is copied into chat records or returned by the API.
- **Operator activity:** private, indexed SQLite records, separate from channel messages and model working context. New text entries are retained, with paged/fragmented APIs and delete-agent cascade. Screenshot copies live only in the separately capped `.local/computer-screenshots` pool; exclude that pool from backups to avoid retaining evicted images.
- **Ephemeral:** drafts, typing, and the active provider stream. Private completed Pi working context survives restarts in the database; no Pi JSONL sessions are written. Those private records can include provider-exposed reasoning and tool results, so the whole database and its backups are sensitive even though internal entries never become chat/API history. External providers may retain inference requests according to their policies.
- **Docker:** both backend targets run as `bun`. Default Compose uses `platform_data` at `/app/.local`; the Tailnet override bind-mounts the existing project `.local` there instead. Replacing a container preserves data; deleting the default Compose volume is destructive.

Backend startup applies committed migrations with `prisma migrate deploy`; development also generates the client. Apply new migrations with the backend stopped: a live libSQL connection on Windows can cause Prisma's migration engine to report `database is locked`. Coordinate a restart rather than interrupting active runs or forcing the lock. `bun run api:generate`, `bun run typecheck`, and `bun run test` generate it as needed. Generated client files, database files, and WAL/SHM files are not committed. Unit tests use isolated databases and remove them after workers exit, including on Windows.

```sh
bun run --cwd backend db:generate
bun run --cwd backend db:deploy
# For an intentional schema change, from backend/:
bun node_modules/prisma/build/index.js migrate dev --name describe_change
bun run db:generate
```

`DATABASE_URL` optionally overrides the local SQLite file. Relative paths resolve from the backend working directory; use container paths under `/app/.local` for Compose. Saved endpoint API keys (`endpoints.json`) live beside that file, so a temporary `DATABASE_URL` also isolates them. The Playwright configuration starts its backend on a throwaway data directory with no computer controller. Do not use a network share or multiple backend processes with this implementation.

**Host allowlist.** Besides the sign-in ([login](login.md)), the backend refuses requests (and WebSocket upgrades) whose `Host` is not an IP address, `localhost`, or a name listed in `ALLOWED_HOSTS` (comma-separated). This blocks DNS-rebinding pages from driving the dashboard. If you browse by a DNS or MagicDNS name, set `ALLOWED_HOSTS` (Compose passes it to the backend).

**Run deadlines.** Private and group messages from the human follow `AGENT_RUN_TIMEOUT_MS` (0 = no deadline). Agent-to-agent DM and group work started by another agent keeps a safety deadline of 90 seconds of execution and five minutes in the queue, to bound reply loops.

**Browser tests on Linux.** Chromium's system libraries may be missing on the host. Install the matching browser with `bun x playwright install chromium` under `PLAYWRIGHT_BROWSERS_PATH="$PWD/.scratch/ms-playwright"`, then run the suite inside `mcr.microsoft.com/playwright:v<version>-noble` with the repository mounted, `--network host`, `--user 1000:1000` and Bun mounted from the host.

WAL mode, a five-second busy timeout, foreign keys, and the `(channelId, sequence)` index support short writes and cursor pagination. Messages load 50 at a time (API maximum 100); agent lists load up to 100 at a time. In the dashboard, older pages load automatically as the reader scrolls near the top (and while a short history does not yet fill the view), with bubble skeletons at the edge; a keyboard-reachable **Load earlier messages** remains. Private and group chats render a bounded window of at most 150 messages (`useMessageWindow`): scrolling up reveals older ones and drops the newest from the page, scrolling down does the reverse, and **Jump to latest** returns to the newest. Messages stay in memory (no refetch); the first visible message keeps its screen position across every change. Card previews use indexed latest-message lookups, never full conversation loads. SQLite still serializes writers; Prisma does not remove that limit or make a future Postgres/data migration automatic.

Storage is plaintext, not an encrypted vault. Restrictive permissions are used where supported; Windows access depends on folder ACLs. The backend also keeps daily database copies ([production](#production)). For a full consistent backup, stop the backend and copy the entire `.local` directory or snapshot `platform_data`, including any WAL files and endpoint preferences. Do not copy only the main database while it is running. Protect backups as sensitive data.

The dashboard has one sign-in account ([login](login.md)); per-user permissions and multi-host coordination remain unimplemented. Persistent IDs are not authorization tokens.

## Docker Compose

Requires Docker with Compose 2.24.4+ (`!override` support).

```sh
# Development: http://localhost:5173
docker compose -f compose.yaml -f compose.dev.yaml up --build

# Production-style local build: https://localhost
docker compose up --build -d
```

The **historical stage-1** Tailnet instance used `compose.tailscale.yaml`: it bind-mounts project-local `.local` and serves HTTP only on loopback and the explicitly chosen Tailscale IPv4 address, TCP 19090. Do **not** deploy the stage-2 H.264/WebCodecs viewer with only that HTTP overlay: remote non-localhost HTTP is not a browser secure context. One stage-2 option adds `compose.tailscale-https.yaml`, a trusted certificate/key for the exact Tailnet DNS name under `.local/certs/` (0700 directory, 0600 key), and `TAILSCALE_DNS_NAME`. Tailscale currently denies certificate issuance for this account; enabling HTTPS certificates in Tailscale Admin Console → DNS publishes the machine/tailnet name in Certificate Transparency. Never use a browser certificate/security bypass. This overlay retains only loopback plus Tailnet **TCP 19090**.

If the operator wants the existing encrypted Tailnet transport without a browser-trusted certificate, **HTTP/JPEG on Tailnet** is available via `compose.yaml` + `compose.tailscale.yaml` + `compose.tailscale-http-jpeg.yaml`. The last overlay builds/selects `agent-swarm-default:http-jpeg`; it keeps the same `.local` mount and publishes only loopback and the chosen Tailnet IPv4 on TCP 19090. Tailscale protects device-to-device packets, but HTTP is still an insecure browser origin, so the verified `createImageBitmap` JPEG decoder is used instead of WebCodecs. Any peer allowed to reach the Tailnet address reaches the sign-in page; the dashboard needs the Admin password ([login](login.md)). This original Wayland/JPEG overlay alone retains GNOME portal consent and is now a rollback option; the deployed fourth X11 overlay below bypasses it.

The **deployed portal-free Tailnet HTTP/JPEG variant** adds `compose.tailscale-http-jpeg-x11.yaml` after the three existing Tailnet HTTP/JPEG files. Build the Stage2 and JPEG base images, egress/media and the distinct X11 image **with direct `docker build` commands** in that order before building the frontend; its Vite build flag hides the obsolete GNOME permission preview only in this selected mode. The distinct `agent-swarm-default:http-jpeg-x11` image retains Ubuntu GNOME but runs it on a container-local Xvfb X11 display; Selkies captures/injects input via X11 instead of GNOME's permission portal. The guest already has passwordless sudo, but this path does not request a host input device or Docker access. Isolated and live Tailnet browser E2E verified real GNOME video, cursor, mouse drag and keyboard with no portal click or sharing indicator; measured JPEG latency was not meaningfully lower. X11 loses Wayland's isolation between applications inside the already sudo-capable guest. Anyone signed in to the dashboard controls it without a second GNOME consent gate; explicitly accept that access scope and coordinate a volume-preserving restart of any running Wayland computer before migration. The opt-in reproducible gate is `sh scripts/test-computers-x11-dev.sh`; it uses only a uniquely labelled disposable project and one Linux browser worker, never `.local` or the owner's browser profile.

A separate **operator-opt-in private-LAN HTTP/JPEG** option uses `compose.lan-http.yaml`: an explicitly selected `LAN_IP` publishes only that trusted LAN IPv4 plus loopback on TCP 19090; its distinct `agent-swarm-default:http-jpeg` image locks Selkies to JPEG, decoded with browser `createImageBitmap` rather than WebCodecs. It does not require Tailnet or a browser security flag. The browser client contains a SHA-checked, frontend-only adaptation of the pinned Selkies core; guest sudo still cannot edit executable frontend bytes. Real video and pointer/keyboard input passed an isolated browser test at an insecure remote HTTP origin, but LAN deployment and phone behavior were not verified. **HTTP sends desktop video, input, management APIs, the sign-in password and session cookie in plaintext to anyone able to observe that LAN.** Do not set `LAN_IP=0.0.0.0` or expose a public interface without an explicit access policy and owner decision. Build shared images **directly** before the frontend: `docker build -t agent-swarm-default:stage2 templates/default`, `docker build -t agent-swarm-default:http-jpeg --build-arg COMPUTER_STREAM_ENCODER=jpeg templates/default`, `docker build -t agent-swarm-computer-egress:dev -f templates/default/egress.Dockerfile templates/default`, and `docker build -t agent-swarm-computer-media:stage2 -f templates/default/media.Dockerfile templates/default`. Never bake disposable Compose-project labels into those shared tags. This is not permission to interrupt an existing computer or skip the backup/authorization gates.

**Stacks.** `scripts/compose.sh --list` names each supported deployment (`local`, `dev`, `lan-http`, `tailnet-jpeg`, `tailnet-x11`, `tailnet-xorg120`, `tailnet-dual`, `tailnet-https`) and `scripts/compose.sh <stack> up -d` applies the right Compose files in the right order. `dev` prepares the Selkies client if `.scratch/selkies-client-web` is missing. CI validates every stack.

**Required secret and hardening options** (all in `.env.example`). `COMPUTER_CONTROLLER_TOKEN` is required: the controller holds the Docker socket, so without a shared secret it answers only its health check, and Compose refuses to start (disposable test stacks generate their own). Dev servers (`bun run dev:backend`, `bun run dev:frontend`) listen on 127.0.0.1 only and Vite refuses `.local`, `.scratch`, keys and databases: never make them reachable from other machines. `DASHBOARD_EXTRA_DISKS` lists more host paths for the [Dashboard](dashboard.md) disk charts; the `host-net` service (busybox, host network, no privileges) feeds the Dashboard's network figures; `ACTIVITY_RETENTION_DAYS` prunes operator activity and leaves a "History pruned" marker; `COMPUTER_VIEWER=off` builds the dashboard without the desktop viewer so no desktop image is needed (use `docker compose build`; the host `docker build` needs buildx). Caddy sends `X-Frame-Options`, `Referrer-Policy`, `nosniff`, and a CSP with `frame-ancestors 'self'` on every route plus a baseline CSP on the application pages, so another site cannot frame the dashboard.

Before any live restart, check `/api/events` for active runs; stopping the sole backend cancels in-progress inference. Build the fixed stage-2 computer/egress/media images **before** the production frontend, since it copies the pinned Selkies browser client from the computer image. Stop the backend for a consistent restricted `.local` backup including WAL and credentials, then build/smoke-test new images using disposable data before replacing live containers. Existing stage-1 computers are **not** upgraded by merely replacing the controller image: coordinate a non-destructive, volume-preserving container migration and the loss of current desktop processes with the owner. Verify either a real HTTPS certificate or the deliberately selected Tailnet/private-LAN HTTP/JPEG mode, plus preserved counts, correct encoder, same-port routing and bind addresses after deployment. Never delete user home/workspace volumes as an upgrade shortcut. Rollout records from earlier migrations are in [history](history.md).

Provision the **opt-in self-signed HTTPS listener** with `sh scripts/make-self-signed-cert.sh` (refuses to overwrite an existing certificate), then add `compose.tailscale-https-19091.yaml` after the five Tailnet HTTP/JPEG/Xorg120 files and start with `TAILSCALE_IP` set. It serves the same dashboard on loopback plus the Tailnet IPv4 over TCP 19090 (HTTP) and 19091 (HTTPS), with no UDP, public bind or per-computer port. The certificate is untrusted by design: the operator accepts the browser warning once, and its only effect is a secure context for WebCodecs. Building the optional H.264 desktop variant is `docker build -t agent-swarm-default:h264-x11 --build-arg COMPUTER_STREAM_BASE=agent-swarm-default:stage2 -f templates/default/x11.Dockerfile .` followed by `docker build -t agent-swarm-default:h264-xorg120 --build-arg COMPUTER_X11_BASE=agent-swarm-default:h264-x11 -f templates/default/xorg120.Dockerfile .`; the separate `h264-xorg120` image remains optional; the deployed `http-jpeg-xorg120` image now publishes the full encoder menu (operator default first) and the reviewed client patch transmits the secure origin's H.264 request, so one JPEG-default image serves both listeners.

The **earlier H.264-default desktop**, retained as a rollback image, builds from `stage2` (whose `COMPUTER_STREAM_ENCODER` build arg defaults to `h264enc`): `docker build -t agent-swarm-default:h264-x11 --build-arg COMPUTER_STREAM_BASE=agent-swarm-default:stage2 -f templates/default/x11.Dockerfile .` then `docker build -t agent-swarm-default:h264-xorg120 --build-arg COMPUTER_X11_BASE=agent-swarm-default:h264-x11 -f templates/default/xorg120.Dockerfile .`, while the current `compose.tailscale-https-19091.yaml` selects the direct-built `agent-swarm-default:h265-xorg120` for **new** computers (see [codec rollout](computers.md)); existing desktops keep their original image until explicitly replaced. The guest launcher's encoder default is separate from the image arg, so change both together; the JPEG image remains available as `agent-swarm-default:jpeg-fallback-20260926`, and software AV1 (SVT-AV1; this GPU only decodes AV1) as `agent-swarm-default:av1-xorg120` if the owner later prefers bandwidth over CPU.

Managed desktop clocks come from the per-computer timezone selected in the create dialog (defaulting to the operator's `COMPUTER_TIMEZONE`, an IANA zone such as `America/Toronto`), never from the host; see [guest clock](computers.md). Set the operator default in the project `.env` and restart the controller to change future suggestions; already-created computers keep their saved timezone. CPU and RAM choices are persisted per computer and can be updated live through Settings. To change timezone, power off that computer, explicitly confirm replacement in Settings, then power it on: the controller keeps its named volumes/UUID and does not silently restart an active desktop. A manual `/etc/localtime` relink is not a durable substitute: the container's immutable `TZ` environment and saved platform setting would still disagree.

For the separate **opt-in Xorg dummy 120-Hz mode**, direct-build the approved existing X11 base image first, then `docker build -f templates/default/xorg120.Dockerfile -t agent-swarm-default:http-jpeg-xorg120 .`. Add `compose.tailscale-http-jpeg-xorg120.yaml` **last**, after all four current Tailnet/X11 overlays; never switch a running computer merely by changing Compose. Its single reduced-blanking RandR mode advertises 1920×1080@120 to GNOME, on an Xorg server with `-nolisten tcp`; the browser still receives JPEG over the same TCP19090 and the operator's GPU/DPI lock remains. The overlay selects an operator-bounded four-CPU guest quota on this host; a default X11 computer elsewhere remains at two CPUs. An isolated mode/performance and full GPU/input/DPR-2 browser gate passed, but only **small changing content** reached roughly120 decoder-worker composites per second—large motion stayed lower, and actual physical-client refresh is unmeasured. On 2026-09-25 the owner authorized this change: after a fresh run/ownership/volume/bind preflight, the backend was stopped for **new** mode-0600 `.local` and both named-volume archives (the previous no-backup waiver covered only the earlier GPU/DPI restart), old desktop/controller image tags were retained, and only the controller plus this owned desktop were replaced. The stale owned media relay was recreated; backend/frontend/egress, UUID and both volumes were preserved, and the stopped rollback container was removed without `-v` after the new preview passed. Live measurement after rollout showed the server encoding about 110–120 fps under continuous guest animation, with worker-presented medians near 129 composites/s and occasional server-side `throttled=true` bursts at ~155–168 Mbps. Do not describe this as universal 120-fps delivery, an optical latency gain, or a codec change.

Development bind-mounts source and Prisma files. Generate the client after schema changes; rebuild images after dependency changes and before production deployment. File watching through Docker Desktop bind mounts may need platform-specific tuning.

Caddy serves the built frontend and proxies `/api` in production. Local HTTPS uses Caddy’s local CA, which your browser will not trust automatically. Trust its certificate explicitly for local PWA testing, or use localhost development without HTTPS. Do not bypass certificate errors as a production setup.

Ports bind to loopback by default. `.env.example` documents the settings. The dashboard needs the Admin sign-in ([login](login.md)); for a public domain, put a reverse proxy on the LAN or tailnet in front of the HTTPS port rather than publishing the dashboard's ports ([README](../README.md#reaching-it-from-a-public-domain)).

The backend exposes typed computer-management routes but **does not** mount the Docker socket. An internal-only `computer-controller` service has the socket and no app `.local` or provider credential mount; it accepts only fixed-template, label-checked lifecycle requests. Platform Compose does not automatically build the managed computer/egress/media images: build them with direct `docker build` commands ([README](../README.md#install), step 2) before the production frontend and before creating computers. Do not build them through Compose: its image labels would be inherited by computers, and the controller refuses such images ([Computers](computers.md#development-verification-and-cleanup)). The standalone workspace Compose file below still idles without desktop startup. The managed runtime boots GNOME/PipeWire, passwordless sudo and, in the stage-2 image, Selkies H.264/WebCodecs or opt-in JPEG HTTP behind the isolated media relay; see [Computers](computers.md) for its isolation and E2E checks.

## Production

The Compose services always run their production builds: the backend's `start` (migrations, then `bun src/index.ts` with `NODE_ENV=production`), the controller, and Caddy serving the built frontend. The dev servers are for development only and listen on 127.0.0.1. Before and after deploying:

1. **Secrets:** `.env` from `.env.example` with `COMPUTER_CONTROLLER_TOKEN` set (Compose refuses to start without it). Provider keys, tokens and the database stay in `.local/` (mode 0700/0600), never in the repository.
2. **Network:** publish only loopback and a private interface (Tailscale or a trusted LAN); never publish the dashboard's ports on a public interface. For a public domain, use a reverse proxy on the LAN or tailnet ([README](../README.md#reaching-it-from-a-public-domain)). Set `ALLOWED_HOSTS` if you browse by name.
3. **Sign-in:** open the dashboard right after the first start and set the Admin password ([login](login.md)); until then anyone who reaches it can. Add your own addresses as trusted in Settings → Security so a lockdown cannot shut you out (`scripts/unlock.ts` lifts one from the host; [login](login.md#known-addresses-and-lockdown)).
4. **Deploy:** `scripts/compose.sh <stack> build backend frontend computer-controller`, then `scripts/compose.sh <stack> up -d`. Accepted agent runs do not survive a backend restart (they stop with an incomplete status).
5. **Logs:** each service keeps at most 5 × 10 MB of Docker logs (`x-logging` in `compose.yaml`). Who did what is in Settings → Audit log, who reached the dashboard in Settings → Access log.
6. **Backups:** the backend saves one consistent copy of the database a day in `.local/backups/database/` (the newest `DATABASE_BACKUPS`, default 7). Copy `.local/` (database backups, `files/`, secrets) and each computer's Keep folder off the machine; restore by stopping the backend, deleting any `.local/platform.db-wal` and `.local/platform.db-shm`, and putting a copy back as `.local/platform.db`.
7. **Health:** `GET /api/health` (backend), the controller's `/health` and Caddy's admin API back the Compose health checks; `scripts/compose.sh <stack> ps` shows them.

## Default environment image

The image uses Ubuntu 24.04 LTS and explicitly installs the Ubuntu GNOME session (not XFCE, and not the full `ubuntu-desktop` installation), Ubuntu Dock, app indicators, Yaru themes, Ubuntu fonts, terminal, file manager, settings, and D-Bus support. Ubuntu visual defaults, Noble wallpapers, SVG icon rendering, and dock menu support are included to preserve the standard desktop appearance; “lean” means omitting extra applications, not stripping desktop assets. The image sets `LANG=C.UTF-8`, since GNOME Terminal cannot start under the plain C/ASCII locale. `--no-install-recommends` avoids pulling in the full desktop application bundle. Required transitive dependencies still install; do not remove GNOME dependencies merely because their names resemble optional apps.

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

The image includes Chrome, VS Code, Git, curl, C/C++ build tools (`gcc`/`g++`), ffmpeg, Node.js 22 with npm, Bun 1.3.6, Python 3 with venv support, uv 0.9.18, nvm 0.40.5 and the Pi CLI 0.87.1. nvm is sourced in interactive `agent` Bash shells with `--no-use`, so system Node/npm stay selected until the user explicitly calls `nvm use`/`nvm install`. Pi is installed with npm `--ignore-scripts` and has no baked-in provider credentials, sessions, global extensions or developer settings. Chrome and VS Code use their signed vendor apt repositories rather than Snap. The workspace Compose configuration enables the [Chromium-compatible seccomp profile](../templates/default/security/README.md) and `no-new-privileges`. Chrome runs as the non-root workspace user with its namespace and Seccomp-BPF sandboxes enabled; it does not use `--no-sandbox`, privileged mode, or added `SYS_ADMIN` capability. This permits namespace syscalls throughout the container, so revalidate the trade-off and host-specific restrictions on the Linux deployment target. VS Code's WSL installation prompt is suppressed because the Linux editor is intentional inside this container.

The standalone default process runs as `agent`, with `/home/agent` as its home and `/workspace` as its working directory. The managed-computer controller instead starts a mapped-root bootstrap and drops into the `agent` user's headless GNOME session. That account keeps uid/gid 1000 from Ubuntu's base `ubuntu` user, which the image renames, so an older home volume remains readable at the new mount point. Installing the optional Pi CLI inside the guest does **not** grant product agents a computer tool or implicit host access; they still start with zero tools, and a person using the guest must explicitly configure Pi authentication there if desired. No developer credentials are mounted or copied. Fresh named home volumes inherit nvm shell files from the image; an older existing home volume is not overwritten automatically. Use the same Compose project name to reconnect replacement containers to their data; use a different name for a separate environment:

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
