# Patterns: skeleton, slider, sonner

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

This is a read-only source analysis of the pinned Kibo snapshot at upstream revision `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in `docs/references/kibo/metadata/manifest.json` (lines 1-13). The snapshot handoff says the mirror contains 1,644 tracked files and that no patterns were executed or visually/browser validated: `docs/references/kibo/VERIFICATION.md` (lines 1-32).

The inventory and titles below come from the three generated family indexes, cross-checked against every corresponding TSX source. “Preview” is catalog navigation metadata only—not a visited or validated website.

**Source roots:** `docs/references/kibo/upstream/packages/patterns/{skeleton,slider,sonner}/`; catalog indexes `docs/references/kibo/catalog/patterns/{skeleton,slider,sonner}.md`.

## Shared implementation facts

| Piece | Local implementation | What source establishes |
|---|---|---|
| Skeleton primitive | `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/skeleton.tsx` (lines 1-13) | `Skeleton` is a `div` forwarding normal div props, with `data-slot="skeleton"` and `bg-accent animate-pulse rounded-md`; it combines caller classes via `cn`. |
| Slider primitive | `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/slider.tsx` (lines 1-63) | Client component wrapping `radix-ui` `SliderPrimitive.Root`, Track, Range, and one Thumb per controlled/default value. Defaults `min=0`, `max=100`; supports controlled `value` or `defaultValue`, forwarding remaining root props. Its classes handle vertical orientation, touch suppression, disabled opacity, hover/focus-visible rings, and thumb disabled state. |
| Sonner host | `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/sonner.tsx` (lines 1-40) | Client `Toaster` wrapper around `sonner`’s `Toaster`; obtains `next-themes` theme and supplies Lucide status/loading icons plus CSS variables, then forwards props. No pattern below renders this host. |

The snapshot package metadata lists `radix-ui: "latest"`, `sonner: ^2.0.7`, `next-themes: ^0.4.6`, and `lucide-react: ^0.545.0` in `docs/references/kibo/upstream/packages/shadcn-ui/package.json` (lines 1-29); the patterns package also declares `sonner` and Lucide (`docs/references/kibo/upstream/packages/patterns/package.json`, lines 1-22). These are reference dependencies, not a directive to add them to this project.

---

# Skeleton

All 30 exports are static placeholder layouts importing only `Skeleton` from `@/components/ui/skeleton`; none has state, fetching, event handlers, live data, or semantic loading status. Fixed `Array.from` loops are demo layout repetition, not data loading. Each source is an `Example` default export plus a title.

**Safe adaptation boundary.** Preserve the chosen layout’s dimensions, responsive/container constraints, and silhouette only while an actual loading state is pending; replace it with the real semantic component when data is ready. The source primitive is an unlabelled animated `div`, so decide application-appropriate loading announcement, `aria-busy`, reduced-motion treatment, focus behavior, and whether placeholder structure is hidden from assistive technology. No accessibility or browser validation was performed.

## Card collection

| ID — title | Local source (lines) | Preview | Source-specific composition |
|---|---|---|---|
| `skeleton-card-1` — Simple Card with Image and Text | `docs/references/kibo/upstream/packages/patterns/skeleton/card/skeleton-card-1.tsx` (1-13) | `https://www.kibo-ui.com/patterns/skeleton/card/skeleton-card-1` | Narrow vertical stack: 48-high full image block, then 3/4 and 1/2 text bars; no card border. |
| `skeleton-card-2` — Card with Avatar and Content | `docs/references/kibo/upstream/packages/patterns/skeleton/card/skeleton-card-2.tsx` (1-20) | `https://www.kibo-ui.com/patterns/skeleton/card/skeleton-card-2` | Bordered/padded card with 12×12 round avatar, two metadata bars, and three body bars. |
| `skeleton-card-3` — Card with Badge and Tags | `docs/references/kibo/upstream/packages/patterns/skeleton/card/skeleton-card-3.tsx` (1-21) | `https://www.kibo-ui.com/patterns/skeleton/card/skeleton-card-3` | Bordered card with two pill badges, heading/body, then two rectangular action/tag blocks. |
| `skeleton-card-4` — Vertical Card Layout | `docs/references/kibo/upstream/packages/patterns/skeleton/card/skeleton-card-4.tsx` (1-21) | `https://www.kibo-ui.com/patterns/skeleton/card/skeleton-card-4` | Overflow-hidden bordered card: edge-to-edge 40-high media block and padded body/footer with a 20-wide label and 24-wide button silhouette. |
| `skeleton-card-5` — Horizontal Card Layout | `docs/references/kibo/upstream/packages/patterns/skeleton/card/skeleton-card-5.tsx` (1-20) | `https://www.kibo-ui.com/patterns/skeleton/card/skeleton-card-5` | Wide row card: fixed 24×24 media at left; flexible text column and bottom-aligned two-item metadata/footer. |

