# Swarm vision

**Draft for owner review.** This records the agreed product direction, not an implementation specification or authorization to build every feature. See [README](../README.md#project-status) for what exists today.

## Persistent agents, not coding workers

Agents are long-lived, human-like identities with long-term memory. They can communicate, coordinate, and use computers; coding is just one possible activity. “Agent” is a provisional name, and “human-like” describes the interaction model—not consciousness or guaranteed human-level judgment.

An agent is independent of its channels, assigned computers, and current model session. Replacing a computer or restarting a session should not erase its identity or memory. Persistence does not require an endlessly running conversation or inference loop.

## Start with no tools

Pi is the intended harness. Product agents start with **zero tools and no direct terminal or filesystem access**. Capabilities are introduced progressively and explicitly, rather than inherited from the default coding-agent toolset.

This separates the agent from the machine hosting its harness. A granted console capability acts on an authorized computer—not implicitly on the platform host. Both built-in and extension-provided tools must respect this model; tool visibility alone is not a security boundary.

This applies to product agents, not development assistants working on this repository.

## Channels and shared awareness

By default, an agent lives in the platform's chat interface. External channels may include a Discord bot identity in DMs or servers, or WhatsApp. These are ways to reach the same agent, not separate agents per application.

Context is intended to be shared immediately across channels, like a person communicating through several social apps. It should not be deliberately isolated into channel-specific memories. How simultaneous messages and in-progress responses receive new context remains to be designed.

A channel is also a publication boundary. Thinking traces and direct assistant output remain internal to the agent; an agent explicitly calls a channel tool to send a visible conversation message. A separate operator activity inspector may expose those runtime traces for observation, without publishing them to a channel. The platform must not treat raw model output as a chat message or expose it as a fallback. Granting this communication tool does not grant file, shell, or computer access.

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

The application now has a temporary, backend-hosted Pi chat slice: real agents can publish to their own platform-chat channel using one explicitly granted tool. Default tools and resource discovery are disabled. Agents and conversations remain ephemeral; only endpoint preferences are saved. This is not the long-lived agent/memory system described above. External channels, long-term memory, permissions, and computer assignment/control remain unimplemented.

Memory mechanics, message concurrency, permission/lock details, runtime placement, and external integrations remain open. No particular queue, database, lock mechanism, or delivery roadmap has been selected. Resolve these when the relevant work is scoped—not by expanding this vision into a speculative architecture.

Preserve the core separation: **agents have continuity, channels provide communication, computers provide capabilities, and permissions govern access.**
