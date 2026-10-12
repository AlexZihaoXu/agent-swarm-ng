# Exporting and importing agents

An agent can be saved as one file and brought back, here or on another Agent Swarm, as a new agent with everything that was inside it.

## Export

**Export agent…** (Chat → right-click the agent, or Agent settings → **Export**) opens a dialog of switches; **Export** downloads `<name>.swarm-agent` (`GET /api/agents/:id/export?parts=…`, streamed, never buffered). Always included: every setting (the model list with its providers, thinking levels and per-model options, instructions, heartbeat, time notes, compaction, sleep window, avatar), todos, timers and timer firings not yet seen, recent emojis, and its links (assigned computers, DM permissions, group chats) by id and name. Switches, all on by default:

| Switch | Carries |
| --- | --- |
| Live context | Its saved conversation (`AgentSession` and its entries), so it picks up where it left off |
| Memories | Every memory with its versions, type and provenance |
| Scratchpad | Its scratch files (text and images) |
| Private chat | Its messages with the owner, their reactions, and the chat's files (bytes included) |
| Agent DMs | Its conversations with other agents and their files |
| Discord | Its bot's settings, channels, DM list and the messages its bot saw |
| Activity log | Its runs as the activity inspector shows them |
| Discord bot token | **Off by default**: the only credential that belongs to an agent. Whoever holds a file with it can run the bot |

API keys, ChatGPT logins and Discord owner accounts belong to people (docs/users.md#model-connections) and are never in the file; the agent only names them, which is what shows in red on another swarm. Anything secret the agent was told stays in its context and chats like any other content. Exporting is audited (`agent.export`).

**Format** (`backend/src/agent-archive.ts`, `agent-export.ts`): a gzip'd POSIX tar of `manifest.json` (`format: "swarm-agent"`, `version: 1`, the export time, the app version, the switches), `agent.json`, `links.json`, `timers.json`, `emojis.json` and, as chosen, `session.json` + `session-entries.jsonl`, `memories.jsonl`, `scratch.jsonl` + `scratch/<n>`, `messages.jsonl`, `reactions.jsonl`, `dm-messages.jsonl`, `files.jsonl` + `files/<sha256>`, `discord.json`, `discord-messages.jsonl`, `activity.jsonl`. A newer `version` is refused with "update to import it".

## Import

**Import agent…** (Chat → right-click the list) takes a `.swarm-agent` file (`POST /api/agents/import?organizationId=…`, the raw file as the body) into the organization shown (the first one when all are shown). The file is unpacked to a temporary file, at most 4 GiB in and 16 GiB unpacked, with only plain files of safe names; anything else is refused (`400`). Importing is audited (`agent.import`).

The result is always a **new** agent: every id it owns is new, and the old ids of the agent, its channels, messages and files are rewritten wherever they appear, inside its saved context too, so it reads its own past correctly. Its settings are kept **exactly as they were, even when they do not work here**. Memories keep their provenance (it is the same agent, moved). Links resolve by id when the computer, agent or group exists here in the same organization; the rest are kept in `Agent.unresolved`. DMs with an agent that is not here are not brought over (the import reports how many). Files keep their content hash, so a file already here is stored once. If anything fails, nothing of the new agent is left behind.

## Paused until reviewed

An imported agent starts **paused** (`Agent.paused`): grayed in the chat list ("Paused · review its settings to resume it"), its chat shows "<name> is paused until you review its settings and resume it" with **Review settings** instead of a composer, and nothing runs: messages to it are refused (`409`), as are DMs from other agents; its timers' firings wait (delivered once it resumes, marked "you were paused then"); heartbeats, sleep and restart checks skip it; its Discord bot stays offline. Import opens its settings at once.

At the top of its settings, **Needs attention** lists what does not work here, in red (`GET /api/agents/:id/review`, `backend/src/agent-review.ts`): a model row whose provider is not one of the owner's connections (or a ChatGPT account that is missing or signed out), with **Switch provider** (the row is red in Model too, "This provider does not exist here. Open the row and switch to one of your connections."); a computer, agent or group chat that is not here, with **Remove** (`POST /api/agents/:id/review/remove`); and Discord channels without a bot token, with **Go to Discord**. **Resume <name>** (`POST /api/agents/:id/resume`) is enabled once nothing is red: it unpauses the agent, delivers its waiting timer firings and connects its Discord bot. The banner also appears for any agent whose settings stop working, paused or not.