## Content collection

| ID — title | Local source (lines) | Preview | Source-specific composition |
|---|---|---|---|
| `skeleton-content-1` — Article Preview | `docs/references/kibo/upstream/packages/patterns/skeleton/content/skeleton-content-1.tsx` (1-26) | `https://www.kibo-ui.com/patterns/skeleton/content/skeleton-content-1` | Bordered article preview: avatar/byline, 3/4 title, three text bars, then three pill tags. |
| `skeleton-content-2` — Blog Post | `docs/references/kibo/upstream/packages/patterns/skeleton/content/skeleton-content-2.tsx` (1-30) | `https://www.kibo-ui.com/patterns/skeleton/content/skeleton-content-2` | Unbordered 3xl column with large title, avatar metadata, 64-high media, and two separate paragraph groups. |
| `skeleton-content-3` — Comment Thread | `docs/references/kibo/upstream/packages/patterns/skeleton/content/skeleton-content-3.tsx` (1-27) | `https://www.kibo-ui.com/patterns/skeleton/content/skeleton-content-3` | Maps exactly three repeated comment rows: avatar, name/time row, two body bars, and two compact action blocks. |
| `skeleton-content-4` — Detailed Article | `docs/references/kibo/upstream/packages/patterns/skeleton/content/skeleton-content-4.tsx` (1-31) | `https://www.kibo-ui.com/patterns/skeleton/content/skeleton-content-4` | Large article shell: title/subtitle, 96-high hero, two headed copy sections, and final 48-high media block. |
| `skeleton-content-5` — Content with Sidebar | `docs/references/kibo/upstream/packages/patterns/skeleton/content/skeleton-content-5.tsx` (1-41) | `https://www.kibo-ui.com/patterns/skeleton/content/skeleton-content-5` | Fixed three-column grid: two-column article plus one-column sidebar containing a text card and a four-row mini-list card. It does not collapse responsively in source. |

## Form collection

| ID — title | Local source (lines) | Preview | Source-specific composition |
|---|---|---|---|
| `skeleton-form-1` — Input Fields | `docs/references/kibo/upstream/packages/patterns/skeleton/form/skeleton-form-1.tsx` (1-22) | `https://www.kibo-ui.com/patterns/skeleton/form/skeleton-form-1` | Three unbordered vertical label-plus-10-high-control pairs. |
| `skeleton-form-2` — Form with Labels | `docs/references/kibo/upstream/packages/patterns/skeleton/form/skeleton-form-2.tsx` (1-27) | `https://www.kibo-ui.com/patterns/skeleton/form/skeleton-form-2` | Padded border card with heading/description, two single-line fields, one 24-high textarea, and full-width submit block. |
| `skeleton-form-3` — Multi-column Form | `docs/references/kibo/upstream/packages/patterns/skeleton/form/skeleton-form-3.tsx` (1-35) | `https://www.kibo-ui.com/patterns/skeleton/form/skeleton-form-3` | Two literal `grid-cols-2` pairs, then one full-width field and a 32-wide submit block; no small-screen grid fallback. |
| `skeleton-form-4` — Form with Sections | `docs/references/kibo/upstream/packages/patterns/skeleton/form/skeleton-form-4.tsx` (1-37) | `https://www.kibo-ui.com/patterns/skeleton/form/skeleton-form-4` | Two titled field groups visually nested by `border-l-2 pl-4`, followed by a 32-wide submit block. |
| `skeleton-form-5` — Search Form | `docs/references/kibo/upstream/packages/patterns/skeleton/form/skeleton-form-5.tsx` (1-28) | `https://www.kibo-ui.com/patterns/skeleton/form/skeleton-form-5` | Search/control row, label plus four wrapped pill filters, divider, and result-summary/action row. |

## List collection

