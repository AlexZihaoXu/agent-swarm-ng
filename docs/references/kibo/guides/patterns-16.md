# Patterns: spinner, switch, table

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

Read-only source analysis of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (snapshot foundation: `docs/references/kibo/VERIFICATION.md`, lines 1–31). Upstream is treated as untrusted reference data. No browser/preview validation or code execution was performed; preview URLs below are catalog metadata, while interaction notes come from source reading only.

Project constraints consulted: `AGENTS.md` (lines 1–12) and `README.md` (lines 1–130).

## Files Retrieved

1. `docs/references/kibo/catalog/patterns/spinner.md` (lines 1–23) — canonical inventory, titles, source paths, and preview URLs for 17 spinner patterns.
2. `docs/references/kibo/catalog/patterns/switch.md` (lines 1–25) — canonical inventory for 19 switch patterns.
3. `docs/references/kibo/catalog/patterns/table.md` (lines 1–13) — canonical inventory for eight table patterns.
4. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/spinner.tsx` (lines 1–17) — `Spinner` implementation.
5. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/switch.tsx` (lines 1–34) — Radix-based `Switch` implementation and DOM/class boundary.
6. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/table.tsx` (lines 1–103) — native-table wrappers and horizontal-overflow container.
7. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/{button,item,input-group,progress,empty,label,avatar}.tsx` — supporting primitive source used by assigned variants.

## Key Code

- `Spinner` renders Lucide `Loader2Icon` with `role="status"`, `aria-label="Loading"`, default `size-4 animate-spin`, and accepts SVG props/classes: `packages/shadcn-ui/components/ui/spinner.tsx:5-15`.
- `Switch` wraps `radix-ui`’s `SwitchPrimitive.Root` and Thumb; it has checked/unchecked and disabled styling plus `focus-visible` styles. Its default root is `h-[1.15rem] w-8 rounded-full`; the thumb is a `span` in the current primitive implementation: `packages/shadcn-ui/components/ui/switch.tsx:8-31`.
- `Table` renders a native `<table>` inside a `relative w-full overflow-x-auto` wrapper. Headers are `<th>`, cells `<td>`, and rows have hover/selected visual classes: `packages/shadcn-ui/components/ui/table.tsx:7-90`.

## Architecture

Each pattern is a self-contained exported `Example` component plus a `title`. These examples compose local shadcn-style primitives imported through `@/components/ui/*`, Tailwind utility classes, and occasionally `lucide-react`. They contain presentation fixtures rather than application data loading, persistence, server actions, or error handling.

---

# Spinner

**Required base primitive:** `Spinner` from `@/components/ui/spinner`; it requires Lucide’s `Loader2Icon` and the repository `cn` utility in the mirrored implementation (`packages/shadcn-ui/components/ui/spinner.tsx:1-17`).

**Adaptation boundary:** preserve the spinner’s status semantics or replace its default `aria-label` when a more specific loading message is needed. The examples are static renderings: they do not establish request lifecycle, cancellation, progress calculation, retry, or focus behavior.

## Collection: applications

