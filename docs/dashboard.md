# Dashboard

The **Dashboard** tab (`/dashboard`, also in Portal) shows how the platform and its agents are doing over a period: the last 12, 24, **48** (default, remembered per browser), 72 hours or a week. The period sets each chart's span and how much accumulates (spend, tokens, active hours). It refreshes every minute while open.

## What it shows

| Chart | Scope | Source |
| --- | --- | --- |
| Host CPU, host memory, host network | system-wide | `SystemSample`, every minute |
| Disk I/O, one chart per physical disk | system-wide | `DiskIoSample`, every minute |
| Space, one chart per storage area | system-wide | `DiskSample`, every 5 minutes |
| Computer CPU, computer memory (one line per computer) | current organization | `ComputerSample`, every minute |
| Agent active hours | current organization | `AgentRunSpan` |
| Spend per provider (running total) | current organization's agents | `UsageEvent.cost` |
| Tokens per agent, by type (input, output, cache read, cache write, reasoning) | current organization | `UsageEvent` |

"Current organization" follows the organization switcher; with all organizations shown, everything is included. A summary row shows spend, tokens and active time in the period (host CPU and memory now are in [Now](#now-live)). Charts are Kibo's `chart/area/chart-area-interactive` (and its line form) and a horizontal bar chart, through the shadcn chart component (`frontend/src/components/ui/chart.tsx`, Recharts 2 with `react-is` 19 for React 19). Series colours are `--chart-1…8`.

## Now (live)

At the top: rings for host CPU (with its core count), memory and each storage area's space (the computer cards' `UsageDial`, larger, red from 90%), the network's current in/out, and the last minute at one reading a second: CPU, memory, network, and each physical disk's read/write (`nvme0n1 · HighRel 512GB SSD · 512 GB`, `sda · SABRENT · 1.4 TB`: model or vendor and size from `/sys/block`). Space is per storage area (a partition or a ZFS pool), I/O per physical disk; a pool's disks are not mapped to it (that needs the ZFS tools). The backend keeps the minute in memory (`backend/src/metrics/live.ts`, started only while the server listens); the page polls `GET /api/dashboard/live` every two seconds.

**Network** is the host's physical interfaces (those with a device behind them, e.g. `eno1`, `wlp3s0`; bridges, veths and `tailscale0`, whose traffic also crosses a physical interface, are left out). The backend's own `/proc/net/dev` shows only its container, so a tiny `host-net` service (busybox, host network namespace, read-only, all capabilities dropped, as nobody, no ports) copies the host's counters once a second, stamped with the host's uptime, into an in-memory volume the backend reads; rates use the sidecar's own interval (a snapshot read twice is no reading, not a zero), and a snapshot more than three seconds old means the helper stopped (no network figures). Over a period, **Host network** and one **Disk I/O** chart per physical disk show the averages per bucket (sampled every minute: `SystemSample.netRx/netTx`, `DiskIoSample`).

Lines break where there is no data (the platform or host was off, or a reading was missing) instead of joining across the gap; running totals (spend) carry on.

## Critical events

A banner across the top of every page (Kibo `alert/error/alert-error-5`; failed sign-ins in amber) reports, with its time span and (except a full disk) a **View logs** link to the audit log on the right category:

- **Possible power outage** — at start-up the last minute sample is more than five minutes old, no clean `system.stop` followed it, and the host booted since (`/proc/uptime`); without a host reboot it reads **The platform stopped unexpectedly** (a crash or a killed container). A clean stop is not reported.
- **Failed sign-ins** — five or more from any address within an hour, with the names tried and the addresses ([login](login.md#known-addresses-and-lockdown)).
- **Sign-in is locked down** — while it lasts.
- **Disk nearly full** — a storage area at 90% or more (from its latest reading within the hour), while it lasts.

Events (`Alert`) can be dismissed; ongoing conditions cannot and end on their own. `GET /api/alerts`, `POST /api/alerts/:id/dismiss`.

## How it is measured

- **Host CPU and memory** (`backend/src/metrics/host.ts`): the backend container sees the host's `/proc/stat` and `/proc/meminfo` (no lxcfs); CPU is the share of busy time between two readings (iowait counts as idle), memory is MemTotal − MemAvailable.
- **Computers**: the controller's existing per-computer stats; CPU is a share of the computer's own CPU quota (0–100, like its card's dial), memory as a share of its limit at that moment (`memPercent`, kept per sample so a later limit change does not rewrite history; empty without a limit).
- **Disks are detected, not chosen**: the physical storage the platform uses — Docker's data root, the platform data folder (`.local`), each Keep and Cache host folder — plus host paths the operator lists in `DASHBOARD_EXTRA_DISKS` (`.env`; never from the dashboard). The controller adds Docker's root and the listed paths itself; the backend sends only the Keep/Cache folders in use (Settings' first, deduplicated, at most 16), and the controller measures one only when it passes the Keep/Cache folder rules (outside Docker's storage, not `/`, not inside a computer's storage) and carries its `.agent-swarm-keep-root` or `.agent-swarm-cache-root` marker. It measures them with a short-lived helper container (the computer image, no network, read-only mounts, every capability dropped: `df` reads its mount points' statistics without any) running `df`, one measurement at a time (a request during one gets its result) with a 30-second limit, and a path found unavailable (missing, or without its marker) is skipped for an hour rather than retried in its own helper every five minutes (a Docker failure for another reason is retried next time; a fallback run stops within 75 seconds). Without capabilities the helper cannot enter a folder the host keeps private (mode 0700): such a folder shows as unavailable; and paths on the same device are merged into one disk: a block device by its source (e.g. `nvme0n1p2`), ZFS by pool (`bulk/drive-2026` → `bulk (ZFS)`, used = the datasets seen, total = used + free; snapshots and datasets outside the measured paths are not counted, so list a pool's mountpoint to see it whole). Each disk says what lives there (docker, platform data, computer keep/cache, listed).
- **Model usage** (`backend/src/usage/`): every model call is recorded from its Pi `message_end` (main turns, heartbeats, triage forks, decision forks, the Discord relevance check, watch checks, sleep) or from compaction (the SDK's own and background/idle compaction), with its purpose, provider, model, the five token counts and Pi's price. **Subscription providers** (ChatGPT, `openai-codex`) show the API-equivalent price, marked as such; it is not money billed. **Custom endpoints** (OpenAI-compatible servers saved in Settings) have no known prices: they are listed by endpoint name as *not priced* and left out of spend (their tokens still count when the server reports usage). Reasoning tokens are part of output: the token charts stack the rest of output and reasoning separately, and totals count them once. The backfill attributes older usage to the agent's current endpoint. Main-session rows share a key with their saved session entry, so the backfill from older saved sessions never counts a call twice. Usage rows are written in batches about once a second (flushed on shutdown).
- **Active hours**: a run's span from leaving the queue to finishing (completed, failed or stopped); heartbeats count only once they become real work; watch checks, sleep and compaction are not runs. Every start closes the spans a restart left open at their last activity; older runs are backfilled from the activity archive.

The history backfill (run spans from the activity archive, usage from saved sessions) runs once, in the background after start-up: when it has finished, it writes `.dashboard-backfill-v1` in the platform data folder and later starts skip it (a failed one is tried again next start). Samples (`SystemSample`, `DiskSample`, `DiskIoSample`, `ComputerSample`) are kept 14 days, usage and run spans 400 days, all pruned hourly in small batches (a deleted agent's usage still counts, as **Deleted agents**, when all organizations are shown; its run spans are no longer charted). `GET /api/dashboard?range=12h|24h|48h|72h|7d&organization=` returns everything in fixed buckets (10 min, 20 min, 30 min, 1 h, 3 h).

## Phone layout

With five tabs, phones get a full-width bottom navigation bar (each tab at least 44 px wide and tall) and a slim top bar with the organization switcher and Portal; both hide in detail views (a conversation, an agent's settings, the desktop viewer), which have their own back links. Wider screens keep one header row: organization, tabs, Portal.
