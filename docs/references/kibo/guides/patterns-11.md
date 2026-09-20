# Patterns: item, kbd, label

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

Read-only source analysis of the local passive Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in `docs/references/kibo/metadata/manifest.json:1-12` and the foundation handoff. This covers every TSX pattern under the three assigned families only.

The catalog supplies the IDs, literal source titles, local paths, and website preview URLs: `docs/references/kibo/catalog/patterns/item.md:5-16`, `kbd.md:5-45`, and `label.md:5-14`. Preview URLs are navigation links from catalog metadata—not browser or visual validation. All observations below are source reading; no upstream code was run.

The pattern `@/components/*` aliases resolve in upstream docs to `packages/shadcn-ui/components/*` (`docs/references/kibo/upstream/apps/docs/tsconfig.json:4-10`). They are not evidence that those dependencies are installed in this application.

---

## `item`

### Shared primitive and adaptation boundary

`Item` is a styled `div` by default or a Radix `Slot` when `asChild`; it supports `default`/`outline`/`muted` variants and `default`/`sm` sizes (`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/item.tsx:33-72`). Its compositional slots are `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions`, `ItemHeader`, `ItemFooter`, `ItemGroup`, and `ItemSeparator` (`item.tsx:74-193`).

Required primitive-level imports are React, Radix `Slot`, `class-variance-authority`, local `cn`, and the local `Separator` (`item.tsx:1-6`). `ItemGroup` gives only its outer `div` `role="list"`; `Item` itself remains a `div` unless slotted (`item.tsx:8-16`, `54-72`). Treat this as a visual/compositional primitive, not a complete list semantic.

Safe adaptation: retain the slot nesting and use `asChild` only with an appropriate single child such as a real routed anchor. Supply application data, routes, action callbacks, loading/error state, and list semantics appropriate to the actual control. `ItemDescription` clamps to two lines by default (`item.tsx:132-143`), so remove/adjust that constraint where full content is required.

