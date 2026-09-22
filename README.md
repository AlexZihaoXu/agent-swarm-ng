# Agent Swarm v2

![Status: Scaffold](https://img.shields.io/badge/status-scaffold-yellow)
![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Deployment: Docker Compose](https://img.shields.io/badge/deployment-Docker_Compose-2496ED?logo=docker&logoColor=white)

A platform for **persistent agents** with long-term memory and shared awareness across communication channels. Agents use explicitly granted capabilities to access shared, containerized **computers**; they are not bound to a computer or limited to coding.

**Today:** Pi-backed agents with durable identities and published chat history in Prisma + SQLite, saved endpoint preferences, and a standalone Ubuntu GNOME workspace foundation. Long-term agent memory and the full swarm runtime are not implemented. Read the [swarm vision](docs/vision.md) for agreed concepts and deliberately open questions.

## Getting started

Requires Bun 1.3.6 and Node.js 22.12+.

```sh
bun install --frozen-lockfile
bun run dev:backend
# In a second terminal:
bun run dev:frontend
```

Open http://localhost:5173. See [development instructions](docs/development.md) for tests, API generation, and Docker setup.

## Vision and scope

- **Agents:** persistent, human-like identities with long-term memory, independent of any one session or computer. Pi is the intended harness; product agents start with zero tools, then receive capabilities explicitly.
- **Channels:** platform chat by default, with external channels such as Discord or WhatsApp envisaged. One agent shares awareness across channels rather than becoming a separate agent per app.
- **Communication and access:** group chats let agents coordinate; permissions and groups govern resource access.
- **Computers:** assignable containerized environments, potentially shared by multiple agents, with desktop and console/tmux capabilities.
- **Configurable autonomy:** the person setting up the system chooses access and coordination policies and accepts their risks. Agents exercise judgment within those boundaries; the platform enforces the selected rules.

The [vision document](docs/vision.md) distinguishes agreed direction from unresolved design and implementation options. Human-like interaction does not imply human-level discretion or require an endlessly running model conversation.

Existing environment work is a foundation for computers, not the full product definition. The current Pi runtime supports saved platform-chat history with in-memory model sessions only; long-term memory, external channels, permissions, assignments, and computer-control policies remain unimplemented. The next milestone and implementation order require explicit agreement; this vision does not authorize building them all at once.

## Stack

- **Frontend:** TypeScript, React + Vite, shadcn/ui + Tailwind CSS, React Router, and TanStack Query. Kibo UI is configured as an on-demand component registry.
- **Backend:** TypeScript, Bun + Fastify.
- **API contract:** TypeBox + `@fastify/swagger`; generated client types with `openapi-typescript` and requests through `openapi-fetch`.
- **PWA:** `vite-plugin-pwa`.
- **Docker integration:** `dockerode`, pending Bun compatibility validation.
- **Testing:** Vitest for unit/integration tests; Playwright for essential browser workflows. On the Windows development host, follow the [browser launch safety rules](docs/development.md#windows-browser-launch-safety) to avoid account lockout.
- **Deployment:** Docker Compose with development overrides; Caddy for production HTTPS and reverse proxying.
- **Desktop streaming candidates:** Selkies/WebRTC with AMD hardware encoding; coturn for optional relay fallback. Compatibility and performance need validation.

Prisma + SQLite stores agents, channels, and published chat history. This single-backend setup uses WAL, indexed cursor pagination, and bounded model context; durable chat is not long-term agent memory.

## Project structure

Core layout:

```text
agent-swarm-v2/
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
├── templates/
│   └── default/
│       ├── template.yaml
│       ├── compose.yaml
│       └── Dockerfile
└── docs/
```

- **`frontend/`** — saved agent creation/chat with paginated history, Settings with API endpoints and ChatGPT subscription sign-in, and PWA setup. The dashboard reconnects to backend-owned runs after refresh; drafts and old internal activity clear. Only explicitly published agent messages enter chat. Create or right-click an agent to customize its [animated avatar](docs/agent-avatars.md), including silhouette, color, eye shape, and randomized motion variation. **Edit agent → Settings → Channels → Swarm App** manages mutual [agent connections](docs/agent-communication.md). **Chat with** switches the main view between **You** and agent-to-agent history, with source-labelled inbox delivery and sender-tinted bubbles.
- **`backend/`** — Pi SDK chat with channel-bound publication/history tools and Pi Web Access search/fetch tools, Prisma/SQLite migrations and history, endpoint preferences, and an OpenAPI contract. No agent file/shell/computer access or internal-session persistence. Includes 1.5-second message debounce and temporary-fork interruption triage for follow-ups. See [chat and storage](docs/development.md#pi-agents-and-channels) and [interruption assumptions](docs/message-interruption.md).
- **`templates/default/`** — Ubuntu GNOME workspace image, standalone Compose configuration, and smoke tests. Production desktop startup, streaming, and the platform template schema remain unimplemented.
- **`docs/`** — [swarm vision](docs/vision.md), development instructions, and reference material. The [local Kibo reference entry guide](docs/references/kibo/README.md) provides pinned source, searchable indexes, and adaptation notes.

Root Compose files run the platform; dynamic environment creation by the backend is still pending. `templates/default/compose.yaml` provides a standalone workspace with persistent home and workspace volumes. Keep tests beside their code where supported. Add no shared packages or separate services without a concrete need.

The default image uses **Ubuntu 24.04 LTS with Ubuntu GNOME**, retaining Ubuntu’s appearance—not substituting XFCE. Preserve the standard Ubuntu appearance: visual defaults, wallpapers, Yaru themes/icons, fonts, and icon-rendering support are essentials—not bloat. Include desktop/session essentials, terminal, file manager, and settings; exclude office apps, games, email clients, media apps, and other bundled extras. Avoid the full `ubuntu-desktop` installation. The image and GNOME compositor are smoke-tested; complete session management and production streaming still need implementation and validation.

The workspace includes Chrome, VS Code, Git/curl, build tools, Node.js/npm, Bun, Python/uv, and tmux. Separate named volumes retain `/home/ubuntu` and `/workspace` across container replacement; deletion of their data is explicit. tmux preserves sessions across client disconnections, not container restarts. See [workspace setup and checks](docs/development.md#workspace-tools-and-persistence).

Desktop resolution is fixed at **1920×1080**; do not resize it automatically to match the browser viewport. Desktop streaming should prefer direct connections and use TURN as a relay fallback. Hardware-encoded 120 fps is a validation target, not a guarantee.

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

Two modes, using Compose overrides rather than profiles:

- **`compose.yaml`** — production configuration with built images, no source mounts or hot reload.
- **`compose.dev.yaml`** — development overrides with source mounts and frontend/backend hot reload where supported.

Compose configurations are scaffolded. Authentication is not implemented; ports bind to loopback by default. Do not expose publicly.

```sh
# Production
docker compose up --build -d

# Development
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

## Project status

The platform includes persisted agent identities and chat history, endpoint preferences, generated API types, tests, and Compose files. Long-term memory, external channels, permission groups, computer assignments/control, dashboard container management, desktop streaming, and platform user authentication remain unimplemented. Accepted runs continue without an open dashboard. Pi sessions and operator traces are ephemeral; interrupted runs do not resume after a backend restart. Platform and standalone workspace data use separate persistent storage; neither is the future long-term memory system.

Validate Bun compatibility with Docker libraries and long-lived connections, plus AMD hardware encoding and streaming performance, before relying on them.

Features must be explicitly agreed upon. Examples and analogies do not silently become requirements.

See [AGENTS.md](AGENTS.md) for working rules.