| ID — title | Local source (lines) | Preview | Source-specific composition |
|---|---|---|---|
| `skeleton-list-1` — Simple List Items | `docs/references/kibo/upstream/packages/patterns/skeleton/list/skeleton-list-1.tsx` (1-16) | `https://www.kibo-ui.com/patterns/skeleton/list/skeleton-list-1` | Five repeated rows of a small square marker plus flexible single text bar. |
| `skeleton-list-2` — List with Avatars | `docs/references/kibo/upstream/packages/patterns/skeleton/list/skeleton-list-2.tsx` (1-19) | `https://www.kibo-ui.com/patterns/skeleton/list/skeleton-list-2` | Four repeated avatar rows with two-line flexible text. |
| `skeleton-list-3` — List with Icons | `docs/references/kibo/upstream/packages/patterns/skeleton/list/skeleton-list-3.tsx` (1-20) | `https://www.kibo-ui.com/patterns/skeleton/list/skeleton-list-3` | Five bordered, padded rows: leading rounded-square icon, two text lines, trailing rounded-square control. |
| `skeleton-list-4` — Multi-line List Items | `docs/references/kibo/upstream/packages/patterns/skeleton/list/skeleton-list-4.tsx` (1-21) | `https://www.kibo-ui.com/patterns/skeleton/list/skeleton-list-4` | Three bordered cards with title, two copy lines, and two pill tags. |
| `skeleton-list-5` — Hierarchical List Items | `docs/references/kibo/upstream/packages/patterns/skeleton/list/skeleton-list-5.tsx` (1-30) | `https://www.kibo-ui.com/patterns/skeleton/list/skeleton-list-5` | Five explicit rows; rows 2, 3, and 5 are indented `pl-6`. It does not implement tree controls or hierarchy semantics. |

## Profile collection

| ID — title | Local source (lines) | Preview | Source-specific composition |
|---|---|---|---|
| `skeleton-profile-1` — User Profile Header | `docs/references/kibo/upstream/packages/patterns/skeleton/profile/skeleton-profile-1.tsx` (1-19) | `https://www.kibo-ui.com/patterns/skeleton/profile/skeleton-profile-1` | Centered bordered header: 24×24 avatar, centered name/secondary text, and two equal action blocks. |
| `skeleton-profile-2` — Profile Card | `docs/references/kibo/upstream/packages/patterns/skeleton/profile/skeleton-profile-2.tsx` (1-33) | `https://www.kibo-ui.com/patterns/skeleton/profile/skeleton-profile-2` | Header avatar/identity, two bio bars, and border-top row of three centered statistic pairs. |
| `skeleton-profile-3` — Profile Settings Form | `docs/references/kibo/upstream/packages/patterns/skeleton/profile/skeleton-profile-3.tsx` (1-27) | `https://www.kibo-ui.com/patterns/skeleton/profile/skeleton-profile-3` | Four settings fields (last 24-high) and 32-wide submit block; no outer card. |
| `skeleton-profile-4` — Profile with Stats | `docs/references/kibo/upstream/packages/patterns/skeleton/profile/skeleton-profile-4.tsx` (1-33) | `https://www.kibo-ui.com/patterns/skeleton/profile/skeleton-profile-4` | Bordered profile summary with 20×20 avatar, three identity/bio bars, three individually bordered stat cells, and full-width control. |
| `skeleton-profile-5` — Team Member Card | `docs/references/kibo/upstream/packages/patterns/skeleton/profile/skeleton-profile-5.tsx` (1-22) | `https://www.kibo-ui.com/patterns/skeleton/profile/skeleton-profile-5` | Centered narrow card with avatar, identity, two bio lines, and three circular social/control silhouettes. |

## Table collection

These are CSS grid silhouettes, not HTML `<table>` markup; do not carry them into a data table that needs table semantics without replacing the structure.