| Collection | ID / title | Local source | Preview | Source-specific composition / demo gap |
|---|---|---|---|---|
| interactive | `item-interactive-1` — Item as Link | `docs/references/kibo/upstream/packages/patterns/item/interactive/item-interactive-1.tsx:1-43` | `https://www.kibo-ui.com/patterns/item/interactive/item-interactive-1` | Two `Item asChild` anchors: a chevron internal-looking row and outlined external-looking row. Both URLs are `#`; replace them. The external demo does include `target="_blank"` and `rel="noopener noreferrer"` (lines 14-38). |
| interactive | `item-interactive-2` — Item in Dropdown | `docs/references/kibo/upstream/packages/patterns/item/interactive/item-interactive-2.tsx:1-70` | `https://www.kibo-ui.com/patterns/item/interactive/item-interactive-2` | Client dropdown trigger with three mapped people; each menu item contains compact avatar/title/email item. No selected value, `onSelect`, or persistence exists (lines 22-66). GitHub avatar URLs and masked people data are demo-only. Requires `DropdownMenu`, `Button`, `Avatar`, and Lucide chevron in addition to Item. |
| layout | `item-layout-1` — Item Sizes | `docs/references/kibo/upstream/packages/patterns/item/layout/item-layout-1.tsx:1-45` | `https://www.kibo-ui.com/patterns/item/layout/item-layout-1` | Contrasts default outlined item with title/description/action button against small slotted anchor with icon and chevron. Button has no action and anchor is `#` (lines 16-41). Requires Button and two Lucide icons. |
| layout | `item-layout-2` — Item Group | `docs/references/kibo/upstream/packages/patterns/item/layout/item-layout-2.tsx:1-65` | `https://www.kibo-ui.com/patterns/item/layout/item-layout-2` | Maps demo people into `ItemGroup`, inserts `ItemSeparator` between rows, and adds ghost icon buttons. The avatar URLs/data and invitation action are demo-only; buttons lack handlers (lines 18-61). Requires React `Fragment`, Avatar, Button, and Lucide Plus. |
| layout | `item-layout-3` — Item with Header | `docs/references/kibo/upstream/packages/patterns/item/layout/item-layout-3.tsx:1-55` | `https://www.kibo-ui.com/patterns/item/layout/item-layout-3` | A three-column `ItemGroup` grid; each outlined item has full-width image `ItemHeader` then title/description. Model array and `placehold.co` images are demo data/resources (lines 12-51). Image alt text is supplied from model name. |
| media | `item-media-1` — Item with Icon Media | `docs/references/kibo/upstream/packages/patterns/item/media/item-media-1.tsx:1-35` | `https://www.kibo-ui.com/patterns/item/media/item-media-1` | `ItemMedia variant="icon"` frames a ShieldAlert icon, with a small Review button. The button is presentation only—no review behavior (lines 16-31). Requires Button and Lucide icon. |
| media | `item-media-2` — Item with Avatar | `docs/references/kibo/upstream/packages/patterns/item/media/item-media-2.tsx:1-42` | `https://www.kibo-ui.com/patterns/item/media/item-media-2` | Avatar image/fallback plus outlined, round Plus action. The icon-only action does have `aria-label="Invite"` but no handler; GitHub avatar, identity, and last-seen text are demo data (lines 17-37). Requires Avatar, Button, Lucide Plus. |
| media | `item-media-3` — Item with Image Media | `docs/references/kibo/upstream/packages/patterns/item/media/item-media-3.tsx:1-71` | `https://www.kibo-ui.com/patterns/item/media/item-media-3` | Maps demo music to outlined anchor rows with image media, primary metadata, and a second fixed-width content column for duration. Anchors are `#`; song data and placeholder covers are demo-only (lines 12-67). Image has song-title alt text. |
| standard | `item-standard-1` — Basic Item | `docs/references/kibo/upstream/packages/patterns/item/standard/item-standard-1.tsx:1-30` | `https://www.kibo-ui.com/patterns/item/standard/item-standard-1` | One outlined row: title/description plus small outline action button. No button behavior is supplied (lines 14-26). Requires Button. |
| standard | `item-standard-2` — Item with Media and Icon | `docs/references/kibo/upstream/packages/patterns/item/standard/item-standard-2.tsx:1-30` | `https://www.kibo-ui.com/patterns/item/standard/item-standard-2` | Small outlined anchor row with BadgeCheck media, title, and chevron action. It is a link shell only (`href="#"`) (lines 14-26). Requires two Lucide icons. |

**Accessibility/source caveats.** The item primitive supplies focus-visible styling, but does not itself make a default item focusable (`item.tsx:33-72`). The group’s `role=list` is not paired by this primitive with `role=listitem` on children (`item.tsx:8-16`). Demo actions and placeholder anchors therefore must not be promoted as functional UI without real behavior and semantics.

---

## `kbd`

### Shared primitive and adaptation boundary

`Kbd` is a presentational `<kbd>` with `pointer-events-none`, default height/min-width, and optional SVG sizing; `KbdGroup` is also rendered as a `<kbd>` despite being typed with `div` props (`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/kbd.tsx:1-28`). No keyboard listener, shortcut registration, state management, or platform abstraction exists in the primitive.

Safe adaptation: use these components solely to display the shortcuts that the application actually implements. Add shortcut handling, scope/conflict management, discoverability, and platform selection separately. Do not interpret class-only “disabled,” “focus,” “hover,” or “pressed” examples as semantic or functional states.

