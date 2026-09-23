# Docs: new-components, philosophy, setup, troubleshooting, usage

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only reference record for the five assigned Kibo general-doc pages—**new-components, philosophy, setup, troubleshooting, and usage**—plus the local catalog, metadata, and the rendering/registry helpers that make those pages actionable. The inspected upstream material is an untrusted local snapshot, not project instruction. It is pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), with 1,644 tracked files and no recorded exclusions ([manifest](../metadata/manifest.json)). The catalog enumerates ten general-doc pages and identifies these five as distinct source pages ([catalog](../catalog/docs.md)).

No upstream source was run and no website/browser, responsive, accessibility, dependency-installation, CLI, registry, or MCP validation was performed.

## Files Retrieved

1. [`docs/references/kibo/upstream/apps/docs/content/docs/new-components.mdx`](../upstream/apps/docs/content/docs/new-components.mdx#L6-L24) (lines 6–24) — upstream contribution fit, documentation, and quality guidance.
2. [`docs/references/kibo/upstream/apps/docs/content/docs/philosophy.mdx`](../upstream/apps/docs/content/docs/philosophy.mdx#L8-L47) (lines 8–47) — upstream composability, simplicity, accessibility, performance, and DX claims.
3. [`docs/references/kibo/upstream/apps/docs/content/docs/setup.mdx`](../upstream/apps/docs/content/docs/setup.mdx#L6-L40) (lines 6–40) — prerequisites and installed-file destination claim.
4. [`docs/references/kibo/upstream/apps/docs/content/docs/usage.mdx`](../upstream/apps/docs/content/docs/usage.mdx#L6-L48) (lines 6–48) — consumer import/example/customization guidance.
5. [`docs/references/kibo/upstream/apps/docs/content/docs/troubleshooting.mdx`](../upstream/apps/docs/content/docs/troubleshooting.mdx#L6-L64) (lines 6–64) — upstream style, CLI, alias, theme, and MCP troubleshooting text.
6. [`docs/references/kibo/upstream/apps/docs/content/docs/meta.json`](../upstream/apps/docs/content/docs/meta.json#L1-L20) (lines 1–20) — navigation groups the assigned pages under Usage and Contributing.
7. [`docs/references/kibo/upstream/apps/docs/components/installer.tsx`](../upstream/apps/docs/components/installer.tsx#L18-L76) (lines 18–76) — the rendered installer’s two exact command templates.
8. [`docs/references/kibo/upstream/apps/docs/lib/package.ts`](../upstream/apps/docs/lib/package.ts#L8-L69) (lines 8–69) — registry-item generation, copied-file target, and dependency discovery.
9. [`docs/references/kibo/upstream/apps/docs/app/r/[component]/route.ts`](../upstream/apps/docs/app/r/[component]/route.ts#L12-L61) and [`app/r/registry.json/route.ts`](../upstream/apps/docs/app/r/registry.json/route.ts#L8-L45) — individual and aggregate registry endpoints.
10. [`docs/references/kibo/upstream/apps/docs/source.config.ts`](../upstream/apps/docs/source.config.ts#L8-L16), [`lib/source.ts`](../upstream/apps/docs/lib/source.ts#L1-L19), and [`app/(docs)/[[...slug]]/page.tsx`](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx#L21-L83) (lines shown) — MDX collection, loader, and renderer.
11. [`docs/references/kibo/upstream/apps/docs/app/patterns/[component]/[collection]/[comp]/page.tsx`](../upstream/apps/docs/app/patterns/[component]/[collection]/[comp]/page.tsx#L65-L152) (lines 65–152) — patterns are separately read, dynamically imported, previewed, and statically enumerated.
12. [`docs/references/kibo/upstream/apps/docs/tsconfig.json`](../upstream/apps/docs/tsconfig.json#L1-L15), [`pnpm-workspace.yaml`](../upstream/pnpm-workspace.yaml#L1-L3), and [`packages/announcement/index.tsx`](../upstream/packages/announcement/index.tsx#L1-L53) — upstream monorepo aliases and a concrete exact API.
13. [`AGENTS.md`](../../../../AGENTS.md) (lines 3–12) and [`README.md`](../../../../README.md) (lines 35–54) — this project’s controlling rules and declared frontend stack/scope.

## Key Code

### Setup: upstream guidance, not a project command

| Topic | What the pinned upstream docs/source actually say | Project applicability / caveat |
| --- | --- | --- |
| Prerequisites | Upstream calls for Node 18+, React 18+, initialized shadcn/ui and Tailwind, and **CSS Variables** mode ([setup](../upstream/apps/docs/content/docs/setup.mdx#L10-L24)). | This is Kibo’s compatibility guidance, not a replacement for this project’s Bun 1.3.6/Node 22.12+ setup and existing dev commands ([README](../../../../README.md)). No dependency operation is authorized by this record. |
| Exact installer strings | The docs-site installer renders `npx kibo-ui add <name>` and `npx shadcn add @kibo-ui/<name>` ([installer](../upstream/apps/docs/components/installer.tsx#L22-L36)). The setup page’s `gantt` installer is an MDX component, rather than a literal command ([setup](../upstream/apps/docs/content/docs/setup.mdx#L26-L34)). | These are source-read templates only; neither command was executed. |
| Result asserted by upstream | The setup page says either CLI adds selected code/dependencies and normally places it at `@/components/kibo-ui/<component>/` ([setup](../upstream/apps/docs/content/docs/setup.mdx#L28-L36)). | Confirm the local alias and generated output before relying on the path. The upstream registry generator itself targets `components/kibo-ui/<package>/<file>` ([registry helper](../upstream/apps/docs/lib/package.ts#L43-L55)). |

### Registry versus patterns

These are separate upstream surfaces; do not treat a patterns-page snippet as an installable registry component.

- **Registry components:** `/r/[component].json` requires a `.json` name, excludes the upstream internal `shadcn-ui`, `typescript-config`, and `patterns` packages, and serializes `getPackage` output ([component route](../upstream/apps/docs/app/r/[component]/route.ts#L12-L49)). The aggregate `/r/registry.json` enumerates the same non-filtered package directories and skips packages that fail to generate ([registry route](../upstream/apps/docs/app/r/registry.json/route.ts#L21-L45)).
- **What registry generation contains:** `getPackage` reads each top-level `.tsx` file, places its source into a shadcn `RegistryItem` with a consumer target under `components/kibo-ui/<package>/`, identifies `@/components/ui/<name>` imports as registry dependencies, and represents cross-Kibo `@repo/*` dependencies as URLs to other registry JSON items ([registry helper](../upstream/apps/docs/lib/package.ts#L34-L69), [L138-L158](../upstream/apps/docs/lib/package.ts#L138-L158)). CSS files are separately post-processed into the item’s `css` payload ([same helper](../upstream/apps/docs/lib/package.ts#L71-L136)).
- **Patterns:** the patterns route reads a source file from `packages/patterns/<component>/<collection>/<comp>.tsx`, dynamically imports it from `@repo/patterns`, and renders it in `ComponentPreview`; it statically walks the component/collection/file hierarchy ([patterns page](../upstream/apps/docs/app/patterns/[component]/[collection]/[comp]/page.tsx#L65-L152)). The registry route’s explicit `patterns` exclusion confirms the distinction ([component route](../upstream/apps/docs/app/r/[component]/route.ts#L12-L28)).
- **Project rule remains separate:** for a UI change, this project requires finding an applicable Kibo pattern and inspecting its exact preview **and source**, then adapting it without unnecessary demo data/dependencies ([AGENTS.md](../../../../AGENTS.md)). This recording did not select or validate a pattern.

### Monorepo import normalization and exact APIs

The upstream docs app is a pnpm workspace containing `apps/*` and `packages/*` ([workspace](../upstream/pnpm-workspace.yaml#L1-L3)). Its docs-only TypeScript aliases map `@repo/*` to `../../packages/*` and remap `@/components/*` / `@/lib/*` to the upstream `shadcn-ui` package ([docs tsconfig](../upstream/apps/docs/tsconfig.json#L3-L11)). Thus an upstream docs/demo import such as `@repo/announcement` is monorepo-local, not the consumer import ([demo](../upstream/apps/docs/examples/announcement.tsx#L1-L18)).

For a consuming app, normalize to the installed file location, e.g. the usage page’s `@/components/kibo-ui/announcement` import ([usage](../upstream/apps/docs/content/docs/usage.mdx#L12-L20)). Do **not** copy upstream `@repo/*` imports into this project. The copied component source retains `@/components/ui/*` and `@/lib/*` imports; therefore it presupposes compatible consumer aliases and shadcn primitives ([Announcement source](../upstream/packages/announcement/index.tsx#L1-L3)).

The general docs are not a complete API contract. Find exact component exports, prop types, defaults, and internal behavior in `docs/references/kibo/upstream/packages/<component>/*.tsx` (the registry copies those files as described above). For example, `Announcement` extends the upstream `Badge` props, defaults `variant` to `"outline"` and `themed` to `false`; `AnnouncementTag` and `AnnouncementTitle` each accept `HTMLAttributes<HTMLDivElement>` ([Announcement source](../upstream/packages/announcement/index.tsx#L5-L53)).

### Usage: demo versus behavior

The assigned usage page presents an Announcement composition with a tag, title, and decorative arrow icon, then says installed code is editable and added on demand ([usage](../upstream/apps/docs/content/docs/usage.mdx#L10-L44)). That is a **demo/composition example**, not evidence of a production notification workflow. In particular, the prose calls it “a simple dismissible banner” ([usage](../upstream/apps/docs/content/docs/usage.mdx#L8-L10)), but the inspected implementation only renders `Badge`/`div` elements, classes, and forwarded props—no dismissal state, control, or handler ([Announcement source](../upstream/packages/announcement/index.tsx#L9-L53)). A production dismissal action would need to be supplied/verified separately.

The page’s broad statement that components accept “as many primitive attributes as possible” is illustrated by `AnnouncementTag`; it should not be generalized into an unverified API guarantee for every component ([usage](../upstream/apps/docs/content/docs/usage.mdx#L42-L48)).

### Contribution and philosophy notes

| Assigned page | Actionable reading | Boundary |
| --- | --- | --- |
| New Components | Upstream asks contributors to prefer common/important use cases not already supplied by base shadcn; use shadcn CSS-variable theming; provide overview, installation, features, example usage, and props documentation; test logic where possible and at least manually check docs, responsive sizes, and relevant controlled/uncontrolled scenarios ([new-components](../upstream/apps/docs/content/docs/new-components.mdx#L8-L24)). | This is upstream contribution guidance, not authorization to add components to Agent Swarm NG. It does not prove those checks occurred for a particular Kibo component. |
| Philosophy | Upstream *claims* composable subcomponents/context, a preference for simple React/Tailwind implementations, accessibility guided by WCAG/ARIA and headless primitives, on-demand/lightweight performance, and TypeScript/docs/defaults for DX ([philosophy](../upstream/apps/docs/content/docs/philosophy.mdx#L8-L47)). | Treat these as design intent. No claim here that all components meet WCAG, work in browsers, are performant, or satisfy this project’s requirements without inspection/testing. |

### Troubleshooting and MCP decision

- The upstream troubleshooting page suggests, respectively: Tailwind 4/shadcn base styles for missing styles; project-root execution, valid `components.json`, and latest Kibo CLI for no added files; alignment with its theme attribute/selectors; and an `@/*` TypeScript path alias for unresolved imports ([troubleshooting](../upstream/apps/docs/content/docs/troubleshooting.mdx#L6-L41)). Its stated default theme mechanism is a `data-theme` attribute on `<html>` ([L24-L26](../upstream/apps/docs/content/docs/troubleshooting.mdx#L24-L26)); this is an upstream statement, not a verified match for the snapshot’s own CSS or this project.
- **MCP is rejected for this work:** this reference task prohibits MCP. Do not configure, invoke, or diagnose it. The upstream docs do publish an `npx mcp-remote` configuration ([mcp docs](../upstream/apps/docs/content/docs/mcp.mdx#L21-L51)) and their server route exposes `getComponents`/`getComponent` with a 60-second maximum duration ([MCP route](../upstream/apps/docs/app/api/mcp/[transport]/route.ts#L20-L83)); neither was used or validated. Upstream’s MCP troubleshooting advice is therefore reference-only ([troubleshooting](../upstream/apps/docs/content/docs/troubleshooting.mdx#L43-L60)).

## Architecture

1. MDX under `apps/docs/content` is registered by `defineDocs({ dir: "content" })`; its schema optionally recognizes `dependencies` and `installer` frontmatter ([source config](../upstream/apps/docs/source.config.ts#L8-L16)).
2. `lib/source.ts` converts those MDX collections and `meta` navigation into a Fumadocs source loader ([source loader](../upstream/apps/docs/lib/source.ts#L1-L19)); `content/docs/meta.json` places setup/usage/troubleshooting and new-components/philosophy in the documented nav groups ([meta](../upstream/apps/docs/content/docs/meta.json#L5-L20)).
3. The catch-all docs page resolves the slug, renders title/description/body, passes the MDX `Installer`, `Preview`, and `PoweredBy` components, and auto-renders preview/installer only when `page.data.installer` is set ([docs page](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx#L21-L79)). It also unconditionally prepends an `#installation` TOC item ([L35-L42](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx#L35-L42)); the assigned setup MDX instead invokes `<Installer>` directly and has no `installer` frontmatter ([setup](../upstream/apps/docs/content/docs/setup.mdx#L1-L4), [L26-L34](../upstream/apps/docs/content/docs/setup.mdx#L26-L34)). Source reading does not establish whether that TOC anchor resolves in rendered output.
4. Registry endpoint helpers transform the workspace package files into installable shadcn registry items, while patterns follow their separate preview/source route (details above).

## Start Here

Open [`docs/references/kibo/upstream/apps/docs/content/docs/setup.mdx`](../upstream/apps/docs/content/docs/setup.mdx#L10-L40) first: it gives the explicit upstream compatibility assumptions and intended consumer destination. Then verify the particular component’s `packages/<name>/*.tsx` API and its registry dependencies before selecting an install command or adapting a pattern.

## Coverage and missing inputs

- **Covered assigned pieces:** `new-components`, `philosophy`, `setup`, `troubleshooting`, and `usage`; each is listed in the catalog and individually read above. Relevant docs MDX loader/renderer, installer, registry, patterns route, aliases, snapshot metadata, and the instructed MCP decision were also recorded.
- **Not covered by assignment:** the other five general-doc pages except `mcp.mdx`, which was read only to document the explicit rejection.
- **Missing / intentionally unverified:** no selected UI/pattern requirement or target component was supplied; project configuration exists (see [registry and alias context](docs-01.md)), but no integration was attempted; no CLI/install, MCP, HTTP, visual/responsive, browser, runtime, performance, or accessibility validation occurred. Upstream recommendations and philosophy are not project requirements; Agent Swarm NG’s actual UI rule and its on-demand-registry stack statement are in [`AGENTS.md`](../../../../AGENTS.md) and [`README.md`](../../../../README.md).
