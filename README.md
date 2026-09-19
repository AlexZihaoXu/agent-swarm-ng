# Agent Swarm v2

![Status: Scaffold](https://img.shields.io/badge/status-scaffold-yellow)
![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Deployment: Docker Compose](https://img.shields.io/badge/deployment-Docker_Compose-2496ED?logo=docker&logoColor=white)

A lean platform for creating, modifying, and deleting **containerized environments** from our own template, with an optional browser-accessible desktop. Agent integration, including pi, is deferred.

## Getting started

Requires Bun 1.3.6 and Node.js 22.12+.

```sh
bun install --frozen-lockfile
bun run dev:backend
# In a second terminal:
bun run dev:frontend
```

Open http://localhost:5173. See [development instructions](docs/development.md) for tests, API generation, and Docker setup.

## Overview

Think **Portainer for agent environments**: simple lifecycle management, whether an agent is needed for a quick experiment or ongoing autonomous work.

“Hiring an agent” captures the experience of bringing one online—not a requirement for HR features, roles, or assignment workflows.

## Longer-term use cases

- **Quick experiments:** spin up a temporary environment, try a model with a prompt, and discard it afterward.
- **Long-running work:** keep agents working independently or together over time—for example, developing and maintaining an application.

These are use cases, not commitments to additional features.

## Scope

The initial scope is a dashboard for template-based environment creation, modification, and deletion. Start with one template whose desktop and streaming processes can be enabled or disabled; whether this toggle works only at creation or also at runtime remains open.

Pi integration and communication between agents belong to the longer-term direction, not the initial implementation.

Agents handle their own tasks, tools, deployment workflows, and credentials after setup—including through external channels such as Discord or WhatsApp.

**Autonomy is intentional.** Agents are intended to work with broad permissions, rather than seek approval at every step. Exact infrastructure access boundaries remain undecided.

## Stack

- **Frontend:** TypeScript, React + Vite, shadcn/ui + Tailwind CSS, React Router, and TanStack Query.
- **Backend:** TypeScript, Bun + Fastify.
- **API contract:** TypeBox + `@fastify/swagger`; generated client types with `openapi-typescript` and requests through `openapi-fetch`.
- **PWA:** `vite-plugin-pwa`.
- **Docker integration:** `dockerode`, pending Bun compatibility validation.
- **Testing:** Vitest for unit/integration tests; Playwright for essential browser workflows.
- **Deployment:** Docker Compose with development overrides; Caddy for production HTTPS and reverse proxying.
- **Desktop streaming candidates:** Selkies/WebRTC with AMD hardware encoding; coturn for optional relay fallback. Compatibility and performance need validation.

SQLite is the candidate if platform metadata requires persistence; no ORM or additional client state library is selected.

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
│       └── Dockerfile
└── docs/
```

- **`frontend/`** — management dashboard and embedded desktop viewer.
- **`backend/`** — API, template loading, Docker lifecycle operations, and desktop-access coordination.
- **`templates/default/`** — placeholder for one image with optional desktop and streaming processes. Desktop packages and the template schema are not implemented.
- **`docs/`** — design and setup notes, added as needed.

Compose runs the platform; the backend creates environment containers dynamically. Keep tests beside their code where supported. Add no shared packages or separate services without a concrete need.

Desktop streaming should prefer direct connections and use TURN as a relay fallback. Hardware-encoded 120 fps is a validation target, not a guarantee.

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

The initial scaffold includes a dashboard, health API, generated API types, PWA configuration, tests, and Compose files. Container management, desktop streaming, authentication, and persistence are not implemented.

Validate Bun compatibility with Docker libraries and long-lived connections, plus AMD hardware encoding and streaming performance, before relying on them.

Features must be explicitly agreed upon. Examples and analogies do not silently become requirements.

See [AGENTS.md](AGENTS.md) for working rules.
