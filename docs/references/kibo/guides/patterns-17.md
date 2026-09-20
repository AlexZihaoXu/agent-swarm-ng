# Patterns: tabs, textarea, toggle-group

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and method

Read-only source analysis of the local Kibo snapshot at upstream revision `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in `docs/references/kibo/metadata/manifest.json` (lines 1-14). The snapshot is reference data, not a runnable dependency (`docs/references/kibo/README.md`, lines 1-34).

All observations below come from the linked local TSX sources. Preview URLs are catalog metadata only: no browser, rendered-preview, interaction, or accessibility validation was performed.

# Code Context

## Files Retrieved

1. `docs/references/kibo/catalog/patterns/tabs.md` (lines 1-17) — complete tabs inventory, titles, source paths, and preview URLs.
2. `docs/references/kibo/catalog/patterns/textarea.md` (lines 1-19) — complete textarea inventory.
3. `docs/references/kibo/catalog/patterns/toggle-group.md` (lines 1-13) — complete toggle-group inventory.
4. `docs/references/kibo/upstream/packages/patterns/tabs/**/*.tsx` (all 11 files, lines 1-52 through 1-187) — tabs pattern source.
5. `docs/references/kibo/upstream/packages/patterns/textarea/**/*.tsx` (all 13 files, lines 1-12 through 1-31) — textarea pattern source.
6. `docs/references/kibo/upstream/packages/patterns/toggle-group/**/*.tsx` (all 7 files, lines 1-22) — toggle-group pattern source.
7. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/tabs.tsx` (lines 1-66) — local Tabs wrapper over `radix-ui`.
8. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/textarea.tsx` (lines 1-18) — native textarea wrapper and state styling.
9. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/toggle-group.tsx` (lines 1-83) and `toggle.tsx` (lines 1-47) — Radix toggle-group wrapper, variants, grouping, and focus/state styles.

## Key Code

### Shared primitives and constraints

