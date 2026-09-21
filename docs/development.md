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

Playwright starts its own backend and frontend; stop existing instances on ports 3000 and 5173 first. Browser tests cover the chat preview, transitions, local sending, and endpoint Preferences (with mocked provider results). PWA installation, offline caching, and updates still need production-browser validation.

## Endpoint connection tests

In **Preferences → API endpoints**, add a name, base URL (including an API prefix such as `/v1`), and optional API key. **Test connection** makes a backend `GET <base URL>/models`, using Bearer authentication when a key is provided. It lists model IDs only; it does not send an inference request or configure an agent.

Use **Save endpoint** to persist its name, URL, and key on the backend. Local development stores these in Git-ignored `.local/endpoints.json`; Docker uses the `platform_data` volume at `/app/.local`. The file contains plaintext keys with restrictive file permissions where supported; this is not an encrypted vault, and Windows access depends on the containing folder's ACL. Do not share or back up the file casually. It is excluded from Docker build contexts. The API returns only a `hasApiKey` flag, never the saved key. A blank replacement preserves a saved key; **Clear saved key** followed by Save removes it. Changing the URL clears the old key unless a replacement is supplied.

Unsaved edits still disappear on refresh. Keys are not stored in browser storage. Keys travel to the backend and the explicitly chosen endpoint; use HTTPS for remote providers. Localhost addresses refer to the **backend's** network namespace, including when it runs in Docker.

The test has a 10-second timeout, rejects redirects and URLs containing credentials/query parameters/fragments, bounds responses to 1 MiB and 1,000 model entries, and does not return raw provider errors. Local/private endpoints are intentionally supported, so this unauthenticated route can reach the backend's network: keep the platform loopback-only and do not expose it publicly. Authentication and network-access policy are prerequisites for external deployment.

## Temporary Pi agents and channels

Keep existing `[demo]` agents for the simulated UI. To create a real agent, right-click the agent panel, select **Create new agent**, name it, choose a saved endpoint/model, and select a supported thinking level. Listing models uses the endpoint's `/models`; it does not guarantee Chat Completions or tool-calling support.

The backend uses pinned Pi SDK 0.85.1 with OpenAI-compatible Chat Completions. It disables default tools and supplies an empty resource loader: no extensions, skills, prompt expansion, context files, global settings, or inherited credentials. Model catalogs, settings, and sessions are in memory; no Pi session, auth, or model-store files are created. API keys are passed literally, never through Pi's command/environment configuration syntax.

The one explicitly granted custom tool is **`send_message`**, bound to the agent's platform-chat **Channel**. The backend rejects other channel IDs. Only tool-published messages enter the chat channel. Thinking and direct assistant output are sent as separately tagged operator activity, never interpreted as conversation messages. A separate channel-scoped typing status starts when streamed tool metadata identifies `send_message`, before its arguments finish. It exposes no draft arguments and clears on publication, tool failure, completion, or cancellation. If a turn finishes normally without a publication, the backend sends one private reminder that direct output is invisible and a channel tool is needed; the agent may ignore it when silence is intentional. There is no reminder loop, and failed or cancelled turns are not nudged. Neither reminders nor raw output become chat messages; technical diagnostics are not printed beneath the composer. There are no computer, file-reading, shell, or browsing tools.

The chat header's **Agent activity** button opens a right-side operator inspector. It accumulates agent-scoped activity even while closed: system prompts, user messages, provider-exposed thinking/direct output, streamed tool arguments/results, private reminders, channel publications, and completion/errors. The panel does not change what is delivered to chat. Credentials and transport headers are not exposed as event fields; known saved-key values are redacted from activity text. Traces remain in browser memory only and clear on refresh. Previously discarded activity cannot be reconstructed, and hidden reasoning not exposed by the provider cannot be shown. Only the platform-chat channel exists currently; activity records retain their source channel IDs.

Published chat messages render Markdown using `react-markdown`: headings, emphasis, strikethrough, lists, quotes, links, tables, task lists, inline/fenced code, and Discord-style spoiler markers. Code blocks include syntax highlighting and a copy button; unsupported languages remain plain text. Single line breaks are preserved. Raw HTML is disabled, links are restricted to safe protocols, and remote images appear as links rather than automatically loading third-party resources. The stored message text and composer are unchanged; this is rendering only, not a complete Discord syntax implementation.

Agents, drafts, and published transcripts live in browser memory. For each turn, the backend constructs a fresh in-memory Pi session from the delivered transcript, runs it, and disposes it. The model does not receive private reasoning from previous turns; the operator inspector can retain its trace for the current browser session. Signed temporary descriptors become invalid on backend restart; refreshing the page loses the agent. Disconnect/Stop cancels inference, with a two-minute upper bound. This temporary approach is not the future long-term memory architecture.

Thinking controls use Pi's known OpenAI model metadata and standard `reasoning_effort`; unsupported/unknown models are grayed out. A proxy still needs to honor that parameter. Gray does not imply that a server cannot reason internally. Compatibility was tested against a local streaming OpenAI-compatible fixture (including tools and reasoning effort), plus a live user-authorized Qwen endpoint for actual channel-tool delivery. Other provider families/APIs are not claimed to work.

Endpoint preferences are the only persistence exception. No chat transcript or model trace is intentionally written to application storage; external providers may retain requests according to their own policies. Keep the unauthenticated development platform loopback-only.

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
