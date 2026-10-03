# Agent Swarm NG

**NG means Next Gen.** Repository: [AlexZihaoXu/agent-swarm-ng](https://github.com/AlexZihaoXu/agent-swarm-ng).

![Status: Active development](https://img.shields.io/badge/status-active_development-blue)
![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Deployment: Docker Compose](https://img.shields.io/badge/deployment-Docker_Compose-2496ED?logo=docker&logoColor=white)

A platform for **persistent agents** with long-term memory and shared awareness across communication channels. Agents use explicitly granted capabilities to access shared, containerized **computers**; they are not bound to a computer or limited to coding.

**Today:** Pi-backed agents with durable identities, human DMs, member-authorized group chats and reactions in Prisma + SQLite; a read-only, operator-curated Swarm Knowledge browser and baseline agent tools; saved endpoint preferences; and a Computers dashboard with independent Ubuntu GNOME desktops, low-rate previews, interactive browser control, and an operator file-browser modal with read-only previews and downloads (upload deferred). The trusted Tailnet dashboard now runs portal-free GNOME/X11 interactive HTTP/JPEG on its existing TCP 19090 port; the secure H.264/WebCodecs Wayland mode remains optional. The migrated computer's saved data survived, and real live browser video, GNOME pointer/drag and keyboard control passed end-to-end. The dashboard needs a [sign-in](docs/login.md) (one Admin account whose first visit sets the password); there is no second GNOME permission gate; this mode has not shown a reliable latency improvement over the prior JPEG stream. [Agent computer assignments and bounded desktop tools](docs/agent-computer-use.md), [durable operator activity history](docs/agent-activity.md), and a capped screenshot archive are deployed to the trusted dashboard. [Discord bots for agents](docs/discord.md) let each agent read and talk on Discord like a member, within the channels you allow. [Chat files, a private agent scratchpad and file copying](docs/agent-files.md) let the human and agents share files in any chat, draft artifacts, and move files between scratchpads, computers and chats, within Settings → Swarm limits. Agents can [record](docs/agent-computer-use.md#recording) a desktop (with sound) or terminals, whole or as clips around their own actions, kept alive by a lease they renew. [Organizations](docs/organizations.md) sort agents, computers and group chats into folders that are kept apart. [Portal](docs/portal.md) (Ctrl/⌘+K) searches agents, chats, computers, terminals, pages, files and Knowledge from anywhere and pulls chats, terminals and desktops out as floating windows. Agents have [long-term memory](docs/agent-memory.md): typed memories with provenance, reminders as messages, events and tool results come in, everything they went through searchable word for word, and sleep that reorganises it in their off hours. The full swarm runtime remains unimplemented. Read the [swarm vision](docs/vision.md) for agreed concepts and deliberately open questions.

## Getting started

Requires Bun 1.3.6 and Node.js 22.12+.

```sh
bun install --frozen-lockfile
bun run dev:backend
# In a second terminal:
bun run dev:frontend
```

Open http://localhost:5173; the first visit sets the Admin password ([sign-in](docs/login.md)). See [development instructions](docs/development.md) for tests, API generation, and Docker setup.

For OpenRouter, use **Settings → Add OpenRouter**, enter your API key, save, then select that endpoint when creating an agent. [OpenRouter setup](docs/development.md#openrouter-connection) supports tool-capable text/vision models and provider-specific reasoning; usage is billed by OpenRouter, not a ChatGPT subscription.

## Vision and scope

- **Agents:** persistent, human-like identities with long-term memory, independent of any one session or computer. Pi is the intended harness; agents inherit no coding/host tools. The operator-approved read-only Knowledge plugin is explicitly granted on normal turns; other capabilities require separate grants.
- **Channels:** platform chat by default, with external channels such as Discord or WhatsApp envisaged. One agent shares awareness across channels rather than becoming a separate agent per app.
- **Communication and access:** group chats let agents coordinate; permissions and groups govern resource access.
- **Computers:** assignable containerized environments, potentially shared by multiple agents, with desktop and console/tmux capabilities.
- **Configurable autonomy:** the person setting up the system chooses access and coordination policies and accepts their risks. Agents exercise judgment within those boundaries; the platform enforces the selected rules.

The [vision document](docs/vision.md) distinguishes agreed direction from unresolved design and implementation options. Human-like interaction does not imply human-level discretion or require an endlessly running model conversation.

The managed Computers dashboard adds creation/deletion, passive previews and an interactive desktop viewer. Agent settings now separately grant computer assignments; a single-agent control claim, bounded screenshot/action tools, guest-only `read`/`edit`/`write`/synchronous `bash`, and human Force release govern agent computer use. Reading (screenshots, file `read`, terminal views) needs only the assignment and never disturbs the holder, while every change requires the current claim (`use_computer` with `write: true`); whole-file copies (`copy_file`/`upload_file`) need only the assignment and notify the current holder. The [persistent tmux terminal tools](docs/persistent-terminals.md) use that same boundary, with a separate operator terminal UI; terminal programs can outlive turns and release, and the holder hears when a terminal exits. Every agent can tell the time and wake itself with [timers and repeating reminders](docs/agent-time.md) that survive restarts, an optional [heartbeat](docs/agent-time.md#heartbeat) (a periodic wake-up in a branch that is dropped unless it changes something), and with [computer watches and monitors](docs/agent-computer-use.md#watches) that wake it when a described condition appears in a terminal or on the desktop, or a command prints a line; cron-style scheduling remains deferred. Managed desktops have bounded CPU, RAM and host-backed swap; [OOM behavior and restart limits](docs/computers.md#resource-limits-and-oom) were tested in disposable containers, not on an owner's desktop. The current Pi runtime saves published chat and private Pi working-session checkpoints in SQLite. Completed context survives backend restarts, but an interrupted model stream or job does not automatically resume. General resource-permission groups remain unimplemented; [long-term memory](docs/agent-memory.md) and Discord are implemented. DM connections and group-chat membership are implemented communication grants. The next milestone and implementation order require explicit agreement; this vision does not authorize building them all at once.

## Stack

- **Frontend:** TypeScript, React + Vite, shadcn/ui + Tailwind CSS, React Router, and TanStack Query. Kibo UI is configured as an on-demand component registry.
- **Backend:** TypeScript, Bun + Fastify.
- **API contract:** TypeBox + `@fastify/swagger`; generated client types with `openapi-typescript` and requests through `openapi-fetch`.
- **PWA:** `vite-plugin-pwa`.
- **Docker integration:** a separate, narrow Bun controller uses the Docker Engine Unix-socket API; the chat/backend process never mounts the Docker socket.
- **Testing:** Vitest for unit/integration tests; Playwright for essential browser workflows. On the Windows development host, follow the [browser launch safety rules](docs/development.md#windows-browser-launch-safety) to avoid account lockout.
- **Deployment:** Docker Compose with development overrides; Caddy for production HTTPS and reverse proxying.
- **Interactive desktop streaming:** pinned Selkies H.264/WebCodecs requires HTTPS outside localhost; an operator-built JPEG/createImageBitmap mode also passed isolated real video/input tests over non-localhost HTTP, suitable for a deliberately trusted private LAN or the existing encrypted Tailnet transport. Both use the dashboard's single TCP port, not WebRTC/UDP or per-computer host ports. The Radeon 680M VA-API encoder remains opt-in because x264 was lower-latency in the H.264 trial. Tailnet portal-free X11 HTTP/JPEG is live; see [Computers](docs/computers.md) for verification and residual risks.

Prisma + SQLite stores agents, channels, and published chat history. This single-backend setup uses WAL, indexed cursor pagination, and bounded model context; durable chat is not long-term agent memory.

## Project structure

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

- **`frontend/`** — saved agent creation/chat with paginated history, Settings with API endpoints and ChatGPT subscription sign-in, and PWA setup. The dashboard reconnects to backend-owned runs after refresh; drafts clear, while new operator activity is durably archived with paged history. Only explicitly published agent messages enter chat. Select an agent in **Agents** to configure [agent connections](docs/agent-communication.md) and its [animated avatar](docs/agent-avatars.md) in one centered, width-bounded scrolling pane, without section tabs. The visible **Channels → Swarm App** controls manage mutual connections; scroll down to adjust silhouette, color, eye shape and motion variation. Agents has a visible **+** to create an agent; each agent's settings hold its name, endpoint, model and thinking level (**Model**), computers, avatar and a Delete action. **Chat** holds human DMs and the **Chat with** selector for read-only agent-to-agent history, plus searchable chats, member-selected groups, Discord-style author grouping and persisted reactions; see [Chat and groups](docs/chat-and-groups.md).
- **`backend/`** — Pi SDK chat with channel-bound publication/history tools, read-only [Swarm Knowledge](docs/swarm-knowledge.md) exploration, and Pi Web Access search/fetch tools, Prisma/SQLite migrations and history, endpoint preferences, and an OpenAPI contract. No implicit host file/shell access. Assigned-computer tools act only on a claimed guest desktop. Private working-session entries and operator activity persist separately from chat; interrupted runs do not replay. Includes 1.5-second message debounce and temporary-fork interruption triage for follow-ups. See [chat and storage](docs/development.md#pi-agents-and-channels) and [interruption assumptions](docs/message-interruption.md).
- **`computer-controller/`** — internal Docker-socket service for constrained computer lifecycle, owned volumes, filtered egress, bounded consent previews/input and an opt-in render-node grant. The API/backend has no socket mount.
- **`templates/default/`** — Ubuntu GNOME image and standalone Compose configuration. The managed runtime boots GNOME/PipeWire, renders passive JPEG previews and serves interactive H.264 behind an isolated media relay.
- **`docs/`** — [swarm vision](docs/vision.md), development instructions, and reference material. The [local Kibo reference entry guide](docs/references/kibo/README.md) provides pinned source, searchable indexes, and adaptation notes.

Root Compose files run the platform; the backend requests fixed-template computer creation through an internal controller. Computer use requires an explicit per-agent assignment plus an active claim. `templates/default/compose.yaml` provides a standalone workspace with persistent home and workspace volumes. Keep tests beside their code where supported. Add no shared packages or separate services without a concrete need.

The default image uses **Ubuntu 24.04 LTS with Ubuntu GNOME**, retaining Ubuntu’s appearance—not substituting XFCE. Preserve the standard Ubuntu appearance: visual defaults, wallpapers, Yaru themes/icons, fonts, and icon-rendering support are essentials—not bloat. Include desktop/session essentials, terminal, file manager, and settings; exclude office apps, games, email clients, media apps, and other bundled extras. Avoid the full `ubuntu-desktop` installation. The image and GNOME compositor were smoke-tested; the managed runtime boots a headless session and serves on-demand preview frames.

The workspace includes Chrome, VS Code, Git/curl, gcc/g++, ffmpeg, Node.js/npm with nvm available, Bun, Python/uv, tmux, and a signed-out Pi CLI. Installing Pi in the guest does not grant product agents computer tools or copy host Pi credentials. Separate named volumes retain `/home/agent` and `/workspace` across container replacement; deletion of their data is explicit. tmux preserves sessions across client disconnections, not container restarts. See [workspace setup and checks](docs/development.md#workspace-tools-and-persistence).

Desktop resolution is fixed at **1920×1080**; do not resize it automatically to match the browser viewport. Passive grid previews are 480×270 JPEGs requested at 2 fps (every 500 ms) per visible card, only while the card is on screen and the tab is visible. The interactive video/input path shares the dashboard's one external TCP port. Local input-to-decoded-video trials and the AMD hardware/software trade-off are documented in [Computers](docs/computers.md); 120 fps and optical glass-to-glass latency are not promises.

## Progressive web app

Make the frontend installable with a web app manifest and icons. PWA capabilities require a secure context: production uses HTTPS; localhost is supported for development.

- Cache static application assets only; do not cache API responses or queue management actions offline.
- Show a clear disconnected state. Container operations and desktop streaming require connectivity.
- Prompt before applying updates to avoid interrupting active sessions.
- Push notifications are a future requirement, not part of the initial implementation. Notification triggers, permissions, and delivery infrastructure remain to be designed.

## API contract

Use a code-first OpenAPI contract, with backend schemas as the single source of truth:

- **TypeBox** defines request and response schemas for Fastify validation and response serialization.
- **`@fastify/swagger`** generates the OpenAPI specification.
- **`openapi-typescript`** generates frontend types; **`openapi-fetch`** provides the typed client.
- Regenerate types when the contract changes; CI checks for stale generated types. Do not hand-edit generated files or duplicate API interfaces.

Generated TypeScript types do not provide client-side runtime validation; add that only where needed.

## Deployment

Target x86_64 Linux for deployment. Use Caddy for production HTTPS and reverse proxying to support the PWA and future push notifications; keep proxy configuration limited to these needs. Development uses localhost.

The Compose project identifier is `agent-swarm-ng`. This rename does not deploy anything, migrate data, or rename existing containers/volumes. Older `agent-swarm-v2` Compose volumes remain separate; explicitly plan data migration or volume reuse before switching an existing deployment.

Two modes, using Compose overrides rather than profiles:

- **`compose.yaml`** — production configuration with built images, no source mounts or hot reload.
- **`compose.dev.yaml`** — development overrides with source mounts and frontend/backend hot reload where supported.

Authentication is not implemented: the API only accepts IP addresses, `localhost` and names listed in `ALLOWED_HOSTS`, and ports bind to loopback by default. Do not expose publicly. Use `scripts/compose.sh --list` for the supported stacks.

```sh
# Build approved managed images directly: Compose project labels baked into
# shared images would be inherited by their Docker-created child containers.
# The production frontend embeds Selkies client assets from the pinned image.
docker build -t agent-swarm-default:stage2 templates/default
docker build -t agent-swarm-computer-egress:dev -f templates/default/egress.Dockerfile templates/default
docker build -t agent-swarm-computer-media:stage2 -f templates/default/media.Dockerfile templates/default
# For deployed Tailnet X11/JPEG, build its distinct images afterward:
docker build -t agent-swarm-default:http-jpeg --build-arg COMPUTER_STREAM_ENCODER=jpeg templates/default
docker build -t agent-swarm-default:http-jpeg-x11 -f templates/default/x11.Dockerfile .

# Local production-mode build (remote stage-2 access requires a chosen, reviewed bind)
docker compose up --build -d

# Development
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

### Computer storage

Each computer keeps its files in two places: a **Keep** folder (code, settings, and everything it installs, which comes back after a rebuild or image update) and a **Cache** folder (anything that can be fetched again; safe to clear). By default both are the computer's own Docker volumes, so nothing needs setting up. To keep computers' files on a disk of your choice, create the folders on the host, mark them, then choose them in **Settings → Computer storage** (new computers use them; existing ones stay where they are):

```sh
mkdir -p /srv/agent-swarm/keep /srv/agent-swarm/cache
touch /srv/agent-swarm/keep/.agent-swarm-keep-root /srv/agent-swarm/cache/.agent-swarm-cache-root
```

The marker files are how the dashboard proves the folder was chosen by someone with access to the host; a computer also refuses to start while its marker is missing (for example, a removable disk that did not mount). Computers write there as root, so use a filesystem mounted `nosuid` (on ZFS, `zfs set setuid=off`) that other users of the host cannot reach. Back up the Keep folder. Details: [docs/computers.md](docs/computers.md).

## Project status

The platform includes persisted agent and computer identities, chat history, endpoint preferences, generated API types, tests, and Compose files. General resource-permission groups remain unimplemented; the dashboard has a single-account [sign-in](docs/login.md); [long-term memory](docs/agent-memory.md) is separate from chat history and saved sessions; agent computer assignments/control are described in [Agent computer use](docs/agent-computer-use.md) and computers in [Computers](docs/computers.md). Allowed Tailnet peers need the Admin password; no second GNOME consent applies after sign-in. Accepted runs continue without an open dashboard. Completed Pi working context has private SQLite checkpoints; new operator traces persist separately (pruned after `ACTIVITY_RETENTION_DAYS`, default 30), while interrupted runs do not resume after a backend restart. Restart releases computer claims and queues a notice for each affected agent's next normal turn. Platform and standalone workspace data use separate persistent storage; neither is the agents' long-term memory. Dated rollout notes and benchmarks are in [docs/history.md](docs/history.md).

Validate Docker/Sysbox, the chosen HTTP/JPEG or optional trusted HTTPS transport, long-lived streams, and host-specific GPU/latency trade-offs on each deployment host before relying on them.

Features must be explicitly agreed upon. Examples and analogies do not silently become requirements.

See [AGENTS.md](AGENTS.md) for working rules.
