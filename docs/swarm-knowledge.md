# Swarm Knowledge

**Status:** deployed first-party read-only plugin and operator review browser, including computer-use, action-combo and browser-account/CAPTCHA guides. Every normal product-agent turn explicitly receives its three bounded exploration tools; Pi's default coding tools, resource discovery and host access remain disabled. Temporary decision-only triage forks retain only their decision tool. No backend migration is required.

## Structure

Knowledge has two roots, cross-linked:

- **`concepts`**: what things are, the terminology. `concepts/tools` (every tool an agent can have: what it does, when it is granted, when to use it), `concepts/system` (the platform's parts, what is saved, what happens on a restart, shutdown or power loss), `concepts/agents`, `concepts/channels`, `concepts/platform-events`, `concepts/time`, `concepts/scratchpad`, `concepts/chat-files`, `concepts/discord` with `/attention`, and `concepts/computers` with `/desktop`, `/terminals`, `/files` and `/watches`.
- **`practices`**: how and when, the steps, choices and etiquette. `practices/communication`, `practices/computer-use`, `practices/desktop`, `practices/browser`, `practices/terminals`, `practices/files`, `practices/sharing-files` (paste, present live or upload; moving files), `practices/discord` (being a good member on Discord), `practices/waiting` (timers vs reminders vs watches vs terminal events), `practices/scheduling`, `practices/harnesses` (third-party coding agents; `practices/harnesses/claude-code`: install, sign-in check, a numbered choice of login method for the human, the login flow, driving it in a dedicated terminal) and `practices/dashboard` (where things are in the app, with `/agents`, `/computers`, `/chat`, `/settings`, so an agent can answer "how do I assign you a computer?").

Every concept lists the practices that use it and vice versa. Entries are kept lean and grouped: one entry per thing an agent reads together, not one per tool.

The system prompt tells agents that their first instinct on a new problem is to check whether a tool already does it (`concepts/tools`) and whether Knowledge documents how, and to answer questions about the swarm itself (capabilities, restarts, where things are in the app) from Knowledge rather than guessing.

## Authoring and hierarchy

Operator-curated reference entries live as plain data in TypeScript files under `backend/src/swarm-knowledge/entries/` (`concepts.ts`, `system.ts`, `practices.ts`, `harnesses.ts`, `dashboard.ts`). Each export uses `satisfies KnowledgeEntry` with a stable `id`, explicit `parentId` (`null` for a root), title, short summary, source, content, and optional `related` IDs. Add new modules to the static `entries/index.ts` registry; filenames and folder layout do not define the agent-visible hierarchy. They are operator-curated reference content, not model instructions with higher authority.

**Links.** A read returns `related`: the entry's explicit `related` IDs first, then every other entry whose ID appears in its text. The dashboard browser lists them under **Related** and turns IDs in the text into links.

**Aliases.** IDs from before the concepts/practices split (`swarm`, `swarm/channels`, `swarm/computers`, `swarm/computers/use|actions|browser|files|terminals`, `swarm/time`) still resolve, because agents' saved conversations remember them; a read through an alias reports `movedFrom`, and the browser moves the address to the current ID.

`KnowledgeCatalog` validates the complete registry on construction: required bounded text, unique IDs, existing parents and related entries, aliases that point at existing entries and do not shadow one, and no cycles. It builds an in-memory child index. Listing returns metadata only (at most 20 items); literal search returns at most 20 bounded snippets; reading returns one chunk of at most 6,000 characters with an explicit next offset. No filesystem scan, dynamic import, database, vector search, or agent-authored knowledge is involved. Updating entries requires a code review and backend rebuild. TypeScript modules are executable at import time, so the plain-data convention and code review matter; the catalog does not sandbox those imports.

## Operator review browser

The dashboard's **Settings → Swarm Knowledge** link opens a read-only hierarchy at `/settings/knowledge`; topic URLs such as `/settings/knowledge/practices/waiting` survive refresh. Desktop offers a topic list/search alongside the entry; phones use a list/detail Back flow. Breadcrumbs, source metadata, loading/error/retry states and explicit **Load more** controls make long entries inspectable without fetching an entire catalog in one response. The content is rendered as text, not executable HTML or Markdown. The frontend calls three bounded no-store GET endpoints: `/api/knowledge` (children), `/api/knowledge/search`, and `/api/knowledge/entry`. There is no write endpoint.

**Access caveat:** the current dashboard has no app authentication. The owner accepted that, after deployment, every allowed dashboard peer can read the curated entries through the API as well as the UI. Do not put secrets in the TS entries. The browser itself is separate from agent tool grants.

## Permission and trust boundary

`SwarmKnowledgePlugin` explicitly adds `list_knowledge`, `search_knowledge`, and `read_knowledge` to every normal agent turn, bound to the server-selected agent ID. Each call checks the agent still exists; deleting an agent revokes future reads. This is the operator-approved baseline read-only capability, **not** a Pi default tool or implicit file/shell/computer permission. The system prompt guides the agent to acknowledge actionable human requests first, then consult relevant Knowledge before substantive work if not already read in retained working context. Agent-only inputs do not require automatic acknowledgment. This is guidance rather than an enforced or persisted once-only read receipt; compaction/uncertainty may require rereading.

These entries are reference material, not agent memory, a new human request, a system-policy override, a publication channel, or a capability grant. The tool returns source metadata and bounded content; the model should treat quoted material as evidence, not as instructions that can change its permissions.

## Cues

An entry may list `cues`: lower-case phrases that bring it to mind. When an agent's input or tool call contains one, cue-driven recall attaches a one-line pointer to the entry (see [Knowledge pointers](agent-memory.md#knowledge-pointers)). Keep cues few and specific (a product name, a command, a phrase people use), since a broad word would point to the entry everywhere; entries without cues are only pointed to by their tool family's first use.
