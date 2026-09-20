# Components: tags, theme-switcher, ticker, tree, typography

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

This is a **read-only source analysis** of the local passive snapshot at upstream commit [`3d63cdb15b79d972e3dc38a10997987672f9b263`](https://github.com/shadcnblocks/kibo/tree/3d63cdb15b79d972e3dc38a10997987672f9b263), not an application integration or dependency recommendation. The snapshot’s provenance/limitations are recorded in [`docs/references/kibo/README.md`](../README.md); its component-doc index lists all five assigned pages in [`docs/references/kibo/catalog/components.md`](../catalog/components.md), and the example index is navigational only ([`catalog/examples.md`](../catalog/examples.md)).

The assigned items are **Kibo components** (or, for Typography, a CSS package), not Kibo “patterns.” The files below were read; neither examples nor upstream dependencies were executed, and no browser, visual, interaction, or accessibility validation was performed.

## Tags

**Docs and package:** [`apps/docs/content/components/tags.mdx` (local lines 1–26)](../upstream/apps/docs/content/components/tags.mdx#L1-L26), [`packages/tags/index.tsx` (1–221)](../upstream/packages/tags/index.tsx#L1-L221), and [`packages/tags/package.json` (1–17)](../upstream/packages/tags/package.json#L1-L17).

| Surface | Actual source contract |
| --- | --- |
| Root | `Tags({ value?, setValue?, open?, onOpenChange?, children?, className? })`; it wraps a Radix-style `Popover`, observes its own wrapper with `ResizeObserver`, and supplies the observed width to `TagsContent` ([`index.tsx` 59–109](../upstream/packages/tags/index.tsx#L59-L109)). `open` is controlled when supplied; otherwise its default is `false` and internal state is used ([76–81](../upstream/packages/tags/index.tsx#L76-L81)). |
| Composition exports | `TagsTrigger`, `TagsValue`, `TagsContent`, `TagsInput`, `TagsList`, `TagsEmpty`, `TagsGroup`, and `TagsItem` plus their exported prop types ([112–221](../upstream/packages/tags/index.tsx#L112-L221)). Trigger is an outline `Button` used as the popover trigger; content contains a `Command`; input/list/item delegate to Command primitives; empty text defaults to “No tags found.” ([114–135](../upstream/packages/tags/index.tsx#L114-L135), [170–220](../upstream/packages/tags/index.tsx#L170-L220)). |
| Selection ownership | Despite the documented controlled/uncontrolled feature claim, the implementation only controls **popover open state**. `value` and `setValue` are placed in a non-exported context but are not consumed by any supplied child; selecting/removing tags is application code via `CommandItem.onSelect` and `TagsValue.onRemove` ([31–57](../upstream/packages/tags/index.tsx#L31-L57), [99–102](../upstream/packages/tags/index.tsx#L99-L102), [139–166](../upstream/packages/tags/index.tsx#L139-L166)). |

**Dependencies/helpers.** Package metadata declares React/React DOM and Lucide only ([`package.json` 6–10](../upstream/packages/tags/package.json#L6-L10)); implementation additionally resolves local shadcn `Badge`, `Button`, `Command*`, `Popover*`, and `cn` aliases ([`index.tsx` 14–29](../upstream/packages/tags/index.tsx#L14-L29)). The relevant helper sources are [`badge.tsx` 6–45](../upstream/packages/shadcn-ui/components/ui/badge.tsx#L6-L45), [`button.tsx` 6–60](../upstream/packages/shadcn-ui/components/ui/button.tsx#L6-L60), [`command.tsx` 11–130](../upstream/packages/shadcn-ui/components/ui/command.tsx#L11-L130), [`popover.tsx` 8–48](../upstream/packages/shadcn-ui/components/ui/popover.tsx#L8-L48), and [`lib/utils.ts` 1–6](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6). The package’s `@/` alias maps to those sibling sources ([`packages/tags/tsconfig.json` 1–12](../upstream/packages/tags/tsconfig.json#L1-L12)).

**Source-read gotchas.** `TagsValue`’s remove affordance is a clickable `div` with lint suppressions, not a `button` ([155–162](../upstream/packages/tags/index.tsx#L155-L162)). `TagsEmpty` destructures `className` but never applies it ([202–208](../upstream/packages/tags/index.tsx#L202-L208)). These are source observations, not an accessibility verdict.

**Every matching `apps/docs/examples` usage:**

- [`tags.tsx` (1–85)](../upstream/apps/docs/examples/tags.tsx#L1-L85) owns a `selected: string[]`, toggles IDs in `TagsItem.onSelect`, renders checkmarks, and supplies `onRemove`; this is demo-owned selection behavior.
- [`tags-create.tsx` (1–111)](../upstream/apps/docs/examples/tags-create.tsx#L1-L111) adds local tag creation from `TagsInput.onValueChange`, using custom `TagsEmpty` content; no package create API exists.
- [`tags-filter.tsx` (1–86)](../upstream/apps/docs/examples/tags-filter.tsx#L1-L86) filters already selected IDs out of the displayed options.
- [`form.tsx` (1–311)](../upstream/apps/docs/examples/form.tsx#L1-L311) embeds the same locally controlled tag list in an event form—see tag state/handlers at [86–100](../upstream/apps/docs/examples/form.tsx#L86-L100) and composition at [207–231](../upstream/apps/docs/examples/form.tsx#L207-L231).

## Theme Switcher

**Docs and package:** [`theme-switcher.mdx` (1–22)](../upstream/apps/docs/content/components/theme-switcher.mdx#L1-L22), [`index.tsx` (1–99)](../upstream/packages/theme-switcher/index.tsx#L1-L99), [`package.json` (1–20)](../upstream/packages/theme-switcher/package.json#L1-L20).

- Sole export: `ThemeSwitcher`; props are `value`, `onChange`, `defaultValue`, and `className`, with value union `"light" | "dark" | "system"`; default is `system` ([`index.tsx` 27–44](../upstream/packages/theme-switcher/index.tsx#L27-L44)). It uses Radix `useControllableState`, so the source supports controlled (`value` + callback) and uncontrolled (`defaultValue`) usage.
- It returns `null` until an effect marks it mounted, then renders three labelled native buttons with Lucide icons and a Motion shared-layout active indicator ([45–97](../upstream/packages/theme-switcher/index.tsx#L45-L97)).
- The component **does not itself apply a document class/attribute, resolve the system preference, persist a setting, or integrate a theme provider**; its click path only calls the controllable-state setter ([47–52](../upstream/packages/theme-switcher/index.tsx#L47-L52)). Consumers must give `onChange` any theme-application behavior.
- Declared runtime dependencies are `@radix-ui/react-use-controllable-state`, `@repo/shadcn-ui`, Lucide, Motion, React, and React DOM ([`package.json` 6–13](../upstream/packages/theme-switcher/package.json#L6-L13)); the implementation’s only shadcn helper is `cn` ([`index.tsx` 3–7](../upstream/packages/theme-switcher/index.tsx#L3-L7)).

**Every matching example:** [`theme-switcher.tsx` (1–14)](../upstream/apps/docs/examples/theme-switcher.tsx#L1-L14) is controlled with local `useState`; [`theme-switcher-uncontrolled.tsx` (1–9)](../upstream/apps/docs/examples/theme-switcher-uncontrolled.tsx#L1-L9) passes only `defaultValue` and logs `onChange`. Both demonstrate state notification, not application-wide theme changes.

## Ticker

**Docs and package:** [`ticker.mdx` (1–26)](../upstream/apps/docs/content/components/ticker.mdx#L1-L26), [`index.tsx` (1–195)](../upstream/packages/ticker/index.tsx#L1-L195), [`package.json` (1–17)](../upstream/packages/ticker/package.json#L1-L17).

| Export | Actual source behavior |
| --- | --- |
| `Ticker`, `useTickerContext` | `Ticker` is memoized and renders a native `button`, forwarding button HTML attributes. It creates a per-instance `Intl.NumberFormat` from `locale`/`currency`, defaulting to `en-US`/`USD` with exactly two fraction digits; invalid formatter inputs fall back to that default formatter ([`index.tsx` 12–70](../upstream/packages/ticker/index.tsx#L12-L70)). There is no controlled state. |
| `TickerIcon` | Default mode renders shadcn `AvatarImage` and uses the first two uppercased `symbol` characters as fallback. With `asChild`, it renders only a styled wrapper around supplied children; `src`/other image props are not forwarded in that branch ([72–110](../upstream/packages/ticker/index.tsx#L72-L110)). |
| `TickerSymbol`, `TickerPrice` | Symbol uppercases text; price formats a numeric `price` with the nearest `Ticker` formatter ([112–145](../upstream/packages/ticker/index.tsx#L112-L145)). |
| `TickerPriceChange` | A non-negative value (including zero) is “up”/green; negative is “down”/red with a rotated triangle. Currency changes use the formatter; `isPercent` instead uses `change.toFixed(2) + "%"` ([147–195](../upstream/packages/ticker/index.tsx#L147-L195)). |

Ticker declares `@repo/shadcn-ui`, React, and React DOM ([`package.json` 6–10](../upstream/packages/ticker/package.json#L6-L10)); implementation uses the local Avatar primitives ([`avatar.tsx` 8–47](../upstream/packages/shadcn-ui/components/ui/avatar.tsx#L8-L47)) and `cn` ([`ticker/index.tsx` 3–6](../upstream/packages/ticker/index.tsx#L3-L6)). The static SVG title ID is `ticker-change-icon-title` for each change instance ([175–189](../upstream/packages/ticker/index.tsx#L175-L189)); source consumers rendering many instances should note that repeated ID.

**Every matching example:**

- [`ticker.tsx` (1–30)](../upstream/apps/docs/examples/ticker.tsx#L1-L30) composes all parts and uses `asChild` with Next `Image` whose logo URL depends on `NEXT_PUBLIC_LOGO_DEV_TOKEN`.
- [`ticker-percent.tsx` (1–42)](../upstream/apps/docs/examples/ticker-percent.tsx#L1-L42) maps positive/negative entries with `isPercent`.
- [`ticker-currency.tsx` (1–49)](../upstream/apps/docs/examples/ticker-currency.tsx#L1-L49) demonstrates defaults plus `EUR`/`de-DE` and `JPY`/`ja-JP`.
- [`ticker-inline.tsx` (1–34)](../upstream/apps/docs/examples/ticker-inline.tsx#L1-L34) nests the button inside paragraph prose and changes it with `className`; it also uses external demo imagery/token input.

## Tree

**Docs and package:** [`tree.mdx` (1–37)](../upstream/apps/docs/content/components/tree.mdx#L1-L37), [`index.tsx` (1–445)](../upstream/packages/tree/index.tsx#L1-L445), [`package.json` (1–19)](../upstream/packages/tree/package.json#L1-L19).

- **Exports:** `TreeProvider`, `TreeView`, `TreeNode`, `TreeNodeTrigger`, `TreeLines`, `TreeNodeContent`, `TreeExpander`, `TreeIcon`, `TreeLabel`, plus their corresponding prop types where declared ([`index.tsx` 59–445](../upstream/packages/tree/index.tsx#L59-L445)). Composition is manual: provide matching `nodeId`, nesting, `level`, and `isLast`; `TreeNodeContent` only renders its children when both `hasChildren` and expanded are true ([175–222](../upstream/packages/tree/index.tsx#L175-L222), [312–356](../upstream/packages/tree/index.tsx#L312-L356)).
- **State:** expansion is internal only, initialized from `defaultExpandedIds`; there is no expanded-ID callback/controlled prop ([73–107](../upstream/packages/tree/index.tsx#L73-L107)). Selection is controlled only when **both** `selectedIds` and `onSelectionChange` are provided; otherwise it uses initial `selectedIds ?? []` in internal state ([89–95](../upstream/packages/tree/index.tsx#L89-L95)). `selectable=false` stops selection. `multiSelect` only accumulates/toggles on click with Ctrl or Meta; otherwise clicking a selected node clears selection and clicking another produces one selected ID ([109–138](../upstream/packages/tree/index.tsx#L109-L138)).
- **Interaction/rendering:** Trigger click always toggles expansion and handles selection; a separate `TreeExpander` stops propagation and toggles expansion only ([226–257](../upstream/packages/tree/index.tsx#L226-L257), [362–394](../upstream/packages/tree/index.tsx#L362-L394)). `showLines`, `showIcons`, `indent` (20 default), and `animateExpand` (true default) control the supplied visual pieces/animation durations ([73–84](../upstream/packages/tree/index.tsx#L73-L84), [259–310](../upstream/packages/tree/index.tsx#L259-L310), [401–439](../upstream/packages/tree/index.tsx#L401-L439)). Default icons are Folder/FolderOpen/File; `icon` overrides them.
- **Keyboard claim boundary:** the docs claim keyboard navigation, but this source’s selection modifier handling appears only in the trigger click event (`ctrlKey || metaKey`) and the package contains no `onKeyDown` handler ([`index.tsx` 244–247](../upstream/packages/tree/index.tsx#L244-L247)). That is a source-reading discrepancy, not runtime validation.
- **Dependencies:** metadata declares local shadcn UI, Motion, Lucide, React, and React DOM ([`package.json` 6–12](../upstream/packages/tree/package.json#L6-L12)); implementation imports only local `cn` from shadcn plus Motion/Lucide ([`index.tsx` 3–15](../upstream/packages/tree/index.tsx#L3-L15)).

**Every matching example:**

- [`tree.tsx` (1–149)](../upstream/apps/docs/examples/tree.tsx#L1-L149) is the general file-tree composition: manually specified levels/last nodes, initially expanded IDs, custom file icons, and a console-only selection callback.
- [`tree-simple.tsx` (1–99)](../upstream/apps/docs/examples/tree-simple.tsx#L1-L99) is the minimal Documents/Downloads composition using default icons.
- [`tree-custom-icons.tsx` (1–141)](../upstream/apps/docs/examples/tree-custom-icons.tsx#L1-L141) passes coloured Lucide nodes through `TreeIcon.icon`.
- [`tree-no-lines.tsx` (1–116)](../upstream/apps/docs/examples/tree-no-lines.tsx#L1-L116) passes `showLines={false}` and initial expansion.
- [`tree-controlled.tsx` (1–140)](../upstream/apps/docs/examples/tree-controlled.tsx#L1-L140) supplies both selection control props with `multiSelect`; external buttons set/clear the selected IDs ([17–50](../upstream/apps/docs/examples/tree-controlled.tsx#L17-L50)).
- [`codebase.tsx` (1–425)](../upstream/apps/docs/examples/codebase.tsx#L1-L425) combines Tree with CodeBlock: it passes `selectedIds={[selectedFile]}` and an `onSelectionChange` that only accepts a nonempty first ID, then changes the CodeBlock value ([273–303](../upstream/apps/docs/examples/codebase.tsx#L273-L303), [397–422](../upstream/apps/docs/examples/codebase.tsx#L397-L422)).

## Typography

**Docs and package:** [`typography.mdx` (1–24)](../upstream/apps/docs/content/components/typography.mdx#L1-L24), [`packages/typography/styles.css` (1–326)](../upstream/packages/typography/styles.css#L1-L326), [`package.json` (1–20)](../upstream/packages/typography/package.json#L1-L20).

- This is a **CSS-only package**, not a React component: its only package export maps `.` to `./styles.css` ([`package.json` 6–8](../upstream/packages/typography/package.json#L6-L8)). Import it and apply `className="typography"`, as the docs and example do ([`typography.mdx` 8–14](../upstream/apps/docs/content/components/typography.mdx#L8-L14), [`examples/typography.tsx` 3–9](../upstream/apps/docs/examples/typography.tsx#L3-L9)).
- Styles are in `@layer base`, cap `.typography` at `65ch`, and use project CSS variables such as `--color-foreground`, `--text-*`, `--spacing`, and `--radius` ([`styles.css` 1–17](../upstream/packages/typography/styles.css#L1-L17)). H1 changes from 4xl to 5xl at 1024px; H2–H6 have decreasing size/weight rules and heading scroll margins ([6–95](../upstream/packages/typography/styles.css#L6-L95)).
- The CSS explicitly covers paragraphs/lists/links/blockquotes/tables ([97–209](../upstream/packages/typography/styles.css#L97-L209)), code/pre and `.lead`/`.large`/`.small`/`.muted` utility classes ([211–256](../upstream/packages/typography/styles.css#L211-L256)), media, keyboard text, rules, definition lists, details, marks, and small text ([258–324](../upstream/packages/typography/styles.css#L258-L324)). Its selectors explicitly exclude matching `.not-typography` descendants (for example, headings and paragraphs at [6–7, 97–103](../upstream/packages/typography/styles.css#L6-L7)).
- Metadata declares `@repo/shadcn-ui`, React, and React DOM ([`package.json` 9–13](../upstream/packages/typography/package.json#L9-L13)); `styles.css` itself has no imports. Compatibility of its nesting/layer syntax and required CSS variables is untested here.

**Every matching example:** [`apps/docs/examples/typography.tsx` (1–163)](../upstream/apps/docs/examples/typography.tsx#L1-L163) is the sole matching usage. It demonstrates the import/class wrapper across headings, lists, checkboxes, external placeholder image, `pre`/`code`, quote, table, links, definition list, details, mark/small, and super/subscript ([20–151](../upstream/apps/docs/examples/typography.tsx#L20-L151)); it is sample content, not evidence that those styles rendered.

## Coverage and missing inputs

- **Accounted for:** all five assigned docs pages; implementations/CSS and package metadata for `tags`, `theme-switcher`, `ticker`, `tree`, and `typography`; all **17** matching imports/usages under `apps/docs/examples` (Tags 4, Theme Switcher 2, Ticker 4, Tree 6, Typography 1); and directly imported local shadcn helpers.
- **Not asserted:** current upstream behavior beyond the pinned commit, package installation correctness, runtime/browser behavior, visual appearance, keyboard/accessibility conformance, remote image availability, or any production application integration.
- **Missing inputs:** no consuming application requirements, theme-provider contract, CSS-variable/theme baseline, browser matrix, or installed dependency graph was supplied or inspected. The ticker example’s logo requests depend on an environment token, so its image loading cannot be inferred from source alone.
