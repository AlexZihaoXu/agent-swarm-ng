# Components: credit-card, cursor, deck, dialog-stack, dropzone

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), recorded in [`docs/references/kibo/metadata/manifest.json`](../metadata/manifest.json). These are **components**, not Kibo patterns: the assigned sources are component MDX pages, package implementations, and docs examples.

No browser, runtime, visual, or accessibility validation was performed. Findings below are from local source reading only; `apps/docs/examples` are documentation demos, not production integrations.

# Code Context

## Files Retrieved

1. [`docs/references/kibo/catalog/components.md`](../catalog/components.md) and [`catalog/examples.md`](../catalog/examples.md) — catalog confirms all five component docs and all 25 directly importing example files.
2. [`docs/references/kibo/upstream/packages/credit-card/index.tsx`](../upstream/packages/credit-card/index.tsx#L1-L348), [`package.json`](../upstream/packages/credit-card/package.json#L1-L18), and [`apps/docs/content/components/credit-card.mdx`](../upstream/apps/docs/content/components/credit-card.mdx#L1-L27) — credit-card API and documentation.
3. [`docs/references/kibo/upstream/packages/cursor/index.tsx`](../upstream/packages/cursor/index.tsx#L1-L62), [`package.json`](../upstream/packages/cursor/package.json#L1-L17), and [`apps/docs/content/components/cursor.mdx`](../upstream/apps/docs/content/components/cursor.mdx#L1-L37) — cursor API and documentation.
4. [`docs/references/kibo/upstream/packages/deck/index.tsx`](../upstream/packages/deck/index.tsx#L1-L297), [`package.json`](../upstream/packages/deck/package.json#L1-L20), and [`apps/docs/content/components/deck.mdx`](../upstream/apps/docs/content/components/deck.mdx#L1-L26) — deck API and documentation.
5. [`docs/references/kibo/upstream/packages/dialog-stack/index.tsx`](../upstream/packages/dialog-stack/index.tsx#L1-L484), [`package.json`](../upstream/packages/dialog-stack/package.json#L1-L19), and [`apps/docs/content/components/dialog-stack.mdx`](../upstream/apps/docs/content/components/dialog-stack.mdx#L1-L28) — dialog-stack API and documentation.
6. [`docs/references/kibo/upstream/packages/dropzone/index.tsx`](../upstream/packages/dropzone/index.tsx#L1-L202), [`package.json`](../upstream/packages/dropzone/package.json#L1-L19), and [`apps/docs/content/components/dropzone.mdx`](../upstream/apps/docs/content/components/dropzone.mdx#L1-L44) — dropzone API and documentation.
7. [`docs/references/kibo/upstream/packages/shadcn-ui/lib/utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6) and [`components/ui/button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L1-L60) — shared `cn` class merger and the Button used by Dropzone.
8. Each assigned package’s [`tsconfig.json`](../upstream/packages/dropzone/tsconfig.json#L1-L13) maps `@/lib/*` and `@/components/*` to `packages/shadcn-ui`; the five package directories contain `index.tsx`, `package.json`, and `tsconfig.json`, with no component-local CSS file.

## Key Code

### Credit Card

**Exports:** `CreditCard`, `CreditCardFlipper`, `CreditCardName`, `CreditCardChip`, `CreditCardLogo`, `CreditCardFront`, `CreditCardServiceProvider`, `CreditCardBack`, `CreditCardMagStripe`, `CreditCardNumber`, `CreditCardExpiry`, and `CreditCardCvv` ([implementation](../upstream/packages/credit-card/index.tsx#L31-L348)).

| Area | Source-backed behavior / integration note |
|---|---|
| Layout | `CreditCard` is a styled `div` with an `8560/5398` aspect ratio, `max-w-96`, container-query class, and normal `HTMLAttributes<HTMLDivElement>` passthrough ([lines 31-42](../upstream/packages/credit-card/index.tsx#L31-L42)). |
| Flip state | `CreditCardFlipper` has only internal `isFlipped` state; it starts false. After `matchMedia("(hover: hover)")`, hover-capable environments receive a group-hover rotation; non-hover environments toggle rotation on click ([lines 15-29](../upstream/packages/credit-card/index.tsx#L15-L29), [48-83](../upstream/packages/credit-card/index.tsx#L48-L83)). No controlled flip prop/callback is exported. |
| Composition | `CreditCardFront` and `CreditCardBack` are absolute, backface-hidden layers; their default `safeArea` values are 20 and 16 respectively. The back rotates only when inside `CreditCardFlipper`; `CreditCardMagStripe` reads the back safe area to extend its width ([lines 166-193](../upstream/packages/credit-card/index.tsx#L166-L193), [232-294](../upstream/packages/credit-card/index.tsx#L232-L294)). |
| Custom visuals | `CreditCardChip` renders a built-in SVG when childless, or positions supplied children in a wrapper. `CreditCardServiceProvider` defaults to `PaymentIcon type="Visa"` but can render supplied children instead ([lines 102-152](../upstream/packages/credit-card/index.tsx#L102-L152), [195-228](../upstream/packages/credit-card/index.tsx#L195-L228)). In both custom-child branches, remaining props are not spread to the wrapper. |
| Content | Name is uppercase; number, expiry, and CVV are presentational paragraphs with monospace styles—there are no inputs, masking, or validation routines in this package ([lines 85-100](../upstream/packages/credit-card/index.tsx#L85-L100), [296-348](../upstream/packages/credit-card/index.tsx#L296-L348)). |
| Dependencies | Package metadata declares React/React DOM, `@repo/shadcn-ui`, and `react-svg-credit-card-payment-icons` `^4.2.1` ([package.json lines 6-16](../upstream/packages/credit-card/package.json#L6-L16)). |

**Documentation versus implementation:** the MDX describes displaying/validating card information and “hide/reveal” on click ([MDX lines 8-13](../upstream/apps/docs/content/components/credit-card.mdx#L8-L13)); the implementation evidences visual flipping but no validation or conditional hiding/revealing of number/CVV content. The flipper has `aria-label="Flip credit card"` on a clickable `div`, but source reading alone does not establish keyboard or full assistive-technology behavior ([lines 64-77](../upstream/packages/credit-card/index.tsx#L64-L77)).

**All matching docs usages:**

- Base demo composes Chase-branded front/back layers, the built-in chip, Visa provider, card values, and flipper ([`credit-card.tsx` lines 50-82](../upstream/apps/docs/examples/credit-card.tsx#L50-L82)).
- Apple demo supplies a custom chip and Mastercard SVG, changes front/back safe areas, and adjusts positioning ([`credit-card-apple.tsx` lines 137-164](../upstream/apps/docs/examples/credit-card-apple.tsx#L137-L164)).
- Back-only demo omits `CreditCardFlipper` and uses `CreditCardBack` directly ([`credit-card-back.tsx` lines 11-29](../upstream/apps/docs/examples/credit-card-back.tsx#L11-L29)).
- Amex demo uses `type="Amex"` with the packaged payment icon and themed front/back ([`credit-card-amex.tsx` lines 69-97](../upstream/apps/docs/examples/credit-card-amex.tsx#L69-L97)).

### Cursor

**Exports:** `Cursor`, `CursorPointer`, `CursorBody`, `CursorName`, and `CursorMessage` ([implementation](../upstream/packages/cursor/index.tsx#L4-L62)).

| Area | Source-backed behavior / integration note |
|---|---|
| Composition | The root is a relative, non-interactive `span` (`pointer-events-none select-none`). It does not track pointer position or provide realtime transport/state ([lines 4-13](../upstream/packages/cursor/index.tsx#L4-L13)). Positioning is supplied by consumers, as in the static absolute placements in the base demo ([`cursor.tsx` lines 11-34](../upstream/apps/docs/examples/cursor.tsx#L11-L34)). |
| Pointer | `CursorPointer` is a fixed SVG using `currentColor`, initially `aria-hidden="true"` and `focusable="false"`; props are spread afterward, so callers can override those attributes ([lines 15-34](../upstream/packages/cursor/index.tsx#L15-L34)). |
| Label body | `CursorBody` uses default secondary/foreground colors. With more than one child, it changes its top-left corner and lowers opacity of the first child; `CursorName` and `CursorMessage` are otherwise plain spans ([lines 36-62](../upstream/packages/cursor/index.tsx#L36-L62)). |
| Dependencies | Only React/React DOM and `@repo/shadcn-ui` are declared ([package.json lines 6-15](../upstream/packages/cursor/package.json#L6-L15)). |

**Documentation versus implementation:** the MDX claims automatic contrast adjustment, ARIA accessibility, responsiveness, and optimized rendering ([MDX lines 8-15](../upstream/apps/docs/content/components/cursor.mdx#L8-L15)). The package source evidences the pointer’s initial ARIA attributes and CSS classes only; it contains no contrast calculation, positioning, or realtime logic.

**All matching docs usages:**

- Base usage demonstrates three statically positioned color-themed cursors with name and message ([`cursor.tsx` lines 11-34](../upstream/apps/docs/examples/cursor.tsx#L11-L34)).
- Pointer-only composition: [`cursor-only.tsx` lines 5-9](../upstream/apps/docs/examples/cursor-only.tsx#L5-L9).
- One-child name body: [`cursor-name.tsx` lines 5-12](../upstream/apps/docs/examples/cursor-name.tsx#L5-L12).
- One-child message body; it passes `color="#000000"` to `Cursor`: [`cursor-message.tsx` lines 5-12](../upstream/apps/docs/examples/cursor-message.tsx#L5-L12).
- Two-child name/message body: [`cursor-name-message.tsx` lines 11-19](../upstream/apps/docs/examples/cursor-name-message.tsx#L11-L19).
- “Custom color” demo uses Tailwind color classes on pointer and body: [`cursor-color.tsx` lines 11-19](../upstream/apps/docs/examples/cursor-color.tsx#L11-L19).

- Shared block consumer: [`collaborative-canvas.tsx`](../upstream/apps/docs/examples/collaborative-canvas.tsx) imports Cursor; its simulated collaborators are not realtime transport. See [block notes](blocks-03.md).

### Deck

**Exports:** `Deck`, `DeckCards`, `DeckItem`, and `DeckEmpty`; internal draggable `DeckCard` is not exported ([implementation](../upstream/packages/deck/index.tsx#L22-L40), [199-297](../upstream/packages/deck/index.tsx#L199-L297)).

See the linked declaration for the exact `DeckCardsProps` API; it is not duplicated here.

The declaration and defaults are in [`packages/deck/index.tsx` lines 28-63](../upstream/packages/deck/index.tsx#L28-L63): threshold `150`, stack size `3`, perspective `1000`, scale `0.05`, default index `0`, external-index animation enabled, and left exit direction.

- **Controlled/uncontrolled index:** `useControllableState` uses `currentIndex`, `defaultCurrentIndex`, and `onCurrentIndexChange`; swiping schedules index advancement after 300 ms ([lines 58-63](../upstream/packages/deck/index.tsx#L58-L63), [105-130](../upstream/packages/deck/index.tsx#L105-L130)). `onSwipe` and `onSwipeEnd` are both called immediately for a qualifying swipe, before the scheduled increment.
- **Gesture/rendering:** only horizontal drag offsets with absolute magnitude **greater than** `threshold` invoke a swipe. The top card is cloned, so usable children need to be React elements accepting `className`; it receives merged sizing/selection/shadow classes ([lines 222-265](../upstream/packages/deck/index.tsx#L222-L265)).
- **Completion:** `DeckCards` returns `null` when its displayed index reaches the child count. `DeckEmpty` is independent and always renders an absolute empty panel, so it needs a positioned/sized parent such as `Deck`; it does not receive deck state ([lines 133-146](../upstream/packages/deck/index.tsx#L133-L146), [281-297](../upstream/packages/deck/index.tsx#L281-L297)).
- **External index changes:** an external index change can set an exit direction and delay display-index update for 300 ms; the implementation’s timers shown here have no cleanup ([lines 71-103](../upstream/packages/deck/index.tsx#L71-L103)).
- **Dependencies:** metadata declares Radix controllable state, Motion, Lucide, React/React DOM, and `@repo/shadcn-ui` ([package.json lines 6-18](../upstream/packages/deck/package.json#L6-L18)). The implementation imports Motion and Radix but not Lucide ([index lines 3-20](../upstream/packages/deck/index.tsx#L3-L20)).

**All matching docs usages:**

- Base demo maps five externally hosted placeholder images to `DeckItem`s and adds `DeckEmpty`; the URLs and content are demo data ([`deck.tsx` lines 6-53](../upstream/apps/docs/examples/deck.tsx#L6-L53)).
- Controlled demo owns `currentIndex` and direction in local state, advances it from buttons, and passes `currentIndex`, `onCurrentIndexChange`, `animateOnIndexChange`, and `indexChangeDirection` ([`deck-controlled.tsx` lines 15-92](../upstream/apps/docs/examples/deck-controlled.tsx#L15-L92)).
- Product-card demo uses `onSwipe={console.log}` and demo product/image data; this logging is docs-demo behavior, not package behavior ([`deck-product-cards.tsx` lines 9-106](../upstream/apps/docs/examples/deck-product-cards.tsx#L9-L106)).

### Dialog Stack

**Exports:** `DialogStack`, `DialogStackTrigger`, `DialogStackOverlay`, `DialogStackBody`, `DialogStackContent`, `DialogStackTitle`, `DialogStackDescription`, `DialogStackHeader`, `DialogStackFooter`, `DialogStackNext`, and `DialogStackPrevious` ([implementation](../upstream/packages/dialog-stack/index.tsx#L49-L484)).

| Area | Source-backed behavior / integration note |
|---|---|
| Open state | Only open state is controllable: `open`, `defaultOpen` (default `false`), and `onOpenChange`. Active dialog index is always internal state initialized to zero ([lines 49-95](../upstream/packages/dialog-stack/index.tsx#L49-L95)). The component both supplies `onOpenChange` to `useControllableState` and invokes it from a state effect; source reading does not establish resultant runtime call count ([lines 66-76](../upstream/packages/dialog-stack/index.tsx#L66-L76)). |
| Portal/stack | When open, `DialogStackBody` portals content through `Portal.Root`, counts its direct children once into `totalDialogs`, and injects each child’s index. The count is initialized with `useState(Children.count(children))`, so source does not show an update path for later child-count changes ([lines 189-245](../upstream/packages/dialog-stack/index.tsx#L189-L245)). |
| Navigation | Next/Previous change the internal active index and default to disabled at bounds ([lines 377-484](../upstream/packages/dialog-stack/index.tsx#L377-L484)). Passing an `onClick` prop is a hazard: it remains in `...props`, which is spread after the generated handler in both regular and `asChild` paths, so it overrides the generated navigation handler. |
| Clickable history | With `clickable`, only a prior dialog (`activeIndex > index`) can be selected by clicking it. Future dialogs are transparent (`opacity: 0`) and non-active content disables pointer events ([lines 269-313](../upstream/packages/dialog-stack/index.tsx#L269-L313)). |
| Closing | The overlay closes only through its click handler ([lines 153-187](../upstream/packages/dialog-stack/index.tsx#L153-L187)). The source shown does not implement escape handling, focus trapping/restoration, dialog roles, or `aria-modal`; no production-dialog accessibility conclusion should be drawn from the docs feature list. |
| Dependencies | Metadata declares Radix controllable state, `radix-ui`, React/React DOM, and `@repo/shadcn-ui` ([package.json lines 6-18](../upstream/packages/dialog-stack/package.json#L6-L18)). |

**All matching docs usages:**

- Base demo opens a three-step stack with `DialogStackTrigger asChild`, overlay, portal body, and previous/next controls ([`dialog-stack.tsx` lines 18-74](../upstream/apps/docs/examples/dialog-stack.tsx#L18-L74)).
- Controlled demo manages `open` with React state outside `DialogStack`; it has no `DialogStackTrigger` ([`dialog-stack-controlled.tsx` lines 18-80](../upstream/apps/docs/examples/dialog-stack-controlled.tsx#L18-L80)).
- Navigation demo uses the same three steps with `clickable` enabled ([`dialog-stack-navigation.tsx` lines 18-74](../upstream/apps/docs/examples/dialog-stack-navigation.tsx#L18-L74)).
- Six-dialog demo exercises previous/next bounds across six direct `DialogStackContent` children ([`dialog-stack-six.tsx` lines 18-125](../upstream/apps/docs/examples/dialog-stack-six.tsx#L18-L125)).

### Dropzone

**Exports:** `Dropzone`, `DropzoneContent`, and `DropzoneEmptyState` ([implementation](../upstream/packages/dropzone/index.tsx#L36-L202)).

| Area | Source-backed behavior / integration note |
|---|---|
| File state | `Dropzone` does not store accepted files. Its `src?: File[]` prop controls the context and which state component renders; docs demos hold files in parent state and update `src` in `onDrop` ([package lines 36-45](../upstream/packages/dropzone/index.tsx#L36-L45), [`dropzone.tsx` lines 6-26](../upstream/apps/docs/examples/dropzone.tsx#L6-L26)). `undefined` shows empty state; even `[]` is truthy and therefore shows content with an empty filename list ([implementation lines 119-164](../upstream/packages/dropzone/index.tsx#L119-L164)). |
| Options | It accepts all `react-dropzone` options except its replaced `onDrop`, with `maxFiles` defaulting to 1. `accept`, min/max size, disabled, error handler, and other options are passed to `useDropzone` ([lines 36-77](../upstream/packages/dropzone/index.tsx#L36-L77)). |
| Rejections | Any rejection causes it to call `onError` with only the first rejection’s first error and return without calling consumer `onDrop`, even if that batch also has accepted files ([lines 67-75](../upstream/packages/dropzone/index.tsx#L67-L75)). |
| Root | The root is the shared shadcn Button with `getRootProps()` and a nested `getInputProps()` input; it applies a ring while `isDragActive` and receives `disabled` ([lines 79-99](../upstream/packages/dropzone/index.tsx#L79-L99)). Shared `Button` renders a button by default and combines variants through `cn` ([Button source lines 39-60](../upstream/packages/shadcn-ui/components/ui/button.tsx#L39-L60)); `cn` is `clsx` plus `tailwind-merge` ([utils lines 1-6](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6)). |
| Default presentation | `DropzoneContent` lists at most three file names, then “and N more”; it does not render individual file sizes. Byte formatting is used only in `DropzoneEmptyState`’s min/max caption and is base-1024 with two decimal places ([lines 19-30](../upstream/packages/dropzone/index.tsx#L19-L30), [133-149](../upstream/packages/dropzone/index.tsx#L133-L149), [171-200](../upstream/packages/dropzone/index.tsx#L171-L200)). |
| Dependencies | Metadata declares `react-dropzone` `^14.3.8`, Lucide, React/React DOM, and `@repo/shadcn-ui` ([package.json lines 6-18](../upstream/packages/dropzone/package.json#L6-L18)). |

**Documentation versus implementation:** the MDX says image previews and replacement are features ([MDX lines 13-22](../upstream/apps/docs/content/components/dropzone.mdx#L13-L22)). Replacement is achieved in demos by parent state replacement; the package itself has no file-state setter. The image-preview demo creates the preview through parent-owned `FileReader` logic, not an exported Dropzone preview component ([`dropzone-image-preview.tsx` lines 6-44](../upstream/apps/docs/examples/dropzone-image-preview.tsx#L6-L44)).

**All matching docs usages:**

- Base demo combines image acceptance, `maxFiles={10}`, `1 KiB`–`10 MiB` limits, parent-owned files, and console error logging ([`dropzone.tsx` lines 6-30](../upstream/apps/docs/examples/dropzone.tsx#L6-L30)).
- Accept-only demo restricts to `image/*` ([`dropzone-accept.tsx` lines 6-27](../upstream/apps/docs/examples/dropzone-accept.tsx#L6-L27)).
- Custom empty-state demo supplies custom children to `DropzoneEmptyState` ([`dropzone-custom-empty-state.tsx` lines 7-35](../upstream/apps/docs/examples/dropzone-custom-empty-state.tsx#L7-L35)).
- Image-preview demo restricts extensions and renders a parent-created data URL ([`dropzone-image-preview.tsx` lines 6-48](../upstream/apps/docs/examples/dropzone-image-preview.tsx#L6-L48)).
- Min/max demo supplies the size bounds ([`dropzone-min-max.tsx` lines 6-28](../upstream/apps/docs/examples/dropzone-min-max.tsx#L6-L28)).
- Multiple-files demo supplies `maxFiles={3}` ([`dropzone-multiple.tsx` lines 6-27](../upstream/apps/docs/examples/dropzone-multiple.tsx#L6-L27)).

- Shared block consumer: [`form.tsx`](../upstream/apps/docs/examples/form.tsx#L281-L291) imports Dropzone and stores accepted files locally but omits `src`; the default content therefore remains in its empty state. This is not an upload service. See [block notes](blocks-06.md).

## Architecture

All five packages are client-side React component sources. Four use the shared `cn` helper through `@/lib/utils`; their package TypeScript path mapping resolves that alias to `packages/shadcn-ui/lib` ([`packages/deck/tsconfig.json` lines 1-13](../upstream/packages/deck/tsconfig.json#L1-L13)). Dropzone additionally imports the snapshot’s shared Button through `@/components/ui/button`.

The packages supply presentational/compositional primitives, while docs examples provide application state and sample data:

- **Credit card:** consumer composes front/back content; flipper owns only touch flip state.
- **Cursor:** consumer supplies position/content/color classes; package does not provide realtime position transport.
- **Deck:** package owns gesture/render transition state, optionally coordinating index with consumer state.
- **Dialog stack:** package owns step index; consumer may control only visibility.
- **Dropzone:** `react-dropzone` provides input/drop handling; consumer owns accepted-file state and optional previews.

## Start Here

Open [`docs/references/kibo/upstream/packages/dropzone/index.tsx`](../upstream/packages/dropzone/index.tsx#L36-L99) first if evaluating an upload UI: it exposes the clearest boundary between package behavior (`useDropzone`, rejection handling, rendering) and required application behavior (`src` state, upload/process lifecycle, image preview).

## Coverage and missing inputs

- **Covered:** all five assigned component MDX pages; all five package implementations, package metadata, and TypeScript alias configuration; no component-local CSS exists in these five package directories; all **25** direct-import example relationships (4 credit-card, 7 cursor, 3 deck, 4 dialog-stack, 7 dropzone; see the complete example index at [`catalog/examples.md` lines 60-84](../catalog/examples.md)).
- **Missing / intentionally not claimed:** no dependency installation, source execution, website/preview inspection, browser interaction, responsive testing, visual comparison, or accessibility validation occurred. Upstream MDX feature claims that lack corresponding local implementation evidence are identified above rather than treated as verified behavior.
