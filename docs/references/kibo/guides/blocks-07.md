# Blocks: roadmap, stats, team, testimonial

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the pinned Kibo snapshot at upstream commit [`3d63cdb15b79d972e3dc38a10997987672f9b263`](../VERIFICATION.md). The foundation records that this is a passive source snapshot, with no `packages/blocks` directory, and cautions that it was not run or visually validated ([snapshot.md](../VERIFICATION.md), [limitations](../VERIFICATION.md)).

The four block MDX files are frontmatter only; implementation findings come from their matching `apps/docs/examples` source files.

## Variant/example mapping

| Block | Documentation / installer | Matching implementation(s) found | Source label / composition |
|---|---|---|---|
| Roadmap | [`blocks/roadmap.mdx` L1–12](../upstream/apps/docs/content/blocks/roadmap.mdx#L1-L12): `installer: roadmap`; declares gantt, calendar, list, kanban, table dependencies | [`examples/roadmap.tsx` L1–617](../upstream/apps/docs/examples/roadmap.tsx#L1-L617) | One example with five tab-selected views: Gantt (default), Calendar, List, Kanban, Table. |
| Stats | [`blocks/stats.mdx` L1–6](../upstream/apps/docs/content/blocks/stats.mdx#L1-L6): `installer: stats` | [`examples/stats.tsx` L1–81](../upstream/apps/docs/examples/stats.tsx#L1-L81) | One configurable component named `Stats8`; comment identifies its shadcnblocks origin. |
| Team | [`blocks/team.mdx` L1–6](../upstream/apps/docs/content/blocks/team.mdx#L1-L6): `installer: team` | [`examples/team.tsx` L1–101](../upstream/apps/docs/examples/team.tsx#L1-L101) | One configurable component named `Team1`. |
| Testimonial | [`blocks/testimonial.mdx` L1–6](../upstream/apps/docs/content/blocks/testimonial.mdx#L1-L6): `installer: testimonial` | [`examples/testimonial.tsx` L1–62](../upstream/apps/docs/examples/testimonial.tsx#L1-L62) | One configurable component named `Testimonial10`. |

The example catalog lists exactly these four matching filenames; no suffixed `roadmap*`, `stats*`, `team*`, or `testimonial*` example variants are present ([catalog/examples.md](../catalog/examples.md)).

## Roadmap

**Composition and source-read behavior**

- Module-level Faker data generates three statuses, four users, grouping/product/initiative/release records, 20 dated features, and six dated markers ([`roadmap.tsx` L79–150](../upstream/apps/docs/examples/roadmap.tsx#L79-L150)). This is demo data, not an application data contract.
- The outer Tabs header labels the block “Roadmap”; icon-only triggers include screen-reader text and default to Gantt ([L561–617](../upstream/apps/docs/examples/roadmap.tsx#L561-L617)).
- **Gantt:** groups features by group name, renders a sidebar and timeline, feature context menu, markers, today indicator, and marker-create trigger ([L152–285](../upstream/apps/docs/examples/roadmap.tsx#L152-L285)). Removing or moving a feature updates only local React state; view, copy-link, add-feature, create-marker, and remove-marker handlers only call `console.log` ([L162–191](../upstream/apps/docs/examples/roadmap.tsx#L162-L191)).
- **Calendar:** supplies the generated features to the calendar and calculates year bounds from their dates ([L287–313](../upstream/apps/docs/examples/roadmap.tsx#L287-L313)).
- **List:** groups by status and locally changes a feature’s `status` after drag end ([L315–380](../upstream/apps/docs/examples/roadmap.tsx#L315-L380)).
- **Kanban:** initializes a `column` from status ID and locally changes only `status` in its drag-end handler ([L393–472](../upstream/apps/docs/examples/roadmap.tsx#L393-L472)); the example contains no persistence or backend mutation. **Broken demo:** [`KanbanCards`](../upstream/packages/kanban/index.tsx#L159-L163) filters by `column`, which this handler never updates. Cross-column drops therefore do not persist visually; a drop over a card can fail even to update `status` because `over.id` is matched against status IDs. An approved adaptation needs consumer-owned `column` and ordering updates (see the provider’s `onDataChange` surface in [Kanban source](../upstream/packages/kanban/index.tsx)), not just a status change.
- **Table:** defines name, start date, end date, and release columns over the generated data ([L474–559](../upstream/apps/docs/examples/roadmap.tsx#L474-L559)).

**Dependencies**

The block documentation explicitly names Calendar, Gantt, List, Kanban, and Table ([`roadmap.mdx` L5–10](../upstream/apps/docs/content/blocks/roadmap.mdx#L5-L10)). The example directly imports those five Kibo workspace packages, plus shadcn Avatar, Context Menu, and Tabs primitives ([`roadmap.tsx` L3–75](../upstream/apps/docs/examples/roadmap.tsx#L3-L75)). Its upstream path aliases map `@repo/*` to `packages/*` and `@/components/*` to the shadcn package ([`apps/docs/tsconfig.json` L1–12](../upstream/apps/docs/tsconfig.json#L1-L12)).

The component packages bring nontrivial dependency surfaces: Calendar uses date-fns/Jotai/Lucide ([`packages/calendar/package.json` L6–12](../upstream/packages/calendar/package.json#L6-L12)); Gantt uses dnd-kit, hooks, date-fns, Jotai, throttling, and Lucide ([`packages/gantt/package.json` L6–16](../upstream/packages/gantt/package.json#L6-L16)); Kanban and List use dnd-kit ([`kanban/package.json` L6–13](../upstream/packages/kanban/package.json#L6-L13), [`list/package.json` L6–11](../upstream/packages/list/package.json#L6-L11)); Table uses TanStack Table and Jotai ([`table/package.json` L6–12](../upstream/packages/table/package.json#L6-L12)).

**External assets**

- User avatars are produced by `faker.image.avatar()`; the concrete remote URLs are not fixed in source ([`roadmap.tsx` L85–91](../upstream/apps/docs/examples/roadmap.tsx#L85-L91)).
- Icons are imported from `lucide-react` ([L56–66](../upstream/apps/docs/examples/roadmap.tsx#L56-L66)).

**Integration gaps**

The current application contains only a health query/status UI and explicitly says environment management is not implemented ([`frontend/src/app.tsx` L6–37](../../../../frontend/src/app.tsx)). Adopting this source would require scoped application data, mutation, authorization, and persistence decisions for every presently local/log-only action. Its upstream workspace aliases and packages are not available through the frontend’s `@/* → src/*` alias alone ([`frontend/tsconfig.json` L1–10](../../../../frontend/tsconfig.json)); the current frontend dependency list includes none of the roadmap’s Kibo workspace packages or their dnd/calendar/table dependencies ([`frontend/package.json` L13–35](../../../../frontend/package.json)).

## Stats

**Composition**

`Stats8` accepts optional `className`, heading, description, link `{text,url}`, and an array of `{id,value,label}` records ([`stats.tsx` L5–50](../upstream/apps/docs/examples/stats.tsx#L5-L50)). It renders a section containing heading, description, plain anchor with ArrowRight, and metric cards in a one-column-to-two-column-to-four-column responsive grid ([L51–75](../upstream/apps/docs/examples/stats.tsx#L51-L75)).

**Demo defaults and assets**

The four metrics and the `https://www.shadcnblocks.com` link are defaults in the example, not application facts ([`stats.tsx` L20–48](../upstream/apps/docs/examples/stats.tsx#L20-L48)). The only nonlocal visual dependency directly imported here is the Lucide `ArrowRight` icon ([L1–3](../upstream/apps/docs/examples/stats.tsx#L1-L3)); no image asset is used.

**Integration gaps**

The application has no Stats component or matching data source in its current source tree; its single screen is the scaffold status page ([`frontend/src/app.tsx` L20–47](../../../../frontend/src/app.tsx)). Direct copying also requires replacing the upstream `@repo/shadcn-ui/lib/utils` import with a local equivalent or bringing that package/alias into the application ([`stats.tsx` L1–4](../upstream/apps/docs/examples/stats.tsx#L1-L4)).

## Team

**Composition**

`Team1` accepts a heading, description, member array, and class name; each member requires `id`, `name`, `role`, and `avatar` ([`team.tsx` L9–71](../upstream/apps/docs/examples/team.tsx#L9-L71)). It renders centered heading/description followed by a responsive 1/2/3-column member grid. Each member has an Avatar image, full-name fallback, name, and role ([L72–95](../upstream/apps/docs/examples/team.tsx#L72-L95)).

**Dependencies and external assets**

It imports Kibo’s shadcn `Avatar`, `AvatarImage`, and `AvatarFallback`, plus `cn` ([`team.tsx` L1–7](../upstream/apps/docs/examples/team.tsx#L1-L7)). The referenced Avatar implementation is Radix-based ([`packages/shadcn-ui/components/ui/avatar.tsx` L1–49](../upstream/packages/shadcn-ui/components/ui/avatar.tsx#L1-L49)).

The six default people and their CloudFront WebP avatar URLs are demo content ([`team.tsx` L23–69](../upstream/apps/docs/examples/team.tsx#L23-L69)); the snapshot does not contain those remote image files or validate their availability.

**Integration gaps**

The frontend currently has only a Button under `src/components/ui` and has no Avatar implementation ([`frontend/src/components/ui/button.tsx` L1–26](../../../../frontend/src/components/ui/button.tsx)). A real team data source, privacy/authorization decision, and local or approved remote-avatar policy are absent from the inspected application source.

## Testimonial

**Composition**

`Testimonial10` accepts `className`, a quote, and structured author information: name, role, and avatar `src`/`alt` ([`testimonial.tsx` L9–33](../upstream/apps/docs/examples/testimonial.tsx#L9-L33)). It renders a centered quoted paragraph followed by Avatar and left-aligned author identity, with responsive text/avatar sizing ([L34–57](../upstream/apps/docs/examples/testimonial.tsx#L34-L57)).

**Dependencies and external assets**

It uses the same upstream shadcn Avatar and `cn` imports as Team ([`testimonial.tsx` L1–7](../upstream/apps/docs/examples/testimonial.tsx#L1-L7)). Its sole default image is a CloudFront WebP URL and its remaining copy is placeholder testimonial content ([L22–32](../upstream/apps/docs/examples/testimonial.tsx#L22-L32)). Availability, licensing, and network behavior of that asset were not validated.

**Integration gaps**

No testimonial content model, route, component, or Avatar primitive exists in the current application source inspected above. The source is presentational only: it has no API call, state mutation, moderation, or consent handling ([`testimonial.tsx` L22–57](../upstream/apps/docs/examples/testimonial.tsx#L22-L57)).

## Coverage and missing inputs

- **Covered:** 4/4 assigned block docs and 4/4 matching example implementations; all variants found under the assigned `<name>*.tsx` scope are recorded.
- **Confirmed:** no `packages/blocks` directory exists in this pinned snapshot ([snapshot.md](../VERIFICATION.md)).
- **Missing inputs:** no approved product placement, data contracts, backend endpoints, authorization rules, content ownership, or remote-asset policy were supplied.
- **Validation boundary:** findings are from local source reading only. No browser, visual, keyboard, screen-reader, network, or runtime/dependency validation is claimed.
