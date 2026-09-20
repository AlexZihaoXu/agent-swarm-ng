# Components: editor, gantt, glimpse, image-crop, image-zoom

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only analysis of the local Kibo snapshot pinned to upstream commit [`3d63cdb15b79d972e3dc38a10997987672f9b263`](../VERIFICATION.md). The foundation record identifies this as a passive source snapshot; no source was run, no browser/visual/accessibility validation was performed, and upstream documentation is untrusted reference material.

These are **components**, not Kibo pattern files. No `packages/patterns/**` source is included in this report.

## Files Retrieved

1. [`apps/docs/content/components/editor.mdx`](../upstream/apps/docs/content/components/editor.mdx) (lines 1–33) — documented features/dependencies.
2. [`apps/docs/content/components/gantt.mdx`](../upstream/apps/docs/content/components/gantt.mdx) (lines 1–40) — documented features and named variants.
3. [`apps/docs/content/components/glimpse.mdx`](../upstream/apps/docs/content/components/glimpse.mdx) (lines 1–25) — documented URL-preview intent.
4. [`apps/docs/content/components/image-crop.mdx`](../upstream/apps/docs/content/components/image-crop.mdx) (lines 1–30) — documented crop variants.
5. [`apps/docs/content/components/image-zoom.mdx`](../upstream/apps/docs/content/components/image-zoom.mdx) (lines 1–31) — documented zoom variants.
6. [`packages/editor/index.tsx`](../upstream/packages/editor/index.tsx) (lines 1–1,980) and [`package.json`](../upstream/packages/editor/package.json) (lines 1–35) — implementation and metadata.
7. [`packages/gantt/index.tsx`](../upstream/packages/gantt/index.tsx) (lines 1–1,469) and [`package.json`](../upstream/packages/gantt/package.json) (lines 1–25) — implementation and metadata.
8. [`packages/glimpse/index.tsx`](../upstream/packages/glimpse/index.tsx) (lines 1–67), [`server.tsx`](../upstream/packages/glimpse/server.tsx) (lines 1–21), and [`package.json`](../upstream/packages/glimpse/package.json) (lines 1–17).
9. [`packages/image-crop/index.tsx`](../upstream/packages/image-crop/index.tsx) (lines 1–368) and [`package.json`](../upstream/packages/image-crop/package.json) (lines 1–20).
10. [`packages/image-zoom/index.tsx`](../upstream/packages/image-zoom/index.tsx) (lines 1–52) and [`package.json`](../upstream/packages/image-zoom/package.json) (lines 1–18).
11. All matching examples listed in the coverage section below, including the non-obvious Gantt use in [`apps/docs/examples/roadmap.tsx`](../upstream/apps/docs/examples/roadmap.tsx) (lines 1–617).
12. Required local shadcn helpers: [`lib/utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts) (lines 1–7), plus `components/ui/{button,command,dropdown-menu,popover,separator,tooltip,card,context-menu,hover-card}.tsx`.

## Shared integration notes

- `cn()` is `twMerge(clsx(...))`, so component `className` inputs are merged with the supplied Tailwind utility strings: [`packages/shadcn-ui/lib/utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6).
- The components assume Kibo’s `@repo/shadcn-ui` workspace package and its Tailwind/CSS-variable theme. The wrappers use Radix-based helpers for hover cards, menus, popovers, tooltips, and buttons; this is source dependency information, **not** an independent accessibility validation.
- No assigned package contains a component-local `.css` file. `image-crop` alone explicitly imports dependency CSS, `react-image-crop/dist/ReactCrop.css`: [`packages/image-crop/index.tsx`](../upstream/packages/image-crop/index.tsx#L23-L23). The rest style through Tailwind classes/CSS variables.

---

## Editor

**Intent:** a client-side TipTap composition with a provider, formatting/menu primitives, slash suggestions, table controls, and count displays. The documentation advertises rich-text, slash, table, count, placeholder, and character-limit features: [`editor.mdx`](../upstream/apps/docs/content/components/editor.mdx#L11-L33).

### Public surface

- Re-exports TipTap `Editor` and `JSONContent`; exports `SuggestionItem` and `defaultSlashSuggestions`: [`index.tsx`](../upstream/packages/editor/index.tsx#L59-L59), [`index.tsx`](../upstream/packages/editor/index.tsx#L132-L236).
- Provider/menu components: `EditorProvider`, `EditorFloatingMenu`, `EditorBubbleMenu`, `EditorSelector`, `EditorLinkSelector`.
- Formatting/node controls: `EditorClearFormatting`; `EditorNodeText`, `EditorNodeHeading1/2/3`, `EditorNodeBulletList`, `EditorNodeOrderedList`, `EditorNodeTaskList`, `EditorNodeQuote`, `EditorNodeCode`, `EditorNodeTable`; `EditorFormatBold`, `Italic`, `Strike`, `Code`, `Subscript`, `Superscript`, `Underline`.
- Table composition/commands: `EditorTableMenu`, `EditorTableGlobalMenu`, `EditorTableColumnMenu`, `EditorTableRowMenu`; `EditorTableColumnBefore/After/Delete`, `EditorTableRowBefore/After/Delete`, `EditorTableHeaderColumnToggle`, `EditorTableHeaderRowToggle`, `EditorTableDelete`, `EditorTableMergeCells`, `EditorTableSplitCell`, `EditorTableFix`.
- `EditorCharacterCount` is an object with `Characters` and `Words` components: [`index.tsx`](../upstream/packages/editor/index.tsx#L1935-L1980). Prop types are exported alongside the applicable components.

### Behavior and state

- `EditorProviderProps` extends TipTap `EditorProviderProps` and adds `className`, `limit`, and `placeholder`. It assembles default extensions, then appends `TextStyleKit` and caller-provided `extensions`; it sets `immediatelyRender={false}`: [`index.tsx`](../upstream/packages/editor/index.tsx#L515-L734).
- The provider’s configured defaults include StarterKit (with its default code block disabled), typography, placeholder, `CharacterCount` with `limit`, lowlight code blocks, superscript/subscript, slash, tables, and task lists: [`index.tsx`](../upstream/packages/editor/index.tsx#L528-L712).
- Slash suggestions are an internal custom TipTap node. Defaults cover text, to-do, headings 1–3, bullet/numbered lists, quote, code, and table; matching uses Fuse over title/description/search terms and Tippy for the popup: [`index.tsx`](../upstream/packages/editor/index.tsx#L132-L236), [`index.tsx`](../upstream/packages/editor/index.tsx#L601-L670).
- The editor’s content is controlled at the TipTap-provider level when consumers supply `content` and synchronize via `onUpdate`; the Kibo wrapper itself does not expose a separate `value`/`onValueChange` API. The sole example holds `JSONContent` in React state and calls `editor.getJSON()` in `onUpdate`: [`apps/docs/examples/editor.tsx`](../upstream/apps/docs/examples/editor.tsx#L48-L350).
- `EditorLinkSelector` accepts optional `open`/`onOpenChange`, normalizes an entered dotted host to `https://…`, and calls TipTap `setLink`/`unsetLink`: [`index.tsx`](../upstream/packages/editor/index.tsx#L1280-L1393). It has local `url` state; the input combines `defaultValue` with a controlled `value` initialized to `""`, so the selected-link URL is not initialized into the displayed state by this wrapper.
- Most control components return `null` outside an active TipTap editor context. Table-position menus listen to `selectionUpdate` and position themselves from DOM table/cell/row rectangles: [`index.tsx`](../upstream/packages/editor/index.tsx#L1395-L1615).

### Dependencies

The package declares TipTap core/react/extensions/ProseMirror/starter-kit/suggestion, `fuse.js`, `lowlight`, `tippy.js`, Lucide, React, `@floating-ui/dom`, and `@repo/shadcn-ui`: [`packages/editor/package.json`](../upstream/packages/editor/package.json#L6-L28). It directly consumes local Button, Command, DropdownMenu, Popover, Separator, and Tooltip wrappers.

### Example coverage

| Source | Demonstrated composition |
| --- | --- |
| [`examples/editor.tsx`](../upstream/apps/docs/examples/editor.tsx#L1-L392) | Stateful JSON content, `onUpdate`, floating node menu, bubble selectors/formatting/link/clear controls, positioned table controls, and word count. The initial JSON deliberately includes headings, task/bullet/ordered lists, quote, inline/block code, and a table. |

**Gotchas from source:** this is a large composition layer rather than a one-element editor. Consumers must render desired controls inside `EditorProvider`; the provider alone does not render a toolbar. Its styling and menu dependencies are coupled to Kibo shadcn helpers and Tailwind theme tokens.

---

## Gantt

**Intent:** a client-side, composable schedule timeline with sidebar, rows/items, markers, today indicator, optional add/resize callbacks, three ranges, and lane overlap layout. Documentation specifically names draggable/resizable items, markers, grouping, and multiple items per row: [`gantt.mdx`](../upstream/apps/docs/content/components/gantt.mdx#L11-L24).

### Public surface

- Types/hooks: `GanttStatus`, `GanttFeature`, `GanttMarkerProps`, `Range` (`"daily" | "monthly" | "quarterly"`), `TimelineData`, `GanttContextProps`, `useGanttDragging`, and `useGanttScrollX`: [`index.tsx`](../upstream/packages/gantt/index.tsx#L56-L111).
- Layout: `GanttProvider`, `GanttTimeline`, `GanttHeader`, `GanttContentHeader`, `GanttSidebar`, `GanttSidebarHeader`, `GanttSidebarGroup`, `GanttSidebarItem`, `GanttColumns`, `GanttColumn`, `GanttFeatureList`, and `GanttFeatureListGroup`.
- Items/rows/interaction: `GanttFeatureItem`, `GanttFeatureItemCard`, `GanttFeatureDragHelper`, `GanttFeatureRow`, `GanttAddFeatureHelper`, `GanttCreateMarkerTrigger`, `GanttMarker`, and `GanttToday`.

`GanttFeature` requires `id`, `name`, `startAt`, `endAt`, and `status`; `lane` is optional and is only a consumer grouping key, not an internally interpreted layout switch: [`index.tsx`](../upstream/packages/gantt/index.tsx#L65-L78).

### Behavior and state

- `GanttProvider` accepts `range`, `zoom`, `onAddItem`, `children`, and `className`; defaults are `monthly` and `100`. It creates a three-year timeline centered on the current year, initially centers horizontal scroll, fixes sidebar width to either `300` or `0` based on presence of a `data-roadmap-ui="gantt-sidebar"` element, and emits CSS variables: [`index.tsx`](../upstream/packages/gantt/index.tsx#L1164-L1242), [`index.tsx`](../upstream/packages/gantt/index.tsx#L1362-L1394).
- Reaching either horizontal edge extends the timeline by a year. The scroll callback is memoized with an empty dependency list while referring to `timelineData`, so this reference snapshot’s callback closes over its initial timeline state: [`index.tsx`](../upstream/packages/gantt/index.tsx#L1244-L1311).
- `GanttFeatureItem` initializes private `startAt`/`endAt` state from its input props; there is no prop-to-state synchronization effect. Dragging changes that local state and `onMove`, if supplied, receives `(id, startAt, endAt)` at drag end: [`index.tsx`](../upstream/packages/gantt/index.tsx#L837-L980). Treat application data as the source of truth and update it in `onMove`; changing feature props later is not evidenced to reset an already-mounted item.
- Providing `onMove` enables the left/right resize handles. The central card is always wrapped in a drag context, including when `onMove` is absent; the documented “read-only” example merely omits callbacks, so it demonstrates no persistence/resize handles rather than proving that drag interactions are disabled: [`index.tsx`](../upstream/packages/gantt/index.tsx#L937-L977), [`examples/gantt-read-only.tsx`](../upstream/apps/docs/examples/gantt-read-only.tsx#L99-L131).
- `GanttFeatureRow` sorts by start date and assigns overlapping features to 36px sub-rows. This is the implementation behind the “multiple items per row” documentation claim: [`index.tsx`](../upstream/packages/gantt/index.tsx#L997-L1071).
- `onAddItem` is optional; when present, hovered timeline columns display an add helper and pass the derived date to the callback. `GanttCreateMarkerTrigger` likewise delegates creation to `onCreateMarker`; marker removal appears only if `onRemove` is passed: [`index.tsx`](../upstream/packages/gantt/index.tsx#L584-L750), [`index.tsx`](../upstream/packages/gantt/index.tsx#L1090-L1162).
- Dragging and horizontal scroll use module-level Jotai atoms, exposed by hooks, rather than per-provider state: [`index.tsx`](../upstream/packages/gantt/index.tsx#L60-L63).

### Dependencies

`@dnd-kit/core`, `@dnd-kit/modifiers`, `@uidotdev/usehooks`, `date-fns`, Jotai, `lodash.throttle`, Lucide, React, and `@repo/shadcn-ui` are declared: [`packages/gantt/package.json`](../upstream/packages/gantt/package.json#L6-L18). The package directly uses the shadcn Card and ContextMenu wrappers.

### Every matching example

| Source | Demonstrated variation |
| --- | --- |
| [`examples/gantt.tsx`](../upstream/apps/docs/examples/gantt.tsx#L1-L238) | Stateful features grouped by group name; sidebar; movable items; removable markers; add-feature and create-marker callbacks; custom item children and external context menu. Faker data and `console.log` handlers are demo-only. |
| [`examples/gantt-lanes.tsx`](../upstream/apps/docs/examples/gantt-lanes.tsx#L1-L284) | Hotel-room reservations grouped by `lane`; each lane is rendered through `GanttFeatureRow`, which handles overlapping sub-rows. |
| [`examples/gantt-no-sidebar.tsx`](../upstream/apps/docs/examples/gantt-no-sidebar.tsx#L1-L222) | Omits `GanttSidebar`; otherwise demonstrates the interactive timeline composition. |
| [`examples/gantt-read-only.tsx`](../upstream/apps/docs/examples/gantt-read-only.tsx#L1-L136) | Omits all mutation callbacks and context actions; renders provider/sidebar/header/list/items/markers/today. |
| [`examples/roadmap.tsx`](../upstream/apps/docs/examples/roadmap.tsx#L1-L617) | A composite roadmap demo where the Gantt is one of calendar/list/kanban/table views. Its `GanttView` repeats the stateful/sidebar/marker/add/move composition at lines 125–245. This is a usage example, not an exported Gantt pattern. |

---

## Glimpse

**Intent:** a HoverCard-based URL preview composition. The documentation says it fetches metadata in a React Server Component and previews it on hover: [`glimpse.mdx`](../upstream/apps/docs/content/components/glimpse.mdx#L9-L25).

### Public surface and behavior

- Client exports: `Glimpse`, `GlimpseContent`, `GlimpseTrigger`, `GlimpseTitle`, `GlimpseDescription`, and `GlimpseImage`; their prop types are exported too: [`packages/glimpse/index.tsx`](../upstream/packages/glimpse/index.tsx#L11-L67).
- `Glimpse`, content, and trigger are thin pass-through wrappers over the local shadcn HoverCard primitives. `GlimpseTitle` styles a paragraph as one-line truncated text, `GlimpseDescription` clamps to two lines, and `GlimpseImage` is a native `img` with `alt` defaulting to `""`: [`packages/glimpse/index.tsx`](../upstream/packages/glimpse/index.tsx#L13-L67).
- The local HoverCard helper delegates to Radix HoverCard and portals content, with defaults of `align="center"` and `sideOffset={4}`: [`packages/shadcn-ui/components/ui/hover-card.tsx`](../upstream/packages/shadcn-ui/components/ui/hover-card.tsx#L6-L44). The Kibo wrapper does not independently implement keyboard, touch, transition, or reduced-motion behavior; those documentation claims were not browser-validated here.
- Server export `glimpse(url)` performs an unrestricted `fetch(url)`, reads response text, then extracts title/description/image by narrow regular expressions. It returns nullable values and has no visible error/status/timeout handling: [`packages/glimpse/server.tsx`](../upstream/packages/glimpse/server.tsx#L1-L21). Its regexes expect particular HTML attribute ordering and double-quoted values, so metadata extraction is best treated as a lightweight demo helper, not robust production parsing.
- No client/server cache, loading, or error API is exported by this package.

### Dependencies and examples

The package metadata declares only React, React DOM, and `@repo/shadcn-ui`: [`packages/glimpse/package.json`](../upstream/packages/glimpse/package.json#L6-L11).

| Source | Demonstrated variation |
| --- | --- |
| [`examples/glimpse.tsx`](../upstream/apps/docs/examples/glimpse.tsx#L1-L37) | Async server example fetches a fixed GitHub URL via `glimpse()`, supplies the fields to image/title/description, and configures zero hover open/close delay. |
| [`examples/glimpse-custom.tsx`](../upstream/apps/docs/examples/glimpse-custom.tsx#L1-L41) | Same metadata fetch/composition with custom content background, image shadow, and title/description typography. |

**Production concern evidenced by source:** because callers choose the URL given to server-side `fetch`, production use needs an application-owned URL validation/network policy. The snapshot does not provide one.

---

## Image Crop

**Intent:** a client-side compound component around `react-image-crop`; it reads a `File`, maintains crop state, and reports a PNG data URL after Apply. The documentation calls out aspect ratio, circular crop, compression, and PNG data URLs: [`image-crop.mdx`](../upstream/apps/docs/content/components/image-crop.mdx#L11-L30).

### Public surface and state model

- Exports `ImageCrop`, `ImageCropContent`, `ImageCropApply`, `ImageCropReset`, and backwards-compatible `Cropper`, with their prop types: [`packages/image-crop/index.tsx`](../upstream/packages/image-crop/index.tsx#L129-L368).
- `ImageCrop` requires `file` and `children`; accepts optional `maxImageSize` (default `5 MiB`), `onCrop`, `onChange`, `onComplete`, plus the remaining `ReactCropProps` except its `onChange`, `onComplete`, and `children`: [`index.tsx`](../upstream/packages/image-crop/index.tsx#L129-L146).
- It is internally stateful: FileReader creates a data URL; load centers a 90%-wide percent crop (aspect constrained if supplied); crop changes and completion update private state while forwarding the two ReactCrop callbacks: [`index.tsx`](../upstream/packages/image-crop/index.tsx#L153-L205).
- `ImageCropContent` must be rendered under `ImageCrop`; otherwise the internal hook throws. It renders `ReactCrop`, passes all retained ReactCrop props, imports the dependency stylesheet, and maps crop border/focus variables to the theme: [`index.tsx`](../upstream/packages/image-crop/index.tsx#L119-L126), [`index.tsx`](../upstream/packages/image-crop/index.tsx#L230-L274).
- `ImageCropApply` runs the crop first and then the caller’s click handler. `ImageCropReset` restores the initial centered crop and clears the completed crop. Both can render their child through Radix `Slot.Root` when `asChild` is true; otherwise they use the local ghost icon Button: [`index.tsx`](../upstream/packages/image-crop/index.tsx#L276-L338). The Button provides disabled/focus-visible styling and `asChild` support: [`packages/shadcn-ui/components/ui/button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L7-L55).
- `Cropper` is a legacy convenience wrapper that renders `ImageCrop` + `ImageCropContent`; it cannot render Apply/Reset controls itself: [`index.tsx`](../upstream/packages/image-crop/index.tsx#L340-L368).

### Important source-level caveat

The crop encoder creates a PNG canvas at the selected pixel dimensions, then recursively retries if the PNG blob exceeds `maxImageSize`. Although it passes `scaleFactor * 0.9` on retry, the function never uses `scaleFactor` to change canvas/source dimensions or encoding: [`packages/image-crop/index.tsx`](../upstream/packages/image-crop/index.tsx#L52-L97). Therefore, source reading indicates that a crop whose generated PNG remains larger than `maxImageSize` will retry without reducing output; do not assume the documented “compression” claim is achieved by this snapshot.

Also, Apply is a no-op until both image ref and `completedCrop` exist: [`index.tsx`](../upstream/packages/image-crop/index.tsx#L185-L198).

### Dependencies and examples

Declared dependencies are `react-image-crop`, Radix UI, Lucide, React/React DOM, and `@repo/shadcn-ui`: [`packages/image-crop/package.json`](../upstream/packages/image-crop/package.json#L6-L13).

| Source | Demonstrated variation |
| --- | --- |
| [`examples/image-crop.tsx`](../upstream/apps/docs/examples/image-crop.tsx#L1-L88) | File input; square (`aspect={1}`) crop; 1 MiB limit; default icon Apply/Reset; external Start Over; displays returned data URL through Next Image. |
| [`examples/image-crop-custom.tsx`](../upstream/apps/docs/examples/image-crop-custom.tsx#L1-L95) | Same crop state flow, but `ImageCropApply`/`Reset` use `asChild` with labeled outline buttons. |
| [`examples/image-crop-circular.tsx`](../upstream/apps/docs/examples/image-crop-circular.tsx#L1-L90) | Adds `circularCrop` and displays the returned PNG as a CSS-rounded image. The source does not show alpha-masking the output; circularity here is the crop UI plus display styling. |

The examples use local React state, `console.log` callbacks, `next/image`, and a file selected by the user; they are demonstrations rather than production upload/persistence code.

---

## Image Zoom

**Intent:** a client wrapper around `react-medium-image-zoom`. The documentation describes click/tap zoom and controlled/uncontrolled state: [`image-zoom.mdx`](../upstream/apps/docs/content/components/image-zoom.mdx#L11-L31).

### Public surface and state model

- Exports only `ImageZoom` and `ImageZoomProps`: [`packages/image-zoom/index.tsx`](../upstream/packages/image-zoom/index.tsx#L9-L52).
- Props are the dependency’s `UncontrolledProps`, plus optional controlled `isZoomed` and `onZoomChange`, `className`, and `backdropClassName`: [`index.tsx`](../upstream/packages/image-zoom/index.tsx#L9-L20). The wrapper keeps no zoom state; it forwards all remaining props to the dependency’s `Zoom`, so controlled versus uncontrolled behavior is delegated to `react-medium-image-zoom`.
- `className` styles the wrapper and the dependency’s zoom/unzoom controls; `backdropClassName` is merged into the dialog class. The default dialog uses a full viewport transparent native-dialog layout, background/80 overlay with backdrop blur, and disables modal image/overlay transitions under `motion-reduce`: [`index.tsx`](../upstream/packages/image-zoom/index.tsx#L21-L50).
- The package metadata declares `react-medium-image-zoom`, React/React DOM, and `@repo/shadcn-ui`: [`packages/image-zoom/package.json`](../upstream/packages/image-zoom/package.json#L6-L11). The implementation itself imports only `cn` from local shadcn utilities.

### Every matching example

| Source | Demonstrated variation |
| --- | --- |
| [`examples/image-zoom.tsx`](../upstream/apps/docs/examples/image-zoom.tsx#L1-L19) | Default wrapper around a Next Image. |
| [`examples/image-zoom-background.tsx`](../upstream/apps/docs/examples/image-zoom-background.tsx#L1-L24) | Overrides the visible modal overlay to `bg-black/80` via `backdropClassName`. |
| [`examples/image-zoom-margin.tsx`](../upstream/apps/docs/examples/image-zoom-margin.tsx#L1-L19) | Forwards `zoomMargin={100}` to the underlying zoom library. |

The examples use remote `placehold.co` images and `unoptimized`; they do not demonstrate controlled `isZoomed`/`onZoomChange`.

---

## Coverage and missing inputs

- **Accounted for docs:** 5/5 assigned MDX pages.
- **Accounted for implementation/metadata:** editor, gantt, glimpse (client + server), image-crop, and image-zoom; no component-local CSS files found, with the dependency CSS import recorded for image-crop.
- **Accounted for matching `apps/docs/examples` usage:** editor (1), gantt (5, including `roadmap.tsx`), glimpse (2), image-crop (3), image-zoom (3): **14 files**.
- **Missing inputs / uncertainty:** dependency implementations, generated installation output, actual browser rendering, interaction behavior, keyboard/touch behavior, reduced-motion behavior, and accessibility conformance were not available for validation in this read-only snapshot review. Upstream feature statements are distinguished above from behavior directly evidenced in local source.
