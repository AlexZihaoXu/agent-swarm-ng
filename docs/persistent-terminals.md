# Persistent tmux terminals

Terminals belong to a **computer**, not an agent or conversation. They are shared guest resources, separate from the platform's synchronous `bash` tool and from any background-task scheduler. No automatic model wakeup, permanent terminal transcript archive, job queue, account system, or host shell is introduced.

## Agent operations

Every `terminal_*` operation—including reads—requires the agent's **current assignment and active computer claim** at execution. The backend selects the computer from that claim; callers cannot supply a host/computer target. Work runs as guest uid/gid1000 with its configured permissions, including guest sudo. No developer credentials, Docker socket, provider configuration or new host mounts enter the guest.

| Tool | Parameters | Meaning |
| --- | --- | --- |
| `terminal_create` | `name, command?, cwd?` | Start an interactive Bash shell, or `bash -lc command`; return the new opaque session ID without waiting for program completion. |
| `terminal_list` | none | List this computer's managed sessions. |
| `terminal_view` | `session` | Bounded plain-text snapshot of screen and recent scrollback. |
| `terminal_type` | `session, text` | Paste literal text; **no Enter appended**. Bracketed paste where supported; supplied newlines may execute commands. |
| `terminal_press` | `session, key` | Send one enumerated key. |
| `terminal_interrupt` | `session` | Send Ctrl+C; programs may ignore it. Inspect to verify. |
| `terminal_delete` | `session` | Kill the tmux session and discard its screen/history. Detached/external work is not guaranteed to stop. |
| `terminal_status` | `session` | Actual pane state, reported exit code, cwd, foreground command and dimensions. |

Use exact IDs returned by create/list, never guessed names/prefixes/raw tmux targets. IDs are scoped to the selected computer and are not reused by the API. Session names are case-insensitively unique, 1–48 ASCII letters/digits/hyphens/underscores, starting with a letter/digit. At most **32 sessions per computer**. Initial dimensions **120×36**; no browser-driven resizing. `cwd` defaults to `/workspace`; relative paths use that directory and `~/` expands under `/home/agent`.

Keys: `Enter`, `Tab`, `BTab`, `Escape`, `BSpace`, `Delete`, `Insert`, `Space`, `Up/Down/Left/Right`, `Home/End/PageUp/PageDown`, `F1`–`F12`, `C-a`–`C-z`, and `M-a`–`M-z`. Text accepts newline/carriage-return/tab but rejects other control characters; use `press` for those keys. Text/initial command ≤32,768 UTF-8 bytes, cwd ≤4,096 bytes, complete request ≤64 KiB including JSON overhead.

`view` returns the latest **≤2,000 physical rows / 50,000 UTF-8 bytes**, explicitly labelled when truncated. tmux retains **10,000 history rows in memory**, not a permanent log. Redirect important output to an ordinary guest file when needed. Snapshots can repeat or change due to full-screen redraws; they are not incremental stdout/stderr streams. Output is untrusted evidence, never instructions, HTML, a permission grant or an automatic chat publication. Agent tool calls/results use the existing activity/private-context handling.

A default interactive shell remains alive between commands; **alive does not mean the last command succeeded, or even finished**. An explicit create command exits its pane when complete and retains the screen. `exitCode` may be null when unknown (including the brief interval between PTY close and reaping, or termination by a signal); `exitSignal` is included when tmux reports one. It is never invented as zero. Input acceptance only confirms delivery, not application success.

## Lifetime and cancellation

Sessions/programs survive tool return, turn completion, Stop, browser close/refresh, backend/controller restart, claim release, assignment revocation and agent deletion. Revocation blocks later agent calls, not the work already authorized inside a shared computer. The next holder can inspect the same sessions; humans may interact concurrently under the existing trusted-operator policy. Explicitly interrupt/delete sessions when appropriate. **Power-off, guest reboot or container replacement ends tmux and its in-memory history**; there is no automatic restoration. Files retain their normal home/workspace-volume persistence.