| Family | Required local imports/primitives | Source-backed implementation notes |
|---|---|---|
| Tabs | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs` | The wrapper delegates to `TabsPrimitive` from `radix-ui`; it forwards root/list/trigger/content props and supplies Tailwind styles, active-state styling, disabled styling, and visible-focus styles. (`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/tabs.tsx`, lines 1-66) |
| Textarea | `Textarea` from `@/components/ui/textarea`; labeled variants also import `Label` | `Textarea` is a native `<textarea>` forwarding standard textarea props. Its base styles respond to `aria-invalid`, disabled state, and `focus-visible`. (`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/textarea.tsx`, lines 1-18) |
| Toggle group | `ToggleGroup`, `ToggleGroupItem` from `@/components/ui/toggle-group`; icons from `lucide-react` | The wrapper delegates to Radix ToggleGroup, passes group `variant`, `size`, and optional `spacing` to items via context, and derives item styles from `toggleVariants`. (`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/toggle-group.tsx`, lines 1-83; `toggle.tsx`, lines 1-47) |

All pattern imports use the upstream `@/components/ui/*` alias and Tailwind/theme classes. Adoption requires equivalent local primitives, aliases, styling tokens, and (where named) `lucide-react`; none of those imports establishes an application dependency or behavior by itself.

## Tabs

Source inventory: `docs/references/kibo/catalog/patterns/tabs.md` (lines 1-17).

### Advanced

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `tabs-advanced-1` — Tabs with Badge Counts | `docs/references/kibo/upstream/packages/patterns/tabs/advanced/tabs-advanced-1.tsx` (lines 1-101) | https://www.kibo-ui.com/patterns/tabs/advanced/tabs-advanced-1 | Uncontrolled `defaultValue="inbox"` with four text triggers containing `Badge` counts; panels are card-like message lists. Counts, sender addresses, status, and `Array.from` messages are demo data—replace with application state/data and navigation/action semantics. |
| `tabs-advanced-2` — Controlled Tabs | `docs/references/kibo/upstream/packages/patterns/tabs/advanced/tabs-advanced-2.tsx` (lines 1-118) | https://www.kibo-ui.com/patterns/tabs/advanced/tabs-advanced-2 | Client component uses `useState`, `value`, and `onValueChange`; Previous/Next buttons advance only among three hard-coded step values and disable at ends. The “information” is static cards, not captured form state or validation. Preserve controlled-tabs composition only if application workflow state owns the selected step. |
| `tabs-advanced-3` — Nested Tabs | `docs/references/kibo/upstream/packages/patterns/tabs/advanced/tabs-advanced-3.tsx` (lines 1-187) | https://www.kibo-ui.com/patterns/tabs/advanced/tabs-advanced-3 | Outer profile/settings/billing tabs each contain independent inner tabs with distinct defaults. Profile, billing, security, and personal data are all hard-coded display data; wire real resource data and authorization before using it for settings/billing. |

### Content

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `tabs-content-1` — Tabs with Forms | `docs/references/kibo/upstream/packages/patterns/tabs/content/tabs-content-1.tsx` (lines 1-85) | https://www.kibo-ui.com/patterns/tabs/content/tabs-content-1 | Two-column full-width trigger list switches login/register panels. Each panel has native-looking `<form>`, `Label`, `Input`, and `Button`; register additionally has `Textarea`. There is no `action` or `onSubmit`, no values, and no validation/authentication behavior in source. |
| `tabs-content-2` — Tabs with Cards | `docs/references/kibo/upstream/packages/patterns/tabs/content/tabs-content-2.tsx` (lines 1-105) | https://www.kibo-ui.com/patterns/tabs/content/tabs-content-2 | Featured/popular/recent panels each render two responsive cards, badges, and outline “Learn More” buttons. Card copy, status labels, and button behavior are demo-only; buttons have no handlers or destinations. |
| `tabs-content-3` — Tabs with Tables | `docs/references/kibo/upstream/packages/patterns/tabs/content/tabs-content-3.tsx` (lines 1-149) | https://www.kibo-ui.com/patterns/tabs/content/tabs-content-3 | A module-level generated eight-user array feeds an all-users table and source-side active/inactive filters; each panel wraps a native table in a fixed-height `ScrollArea`. Replace generated records and client-only filters with application data/query/loading/error/pagination behavior. |

### Layout

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `tabs-layout-1` — Vertical Tabs | `docs/references/kibo/upstream/packages/patterns/tabs/layout/tabs-layout-1.tsx` (lines 1-62) | https://www.kibo-ui.com/patterns/tabs/layout/tabs-layout-1 | Uses flex-row root and a flex-column `TabsList`, with full-width, left-justified triggers and a flexible content column. Content is static explanatory copy. The source does not pass an `orientation` prop despite visual vertical layout; verify keyboard-orientation expectations in the target primitive. |
| `tabs-layout-2` — Full Width Tabs | `docs/references/kibo/upstream/packages/patterns/tabs/layout/tabs-layout-2.tsx` (lines 1-60) | https://www.kibo-ui.com/patterns/tabs/layout/tabs-layout-2 | Uses a three-column grid `TabsList` for equal-width task-status triggers. All task rows and status dots are static; there is no data filtering or task action. |
| `tabs-layout-3` — Scrollable Tabs | `docs/references/kibo/upstream/packages/patterns/tabs/layout/tabs-layout-3.tsx` (lines 1-61) | https://www.kibo-ui.com/patterns/tabs/layout/tabs-layout-3 | Maps a 12-month constant into triggers/content and places the trigger list in horizontal `ScrollArea`/`ScrollBar`. Metrics call `Math.random()` while rendering, so they are non-deterministic demo output; replace with stable metrics and consider a data-driven selected period. |

### Standard

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `tabs-standard-1` — Basic Tabs | `docs/references/kibo/upstream/packages/patterns/tabs/standard/tabs-standard-1.tsx` (lines 1-52) | https://www.kibo-ui.com/patterns/tabs/standard/tabs-standard-1 | Four text tabs with `defaultValue="overview"` and one static bordered content card per tab. It demonstrates structure only; account/report/notification content is not connected to application data. |
| `tabs-standard-2` — Tabs with Icons | `docs/references/kibo/upstream/packages/patterns/tabs/standard/tabs-standard-2.tsx` (lines 1-105) | https://www.kibo-ui.com/patterns/tabs/standard/tabs-standard-2 | Imports `Bell`, `CreditCard`, `Settings`, and `User` from `lucide-react`; each text-and-icon trigger has a matching icon-led static panel. Icons are decorative alongside visible labels in this source; substitute real account/billing content and actions. |

**Tabs accessibility and adaptation boundaries.** The wrapper source supplies Radix primitives plus trigger focus styles and disabled styling, but this analysis did not execute or validate their runtime keyboard/ARIA behavior. Keep trigger values unique and keep every trigger matched to a `TabsContent`; do not retain hard-coded user, billing, task, or metric copy as production state. The visual vertical variant warrants targeted keyboard testing because its source declares layout through classes rather than the primitive orientation prop. Forms and card buttons shown inside tabs need real submit/click behavior, validation, pending/error feedback, and authorization boundaries.

## Textarea

Source inventory: `docs/references/kibo/catalog/patterns/textarea.md` (lines 1-19).

### Form

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `textarea-form-1` — Required Textarea | `docs/references/kibo/upstream/packages/patterns/textarea/form/textarea-form-1.tsx` (lines 1-20) | https://www.kibo-ui.com/patterns/textarea/form/textarea-form-1 | Label is linked by `htmlFor`/`id`; a visible destructive-color asterisk accompanies native `required`. It is not inside a form and has no submission/validation display flow. |
| `textarea-form-2` — Textarea with Helper Text | `docs/references/kibo/upstream/packages/patterns/textarea/form/textarea-form-2.tsx` (lines 1-20) | https://www.kibo-ui.com/patterns/textarea/form/textarea-form-2 | Stacks linked label, textarea, and profile helper paragraph. The helper has no `id` or `aria-describedby`, so source does not programmatically associate it with the textarea. |
| `textarea-form-3` — Textarea with Error | `docs/references/kibo/upstream/packages/patterns/textarea/form/textarea-form-3.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/textarea/form/textarea-form-3 | Demonstrates `aria-invalid="true"`, a static `defaultValue="Too short"`, and destructive error text. It contains no validation logic and does not associate error text using `aria-describedby` or an error-message role. |
| `textarea-form-4` — Textarea with Hint | `docs/references/kibo/upstream/packages/patterns/textarea/form/textarea-form-4.tsx` (lines 1-20) | https://www.kibo-ui.com/patterns/textarea/form/textarea-form-4 | Places a linked label and visible “Optional” hint in a justified header. “Optional” is presentation text only; no optional/required business rule is represented. |
| `textarea-form-5` — Textarea with Character Count | `docs/references/kibo/upstream/packages/patterns/textarea/form/textarea-form-5.tsx` (lines 1-31) | https://www.kibo-ui.com/patterns/textarea/form/textarea-form-5 | Client component controls textarea value with `useState`, applies `maxLength={200}`, and renders `value.length/200`. It is the only textarea pattern with live input state; count has no `aria-live` declaration and value is not persisted/submitted. |

### Labeled

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `textarea-labeled-1` — Textarea with Label | `docs/references/kibo/upstream/packages/patterns/textarea/labeled/textarea-labeled-1.tsx` (lines 1-17) | https://www.kibo-ui.com/patterns/textarea/labeled/textarea-labeled-1 | Minimal linked `Label` plus textarea stack. Placeholder is demo copy; add form name, value handling, and validation only as needed by the target flow. |
| `textarea-labeled-2` — Textarea with Description | `docs/references/kibo/upstream/packages/patterns/textarea/labeled/textarea-labeled-2.tsx` (lines 1-18) | https://www.kibo-ui.com/patterns/textarea/labeled/textarea-labeled-2 | Adds a muted description under linked label before the textarea. As with helper text, source does not use `aria-describedby` to connect description and control. |
| `textarea-labeled-3` — Textarea with Floating Label | `docs/references/kibo/upstream/packages/patterns/textarea/labeled/textarea-labeled-3.tsx` (lines 1-30) | https://www.kibo-ui.com/patterns/textarea/labeled/textarea-labeled-3 | Controlled client textarea uses a single-space placeholder and `peer` CSS state to move an absolutely positioned native `<label>`. Keep the actual label and linked `id`; the blank-like placeholder and state logic are specifically for this visual treatment. |
| `textarea-labeled-4` — Textarea with Inline Label | `docs/references/kibo/upstream/packages/patterns/textarea/labeled/textarea-labeled-4.tsx` (lines 1-20) | https://www.kibo-ui.com/patterns/textarea/labeled/textarea-labeled-4 | Horizontal flex row, fixed-width/shrink-resistant linked label, and `rows={3}` textarea with `min-h-0`. Preserve this compact geometry only where it remains usable at target widths. |

### Standard

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `textarea-standard-1` — Simple Textarea | `docs/references/kibo/upstream/packages/patterns/textarea/standard/textarea-standard-1.tsx` (lines 1-12) | https://www.kibo-ui.com/patterns/textarea/standard/textarea-standard-1 | Bare textarea with placeholder and width/background classes. It has no visible label, `id`, or form integration; do not use placeholder as the sole field label in application UI. |
| `textarea-standard-2` — Disabled Textarea | `docs/references/kibo/upstream/packages/patterns/textarea/standard/textarea-standard-2.tsx` (lines 1-13) | https://www.kibo-ui.com/patterns/textarea/standard/textarea-standard-2 | Same basic composition with native `disabled`. There is no explanatory label or reason for the disabled state. |
| `textarea-standard-3` — Read-only Textarea | `docs/references/kibo/upstream/packages/patterns/textarea/standard/textarea-standard-3.tsx` (lines 1-14) | https://www.kibo-ui.com/patterns/textarea/standard/textarea-standard-3 | Uses `readOnly` and a static `defaultValue`; it is distinct from disabled because source explicitly chooses read-only. Replace demo value and determine target focus/copy behavior. |
| `textarea-standard-4` — Short Textarea | `docs/references/kibo/upstream/packages/patterns/textarea/standard/textarea-standard-4.tsx` (lines 1-13) | https://www.kibo-ui.com/patterns/textarea/standard/textarea-standard-4 | Uses `rows={3}` plus `min-h-0` to override the wrapper’s default minimum height. It is a sizing-only variation. |

**Textarea accessibility and adaptation boundaries.** The primitive forwards native textarea props and provides `aria-invalid`/focus/disabled visual styles, but no browser or assistive-technology validation was performed. Prefer linked labels as shown in labeled/form variants; connect descriptions/errors/count announcements with explicit semantics when required. Preserve native `required`, `disabled`, `readOnly`, `maxLength`, and label associations where selected, while adding target form state, names, submission, server validation, and error handling. The static error and character count are demonstration presentation/state, not production validation.

## Toggle group

Source inventory: `docs/references/kibo/catalog/patterns/toggle-group.md` (lines 1-13).

### Sizes

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `toggle-group-sizes-1` — Small Toggle Group | `docs/references/kibo/upstream/packages/patterns/toggle-group/sizes/toggle-group-sizes-1.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/toggle-group/sizes/toggle-group-sizes-1 | Client, multiple-selection outline group containing icon-only bold/italic/underline items, each with an `aria-label`; explicitly sets `size="sm"`. No formatting state is applied to content. |
| `toggle-group-sizes-2` — Default Size Toggle Group | `docs/references/kibo/upstream/packages/patterns/toggle-group/sizes/toggle-group-sizes-2.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/toggle-group/sizes/toggle-group-sizes-2 | Same three icon items, multiple selection, and outline appearance, omitting `size` to use the primitive default. No selected-value callback or integration exists. |
| `toggle-group-sizes-3` — Large Toggle Group | `docs/references/kibo/upstream/packages/patterns/toggle-group/sizes/toggle-group-sizes-3.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/toggle-group/sizes/toggle-group-sizes-3 | Same outline/multiple formatting set with explicit `size="lg"`. It differs only in primitive size prop, not actions or data. |

### Standard

| ID / title | Local source | Preview | Distinguishing source composition and demo boundary |
|---|---|---|---|
| `toggle-group-standard-1` — Default Toggle Group | `docs/references/kibo/upstream/packages/patterns/toggle-group/standard/toggle-group-standard-1.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/toggle-group/standard/toggle-group-standard-1 | Multiple-selection bold/italic/underline icon group using default visual variant. The three `aria-label`s identify otherwise icon-only items; selections have no downstream effect. |
| `toggle-group-standard-2` — Outline Toggle Group | `docs/references/kibo/upstream/packages/patterns/toggle-group/standard/toggle-group-standard-2.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/toggle-group/standard/toggle-group-standard-2 | Same multiple formatting controls with `variant="outline"`. The group wrapper joins zero-spacing outline items by changing adjacent borders/radii (`toggle-group.tsx`, lines 56-72). |
| `toggle-group-standard-3` — Single Selection Toggle Group | `docs/references/kibo/upstream/packages/patterns/toggle-group/standard/toggle-group-standard-3.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/toggle-group/standard/toggle-group-standard-3 | Outline group sets `type="single"` and changes values/icons to left/center/right alignment. Bind chosen alignment to real editor/layout state if adapted; source has no value or change handler. |
| `toggle-group-standard-4` — Disabled Toggle Group | `docs/references/kibo/upstream/packages/patterns/toggle-group/standard/toggle-group-standard-4.tsx` (lines 1-22) | https://www.kibo-ui.com/patterns/toggle-group/standard/toggle-group-standard-4 | Default-variant, multiple-selection formatting group with root `disabled`. It demonstrates whole-group unavailability only; it has no reason, permissions model, or item-level availability logic. |

**Toggle-group accessibility and adaptation boundaries.** All icon-only demo items supply `aria-label`, a pattern worth retaining when icons remain unlabeled. The source does not provide an `aria-label` or `aria-labelledby` to name the group itself; add a group label/context where the controls need one. The primitive supplies focus-visible, disabled, and `data-[state=on]` styles (`toggle.tsx`, lines 7-30), but runtime behavior and accessibility were not browser-validated. Keep the declared single versus multiple choice and visual variant/size for the selected composition; connect `value`/change callbacks to application state and perform the actual formatting/alignment or permissions behavior outside the demo.

## Architecture

The catalog is navigational metadata only: it maps each family ID to an exact local upstream source and public preview URL (`docs/references/kibo/catalog/patterns/tabs.md`, lines 1-17; `textarea.md`, lines 1-19; `toggle-group.md`, lines 1-13). Pattern files export a `title` and a default `Example` component. They compose aliased UI primitives and Tailwind classes; they do not provide application routes, persistence, API calls, authorization, or production data handling.

The primitive layer is separate under `packages/shadcn-ui/components/ui/`: Tabs and ToggleGroup delegate to `radix-ui`, while Textarea is a forwarding native element. Demo source is therefore useful for composition and local prop usage, not evidence that an application implements the displayed workflow.

## Start Here

Open `docs/references/kibo/catalog/patterns/tabs.md` first: it is the bounded inventory for all 11 tabs patterns and links every exact source/preview. Then read the corresponding primitive at `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/tabs.tsx` before adapting a tabs variant.

## Coverage and missing inputs

- **Accounted for:** all **31** assigned sources — Tabs: 11 (advanced 3, content 3, layout 3, standard 2); Textarea: 13 (form 5, labeled 4, standard 4); Toggle group: 7 (sizes 3, standard 4).
- **Catalog/provenance read:** all three assigned family indexes and snapshot manifest revision metadata.
- **Missing inputs:** no target product flow, data model, validation rules, form submission contract, authorization model, or selected variant was supplied.
- **Not claimed:** current upstream/website availability, rendered appearance, browser behavior, keyboard interaction, responsive behavior, or assistive-technology validation.