| ID — title | Local source (lines) | Preview | Source-specific composition |
|---|---|---|---|
| `skeleton-table-1` — Simple Table Rows | `docs/references/kibo/upstream/packages/patterns/skeleton/table/skeleton-table-1.tsx` (1-24) | `https://www.kibo-ui.com/patterns/skeleton/table/skeleton-table-1` | Four-column bordered header and five repeated four-cell rows. |
| `skeleton-table-2` — Table with Actions | `docs/references/kibo/upstream/packages/patterns/skeleton/table/skeleton-table-2.tsx` (1-29) | `https://www.kibo-ui.com/patterns/skeleton/table/skeleton-table-2` | Five-column header and four rows whose final cell has two 8×8 action placeholders. |
| `skeleton-table-3` — Table with Avatars | `docs/references/kibo/upstream/packages/patterns/skeleton/table/skeleton-table-3.tsx` (1-27) | `https://www.kibo-ui.com/patterns/skeleton/table/skeleton-table-3` | Four columns; first cell combines an 8×8 avatar with text across four repeated rows. |
| `skeleton-table-4` — Expandable Rows | `docs/references/kibo/upstream/packages/patterns/skeleton/table/skeleton-table-4.tsx` (1-42) | `https://www.kibo-ui.com/patterns/skeleton/table/skeleton-table-4` | Four-column header, one row with square expander silhouette plus an already visible muted indented detail block, then another row. No expand/collapse state or control exists. |
| `skeleton-table-5` — Table with Pagination | `docs/references/kibo/upstream/packages/patterns/skeleton/table/skeleton-table-5.tsx` (1-36) | `https://www.kibo-ui.com/patterns/skeleton/table/skeleton-table-5` | Four-column header/five rows and a border-top footer containing summary bar plus five square pagination placeholders; no page state. |

---

# Slider

All 29 examples are client components. They use local React `useState` to control a numeric `number[]`; this is demo-local state only—there is no persistence, submission, validation contract, server update, or debouncing. They all import `Slider` from `@/components/ui/slider`; every example except `slider-standard-1` also imports `Label` from `@/components/ui/label`. Repeated `id="slider"` is safe only per isolated example; use unique IDs in a composed application screen.

**Safe adaptation boundary.** Reuse the selected composition and visual selector overrides (`data-slot` targets) only with a domain-owned controlled value, bounds/step, units, and write policy. Do not treat visual endpoint text, labels, preset arrays, or the examples’ initial values as business rules. The underlying Radix wrapper suggests keyboard/focus support but this review did not run it; verify keyboard, pointer, range ordering/limits, touch behavior, contrast, reduced-motion needs, and label association in the target app. In particular, the tooltip variant is a positioned plain `div`, not a demonstrated accessible tooltip.

## Interactive collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/composition |
|---|---|---|---|
| `slider-interactive-1` — Synced with Input Field | `docs/references/kibo/upstream/packages/patterns/slider/interactive/slider-interactive-1.tsx` (1-38) | `https://www.kibo-ui.com/patterns/slider/interactive/slider-interactive-1` | Adds `Input`; accepts numeric changes only when 0–100 and non-NaN, synchronizing with a 50 initial slider value. |
| `slider-interactive-2` — With Increment/Decrement Buttons | `docs/references/kibo/upstream/packages/patterns/slider/interactive/slider-interactive-2.tsx` (1-46) | `https://www.kibo-ui.com/patterns/slider/interactive/slider-interactive-2` | Adds outline icon `Button`s and Lucide Minus/Plus; changes value by 10 and clamps manually to 0–100. |
| `slider-interactive-3` — With Preset Values | `docs/references/kibo/upstream/packages/patterns/slider/interactive/slider-interactive-3.tsx` (1-38) | `https://www.kibo-ui.com/patterns/slider/interactive/slider-interactive-3` | Renders five equal-width outline buttons from demo array `[0,25,50,75,100]`; each replaces the single value. |
| `slider-interactive-4` — With Reset Button | `docs/references/kibo/upstream/packages/patterns/slider/interactive/slider-interactive-4.tsx` (1-34) | `https://www.kibo-ui.com/patterns/slider/interactive/slider-interactive-4` | Retains `defaultValue=50` in component scope; an outline Reset button restores it. |
| `slider-interactive-5` — With Live Preview | `docs/references/kibo/upstream/packages/patterns/slider/interactive/slider-interactive-5.tsx` (1-33) | `https://www.kibo-ui.com/patterns/slider/interactive/slider-interactive-5` | Bounds slider 0–50 and maps the current value to inline `borderRadius` on a 24-high preview block. |

