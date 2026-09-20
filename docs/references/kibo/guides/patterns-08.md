# Patterns: drawer, dropdown-menu, empty

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

This is a source-reading inventory of the three assigned pattern families only, from the passive Kibo snapshot at upstream revision `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in [`docs/references/kibo/metadata/manifest.json`](../metadata/manifest.json). The snapshot is reference data rather than a runnable dependency ([`docs/references/kibo/README.md`](../README.md)). IDs, titles, local paths, and website-preview routes below come from the bounded family catalogs: [`catalog/patterns/drawer.md`](../catalog/patterns/drawer.md), [`dropdown-menu.md`](../catalog/patterns/dropdown-menu.md), and [`empty.md`](../catalog/patterns/empty.md). Preview URLs are navigation metadata, **not browser or visual validation**.

All claims about composition and state below come from the exact TSX sources cited in each row. No upstream source was executed, and no claim of rendered, keyboard, screen-reader, or browser validation is made.

## Shared implementation boundary

| Family | Required base primitive | What the mirrored primitive actually supplies | Adaptation boundary |
|---|---|---|---|
| Drawer | `@/components/ui/drawer` plus `Button`; the primitive wraps Vaul. | `DrawerContent` portals a Vaul overlay/content; styling responds to Vaul direction. Top/bottom content has an 80vh maximum; left/right is `w-3/4` and `sm:max-w-sm`; only bottom gets the visible drag handle. [`packages/shadcn-ui/components/ui/drawer.tsx`](../upstream/packages/shadcn-ui/components/ui/drawer.tsx#L1-L135) | Retain the `Drawer`/trigger/content relationship and use the project’s installed equivalent. Direction, controlled open state, snap points, and drag exclusions are primitives/API choices, not application workflows. Wire submit, navigation, persistence, and close/error policy to product behavior. |
| Dropdown menu | `@/components/ui/dropdown-menu` plus `Button`; the primitive wraps Radix UI. | Content portals with default `sideOffset={4}`; items support a destructive visual variant, checkbox/radio indicators, groups, labels, separators, shortcuts, and submenus. [`packages/shadcn-ui/components/ui/dropdown-menu.tsx`](../upstream/packages/shadcn-ui/components/ui/dropdown-menu.tsx#L1-L245) | Preserve Root/Trigger/Content and nested Sub structure when needed. Displayed shortcut glyphs do not register shortcuts. Replace demo `useState` with application state and attach selection/navigation/command handlers. |
| Empty | `@/components/ui/empty`; optional `Button`/`Input`. | `Empty` is a dashed, centered flex container; `EmptyHeader`, `Media`, `Title`, `Description`, and `Content` are layout/styling wrappers. `EmptyMedia` has `default` and boxed `icon` variants. [`packages/shadcn-ui/components/ui/empty.tsx`](../upstream/packages/shadcn-ui/components/ui/empty.tsx#L1-L104) | Treat every empty state as presentational until the surrounding data/loading/error state selects it. Substitute real resource terminology, counts, routes, and actions; use actual forms/links where the product needs them. |

`lucide-react` icons are a common display dependency. Imports using `@/components/ui/*` are upstream demo aliases, not imports shown to exist in this application; the family-specific extra primitives are called out below.

## Drawer

All drawer examples are client components. Except where noted, each imports `Button` and the listed members of `@/components/ui/drawer`; all default to a bottom Vaul drawer unless `direction` is explicitly supplied. Button labels and body copy are static demo content; none of the submit/action buttons has an application handler.

### bottom

Preview base: `https://www.kibo-ui.com/patterns/drawer/bottom/`

| ID — title | Local source; preview | Source-observed distinguishing composition / interaction | Extra required imports or demo limitation |
|---|---|---|---|
| `drawer-bottom-1` — Simple Bottom Drawer | [`drawer-bottom-1.tsx:1-44`](../upstream/packages/patterns/drawer/bottom/drawer-bottom-1.tsx#L1-L44); [preview](https://www.kibo-ui.com/patterns/drawer/bottom/drawer-bottom-1) | Header/title/description, one body paragraph, footer Submit and `DrawerClose`-wrapped Cancel. | Static content; Submit is inert. |
| `drawer-bottom-2` — Bottom Drawer with Form | [`drawer-bottom-2.tsx:1-55`](../upstream/packages/patterns/drawer/bottom/drawer-bottom-2.tsx#L1-L55); [preview](https://www.kibo-ui.com/patterns/drawer/bottom/drawer-bottom-2) | Three labeled name/email/phone inputs above Add Contact/Cancel footer. | Also imports `Input`, `Label`; no form element, values, validation, submit, or persistence. |
| `drawer-bottom-3` — Scrollable Bottom Drawer | [`drawer-bottom-3.tsx:1-68`](../upstream/packages/patterns/drawer/bottom/drawer-bottom-3.tsx#L1-L68); [preview](https://www.kibo-ui.com/patterns/drawer/bottom/drawer-bottom-3) | Uses `max-h-[60vh] overflow-y-auto` body containing six placeholder paragraphs; no footer. | Lorem ipsum is demo-only. |
| `drawer-bottom-4` — Bottom Drawer with Snap Points | [`drawer-bottom-4.tsx:1-49`](../upstream/packages/patterns/drawer/bottom/drawer-bottom-4.tsx#L1-L49); [preview](https://www.kibo-ui.com/patterns/drawer/bottom/drawer-bottom-4) | Sets `snapPoints={['148px', '355px', 1]}` and describes drag-to-snap; close footer. | Snap dimensions are example-specific; verify desired viewport behavior in the consuming app. |
| `drawer-bottom-5` — Nested Bottom Drawers | [`drawer-bottom-5.tsx:1-72`](../upstream/packages/patterns/drawer/bottom/drawer-bottom-5.tsx#L1-L72); [preview](https://www.kibo-ui.com/patterns/drawer/bottom/drawer-bottom-5) | Parent is controlled with local `open`/`onOpenChange`; its content nests a second independent Drawer and close buttons. | Imports React `useState`; state only demonstrates open control—no multi-step workflow or data transfer. |
| `drawer-bottom-6` — Bottom Drawer No Scale Background | [`drawer-bottom-6.tsx:1-40`](../upstream/packages/patterns/drawer/bottom/drawer-bottom-6.tsx#L1-L40); [preview](https://www.kibo-ui.com/patterns/drawer/bottom/drawer-bottom-6) | Sets `shouldScaleBackground={false}`; otherwise header and static explanation only. | This is a primitive configuration example, not a product preference. |
| `drawer-bottom-7` — Bottom Drawer Event Details | [`drawer-bottom-7.tsx:1-69`](../upstream/packages/patterns/drawer/bottom/drawer-bottom-7.tsx#L1-L69); [preview](https://www.kibo-ui.com/patterns/drawer/bottom/drawer-bottom-7) | Event header, two badges, icon/value metadata, description, Register/Maybe Later footer. | Also imports `Badge` and `Calendar`/`MapPin`/`Users`; event/date/address/attendance are hard-coded and Register is inert. |

### left

Preview base: `https://www.kibo-ui.com/patterns/drawer/left/`

| ID — title | Local source; preview | Source-observed distinguishing composition / interaction | Extra required imports or demo limitation |
|---|---|---|---|
| `drawer-left-1` — Simple Left Drawer | [`drawer-left-1.tsx:1-46`](../upstream/packages/patterns/drawer/left/drawer-left-1.tsx#L1-L46); [preview](https://www.kibo-ui.com/patterns/drawer/left/drawer-left-1) | `direction="left"`, icon-only Menu trigger, conventional header/body/close footer. | Imports Lucide `Menu`; icon-only trigger has no source-provided accessible name. |
| `drawer-left-2` — Left Drawer Navigation Menu | [`drawer-left-2.tsx:1-53`](../upstream/packages/patterns/drawer/left/drawer-left-2.tsx#L1-L53); [preview](https://www.kibo-ui.com/patterns/drawer/left/drawer-left-2) | `nav` contains five full-width ghost buttons with icons; intentionally omits header/footer. | Lucide navigation icons; buttons have no routes or handlers. Icon-only trigger is unlabeled. |
| `drawer-left-3` — Left Drawer with Nested Items | [`drawer-left-3.tsx:1-123`](../upstream/packages/patterns/drawer/left/drawer-left-3.tsx#L1-L123); [preview](https://www.kibo-ui.com/patterns/drawer/left/drawer-left-3) | Local string-array state toggles Products and Orders child button groups and rotates chevrons; Dashboard/Analytics remain flat. | `useState`, `ChevronRight`, `Menu`; hierarchy and labels are static, leaf buttons do nothing, and no tree semantics are added by this example. |
| `drawer-left-4` — Left Drawer with Search | [`drawer-left-4.tsx:1-58`](../upstream/packages/patterns/drawer/left/drawer-left-4.tsx#L1-L58); [preview](https://www.kibo-ui.com/patterns/drawer/left/drawer-left-4) | Search-decorated input precedes Main Menu and Settings sections of ghost-button links. | `Input` and Lucide icons; query is uncontrolled and unused, buttons are inert, icon-only trigger is unlabeled. |
| `drawer-left-5` — Left Drawer File Explorer | [`drawer-left-5.tsx:1-131`](../upstream/packages/patterns/drawer/left/drawer-left-5.tsx#L1-L131); [preview](https://www.kibo-ui.com/patterns/drawer/left/drawer-left-5) | Local state initially expands Projects; click toggles root/Website/App and conditionally shows hard-coded files. | `useState`, `ChevronRight`, `Folder`, `File`, `Menu`; no filesystem data, selection, navigation, loading/error state, or tree accessibility semantics. |

### right

Preview base: `https://www.kibo-ui.com/patterns/drawer/right/`

| ID — title | Local source; preview | Source-observed distinguishing composition / interaction | Extra required imports or demo limitation |
|---|---|---|---|
| `drawer-right-1` — Simple Right Drawer | [`drawer-right-1.tsx:1-45`](../upstream/packages/patterns/drawer/right/drawer-right-1.tsx#L1-L45); [preview](https://www.kibo-ui.com/patterns/drawer/right/drawer-right-1) | `direction="right"`; header/body with Confirm plus `DrawerClose` Cancel footer. | Confirm is inert. |
| `drawer-right-2` — Right Drawer Filter Panel | [`drawer-right-2.tsx:1-107`](../upstream/packages/patterns/drawer/right/drawer-right-2.tsx#L1-L107); [preview](https://www.kibo-ui.com/patterns/drawer/right/drawer-right-2) | Scrollable categories/rating checkboxes and price slider; slider has `data-vaul-no-drag`; Apply/Reset footer. | `Checkbox`, `Label`, `Slider`; default slider/checkbox values are not collected, applied, or reset—Reset merely closes via `DrawerClose`. |
| `drawer-right-3` — Right Drawer Settings Panel | [`drawer-right-3.tsx:1-84`](../upstream/packages/patterns/drawer/right/drawer-right-3.tsx#L1-L84); [preview](https://www.kibo-ui.com/patterns/drawer/right/drawer-right-3) | Notification and Privacy sections use labeled switches, with selected `defaultChecked` values. | `Label`, `Switch`, Lucide `Settings`; uncontrolled switches are not saved; icon-only trigger has no source-provided accessible name. |
| `drawer-right-4` — Right Drawer Shopping Cart | [`drawer-right-4.tsx:1-98`](../upstream/packages/patterns/drawer/right/drawer-right-4.tsx#L1-L98); [preview](https://www.kibo-ui.com/patterns/drawer/right/drawer-right-4) | Three static cart rows, placeholder image blocks, trash icon buttons, hard-coded subtotal/shipping/total, checkout/footer. | Lucide `ShoppingCart`/`Trash2`; no cart model, removal, recalculation, stock/price logic, checkout, or label for trash icon buttons. |
| `drawer-right-5` — Right Drawer Notifications | [`drawer-right-5.tsx:1-108`](../upstream/packages/patterns/drawer/right/drawer-right-5.tsx#L1-L108); [preview](https://www.kibo-ui.com/patterns/drawer/right/drawer-right-5) | Bell trigger with numeric badge; five styled static rows distinguish unread dots; bottom “Mark all as read” is also a DrawerClose. | `Badge`, Lucide `Bell`; data/read state and row activation are absent. Trigger is icon-only and lacks an explicit accessible name. |

### top

Preview base: `https://www.kibo-ui.com/patterns/drawer/top/`

| ID — title | Local source; preview | Source-observed distinguishing composition / interaction | Extra required imports or demo limitation |
|---|---|---|---|
| `drawer-top-1` — Simple Top Drawer | [`drawer-top-1.tsx:1-44`](../upstream/packages/patterns/drawer/top/drawer-top-1.tsx#L1-L44); [preview](https://www.kibo-ui.com/patterns/drawer/top/drawer-top-1) | `direction="top"`, full header/body and close footer. | Static content only. |
| `drawer-top-2` — Top Drawer Search Bar | [`drawer-top-2.tsx:1-62`](../upstream/packages/patterns/drawer/top/drawer-top-2.tsx#L1-L62); [preview](https://www.kibo-ui.com/patterns/drawer/top/drawer-top-2) | Search input, static recent searches, and quick-access buttons replace header/footer. | `Input` and Lucide icons; query and options do not perform search/navigation. |
| `drawer-top-3` — Top Drawer Notification Banner | [`drawer-top-3.tsx:1-50`](../upstream/packages/patterns/drawer/top/drawer-top-3.tsx#L1-L50); [preview](https://www.kibo-ui.com/patterns/drawer/top/drawer-top-3) | Blue alert-style banner with Update Now and X `DrawerClose`, without `DrawerTitle`/`DrawerDescription`. | Lucide `AlertCircle`/`X`; update is inert and close icon button has no explicit accessible name. |
| `drawer-top-4` — Top Drawer Quick Actions | [`drawer-top-4.tsx:1-63`](../upstream/packages/patterns/drawer/top/drawer-top-4.tsx#L1-L63); [preview](https://www.kibo-ui.com/patterns/drawer/top/drawer-top-4) | Header followed by a six-item, three-column grid of tall outline action buttons. | Lucide icons; all labels/actions are hard-coded and inert. |
| `drawer-top-5` — Top Drawer Command Bar | [`drawer-top-5.tsx:1-59`](../upstream/packages/patterns/drawer/top/drawer-top-5.tsx#L1-L59); [preview](https://www.kibo-ui.com/patterns/drawer/top/drawer-top-5) | Command-decorated input plus four ghost command rows with badge-rendered shortcut text. | `Input`, `Badge`, Lucide `Command`; no filtering, command dispatch, global shortcut registration, or focus management beyond underlying primitive behavior. |

**Drawer adaptation/accessibility note.** The source uses `DrawerTitle`/`DrawerDescription` in many, but not all, variants (notably navigation/search/command and the notification banner). Do not infer a complete dialog labelling strategy from the samples. Add an accessible name to icon-only triggers and destructive/remove controls, ensure form labels/validation/submit errors match real operations, and validate focus/escape/drag/nested-drawer behavior in the target app. Those validations were not performed here.

## Dropdown menu

All variants use `DropdownMenu`, `DropdownMenuTrigger asChild`, and `DropdownMenuContent`; their open/close, focus, and item mechanics are delegated to the wrapped Radix primitive, not reimplemented in the examples. Except where local state is stated, menu items only render labels/icons and do not have `onSelect`, navigation, or command callbacks.

### actions

Preview base: `https://www.kibo-ui.com/patterns/dropdown-menu/actions/`

| ID — title | Local source; preview | Source-observed composition | Demo-only / missing behavior |
|---|---|---|---|
| `dropdown-menu-actions-1` — File Actions Dropdown | [`dropdown-menu-actions-1.tsx:1-63`](../upstream/packages/patterns/dropdown-menu/actions/dropdown-menu-actions-1.tsx#L1-L63); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/actions/dropdown-menu-actions-1) | End-aligned `w-48` ellipsis menu: view/download/share/duplicate, separator, archive/destructive delete; Duplicate/Delete display shortcuts. | Lucide icons; no file identity or action handlers; icon-only trigger is unlabeled. |
| `dropdown-menu-actions-2` — Table Row Actions | [`dropdown-menu-actions-2.tsx:1-61`](../upstream/packages/patterns/dropdown-menu/actions/dropdown-menu-actions-2.tsx#L1-L61); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/actions/dropdown-menu-actions-2) | Compact vertical-ellipsis row menu separates edit/duplicate, favorite/report, archive/delete. | No row data or callbacks; icon-only trigger is unlabeled. |
| `dropdown-menu-actions-3` — Card Actions with Nested Share | [`dropdown-menu-actions-3.tsx:1-83`](../upstream/packages/patterns/dropdown-menu/actions/dropdown-menu-actions-3.tsx#L1-L83); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/actions/dropdown-menu-actions-3) | Card ellipsis menu adds `DropdownMenuSub` Share with Email/Twitter/Facebook/LinkedIn, between other actions. | No share URLs or card action handlers; icon-only trigger is unlabeled. |
| `dropdown-menu-actions-4` — Batch Actions Dropdown | [`dropdown-menu-actions-4.tsx:1-68`](../upstream/packages/patterns/dropdown-menu/actions/dropdown-menu-actions-4.tsx#L1-L68); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/actions/dropdown-menu-actions-4) | Text trigger; label says “3 items selected”; grouped completion/tag/export/archive/delete actions and displayed shortcuts. | Selection count and batch effects are hard-coded; no confirmation/progress/error handling. |
| `dropdown-menu-actions-5` — Quick Actions Menu | [`dropdown-menu-actions-5.tsx:1-78`](../upstream/packages/patterns/dropdown-menu/actions/dropdown-menu-actions-5.tsx#L1-L78); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/actions/dropdown-menu-actions-5) | Button-triggered `w-56` menu uses labels/groups/separators for create/search/filter, import/export, refresh. | Shortcut badges are visual only; no commands execute. |

### editor

Preview base: `https://www.kibo-ui.com/patterns/dropdown-menu/editor/`

| ID — title | Local source; preview | Source-observed composition | Demo-only / missing behavior |
|---|---|---|---|
| `dropdown-menu-editor-1` — Text Formatting Dropdown | [`dropdown-menu-editor-1.tsx:1-61`](../upstream/packages/patterns/dropdown-menu/editor/dropdown-menu-editor-1.tsx#L1-L61); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/editor/dropdown-menu-editor-1) | Icon trigger and `w-48` formatting items, separator before Code, with shortcut display. | No editor selection or formatting command; icon-only trigger is unlabeled. |
| `dropdown-menu-editor-2` — Block Type Selector | [`dropdown-menu-editor-2.tsx:1-81`](../upstream/packages/patterns/dropdown-menu/editor/dropdown-menu-editor-2.tsx#L1-L81); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/editor/dropdown-menu-editor-2) | Insert Block trigger; labels/separators categorize Basic Blocks, Lists, Media. | No document model/insertion behavior. |
| `dropdown-menu-editor-3` — Insert Options Dropdown | [`dropdown-menu-editor-3.tsx:1-58`](../upstream/packages/patterns/dropdown-menu/editor/dropdown-menu-editor-3.tsx#L1-L58); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/editor/dropdown-menu-editor-3) | Plus icon trigger; media/link, table/code, and file options separated; some display shortcuts. | No picker/upload/link/table insertion; icon-only trigger is unlabeled. |
| `dropdown-menu-editor-4` — Heading Selector | [`dropdown-menu-editor-4.tsx:1-53`](../upstream/packages/patterns/dropdown-menu/editor/dropdown-menu-editor-4.tsx#L1-L53); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/editor/dropdown-menu-editor-4) | Local `heading` state drives trigger text and a six-value radio group, whose labels use progressively smaller bold text. | `useState` changes display only; does not alter editor block formatting. |
| `dropdown-menu-editor-5` — Alignment Options | [`dropdown-menu-editor-5.tsx:1-65`](../upstream/packages/patterns/dropdown-menu/editor/dropdown-menu-editor-5.tsx#L1-L65); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/editor/dropdown-menu-editor-5) | Local alignment radio state controls the icon trigger; left/center/right precede a separator and justify. | `useState` is display-only; no editor style change. Icon-only trigger is unlabeled. |

### profile

Preview base: `https://www.kibo-ui.com/patterns/dropdown-menu/profile/`

| ID — title | Local source; preview | Source-observed composition | Demo-only / missing behavior |
|---|---|---|---|
| `dropdown-menu-profile-1` — Profile Dropdown with Avatar | [`dropdown-menu-profile-1.tsx:1-61`](../upstream/packages/patterns/dropdown-menu/profile/dropdown-menu-profile-1.tsx#L1-L61); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/profile/dropdown-menu-profile-1) | Round avatar trigger; end-aligned `w-56` name/email label, Profile/Settings/Help, destructive logout. | Requires `Avatar`; image is external `github.com/haydenbleasel.png`, and identity/actions are sample data. |
| `dropdown-menu-profile-2` — Profile Dropdown with Status | [`dropdown-menu-profile-2.tsx:1-75`](../upstream/packages/patterns/dropdown-menu/profile/dropdown-menu-profile-2.tsx#L1-L75); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/profile/dropdown-menu-profile-2) | Avatar trigger adds green status dot; wider menu repeats larger avatar and Pro badge before profile/billing/settings/logout. | Requires `Avatar`/`Badge`; remote image/status/subscription/actions are static. |
| `dropdown-menu-profile-3` — Account Settings Dropdown | [`dropdown-menu-profile-3.tsx:1-99`](../upstream/packages/patterns/dropdown-menu/profile/dropdown-menu-profile-3.tsx#L1-L99); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/profile/dropdown-menu-profile-3) | Text-and-avatar trigger, `w-64` identity label, labelled Account and Billing groups, logout. | Requires `Avatar`; remote image and all account/billing routes/actions are absent. |
| `dropdown-menu-profile-4` — Multi-Account Switcher | [`dropdown-menu-profile-4.tsx:1-87`](../upstream/packages/patterns/dropdown-menu/profile/dropdown-menu-profile-4.tsx#L1-L87); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/profile/dropdown-menu-profile-4) | Fixed-width account trigger; start-aligned menu lists three account rows, visual check on Personal, then Add Account. | Requires `Avatar`; accounts/current selection/add flow have no state or handler; first avatar uses remote image. |
| `dropdown-menu-profile-5` — Profile with Preferences | [`dropdown-menu-profile-5.tsx:1-85`](../upstream/packages/patterns/dropdown-menu/profile/dropdown-menu-profile-5.tsx#L1-L85); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/profile/dropdown-menu-profile-5) | Avatar menu places Profile/Settings before three controlled checkbox preferences and Logout. | Requires `Avatar`; `useState` only persists during component lifetime, not to a profile/preferences service; image and person are sample data. |

### settings

Preview base: `https://www.kibo-ui.com/patterns/dropdown-menu/settings/`

| ID — title | Local source; preview | Source-observed composition | Demo-only / missing behavior |
|---|---|---|---|
| `dropdown-menu-settings-1` — Theme Selector | [`dropdown-menu-settings-1.tsx:1-50`](../upstream/packages/patterns/dropdown-menu/settings/dropdown-menu-settings-1.tsx#L1-L50); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/settings/dropdown-menu-settings-1) | Palette icon trigger; label/separator then controlled light/dark/system radio group. | Local state does not set DOM theme, persist choice, or follow system preference; icon-only trigger is unlabeled. |
| `dropdown-menu-settings-2` — Language Selector | [`dropdown-menu-settings-2.tsx:1-75`](../upstream/packages/patterns/dropdown-menu/settings/dropdown-menu-settings-2.tsx#L1-L75); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/settings/dropdown-menu-settings-2) | Text trigger and controlled radio list of six hard-coded flag/name languages. | Local state does not load translations/persist locale; flag emoji should not substitute for localization metadata. |
| `dropdown-menu-settings-3` — Preferences Dropdown | [`dropdown-menu-settings-3.tsx:1-70`](../upstream/packages/patterns/dropdown-menu/settings/dropdown-menu-settings-3.tsx#L1-L70); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/settings/dropdown-menu-settings-3) | Controlled checkbox menu for five editor preferences. | Local booleans have no editor effect or persistence. |
| `dropdown-menu-settings-4` — Notification Settings | [`dropdown-menu-settings-4.tsx:1-82`](../upstream/packages/patterns/dropdown-menu/settings/dropdown-menu-settings-4.tsx#L1-L82); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/settings/dropdown-menu-settings-4) | Controlled channel checkboxes, separator, then grouped “Notify Me About” checkboxes. | No notification-service update, permission flow, persistence, or error feedback. |
| `dropdown-menu-settings-5` — View Options | [`dropdown-menu-settings-5.tsx:1-74`](../upstream/packages/patterns/dropdown-menu/settings/dropdown-menu-settings-5.tsx#L1-L74); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/settings/dropdown-menu-settings-5) | Icon trigger; controlled list/grid/columns radio layout and controlled display-option checkboxes. | State does not affect a view or persist; icon-only trigger is unlabeled. |

### standard

Preview base: `https://www.kibo-ui.com/patterns/dropdown-menu/standard/`

| ID — title | Local source; preview | Source-observed composition | Demo-only / missing behavior |
|---|---|---|---|
| `dropdown-menu-standard-1` — Simple Dropdown with Icons | [`dropdown-menu-standard-1.tsx:1-48`](../upstream/packages/patterns/dropdown-menu/standard/dropdown-menu-standard-1.tsx#L1-L48); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/standard/dropdown-menu-standard-1) | Minimal ellipsis trigger and four icon items, with destructive logout. | No action handlers; icon-only trigger is unlabeled. |
| `dropdown-menu-standard-2` — Dropdown with Groups and Labels | [`dropdown-menu-standard-2.tsx:1-71`](../upstream/packages/patterns/dropdown-menu/standard/dropdown-menu-standard-2.tsx#L1-L71); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/standard/dropdown-menu-standard-2) | Options trigger; Account and Team labelled groups separated from destructive logout. | No routes/actions. |
| `dropdown-menu-standard-3` — Dropdown with Shortcuts | [`dropdown-menu-standard-3.tsx:1-68`](../upstream/packages/patterns/dropdown-menu/standard/dropdown-menu-standard-3.tsx#L1-L68); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/standard/dropdown-menu-standard-3) | Menu icon trigger and grouped file/edit/search/delete rows with shortcut display. | No edit context or keyboard binding; icon-only trigger is unlabeled. |
| `dropdown-menu-standard-4` — Dropdown with Checkboxes | [`dropdown-menu-standard-4.tsx:1-56`](../upstream/packages/patterns/dropdown-menu/standard/dropdown-menu-standard-4.tsx#L1-L56); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/standard/dropdown-menu-standard-4) | View button; labelled, controlled Status Bar/Activity Bar/Panel checkbox options. | `useState` does not change application chrome or persist. |
| `dropdown-menu-standard-5` — Dropdown with Radio Items | [`dropdown-menu-standard-5.tsx:1-43`](../upstream/packages/patterns/dropdown-menu/standard/dropdown-menu-standard-5.tsx#L1-L43); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/standard/dropdown-menu-standard-5) | Position trigger and controlled four-value radio group. | Local selection does not position a panel. |
| `dropdown-menu-standard-6` — Nested Dropdown | [`dropdown-menu-standard-6.tsx:1-72`](../upstream/packages/patterns/dropdown-menu/standard/dropdown-menu-standard-6.tsx#L1-L72); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/standard/dropdown-menu-standard-6) | New menu has document/folder rows and two submenus: Media and Document Type. | No create flow or chosen type behavior. |
| `dropdown-menu-standard-7` — Mixed Features Dropdown | [`dropdown-menu-standard-7.tsx:1-99`](../upstream/packages/patterns/dropdown-menu/standard/dropdown-menu-standard-7.tsx#L1-L99); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/standard/dropdown-menu-standard-7) | File menu combines action group, Export submenu, shortcut displays, local checkbox state, and local export-quality radio state. | Only the three local UI values change; save/export/share/print/recent-file behavior and shortcuts are absent. |

### support

Preview base: `https://www.kibo-ui.com/patterns/dropdown-menu/support/`

| ID — title | Local source; preview | Source-observed composition | Demo-only / missing behavior |
|---|---|---|---|
| `dropdown-menu-support-1` — Support Dropdown | [`dropdown-menu-support-1.tsx:1-52`](../upstream/packages/patterns/dropdown-menu/support/dropdown-menu-support-1.tsx#L1-L52); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/support/dropdown-menu-support-1) | Support trigger, Get Help label, two rows with trailing ExternalLink icons, then Contact Us. | Icons are visual only: menu items are not anchors and supply no URLs/contact action. |
| `dropdown-menu-support-2` — Help Menu | [`dropdown-menu-support-2.tsx:1-64`](../upstream/packages/patterns/dropdown-menu/support/dropdown-menu-support-2.tsx#L1-L64); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/support/dropdown-menu-support-2) | Icon trigger; documentation/tutorial/FAQ, keyboard shortcuts, support chat and bug-report groups. | No links, chat, report behavior, or shortcut registration; icon-only trigger is unlabeled. |
| `dropdown-menu-support-3` — Resources Menu | [`dropdown-menu-support-3.tsx:1-77`](../upstream/packages/patterns/dropdown-menu/support/dropdown-menu-support-3.tsx#L1-L77); [preview](https://www.kibo-ui.com/patterns/dropdown-menu/support/dropdown-menu-support-3) | Resources trigger; Learning Resources and Developer groups use trailing ExternalLink icons, then Community Forum. | No destinations despite external-link visuals; no handlers. |

**Dropdown adaptation/accessibility note.** Radix wrappers visually style focus and state, but this review did not validate their behavior in a browser. Add labels to icon-only triggers, make destination-like rows actual links (with destination/security policy) or attach commands, provide confirmation/error feedback for destructive actions, and implement shortcuts separately. For controlled samples, connect state to actual effects and persistence rather than copying local `useState` unchanged.

## Empty

These are all static client-component compositions of the `Empty` wrappers. There is no local state, data query, or callback in any empty pattern. `EmptyMedia variant="icon"` produces the boxed icon treatment; omitting it leaves a transparent media wrapper, which the large-icon variants use.

### actions

Preview base: `https://www.kibo-ui.com/patterns/empty/actions/`

| ID — title | Local source; preview | Source-observed composition | Missing application behavior |
|---|---|---|---|
| `empty-actions-1` — Empty with Single Action | [`empty-actions-1.tsx:1-36`](../upstream/packages/patterns/empty/actions/empty-actions-1.tsx#L1-L36); [preview](https://www.kibo-ui.com/patterns/empty/actions/empty-actions-1) | Boxed Plus media, project title/description, one Create Project button. | No create route/dialog/permission handling. |
| `empty-actions-2` — Empty with Multiple Actions | [`empty-actions-2.tsx:1-42`](../upstream/packages/patterns/empty/actions/empty-actions-2.tsx#L1-L42); [preview](https://www.kibo-ui.com/patterns/empty/actions/empty-actions-2) | Boxed Upload media and horizontal Upload File / Import from URL buttons. | Needs file-picker/upload and URL validation/import workflow. |
| `empty-actions-3` — Empty with Link Action | [`empty-actions-3.tsx:1-36`](../upstream/packages/patterns/empty/actions/empty-actions-3.tsx#L1-L36); [preview](https://www.kibo-ui.com/patterns/empty/actions/empty-actions-3) | Boxed BookOpen media and a link-styled Button with ExternalLink icon. | It is a Button, not an anchor, and has no destination/handler. |
| `empty-actions-4` — Empty with Input Action | [`empty-actions-4.tsx:1-37`](../upstream/packages/patterns/empty/actions/empty-actions-4.tsx#L1-L37); [preview](https://www.kibo-ui.com/patterns/empty/actions/empty-actions-4) | Boxed Mail media; full-width flex row of email input and Subscribe button. | Imports `Input`; no `<form>`, input label, submit validation, service call, or error/success state. |
| `empty-actions-5` — Empty with Stacked Actions | [`empty-actions-5.tsx:1-40`](../upstream/packages/patterns/empty/actions/empty-actions-5.tsx#L1-L40); [preview](https://www.kibo-ui.com/patterns/empty/actions/empty-actions-5) | Boxed Users media and two full-width stacked Invite/CSV-import buttons. | No invitation or import flow. |

### data

Preview base: `https://www.kibo-ui.com/patterns/empty/data/`

| ID — title | Local source; preview | Source-observed composition | Missing application behavior |
|---|---|---|---|
| `empty-data-1` — Empty Table | [`empty-data-1.tsx:1-37`](../upstream/packages/patterns/empty/data/empty-data-1.tsx#L1-L37); [preview](https://www.kibo-ui.com/patterns/empty/data/empty-data-1) | Boxed Table media, data message, Add Entry action. | Does not integrate with table state or add-entry flow. |
| `empty-data-2` — Empty Chart | [`empty-data-2.tsx:1-29`](../upstream/packages/patterns/empty/data/empty-data-2.tsx#L1-L29); [preview](https://www.kibo-ui.com/patterns/empty/data/empty-data-2) | Transparent media holds a large muted `BarChart3`; description only, no action. | No chart/query/loading/error distinction. |
| `empty-data-3` — No Notifications | [`empty-data-3.tsx:1-28`](../upstream/packages/patterns/empty/data/empty-data-3.tsx#L1-L28); [preview](https://www.kibo-ui.com/patterns/empty/data/empty-data-3) | Boxed Bell media and caught-up copy only. | No notification data/read status or polling/subscription behavior. |
| `empty-data-4` — No Messages | [`empty-data-4.tsx:1-35`](../upstream/packages/patterns/empty/data/empty-data-4.tsx#L1-L35); [preview](https://www.kibo-ui.com/patterns/empty/data/empty-data-4) | Boxed message icon and New Message action. | No compose route/dialog or messaging context. |
| `empty-data-5` — No Files | [`empty-data-5.tsx:1-43`](../upstream/packages/patterns/empty/data/empty-data-5.tsx#L1-L43); [preview](https://www.kibo-ui.com/patterns/empty/data/empty-data-5) | Boxed file icon and horizontal Upload Files/Create Document actions. | No folder identity, upload validation/progress, or document creation. |

### search

Preview base: `https://www.kibo-ui.com/patterns/empty/search/`

| ID — title | Local source; preview | Source-observed composition | Missing application behavior |
|---|---|---|---|
| `empty-search-1` — No Search Results | [`empty-search-1.tsx:1-28`](../upstream/packages/patterns/empty/search/empty-search-1.tsx#L1-L28); [preview](https://www.kibo-ui.com/patterns/empty/search/empty-search-1) | Boxed Search icon, title and alternate-keyword copy only. | No query value/search state. |
| `empty-search-2` — No Filter Results | [`empty-search-2.tsx:1-33`](../upstream/packages/patterns/empty/search/empty-search-2.tsx#L1-L33); [preview](https://www.kibo-ui.com/patterns/empty/search/empty-search-2) | Boxed Filter icon plus outline Clear Filters action. | Button does not clear state. |
| `empty-search-3` — No Matches Found | [`empty-search-3.tsx:1-33`](../upstream/packages/patterns/empty/search/empty-search-3.tsx#L1-L33); [preview](https://www.kibo-ui.com/patterns/empty/search/empty-search-3) | Boxed SearchX icon, literal `"query"` in title, ghost View All Items action. | Query is hard-coded; view-all action is inert. |
| `empty-search-4` — Try Different Keywords | [`empty-search-4.tsx:1-29`](../upstream/packages/patterns/empty/search/empty-search-4.tsx#L1-L29); [preview](https://www.kibo-ui.com/patterns/empty/search/empty-search-4) | Transparent media with a smaller muted Search icon and longer keyword/category guidance. | No category browse navigation or query context. |
| `empty-search-5` — Clear Filters Suggestion | [`empty-search-5.tsx:1-40`](../upstream/packages/patterns/empty/search/empty-search-5.tsx#L1-L40); [preview](https://www.kibo-ui.com/patterns/empty/search/empty-search-5) | Boxed Filter icon and horizontal Clear All Filters/Browse All actions. | Neither action manipulates filters or routes. |

### standard

Preview base: `https://www.kibo-ui.com/patterns/empty/standard/`

| ID — title | Local source; preview | Source-observed composition | Missing application behavior |
|---|---|---|---|
| `empty-standard-1` — Simple Empty State | [`empty-standard-1.tsx:1-24`](../upstream/packages/patterns/empty/standard/empty-standard-1.tsx#L1-L24); [preview](https://www.kibo-ui.com/patterns/empty/standard/empty-standard-1) | Boxed FileQuestion icon and title only. | Parent must decide when it represents empty rather than loading/error. |
| `empty-standard-2` — Empty with Description | [`empty-standard-2.tsx:1-28`](../upstream/packages/patterns/empty/standard/empty-standard-2.tsx#L1-L28); [preview](https://www.kibo-ui.com/patterns/empty/standard/empty-standard-2) | Boxed Inbox icon, title, one-sentence description. | Static generic copy only. |
| `empty-standard-3` — Empty with Long Description | [`empty-standard-3.tsx:1-28`](../upstream/packages/patterns/empty/standard/empty-standard-3.tsx#L1-L28); [preview](https://www.kibo-ui.com/patterns/empty/standard/empty-standard-3) | Boxed Package icon and longer category/browse copy. | No category state or browse target. |
| `empty-standard-4` — Empty with Large Icon | [`empty-standard-4.tsx:1-28`](../upstream/packages/patterns/empty/standard/empty-standard-4.tsx#L1-L28); [preview](https://www.kibo-ui.com/patterns/empty/standard/empty-standard-4) | Transparent media with `h-16 w-16` FolderOpen icon, title/description. | Static folder terminology only. |
| `empty-standard-5` — Empty with Multiple Paragraphs | [`empty-standard-5.tsx:1-31`](../upstream/packages/patterns/empty/standard/empty-standard-5.tsx#L1-L31); [preview](https://www.kibo-ui.com/patterns/empty/standard/empty-standard-5) | Boxed Calendar icon; one `EmptyDescription` uses two `<br />` elements to separate calendar copy. | No event data/window or create action. |
| `empty-standard-6` — Empty without Icon | [`empty-standard-6.tsx:1-22`](../upstream/packages/patterns/empty/standard/empty-standard-6.tsx#L1-L22); [preview](https://www.kibo-ui.com/patterns/empty/standard/empty-standard-6) | Header has only title and description—no `EmptyMedia`. | Static copy only. |
| `empty-standard-7` — Empty with Link in Description | [`empty-standard-7.tsx:1-28`](../upstream/packages/patterns/empty/standard/empty-standard-7.tsx#L1-L28); [preview](https://www.kibo-ui.com/patterns/empty/standard/empty-standard-7) | Boxed Star icon and description contains `<a href="#">Learn more about favorites</a>`. | `#` is placeholder demo routing; replace with a real destination and link policy. |

**Empty adaptation/accessibility note.** The source provides visual layout, not data-state orchestration. Do not show these states before a data request settles or conflate no-results with error/permission/loading. The newsletter input lacks an explicit visible/programmatic label in this source; add one and use a real form. Validate contrast, zoom/reflow, announcements, focus placement, and action semantics in the integrated app; none was browser-validated here.

## Coverage and missing inputs

- **Complete assigned inventory:** drawer **22** patterns (bottom 7, left 5, right 5, top 5); dropdown-menu **30** (actions 5, editor 5, profile 5, settings 5, standard 7, support 3); empty **22** (actions 5, data 5, search 5, standard 7): **74 source files** total. The catalog rows cited above are the complete contents of the three assigned `packages/patterns/<family>/` directories at the pinned revision.
- **Primitive sources read:** drawer, dropdown-menu, and empty wrappers cited in Shared implementation boundary. Pattern-specific imports (`Button`, `Input`, `Label`, `Checkbox`, `Slider`, `Switch`, `Badge`, `Avatar`, and Lucide icons) are only described where the pattern source imports them.
- **Missing/unverified inputs:** no target product workflow, data schema, routes, authorization model, persistence API, installed dependency compatibility, design tokens, or accessibility/browser test results were supplied. Consequently, this report distinguishes source-visible demo state from application behavior and makes no claim that any preview URL was opened or that upstream behavior is production-ready.
