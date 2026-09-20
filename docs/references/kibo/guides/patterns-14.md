# Patterns: scroll-area, separator, sheet

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

This is a source-reading-only inventory of the pinned local Kibo mirror at upstream revision [`3d63cdb15b79d972e3dc38a10997987672f9b263`](../metadata/manifest.json). It covers exactly the three assigned families and all 55 files catalogued under their `packages/patterns/<family>/` trees: 8 scroll-area, 18 separator, and 29 sheet patterns. The catalog is the inventory/preview evidence ([scroll-area](../catalog/patterns/scroll-area.md), [separator](../catalog/patterns/separator.md), [sheet](../catalog/patterns/sheet.md)); the implementation notes below come from the individual TSX sources. Preview links are catalog URLs only: no browser, runtime, visual, keyboard, or assistive-technology validation was performed.

The `@/components/ui/*` paths in examples are reference-app aliases, not imports from this repository. The mirrored base implementations are useful adaptation references, but their Radix dependency behavior was not executed or independently inspected.

## Shared primitive findings

| Family | Required base primitive and source-read result | Adaptation boundary |
|---|---|---|
| Scroll area | [`ScrollArea` / `ScrollBar`](../upstream/packages/shadcn-ui/components/ui/scroll-area.tsx#L1-L58) wrap Radix `ScrollArea.Root`, `Viewport`, scrollbar and corner; the wrapper creates a vertical `ScrollBar` by default and gives its viewport focus-visible ring styles. Horizontal overflow must opt into `<ScrollBar orientation="horizontal" />`; the “both” example explicitly renders both. | Keep a bounded height/width and the required scrollbar orientation. Content arrays, loading, selection, synchronization and remote images are examples, not component behavior. The source provides focus styling, but no browser accessibility conclusion follows. |
| Separator | [`Separator`](../upstream/packages/shadcn-ui/components/ui/separator.tsx#L1-L28) wraps Radix Separator, defaults to `orientation="horizontal"` and `decorative={true}`, and maps horizontal/vertical sizing through data attributes. | Use `decorative={false}` only when the divider conveys structure/meaning and supply appropriate semantic context. Spacing, gradient and double lines in the examples are plain composition/CSS—not a richer separator API. |
| Sheet | [`Sheet` family](../upstream/packages/shadcn-ui/components/ui/sheet.tsx#L1-L139) wraps Radix `Dialog`: root/trigger/close/portal, overlay, content, header/footer/title/description. Content defaults to right; supports top/right/bottom/left, portals an overlay, animates by state, and includes a positioned close control with visually-hidden “Close” text. | Preserve the title/description and explicit side/content structure when adapting. The wrapper delegates dialog semantics, focus management and dismissal details to an unexecuted external primitive; source reading is not validation. Wire each business action, state, API operation, error/loading result and post-action close deliberately. |

## Scroll-area

All sources import `ScrollArea` from `@/components/ui/scroll-area`; rows marked **HS** also import `ScrollBar`. The two client-state layouts are explicitly marked. `Array.from`, literal records, placeholder artwork, and GitHub avatar URLs are demo data.

### Advanced

| ID / title | Local source / preview | Actual composition and interaction choice |
|---|---|---|
| `scroll-area-advanced-1` — Both Orientations | [`source`](../upstream/packages/patterns/scroll-area/advanced/scroll-area-advanced-1.tsx#L1-L54) · [preview](https://www.kibo-ui.com/patterns/scroll-area/advanced/scroll-area-advanced-1) | 400px, max-md bordered viewport with a `w-max` six-column table and 20 generated rows; **HS** adds both horizontal and vertical bars. Role/department/status are modulus-derived sample text, not table data logic. |
| `scroll-area-advanced-2` — Dynamic Content | [`source`](../upstream/packages/patterns/scroll-area/advanced/scroll-area-advanced-2.tsx#L1-L54) · [preview](https://www.kibo-ui.com/patterns/scroll-area/advanced/scroll-area-advanced-2) | **Client state; Button dependency.** Starts with 10 literal-shaped items; “Load More” appends five generated records and the count reflects `items.length`. It has no request, pagination cursor, loading/disabled/error state, or deduplication. |
| `scroll-area-advanced-3` — With ResizableHandle | [`source`](../upstream/packages/patterns/scroll-area/advanced/scroll-area-advanced-3.tsx#L1-L89) · [preview](https://www.kibo-ui.com/patterns/scroll-area/advanced/scroll-area-advanced-3) | **ResizablePanelGroup/Panel/Handle dependency.** Two 50% (30% min) panes share a 400px height; each has its own flex-fill scroll area. The 30 file buttons and prose preview are static: no selected-file state or handler. |

### Layout

| ID / title | Local source / preview | Actual composition and interaction choice |
|---|---|---|
| `scroll-area-layout-1` — Fixed Height ScrollArea | [`source`](../upstream/packages/patterns/scroll-area/layout/scroll-area-layout-1.tsx#L1-L37) · [preview](https://www.kibo-ui.com/patterns/scroll-area/layout/scroll-area-layout-1) | Notifications heading plus 200px bordered list with ten generated numbered, timestamped notification rows; all content is static. |
| `scroll-area-layout-2` — Scrollable Tags | [`source`](../upstream/packages/patterns/scroll-area/layout/scroll-area-layout-2.tsx#L1-L45) · [preview](https://www.kibo-ui.com/patterns/scroll-area/layout/scroll-area-layout-2) | **Badge + HS dependencies.** A `whitespace-nowrap` viewport holds a `w-max` flex row of 20 literal technology tags and one horizontal bar. No selection/filter behavior is implemented. |
| `scroll-area-layout-3` — Chat Messages | [`source`](../upstream/packages/patterns/scroll-area/layout/scroll-area-layout-3.tsx#L1-L99) · [preview](https://www.kibo-ui.com/patterns/scroll-area/layout/scroll-area-layout-3) | **Avatar/AvatarImage/AvatarFallback dependency.** 400px message feed maps eight hard-coded messages to avatar/name/time/text rows. Avatar sources are external `github.com` URLs; there is no live feed, ordering logic, send UI, unread behavior, or image policy/error handling. |

### Standard

| ID / title | Local source / preview | Actual composition and interaction choice |
|---|---|---|
| `scroll-area-standard-1` — Basic ScrollArea | [`source`](../upstream/packages/patterns/scroll-area/standard/scroll-area-standard-1.tsx#L1-L52) · [preview](https://www.kibo-ui.com/patterns/scroll-area/standard/scroll-area-standard-1) | A 72-unit-high, max-md bordered terms-of-service text viewport. Its legal prose is demonstration content and must not be adopted as policy. |
| `scroll-area-standard-2` — Horizontal ScrollArea | [`source`](../upstream/packages/patterns/scroll-area/standard/scroll-area-standard-2.tsx#L1-L56) · [preview](https://www.kibo-ui.com/patterns/scroll-area/standard/scroll-area-standard-2) | **HS dependency.** A `w-max` figure strip maps five literal artworks; each uses a raw `<img>` with descriptive artist alt and external `placehold.co` source. Supply approved assets/image handling and real records when adapting. |

**Scroll-area cautions.** These examples do not announce appended content, manage focus/scroll position after “Load More”, or provide virtualisation for large data. The file-list buttons are native buttons but have no action; only the raw `<img>` example includes explicit alt text. These are source observations, not accessibility test results.

## Separator

Except `separator-styled-4`, every row imports `Separator` from `@/components/ui/separator`; there are no other component dependencies or stateful interactions. All text and `href="#"` navigation are demo-only.

### Basic

| ID / title | Local source / preview | Actual composition |
|---|---|---|
| `separator-basic-1` — Horizontal Separator | [`source`](../upstream/packages/patterns/separator/basic/separator-basic-1.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/basic/separator-basic-1) | Default horizontal rule between “Above” and “Below.” |
| `separator-basic-2` — Vertical Separator | [`source`](../upstream/packages/patterns/separator/basic/separator-basic-2.tsx#L1-L15) · [preview](https://www.kibo-ui.com/patterns/separator/basic/separator-basic-2) | Two vertical rules in an `h-20` horizontal three-label row. |
| `separator-basic-3` — In Navigation | [`source`](../upstream/packages/patterns/separator/basic/separator-basic-3.tsx#L1-L21) · [preview](https://www.kibo-ui.com/patterns/separator/basic/separator-basic-3) | `h-4`, vertical separators between three `href="#"` anchors; replace placeholder destinations. |
| `separator-basic-4` — Section Divider | [`source`](../upstream/packages/patterns/separator/basic/separator-basic-4.tsx#L1-L19) · [preview](https://www.kibo-ui.com/patterns/separator/basic/separator-basic-4) | Default rule separates two heading/description blocks. |
| `separator-basic-5` — Simple Line | [`source`](../upstream/packages/patterns/separator/basic/separator-basic-5.tsx#L1-L7) · [preview](https://www.kibo-ui.com/patterns/separator/basic/separator-basic-5) | Bare primitive only. |

### Spacing

| ID / title | Local source / preview | Actual composition |
|---|---|---|
| `separator-spacing-1` — Tight Spacing | [`source`](../upstream/packages/patterns/separator/spacing/separator-spacing-1.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/spacing/separator-spacing-1) | Parent vertical gap `space-y-1`. |
| `separator-spacing-2` — Default Spacing | [`source`](../upstream/packages/patterns/separator/spacing/separator-spacing-2.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/spacing/separator-spacing-2) | Parent vertical gap `space-y-4`. |
| `separator-spacing-3` — Wide Spacing | [`source`](../upstream/packages/patterns/separator/spacing/separator-spacing-3.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/spacing/separator-spacing-3) | Parent vertical gap `space-y-8`. |
| `separator-spacing-4` — With Margins | [`source`](../upstream/packages/patterns/separator/spacing/separator-spacing-4.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/spacing/separator-spacing-4) | Rule itself gets `my-6`; surrounding parent has no `space-y`. |
| `separator-spacing-5` — Inset Separator | [`source`](../upstream/packages/patterns/separator/spacing/separator-spacing-5.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/spacing/separator-spacing-5) | Parent `space-y-4`; rule gets `mx-8`, reducing its width. |

### Styled

| ID / title | Local source / preview | Actual composition |
|---|---|---|
| `separator-styled-1` — Thick Separator | [`source`](../upstream/packages/patterns/separator/styled/separator-styled-1.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/styled/separator-styled-1) | Default primitive overridden to `h-1`. |
| `separator-styled-2` — Dashed Separator | [`source`](../upstream/packages/patterns/separator/styled/separator-styled-2.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/styled/separator-styled-2) | Transparent background plus dashed top border. |
| `separator-styled-3` — Dotted Separator | [`source`](../upstream/packages/patterns/separator/styled/separator-styled-3.tsx#L1-L13) · [preview](https://www.kibo-ui.com/patterns/separator/styled/separator-styled-3) | Transparent background plus dotted top border. |
| `separator-styled-4` — Gradient Separator | [`source`](../upstream/packages/patterns/separator/styled/separator-styled-4.tsx#L1-L11) · [preview](https://www.kibo-ui.com/patterns/separator/styled/separator-styled-4) | Does **not** use the primitive: a plain `h-px w-full` div applies a transparent→border→transparent gradient. |
| `separator-styled-5` — Double Line | [`source`](../upstream/packages/patterns/separator/styled/separator-styled-5.tsx#L1-L16) · [preview](https://www.kibo-ui.com/patterns/separator/styled/separator-styled-5) | Two default separators stacked with `space-y-1`. |

### With text

| ID / title | Local source / preview | Actual composition |
|---|---|---|
| `separator-with-text-1` — With Text Center | [`source`](../upstream/packages/patterns/separator/with-text/separator-with-text-1.tsx#L1-L17) · [preview](https://www.kibo-ui.com/patterns/separator/with-text/separator-with-text-1) | Max-sm flex row: flexing separators on both sides of a padded uppercase “OR” span. |
| `separator-with-text-2` — With Text Left | [`source`](../upstream/packages/patterns/separator/with-text/separator-with-text-2.tsx#L1-L16) · [preview](https://www.kibo-ui.com/patterns/separator/with-text/separator-with-text-2) | Literal “Continue with” span followed by one flexing separator. |
| `separator-with-text-3` — With Text Right | [`source`](../upstream/packages/patterns/separator/with-text/separator-with-text-3.tsx#L1-L14) · [preview](https://www.kibo-ui.com/patterns/separator/with-text/separator-with-text-3) | One flexing separator before literal “More” span. |

**Separator cautions.** The primitive’s decorative default means these visual patterns do not automatically communicate grouping to assistive technology. In particular, the gradient div has no primitive semantics at all. Decide separator semantics per use case rather than treating these arrangements as validated accessible content boundaries.

## Sheet

Every sheet source imports `Sheet`, `SheetContent`, and `SheetTrigger` from `@/components/ui/sheet`; all 29 also use `SheetHeader`/`SheetTitle`; the navigation patterns generally omit `SheetDescription`, and rows explicitly identify additions. Buttons merely open the sheet via the primitive trigger unless an `onClick` is visible—none of the demo business-action buttons has one.

### Details

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `sheet-details-1` — Product Details Sheet | [`source`](../upstream/packages/patterns/sheet/details/sheet-details-1.tsx#L1-L51) · [preview](https://www.kibo-ui.com/patterns/sheet/details/sheet-details-1) | **Badge, Button, header/description.** Right-side product detail with external placeholder image, static stock/price/features and inert “Add to Cart”; replace data/assets and implement cart operation/result. |
| `sheet-details-2` — User Profile View Sheet | [`source`](../upstream/packages/patterns/sheet/details/sheet-details-2.tsx#L1-L56) · [preview](https://www.kibo-ui.com/patterns/sheet/details/sheet-details-2) | **Avatar, Button, header/description.** Static initials avatar, profile key/value rows and inert “Send Message”; requires actual identity, authorization and messaging flow. |
| `sheet-details-3` — Order Details Sheet | [`source`](../upstream/packages/patterns/sheet/details/sheet-details-3.tsx#L1-L65) · [preview](https://www.kibo-ui.com/patterns/sheet/details/sheet-details-3) | **Badge, Button, Separator, header/description.** Static order status, item/cost sections split by rules, inert tracking button; needs order data/currency/permissions and tracking navigation. |
| `sheet-details-4` — Article Preview Sheet | [`source`](../upstream/packages/patterns/sheet/details/sheet-details-4.tsx#L1-L45) · [preview](https://www.kibo-ui.com/patterns/sheet/details/sheet-details-4) | **Button, header/description.** Static byline/read-time/excerpt with inert “Read Full Article”; provide article routing/content. |
| `sheet-details-5` — Notification List Sheet | [`source`](../upstream/packages/patterns/sheet/details/sheet-details-5.tsx#L1-L114) · [preview](https://www.kibo-ui.com/patterns/sheet/details/sheet-details-5) | **Badge, Button, header/description.** Maps four local notifications; unread styling/dot and header badge/count derive from fixed data. “Mark All as Read” does not mutate state; needs fetch, update, failure and live-count handling. |

### Form

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `sheet-form-1` — Contact Form Sheet | [`source`](../upstream/packages/patterns/sheet/form/sheet-form-1.tsx#L1-L46) · [preview](https://www.kibo-ui.com/patterns/sheet/form/sheet-form-1) | **Button, Input, Label, header/description.** Three labelled inputs (message is an `Input`, not textarea) and inert send button; no `<form>`, values, validation, submit, status or close flow. |
| `sheet-form-2` — User Profile Edit Sheet | [`source`](../upstream/packages/patterns/sheet/form/sheet-form-2.tsx#L1-L45) · [preview](https://www.kibo-ui.com/patterns/sheet/form/sheet-form-2) | **Button, Input, Label, SheetFooter, header/description.** Uncontrolled default username/full-name inputs and inert save; load/save/cancel validation is absent. |
| `sheet-form-3` — Search and Filter Sheet | [`source`](../upstream/packages/patterns/sheet/form/sheet-form-3.tsx#L1-L60) · [preview](https://www.kibo-ui.com/patterns/sheet/form/sheet-form-3) | **Button, Checkbox, Input, Label, header/description.** Search plus three label-associated category checks and inert apply; no filter state/query integration/reset. |
| `sheet-form-4` — Create New Item Sheet | [`source`](../upstream/packages/patterns/sheet/form/sheet-form-4.tsx#L1-L50) · [preview](https://www.kibo-ui.com/patterns/sheet/form/sheet-form-4) | **Button, Input, Label, SheetFooter, header/description.** Name/description/number inputs with two inert footer buttons; no form semantics, cancellation or creation workflow. |
| `sheet-form-5` — Multi-Step Form Sheet | [`source`](../upstream/packages/patterns/sheet/form/sheet-form-5.tsx#L1-L50) · [preview](https://www.kibo-ui.com/patterns/sheet/form/sheet-form-5) | **Button, Input, Label, SheetFooter, header/description.** Renders only stated “Step 1 of 3” and phone/name inputs; Back/Next do not implement steps, persistence or validation. |

### Multi-section

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `sheet-multi-section-1` — Sheet with Header, Content, and Footer | [`source`](../upstream/packages/patterns/sheet/multi-section/sheet-multi-section-1.tsx#L1-L42) · [preview](https://www.kibo-ui.com/patterns/sheet/multi-section/sheet-multi-section-1) | **Button, SheetFooter, header/description.** Flex-1 prose main area between header/footer, two inert actions. |
| `sheet-multi-section-2` — Sheet with Tabs | [`source`](../upstream/packages/patterns/sheet/multi-section/sheet-multi-section-2.tsx#L1-L79) · [preview](https://www.kibo-ui.com/patterns/sheet/multi-section/sheet-multi-section-2) | **Client state; Button, header/description.** Three literal tab records and `activeTab` state change displayed copy/style. It uses plain buttons, not a Tabs primitive: no tab roles, `aria-selected`, panel association, arrow-key model, or `type="button"`; add those or use an appropriate tab primitive. |
| `sheet-multi-section-3` — Sheet with Scrollable Content | [`source`](../upstream/packages/patterns/sheet/multi-section/sheet-multi-section-3.tsx#L1-L42) · [preview](https://www.kibo-ui.com/patterns/sheet/multi-section/sheet-multi-section-3) | **Button, header/description.** `flex-1 overflow-y-auto` body maps 20 cursor-pointer item divs. They are not keyboard-operable and have no click action/selection; supply a real interactive element and data loading. |
| `sheet-multi-section-4` — Sheet with Action Buttons in Footer | [`source`](../upstream/packages/patterns/sheet/multi-section/sheet-multi-section-4.tsx#L1-L50) · [preview](https://www.kibo-ui.com/patterns/sheet/multi-section/sheet-multi-section-4) | **Button, Input, Label, SheetFooter, header/description.** Task name/assignee/date inputs plus inert draft/create footer actions; no select, validation or persistence. |
| `sheet-multi-section-5` — Sheet with Sticky Header and Footer | [`source`](../upstream/packages/patterns/sheet/multi-section/sheet-multi-section-5.tsx#L1-L66) · [preview](https://www.kibo-ui.com/patterns/sheet/multi-section/sheet-multi-section-5) | **Button, Separator, SheetFooter, header/description.** `SheetContent` becomes flex column; separators bracket a `flex-1 overflow-y-auto` static product body, with inert cart/wishlist actions. “Sticky” is achieved by flex layout, not CSS `position: sticky`. |

### Navigation

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `sheet-navigation-1` — Mobile Menu Sheet | [`source`](../upstream/packages/patterns/sheet/navigation/sheet-navigation-1.tsx#L1-L39) · [preview](https://www.kibo-ui.com/patterns/sheet/navigation/sheet-navigation-1) | **Button.** `side="left"`, title and four placeholder anchor links. Replace `#` routes and determine close-on-navigation behavior. |
| `sheet-navigation-2` — Sidebar Navigation Sheet | [`source`](../upstream/packages/patterns/sheet/navigation/sheet-navigation-2.tsx#L1-L57) · [preview](https://www.kibo-ui.com/patterns/sheet/navigation/sheet-navigation-2) | **Button.** Left sheet groups static Dashboard/Settings headings and indented placeholder links; no active-route state. |
| `sheet-navigation-3` — Nested Navigation Menu Sheet | [`source`](../upstream/packages/patterns/sheet/navigation/sheet-navigation-3.tsx#L1-L73) · [preview](https://www.kibo-ui.com/patterns/sheet/navigation/sheet-navigation-3) | **Button.** Left sheet visually nests literal Products/Resources links by indentation; sections do not expand/collapse. |
| `sheet-navigation-4` — Navigation with User Profile Sheet | [`source`](../upstream/packages/patterns/sheet/navigation/sheet-navigation-4.tsx#L1-L55) · [preview](https://www.kibo-ui.com/patterns/sheet/navigation/sheet-navigation-4) | **Avatar, Button.** Left sheet adds hard-coded JD user summary before four placeholder links including Sign Out; needs authenticated data and real sign-out semantics. |
| `sheet-navigation-5` — Navigation with Search Sheet | [`source`](../upstream/packages/patterns/sheet/navigation/sheet-navigation-5.tsx#L1-L46) · [preview](https://www.kibo-ui.com/patterns/sheet/navigation/sheet-navigation-5) | **Button, Input.** Left sheet displays a search input above five static placeholder links; input is not connected to filtering. |

### Settings

| ID / title | Local source / preview | Actual composition, dependencies, and missing behavior |
|---|---|---|
| `sheet-settings-1` — App Preferences Sheet | [`source`](../upstream/packages/patterns/sheet/settings/sheet-settings-1.tsx#L1-L47) · [preview](https://www.kibo-ui.com/patterns/sheet/settings/sheet-settings-1) | **Button, Checkbox, Label, header/description.** Four labelled preference checks (only Auto Update defaults checked); no persistence/default loading. |
| `sheet-settings-2` — Account Settings Sheet | [`source`](../upstream/packages/patterns/sheet/settings/sheet-settings-2.tsx#L1-L47) · [preview](https://www.kibo-ui.com/patterns/sheet/settings/sheet-settings-2) | **Button, Input, Label, SheetFooter, header/description.** Uncontrolled sample email and password fields, inert save; requires secure auth/update/validation feedback. |
| `sheet-settings-3` — Notification Preferences Sheet | [`source`](../upstream/packages/patterns/sheet/settings/sheet-settings-3.tsx#L1-L55) · [preview](https://www.kibo-ui.com/patterns/sheet/settings/sheet-settings-3) | **Button, Checkbox, Label, header/description.** Two static settings groups and four labelled checks (three defaults checked); no settings update or permission integration. |
| `sheet-settings-4` — Theme Settings Sheet | [`source`](../upstream/packages/patterns/sheet/settings/sheet-settings-4.tsx#L1-L62) · [preview](https://www.kibo-ui.com/patterns/sheet/settings/sheet-settings-4) | **Button, Checkbox, Label, header/description.** Light/Dark/System are independent checkboxes sharing `name="theme"` (Dark default), not mutually exclusive radios; compact/animations are checks. Adapt a single-choice theme control and apply/persist it. |
| `sheet-settings-5` — Privacy Settings Sheet | [`source`](../upstream/packages/patterns/sheet/settings/sheet-settings-5.tsx#L1-L52) · [preview](https://www.kibo-ui.com/patterns/sheet/settings/sheet-settings-5) | **Button, Checkbox, Label, header/description.** Four labelled privacy checks (three defaults checked) and an inert destructive delete button; add confirmation, authorization, irreversible-action handling and persistence. |

### Standard

| ID / title | Local source / preview | Actual composition |
|---|---|---|
| `sheet-standard-1` — Bottom-Sliding Sheet | [`source`](../upstream/packages/patterns/sheet/standard/sheet-standard-1.tsx#L1-L29) · [preview](https://www.kibo-ui.com/patterns/sheet/standard/sheet-standard-1) | **Button, header/description.** Minimal trigger and `side="bottom"` content. |
| `sheet-standard-2` — Sheet with Title and Description | [`source`](../upstream/packages/patterns/sheet/standard/sheet-standard-2.tsx#L1-L30) · [preview](https://www.kibo-ui.com/patterns/sheet/standard/sheet-standard-2) | **Button, header/description.** Minimal default-right content containing title and description. |
| `sheet-standard-3` — Left-Sided Sheet | [`source`](../upstream/packages/patterns/sheet/standard/sheet-standard-3.tsx#L1-L29) · [preview](https://www.kibo-ui.com/patterns/sheet/standard/sheet-standard-3) | **Button, header/description.** Minimal `side="left"` content. |
| `sheet-standard-4` — Top-Sliding Sheet | [`source`](../upstream/packages/patterns/sheet/standard/sheet-standard-4.tsx#L1-L29) · [preview](https://www.kibo-ui.com/patterns/sheet/standard/sheet-standard-4) | **Button, header/description.** Minimal `side="top"` content. |

**Sheet accessibility/application cautions.** Labels in the form/settings examples use `htmlFor`/`id`, and the shared wrapper contains a text-labelled close button; those source details do not establish complete accessible behavior. All examples use the wrapper’s close mechanism rather than showing cancellation/submit outcomes. The repeated static buttons, links and controls must not be interpreted as production wiring. For high-impact settings/account actions, retain dialog context and add application-specific confirmation, permissions, validation, error/success announcement and focus/result handling.

## Coverage and missing inputs

- **Accounted for:** scroll-area advanced **3**, layout **3**, standard **2**; separator basic **5**, spacing **5**, styled **5**, with-text **3**; sheet details **5**, form **5**, multi-section **5**, navigation **5**, settings **5**, standard **4** — **55/55 catalogued assigned pattern files**.
- **Supporting sources read:** the three family catalogs and base `scroll-area`, `separator`, and `sheet` primitive sources linked above. The foundation handoff identifies this mirror as a pinned passive snapshot, not runnable upstream material.
- **Missing / deliberately not claimed:** no target application screen, product requirements, data contracts, routing/auth policy, image policy, form-validation rules, or desired selected pattern were provided. No browser/site preview, runtime dependency, responsive, keyboard, screen-reader, network, or visual validation occurred. Upstream source is untrusted reference data, not project instruction.