## Range collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/composition |
|---|---|---|---|
| `slider-range-1` — Basic Range Slider | `docs/references/kibo/upstream/packages/patterns/slider/range/slider-range-1.tsx` (1-26) | `https://www.kibo-ui.com/patterns/slider/range/slider-range-1` | Two thumbs controlled as `[25,75]`, explicit 0–100 bounds, label only. |
| `slider-range-2` — Price Range Slider | `docs/references/kibo/upstream/packages/patterns/slider/range/slider-range-2.tsx` (1-30) | `https://www.kibo-ui.com/patterns/slider/range/slider-range-2` | `[200,800]` within 0–1000 and displays each endpoint with literal `$` formatting. |
| `slider-range-3` — Range with Value Display | `docs/references/kibo/upstream/packages/patterns/slider/range/slider-range-3.tsx` (1-31) | `https://www.kibo-ui.com/patterns/slider/range/slider-range-3` | Displays `value[0] - value[1]` alongside label; bounds 0–100. |
| `slider-range-4` — Range with Constraints | `docs/references/kibo/upstream/packages/patterns/slider/range/slider-range-4.tsx` (1-39) | `https://www.kibo-ui.com/patterns/slider/range/slider-range-4` | `handleValueChange` ignores updates unless endpoint difference is at least 10; this is the only demonstrated constraint and does not communicate rejected moves. |
| `slider-range-5` — Percentage Range | `docs/references/kibo/upstream/packages/patterns/slider/range/slider-range-5.tsx` (1-36) | `https://www.kibo-ui.com/patterns/slider/range/slider-range-5` | `[10,90]`, 0–100, step 5; shows percent endpoint value and static 0%/100% captions. |

## Settings collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/composition |
|---|---|---|---|
| `slider-settings-1` — Volume Control | `docs/references/kibo/upstream/packages/patterns/slider/settings/slider-settings-1.tsx` (1-27) | `https://www.kibo-ui.com/patterns/slider/settings/slider-settings-1` | Initial 65; Lucide `Volume2Icon`, label, and percentage display. The icon is not given text/ARIA handling in this source. |
| `slider-settings-2` — Brightness Control | `docs/references/kibo/upstream/packages/patterns/slider/settings/slider-settings-2.tsx` (1-32) | `https://www.kibo-ui.com/patterns/slider/settings/slider-settings-2` | Initial 80; Sun icon and selector-class overrides color Range and Thumb border yellow. |
| `slider-settings-3` — Temperature Control | `docs/references/kibo/upstream/packages/patterns/slider/settings/slider-settings-3.tsx` (1-38) | `https://www.kibo-ui.com/patterns/slider/settings/slider-settings-3` | Initial 22, 16–30 bounds, °C labels; transparent range over blue-to-red gradient Track. |
| `slider-settings-4` — Speed Control | `docs/references/kibo/upstream/packages/patterns/slider/settings/slider-settings-4.tsx` (1-43) | `https://www.kibo-ui.com/patterns/slider/settings/slider-settings-4` | Integer 0–3 slider indexes demo string array `Slow` through `Very Fast`; renders those four strings as captions. Guard domain array indexing in an application. |

## Standard collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/composition |
|---|---|---|---|
| `slider-standard-1` — Simple Slider | `docs/references/kibo/upstream/packages/patterns/slider/standard/slider-standard-1.tsx` (1-18) | `https://www.kibo-ui.com/patterns/slider/standard/slider-standard-1` | Bare single controlled slider, initial 50; no visible label. |
| `slider-standard-2` — Slider with Label | `docs/references/kibo/upstream/packages/patterns/slider/standard/slider-standard-2.tsx` (1-20) | `https://www.kibo-ui.com/patterns/slider/standard/slider-standard-2` | Initial 30 with Volume label. |
| `slider-standard-3` — Slider with Value Display | `docs/references/kibo/upstream/packages/patterns/slider/standard/slider-standard-3.tsx` (1-23) | `https://www.kibo-ui.com/patterns/slider/standard/slider-standard-3` | Initial 65 with Quality label and live `%` display. |
| `slider-standard-4` — Slider with Min/Max Labels | `docs/references/kibo/upstream/packages/patterns/slider/standard/slider-standard-4.tsx` (1-30) | `https://www.kibo-ui.com/patterns/slider/standard/slider-standard-4` | Explicit 0–100 Size slider with static endpoint captions. |
| `slider-standard-5` — Slider with Step Indicators | `docs/references/kibo/upstream/packages/patterns/slider/standard/slider-standard-5.tsx` (1-37) | `https://www.kibo-ui.com/patterns/slider/standard/slider-standard-5` | 0–100, step 25, live Level display, and five manually positioned numeric captions. |

