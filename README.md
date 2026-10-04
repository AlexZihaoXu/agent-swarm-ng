# Agent Swarm NG

![Status: Active development](https://img.shields.io/badge/status-active_development-blue)
![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)
![Deployment: Docker Compose](https://img.shields.io/badge/deployment-Docker_Compose-2496ED?logo=docker&logoColor=white)

A self-hosted platform for **persistent AI agents**. Each agent has its own identity, long-term memory and model, talks to you and to other agents in chats (and on Discord through its own bot), and works on shared, containerized Linux **computers**: full Ubuntu desktops and terminals you can watch and use alongside it. Agents only get the capabilities you grant them, checked where each action runs.

## What it does

- **Agents** with durable identities, instructions, a model of your choice (ChatGPT subscription, OpenRouter, or any OpenAI-compatible endpoint), [long-term memory](docs/agent-memory.md), [timers, reminders and a heartbeat](docs/agent-time.md), [todo lists that keep them going until the work is done](docs/agent-todos.md), a private scratchpad and read-only [Swarm Knowledge](docs/swarm-knowledge.md).
- **Chats:** private chats with each agent, [group chats](docs/chat-and-groups.md), [agent-to-agent DMs](docs/agent-communication.md), [shared files](docs/agent-files.md), replies and reactions; each agent can also have its own [Discord bot](docs/discord.md).
- **Computers:** Ubuntu GNOME desktops in [Sysbox containers](docs/computers.md), streamed to the browser, with terminals, a file browser and recordings. Agents [use them](docs/agent-computer-use.md) when assigned (anyone reads, one writes), and follow coding harnesses such as Claude Code, Codex, OpenCode and Pi through their own events.
- **Dashboard:** a [Dashboard tab](docs/dashboard.md) with live and historical host CPU, memory, network and disks (space and I/O), computers, agents' active hours, spending and tokens over time; [organizations](docs/organizations.md) to keep groups apart, [users](docs/users.md) who each see only their own organizations, [Portal](docs/portal.md) (Ctrl/⌘+K) search and floating windows, an [activity inspector](docs/agent-activity.md), a [sign-in](docs/login.md) with known addresses and a lockdown, an [audit log](docs/audit-log.md), an [access log](docs/access-log.md) and banners for critical events. It installs as an app on desktop and phone.

The longer-term direction is in the [swarm vision](docs/vision.md).

## Requirements

- x86_64 Linux with **Docker Engine** and **Docker Compose 2.24.4+**.
- **[Sysbox](https://github.com/nestybox/sysbox)** (`sysbox-runc`): computers never fall back to a privileged container.
- A private network to reach it from: **[Tailscale](https://tailscale.com)** (recommended) or a trusted LAN. Do not expose it to the internet directly.
- Disk space for the computer images (several GB) and each computer's files.
- For development only: Bun 1.3.6 and Node.js 22.12+.

## Install

The steps below set up the `tailnet-dual` stack: the dashboard on your Tailscale address over HTTP (port 19090) and HTTPS (port 19091, self-signed; the browser's secure context unlocks hardware video decoding). `scripts/compose.sh --list` shows the other stacks (loopback only, a private LAN, a trusted Tailscale certificate).

1. **Get the code and configure it.**

   ```sh
   git clone https://github.com/AlexZihaoXu/agent-swarm-ng.git
   cd agent-swarm-ng
   cp .env.example .env
   ```

   In `.env`, set `COMPUTER_CONTROLLER_TOKEN` (required: `openssl rand -hex 32`), `TAILSCALE_IP` (this machine's Tailscale IPv4, `tailscale ip -4`) and, if you browse by name, `ALLOWED_HOSTS`. The other settings are documented in the file.

2. **Build the computer images.** Build them directly (not through Compose, so no Compose labels end up in images that computers inherit), and before the dashboard, which embeds the desktop viewer from them:

   ```sh
   docker build -t agent-swarm-default:stage2 templates/default
   docker build -t agent-swarm-computer-egress:dev -f templates/default/egress.Dockerfile templates/default
   docker build -t agent-swarm-computer-media:stage2 -f templates/default/media.Dockerfile templates/default
   docker build -t agent-swarm-default:http-jpeg --build-arg COMPUTER_STREAM_ENCODER=jpeg templates/default
   docker build -t agent-swarm-default:http-jpeg-x11 -f templates/default/x11.Dockerfile .
   docker build -t agent-swarm-default:http-jpeg-xorg120 -f templates/default/xorg120.Dockerfile .
   docker build -t agent-swarm-default:h265-stage2 --build-arg COMPUTER_STREAM_ENCODER=h265enc templates/default
   docker build -t agent-swarm-default:h265-x11 --build-arg COMPUTER_STREAM_BASE=agent-swarm-default:h265-stage2 -f templates/default/x11.Dockerfile .
   docker build -t agent-swarm-default:h265-xorg120 --build-arg COMPUTER_X11_BASE=agent-swarm-default:h265-x11 -f templates/default/xorg120.Dockerfile .
   ```

3. **Create the HTTPS certificate and start.**

   ```sh
   sh scripts/make-self-signed-cert.sh
   scripts/compose.sh tailnet-dual up -d --build
   ```

   If Docker has no buildx plugin, prefix the command with `DOCKER_BUILDKIT=0`. `scripts/compose.sh tailnet-dual ps` shows the services becoming healthy.

4. **Set the Admin password right away.** Open `https://<tailscale-ip>:19091` (accept the self-signed certificate once) or `http://<tailscale-ip>:19090`. The first visit sets the password of the admin account, **Admin**; until you do, anyone who can reach the dashboard could set it. Admin then adds other people in Settings → Users; each sees only their own organizations ([users](docs/users.md)).

5. **Connect a model and create things.** In **Settings**, sign in with a ChatGPT subscription or add OpenRouter or an OpenAI-compatible endpoint. Then create a computer (**Computers → +**) and an agent (**Agents → +**), and assign the computer in the agent's settings.

To install it as an app, use the browser's install button (Chrome, Edge) or **Add to Home Screen** (iOS Safari); this needs HTTPS the device trusts (trust the self-signed certificate on the device first, or use a public domain as below).

### Reaching it from a public domain

Behind a reverse proxy (for example Nginx Proxy Manager, optionally behind Cloudflare) on your LAN or tailnet: forward to the **HTTPS** port 19091, turn on WebSockets, raise the read timeout to an hour, and add the domain to `ALLOWED_HOSTS`. Caddy takes the visitor's address from proxies on private and Tailscale addresses, so sign-in limits apply per visitor; set `TRUSTED_PROXIES` in `.env` to your proxy's address alone so no other device can claim another visitor's address ([details](docs/login.md#known-addresses-and-lockdown)). The dashboard then sits on the internet behind its passwords; consider the proxy's access list or basic auth as a second lock.

## Operating it

- **Update:** `git pull`, rebuild the images that changed (step 2 for computers), then `scripts/compose.sh tailnet-dual up -d --build`. A restart stops agent runs in progress (they end as incomplete); existing computers keep their image until you update them in their settings.
- **Data:** everything lives in `.local/` (the database, chat files, provider credentials and bot tokens, mode 0700). The backend keeps a daily copy of the database in `.local/backups/database/`; copy `.local/` off the machine regularly.
- **Computer storage:** each computer keeps its files in a **Keep** folder (code, settings, what it installs; it survives rebuilds) and a **Cache** folder (safe to clear). By default both are Docker volumes. To use a disk of your choice, create and mark the folders on the host, then pick them in **Settings → Computer storage**:

  ```sh
  mkdir -p /srv/agent-swarm/keep /srv/agent-swarm/cache
  touch /srv/agent-swarm/keep/.agent-swarm-keep-root /srv/agent-swarm/cache/.agent-swarm-cache-root
  ```

  Computers write there as root: use a filesystem mounted `nosuid` (ZFS: `setuid=off`) that other users cannot reach.

- **Forgotten password:** `scripts/compose.sh tailnet-dual exec backend bun scripts/reset-password.ts`, then set a new one on the next visit. **Locked down:** sign in from a trusted address, or `scripts/compose.sh tailnet-dual exec backend bun scripts/unlock.ts`.
- **Logs and health:** `scripts/compose.sh tailnet-dual logs backend`; who did what is in **Settings → Audit log**, who reached the dashboard in **Settings → Access log**. More in the [production checklist](docs/development.md#production).

## Development

```sh
bun install --frozen-lockfile
bun run dev:backend
# In a second terminal:
bun run dev:frontend
```

Open http://localhost:5173 (dev servers listen on this machine only). `bun run test` runs the unit and integration tests, `bun run test:e2e` the browser tests, and `bun run api:generate` refreshes the typed API client after a backend schema change. See [development](docs/development.md) for the stack, Docker setup and checks, and [AGENTS.md](AGENTS.md) for the project's working rules.

## Documentation

| Topic | Document |
| --- | --- |
| Direction and concepts | [Vision](docs/vision.md) |
| Sign-in, users, sessions, reverse proxies | [Login](docs/login.md) · [Users](docs/users.md) · [Audit log](docs/audit-log.md) · [Access log](docs/access-log.md) |
| Agents | [Communication](docs/agent-communication.md) · [Memory](docs/agent-memory.md) · [Time and events](docs/agent-time.md) · [Todo lists](docs/agent-todos.md) · [Activity](docs/agent-activity.md) · [Avatars](docs/agent-avatars.md) · [Files](docs/agent-files.md) · [Sessions](docs/durable-agent-sessions.md) |
| Chats | [Chat and groups](docs/chat-and-groups.md) · [Replies](docs/message-replies.md) · [Interruptions](docs/message-interruption.md) · [Discord](docs/discord.md) |
| Computers | [Computers](docs/computers.md) · [Agent computer use](docs/agent-computer-use.md) · [Terminals](docs/persistent-terminals.md) |
| Dashboard | [Dashboard](docs/dashboard.md) · [Organizations](docs/organizations.md) · [Portal](docs/portal.md) · [Swarm Knowledge](docs/swarm-knowledge.md) |
| Building and running | [Development and architecture](docs/development.md) · [Rollout history](docs/history.md) · [Feature consistency review](docs/feature-consistency-review.md) |

## License

[MIT](LICENSE). Mirrored and vendored third-party code keeps its own license (`docs/references/kibo/upstream/license.md`, `templates/default/vendor/nvm/LICENSE.md`).
