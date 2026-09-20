# Patterns: calendar, card, carousel

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

Read-only source analysis of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in `docs/references/kibo/metadata/manifest.json` (lines 1-18). This covers only `calendar`, `card`, and `carousel`.

Catalog metadata identifies 53 families / 209 collections overall; this assignment contains calendar’s `dialog` and `standard` collections, and card/carousel’s `standard` collections: `docs/references/kibo/catalog/summary.json` (lines 1-10), family indexes below. Source was read locally; no dependency installation, execution, browser preview, or accessibility/browser validation was performed.

## Files Retrieved

1. `docs/references/kibo/catalog/patterns/calendar.md` (lines 1-22) — complete calendar ID/title/source/preview inventory.
2. `docs/references/kibo/catalog/patterns/card.md` (lines 1-10) — complete card inventory.
3. `docs/references/kibo/catalog/patterns/carousel.md` (lines 1-10) — complete carousel inventory.
4. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/calendar.tsx` (lines 1-213) — Calendar wrapper behavior and `react-day-picker` integration.
5. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/card.tsx` (lines 1-92) — Card layout primitives.
6. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/carousel.tsx` (lines 1-241) — Embla integration, keyboard handling, and previous/next controls.
7. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/dialog.tsx` (lines 1-143) and `scroll-area.tsx` (lines 1-58) — dialog and scrolling wrappers used by calendar dialog variants.
8. `docs/references/kibo/upstream/packages/shadcn-ui/package.json` (lines 1-33) — pinned primitive dependency declarations.

## Inventory and source notes

### Calendar

All calendar examples are client components with local React selection state and import `Calendar` from `@/components/ui/calendar`. The mirrored primitive wraps `DayPicker`, supplies custom day buttons and focus-on-day-picker-focus behavior, and permits forwarded `DayPicker` props/components (`packages/shadcn-ui/components/ui/calendar.tsx`, lines 14-158, 161-211). The source package declares `react-day-picker` `9.11.1`, Radix, Lucide, and React dependencies (`packages/shadcn-ui/package.json`, lines 4-26).

#### Collection: `dialog`

| ID / title | Local source / preview | Actual composition and interaction |
|---|---|---|
| `calendar-dialog-1` — Calendar with Range in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-1.tsx` (lines 1-58); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-1) | Outline trigger opens a titled dialog containing a bordered two-month `mode="range"` calendar. Local `DateRange` starts from Faker-generated dates. |
| `calendar-dialog-2` — Calendar with Month and Year Selector in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-2.tsx` (lines 1-97); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-2) | Replaces DayPicker dropdowns with `Select` controls via `components.Dropdown`; hides normal navigation and controls both selected date and displayed month locally. It adapts a selected value into a synthetic `ChangeEvent` before calling the supplied calendar handler. |
| `calendar-dialog-3` — Calendar as Appointment Picker in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-3.tsx` (lines 1-78); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-3) | Split bordered layout: a single-date calendar beside a fixed-width, scrollable list of fourteen time buttons. Clicking a time only changes its local button variant. |
| `calendar-dialog-4` — Calendar with Date and Time in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-4.tsx` (lines 1-62); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-4) | Single-date calendar stacked above a labelled native `type="time"` input. Time changes clone the currently selected date and set hours/minutes. |
| `calendar-dialog-5` — Calendar with Natural Language in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-5.tsx` (lines 1-82); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-5) | Same split/scroll composition as appointment picker, but the right column offers six relative-date shortcut buttons that directly set local date state. |
| `calendar-dialog-6` — Calendar with Disabled Dates in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-6.tsx` (lines 1-63); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-6) | Single-date calendar disables a Faker-generated four-day range, weekends, and one generated date. |
| `calendar-dialog-7` — Calendar with Multiple Day Selection in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-7.tsx` (lines 1-59); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-7) | A `mode="multiple"` calendar with three initial Faker-generated dates. |
| `calendar-dialog-8` — Calendar with Custom Select Day Style in Dialog | `packages/patterns/calendar/dialog/calendar-dialog-8.tsx` (lines 1-78); [preview](https://www.kibo-ui.com/patterns/calendar/dialog/calendar-dialog-8) | Single-date calendar marks three generated `booked` dates with inline amber/brown/bold modifier styles and makes day/today/day-button shapes circular. |

Every dialog variant imports `Button` plus `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, and `DialogTitle`; variants 2–5 add the primitives apparent in their corresponding source. Dialog uses Radix Root/Trigger/Portal/Content and includes an icon-only close control with sr-only “Close” text (`packages/shadcn-ui/components/ui/dialog.tsx`, lines 8-61, 120-143).

#### Collection: `standard`

