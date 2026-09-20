# Blocks: code-example, codebase, collaborative-canvas, community

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only analysis of Kibo snapshot commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`) as recorded in `docs/references/kibo/metadata/manifest.json:3-8`.

The assigned names each resolve to one tracked matching example (`<name>*.tsx`): `code-example`, `codebase`, `collaborative-canvas`, and `community`; see the generated example index at `docs/references/kibo/catalog/examples.md:38-46`. The docs are frontmatter only, not implementations. There is no `packages/blocks` directory; the block catalog explicitly directs readers to example sources (`docs/references/kibo/catalog/blocks.md:1-5`).

Source was read only. Nothing was run in a browser; no visual, runtime, or accessibility validation is claimed.

## Files Retrieved

1. `docs/references/kibo/upstream/apps/docs/content/blocks/code-example.mdx` (lines 1-6) — title and installer metadata.
2. `docs/references/kibo/upstream/apps/docs/examples/code-example.tsx` (lines 1-251) — sole Code Example implementation.
3. `docs/references/kibo/upstream/apps/docs/content/blocks/codebase.mdx` (lines 1-9) — declared Tree and Code Block dependencies.
4. `docs/references/kibo/upstream/apps/docs/examples/codebase.tsx` (lines 1-425) — sole Codebase implementation.
5. `docs/references/kibo/upstream/apps/docs/content/blocks/collaborative-canvas.mdx` (lines 1-9) — declared Avatar Stack and Cursor dependencies.
6. `docs/references/kibo/upstream/apps/docs/examples/collaborative-canvas.tsx` (lines 1-162) — sole Collaborative Canvas implementation.
7. `docs/references/kibo/upstream/apps/docs/content/blocks/community.mdx` (lines 1-6) — title and installer metadata.
8. `docs/references/kibo/upstream/apps/docs/examples/community.tsx` (lines 1-85) — sole Community implementation.
9. `docs/references/kibo/upstream/packages/code-block/index.tsx` (lines 265-638) — syntax highlighting, selection, and copy behavior.
10. `docs/references/kibo/upstream/packages/tree/index.tsx` (lines 59-445) — controlled selection and animated expansion behavior.
11. `docs/references/kibo/upstream/packages/avatar-stack/index.tsx` (lines 4-51) and `packages/cursor/index.tsx` (lines 4-62) — canvas primitives.
12. `frontend/package.json` (lines 13-36), `frontend/vite.config.ts` (lines 1-34), and `frontend/src/components/ui/button.tsx` (lines 6-26) — current integration constraints.

## Key Code

| Block / variant | Composition and demonstrated behavior | Kibo/shadcn dependencies | Integration and asset notes |
|---|---|---|---|
| **Code Example** — `CodeExample1` | Two-column marketing section: tagline, heading, description, CTA, four language tabs, filename header, copy button, and horizontally scrollable code body (`apps/docs/examples/code-example.tsx:154-245`). Tab state controls `CodeBlock` with matching language values (`:163-240`). Demo data is four static snippets, not application code (`:30-142`). | `@repo/code-block`; shadcn Button, ScrollArea, Tabs (`:8-21`). CodeBlock performs async Shiki highlighting with a plaintext fallback (`packages/code-block/index.tsx:607-638`) and copy uses `navigator.clipboard` only when a matching selected item exists (`:479-529`). | The default CTA is `#` (`apps/docs/examples/code-example.tsx:159-160`). The example logs copy success/failure to the console (`:215-219`), rather than exposing app feedback. Kibo package dependencies include Radix controllable state, Shiki/transformers, Lucide, and react-icons (`packages/code-block/package.json:6-15`), none of which should be assumed available merely from this snapshot. |
| **Codebase** — `CodebaseExample` | Fixed 300px explorer plus code viewer (`apps/docs/examples/codebase.tsx:291-423`). The tree starts with `src/components/ui/app` expanded and a selected `button.tsx`; selecting a node updates local `selectedFile` only if it exists in the static record (`:273-303`). It displays six hard-coded illustrative files (`:34-271`), not a repository browser. | Docs explicitly declare `/components/tree` and `/components/code-block` (`apps/docs/content/blocks/codebase.mdx:5-8`). Tree provider supports controlled selection, expansion, optional multi-select, lines, icons, and Motion animation (`packages/tree/index.tsx:59-165`); triggers are animated `div`s clicked to toggle/select (`:224-256`). Code viewer uses CodeBlock and Lucide file icons (`apps/docs/examples/codebase.tsx:3-26`). | **Source-level defect to resolve if copied:** CodeBlock copy locates content by `item.language === value` (`packages/code-block/index.tsx:488-490`), while this example’s `value` is a filename and its language is values such as `tsx`/`typescript` (`apps/docs/examples/codebase.tsx:274-283,397-417`). Thus the displayed file changes, but the bundled copy button has no matching code value. Tree additionally requires `motion` (`packages/tree/package.json:6-11`). |
| **Collaborative Canvas** — `Example` | A 4:3 dotted canvas containing an animated stacked avatar group and three absolute-positioned cursors (`apps/docs/examples/collaborative-canvas.tsx:113-159`). Each cursor position is changed by separate local intervals with random coordinates (`:50-105`); it is a visual simulation, not a realtime/collaboration transport implementation. | Docs declare Avatar Stack and Cursor (`apps/docs/content/blocks/collaborative-canvas.mdx:5-8`). AvatarStack overlaps children and optionally expands on hover (`packages/avatar-stack/index.tsx:18-50`). Cursor is presentational and pointer-events-disabled; its pointer SVG is explicitly `aria-hidden`/unfocusable (`packages/cursor/index.tsx:6-34`). | Imports Next’s `Image` (`apps/docs/examples/collaborative-canvas.tsx:12`) although the application frontend is Vite (`frontend/vite.config.ts:1-8`). It imports `@/components/ui/avatar`, but the current frontend component inventory contains only `components/ui/button.tsx`. The demo uses three remote GitHub avatar URLs in both AvatarImage and `Image`; the latter is `unoptimized` (`apps/docs/examples/collaborative-canvas.tsx:16-33,116-152`). Replace demo identities and define image/network policy before adoption. |
| **Community** — `Community2` | Static section with configurable heading, description, and social-link array; defaults produce a responsive 1/2/4-column card grid (`apps/docs/examples/community.tsx:13-79`). Hover only reveals/translates the arrow icon (`:60-75`). | `cn`, Lucide `ArrowUpRight`, and `react-icons/fa6` (`:1-4`). No Kibo package component is imported and the MDX declares no dependencies (`apps/docs/content/blocks/community.mdx:1-6`). | Default outbound URLs target X, LinkedIn, and GitHub; Discord is a `#` placeholder (`apps/docs/examples/community.tsx:23-48`). The current frontend dependency list does not declare Lucide or react-icons (`frontend/package.json:13-35`). Links have no `target`/`rel`; any external-navigation policy is an application decision. |