| Collection | ID / title | Local source | Preview | Source-specific composition |
|---|---|---|---|---|
| arrow-keys | `kbd-arrow-keys-1` — Arrow Keys Cross Pattern | `docs/references/kibo/upstream/packages/patterns/kbd/arrow-keys/kbd-arrow-keys-1.tsx:1-18` | `https://www.kibo-ui.com/patterns/kbd/arrow-keys/kbd-arrow-keys-1` | Four Unicode arrows positioned in a 3×3 CSS grid. |
| arrow-keys | `kbd-arrow-keys-2` — Arrow Keys Horizontal | `docs/references/kibo/upstream/packages/patterns/kbd/arrow-keys/kbd-arrow-keys-2.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/arrow-keys/kbd-arrow-keys-2` | Left/right arrows in `KbdGroup`. |
| arrow-keys | `kbd-arrow-keys-3` — WASD Gaming Keys | `docs/references/kibo/upstream/packages/patterns/kbd/arrow-keys/kbd-arrow-keys-3.tsx:1-18` | `https://www.kibo-ui.com/patterns/kbd/arrow-keys/kbd-arrow-keys-3` | W/A/S/D laid out as a 3×3 grid. |
| arrow-keys | `kbd-arrow-keys-4` — Vim Navigation Keys | `docs/references/kibo/upstream/packages/patterns/kbd/arrow-keys/kbd-arrow-keys-4.tsx:1-16` | `https://www.kibo-ui.com/patterns/kbd/arrow-keys/kbd-arrow-keys-4` | H/J/K/L in one four-column grid row. |
| function-keys | `kbd-function-keys-1` — F1 Help Key | `docs/references/kibo/upstream/packages/patterns/kbd/function-keys/kbd-function-keys-1.tsx:1-11` | `https://www.kibo-ui.com/patterns/kbd/function-keys/kbd-function-keys-1` | One static `F1` key. |
| function-keys | `kbd-function-keys-2` — F12 DevTools Key | `docs/references/kibo/upstream/packages/patterns/kbd/function-keys/kbd-function-keys-2.tsx:1-11` | `https://www.kibo-ui.com/patterns/kbd/function-keys/kbd-function-keys-2` | One static `F12` key. |
| function-keys | `kbd-function-keys-3` — Function Keys Row | `docs/references/kibo/upstream/packages/patterns/kbd/function-keys/kbd-function-keys-3.tsx:1-15` | `https://www.kibo-ui.com/patterns/kbd/function-keys/kbd-function-keys-3` | Creates 12 static labels with `Array.from`; this is display generation, not bindings. |
| function-keys | `kbd-function-keys-4` — Special Keys | `docs/references/kibo/upstream/packages/patterns/kbd/function-keys/kbd-function-keys-4.tsx:1-15` | `https://www.kibo-ui.com/patterns/kbd/function-keys/kbd-function-keys-4` | Flex row of Esc, Tab, Enter. |
| function-keys | `kbd-function-keys-5` — Modifier Keys | `docs/references/kibo/upstream/packages/patterns/kbd/function-keys/kbd-function-keys-5.tsx:1-15` | `https://www.kibo-ui.com/patterns/kbd/function-keys/kbd-function-keys-5` | Flex row of Shift, Ctrl, Alt. |
| function-keys | `kbd-function-keys-6` — Editing Keys | `docs/references/kibo/upstream/packages/patterns/kbd/function-keys/kbd-function-keys-6.tsx:1-16` | `https://www.kibo-ui.com/patterns/kbd/function-keys/kbd-function-keys-6` | Flex row of Home, End, PgUp, PgDn. |
| platform-specific | `kbd-platform-specific-1` — Mac Command Symbol | `docs/references/kibo/upstream/packages/patterns/kbd/platform-specific/kbd-platform-specific-1.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/platform-specific/kbd-platform-specific-1` | Static `⌘ K` group. |
| platform-specific | `kbd-platform-specific-2` — Mac Option Symbol | `docs/references/kibo/upstream/packages/patterns/kbd/platform-specific/kbd-platform-specific-2.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/platform-specific/kbd-platform-specific-2` | Static `⌥ Tab` group. |
| platform-specific | `kbd-platform-specific-3` — Windows Key | `docs/references/kibo/upstream/packages/patterns/kbd/platform-specific/kbd-platform-specific-3.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/platform-specific/kbd-platform-specific-3` | Static `Win R` group. |
| platform-specific | `kbd-platform-specific-4` — Platform-Aware Shortcut | `docs/references/kibo/upstream/packages/patterns/kbd/platform-specific/kbd-platform-specific-4.tsx:1-22` | `https://www.kibo-ui.com/patterns/kbd/platform-specific/kbd-platform-specific-4` | Client component chooses `⌘` or `Ctrl` from `navigator.platform`; it does not install the shortcut. The render-time browser check can produce different server/client text on Mac, so validate hydration before adopting. |
| platform-specific | `kbd-platform-specific-5` — Mac Control Symbol | `docs/references/kibo/upstream/packages/patterns/kbd/platform-specific/kbd-platform-specific-5.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/platform-specific/kbd-platform-specific-5` | Static `⌃ Space` group. |
| pressed-state | `kbd-pressed-state-1` — Active State | `docs/references/kibo/upstream/packages/patterns/kbd/pressed-state/kbd-pressed-state-1.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/pressed-state/kbd-pressed-state-1` | Primary-color override on `⌘` only; no active state logic. |
| pressed-state | `kbd-pressed-state-2` — Disabled State | `docs/references/kibo/upstream/packages/patterns/kbd/pressed-state/kbd-pressed-state-2.tsx:1-11` | `https://www.kibo-ui.com/patterns/kbd/pressed-state/kbd-pressed-state-2` | `cursor-not-allowed opacity-50` styling only; `<kbd>` has no disabled attribute/behavior. |
| pressed-state | `kbd-pressed-state-3` — Focus State | `docs/references/kibo/upstream/packages/patterns/kbd/pressed-state/kbd-pressed-state-3.tsx:1-16` | `https://www.kibo-ui.com/patterns/kbd/pressed-state/kbd-pressed-state-3` | Permanent ring classes on `⌘`; not focus management. |
| pressed-state | `kbd-pressed-state-4` — Pressed Down | `docs/references/kibo/upstream/packages/patterns/kbd/pressed-state/kbd-pressed-state-4.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/pressed-state/kbd-pressed-state-4` | Static translation/shadow override on `⌘`; not key-down interaction. |
| pressed-state | `kbd-pressed-state-5` — Hover State | `docs/references/kibo/upstream/packages/patterns/kbd/pressed-state/kbd-pressed-state-5.tsx:1-18` | `https://www.kibo-ui.com/patterns/kbd/pressed-state/kbd-pressed-state-5` | Adds cursor and hover color classes, but base `Kbd` disables pointer events; no activation handler exists. |
| sequence | `kbd-sequence-1` — Key Sequence with Then | `docs/references/kibo/upstream/packages/patterns/kbd/sequence/kbd-sequence-1.tsx:1-18` | `https://www.kibo-ui.com/patterns/kbd/sequence/kbd-sequence-1` | `Ctrl K`, literal “then,” then `B`. |
| sequence | `kbd-sequence-2` — Key Sequence with Arrow | `docs/references/kibo/upstream/packages/patterns/kbd/sequence/kbd-sequence-2.tsx:1-15` | `https://www.kibo-ui.com/patterns/kbd/sequence/kbd-sequence-2` | `G → G` with plain-text arrow separator. |
| sequence | `kbd-sequence-3` — Multi-Step Sequence | `docs/references/kibo/upstream/packages/patterns/kbd/sequence/kbd-sequence-3.tsx:1-21` | `https://www.kibo-ui.com/patterns/kbd/sequence/kbd-sequence-3` | Two grouped chords, `Ctrl K` then `Ctrl S`. |
| sequence | `kbd-sequence-4` — Vim Command Sequence | `docs/references/kibo/upstream/packages/patterns/kbd/sequence/kbd-sequence-4.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/sequence/kbd-sequence-4` | Adjacent `:`, `W`, `Q` keys. |
| shortcut | `kbd-shortcut-1` — Command Palette Shortcut | `docs/references/kibo/upstream/packages/patterns/kbd/shortcut/kbd-shortcut-1.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/shortcut/kbd-shortcut-1` | Static `⌘ K` display. |
| shortcut | `kbd-shortcut-2` — Copy Shortcut | `docs/references/kibo/upstream/packages/patterns/kbd/shortcut/kbd-shortcut-2.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/shortcut/kbd-shortcut-2` | Static `Ctrl C` display. |
| shortcut | `kbd-shortcut-3` — Paste Shortcut | `docs/references/kibo/upstream/packages/patterns/kbd/shortcut/kbd-shortcut-3.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/shortcut/kbd-shortcut-3` | Static `Ctrl V` display. |
| shortcut | `kbd-shortcut-4` — Complex Shortcut | `docs/references/kibo/upstream/packages/patterns/kbd/shortcut/kbd-shortcut-4.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/shortcut/kbd-shortcut-4` | Static `Ctrl Shift P` display. |
| shortcut | `kbd-shortcut-5` — Save Shortcut | `docs/references/kibo/upstream/packages/patterns/kbd/shortcut/kbd-shortcut-5.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/shortcut/kbd-shortcut-5` | Static `⌘ S` display. |
| sizes | `kbd-sizes-1` — Small Kbd | `docs/references/kibo/upstream/packages/patterns/kbd/sizes/kbd-sizes-1.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/sizes/kbd-sizes-1` | Overrides both keys to 4-unit height/min-width and 10px text. |
| sizes | `kbd-sizes-2` — Default Kbd | `docs/references/kibo/upstream/packages/patterns/kbd/sizes/kbd-sizes-2.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/sizes/kbd-sizes-2` | Baseline `⌘ K` group. |
| sizes | `kbd-sizes-3` — Large Kbd | `docs/references/kibo/upstream/packages/patterns/kbd/sizes/kbd-sizes-3.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/sizes/kbd-sizes-3` | Overrides both keys to `h-8 min-w-8 px-2 text-base`. |
| sizes | `kbd-sizes-4` — Inline with Text | `docs/references/kibo/upstream/packages/patterns/kbd/sizes/kbd-sizes-4.tsx:1-12` | `https://www.kibo-ui.com/patterns/kbd/sizes/kbd-sizes-4` | Inline sentence with `⌘ K` labels; no command-palette implementation. |
| sizes | `kbd-sizes-5` — Extra Large Kbd | `docs/references/kibo/upstream/packages/patterns/kbd/sizes/kbd-sizes-5.tsx:1-14` | `https://www.kibo-ui.com/patterns/kbd/sizes/kbd-sizes-5` | Overrides both keys to `h-12 min-w-12 px-3 text-2xl`. |
| with-icons | `kbd-with-icons-1` — Enter with Icon | `docs/references/kibo/upstream/packages/patterns/kbd/with-icons/kbd-with-icons-1.tsx:1-17` | `https://www.kibo-ui.com/patterns/kbd/with-icons/kbd-with-icons-1` | Lucide `CornerDownLeft` plus “Enter.” |
| with-icons | `kbd-with-icons-2` — Delete with Icon | `docs/references/kibo/upstream/packages/patterns/kbd/with-icons/kbd-with-icons-2.tsx:1-17` | `https://www.kibo-ui.com/patterns/kbd/with-icons/kbd-with-icons-2` | Lucide `Delete` plus “Del.” |
| with-icons | `kbd-with-icons-3` — Arrow Keys with Icons | `docs/references/kibo/upstream/packages/patterns/kbd/with-icons/kbd-with-icons-3.tsx:1-25` | `https://www.kibo-ui.com/patterns/kbd/with-icons/kbd-with-icons-3` | Four Lucide directional-arrow icons in a group. |
| with-icons | `kbd-with-icons-4` — Command with Icon | `docs/references/kibo/upstream/packages/patterns/kbd/with-icons/kbd-with-icons-4.tsx:1-17` | `https://www.kibo-ui.com/patterns/kbd/with-icons/kbd-with-icons-4` | Lucide `Command` icon plus text `K`. |
| with-icons | `kbd-with-icons-5` — Unicode Symbols | `docs/references/kibo/upstream/packages/patterns/kbd/with-icons/kbd-with-icons-5.tsx:1-15` | `https://www.kibo-ui.com/patterns/kbd/with-icons/kbd-with-icons-5` | Plain Unicode-plus-text labels for Enter/Delete/Tab; no icon dependency. |