| ID / title | Local source / preview | Actual composition and demo-only behavior |
|---|---|---|
| `spinner-applications-1` — Spinner in Item | `packages/patterns/spinner/applications/spinner-applications-1.tsx:1-38` · [preview](https://www.kibo-ui.com/patterns/spinner/applications/spinner-applications-1) | Outline `Item` with spinner in `ItemMedia`, fixed “129 MB / 1000 MB” text, fixed `Progress value={75}`, and a responsive `Cancel` button hidden below `sm`. The values and button are fixtures; no transfer, cancel handler, or progress state exists. Requires `Item*`, `Progress`, and `Button`. |
| `spinner-applications-2` — Spinner in Input Group | `packages/patterns/spinner/applications/spinner-applications-2.tsx:1-34` · [preview](https://www.kibo-ui.com/patterns/spinner/applications/spinner-applications-2) | Two disabled message controls: one places a spinner at inline end; one places spinner plus “Validating...” and a send button at block end. Requires `InputGroup`, input/textarea/addon/button variants, `Spinner`, and Lucide `ArrowUpIcon`. No validation/submission state or handler is supplied; the source’s send icon has an `sr-only` “Send” label. |
| `spinner-applications-3` — Spinner in Empty State | `packages/patterns/spinner/applications/spinner-applications-3.tsx:1-33` · [preview](https://www.kibo-ui.com/patterns/spinner/applications/spinner-applications-3) | Centered `Empty` composition with icon media, processing copy, and an outline `Cancel` button. Requires `Empty*`, `Spinner`, and `Button`. “Do not refresh” and cancel are presentation only—no processing state, cancellation, or recovery path is implemented. |

`InputGroup` itself is a `role="group"` wrapper with input-focus forwarding from non-button addons (`packages/shadcn-ui/components/ui/input-group.tsx:8-50,72-91`); the example’s controls are explicitly disabled. `Item` and `Empty` are layout primitives, not application-state components (`item.tsx:22-201`; `empty.tsx:5-109`).

## Collection: button

| ID / title | Local source / preview | Actual composition and demo-only behavior |
|---|---|---|
| `spinner-button-1` — Loading Button | `packages/patterns/spinner/button/spinner-button-1.tsx:1-13` · [preview](https://www.kibo-ui.com/patterns/spinner/button/spinner-button-1) | Disabled default `Button`, spinner, and “Loading...” text. |
| `spinner-button-2` — Loading Outline Button | `packages/patterns/spinner/button/spinner-button-2.tsx:1-13` · [preview](https://www.kibo-ui.com/patterns/spinner/button/spinner-button-2) | Disabled outline button with spinner and “Processing.” |
| `spinner-button-3` — Loading Icon Button | `packages/patterns/spinner/button/spinner-button-3.tsx:1-12` · [preview](https://www.kibo-ui.com/patterns/spinner/button/spinner-button-3) | Disabled icon-size button containing only the spinner. It supplies no button-specific text or `aria-label`; add an accessible button name when adapting. |
| `spinner-button-4` — Loading Secondary Button | `packages/patterns/spinner/button/spinner-button-4.tsx:1-13` · [preview](https://www.kibo-ui.com/patterns/spinner/button/spinner-button-4) | Disabled secondary button with spinner and “Saving Changes.” |
| `spinner-button-5` — Loading Small Button | `packages/patterns/spinner/button/spinner-button-5.tsx:1-13` · [preview](https://www.kibo-ui.com/patterns/spinner/button/spinner-button-5) | Disabled small button; spinner is reduced to `size-3`; text is “Please Wait.” |

All five are fixed disabled examples with no async action or state transition. `Button` supplies disabled pointer-event/opacity styling and supports its variants/sizes (`packages/shadcn-ui/components/ui/button.tsx:7-63`); adaptation should bind `disabled` to the real pending condition and retain a stable action name where applicable.

## Collection: inline

| ID / title | Local source / preview | Actual composition and demo-only behavior |
|---|---|---|
| `spinner-inline-1` — Inline with Text | `packages/patterns/spinner/inline/spinner-inline-1.tsx:1-12` · [preview](https://www.kibo-ui.com/patterns/spinner/inline/spinner-inline-1) | Flex row, default spinner, and “Loading data...” span. |
| `spinner-inline-2` — Spinner Before Text | `packages/patterns/spinner/inline/spinner-inline-2.tsx:1-12` · [preview](https://www.kibo-ui.com/patterns/spinner/inline/spinner-inline-2) | Muted small spinner before “Syncing your changes.” |
| `spinner-inline-3` — Spinner After Text | `packages/patterns/spinner/inline/spinner-inline-3.tsx:1-12` · [preview](https://www.kibo-ui.com/patterns/spinner/inline/spinner-inline-3) | Small spinner after “Processing your request.” |
| `spinner-inline-4` — Spinner in List Item | `packages/patterns/spinner/inline/spinner-inline-4.tsx:1-21` · [preview](https://www.kibo-ui.com/patterns/spinner/inline/spinner-inline-4) | `Item` layout with muted spinner plus title/description. Requires `Item`, `ItemContent`, `ItemTitle`, and `ItemDescription`. |

These variants only position static copy; production code must decide when the status appears/disappears and prevent stale status messages.

## Collection: standard

| ID / title | Local source / preview | Actual composition |
|---|---|---|
| `spinner-standard-1` — Default Spinner | `packages/patterns/spinner/standard/spinner-standard-1.tsx:1-7` · [preview](https://www.kibo-ui.com/patterns/spinner/standard/spinner-standard-1) | Bare default spinner. |
| `spinner-standard-2` — Small Spinner | `packages/patterns/spinner/standard/spinner-standard-2.tsx:1-7` · [preview](https://www.kibo-ui.com/patterns/spinner/standard/spinner-standard-2) | Bare spinner with `size-3`. |
| `spinner-standard-3` — Large Spinner | `packages/patterns/spinner/standard/spinner-standard-3.tsx:1-7` · [preview](https://www.kibo-ui.com/patterns/spinner/standard/spinner-standard-3) | Bare spinner with `size-8`. |
| `spinner-standard-4` — Primary Color Spinner | `packages/patterns/spinner/standard/spinner-standard-4.tsx:1-7` · [preview](https://www.kibo-ui.com/patterns/spinner/standard/spinner-standard-4) | Bare spinner with `text-primary`. |
| `spinner-standard-5` — Muted Spinner | `packages/patterns/spinner/standard/spinner-standard-5.tsx:1-7` · [preview](https://www.kibo-ui.com/patterns/spinner/standard/spinner-standard-5) | Bare spinner with `text-muted-foreground`. |

---

# Switch

**Required base primitives:** `Switch` (Radix dependency), and `Label` where imported. Icon variants also require the named `lucide-react` icons. The `Switch` source forwards props to Radix Root, so controlled `checked` / `onCheckedChange` examples are source-backed (`packages/shadcn-ui/components/ui/switch.tsx:8-31`).

**Adaptation boundary:** map controlled state to real persisted application state and perform error/rollback handling externally. The square text toggle (`switch-square-2`) styles descendant `span` elements and Radix state selectors, coupling it to the current primitive markup (`switch.tsx:22-30`); preserve or deliberately retest that DOM-dependent CSS on primitive upgrades.

## Collection: cards

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `switch-cards-1` — Settings Card | `packages/patterns/switch/cards/switch-cards-1.tsx:1-27` · [preview](https://www.kibo-ui.com/patterns/switch/cards/switch-cards-1) | Bordered card with emoji tile, associated `Label htmlFor="card-notifications"`, switch, and static description. `Label`/`Switch` required. No notification preference persistence. |
| `switch-cards-2` — Feature Card | `packages/patterns/switch/cards/switch-cards-2.tsx:1-28` · [preview](https://www.kibo-ui.com/patterns/switch/cards/switch-cards-2) | Same card structure but green Lucide `PlusIcon` tile and associated feature label/switch. No feature activation behavior. |
| `switch-cards-3` — Settings List | `packages/patterns/switch/cards/switch-cards-3.tsx:1-35` · [preview](https://www.kibo-ui.com/patterns/switch/cards/switch-cards-3) | Two divided preference rows; labels associate with `marketing` and `security`; only security has fixed `defaultChecked`. The entries/copy and defaults are demo data; no persistence or update feedback. |
| `switch-cards-4` — Switch in Item | `packages/patterns/switch/cards/switch-cards-4.tsx:1-25` · [preview](https://www.kibo-ui.com/patterns/switch/cards/switch-cards-4) | Outline `Item` with title/description and trailing `defaultChecked` switch. Requires `Item*` and `Switch`. The switch has neither ID nor label association in this example; add an accessible name when adapting. |

## Collection: icons

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `switch-icons-1` — Theme Toggle with Icons | `packages/patterns/switch/icons/switch-icons-1.tsx:1-16` · [preview](https://www.kibo-ui.com/patterns/switch/icons/switch-icons-1) | Sun icon, uncontrolled switch, muted moon icon. Requires `SunIcon`, `MoonIcon`, and `Switch`. It does not change a theme and supplies no switch label/`aria-label`. |
| `switch-icons-2` — Icon with Label | `packages/patterns/switch/icons/switch-icons-2.tsx:1-19` · [preview](https://www.kibo-ui.com/patterns/switch/icons/switch-icons-2) | Bell icon plus an associated “Notifications” label and checked default. Requires `BellIcon`, `Label`, and `Switch`. No preference persistence. |
| `switch-icons-3` — Volume Toggle | `packages/patterns/switch/icons/switch-icons-3.tsx:1-16` · [preview](https://www.kibo-ui.com/patterns/switch/icons/switch-icons-3) | Muted volume-off icon, checked default switch, volume-on icon. Requires both volume icons and `Switch`. It does not alter audio and supplies no programmatic switch label. |

## Collection: labeled

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `switch-labeled-1` — Switch with Label | `packages/patterns/switch/labeled/switch-labeled-1.tsx:1-15` · [preview](https://www.kibo-ui.com/patterns/switch/labeled/switch-labeled-1) | Switch `id="airplane-mode"` and associated `Label`. No airplane-mode behavior. |
| `switch-labeled-2` — Switch with On Label | `packages/patterns/switch/labeled/switch-labeled-2.tsx:1-14` · [preview](https://www.kibo-ui.com/patterns/switch/labeled/switch-labeled-2) | `defaultChecked` switch plus static “On” span. The text does not update and is not associated through `Label`; bind it to state if retained. |
| `switch-labeled-3` — Switch with State Labels | `packages/patterns/switch/labeled/switch-labeled-3.tsx:1-22` · [preview](https://www.kibo-ui.com/patterns/switch/labeled/switch-labeled-3) | The sole standard controlled-switch example: local `useState(false)` drives `checked`, `onCheckedChange`, and inverse “On”/“Off” spans. This is demo-local UI state only; no label association, persistence, error, or side effect. |
| `switch-labeled-4` — Switch with Description | `packages/patterns/switch/labeled/switch-labeled-4.tsx:1-20` · [preview](https://www.kibo-ui.com/patterns/switch/labeled/switch-labeled-4) | Associated “Push Notifications” label, static explanatory copy, and switch. No permissions request or device-notification behavior. |

## Collection: square

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `switch-square-1` — Square Switch | `packages/patterns/switch/square/switch-square-1.tsx:1-14` · [preview](https://www.kibo-ui.com/patterns/switch/square/switch-square-1) | `useId()` supplies an ID; `rounded-sm [&_span]:rounded` squares root/thumb. There is no associated label or action. |
| `switch-square-2` — Square Switch with Text | `packages/patterns/switch/square/switch-square-2.tsx:1-36` · [preview](https://www.kibo-ui.com/patterns/switch/square/switch-square-2) | Controlled local state, full-overlay switch, animated two-cell Off/On text, RTL transforms, and an `sr-only` associated label. Requires React `useId`/`useState`, `Label`, `Switch`. It does not persist state; its markup-sensitive CSS is the principal safe-adaptation constraint. |
| `switch-square-3` — Square Switch with Label | `packages/patterns/switch/square/switch-square-3.tsx:1-20` · [preview](https://www.kibo-ui.com/patterns/switch/square/switch-square-3) | Squared, checked-default switch with `useId` and associated “Enable notifications” label. No preference persistence. |
| `switch-square-4` — Square Theme Toggle | `packages/patterns/switch/square/switch-square-4.tsx:1-27` · [preview](https://www.kibo-ui.com/patterns/switch/square/switch-square-4) | Local controlled state, square compact switch, moon/sun icons, and `useId`. Requires icons plus `useId`/`useState`. It does not perform theme changes and has no associated label/`aria-label`. |

## Collection: standard

| ID / title | Local source / preview | Actual composition and caveat |
|---|---|---|
| `switch-standard-1` — Default Switch | `packages/patterns/switch/standard/switch-standard-1.tsx:1-9` · [preview](https://www.kibo-ui.com/patterns/switch/standard/switch-standard-1) | Bare uncontrolled switch; no visible/programmatic label is supplied. |
| `switch-standard-2` — Checked Switch | `packages/patterns/switch/standard/switch-standard-2.tsx:1-9` · [preview](https://www.kibo-ui.com/patterns/switch/standard/switch-standard-2) | Bare `defaultChecked` switch; no label or persistence. |
| `switch-standard-3` — Small Switch | `packages/patterns/switch/standard/switch-standard-3.tsx:1-9` · [preview](https://www.kibo-ui.com/patterns/switch/standard/switch-standard-3) | Bare switch resized to `h-4 w-7`; no label. Validate usable target size in its eventual context. |
| `switch-standard-4` — Disabled Switch | `packages/patterns/switch/standard/switch-standard-4.tsx:1-9` · [preview](https://www.kibo-ui.com/patterns/switch/standard/switch-standard-4) | Bare disabled switch; no explanatory label. The primitive provides disabled visual/pointer styling (`switch.tsx:22-25`). |

All switch patterns begin with `"use client"` and import only their shown primitives/icons/hooks. This is a source dependency signal, not browser validation.

---

# Table

**Required base primitive:** `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, and `TableCell`; avatar and compatibility variants add `Avatar*` and Lucide icons respectively.

**Adaptation boundary:** retain native table structure and the primitive’s horizontal overflow wrapper (`packages/shadcn-ui/components/ui/table.tsx:7-22`). Replace fixed arrays, stable sample keys, display-only formatting, and external avatar URLs with production data/state. None of the patterns implements sorting, filtering, pagination, row selection, loading/empty/error states, or responsive column-priority behavior.

## Collection: advanced

| ID / title | Local source / preview | Actual composition, demo data, and caveats |
|---|---|---|
| `table-advanced-1` — Table with Vertical Lines | `packages/patterns/table/advanced/table-advanced-1.tsx:1-66` · [preview](https://www.kibo-ui.com/patterns/table/advanced/table-advanced-1) | Four-column projects fixture in a bordered `max-w-4xl` shell. `border-r` is applied to the first three header/cell columns. Project records and fixed statuses/priorities are demo data. |
| `table-advanced-2` — Dense Table | `packages/patterns/table/advanced/table-advanced-2.tsx:1-86` · [preview](https://www.kibo-ui.com/patterns/table/advanced/table-advanced-2) | Six static audit-log records. Header/rows use `h-8`; headers `py-2`; cells `py-1 text-sm`; time is right-aligned. It is visual density only, not a log feed or pagination implementation. |
| `table-advanced-3` — Vertical Table | `packages/patterns/table/advanced/table-advanced-3.tsx:1-42` · [preview](https://www.kibo-ui.com/patterns/table/advanced/table-advanced-3) | Two-column Field/Value layout, `max-w-md`, six static user-info entries, and a one-third-wide field header. It is still ordinary table markup, not editable profile behavior. |
| `table-advanced-4` — Compatibility Table | `packages/patterns/table/advanced/table-advanced-4.tsx:1-114` · [preview](https://www.kibo-ui.com/patterns/table/advanced/table-advanced-4) | Six browser columns and five hard-coded feature records. `SupportIcon` centers green check/red X icons. Requires `CheckIcon`/`XIcon`. The source gives those icons no text equivalent or `aria-label`; do not rely on color/icon alone for production compatibility status. Values are demo assertions, not live capability detection. |

## Collection: standard

| ID / title | Local source / preview | Actual composition, demo data, and caveats |
|---|---|---|
| `table-standard-1` — Basic Table | `packages/patterns/table/standard/table-standard-1.tsx:1-70` · [preview](https://www.kibo-ui.com/patterns/table/standard/table-standard-1) | Five-column, four-user fixture; name is emphasized and balance right-aligned. No interactive table behavior. |
| `table-standard-2` — Table with Avatar | `packages/patterns/table/standard/table-standard-2.tsx:1-75` · [preview](https://www.kibo-ui.com/patterns/table/standard/table-standard-2) | User cell composes `AvatarImage alt={user.name}` and initials fallback with name, masked email, and role. Requires `Avatar`, `AvatarImage`, and `AvatarFallback`. Avatar `src` values are external GitHub URLs in the fixture; substitute application-approved image handling/data. |
| `table-standard-3` — Table Without Dividers | `packages/patterns/table/standard/table-standard-3.tsx:1-64` · [preview](https://www.kibo-ui.com/patterns/table/standard/table-standard-3) | Product fixture; header removes bottom border and hover, body rows remove bottom borders; price/stock right-aligned. Divider removal is the distinguishing choice, not a data behavior. |
| `table-standard-4` — Striped Table | `packages/patterns/table/standard/table-standard-4.tsx:1-73` · [preview](https://www.kibo-ui.com/patterns/table/standard/table-standard-4) | Five transaction records; even zero-based indexes receive `bg-muted/50`; amount right-aligned. Striping derives from rendered-array index, so preserve/reconsider the parity rule when filtering, pagination, or virtualization is introduced. |

The table primitive offers `TableCaption`, but none of these eight pattern sources uses it (`packages/shadcn-ui/components/ui/table.tsx:91-103`). Add a caption or equivalent table context when the surrounding UI does not already provide one; this is a source-based accessibility consideration, not a browser or assistive-technology validation result.

## Start Here

Open `docs/references/kibo/catalog/patterns/spinner.md` (lines 1–23) first for the authoritative spinner inventory and preview/source mapping, then open the analogous `switch.md` and `table.md` catalogs before adapting an individual source.

## Coverage / missing inputs

- **Covered:** all assigned families and collections — spinner **17** (applications 3, button 5, inline 4, standard 5); switch **19** (cards 4, icons 3, labeled 4, square 4, standard 4); table **8** (advanced 4, standard 4): **44/44** catalogued patterns.
- **Source dependencies read:** base spinner, switch, table, and all supporting primitives imported by the assigned patterns.
- **Not available/validated:** no product requirements selecting a variant; no real application data/actions/API contract; no browser preview rendering, keyboard/screen-reader test, visual regression, or upstream website availability validation.
