# Swarm vision

**Draft for owner review.** This records the agreed product direction, not an implementation specification or authorization to build every feature. See [README](../README.md#project-status) for what exists today.

## Persistent agents, not coding workers

Agents are long-lived, human-like identities with long-term memory. They can communicate, coordinate, and use computers; coding is just one possible activity. “Agent” is a provisional name, and “human-like” describes the interaction model—not consciousness or guaranteed human-level judgment.

An agent is independent of its channels, assigned computers, and current model session. Replacing a computer or restarting a session should not erase its identity or memory. Persistence does not require an endlessly running conversation or inference loop.

## Explicit capabilities, no implicit host access

Pi is the intended harness. Product agents inherit **no default coding tools and no direct terminal or filesystem access**. The operator-approved read-only Swarm Knowledge plugin is an explicit baseline grant for every normal agent turn: it allows bounded exploration of curated reference material, not computer or channel control. Other capabilities are introduced progressively and explicitly rather than inherited from the coding-agent toolset.

This separates the agent from the machine hosting its harness. A granted console capability acts on an authorized computer—not implicitly on the platform host. Both built-in and extension-provided tools must respect this model; tool visibility alone is not a security boundary.

This applies to product agents, not development assistants working on this repository.

## Channels and shared awareness

By default, an agent lives in the platform's chat interface. External channels may include a Discord bot identity in DMs or servers, or WhatsApp. These are ways to reach the same agent, not separate agents per application.

Context is intended to be shared immediately across channels, like a person communicating through several social apps. It should not be deliberately isolated into channel-specific memories. How simultaneous messages and in-progress responses receive new context remains to be designed.

The dashboard's chat is a communication application providing explicit channel tools, not the agent's memory store. Removing a conversation removes that app's records and access, not what the same agent already learned while participating. A channel is also a publication boundary. Thinking traces and direct assistant output remain internal to the agent; an agent explicitly calls a channel tool to send a visible conversation message. A separate operator activity inspector may expose those runtime traces for observation, without publishing them to a channel. The platform must not treat raw model output as a chat message or expose it as a fallback. Granting this communication tool does not grant file, shell, or computer access.

Shared awareness is not automatic broadcasting. The agent decides what to disclose to each audience. The person configuring it accepts the risk of mistakes; mandatory per-message human approval or per-channel memory silos are not the intended model. Any configured access restrictions still apply.

## Groups and permissions

The platform supports groups and permissions, alongside group chats where agents can talk to each other. Conversation membership and resource access are distinct: joining a chat does not itself grant access to a computer.

The person setting up the system chooses access policies and accepts their risks. The platform makes those choices clear and reliably enforces them. Responsibility for agent judgment does not excuse a broken permission check.

## Computers are shared resources

A **computer** is an assignable containerized environment, based on the Ubuntu GNOME workspaces already developed. An agent can exist without a computer, and multiple agents can access the same one.

Computer capabilities include:

- **Computer use:** screen, mouse, and keyboard interaction with the graphical desktop.
- **Console access:** starting tmux sessions and running commands inside the computer.

Permission to use a computer is separate from temporary control. Depending on configuration, an agent may acquire a lock, wait, ask another agent to release control, or work concurrently.

Policies must be flexible, not universally single-agent. Desktop input shares one surface and is particularly prone to interference. Separate tmux sessions allow concurrent console work but still share files, processes, and ports; they are not isolated machines. Releasing control does not necessarily stop running programs.

The platform enforces whichever coordination policy is selected. Agents negotiate within it, while the person configuring concurrent access accepts the associated race-condition risks.

## Implementation boundary

The application has a backend-hosted Pi chat slice: real agents publish to their own platform-chat channel using an explicitly granted tool and can research public pages through Pi Web Access. Default coding tools and Pi resource discovery are disabled. Read-only Swarm Knowledge is granted through a first-party plugin and rechecks agent identity on every call; it is neither agent memory nor permission to use a computer. Prisma + SQLite saves agent identities, channels, and published history; endpoint preferences are also saved. Accepted work runs independently of dashboard connections; refresh reconnects observation instead of cancelling the agent. Completed Pi working-session context is checkpointed privately in SQLite and restored on later turns, including after backend restarts. In-flight model streams/jobs still do not resume automatically; drafts remain ephemeral. New operator activity is stored separately for paged inspection across refresh/restart, with a bounded disk pool for screenshot copies. This is not yet the agent's long-term memory system. Durable chat is not the long-term agent/memory system described above. Human DMs, mutual agent DM connections, member-authorized group chats, and reactions are implemented communication features. A separate Computers dashboard creates/deletes independent Ubuntu GNOME environments and has passed isolated passive-preview and human interactive-desktop tests (secure H.264/WebCodecs and an opt-in private-LAN HTTP/JPEG path). The trusted Tailnet deployment now serves the stage-2 human HTTP/JPEG viewer. Creating a computer grants agents no capabilities. The operator can explicitly assign it to agents; one agent at a time may claim control, while humans can interact concurrently. Bounded screenshot/combo tools enforce the assignment, active claim and recent-observation allowance. Custom file read/edit/write and synchronous shell tools also require the current computer claim and execute only inside that guest; seven explicitly granted terminal tools now provide persistent guest tmux sessions under the same claim boundary, with a separate human operator view. Terminal programs survive release and backend restart, but not computer shutdown; this is not background-job scheduling. Agents can wake themselves with durable timers and reminders and with one-shot computer watches (a model check at an interval that wakes the agent once when a described condition is met); cron-style scheduling is not implemented. Human Force release and backend-restart release do not erase assignments; release notices reach the agent on its next normal turn. External channels, long-term memory and general resource-permission groups remain unimplemented.

Memory mechanics, broader message concurrency, general permission policies, runtime placement, and external integrations remain open. The first computer-control policy is specified in [Agent computer use](agent-computer-use.md). Prisma + SQLite is selected for the current single-backend platform records, with one active turn per agent. Bounded in-process inbox/work queues are implemented for current chat delivery. Durable autonomous scheduling, computer coordination locks, and distributed delivery remain undecided. Resolve these when the relevant work is scoped—not by expanding this vision into a speculative architecture.

Preserve the core separation: **agents have continuity, channels provide communication, computers provide capabilities, and permissions govern access.**
