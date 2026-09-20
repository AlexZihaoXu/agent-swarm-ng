# Patterns: popover, progress, radio-group

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the local Kibo snapshot at upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263`. Snapshot provenance and limitations are recorded in [`docs/references/kibo/VERIFICATION.md`](../VERIFICATION.md) (lines 1–32).

This report covers every collection and pattern under:

- `docs/references/kibo/upstream/packages/patterns/popover/`
- `docs/references/kibo/upstream/packages/patterns/progress/`
- `docs/references/kibo/upstream/packages/patterns/radio-group/`

Preview URLs are catalog metadata, not browser validation. The source was read but not executed; no visual, keyboard, screen-reader, or website-availability validation is claimed.

## Files Retrieved

1. [`docs/references/kibo/catalog/patterns/popover.md`](../catalog/patterns/popover.md) (lines 1–21) — authoritative local inventory of 15 popover IDs, titles, sources, and preview URLs.
2. [`docs/references/kibo/catalog/patterns/progress.md`](../catalog/patterns/progress.md) (lines 1–26) — inventory of 20 progress patterns.
3. [`docs/references/kibo/catalog/patterns/radio-group.md`](../catalog/patterns/radio-group.md) (lines 1–15) — inventory of nine radio-group patterns.
4. [`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/popover.tsx`](../upstream/packages/shadcn-ui/components/ui/popover.tsx) (lines 1–48) — supplied Popover wrapper.
5. [`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/progress.tsx`](../upstream/packages/shadcn-ui/components/ui/progress.tsx) (lines 1–31) — supplied Progress wrapper.
6. [`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/radio-group.tsx`](../upstream/packages/shadcn-ui/components/ui/radio-group.tsx) (lines 1–45) — supplied RadioGroup wrapper and item.

## Key Code and shared adaptation constraints

### Supplied primitives

| Family | Source-derived primitive behavior | Adaptation boundary |
| --- | --- | --- |
| Popover | `Popover`, `PopoverTrigger`, `PopoverContent`, and `PopoverAnchor` wrap Radix primitives. Content is portalled and defaults to `align="center"` and `sideOffset={4}`; its default class fixes `w-72`, padding, border, animation classes, and `z-50`. [`popover.tsx`](../upstream/packages/shadcn-ui/components/ui/popover.tsx) (lines 5–48) | Preserve the `asChild` trigger composition and account for portalling/stacking. Override width only where the example does (`w-auto` or `w-80`), rather than treating demo dimensions as data requirements. |
| Progress | `Progress` wraps Radix Root and renders one Indicator. The indicator transform is calculated from `value || 0`; default styling is a 2-unit rounded track with a primary indicator and transition. [`progress.tsx`](../upstream/packages/shadcn-ui/components/ui/progress.tsx) (lines 7–29) | Provide real, bounded application progress values. Color examples rely on the direct indicator and its `data-slot="progress-indicator"`; retain that structure or replace selectors deliberately. |
| Radio group | Root is a Radix group with default `grid gap-3`; items are 16px circular controls with focus-visible, invalid, and disabled styling and a Lucide filled-circle indicator. [`radio-group.tsx`](../upstream/packages/shadcn-ui/components/ui/radio-group.tsx) (lines 8–44) | Keep each item’s unique `id`, `value`, and associated label. Card wrappers in examples are presentation containers, not selectable controls themselves. |

All pattern files import local application aliases such as `@/components/ui/popover`, not the snapshot’s internal `@repo/shadcn-ui/...` aliases. Those aliases and required base components must be mapped to the host application; the snapshot does not supply application integration.

---

## Popover

**Collection:** `standard`  
**Catalog:** [`catalog/patterns/popover.md`](../catalog/patterns/popover.md) (lines 1–21)

Every variant uses `Popover` + `PopoverTrigger asChild` + `PopoverContent`, and a `Button` trigger. The only source-backed stateful example is Steps; the others are presentational shells with no application callbacks.

| ID — title | Local source / preview path | Distinguishing source composition and demo behavior |
| --- | --- | --- |
| `popover-standard-1` — Simple Text Popover | [`.../popover-standard-1.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-1.tsx) (lines 1–21); `/patterns/popover/standard/popover-standard-1` | Outline “Open” button; one text paragraph. |
| `popover-standard-2` — Popover with Heading | [`.../popover-standard-2.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-2.tsx) (lines 1–24); `/patterns/popover/standard/popover-standard-2` | Outline “View Details” trigger; heading plus muted descriptive text. |
| `popover-standard-3` — Popover with Actions | [`.../popover-standard-3.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-3.tsx) (lines 1–29); `/patterns/popover/standard/popover-standard-3` | Three full-width buttons—Edit, Share, Delete—with outline/destructive visual variants; none has an action handler. |
| `popover-standard-4` — Popover with Form | [`.../popover-standard-4.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-4.tsx) (lines 1–26); `/patterns/popover/standard/popover-standard-4` | Heading, unlabeled placeholder input, and Save button; no form element, state, validation, or save action. |
| `popover-standard-5` — Info Icon Popover | [`.../popover-standard-5.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-5.tsx) (lines 1–24); `/patterns/popover/standard/popover-standard-5` | Ghost icon-only trigger using `Info`; static helpful text. |
| `popover-standard-6` — Popover with List | [`.../popover-standard-6.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-6.tsx) (lines 1–25); `/patterns/popover/standard/popover-standard-6` | Three hard-coded text items, not mapped data or selectable list controls. |
| `popover-standard-7` — User Profile Popover | [`.../popover-standard-7.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-7.tsx) (lines 1–25); `/patterns/popover/standard/popover-standard-7` | Ghost `@username` trigger; hard-coded name, handle, and role. |
| `popover-standard-8` — Popover with Divider | [`.../popover-standard-8.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-8.tsx) (lines 1–26); `/patterns/popover/standard/popover-standard-8` | Two section labels separated by the `Separator` primitive. |
| `popover-standard-9` — Compact Popover | [`.../popover-standard-9.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-9.tsx) (lines 1–23); `/patterns/popover/standard/popover-standard-9` | Small outline `?` trigger; explicitly changes content to `w-auto p-2` and uses compact text. |
| `popover-standard-10` — Popover with Footer | [`.../popover-standard-10.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-10.tsx) (lines 1–30); `/patterns/popover/standard/popover-standard-10` | Heading and text followed by right-aligned Cancel/Confirm buttons; no closing or confirmation behavior is wired. |
| `popover-standard-11` — Popover with Steps | [`.../popover-standard-11.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-11.tsx) (lines 1–54); `/patterns/popover/standard/popover-standard-11` | Client component with local `step` state, fixed 1–3 copy, Previous/Next handlers, and boundary disabling. It is a UI-only tour sequence, not persisted or connected to application steps. |
| `popover-standard-12` — Notifications Popover | [`.../popover-standard-12.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-12.tsx) (lines 1–51); `/patterns/popover/standard/popover-standard-12` | Ghost Bell trigger with hard-coded badge `3`; `w-80` panel, static three notifications, and a nonfunctional “Mark all as read” button. |
| `popover-standard-13` — Filter Popover | [`.../popover-standard-13.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-13.tsx) (lines 1–52); `/patterns/popover/standard/popover-standard-13` | Filter icon trigger; three uncontrolled checkboxes with static IDs, Active initially checked, and an Apply button without filter logic. |
| `popover-standard-14` — Share Popover | [`.../popover-standard-14.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-14.tsx) (lines 1–49); `/patterns/popover/standard/popover-standard-14` | `w-80` panel: Facebook/Twitter buttons, separator, fixed read-only `https://example.com/share` input, and Copy icon button; no sharing or clipboard handling. |
| `popover-standard-15` — Feedback Popover | [`.../popover-standard-15.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-15.tsx) (lines 1–35); `/patterns/popover/standard/popover-standard-15` | `w-80` panel with explanatory copy, textarea, and Submit button; no form submission, validation, or transport. |

### Popover dependencies, gaps, and accessibility caveats

- Additional imports by variant are `Input` (4, 14), `Textarea` (15), `Separator` (8, 12, 14), `Badge` (12), `Checkbox` and `Label` (13), and Lucide icons (5, 12–15), as shown in the cited files’ import blocks.
- Replace every hard-coded identity, notification, URL, list, and filter value with application data. Wire mutating operations, loading/error states, and deliberate close/reset policy; none except Steps supplies those behaviors.
- The icon-only Info trigger has no explicit accessible name in source. Add one when adapting. [`popover-standard-5.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-5.tsx) (lines 10–14)
- The form-like Settings and Feedback variants have controls without visible associated labels, while Share’s URL is fixed; provide labels/instructions and real semantics as needed. [`popover-standard-4.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-4.tsx) (lines 14–19); [`popover-standard-15.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-15.tsx) (lines 24–28).
- The Filter IDs (`active`, `pending`, `archived`) are safe only for one rendered instance; generate instance-safe IDs if repeated. [`popover-standard-13.tsx`](../upstream/packages/patterns/popover/standard/popover-standard-13.tsx) (lines 27–42)

---

## Progress

**Catalog:** [`catalog/patterns/progress.md`](../catalog/patterns/progress.md) (lines 1–26)

All 20 variants import only `Progress`. They demonstrate fixed display values and Tailwind composition; none observes asynchronous work or changes value at runtime.

### Collection: `basic`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | --- |
| `progress-basic-1` — Empty Progress | [`.../progress-basic-1.tsx`](../upstream/packages/patterns/progress/basic/progress-basic-1.tsx) (lines 1–7); `/patterns/progress/basic/progress-basic-1` | `value={0}` with `w-full max-w-md`. |
| `progress-basic-2` — Quarter Progress | [`.../progress-basic-2.tsx`](../upstream/packages/patterns/progress/basic/progress-basic-2.tsx) (lines 1–7); `/patterns/progress/basic/progress-basic-2` | Fixed `value={25}`. |
| `progress-basic-3` — Half Progress | [`.../progress-basic-3.tsx`](../upstream/packages/patterns/progress/basic/progress-basic-3.tsx) (lines 1–7); `/patterns/progress/basic/progress-basic-3` | Fixed `value={50}`. |
| `progress-basic-4` — Three Quarters Progress | [`.../progress-basic-4.tsx`](../upstream/packages/patterns/progress/basic/progress-basic-4.tsx) (lines 1–7); `/patterns/progress/basic/progress-basic-4` | Fixed `value={75}`. |
| `progress-basic-5` — Complete Progress | [`.../progress-basic-5.tsx`](../upstream/packages/patterns/progress/basic/progress-basic-5.tsx) (lines 1–7); `/patterns/progress/basic/progress-basic-5` | Fixed `value={100}`. |

### Collection: `colored`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | ---|
| `progress-colored-1` — Success | [`.../progress-colored-1.tsx`](../upstream/packages/patterns/progress/colored/progress-colored-1.tsx) (lines 1–12); `/patterns/progress/colored/progress-colored-1` | Fixed 70%; green track and indicator via class selectors. |
| `progress-colored-2` — Warning | [`.../progress-colored-2.tsx`](../upstream/packages/patterns/progress/colored/progress-colored-2.tsx) (lines 1–12); `/patterns/progress/colored/progress-colored-2` | Fixed 50%; yellow track and indicator. |
| `progress-colored-3` — Danger | [`.../progress-colored-3.tsx`](../upstream/packages/patterns/progress/colored/progress-colored-3.tsx) (lines 1–12); `/patterns/progress/colored/progress-colored-3` | Fixed 25%; red track and indicator. |
| `progress-colored-4` — Info | [`.../progress-colored-4.tsx`](../upstream/packages/patterns/progress/colored/progress-colored-4.tsx) (lines 1–12); `/patterns/progress/colored/progress-colored-4` | Fixed 60%; blue indicator and direct-child track selector. |
| `progress-colored-5` — Gradient | [`.../progress-colored-5.tsx`](../upstream/packages/patterns/progress/colored/progress-colored-5.tsx) (lines 1–12); `/patterns/progress/colored/progress-colored-5` | Fixed 65%; blue-to-purple indicator gradient and purple translucent track. |

### Collection: `sizes`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | --- |
| `progress-sizes-1` — Extra Small | [`.../progress-sizes-1.tsx`](../upstream/packages/patterns/progress/sizes/progress-sizes-1.tsx) (lines 1–7); `/patterns/progress/sizes/progress-sizes-1` | Fixed 60%; `h-1`. |
| `progress-sizes-2` — Small | [`.../progress-sizes-2.tsx`](../upstream/packages/patterns/progress/sizes/progress-sizes-2.tsx) (lines 1–7); `/patterns/progress/sizes/progress-sizes-2` | Fixed 60%; `h-1.5`. |
| `progress-sizes-3` — Default | [`.../progress-sizes-3.tsx`](../upstream/packages/patterns/progress/sizes/progress-sizes-3.tsx) (lines 1–7); `/patterns/progress/sizes/progress-sizes-3` | Fixed 60%; wrapper default height (`h-2`). |
| `progress-sizes-4` — Large | [`.../progress-sizes-4.tsx`](../upstream/packages/patterns/progress/sizes/progress-sizes-4.tsx) (lines 1–7); `/patterns/progress/sizes/progress-sizes-4` | Fixed 60%; `h-4`. |
| `progress-sizes-5` — Extra Large | [`.../progress-sizes-5.tsx`](../upstream/packages/patterns/progress/sizes/progress-sizes-5.tsx) (lines 1–7); `/patterns/progress/sizes/progress-sizes-5` | Fixed 60%; `h-6`. |

### Collection: `with-label`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | --- |
| `progress-with-label-1` — With Percentage | [`.../progress-with-label-1.tsx`](../upstream/packages/patterns/progress/with-label/progress-with-label-1.tsx) (lines 1–18); `/patterns/progress/with-label/progress-with-label-1` | Fixed `65`; top row “Progress” and interpolated percentage. |
| `progress-with-label-2` — With Label Above | [`.../progress-with-label-2.tsx`](../upstream/packages/patterns/progress/with-label/progress-with-label-2.tsx) (lines 1–15); `/patterns/progress/with-label/progress-with-label-2` | Fixed `45`; “Uploading...” precedes bar. |
| `progress-with-label-3` — With Label Below | [`.../progress-with-label-3.tsx`](../upstream/packages/patterns/progress/with-label/progress-with-label-3.tsx) (lines 1–15); `/patterns/progress/with-label/progress-with-label-3` | Fixed `80`; “Almost there!” follows bar. |
| `progress-with-label-4` — With Count | [`.../progress-with-label-4.tsx`](../upstream/packages/patterns/progress/with-label/progress-with-label-4.tsx) (lines 1–23); `/patterns/progress/with-label/progress-with-label-4` | Computes percentage from demo `current=7`, `total=10`; exposes “7 of 10.” |
| `progress-with-label-5` — Multi-line Label | [`.../progress-with-label-5.tsx`](../upstream/packages/patterns/progress/with-label/progress-with-label-5.tsx) (lines 1–23); `/patterns/progress/with-label/progress-with-label-5` | Fixed 35%; two-line task description and right-aligned percentage. |

### Progress gaps and accessibility caveats

- Basic, colored, and size values are static examples; replace them with actual operation state. For count-based adaptation, retain the explicit calculation only if `total` is nonzero and meaningful. [`progress-with-label-4.tsx`](../upstream/packages/patterns/progress/with-label/progress-with-label-4.tsx) (lines 5–20)
- The label variants use adjacent text rather than supplying `aria-label` or `aria-labelledby` to `Progress`; source does not establish a programmatic relationship. Add an accessible name/relationship appropriate to the host primitive and context.
- Color names are visual examples, not application status semantics. Preserve only the selected visual composition and define success/warning/error thresholds in application logic.

---

## Radio group

**Catalog:** [`catalog/patterns/radio-group.md`](../catalog/patterns/radio-group.md) (lines 1–15)

### Collection: `standard`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | --- |
| `radio-group-standard-1` — Basic RadioGroup | [`.../radio-group-standard-1.tsx`](../upstream/packages/patterns/radio-group/standard/radio-group-standard-1.tsx) (lines 1–23); `/patterns/radio-group/standard/radio-group-standard-1` | Three vertically stacked label-associated items; uncontrolled default is `option-1`. |
| `radio-group-standard-2` — RadioGroup with Descriptions | [`.../radio-group-standard-2.tsx`](../upstream/packages/patterns/radio-group/standard/radio-group-standard-2.tsx) (lines 1–38); `/patterns/radio-group/standard/radio-group-standard-2` | Three top-aligned items with descriptive paragraphs; default is `comfortable`. |

### Collection: `layout`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | --- |
| `radio-group-layout-1` — Horizontal RadioGroup | [`.../radio-group-layout-1.tsx`](../upstream/packages/patterns/radio-group/layout/radio-group-layout-1.tsx) (lines 1–23); `/patterns/radio-group/layout/radio-group-layout-1` | Overrides root to `flex flex-row space-x-4`; three options, default first. |
| `radio-group-layout-2` — RadioGroup with Cards | [`.../radio-group-layout-2.tsx`](../upstream/packages/patterns/radio-group/layout/radio-group-layout-2.tsx) (lines 1–44); `/patterns/radio-group/layout/radio-group-layout-2` | Three bordered, hover-accent card wrappers with radio plus plan title/description; default first. |
| `radio-group-layout-3` — RadioGroup in Grid | [`.../radio-group-layout-3.tsx`](../upstream/packages/patterns/radio-group/layout/radio-group-layout-3.tsx) (lines 1–35); `/patterns/radio-group/layout/radio-group-layout-3` | Root becomes a two-column grid containing six basic choices; default first. |

### Collection: `advanced`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | --- |
| `radio-group-advanced-1` — RadioGroup with Icons | [`.../radio-group-advanced-1.tsx`](../upstream/packages/patterns/radio-group/advanced/radio-group-advanced-1.tsx) (lines 1–39); `/patterns/radio-group/advanced/radio-group-advanced-1` | Three payment options with CreditCard, Wallet, and Smartphone icons; uncontrolled default is `card`. |
| `radio-group-advanced-2` — RadioGroup with Custom Content | [`.../radio-group-advanced-2.tsx`](../upstream/packages/patterns/radio-group/advanced/radio-group-advanced-2.tsx) (lines 1–71); `/patterns/radio-group/advanced/radio-group-advanced-2` | Card-like Free/Pro/Enterprise options with price badges, descriptions, and hard-coded benefit lists; default is `pro`. |

### Collection: `form`

| ID — title | Local source / preview path | Source distinction |
| --- | --- | --- |
| `radio-group-form-1` — RadioGroup in Form | [`.../radio-group-form-1.tsx`](../upstream/packages/patterns/radio-group/form/radio-group-form-1.tsx) (lines 1–83); `/patterns/radio-group/form/radio-group-form-1` | Client component integrating `react-hook-form`, Zod resolver, shadcn Form parts, and Sonner. It validates one notification choice and only displays a success toast on submit. |
| `radio-group-form-2` — RadioGroup with Disabled States | [`.../radio-group-form-2.tsx`](../upstream/packages/patterns/radio-group/form/radio-group-form-2.tsx) (lines 1–52); `/patterns/radio-group/form/radio-group-form-2` | Shows separate regular, group-disabled, and mixed item-disabled samples with fixed defaults. |

### Radio-group dependencies, gaps, and accessibility caveats

- All examples import `Label`; advanced examples additionally import Lucide payment icons or `Badge`. [`radio-group-advanced-1.tsx`](../upstream/packages/patterns/radio-group/advanced/radio-group-advanced-1.tsx) (lines 1–3); [`radio-group-advanced-2.tsx`](../upstream/packages/patterns/radio-group/advanced/radio-group-advanced-2.tsx) (lines 1–3)
- The Form variant additionally requires `react-hook-form`, `@hookform/resolvers/zod`, `zod`, `sonner`, and the local Form/Button components. Its submit callback only calls `toast.success`; it does not persist notification settings. [`radio-group-form-1.tsx`](../upstream/packages/patterns/radio-group/form/radio-group-form-1.tsx) (lines 3–20, 30–32)
- Source associates each `Label` to the radio item by `htmlFor`, which should be retained. None of the non-form examples supplies an explicit group label/legend; add group-level context where surrounding UI does not already provide it.
- Cards have `cursor-pointer` and hover styling, but the outer `<div>` has no click handler. Do not promise whole-card activation unless implementation adds it. [`radio-group-layout-2.tsx`](../upstream/packages/patterns/radio-group/layout/radio-group-layout-2.tsx) (lines 7–42); [`radio-group-advanced-2.tsx`](../upstream/packages/patterns/radio-group/advanced/radio-group-advanced-2.tsx) (lines 7–69)
- Plan tiers, prices, feature limits, payment choices, and notification strings are demo data. Bind host-domain values, selected value, disabled rules, submit lifecycle, and error handling rather than copying those values.

## Architecture

Pattern files are small `Example` components that import project-alias UI primitives. The provided wrappers delegate interaction mechanics to Radix; examples layer Tailwind layout and static content on top. The catalog is the authoritative local mapping from exported source title to the website preview path, while the pattern TSX files are the authoritative source for actual demonstrated composition and callbacks.

## Start Here

Open [`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/popover.tsx`](../upstream/packages/shadcn-ui/components/ui/popover.tsx) (lines 1–48) before adapting any Popover variant: its portal, default dimensions, placement offset, and trigger composition affect every popover example.

## Coverage and missing inputs

- **Covered:** 15/15 Popover (`standard`); 20/20 Progress (`basic`, `colored`, `sizes`, `with-label`); 9/9 RadioGroup (`standard`, `layout`, `advanced`, `form`) — **44 patterns total**.
- **Missing from the snapshot/source:** host application routes, state models, mutation APIs, notification/filter/share/feedback requirements, error/loading rules, and desired accessibility acceptance criteria.
- **Not performed:** dependency installation, source changes, browser execution, website preview access, visual validation, or accessibility testing.
