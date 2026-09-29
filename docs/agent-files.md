# Agent files: scratchpad, chat files and copying

Status: in progress on `feat/agent-files` (see the working ticket). This page grows with each step.

## Settings → Swarm

Operator-wide limits live in one `SwarmSettings` database row and are edited in **Settings → Swarm** (the last section), not in environment variables:

| Setting | Default | Range |
| --- | --- | --- |
| Computers (most that can exist at once) | 4 | 1–100 |
| Largest chat file | 100 MB | 1–1024 MB |
| Total file storage | 10 GB | 1–10000 GB |
| Largest scratch file | 1024 KB | 16–16384 KB |
| Scratch files per agent | 500 | 10–10000 |
| Scratch space per agent | 50 MB | 1–10240 MB |

`GET`/`PATCH /api/settings/swarm` read and change them (whole numbers within range; unknown keys refused). The former `COMPUTER_MAX_COUNT` environment variable is gone: the backend sends the computer limit with each create, and the controller still refuses a create past it or past its own ceiling of 100. Nothing is ever deleted automatically when a limit is lowered or reached; new files are refused instead.

## Scratchpad

Every agent has a private scratchpad of **text files kept in the platform database** (`ScratchFile` rows, one per path), with or without a computer. It is for drafting, editing and presenting artifacts to the human, **not memory**, and other agents cannot see it.

- **Paths** are relative and `/`-separated, at most **3 folders deep** (`a/b/c/file.md`), with no empty, `.`, `..` or control-character parts. Folders exist while they hold files; a file and a folder cannot share a name.
- **Tools** (every agent): `scratch_list`, `scratch_read` (paged like the computer `read`: 200 lines by default, up to 2000 lines / 50,000 bytes, `nextOffset`/`prevOffset`), `scratch_write`, `scratch_edit` (1–100 exact, unique, non-overlapping replacements, all checked first; a concurrent change is refused), `scratch_move` and `scratch_delete` (files or whole folders). Mistakes come back as tool errors for the agent to correct.
- **Limits** come from Settings → Swarm and are checked on every change (file size, file count, total bytes). Nothing is deleted automatically. Deleting an agent deletes its scratchpad.
- **Live status.** While an agent changes its scratchpad the backend broadcasts `scratch_activity` events; the chat status line (main chat and the floating chat) shows "*Agent* is writing *path* in its scratchpad…" with a short linger, below typing in priority.
- **Human view.** **Agents → agent → Scratchpad** is a read-only browser (breadcrumbs, folders and files with sizes, a paged text preview, usage against the limits), laid out like the computer File browser. It refreshes when the agent writes. `GET /api/agents/:id/scratch?folder=` and `/api/agents/:id/scratch/file?path=&offset=&limit=` back it; there is no write route: the human asks the agent.
- **Knowledge:** `concepts/scratchpad`; the system prompt carries a short Scratchpad section.