## Styled collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/composition |
|---|---|---|---|
| `slider-styled-1` — Colored Slider | `docs/references/kibo/upstream/packages/patterns/slider/styled/slider-styled-1.tsx` (1-28) | `https://www.kibo-ui.com/patterns/slider/styled/slider-styled-1` | Initial 60 Success Rate; nested slot selectors change range and thumb border to green. |
| `slider-styled-2` — With Tooltip | `docs/references/kibo/upstream/packages/patterns/slider/styled/slider-styled-2.tsx` (1-28) | `https://www.kibo-ui.com/patterns/slider/styled/slider-styled-2` | Initial 45 Progress; plain absolute value bubble uses `left: ${value[0]}%` inside a relative wrapper. It has no collision/clamping logic or tooltip semantics. |
| `slider-styled-3` — Large/Thick Slider | `docs/references/kibo/upstream/packages/patterns/slider/styled/slider-styled-3.tsx` (1-28) | `https://www.kibo-ui.com/patterns/slider/styled/slider-styled-3` | Initial 55 Volume; selector overrides make Thumb 6×6 and Track height 3. |
| `slider-styled-4` — Minimal Style | `docs/references/kibo/upstream/packages/patterns/slider/styled/slider-styled-4.tsx` (1-28) | `https://www.kibo-ui.com/patterns/slider/styled/slider-styled-4` | Initial 40 Intensity; transparent, bordered Track and 2px Thumb border. |
| `slider-styled-5` — With Gradient Track | `docs/references/kibo/upstream/packages/patterns/slider/styled/slider-styled-5.tsx` (1-28) | `https://www.kibo-ui.com/patterns/slider/styled/slider-styled-5` | Initial 70 Heat; transparent Range over blue-to-red gradient Track, and degree display. |

## Vertical collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/composition |
|---|---|---|---|
| `slider-vertical-1` — Volume Control Style | `docs/references/kibo/upstream/packages/patterns/slider/vertical/slider-vertical-1.tsx` (1-27) | `https://www.kibo-ui.com/patterns/slider/vertical/slider-vertical-1` | Centered vertical orientation, `h-48`, initial 60, label and percent display. |
| `slider-vertical-2` — Height Selector | `docs/references/kibo/upstream/packages/patterns/slider/vertical/slider-vertical-2.tsx` (1-29) | `https://www.kibo-ui.com/patterns/slider/vertical/slider-vertical-2` | Centered `h-64` vertical slider, 100–250, initial 170, `cm` presentation. |
| `slider-vertical-3` — Vertical with Labels | `docs/references/kibo/upstream/packages/patterns/slider/vertical/slider-vertical-3.tsx` (1-36) | `https://www.kibo-ui.com/patterns/slider/vertical/slider-vertical-3` | `h-48` vertical slider flanked by manually spaced 100/75/50/25/0 text and a Level/value column; tick labels are not programmatically tied in source. |
| `slider-vertical-4` — Vertical Range | `docs/references/kibo/upstream/packages/patterns/slider/vertical/slider-vertical-4.tsx` (1-31) | `https://www.kibo-ui.com/patterns/slider/vertical/slider-vertical-4` | Two-thumb `[30,70]` vertical slider at `h-56`, displaying upper then lower endpoint beneath. |
| `slider-vertical-5` — Vertical with Indicators | `docs/references/kibo/upstream/packages/patterns/slider/vertical/slider-vertical-5.tsx` (1-37) | `https://www.kibo-ui.com/patterns/slider/vertical/slider-vertical-5` | `h-52`, step 25, 50 initial value, and five fixed-height textual Max–Min indicators; no mapping other than visual placement. |

---

# Sonner

All 24 examples are client components that import `toast` directly from `sonner` and an outline `Button` from `@/components/ui/button`; content item 2 also imports `CheckCircleIcon` from `lucide-react`. Their fixed strings, identities, dates, and simulated timing are demo data. They contain no backend mutation, undo implementation, policy/error translation, retry, deduplication, or app-level toast-host configuration.

**Safe adaptation boundary.** Render/configure one appropriate application toast host (the referenced wrapper is available above), then call toasts only from completed/started domain operations. Replace static messages with outcome-aware content and make action/cancel callbacks perform real, safe operations (including an actual undo/delete confirmation policy), not follow-up demo toasts. Validate interruption, timeout/dismissal, action keyboard flow, focus, screen-reader announcements, localization, and concurrent/error behavior in the app; none was browser- or assistive-technology-tested here.

