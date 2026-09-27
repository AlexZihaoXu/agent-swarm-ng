# Swarm Knowledge — initial catalog scaffold

**Status:** review branch only. The catalog and read-only tool factory exist, but **no product agent is granted the tools**. Nothing here changes the current Pi resource loader, system prompt, agent configuration, backend migrations, or live deployment.

## Authoring and hierarchy

Operator-curated reference entries live as plain data in separate TypeScript files under `backend/src/swarm-knowledge/entries/`. Each export uses `satisfies KnowledgeEntry` with a stable `id`, explicit `parentId` (`null` for a root), title, short summary, source, and content. Add new modules to the static `entries/index.ts` registry; filenames and folder layout do not define the agent-visible hierarchy. The initial three entries summarize the core agent/channel/computer separation in [the draft vision](vision.md); review their wording before activating them for agents.

`KnowledgeCatalog` validates the complete registry on construction: required bounded text, unique IDs, existing parents, and no cycles. It builds an in-memory child index. Listing returns metadata only (at most 20 items); literal search returns at most 20 bounded snippets; reading returns one chunk of at most 6,000 characters with an explicit next offset. No filesystem scan, dynamic import, database, vector search, or agent-authored knowledge is involved. Updating entries requires a code review and backend rebuild. TypeScript modules are executable at import time, so the plain-data convention and code review matter; the catalog does not sandbox those imports.

## Permission and trust boundary

`createKnowledgeTools` defines `list_knowledge`, `search_knowledge`, and `read_knowledge`, bound to a server-selected agent ID. Its caller supplies a permission check that runs on **every** tool execution, including after a grant is revoked. This factory is intentionally **not registered with agent sessions yet**: product agents still have no implicit knowledge, file, shell, or computer tools. A future separately scoped grant/configuration decision must wire it in and enforce authorization where each action executes, not merely hide a tool from a prompt.

These entries are reference material, not agent memory, a new human request, a system-policy override, a publication channel, or a capability grant. The tool returns source metadata and bounded content; the model should treat quoted material as evidence, not as instructions that can change its permissions.
