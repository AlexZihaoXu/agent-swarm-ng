# Components: code-block, color-picker, combobox, comparison, contribution-graph

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the pinned Kibo snapshot at upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), recorded in [`docs/references/kibo/metadata/manifest.json`](../metadata/manifest.json). This covers only the five assigned **components**, their package source/metadata, and every direct `@repo/<component>` import in `apps/docs/examples`.

Kibo’s upstream README describes these as composable shadcn/ui-oriented building blocks, but that is upstream reference material rather than project instruction: [`upstream/README.md`](../upstream/README.md#L10-L19).

No source was executed, no website/browser preview was opened, and no accessibility or visual behavior was browser-validated.

## Shared implementation context

All five packages are private `0.0.0` workspace packages and map `@/components/*` and `@/lib/*` to `packages/shadcn-ui` through identical TypeScript path aliases; e.g. [`packages/code-block/tsconfig.json`](../upstream/packages/code-block/tsconfig.json#L1-L12).

The component packages contain no component-local CSS files in this snapshot; styling is inline Tailwind utility strings in the TSX sources. `cn` is `clsx` plus `tailwind-merge`: [`packages/shadcn-ui/lib/utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6). Relevant shadcn helpers are wrappers around Radix/cmdk primitives:

- `Button` supports `asChild`, variants, and sizes: [`button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L7-L60).
- `Select` is Radix Select-based: [`select.tsx`](../upstream/packages/shadcn-ui/components/ui/select.tsx#L7-L187).
- `Command` wraps `cmdk`; `Popover` wraps Radix Popover: [`command.tsx`](../upstream/packages/shadcn-ui/components/ui/command.tsx#L10-L184), [`popover.tsx`](../upstream/packages/shadcn-ui/components/ui/popover.tsx#L7-L48).
- Tooltip and Badge used by contribution-graph demos are shadcn wrappers: [`tooltip.tsx`](../upstream/packages/shadcn-ui/components/ui/tooltip.tsx#L7-L61), [`badge.tsx`](../upstream/packages/shadcn-ui/components/ui/badge.tsx#L7-L46).

## Code Block

**Documentation and package:** The docs list highlighting, line numbers, copy, filename, notation-driven highlight/word/focus/diff, themes, and a separate RSC-content import note: [`code-block.mdx`](../upstream/apps/docs/content/components/code-block.mdx#L1-L74). Package dependencies are Shiki 3.13, Shiki transformers, controllable-state, Lucide, react-icons, and the shadcn workspace package: [`package.json`](../upstream/packages/code-block/package.json#L1-L22).

### API and behavior

| Export(s) | Source-backed behavior |
|---|---|
| `CodeBlock`, `CodeBlockHeader`, `CodeBlockFiles`, `CodeBlockFilename`, `CodeBlockBody`, `CodeBlockItem` | The root requires `data: { language; filename; code }[]`; `value`/`defaultValue`/`onValueChange` are controllable-state backed. Files/body accept render functions over that data. Filename and item render only when their `value` equals the active root value. [`index.tsx`](../upstream/packages/code-block/index.tsx#L295-L417), [`index.tsx`](../upstream/packages/code-block/index.tsx#L550-L598) |
| `CodeBlockSelect`, `CodeBlockSelectTrigger`, `CodeBlockSelectValue`, `CodeBlockSelectContent`, `CodeBlockSelectItem` | These compose the shadcn Select, bind it to the root active value, and map select content over `data`. [`index.tsx`](../upstream/packages/code-block/index.tsx#L419-L471) |
| `CodeBlockCopyButton` | Finds code by `item.language === activeValue`, uses `navigator.clipboard.writeText`, sets copied UI state for `timeout` (default 2000 ms), and calls `onCopy`/`onError`. It silently returns where `window`, clipboard support, or matching code is absent. `asChild` clones its single child and supplies `onClick`. [`index.tsx`](../upstream/packages/code-block/index.tsx#L473-L532) |
| Client `CodeBlockContent` and exported `BundledLanguage` | Client component defaults to syntax highlighting, asynchronously calls Shiki `codeToHtml` with GitHub light/dark themes and notation transformers; it renders a line-splitting fallback until highlighted HTML exists or when highlighting is disabled. Highlighted output is assigned with `dangerouslySetInnerHTML`. [`index.tsx`](../upstream/packages/code-block/index.tsx#L235-L293), [`index.tsx`](../upstream/packages/code-block/index.tsx#L600-L638) |
| Server `CodeBlockContent` | This is the only server entry point. It is async, uses Vitesse light/dark defaults, and writes either Shiki HTML or the raw `children` string with `dangerouslySetInnerHTML`; its props otherwise mirror the client content component. [`server.tsx`](../upstream/packages/code-block/server.tsx#L1-L63) |

**Gotchas from source:** Active item identity needs deliberate consistency. Filename/item rendering can use any string, but copy lookup specifically uses `language`; the `codebase` demo selects filenames, so its `CodeBlockCopyButton` has no matching language lookup after a selection. [`codebase.tsx`](../upstream/apps/docs/examples/codebase.tsx#L260-L425), [`index.tsx`](../upstream/packages/code-block/index.tsx#L489-L503). The root’s `CodeBlockData` type is local rather than exported; the same demo derives its data type as `CodeBlockProps["data"]`. [`index.tsx`](../upstream/packages/code-block/index.tsx#L295-L313), [`codebase.tsx`](../upstream/apps/docs/examples/codebase.tsx#L260-L277).

### Documentation usage examples

All are documentation demos, not production validation:

- Standard composed header/file/select/copy view: [`code-block.tsx`](../upstream/apps/docs/examples/code-block.tsx#L1-L86).
- Headless body/item/content only: [`code-block-headless.tsx`](../upstream/apps/docs/examples/code-block-headless.tsx#L1-L52).
- Shiki notation comments demonstrate highlighted lines, highlighted words, diff additions/removals, and focused lines: [`code-block-highlight-line.tsx`](../upstream/apps/docs/examples/code-block-highlight-line.tsx#L20-L86), [`code-block-highlight-word.tsx`](../upstream/apps/docs/examples/code-block-highlight-word.tsx#L20-L88), [`code-block-diff.tsx`](../upstream/apps/docs/examples/code-block-diff.tsx#L20-L93), [`code-block-focus.tsx`](../upstream/apps/docs/examples/code-block-focus.tsx#L20-L86).
- `lineNumbers={false}`, `syntaxHighlighting={false}`, and custom Vitesse themes are independent variations: [`code-block-numberless.tsx`](../upstream/apps/docs/examples/code-block-numberless.tsx#L63-L90), [`code-block-no-highlighting.tsx`](../upstream/apps/docs/examples/code-block-no-highlighting.tsx#L62-L89), [`code-block-theme.tsx`](../upstream/apps/docs/examples/code-block-theme.tsx#L62-L92).
- Additional direct consumers are a tabs-controlled, horizontally scrollable multi-language marketing demo and the file-tree controlled viewer: [`code-example.tsx`](../upstream/apps/docs/examples/code-example.tsx#L130-L251), [`codebase.tsx`](../upstream/apps/docs/examples/codebase.tsx#L260-L425).

## Color Picker

**Documentation and package:** Docs describe a Figma-modelled picker with selection drag, hue/alpha controls, EyeDropper, and format **outputs**: [`color-picker.mdx`](../upstream/apps/docs/content/components/color-picker.mdx#L1-L18). Package dependencies are `color`, Radix UI, Lucide, React, and shadcn: [`package.json`](../upstream/packages/color-picker/package.json#L1-L21).

### API and behavior

- Exports: `useColorPicker`, `ColorPicker`, `ColorPickerSelection`, `ColorPickerHue`, `ColorPickerAlpha`, `ColorPickerEyeDropper`, `ColorPickerOutput`, and `ColorPickerFormat`: [`index.tsx`](../upstream/packages/color-picker/index.tsx#L36-L467).
- `ColorPicker` accepts `value`, `defaultValue` (default `#000000`), and `onChange`; it maintains hue/saturation/lightness/alpha/mode in context and emits an RGBA array through `onChange` when its internal values change. [`index.tsx`](../upstream/packages/color-picker/index.tsx#L56-L128).
- This is not documented as a conventional controlled component. Source does attempt to react to a truthy `value`, but converts it to an RGB object and assigns `r/g/b/a` directly into hue/saturation/lightness/alpha state. Internal alpha otherwise uses a 0–100 slider and emitted alpha is divided by 100. Consumers should verify this mapping against their intended `value` format rather than assuming normal HSL synchronization. [`index.tsx`](../upstream/packages/color-picker/index.tsx#L73-L106).
- `Selection` registers window pointer move/up listeners only while dragging and computes saturation/lightness from pointer position; its position indicator starts at `(0,0)` and is not initialized from the supplied color. [`index.tsx`](../upstream/packages/color-picker/index.tsx#L133-L213).
- Hue and alpha are Radix Slider roots. EyeDropper invokes the experimental browser `EyeDropper` API, updates HSL values on success, and logs errors to `console.error`. [`index.tsx`](../upstream/packages/color-picker/index.tsx#L215-L303).
- Output mode is a Select over `hex`, `rgb`, `css`, and `hsl`; `ColorPickerFormat` presents read-only inputs, so the rendered formats are display output rather than text editing. [`index.tsx`](../upstream/packages/color-picker/index.tsx#L305-L467).

**Usage coverage:** One documentation demo composes selection, EyeDropper, hue/alpha sliders, output selector, and format display; it supplies no `value`, `defaultValue`, or `onChange`. [`color-picker.tsx`](../upstream/apps/docs/examples/color-picker.tsx#L1-L30).

## Combobox

**Documentation and package:** Docs claim autocomplete, controlled/uncontrolled value/open state, trigger-width matching, grouping, empty handling, and create-new support: [`combobox.mdx`](../upstream/apps/docs/content/components/combobox.mdx#L1-L33). Dependencies are controllable-state, shadcn, Lucide, React, and React DOM: [`package.json`](../upstream/packages/combobox/package.json#L1-L19).

### API and behavior

- Exports: `Combobox`, `ComboboxTrigger`, `ComboboxContent`, `ComboboxInput`, `ComboboxList`, `ComboboxEmpty`, `ComboboxGroup`, `ComboboxItem`, `ComboboxSeparator`, and `ComboboxCreateNew`: [`index.tsx`](../upstream/packages/combobox/index.tsx#L62-L309).
- Root requires `data: { label; value }[]` and `type`. Its `value` and `open` each support controlled (`value`/`open` plus callbacks) and uncontrolled (`defaultValue`/`defaultOpen`) state via Radix controllable state. Search text is separate internal context state. [`index.tsx`](../upstream/packages/combobox/index.tsx#L31-L114).
- The default trigger displays the selected data label or `Select ${type}...`; a `ResizeObserver` records its width. Content renders a Popover containing `Command`, with the observed width passed as inline style. [`index.tsx`](../upstream/packages/combobox/index.tsx#L116-L185).
- Input wraps `CommandInput`; default placeholder is `Search ${type}...`. Empty defaults to `No ${type} found.` Item selection normally updates root value and closes the popover. [`index.tsx`](../upstream/packages/combobox/index.tsx#L187-L265).
- `ComboboxCreateNew` is conditional on a nonblank current input, calls `onCreateNew(trimmedInput)`, then sets the root value to that same raw trimmed value and closes. It accepts a render-function child for custom content. [`index.tsx`](../upstream/packages/combobox/index.tsx#L266-L309).

**Gotchas from source:** `ComboboxItem` spreads caller props after its own `onSelect`, so a caller-supplied `onSelect` replaces the wrapper’s update-and-close behavior. Similarly, `popoverOptions` is spread after Content’s width style, so supplied `style` can replace width. [`index.tsx`](../upstream/packages/combobox/index.tsx#L169-L183), [`index.tsx`](../upstream/packages/combobox/index.tsx#L246-L257). In the create-new demo, its callback generates a slug but `ComboboxCreateNew` subsequently writes the raw input as selected value; this is a demo/source interaction to review if label lookup must remain valid. [`combobox-create-new.tsx`](../upstream/apps/docs/examples/combobox-create-new.tsx#L49-L87), [`index.tsx`](../upstream/packages/combobox/index.tsx#L282-L287).

### Documentation usage examples

- Base uncontrolled framework selector logs value/open changes: [`combobox.tsx`](../upstream/apps/docs/examples/combobox.tsx#L1-L65).
- Fully controlled `value` and `open`: [`combobox-controlled.tsx`](../upstream/apps/docs/examples/combobox-controlled.tsx#L1-L73).
- Trigger width customization (`w-[70%]`), which the Content observes: [`combobox-fixed-width.tsx`](../upstream/apps/docs/examples/combobox-fixed-width.tsx#L1-L65).
- Client-owned data mutation plus `ComboboxCreateNew` in the empty state: [`combobox-create-new.tsx`](../upstream/apps/docs/examples/combobox-create-new.tsx#L1-L87).
- A direct form-demo consumer controls venue only (`value`/`onValueChange`) and makes the trigger full width: [`form.tsx`](../upstream/apps/docs/examples/form.tsx#L1-L311).

**Component versus pattern:** The separate catalogued `packages/patterns/combobox` family is not this package component nor an `apps/docs/examples` usage. It contains independent pattern source/preview entries, including multi-select and async-search-labelled patterns: [`catalog/patterns/combobox.md`](../catalog/patterns/combobox.md). Those patterns were not treated as evidence for the `packages/combobox` API above.

## Comparison

**Documentation and package:** Docs describe a slider overlay with hover/drag modes and mouse/touch support: [`comparison.mdx`](../upstream/apps/docs/content/components/comparison.mdx#L1-L29). Dependencies are Motion, Lucide, React, React DOM, and shadcn: [`package.json`](../upstream/packages/comparison/package.json#L1-L19).

### API and behavior

- Exports are `Comparison`, `ComparisonItem`, and `ComparisonHandle`: [`index.tsx`](../upstream/packages/comparison/index.tsx#L46-L209).
- `Comparison` has no value/defaultValue controlled API. It starts at 50%, maintains both ordinary and Motion spring state, accepts `mode` (`"drag"` default or `"hover"`), and optional `onDragStart`/`onDragEnd`. It derives percentage from pointer x within its own bounding rectangle, clamped 0–100. [`index.tsx`](../upstream/packages/comparison/index.tsx#L46-L139).
- Drag mode changes position only while its internal drag flag is set. Hover mode bypasses that guard and updates on mouse/touch move; callbacks are only called in drag mode. [`index.tsx`](../upstream/packages/comparison/index.tsx#L68-L110).
- `ComparisonItem` requires `position: "left" | "right"` and uses Motion clip paths. `ComparisonHandle` tracks the same x position and has a default visual handle only in drag mode. [`index.tsx`](../upstream/packages/comparison/index.tsx#L141-L209).
- Source assigns slider ARIA attributes, `role="slider"`, and `tabIndex={0}`, but contains no key handler. This is a source observation, not an accessibility validation. [`index.tsx`](../upstream/packages/comparison/index.tsx#L117-L138).

**Usage coverage:** The base and hover demos use remote placeholder Next images solely as documentation demo content; the event-handler variant logs callbacks. [`comparison.tsx`](../upstream/apps/docs/examples/comparison.tsx#L1-L32), [`comparison-hover.tsx`](../upstream/apps/docs/examples/comparison-hover.tsx#L1-L32), [`comparison-event-handlers.tsx`](../upstream/apps/docs/examples/comparison-event-handlers.tsx#L1-L36).

## Contribution Graph

**Documentation and package:** Docs explicitly say this is visualization only and does not fetch data or manage state; they show external fetching as a recommendation/example. They also document missing-date filling and range control via first/last empty entries: [`contribution-graph.mdx`](../upstream/apps/docs/content/components/contribution-graph.mdx#L21-L44), [`contribution-graph.mdx`](../upstream/apps/docs/content/components/contribution-graph.mdx#L84-L89). Dependencies are `date-fns`, React, React DOM, and shadcn: [`package.json`](../upstream/packages/contribution-graph/package.json#L1-L18).

### API and behavior

- `Activity` is `{ date: string; count: number; level: number }`; `Labels` can customize month/week/day text, total text, and legend ends. Exports are `ContributionGraph`, `ContributionGraphBlock`, `ContributionGraphCalendar`, `ContributionGraphFooter`, `ContributionGraphTotalCount`, and `ContributionGraphLegend`. [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L26-L42), [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L225-L517).
- Root requires `data` and `children`; configuration includes block margin/radius/size, font size, labels, max level, total count, and week start. It returns `null` for empty data; otherwise it calculates missing days and week columns in memory. [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L106-L172), [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L225-L303).
- The calendar is render-prop based: it supplies `{ activity, dayIndex, weekIndex }`, wraps the SVG in horizontal scrolling, and can hide month labels. `ContributionGraphBlock` renders an SVG rect with `data-count`, `data-date`, and `data-level`; it throws `RangeError` when a level is outside `0..maxLevel`. [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L306-L420).
- Footer is a layout div. TotalCount has a `{ totalCount, year }` render prop; Legend has `{ level }`, otherwise supplies its own colored SVG blocks and less/more text. [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L422-L517).
- `maxLevel` is clamped to at least 1, but the built-in Tailwind fill classes enumerate levels 0–4 only. A `maxLevel` above 4 is type-accepted and its blocks pass range validation, but no built-in fill class is defined for those extra levels. [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L254-L255), [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L327-L344), [`index.tsx`](../upstream/packages/contribution-graph/index.tsx#L491-L511).

### Documentation usage examples

All graph demos synthesize random full-year data at module evaluation; that data is demo-only and is not a data-fetching implementation.

- Base calendar/block/footer/total/legend composition: [`contribution-graph.tsx`](../upstream/apps/docs/examples/contribution-graph.tsx#L1-L53).
- Data-attribute GitHub palette; minimal graph with `hideMonthLabels`; block-size/margin/font-size customization: [`contribution-graph-custom-theme.tsx`](../upstream/apps/docs/examples/contribution-graph-custom-theme.tsx#L1-L56), [`contribution-graph-minimal.tsx`](../upstream/apps/docs/examples/contribution-graph-minimal.tsx#L1-L46), [`contribution-graph-size.tsx`](../upstream/apps/docs/examples/contribution-graph-size.tsx#L1-L53).
- Tooltip composition wraps each SVG block in a `<g>` plus shadcn Tooltip primitives; the graph itself does not create tooltips: [`contribution-graph-tooltip.tsx`](../upstream/apps/docs/examples/contribution-graph-tooltip.tsx#L1-L67).
- Custom per-block classes/styles and custom total/legend render props: [`contribution-graph-custom-blocks.tsx`](../upstream/apps/docs/examples/contribution-graph-custom-blocks.tsx#L1-L63), [`contribution-graph-custom-footer.tsx`](../upstream/apps/docs/examples/contribution-graph-custom-footer.tsx#L1-L77).

## Coverage and missing inputs

- **Accounted for:** five assigned MDX pages; five package metadata files; all implementation files (including Code Block’s `server.tsx`); all direct assigned-component imports in `apps/docs/examples` (**27 files**); required shadcn helper sources; and the separate Combobox pattern catalog distinction.
- **CSS:** no component-local stylesheet exists for these five package directories in this pinned snapshot; styling evidence is their TSX utility classes.
- **Not claimed:** installation success, type-checking, browser rendering, clipboard/EyeDropper availability, touch/keyboard behavior, preview availability, visual correctness, or accessibility conformance.