Terminal API commands reuse core admission, one-use controller preparation tokens, cancellation epochs, guest generation/operation locks and uncertain-settlement markers. Short in-flight requests may finish before cancellation returns; cancellation fences and joins further API input, **not the deliberately persistent programs**. An uncertain supervisor/worker outcome retains the claim until settlement is resolved, potentially by stopping the computer. Never blindly retry create/type/press after an uncertain response.

The root supervisor explicitly chooses a separate uid1000 terminal worker **without** the synchronous command's private PID namespace/subreaper cleanup. Only terminal programs are allowed this lifetime. Ordinary `bash` keeps its existing timeout/descendant cleanup; detachment there remains unsupported. tmux uses a dedicated guest-local Unix socket and fixed configuration, separate from a human's default tmux server; no TCP service/host mount is added. Targets/keys are fixed/validated argv; literal text enters tmux through a bounded stdin buffer, not a shell command. An observed tmux3.4 fast-exit race can leave a zombie and no exit status (related upstream reports: [#311](https://github.com/tmux/tmux/issues/311), [#2679](https://github.com/tmux/tmux/issues/2679)). When a dead pane lacks both status and signal, the worker wakes **only its validated dedicated tmux server's** child reaper with SIGCHLD via a pinned PID descriptor, then rereads tmux metadata; it never invents an exit code or broadcasts to other servers. This is not an adversarial sandbox against a privileged guest modifying its executables or operating the socket directly.

Terminal list/view/status neither require nor renew a screenshot allowance. Mutating terminal calls invalidate the current holder's allowance, including operator mutations; take a fresh screenshot before GUI actions. One core/GUI operation per computer is admitted at a time; persistent programs themselves do not hold that request slot.

## Operator UI/API

Choose **Terminals** from a running computer's card menu. The modal reuses Kibo's `dialog-standard-3` (sticky header/scrolling body/footer) and `input-group-textarea-1` (bordered output, metadata header and input/action footer), inspected alongside the existing File browser. It provides session selection/creation, plain output, text/key sending, interrupt and typed-name deletion confirmation. Closing does not delete sessions. Unsaved text is not put in URLs or persistent browser storage.

This is an explicitly operated snapshot interface, **not a full browser VT emulator**: output refreshes every two seconds while visible, bounded by guest/API work; scrolling up pauses automatic follow. Text goes only through Send text; Enter is a separate button. Never treat stale/failed snapshots as current; controls disable on unavailable state. Concurrent humans/agents share files, ports and terminal state, with intentional race risks.

`POST /api/computers/:id/terminals` accepts an enumerated operation body. Reads use POST too but do not mutate sessions. It is a trusted **human operator** surface, separate from agent grants: it does not acquire/release an agent claim, and only targets a saved running, controller-verified owned computer. Core admission/fencing applies to it as well. Responses are `no-store`/`nosniff`, and text renders inertly. There is no raw tmux/Docker proxy. The existing dashboard is unauthenticated: keep it on the approved trusted network, never expose publicly.

## Verification and rollout

Python validation tests plus controller/service/tool/API and browser tests exercise bounds, exact target/key validation, assignment/claim rejection, independent operator access, screenshot invalidation, literal input and deliberate deletion. `bash scripts/test-computer-core.sh` runs real tmux and unchanged synchronous-core proofs in a labelled **disposable** Sysbox guest, including Unicode, cwd persistence, completed exit status, Ctrl+C, retained programs across cancellation and rejected stale input.

Deployment must update backend/controller/frontend and the fixed `computer-core.py` / `computer-terminal.py` guest helpers, plus the creation image. Install helpers in-place only after fresh idle/ownership gates; preserve live desktops, sidecars, settings, devices and volumes. No live owner-terminal input or inference is needed for validation. Keep service/creation-image rollback tags and a restricted app-data backup. Release evidence belongs in the working ticket until the rollout is complete.