| ID / title | Local source / preview | Actual composition and interaction |
|---|---|---|
| `calendar-standard-1` — Calendar with Range | `packages/patterns/calendar/standard/calendar-standard-1.tsx` (lines 1-40); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-1) | Bordered, two-month range calendar with local `DateRange` state. |
| `calendar-standard-2` — Calendar with Month and Year Selector | `packages/patterns/calendar/standard/calendar-standard-2.tsx` (lines 1-77); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-2) | Calendar’s dropdown caption is replaced by controlled `Select` month/year controls; normal navigation hidden. |
| `calendar-standard-3` — Calendar as Appointment Picker | `packages/patterns/calendar/standard/calendar-standard-3.tsx` (lines 1-59); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-3) | Calendar plus fixed-width scrollable time-list panel; selected time changes button styling only. |
| `calendar-standard-4` — Calendar with Date and Time | `packages/patterns/calendar/standard/calendar-standard-4.tsx` (lines 1-44); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-4) | Calendar and labelled native time field share local date/time state; time handler updates date hours/minutes. |
| `calendar-standard-5` — Calendar with Natural Language | `packages/patterns/calendar/standard/calendar-standard-5.tsx` (lines 1-65); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-5) | Calendar plus scrollable “Quick Select” relative-date shortcuts. |
| `calendar-standard-6` — Calendar with Disabled Dates | `packages/patterns/calendar/standard/calendar-standard-6.tsx` (lines 1-45); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-6) | Single calendar with generated disabled range/weekends/date. |
| `calendar-standard-7` — Calendar with Multiple Day Selection | `packages/patterns/calendar/standard/calendar-standard-7.tsx` (lines 1-41); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-7) | Multiple selection seeded with three generated dates. |
| `calendar-standard-8` — Calendar with Custom Select Day Style | `packages/patterns/calendar/standard/calendar-standard-8.tsx` (lines 1-60); [preview](https://www.kibo-ui.com/patterns/calendar/standard/calendar-standard-8) | `booked` modifiers use direct inline styles and circular day class overrides. |

**Demo-only data/dependencies and adaptation boundary.** Faker supplies the initial ranges, disabled/booked dates, and is not application data in variants 1 and 6–8 of each collection. Variant 1 also uses the `DateRange` type from `react-day-picker`. Appointment times and relative shortcuts are hard-coded demo arrays. Preserve the controlled Calendar mode/selection composition, but replace those values with domain availability, constraints, locale, timezone, validation, and persistence. The examples have no submit/confirm callback, booking conflict check, loading/error state, or dialog close-on-success behavior. The appointment picker also does not connect date and available-time data or announce selection beyond visual variant changes.

**Accessibility cautions from source reading.** Date-and-time examples correctly associate `Label htmlFor="time"` and `Input id="time"` (`calendar-standard-4.tsx`, lines 28-40; dialog equivalent lines 46-58). The dialog examples provide a `DialogTitle` but no `DialogDescription`; whether a description is appropriate should be decided and runtime-tested. Custom dropdown forwarding in variant 2 is coupled to the current DayPicker callback shape; retain/test it only against the adopted primitive version. No browser, assistive-technology, or keyboard validation was performed.

### Card

The Card primitive is visual/layout composition built from `div` elements: `CardTitle` is also a `div`, rather than a heading (`packages/shadcn-ui/components/ui/card.tsx`, lines 5-92). Its default card/header/content/footer spacing is part of the demonstrated composition.

#### Collection: `standard`

| ID / title | Local source / preview | Actual composition and interaction |
|---|---|---|
| `card-standard-1` — Standard Card | `packages/patterns/card/standard/card-standard-1.tsx` (lines 1-29); [preview](https://www.kibo-ui.com/patterns/card/standard/card-standard-1) | Fixed 350px card with title/description, text content, and footer-aligned Cancel/Submit buttons. Neither button has an action. |
| `card-standard-2` — Login Card | `packages/patterns/card/standard/card-standard-2.tsx` (lines 1-72); [preview](https://www.kibo-ui.com/patterns/card/standard/card-standard-2) | Responsive max-width card with controlled email/password inputs, associated labels, two buttons, and placeholder `#` forgot-password/sign-up links. It has no `<form>` or submit/auth logic. |
| `card-standard-3` — Meeting Notes Card | `packages/patterns/card/standard/card-standard-3.tsx` (lines 1-57); [preview](https://www.kibo-ui.com/patterns/card/standard/card-standard-3) | Wide notes card with fixed sample transcript/list and an overlapping avatar group. Faker creates three attendee names/avatar URLs; avatar fallback derives initials. |
| `card-standard-4` — Image Card | `packages/patterns/card/standard/card-standard-4.tsx` (lines 1-56); [preview](https://www.kibo-ui.com/patterns/card/standard/card-standard-4) | Property card with static Unsplash image, pill-style Bed/Bath/area icon values, and Faker-generated price/metrics. The source intentionally gives the image `alt=""`. |

**Required imports.** All variants use `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter`; variant 1 adds `Button`; variant 2 adds React state, `Input`, and `Label`; variant 3 adds Faker and Avatar primitives; variant 4 adds Faker and Lucide `Bath`, `Bed`, and `Maximize`.

**Adaptation boundary and caveats.** Replace all sample copy, Faker people/property values, remote avatar/image URLs, and `#` links with application data/routes. Add a real form, submission, auth-provider action, validation, disabled/loading/error behavior, and password/security handling before using the login composition. Retain the layout primitives if desired, but supply a meaningful heading in the application’s document hierarchy because the supplied `CardTitle` has no heading semantics. For an informative property image, replace the empty alt text with a domain-appropriate alternative; if decorative, retain empty alt intentionally. No interaction or accessibility behavior was browser-validated.

### Carousel

The shared Carousel primitive uses `embla-carousel-react`, forwards `opts`, `plugins`, orientation, and `setApi`, exposes previous/next state through context, and adds left/right-arrow key handling on its wrapper (`packages/shadcn-ui/components/ui/carousel.tsx`, lines 3-39, 49-132). It renders a region with `aria-roledescription="carousel"` and each item as a slide group; prior/next controls have sr-only labels and disable when unavailable (lines 134-239). `embla-carousel-react` is declared at `^8.6.0` (`packages/shadcn-ui/package.json`, lines 4-26).

#### Collection: `standard`

| ID / title | Local source / preview | Actual composition and interaction |
|---|---|---|
| `carousel-standard-1` — Standard Carousel | `packages/patterns/carousel/standard/carousel-standard-1.tsx` (lines 1-35); [preview](https://www.kibo-ui.com/patterns/carousel/standard/carousel-standard-1) | Five generated slide IDs in a 16:9 bordered panel, with shared previous/next controls outside the content. Each generated `image` URL is not rendered. |
| `carousel-standard-2` — Carousel with Thumbnails | `packages/patterns/carousel/standard/carousel-standard-2.tsx` (lines 1-65); [preview](https://www.kibo-ui.com/patterns/carousel/standard/carousel-standard-2) | Five 2:1 numbered slides and a row of numbered `Button` controls. `setApi` stores the Embla API, follows its `select` event to update the active button variant, and each button calls `api.scrollTo(index)`. Generated `image` URLs are not rendered. |
| `carousel-standard-3` — Product Showcase Carousel | `packages/patterns/carousel/standard/carousel-standard-3.tsx` (lines 1-80); [preview](https://www.kibo-ui.com/patterns/carousel/standard/carousel-standard-3) | Five generated product cards: a fixed `placehold.co` image, optional badge, rounded-down five-star display, rating/reviews/price, Add to Cart button, and previous/next controls. |
| `carousel-standard-4` — Hero Carousel | `packages/patterns/carousel/standard/carousel-standard-4.tsx` (lines 1-50); [preview](https://www.kibo-ui.com/patterns/carousel/standard/carousel-standard-4) | Three generated content-only 16:9 hero slides with muted background, black gradient overlay, centered white title/description/CTA, and controls positioned inside left/right edges. |

**Demo-only data/dependencies and adaptation boundary.** Faker generates every slide/product field and IDs. Standard variants 1 and 2 additionally generate unused Picsum URLs; do not retain that dependency/data unless real images are intentionally added. Variant 3 uses a fixed external placeholder image and fake commerce/review data; variant 4 uses fake copy/CTAs. There is no autoplay, fetched data, navigation route, cart behavior, analytics, loading/error/empty state, or responsive content policy in the example sources. Preserve the shared Carousel/Content/Item structure and use its API only where needed; replace mock data and wire actions to application behavior.

**Accessibility cautions from source reading.** Previous/next buttons are text-labelled for screen readers in the primitive, but the thumbnail buttons expose only numeric labels (`carousel-standard-2.tsx`, lines 48-59). The primitive’s arrow-key listener is on a `div` without a `tabIndex` in its own source, and the examples add no live announcement/current-slide text. Assess focus order, keyboard reachability, labels, slide-change announcement, image alternatives, reduced-motion/autoplay policy, and touch behavior in the consuming application. Variant 2 registers an additional `newApi.on("select", ...)` listener without cleanup in the example (`carousel-standard-2.tsx`, lines 22-34); verify lifecycle behavior if retaining that API wiring. No browser or assistive-technology validation was performed.

## Architecture

Patterns are standalone TSX demos using app-alias imports such as `@/components/ui/calendar`; their matching reference primitive implementations instead import through `@repo/shadcn-ui/...`. Adapt imports to the host application rather than copying the alias scheme blindly. Calendar behavior is delegated to `react-day-picker`; dialogs and scrolling are Radix wrappers; carousels are Embla-backed; cards provide styling/layout only. Pattern-level React state demonstrates presentation and selection, not production data flow.

## Start Here

Open `docs/references/kibo/catalog/patterns/calendar.md` first: it is the complete source/preview inventory for the largest assigned family. Then open the selected exact pattern source and its underlying primitive before adapting.

## Coverage / missing inputs

- Covered: **24/24 assigned patterns** — calendar dialog **8/8**, calendar standard **8/8**, card standard **4/4**, carousel standard **4/4**.
- Every assigned collection and catalog preview path is listed above.
- Missing inputs: product-specific calendar rules/timezone/availability and submit flows; card content/auth/routing/image policy; carousel data, destinations, image assets, playback, and announcement policy.
- This is source-reading evidence from the pinned local snapshot only; preview URLs are catalog metadata, not browser-validated results.
