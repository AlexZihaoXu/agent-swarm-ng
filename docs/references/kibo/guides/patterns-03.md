# Patterns: breadcrumb, button, button-group

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and provenance

Passive source reading only. This recording covers every `.tsx` pattern below the pinned snapshot's `packages/patterns/breadcrumb/`, `button-group/`, and `button/` directories: **88 patterns across 17 collections**. It is reference guidance, not application implementation or rendered/assistive-technology validation.

- Upstream: [`shadcnblocks/kibo`](https://github.com/shadcnblocks/kibo), immutable commit [`3d63cdb15b79d972e3dc38a10997987672f9b263`](https://github.com/shadcnblocks/kibo/tree/3d63cdb15b79d972e3dc38a10997987672f9b263), tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`.
- Snapshot rules/provenance: [`docs/references/kibo/README.md`](../README.md); exact retained license: [`upstream/license.md`](../upstream/license.md) (MIT text retained verbatim).
- The generated family indexes are the complete linked inventories: [breadcrumb](../catalog/patterns/breadcrumb.md), [button group](../catalog/patterns/button-group.md), and [button](../catalog/patterns/button.md). They provide an exact local-source link and public preview URL for every row below. Preview URLs are navigational only; no preview was opened or visually validated.

**How to read the inventory:** each `id` has exact local source `docs/references/kibo/upstream/packages/patterns/<family>/<collection>/<id>.tsx` and preview `https://www.kibo-ui.com/patterns/<family>/<collection>/<id>`. The linked family index is the canonical per-row source/preview link; this compact form keeps the recording from duplicating the already-mirrored source.

## Shared primitive boundaries

| Primitive | Observed source contract relevant to these patterns | Adaptation boundary |
| --- | --- | --- |
| [`Button`](../upstream/packages/shadcn-ui/components/ui/button.tsx) | A native `button` by default; `asChild` uses Radix Slot. Variants are `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`; sizes include default, `sm`, `lg`, and icon sizes. It supplies disabled, focus-visible, invalid-state, icon sizing, and styling classes. | Reuse the application’s established button primitive/variants. Add semantics, action wiring, and loading state at the application boundary; demo labels/icons/counts are not domain data. |
| [`ButtonGroup`](../upstream/packages/shadcn-ui/components/ui/button-group.tsx) | A `div role="group"`; horizontal is default and merges adjoining child borders/radii, vertical does likewise top-to-bottom. `ButtonGroupText` is a noninteractive `div`; `ButtonGroupSeparator` wraps `Separator`. It raises focused children with z-index. | It does **not** give a mutually exclusive selection model, roving focus, names, or action behavior. Use a real radiogroup/tabs/listbox or explicitly implement keyboard/ARIA state where selection is semantic. Do not make `ButtonGroupText` a control. |
| [`Breadcrumb`](../upstream/packages/shadcn-ui/components/ui/breadcrumb.tsx) | `nav aria-label="breadcrumb"` contains an `ol`; current page is a `span role="link" aria-disabled="true" aria-current="page"`; separators and ellipsis are `aria-hidden`. Links may be slotted with `asChild`. | Supply real route destinations and meaningful accessible names. The icon-only Home link and dropdown trigger in demos need a discernible name; collapsed crumbs need an actual expansion/navigation design. |

All three primitive sources import Radix Slot; Button/ButtonGroup also depend on the project’s `cn`, Button uses CVA, and ButtonGroup uses the `Separator` primitive. Individual patterns additionally import Lucide icons and, where noted, Kibo/shadcn primitives. Those are source dependencies, not a recommendation to add packages.

## Breadcrumb

The two collections have the same seven compositions. **standard** renders text `Home`; **home-icon** replaces only that first link’s visible content with Lucide `Home`. Every demo uses literal `href="/"` and `href="/components"` plus literal trail labels, so routing/content are demo-only.

| Collection | ID — title | Observed distinguishing composition and source dependencies |
| --- | --- | --- |
| standard | `breadcrumb-standard-1` — Breadcrumb with Ellipsis | Breadcrumb primitives plus `BreadcrumbEllipsis`; Home → hidden-middle placeholder → Components → current page. The ellipsis is presentational, not a menu/control. |
| standard | `breadcrumb-standard-2` — Breadcrumb with Dropdown | Adds Lucide `Folder` and `DropdownMenu`/Content/Item/Trigger. A folder-only trigger opens three static literal items; the items have no destinations/actions. |
| standard | `breadcrumb-standard-3` — Breadcrumb with Icons | Adds Lucide `Folder` to both links and `FileText` to page, each paired with text. |
| standard | `breadcrumb-standard-4` — Breadcrumb with Border | Same three-step text trail, with `w-fit rounded-lg border px-3 py-2` on the Breadcrumb container. |
| standard | `breadcrumb-standard-5` — Breadcrumb with Bullet Separator | Same trail, replacing default chevrons with literal bullet separator children. |
| standard | `breadcrumb-standard-6` — Breadcrumb with Slash Separator | Adds Lucide `Slash` as each separator child. |
| standard | `breadcrumb-standard-7` — Breadcrumb with Select | Adds Select primitives; uncontrolled `defaultValue="components"`, static Documentation/Components/Themes options, and a current-page final crumb. Selection is not tied to routing. |
| home-icon | `breadcrumb-home-icon-1` — Breadcrumb with Ellipsis | Same as standard-1, but first `BreadcrumbLink` contains only `Home` icon. |
| home-icon | `breadcrumb-home-icon-2` — Breadcrumb with Dropdown | Same as standard-2, with icon-only Home link; imports `Home` and `Folder`. |
| home-icon | `breadcrumb-home-icon-3` — Breadcrumb with Icons | Icon-only Home link, then icon-and-text Components/current page; imports `Home`, `Folder`, `FileText`. |
| home-icon | `breadcrumb-home-icon-4` — Breadcrumb with Border | Same bordered three-step composition as standard-4 with icon-only Home link. |
| home-icon | `breadcrumb-home-icon-5` — Breadcrumb with Bullet Separator | Same bullet-separator composition as standard-5 with icon-only Home link. |
| home-icon | `breadcrumb-home-icon-6` — Breadcrumb with Slash Separator | Same slash-separator composition as standard-6 with icon-only Home link; imports `Home`, `Slash`. |
| home-icon | `breadcrumb-home-icon-7` — Breadcrumb with Select | Same uncontrolled select composition as standard-7 with icon-only Home link. |

**Safe adaptation notes:** retain the `nav`/ordered-list/link/current-page composition supplied by the primitive. Replace sample hrefs, static menu/select options, and text with route-aware data; decide whether a dropped middle crumb should be a menu/dialog/navigation affordance rather than adopting the presentational ellipsis. Add an accessible label to icon-only links/triggers (the read source does not add one). The source shows no responsive collapse policy beyond the primitive list’s wrapping classes and no browser/a11y test execution.

## Button

All five collections contain the same seven IDs/titles and only vary the source `Button` `variant`: **standard** omits it (`default`), while **destructive**, **link**, **outline**, and **secondary** set the matching variant. Each source is in its indexed collection path; see the [complete exact-source/preview inventory](../catalog/patterns/button.md).

| Variant collection | IDs and titles (each source/preview path is the ID rule above) | Actual composition beyond variant |
| --- | --- | --- |
| standard | `button-standard-1` Button with Text; `button-standard-2` Button with Left Icon; `button-standard-3` Button with Right Icon; `button-standard-4` Rounded Button; `button-standard-5` Loading Button; `button-standard-6` Button with Count; `button-standard-7` Button with Kbd | Default Button styling. |
| destructive | `button-destructive-1` Button with Text; `button-destructive-2` Button with Left Icon; `button-destructive-3` Button with Right Icon; `button-destructive-4` Rounded Button; `button-destructive-5` Loading Button; `button-destructive-6` Button with Count; `button-destructive-7` Button with Kbd | `variant="destructive"`. |
| link | `button-link-1` Button with Text; `button-link-2` Button with Left Icon; `button-link-3` Button with Right Icon; `button-link-4` Rounded Button; `button-link-5` Loading Button; `button-link-6` Button with Count; `button-link-7` Button with Kbd | `variant="link"`. |
| outline | `button-outline-1` Button with Text; `button-outline-2` Button with Left Icon; `button-outline-3` Button with Right Icon; `button-outline-4` Rounded Button; `button-outline-5` Loading Button; `button-outline-6` Button with Count; `button-outline-7` Button with Kbd | `variant="outline"`. |
| secondary | `button-secondary-1` Button with Text; `button-secondary-2` Button with Left Icon; `button-secondary-3` Button with Right Icon; `button-secondary-4` Rounded Button; `button-secondary-5` Loading Button; `button-secondary-6` Button with Count; `button-secondary-7` Button with Kbd | `variant="secondary"`. |

The numbered composition is identical in every collection except the count/kbd color classes described below:

| Number/title | Source-observed composition, imports, and demo limitation |
| --- | --- |
| 1 — Button with Text | `Button` containing literal “Button”; no handler or navigation target. |
| 2 — Button with Left Icon | Adds Lucide `Mail` before the literal label and `gap-2`; icon is decorative in source. |
| 3 — Button with Right Icon | Adds Lucide `ArrowRight` after the literal label and `gap-2`; it does not imply navigation. |
| 4 — Rounded Button | Adds `rounded-full`; no behavior. |
| 5 — Loading Button | Adds Lucide `Loader2` with `animate-spin`, literal “Loading”, `gap-2`, and `disabled`. This is a static disabled illustration, not async work/error/completion logic. |
| 6 — Button with Count | Adds `Badge` after label with literal `3`, `rounded-full`, and `gap-2`. Standard/destructive use outline Badge plus `text-primary-foreground`; link uses secondary Badge; outline/secondary use default Badge. No count update/action semantics. |
| 7 — Button with Kbd | Adds `Kbd` after label with literal `⌘K`, `gap-2`. Standard/destructive add `border bg-transparent text-primary-foreground`; link adds `border bg-transparent`; outline/secondary use unmodified Kbd. No keyboard listener is implemented. |

**Safe adaptation notes:** choose the variant from action severity/meaning rather than copying the collection name as branding. Couple any busy UI to actual pending state, prevent duplicate actions as appropriate, and decide whether it should remain focusable. Treat badge values and shortcut legends as application data; implement the advertised shortcut separately and avoid showing platform-inappropriate glyphs. Icon-only controls occur in the button-group family, not this one; labels here remain visible. No pattern supplies click handlers, form submission intent, links, analytics, confirmation for destructive actions, or live announcements.

## Button group

Every row below has an exact local source and preview link in the [button-group index](../catalog/patterns/button-group.md). The notes distinguish source-observed local demo state from behavior that must be integrated.

| Collection | ID — title | Composition/interaction actually in source | Required primitives or demo-only input |
| --- | --- | --- | --- |
| actions | `button-group-actions-1` — Social Actions | Two small outline groups: labeled Like/Comment/Share and icon-only equivalents. No action handlers. | ButtonGroup, Button, Heart/MessageCircle/Share Lucide icons; labels are demo. |
| actions | `button-group-actions-2` — File Operations | Labeled then icon-only Download/Share/Edit/Delete outline groups; no handlers or confirmation. | ButtonGroup, Button, four Lucide icons. |
| actions | `button-group-actions-3` — Bulk Actions | Four icon+label controls, then literal count labels (12/3/3); no selection model or bulk operation. | ButtonGroup, Button, four Lucide icons; counts/demo selection state. |
| actions | `button-group-actions-4` — Comment Actions | Labeled small ghost Reply/Edit/Delete/Report group plus icon-only outline subgroup. | ButtonGroup, Button, four Lucide icons; no comment/action wiring. |
| advanced | `button-group-advanced-1` — Split Button with Dropdown | Two outline primary-action + chevron dropdown pairs; menu opens static literal items. | ButtonGroup/Button; DropdownMenu suite; Lucide ChevronDown/GitFork/Star. Primary/menu items have no behavior. |
| advanced | `button-group-advanced-2` — Button Group with Select | State-controlled country select changes only demo state; second protocol select is uncontrolled; both adjoin noninteractive phone/domain text. | ButtonGroup + ButtonGroupText, Select suite. Country/phone/domain options are demo data. |
| advanced | `button-group-advanced-3` — Stepper Button Group | Two controlled number Inputs with decrement bounded at zero and increment; input `Number(...)` is accepted without validation. | React `useState`, ButtonGroup/Button, Input, Chevron icons; quantity/price/state are local demos. |
| advanced | `button-group-advanced-4` — Rich Text Toolbar | Bold/italic/underline toggle local booleans and variants; alignment/list buttons are inert. | React state, ButtonGroup/Button, eight Lucide icons. It does not edit document content or expose pressed semantics. |
| badges | `button-group-badges-1` — Notifications Button | Two icon-only buttons with absolutely positioned literal 12/99+ badges (second destructive). | ButtonGroup/Button/Badge, Bell; count/action data absent. |
| badges | `button-group-badges-2` — Like with Count | Three Button + ButtonGroupText pairs for Like, icon-only Like, and “Liked”; static counts. | ButtonGroup/Button/ButtonGroupText, Heart; no toggling/count update. |
| badges | `button-group-badges-3` — Cart Button | Cart buttons contain absolute numeric badges, paired with price or item-count text. | ButtonGroup/Button/ButtonGroupText/Badge, ShoppingCart; all values static. |
| badges | `button-group-badges-4` — Messages and Followers | Message badge plus Follow/Following Button+text pairs. | ButtonGroup/Button/ButtonGroupText/Badge, Mail/UserPlus; no state transitions. |
| display | `button-group-display-1` — Chart Controls | One `chartType` selects Line/Bar/Pie in labeled and icon-only groups by default/outline variant. | React state, ButtonGroup/Button, chart icons; no chart integration. |
| display | `button-group-display-2` — Map Controls | `mapView` selects four textual modes and two icon+text modes. | React state, ButtonGroup/Button, Map/Navigation icons; no map effect. |
| display | `button-group-display-3` — Timeline Controls | One state selects Day–Year and 1H–All options across two groups. | React state, ButtonGroup/Button; no timeline effect. |
| display | `button-group-display-4` — Density Controls | One state selects named density and XS–XL options. | React state, ButtonGroup/Button; does not change layout density. |
| forms | `button-group-forms-1` — Date Selector | One `period` state selects five date labels and three relative periods. | React state, ButtonGroup/Button; no calendar/range handling. |
| forms | `button-group-forms-2` — Priority Selector | One `priority` state selects Low–Urgent and P1–P4. | React state, ButtonGroup/Button; no field/form submission. |
| forms | `button-group-forms-3` — Status Selector | One `status` state selects To Do–Done and Backlog–Completed. | React state, ButtonGroup/Button; no persistence. |
| forms | `button-group-forms-4` — Quantity Picker | Two quantity states; minus is disabled at zero and text is noninteractive ButtonGroupText. | React state, ButtonGroup/Button/ButtonGroupText, Plus/Minus; no inventory validation. |
| interactive | `button-group-interactive-1` — View Switcher | Typed local view state selects Grid/List/Cards in labeled and icon-only groups. | React state, ButtonGroup/Button, three icons; no actual view switch. |
| interactive | `button-group-interactive-2` — Sort Controls | Local sort field/order selects buttons; only first group has explicit direction toggle, second merely renders current direction next to active field. | React state, ButtonGroup/Button, arrow icons; no sorting. |
| interactive | `button-group-interactive-3` — Filter Chips | Local string array: All resets to `[all]`; other options toggle and restore All when empty. | React state, ButtonGroup/Button; no filtered data. |
| interactive | `button-group-interactive-4` — Segmented Control | Local tab and period state switch default/ghost variants in fit-width groups. | React state, ButtonGroup/Button; no panel/content association. |
| media | `button-group-media-1` — Player Controls | Local `isPlaying` toggles Play/Pause labels/icons; previous/next inert. | React state, ButtonGroup/Button, media icons; no media element. |
| media | `button-group-media-2` — Volume Controls | Local mute/0–100 volume: minus clamps and mutes at zero; plus clamps and unmutes; display button is inert. | React state, ButtonGroup/Button, volume icons; no audio integration. |
| media | `button-group-media-3` — Zoom Controls | Local zoom clamps 25–400 by 25; Reset and Fit both set 100; second group shows percentage. | React state, ButtonGroup/Button, zoom icons; no viewport effect. |
| media | `button-group-media-4` — Playback Speed | Static speed array maps to selectable buttons plus named options, sharing one local numeric state. | React state, ButtonGroup/Button; no player rate effect. |
| navigation | `button-group-navigation-1` — Pagination | Local page starts 3, bounds previous/next at 1/10; numbered first form hardcodes 3 as default styling rather than deriving active variant. | React state, ButtonGroup/Button, chevrons; page data/navigation absent. |
| navigation | `button-group-navigation-2` — Carousel Controls | Local slide starts 1, bounds 1/5; empty rounded indicator buttons select slides, with a textual counter alternative. | React state, ButtonGroup/Button, chevrons; indicators have no accessible names and no carousel. |
| navigation | `button-group-navigation-3` — Wizard Steps | Local step starts 2, bounds 1/4; second form maps four literal step names. | React state, ButtonGroup/Button, chevrons; no validation, panels, or stepper semantics. |
| patterns | `button-group-patterns-1` — Overflow Menu | Inline Copy/Edit/Delete plus DropdownMenu static overflow alternatives; second form changes visible actions. | ButtonGroup/Button, DropdownMenu suite, icons; none of the commands are wired. |
| patterns | `button-group-patterns-2` — Contextual Toolbar | `onMouseUp` reads `window.getSelection()`; nonempty text conditionally displays inert format controls; `selectedText` is stored but otherwise unused. | React state, ButtonGroup/Button, format icons; mouse-only demo selection behavior—not editor formatting or a selection accessibility solution. |
| patterns | `button-group-patterns-3` — Loading States | Clicking sets a string then clears it after 2 seconds. First row disables only active action; second disables all when any is pending. | React state, ButtonGroup/Button, icons; `setTimeout` simulates work and has no cleanup/error/result behavior. |
| patterns | `button-group-patterns-4` — Keyboard Shortcuts | Horizontal and vertical group layouts place static `Kbd` legends alongside commands. | ButtonGroup/Button/Kbd, icons; no shortcut listener. |
| standard | `button-group-standard-1` — Basic Button Group | Outline groups show default, small, and large button sizing. | ButtonGroup/Button; all labels inert. |
| standard | `button-group-standard-2` — Vertical Button Group | Two outline groups use `orientation="vertical"`, one default and one small. | ButtonGroup/Button; layout-only. |
| standard | `button-group-standard-3` — Button Group Variants | Two horizontal outline text-button groups (Copy/Paste/Cut and Undo/Redo), despite its title. | ButtonGroup/Button; no variant comparison/action behavior. |
| standard | `button-group-standard-4` — Nested Button Groups | Outer horizontal group nests paired outline ButtonGroups, demonstrating the primitive’s nested-group gap behavior. | ButtonGroup/Button; formatting/alignment labels are inert. |

### Button-group adaptation and accessibility boundaries

- The local `useState` snippets are presentation demos, not application state models: bind selection/actions to real domain state and update dependent content. Selection-style groups visually use Button variants; they do not set `aria-pressed`, `role="radio"`, `aria-checked`, or keyboard navigation.
- Give every icon-only button an accessible name; source examples in actions, badges, display, media, and navigation generally provide none. The same applies to carousel’s empty indicator buttons. Avoid assuming Lucide SVG names become control names.
- For destructive/bulk actions, supply selected-item context, authorization, failure handling, and confirmation/undo according to product requirements; source buttons have no handlers.
- Menus/selects import functional primitives but their choices are static and do not navigate or execute. Preserve their primitive composition only after replacing demo data and wiring actions.
- Do not use a plain grouped Button control as a substitute for semantic tabs, pagination navigation, carousel controls, or form fields where those semantics and keyboard behavior matter. The group primitive’s `role="group"` is the only explicit group semantic observed.
- The source was read only. No claims are made about rendered layout, focus order, responsive behavior, browser support, Radix runtime behavior, or assistive-technology behavior.

## Coverage and missing inputs

- **Covered:** breadcrumb `home-icon` (7) and `standard` (7); button `destructive`, `link`, `outline`, `secondary`, `standard` (7 each = 35); button-group `actions`, `advanced`, `badges`, `display`, `forms`, `interactive`, `media`, `patterns`, `standard` (4 each) plus `navigation` (3): **88/88 source files**.
- **Source/preview verification:** all IDs, literal titles, collection paths, and derived preview paths are recorded in the snapshot’s generated family indexes linked above; the source files and primitive sources were read locally. No upstream code was executed, dependencies installed, source modified, or website preview opened.
- **Missing inputs for implementation:** project-specific route model, action/data contracts, selection semantics, keyboard shortcuts, confirmation/error/loading policy, and responsive/accessibility acceptance criteria. These patterns do not provide them.