## Architecture

The block MDX pages provide only title, description, installer, and—in two cases—declared component dependencies; the corresponding TSX files are the actual compositions. The source is a monorepo-style example layer: imports such as `@repo/code-block`, `@repo/tree`, and `@repo/shadcn-ui` must be adapted or supplied rather than treated as installed application modules.

The current application uses React + Vite and describes Kibo as an on-demand registry (`README.md:45-52`). Its Vite aliases only `@` to `frontend/src` (`frontend/vite.config.ts:28`), so the examples’ `@repo/*` imports do not have a configured local resolution path. The existing Button also lacks the Kibo example’s required `lg` and `icon` sizes and `ghost` variant (`frontend/src/components/ui/button.tsx:6-26`), making direct reuse of Code Example’s Button calls incompatible without component adaptation.

## Start Here

Open `docs/references/kibo/upstream/apps/docs/examples/codebase.tsx` first. It is the most stateful assigned block and exposes the important filename-versus-language copy mismatch; then read `packages/code-block/index.tsx:473-638` before deciding whether to adapt its API or use a simpler viewer.

## Coverage / missing inputs

- **Covered:** all four assigned MDX pages and all four matching tracked implementations: Code Example, Codebase, Collaborative Canvas, and Community.
- **Variants:** one matching TSX implementation found per assigned name; no `packages/blocks` source exists in this pinned snapshot.
- **Missing inputs before implementation:** intended app placement and real data model; whether code content is trusted; desired collaboration transport/presence semantics; approved dependency additions/adaptations; approved social destinations; and an external-avatar/image policy.
- **Not performed:** dependency operations, source edits, runtime execution, browser checks, or accessibility validation.