## Content collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/content |
|---|---|---|---|
| `sonner-content-1` — Toast with Description | `docs/references/kibo/upstream/packages/patterns/sonner/content/sonner-content-1.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/content/sonner-content-1` | Button calls default `toast` with event title and fixed Monday/date description. |
| `sonner-content-2` — Toast with Custom Icon | `docs/references/kibo/upstream/packages/patterns/sonner/content/sonner-content-2.tsx` (1-23) | `https://www.kibo-ui.com/patterns/sonner/content/sonner-content-2` | Supplies a 4×4 `CheckCircleIcon` plus fixed payment description. |
| `sonner-content-3` — Toast with Custom Duration | `docs/references/kibo/upstream/packages/patterns/sonner/content/sonner-content-3.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/content/sonner-content-3` | Default toast uses `duration: 10_000`. |
| `sonner-content-4` — Toast with Multi-line Content | `docs/references/kibo/upstream/packages/patterns/sonner/content/sonner-content-4.tsx` (1-22) | `https://www.kibo-ui.com/patterns/sonner/content/sonner-content-4` | Calls `toast.success` with a long fixed profile-update description. |
| `sonner-content-5` — Toast with Rich HTML Content | `docs/references/kibo/upstream/packages/patterns/sonner/content/sonner-content-5.tsx` (1-35) | `https://www.kibo-ui.com/patterns/sonner/content/sonner-content-5` | Passes JSX—not raw HTML—to `toast`: initials avatar, John Doe/New row, message, and fixed “2 minutes ago” time. |

## Interactive collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/content |
|---|---|---|---|
| `sonner-interactive-1` — Toast with Action Button | `docs/references/kibo/upstream/packages/patterns/sonner/interactive/sonner-interactive-1.tsx` (1-24) | `https://www.kibo-ui.com/patterns/sonner/interactive/sonner-interactive-1` | “Undo” action only issues `toast.success("Action clicked")`; it does not undo anything. |
| `sonner-interactive-2` — Toast with Cancel Button | `docs/references/kibo/upstream/packages/patterns/sonner/interactive/sonner-interactive-2.tsx` (1-24) | `https://www.kibo-ui.com/patterns/sonner/interactive/sonner-interactive-2` | “Cancel” only issues an informational follow-up toast. |
| `sonner-interactive-3` — Toast with Action and Cancel | `docs/references/kibo/upstream/packages/patterns/sonner/interactive/sonner-interactive-3.tsx` (1-28) | `https://www.kibo-ui.com/patterns/sonner/interactive/sonner-interactive-3` | “Delete” and “Cancel” each only produce a status toast; no deletion occurs. |
| `sonner-interactive-4` — Non-Dismissible Toast | `docs/references/kibo/upstream/packages/patterns/sonner/interactive/sonner-interactive-4.tsx` (1-22) | `https://www.kibo-ui.com/patterns/sonner/interactive/sonner-interactive-4` | Calls default toast with `dismissible: false` and `duration: 5000`; source does not demonstrate an alternate escape path. |

## Position collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/content |
|---|---|---|---|
| `sonner-position-1` — Top Left Position | `docs/references/kibo/upstream/packages/patterns/sonner/position/sonner-position-1.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/position/sonner-position-1` | Default toast passes `position: "top-left"`. |
| `sonner-position-2` — Top Center Position | `docs/references/kibo/upstream/packages/patterns/sonner/position/sonner-position-2.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/position/sonner-position-2` | Default toast passes `position: "top-center"`. |
| `sonner-position-3` — Top Right Position | `docs/references/kibo/upstream/packages/patterns/sonner/position/sonner-position-3.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/position/sonner-position-3` | Default toast passes `position: "top-right"`. |
| `sonner-position-4` — Bottom Left Position | `docs/references/kibo/upstream/packages/patterns/sonner/position/sonner-position-4.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/position/sonner-position-4` | Default toast passes `position: "bottom-left"`. |
| `sonner-position-5` — Bottom Center Position | `docs/references/kibo/upstream/packages/patterns/sonner/position/sonner-position-5.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/position/sonner-position-5` | Default toast passes `position: "bottom-center"`. |
| `sonner-position-6` — Bottom Right Position | `docs/references/kibo/upstream/packages/patterns/sonner/position/sonner-position-6.tsx` (1-21) | `https://www.kibo-ui.com/patterns/sonner/position/sonner-position-6` | Default toast passes `position: "bottom-right"`. |