All Kbd patterns import only `Kbd`/`KbdGroup` except the four Lucide-icon patterns (`kbd-with-icons-1` through `-4`). All key labels and shortcut meanings are illustrative static content, except the single `navigator.platform` conditional above.

---

## `label`

### Shared primitive and adaptation boundary

The client `Label` delegates to Radix `Label.Root`, accepts its props (including `htmlFor`), and provides peer/group disabled styling (`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/label.tsx:1-24`). Required primitive imports are React, `radix-ui` Label, and local `cn` (lines 3-6).

Safe adaptation: bind every actual field label with `htmlFor`/matching control `id`, set `required` on the actual form control as applicable, and connect validation/help text with the appropriate ARIA semantics. The demos are label-only snippets: they do not include inputs, validation, live character counts, or form state.

| Collection | ID / title | Local source | Preview | Source-specific composition / demo gap |
|---|---|---|---|---|
| standard | `label-standard-1` — Required Label | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-1.tsx:1-11` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-1` | “Email” plus destructive `*`; no `htmlFor`, input, or `required` attribute (lines 5-9). |
| standard | `label-standard-2` — Label with Description | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-2.tsx:1-14` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-2` | Stacks “Username” and muted explanatory paragraph. The description is not associated with an input because none is rendered (lines 5-12). |
| standard | `label-standard-3` — Label with Tooltip | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-3.tsx:1-26` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-3` | “API Key” plus Info SVG used as a tooltip trigger. Requires Lucide and Tooltip/Provider/Trigger/Content. The source supplies no accessible name or keyboard-focusable button for the icon; review/replace the trigger before production. |
| standard | `label-standard-4` — Label with Badge | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-4.tsx:1-15` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-4` | “Advanced Settings” plus secondary “Beta” Badge. Requires Badge; it is status presentation only. |
| standard | `label-standard-5` — Label with Optional Indicator | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-5.tsx:1-12` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-5` | “Phone Number” plus muted “(optional)” text; no associated field. |
| standard | `label-standard-6` — Label with Character Count | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-6.tsx:1-12` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-6` | Flex header with `htmlFor="bio"` and static `0/500`; supply the matching textarea/input and dynamic count. |
| standard | `label-standard-7` — Error Label | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-7.tsx:1-12` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-7` | Destructive-colored password label with inline weak-password text. This does not mark a field invalid or associate error text (`aria-describedby` is absent). |
| standard | `label-standard-8` — Section Label | `docs/references/kibo/upstream/packages/patterns/label/standard/label-standard-8.tsx:1-9` | `https://www.kibo-ui.com/patterns/label/standard/label-standard-8` | Large semibold “Personal Information” label styling only. Prefer a structural heading if it labels a section rather than a control. |

The tooltip dependency uses Radix tooltip primitives and portals content (`docs/references/kibo/upstream/packages/shadcn-ui/components/ui/tooltip.tsx:1-64`); that source establishes composition, not validation of keyboard or screen-reader behavior in the demo.

---

## Coverage and missing inputs

- **Covered:** 10/10 `item` patterns across interactive, layout, media, and standard; 39/39 `kbd` patterns across arrow-keys, function-keys, platform-specific, pressed-state, sequence, shortcut, sizes, and with-icons; 8/8 `label` standard patterns. **Total: 57/57.**
- **Source dependencies inspected:** the three assigned primitives plus Item’s Separator dependency and the concrete DropdownMenu, Avatar, Button, Badge, and Tooltip dependencies used by assigned examples.
- **Not available / not claimed:** no browser-rendered preview inspection, interaction testing, assistive-technology testing, dependency installation, or verification that the project currently has the upstream aliases/primitives. Application-specific routes, data contracts, shortcut requirements, form validation rules, and action outcomes remain unspecified.
