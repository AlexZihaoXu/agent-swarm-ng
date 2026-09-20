# Components: kanban, list, marquee, mini-calendar, pill

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only reference analysis of Kibo UI snapshot revision [`3d63cdb15b79d972e3dc38a10997987672f9b263`](../metadata/manifest.json), sourced from the pinned upstream tree. The catalog indexes the five assigned documentation pages as component docs, not patterns ([catalog](../catalog/components.md)).

This report is source reading only: no dependencies were installed, no examples were run, and no browser, visual, or accessibility validation is claimed. “Example” observations below describe demo source rather than production integration.

## Files Retrieved

1. [`apps/docs/content/components/kanban.mdx`](../upstream/apps/docs/content/components/kanban.mdx#L1-L19) — assigned docs page.
2. [`packages/kanban/index.tsx`](../upstream/packages/kanban/index.tsx#L1-L338) and [`package.json`](../upstream/packages/kanban/package.json#L1-L21) — implementation, exports, and direct dependencies.
3. [`apps/docs/examples/kanban.tsx`](../upstream/apps/docs/examples/kanban.tsx#L1-L108), [`kanban-simple.tsx`](../upstream/apps/docs/examples/kanban-simple.tsx#L1-L89), and [`roadmap.tsx`](../upstream/apps/docs/examples/roadmap.tsx#L393-L470) — every matching Kanban import.
4. [`apps/docs/content/components/list.mdx`](../upstream/apps/docs/content/components/list.mdx#L1-L20), [`packages/list/index.tsx`](../upstream/packages/list/index.tsx#L1-L152), and [`package.json`](../upstream/packages/list/package.json#L1-L19) — List reference and implementation.
5. [`apps/docs/examples/list.tsx`](../upstream/apps/docs/examples/list.tsx#L1-L109), [`list-simple.tsx`](../upstream/apps/docs/examples/list-simple.tsx#L1-L92), and [`roadmap.tsx`](../upstream/apps/docs/examples/roadmap.tsx#L315-L376) — every matching List import.
6. [`apps/docs/content/components/marquee.mdx`](../upstream/apps/docs/content/components/marquee.mdx#L1-L28), [`packages/marquee/index.tsx`](../upstream/packages/marquee/index.tsx#L1-L59), and [`package.json`](../upstream/packages/marquee/package.json#L1-L18) — Marquee API and metadata.
7. [`apps/docs/examples/marquee.tsx`](../upstream/apps/docs/examples/marquee.tsx#L1-L30), [`marquee-no-fade.tsx`](../upstream/apps/docs/examples/marquee-no-fade.tsx#L1-L21), [`marquee-raw.tsx`](../upstream/apps/docs/examples/marquee-raw.tsx#L1-L30), [`marquee-spacing.tsx`](../upstream/apps/docs/examples/marquee-spacing.tsx#L1-L30), [`about.tsx`](../upstream/apps/docs/examples/about.tsx#L102-L123), and [`hero.tsx`](../upstream/apps/docs/examples/hero.tsx#L104-L123) — every matching Marquee import.
8. [`apps/docs/content/components/mini-calendar.mdx`](../upstream/apps/docs/content/components/mini-calendar.mdx#L1-L38), [`packages/mini-calendar/index.tsx`](../upstream/packages/mini-calendar/index.tsx#L1-L230), and [`package.json`](../upstream/packages/mini-calendar/package.json#L1-L21) — composable calendar API.
9. [`apps/docs/examples/mini-calendar.tsx`](../upstream/apps/docs/examples/mini-calendar.tsx#L1-L20), [`mini-calendar-controlled.tsx`](../upstream/apps/docs/examples/mini-calendar-controlled.tsx#L1-L39), [`mini-calendar-custom.tsx`](../upstream/apps/docs/examples/mini-calendar-custom.tsx#L1-L34), [`mini-calendar-days.tsx`](../upstream/apps/docs/examples/mini-calendar-days.tsx#L1-L20), and [`form.tsx`](../upstream/apps/docs/examples/form.tsx#L221-L241) — every matching Mini Calendar import.
10. [`apps/docs/content/components/pill.mdx`](../upstream/apps/docs/content/components/pill.mdx#L1-L63), [`packages/pill/index.tsx`](../upstream/packages/pill/index.tsx#L1-L166), and [`package.json`](../upstream/packages/pill/package.json#L1-L18) — Pill API and metadata.
11. [`apps/docs/examples/pill.tsx`](../upstream/apps/docs/examples/pill.tsx#L1-L81), [`pill-avatar.tsx`](../upstream/apps/docs/examples/pill-avatar.tsx#L1-L15), [`pill-status.tsx`](../upstream/apps/docs/examples/pill-status.tsx#L1-L16), [`pill-button.tsx`](../upstream/apps/docs/examples/pill-button.tsx#L1-L15), [`pill-indicator.tsx`](../upstream/apps/docs/examples/pill-indicator.tsx#L1-L18), [`pill-delta.tsx`](../upstream/apps/docs/examples/pill-delta.tsx#L1-L22), [`pill-icon.tsx`](../upstream/apps/docs/examples/pill-icon.tsx#L1-L13), and [`pill-avatar-group.tsx`](../upstream/apps/docs/examples/pill-avatar-group.tsx#L1-L25) — every matching Pill import.
12. shadcn helpers used by the assigned packages: [`button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L1-L60), [`badge.tsx`](../upstream/packages/shadcn-ui/components/ui/badge.tsx#L1-L46), [`avatar.tsx`](../upstream/packages/shadcn-ui/components/ui/avatar.tsx#L1-L53), [`card.tsx`](../upstream/packages/shadcn-ui/components/ui/card.tsx#L1-L92), [`scroll-area.tsx`](../upstream/packages/shadcn-ui/components/ui/scroll-area.tsx#L1-L58), and [`utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6).

## Key Code

### Package inventory

Each assigned package contains `index.tsx`, `package.json`, and `tsconfig.json` only in the snapshot metadata: Kanban through Mini Calendar ([manifest](../metadata/manifest.json)) and Pill ([manifest](../metadata/manifest.json)). Therefore, there is **no separate package CSS file** for these pieces; styling is Tailwind class strings in the TSX implementations.

| Piece | Actual exports | Direct runtime dependencies |
| --- | --- | --- |
| Kanban | `KanbanBoard`, `KanbanCard`, `KanbanCards`, `KanbanHeader`, `KanbanProvider`; re-exports `DragEndEvent` ([source](../upstream/packages/kanban/index.tsx#L38-L338)) | dnd-kit core/sortable/utilities, React/DOM, `tunnel-rat`, workspace shadcn-ui ([metadata](../upstream/packages/kanban/package.json#L6-L15)) |
| List | `ListItems`, `ListHeader`, `ListGroup`, `ListItem`, `ListProvider`; re-exports `DragEndEvent` ([source](../upstream/packages/list/index.tsx#L14-L152)) | dnd-kit core/modifiers, React/DOM, workspace shadcn-ui ([metadata](../upstream/packages/list/package.json#L6-L13)) |
| Marquee | `Marquee`, `MarqueeContent`, `MarqueeFade`, `MarqueeItem` ([source](../upstream/packages/marquee/index.tsx#L8-L59)) | `react-fast-marquee`, React/DOM, workspace shadcn-ui ([metadata](../upstream/packages/marquee/package.json#L6-L12)) |
| Mini Calendar | `MiniCalendar`, `MiniCalendarNavigation`, `MiniCalendarDays`, `MiniCalendarDay` ([source](../upstream/packages/mini-calendar/index.tsx#L57-L230)) | Radix controllable state and Slot, date-fns, Lucide, React/DOM, workspace shadcn-ui ([metadata](../upstream/packages/mini-calendar/package.json#L6-L15)) |
| Pill | `Pill`, `PillAvatar`, `PillButton`, `PillStatus`, `PillIndicator`, `PillDelta`, `PillIcon`, `PillAvatarGroup` ([source](../upstream/packages/pill/index.tsx#L8-L166)) | Lucide, React/DOM, workspace shadcn-ui ([metadata](../upstream/packages/pill/package.json#L6-L12)) |

### Kanban — composable, externally owned board state

- `KanbanProvider` requires `columns`, `data`, and a render function; items require `id`, `name`, and `column`, while columns require `id` and `name` ([types](../upstream/packages/kanban/index.tsx#L40-L58), [provider props](../upstream/packages/kanban/index.tsx#L185-L212)). It stores only the active card ID; it does **not** own board data.
- Use `onDataChange` to persist package-generated cross-column/reorder changes. On crossing a column, the provider shallow-copies the array, changes the active item’s `column`, moves it, and emits the array; on drag end it emits a reordered array ([handlers](../upstream/packages/kanban/index.tsx#L229-L282)).
- `KanbanCards` filters provider data using `item.column === id`; `KanbanCard` is sortable and supplies a drag-overlay copy via `tunnel-rat` ([source](../upstream/packages/kanban/index.tsx#L96-L176)). Board IDs and `data[].column` must therefore use the same identifier domain.
- The provider installs mouse, touch, and keyboard sensors, `closestCenter` collision detection, a `DragOverlay`, and custom dnd-kit announcement strings ([source](../upstream/packages/kanban/index.tsx#L215-L335)). This is source evidence of configuration, not a browser or assistive-technology validation result.
- Gotcha: the drag-end reorder path derives `newIndex` from an item lookup without guarding an `over` target that is a board rather than an item ([source](../upstream/packages/kanban/index.tsx#L268-L281)); the resulting behavior is delegated to `arrayMove` and was not executed here.

**Usage variations.** The rich component example owns `features` with `useState` and passes `onDataChange={setFeatures}`, with custom card children and avatar/date content ([example](../upstream/apps/docs/examples/kanban.tsx#L43-L106)). The simple documentation example instead maps state in `onDragEnd` and renders default cards ([example](../upstream/apps/docs/examples/kanban-simple.tsx#L42-L87)). The unrelated Roadmap demo imports Kanban as one view, but its handler changes `status` rather than the filtered `column` field ([source](../upstream/apps/docs/examples/roadmap.tsx#L393-L470)); treat that as demo source, not a state-management recipe.

### List — DnD primitives, consumer-owned mutations

- `ListProvider` wraps a dnd-kit context using `rectIntersection` and `restrictToVerticalAxis`, and requires a consumer `onDragEnd`; it contains no list state or reorder/move algorithm ([source](../upstream/packages/list/index.tsx#L134-L152)).
- `ListGroup` is a droppable keyed by `id`; `ListItem` is draggable and puts its required `index` and `parent` into dnd-kit drag data. `ListHeader` supports either arbitrary `children` or `name`/`color` rendering ([source](../upstream/packages/list/index.tsx#L41-L132)).
- Consequently, callers must update their own grouping/order from `active`/`over`; the implementation does not consume `index` or `parent` itself after placing them in drag data.
- The docs list dnd-kit and Lucide as dependencies ([docs](../upstream/apps/docs/content/components/list.mdx#L1-L15)), but the package’s direct dependency list has dnd-kit and no direct Lucide entry ([metadata](../upstream/packages/list/package.json#L6-L13)).

**Usage variations.** Both dedicated examples use local feature state, find a status by `over.id`, and replace the active feature’s status; the full version supplies custom dot/avatar children, while simple uses default item text ([full](../upstream/apps/docs/examples/list.tsx#L43-L107), [simple](../upstream/apps/docs/examples/list-simple.tsx#L42-L90)). Roadmap repeats the custom-content approach inside a tabbed demo ([source](../upstream/apps/docs/examples/roadmap.tsx#L315-L376)).

### Marquee — wrapper around `react-fast-marquee`, not a DnD component

- `Marquee` is the overflow-hidden relative `<div>` wrapper; `MarqueeContent` forwards `react-fast-marquee` props while defaulting `loop=0`, `autoFill=true`, and `pauseOnHover=true`; `MarqueeFade` requires `side: "left" | "right"`; `MarqueeItem` defaults to horizontal margin (`mx-2`) ([source](../upstream/packages/marquee/index.tsx#L8-L59)).
- The docs’ feature bullets say “Drag and drop items between groups” and “Customize the item contents” ([docs](../upstream/apps/docs/content/components/marquee.mdx#L10-L13)), but this implementation has no drag/drop code. Its direct metadata has `react-fast-marquee` but not the docs-listed `usehooks` dependency ([metadata](../upstream/packages/marquee/package.json#L6-L12)).
- Fades are optional, visual overlay elements. Their default gradient starts from `background`; callers can override it with `className` (as the hero example does with `from-secondary`) ([implementation](../upstream/packages/marquee/index.tsx#L33-L50), [example](../upstream/apps/docs/examples/hero.tsx#L104-L123)).

**Usage variations.** Dedicated examples cover both fades, no fades, explicitly setting `autoFill={false}`, `loop={1}`, `pauseOnHover={false}`, and compacting item spacing with `-mx-2` ([examples](../upstream/apps/docs/examples/marquee.tsx#L10-L28), [no fade](../upstream/apps/docs/examples/marquee-no-fade.tsx#L5-L19), [raw props](../upstream/apps/docs/examples/marquee-raw.tsx#L12-L28), [spacing](../upstream/apps/docs/examples/marquee-spacing.tsx#L12-L28)). The About and Hero demos use it for company/logo strips ([About](../upstream/apps/docs/examples/about.tsx#L102-L123), [Hero](../upstream/apps/docs/examples/hero.tsx#L104-L123)); their external image/link data is demo content, not component behavior.

### Mini Calendar — controlled or uncontrolled date and range state

- `MiniCalendar` supports controlled/uncontrolled selected-date state through `value`/`defaultValue`/`onValueChange` and independently supports controlled/uncontrolled start-range state through `startDate`/`defaultStartDate`/`onStartDateChange`; the default day count is five ([props and state](../upstream/packages/mini-calendar/index.tsx#L57-L111)).
- `MiniCalendarNavigation` advances or rewinds exactly `days` dates. Its default renders a ghost icon button; `asChild` uses Radix `Slot.Root` so a supplied child can be the trigger ([source](../upstream/packages/mini-calendar/index.tsx#L128-L168)).
- `MiniCalendarDays` requires a render function and produces consecutive dates from the active start date. `MiniCalendarDay` selects its date, renders abbreviated month/day, uses default button variant for the selected date, and accent background for today only when not selected ([source](../upstream/packages/mini-calendar/index.tsx#L170-L230)).
- All subcomponents read context and throw if rendered outside `MiniCalendar` ([source](../upstream/packages/mini-calendar/index.tsx#L28-L38)). Also, `MiniCalendarDay` spreads caller props after its built-in `onClick`; a caller-supplied `onClick` replaces selection handling ([source](../upstream/packages/mini-calendar/index.tsx#L206-L217)).

**Usage variations.** The docs examples show default composition, selected-date controlled state, custom navigation via `asChild`, and `days={7}` ([basic](../upstream/apps/docs/examples/mini-calendar.tsx#L10-L18), [controlled](../upstream/apps/docs/examples/mini-calendar-controlled.tsx#L12-L37), [custom](../upstream/apps/docs/examples/mini-calendar-custom.tsx#L12-L32), [seven days](../upstream/apps/docs/examples/mini-calendar-days.tsx#L10-L18)). The event Form demo also uses the controlled, seven-day form ([source](../upstream/apps/docs/examples/form.tsx#L221-L241)).

### Pill — presentational Badge composition

- `Pill` is a shadcn `Badge` with default `secondary` variant and round/padded classes. Although its type exposes `themed?: boolean`, the implementation destructures but never reads `themed`; no behavior can be inferred from that prop ([source](../upstream/packages/pill/index.tsx#L8-L23)).
- `PillAvatar` wraps shadcn Avatar/Image/Fallback; `PillButton` wraps a ghost icon Button; and `PillStatus` supplies a right border/content group ([source](../upstream/packages/pill/index.tsx#L25-L73)). The underlying Badge supports `default`, `secondary`, `destructive`, and `outline` variants ([helper](../upstream/packages/shadcn-ui/components/ui/badge.tsx#L7-L46)).
- `PillIndicator` has `success`, `error`, `warning`, and `info` color variants and optional Tailwind ping animation. `PillDelta` produces minus for zero/falsy values, up for positive, and down for negative. `PillIcon` renders a supplied Lucide-compatible icon; `PillAvatarGroup` overlaps/masks avatars ([source](../upstream/packages/pill/index.tsx#L75-L166)).
- `PillStatusProps` and `PillAvatarGroupProps` type only `children` and `className`, despite spreading remaining props into a `<div>` ([source](../upstream/packages/pill/index.tsx#L54-L73), [source](../upstream/packages/pill/index.tsx#L146-L166)). Do not assume normal div attributes are accepted by their TypeScript API.

**Usage variations.** The aggregate example combines every export ([source](../upstream/apps/docs/examples/pill.tsx#L15-L79)); dedicated examples separately cover avatar, status, dismiss-style button, indicator, positive/negative/zero delta, icon, and avatar group ([examples index](../catalog/examples.md)). These examples use external profile images and static labels, which are demo data rather than component requirements.

## Architecture

All five are **components**, as classified by the local catalog; none is a Kibo pattern. They are source-distributed workspace packages importing shadcn-ui via aliases and using `cn` (`clsx` + `tailwind-merge`) for class composition ([helper](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6)). Kanban additionally composes shadcn Card and ScrollArea; Mini Calendar composes Button; Pill composes Badge, Avatar, and Button.

State responsibility differs sharply:

- **Kanban:** caller owns `data`; provider can emit replacement arrays.
- **List:** caller owns all state transition logic.
- **Mini Calendar:** package manages controlled/uncontrolled selected date and range state via Radix.
- **Marquee and Pill:** presentational wrappers; movement is delegated to `react-fast-marquee` for Marquee.

## Start Here

Open [`packages/mini-calendar/index.tsx`](../upstream/packages/mini-calendar/index.tsx#L57-L230) first when evaluating an application fit: it has the clearest self-contained API and explicit controlled/uncontrolled contract. For DnD work, inspect Kanban’s externally owned `data` contract before copying a demo.

## Coverage / missing inputs

- Accounted for: all five assigned MDX pages; five implementations and package metadata; all matching `apps/docs/examples` imports (Kanban 3, List 3, Marquee 6, Mini Calendar 5, Pill 8); and necessary shadcn helper imports.
- No separate CSS files exist in the assigned package directories per snapshot metadata.
- Missing by design: runtime execution, dependency resolution, browser interaction, visual comparison, keyboard testing, and accessibility/assistive-technology validation.
