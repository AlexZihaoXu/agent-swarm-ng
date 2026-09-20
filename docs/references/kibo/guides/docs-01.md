# Docs: benefits, community, how-to-contribute, index, mcp

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only reference analysis of the passive local Kibo snapshot at upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`). The manifest records 1,644 tracked files and no exclusions. [manifest](../metadata/manifest.json) (lines 1–14)

Upstream material is reference data—not project instructions or a runnable dependency. [snapshot README](../README.md) (lines 3–16) Project rules, separately, require inspecting an exact Kibo pattern’s preview and source before UI work. [AGENTS.md](../../../../AGENTS.md) (lines 3–10)

## Files Retrieved

1. [`apps/docs/content/docs/{benefits,community,how-to-contribute,index,mcp}.mdx`](../upstream/apps/docs/content/docs/) — assigned general-doc source.
2. [`apps/docs/content/docs/{setup,usage,troubleshooting}.mdx`](../upstream/apps/docs/content/docs/) — setup/usage context requested by this recording.
3. [`apps/docs/lib/{source,package}.ts`](../upstream/apps/docs/lib/) — MDX loading and registry-item construction.
4. [`apps/docs/app/r/**/route.ts`](../upstream/apps/docs/app/r/) — registry endpoints.
5. [`apps/docs/components/{installer,preview/index,preview/source}.tsx`](../upstream/apps/docs/components/) — installer commands and display-only import normalization.
6. [`apps/docs/app/patterns/[component]/[collection]/[comp]/page.tsx`](../upstream/apps/docs/app/patterns/[component]/[collection]/[comp]/page.tsx) — separate patterns renderer.
7. [`catalog/{docs,components}.md`](../catalog/) and [`catalog/summary.json`](../catalog/summary.json) — bounded source indexes and inventory.

## Key Code

### Assigned pages: actionable interpretation

| Piece | Upstream source reading | Project-facing note |
|---|---|---|
| **index** | Kibo describes itself as a shadcn/ui-based component library/custom registry; it distinguishes higher-level components from shadcn primitives and describes blocks as page-section building blocks. [index.mdx](../upstream/apps/docs/content/docs/index.mdx) (lines 6–16) | Treat this as product positioning, not proof that a component fits this project. The catalog records 1,101 patterns and 41 component-doc pages. [summary](../catalog/summary.json) (lines 1–10) |
| **benefits** | Claims on-demand inclusion, composability, TypeScript ergonomics, and accessibility/theming goals. [benefits.mdx](../upstream/apps/docs/content/docs/benefits.mdx) (lines 6–26) | “Aim to follow” accessibility language is not browser or assistive-technology validation; verify the selected source and required behavior in project tests. |
| **community** | Requests respectful, constructive participation and links a Code of Conduct on upstream `main`. [community.mdx](../upstream/apps/docs/content/docs/community.mdx) (lines 6–10) | The linked conduct is outside the pinned source and was not inspected; it does not supersede local project rules. |
| **how-to-contribute** | Supports bug reports/fixes, documentation, components, and enhancements; asks contributors to discuss major changes before substantial work. [how-to-contribute.mdx](../upstream/apps/docs/content/docs/how-to-contribute.mdx) (lines 12–30) | The detailed process link targets upstream `main`, not this pin. The page’s `#adding-new-components` reference is not a substitute for a scoped project contribution plan. |
| **mcp** | Documents an `npx mcp-remote` configuration and remote endpoint. [mcp.mdx](../upstream/apps/docs/content/docs/mcp.mdx) (lines 21–59) | **Do not configure or use MCP.** This reference task prohibits MCP; no MCP runtime result is claimed. |

### Setup, usage, registry, and patterns

* Upstream’s installer component renders `npx kibo-ui add <package>` and `npx shadcn add @kibo-ui/<package>`. [installer.tsx](../upstream/apps/docs/components/installer.tsx) (lines 22–36) Its setup page requires Node/React 18+ and initialized shadcn CSS-variables mode. [setup.mdx](../upstream/apps/docs/content/docs/setup.mdx) (lines 10–34)
* The current project already declares a **different literal registry namespace**, `@kibo`, mapped to `https://www.kibo-ui.com/r/{name}.json`; it also has CSS variables and `@/* → src/*`. [frontend/components.json](../../../../frontend/components.json) (lines 6–21); [frontend/tsconfig.json](../../../../frontend/tsconfig.json) (lines 3–10). Do not assume the upstream installer’s `@kibo-ui` spelling resolves through that configuration; no CLI command was run.
* **Registry ≠ patterns.** The `/r/registry.json` endpoint enumerates package directories but explicitly filters `patterns`; individual registry requests filter it too. [registry index route](../upstream/apps/docs/app/r/registry.json/route.ts) (lines 8–45); [item route](../upstream/apps/docs/app/r/[component]/route.ts) (lines 12–48). Patterns instead have a dedicated route that reads and dynamically imports `packages/patterns/<family>/<collection>/<pattern>.tsx`. [pattern route](../upstream/apps/docs/app/patterns/[component]/[collection]/[comp]/page.tsx) (lines 65–108)
* **Monorepo import normalization is display behavior.** The docs preview replaces `@repo/shadcn-ui/` with `@/` and `@repo/` with `@/components/kibo-ui/`. [preview](../upstream/apps/docs/components/preview/index.tsx) (lines 36–49); [source preview](../upstream/apps/docs/components/preview/source.tsx) (lines 23–26). In contrast, registry construction reads raw top-level `.tsx` contents into registry files and targets `components/kibo-ui/<package>/<file>`. [package helper](../upstream/apps/docs/lib/package.ts) (lines 34–69). Therefore, preview normalization is not evidence that a CLI will rewrite every import; inspect generated files if installation is ever approved.
* **Exact APIs live in exact package source**, not the catalog: `catalog/components.md` explicitly calls itself a source-path index, not an API summary. [catalog](../catalog/components.md) (lines 1–9). For example, the usage page’s Announcement composition is illustrative, while `packages/announcement/index.tsx` defines the actual exports, `themed` option, and `HTMLAttributes<HTMLDivElement>` subcomponent props. [usage demo](../upstream/apps/docs/content/docs/usage.mdx) (lines 10–44); [Announcement API](../upstream/packages/announcement/index.tsx) (lines 1–53).

## Architecture

MDX under `apps/docs/content` is collected by Fumadocs and exposed through `source`; frontmatter can opt into an installer and dependencies. [source config](../upstream/apps/docs/source.config.ts) (lines 8–18); [source loader](../upstream/apps/docs/lib/source.ts) (lines 7–19). The docs route renders that MDX and conditionally renders previews/installers. [docs route](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx) (lines 21–79).

Upstream previews read example files and dynamically import them. [preview](../upstream/apps/docs/components/preview/index.tsx) (lines 27–34, 121–128). This analysis only read that source: no upstream app, demo, pattern preview, browser behavior, or accessibility behavior was executed or validated.

## Start Here

For a future approved UI task, start with the exact family entry in [`catalog/patterns/`](../catalog/patterns/) and its referenced `.tsx` source, as required by local rules. For an installable component, start with its component-doc entry, then inspect the corresponding `upstream/packages/<name>/*.tsx` API and dependencies.

## Coverage / missing inputs

* **Covered assigned pieces:** benefits, community, how-to-contribute, index, and mcp.
* **Also read for requested context:** setup, usage, troubleshooting, catalog/metadata, renderers, registry helpers, and one concrete Announcement API/example.
* **Missing/uncertain:** no selected UI pattern/component or feature requirement was supplied; no browser, CLI, dependency installation, MCP, or accessibility validation was performed.