## Promise collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/content |
|---|---|---|---|
| `sonner-promise-1` — Basic Promise Toast | `docs/references/kibo/upstream/packages/patterns/sonner/promise/sonner-promise-1.tsx` (1-28) | `https://www.kibo-ui.com/patterns/sonner/promise/sonner-promise-1` | Creates a fabricated Promise that resolves `{name: "User data"}` after 2 seconds; `toast.promise` has fixed loading/success/error text. |
| `sonner-promise-2` — Promise Toast with Data | `docs/references/kibo/upstream/packages/patterns/sonner/promise/sonner-promise-2.tsx` (1-28) | `https://www.kibo-ui.com/patterns/sonner/promise/sonner-promise-2` | Fabricated typed promise resolves `{name: "John Doe"}` after 2 seconds; success interpolates `data.name`. |
| `sonner-promise-3` — Promise Toast with Error | `docs/references/kibo/upstream/packages/patterns/sonner/promise/sonner-promise-3.tsx` (1-28) | `https://www.kibo-ui.com/patterns/sonner/promise/sonner-promise-3` | Fabricated promise rejects `Error("Network error")` after 2 seconds; error interpolates `err.message`. |
| `sonner-promise-4` — Loading Toast | `docs/references/kibo/upstream/packages/patterns/sonner/promise/sonner-promise-4.tsx` (1-20) | `https://www.kibo-ui.com/patterns/sonner/promise/sonner-promise-4` | Button calls only `toast.loading("Processing your request...")`; no completion, update, or dismiss call is shown. |

## Standard collection

| ID — title | Local source (lines) | Preview | Source-specific interaction/content |
|---|---|---|---|
| `sonner-standard-1` — Default Toast | `docs/references/kibo/upstream/packages/patterns/sonner/standard/sonner-standard-1.tsx` (1-14) | `https://www.kibo-ui.com/patterns/sonner/standard/sonner-standard-1` | Outline button calls default `toast` with “Event has been created.” |
| `sonner-standard-2` — Success Toast | `docs/references/kibo/upstream/packages/patterns/sonner/standard/sonner-standard-2.tsx` (1-17) | `https://www.kibo-ui.com/patterns/sonner/standard/sonner-standard-2` | Calls `toast.success` with fixed saved message. |
| `sonner-standard-3` — Error Toast | `docs/references/kibo/upstream/packages/patterns/sonner/standard/sonner-standard-3.tsx` (1-14) | `https://www.kibo-ui.com/patterns/sonner/standard/sonner-standard-3` | Calls `toast.error` with fixed failure message. |
| `sonner-standard-4` — Warning Toast | `docs/references/kibo/upstream/packages/patterns/sonner/standard/sonner-standard-4.tsx` (1-17) | `https://www.kibo-ui.com/patterns/sonner/standard/sonner-standard-4` | Calls `toast.warning` with fixed session-expiry message. |
| `sonner-standard-5` — Info Toast | `docs/references/kibo/upstream/packages/patterns/sonner/standard/sonner-standard-5.tsx` (1-17) | `https://www.kibo-ui.com/patterns/sonner/standard/sonner-standard-5` | Calls `toast.info` with fixed update message. |

## Coverage and missing inputs

- **Accounted for:** every indexed source in the assigned families: Skeleton **30** (card/content/form/list/profile/table, 5 each); Slider **29** (interactive 5, range 5, settings 4, standard 5, styled 5, vertical 5); Sonner **24** (content 5, interactive 4, position 6, promise 4, standard 5)—**83 patterns total**. The catalog inventory is at `docs/references/kibo/catalog/patterns/skeleton.md` (lines 1-35), `slider.md` (lines 1-34), and `sonner.md` (lines 1-29).
- **Inputs not present in this snapshot review:** application loading/data/error policies; target component aliases/configuration and installed dependency versions; persistence/API contracts; product copy/localization; responsive requirements; screen-reader, keyboard, reduced-motion, contrast, touch, and browser verification. No missing assigned source files were found in the catalog or the named pattern directories.
