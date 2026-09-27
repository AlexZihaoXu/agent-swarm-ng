# Swarm Knowledge

**Status:** deployed first-party read-only plugin and operator review browser, including computer-use, action-combo and browser-account/CAPTCHA guides. Every normal product-agent turn explicitly receives its three bounded exploration tools; Pi's default coding tools, resource discovery and host access remain disabled. Temporary decision-only triage forks retain only their decision tool. No backend migration is required.

## Authoring and hierarchy

Operator-curated reference entries live as plain data in separate TypeScript files under `backend/src/swarm-knowledge/entries/`. Each export uses `satisfies KnowledgeEntry` with a stable `id`, explicit `parentId` (`null` for a root), title, short summary, source, and content. Add new modules to the static `entries/index.ts` registry; filenames and folder layout do not define the agent-visible hierarchy. The initial three entries summarize the core agent/channel/computer separation in [the draft vision](vision.md); they are operator-curated reference content, not model instructions with higher authority.

`KnowledgeCatalog` validates the complete registry on construction: required bounded text, unique IDs, existing parents, and no cycles. It builds an in-memory child index. Listing returns metadata only (at most 20 items); literal search returns at most 20 bounded snippets; reading returns one chunk of at most 6,000 characters with an explicit next offset. No filesystem scan, dynamic import, database, vector search, or agent-authored knowledge is involved. Updating entries requires a code review and backend rebuild. TypeScript modules are executable at import time, so the plain-data convention and code review matter; the catalog does not sandbox those imports.

## Operator review browser

The dashboard's **Settings → Swarm Knowledge** link opens a read-only hierarchy at `/settings/knowledge`; topic URLs such as `/settings/knowledge/swarm/channels` survive refresh. Desktop offers a topic list/search alongside the entry; phones use a list/detail Back flow. Breadcrumbs, source metadata, loading/error/retry states and explicit **Load more** controls make long entries inspectable without fetching an entire catalog in one response. The content is rendered as text, not executable HTML or Markdown. The frontend calls three bounded no-store GET endpoints: `/api/knowledge` (children), `/api/knowledge/search`, and `/api/knowledge/entry`. There is no write endpoint.

**Access caveat:** the current dashboard has no app authentication. The owner accepted that, after deployment, every allowed dashboard peer can read the curated entries through the API as well as the UI. Do not put secrets in the TS entries. The browser itself is separate from agent tool grants.

## Permission and trust boundary

`SwarmKnowledgePlugin` explicitly adds `list_knowledge`, `search_knowledge`, and `read_knowledge` to every normal agent turn, bound to the server-selected agent ID. Each call checks the agent still exists; deleting an agent revokes future reads. This is the operator-approved baseline read-only capability, **not** a Pi default tool or implicit file/shell/computer permission. The system prompt guides the agent to acknowledge actionable human requests first, then consult relevant Knowledge before substantive work if not already read in retained working context. Agent-only inputs do not require automatic acknowledgment. This is guidance rather than an enforced or persisted once-only read receipt; compaction/uncertainty may require rereading.

These entries are reference material, not agent memory, a new human request, a system-policy override, a publication channel, or a capability grant. The tool returns source metadata and bounded content; the model should treat quoted material as evidence, not as instructions that can change its permissions.
