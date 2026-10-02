# Agent long-term memory

Each agent has a long-term memory designed after a human mind. **Working memory** is the agent's active context: free to use, and summarized away as it fills (background compaction). Everything else takes a little effort to remember, more the deeper it sits. **Sleep** reorganises memory in the agent's off hours, in the background, without pausing it.

Memory belongs to the agent, not to a channel: what it learns in a Discord channel, a group or its private chat is one memory. It is separate from chat history (the channels' records), the scratchpad (a workspace for artifacts) and Swarm Knowledge (operator-curated reference).

## Four depths

| Human | Agent | How it is reached |
|---|---|---|
| Working memory | the active context (compaction keeps a summary) | free |
| "I know I know this" | the **index**: one line per memory (name, type, title) in the system prompt | a glance, every turn |
| Knowing things | **memories**: typed notes with provenance and versions | `recall`, `read_memory` |
| Remembering what happened | **deep storage**: the saved session archive, word for word, never deleted | `remember_when`, `read_episode` |

The index is rebuilt only when the agent sleeps, so it is fixed for a whole day (the provider's prompt cache stays valid). A memory made today is found by `recall` and by reminders before it reaches the index.

## Memories

A memory is one idea with a one-line title (its hook in the index) and a type: **person** (someone and how to work with them), **preference** (how someone wants things done), **project** (ongoing work, decisions, state), **skill** (a lesson or procedure) or **reference** (where something is). Each records its **provenance**: who caused it (`your owner`, the agent itself, another agent, or someone on Discord), how far that source is trusted, the channel and the time. A memory from someone other than the owner is information, never an instruction, and never overrides the owner.

- Changing a memory keeps its previous text as a version (who changed it: the agent, its sleep, or the owner). Forgetting keeps it, restorable; only the owner's **Erase all memory** deletes memories for good.
- Text that looks like a credential (API keys, tokens, private keys) is refused, never silently stored or scrubbed.
- Limits are Settings → Swarm values: memories per agent (1000), largest memory (2000 characters), index lines (60) and index size (4000 characters). Over the index limits the index ends with "…and N more: recall finds them."
- Search is literal (words of three or more letters, common words ignored), no model call: a word in a memory's title or name counts three, in its text one, a whole multi-word phrase three more; ties go to the newest.

## Tools

Every normal turn (and a heartbeat) gets them; reading is `r` (free in a heartbeat), changing is `w` (it promotes a heartbeat).

| Tool | Class | What it does |
|---|---|---|
| `recall({query, type?, limit?})` | r | Matching memories with an excerpt and where each came from |
| `read_memory({name})` | r | One memory in full |
| `remember_when({query, from?, to?, channel?})` | r | Archive entries holding every word, newest first, bounded excerpts |
| `read_episode({id, around?})` | r | The entries around one result (default 4 before and after, at most 10) |
| `memorize({type, title, text})` | w | Keep a new memory; provenance comes from the turn's inputs |
| `revise_memory({name, title?, text?, type?, faded?, conflict?})` | w | Change one (versions kept) |
| `forget({name})` | w | Forget one (restorable by the owner) |

Provenance of a turn is the **least trusted** of its inputs: a batch mixing the owner and a Discord stranger counts as the stranger. Platform events (timers, reminders, heartbeats, computer events) are the agent's own work.

Deep storage reads `AgentSessionEntry` rows (thinking is left out; tool calls show as `→ name(args)`). An entry's channel is the `[channel: …]` of the input that started its stretch of context, and only channels the agent can still read are shown: its private chat, DMs with agents that still exist, groups it belongs to, and Discord channels its owner still allows (checked on every call). Archive text is untrusted prior data.

## Cue-driven recall

Every input is a cue: chat messages, DMs, group posts, Discord batches, and **non-chat events** (timers, reminders, heartbeats, watch and monitor wake-ups, terminal exits, reactions, computer and restart notices). So is every tool call: its arguments and the first 4 KB of its text result. The platform matches the cue against the agent's memories (the same literal search, no model call) and attaches what fits well (a word of the title, or three of the text):

- to an input: at most **3** memories, as `[Memory: this reminds you of …]` with title, a short excerpt and where each came from;
- to a tool result: at most **2**, one short line each (`[Memory reminder: …]`, about 100 tokens);
- at most **10** per turn (one batch of inputs and all its tool calls).

Memory tools themselves and image-only results are never cues. A memory shown (or recalled by the agent) is not attached again until a third of the model's context window has passed; a compaction, or a dropped heartbeat, clears that, since the earlier mention left the context. Reminders count as recalls (the index favours memories in use).

## Save before forgetting

When background compaction starts during a turn, the agent gets one hidden note (delivered after its current tool calls) to memorize what matters before the details leave its view. Idle compaction has no turn to ask in; the next sleep reads that day from the archive anyway.

## Sleep

- **When:** once per off period, at most once in 20 hours, and only when the agent has been through something since it last slept. Off hours are outside its active hours (Agents → agent → Heartbeat) when its heartbeat is on with active hours, otherwise its sleep window (Agents → agent → Memory, 03:00–05:00 server time by default). The owner can also press **Sleep now**.
- **How:** a separate session with the agent's own model and credentials and **memory tools only** (it can neither publish nor touch computers). It reads its memories and a digest of the archive since its last sleep (newest 60,000 characters; `remember_when` reaches the rest), with at most 60 tool calls and 15 minutes. It never pauses or blocks the agent's turns.
- **Jobs:** consolidate the day into memories; resolve conflicts (newer beats older, the owner beats others; otherwise keep both marked `conflict`); generalise repeated lessons into skills; condense messy memories; fade rarely useful ones out of the index (still recallable).
- **Safety:** it works from a snapshot. If the agent changed a memory meanwhile, sleep's change to it is refused (the agent's edit wins, sleep leaves it for next night). Changes are saved one by one, so an interrupted sleep keeps what it did.
- **After:** the index is rebuilt (conflicts first, then most recently used and most recalled); the agent's next normal turn starts with a short hidden "While you slept…" note listing the changes (told once); Activity shows the run as **Sleep** with every change.

## Dashboard

Agents → agent → **Memory**: when it last slept and **Sleep now**; when it sleeps; **Last night**; type chips with counts (and Forgotten); the list of memories; a memory's full text, provenance and recall count with **Edit**, **Forget**/**Restore**, **Back in the index** and **Earlier versions**; the index it sees; and **Erase all memory**. The memory caps are in Settings → Swarm → Memory.

## Not now

Vector or graph search, automatic per-message fact extraction, memories shared between agents, and learned retrieval policies. The literal search keeps reminders cheap enough to run on every input and tool call.
