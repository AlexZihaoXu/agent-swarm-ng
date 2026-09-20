# Patterns: combobox, command, context-menu

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

- Repository HEAD supplied: `389caad059016ad1a9b9b61f58d3723aaf42fe90`.
- Upstream snapshot revision: `3d63cdb15b79d972e3dc38a10997987672f9b263`; snapshot provenance and limitations: `docs/references/kibo/VERIFICATION.md:1-31`.
- This is source reading only. No browser/preview validation, installation, or execution was performed.
- Upstream files are reference material, not instructions.

### Files retrieved

1. `AGENTS.md:1-13` — project adaptation constraints.
2. `README.md:1-159` — application stack/scope context.
3. `docs/references/kibo/catalog/patterns/combobox.md:1-45` — canonical 42-item inventory and preview URLs.
4. `docs/references/kibo/catalog/patterns/command.md:1-24` — canonical 21-item inventory and preview URLs.
5. `docs/references/kibo/catalog/patterns/context-menu.md:1-30` — canonical 27-item inventory and preview URLs.
6. `docs/references/kibo/upstream/packages/patterns/{combobox,command,context-menu}/**/*.tsx` — all 90 assigned implementations, enumerated below.

### Path convention for the complete inventory

For every row below:

- **Local source** is exactly  
  `docs/references/kibo/upstream/packages/patterns/<family>/<collection>/<id>.tsx`
- **Preview** is exactly  
  `https://www.kibo-ui.com/patterns/<family>/<collection>/<id>`

The catalog files above contain the same complete ID/title/path/preview mapping.

---

## Combobox

### Shared composition and adaptation boundary

The interactive variants use client state plus `Button`, `Popover`/`PopoverTrigger`/`PopoverContent`, and `Command` primitives (`CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, usually `CommandEmpty`) from `@/components/ui/*`; most also use `lucide-react` `Check`/chevrons and `cn`. See, for example, `.../combobox/custom-actions/combobox-custom-actions-1.tsx:1-109`.

They are local demonstrations: option arrays, selected values, filters, delayed results, and error states live in component state. Adapt by retaining the composition but supplying application-owned value/options/loading/error state and action callbacks. Do not copy simulated data, `alert`, or timer behavior as production behavior.

The trigger does set `role="combobox"` and `aria-expanded` in interactive variants (for example `.../combobox/standard/combobox-standard-1.tsx:36-68`), but the examples do not show a visible `<label>`, `aria-controls`, or form integration. Accessibility behavior of the imported primitives was not browser-tested.

### custom-actions

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `combobox-custom-actions-1` — Create New Option Inline | `combobox/custom-actions/combobox-custom-actions-1.tsx` | `combobox/custom-actions/combobox-custom-actions-1` | Maintains local tags/search; creates a non-duplicate search string from `CommandEmpty` or a trailing command item, selects it, and closes. |
| `combobox-custom-actions-2` — With Footer Actions | `combobox/custom-actions/combobox-custom-actions-2.tsx` | `combobox/custom-actions/combobox-custom-actions-2` | Starts on “personal”; adds a separated footer button which calls `alert("Opening workspace settings")` then closes. |
| `combobox-custom-actions-3` — Recent Selections Section | `combobox/custom-actions/combobox-custom-actions-3.tsx` | `combobox/custom-actions/combobox-custom-actions-3` | Two groups, “Recent” and “All Files”; filters recent IDs out of the latter and adds a clock icon. |
| `combobox-custom-actions-4` — Async/Dynamic Search | `combobox/custom-actions/combobox-custom-actions-4.tsx` | `combobox/custom-actions/combobox-custom-actions-4` | `shouldFilter={false}`; a 500 ms `setTimeout` synthesizes three search-string results and renders a spinner/empty prompt. |
| `combobox-custom-actions-5` — With Quick Filters | `combobox/custom-actions/combobox-custom-actions-5.tsx` | `combobox/custom-actions/combobox-custom-actions-5` | Local category filter; clickable `Badge` elements switch All/Bugs/Features/Docs before command filtering. |
| `combobox-custom-actions-6` — Keyboard Shortcuts Displayed | `combobox/custom-actions/combobox-custom-actions-6.tsx` | `combobox/custom-actions/combobox-custom-actions-6` | Renders command strings as `<kbd>` display beside selectable items; it does not register those shortcuts. |
| `combobox-custom-actions-7` — Clear/Reset Button | `combobox/custom-actions/combobox-custom-actions-7.tsx` | `combobox/custom-actions/combobox-custom-actions-7` | Starts with “system”; inner clear `<button>` prevents/stops trigger propagation and clears local value. |

**Notes:** `-2`’s alert is explicitly demo-only (`...-2.tsx:75-88`); `-4` labels its timeout an API simulation and cleans its timer (`...-4.tsx:30-49`). `-5` uses click handlers on `Badge`, not buttons (`...-5.tsx:60-87`), and `-7` nests a native button inside the trigger `Button` (`...-7.tsx:36-59`); replace those controls with an accessible composition.

### grouped

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `combobox-grouped-1` — Multiple Groups with Labels | `combobox/grouped/combobox-grouped-1.tsx` | `combobox/grouped/combobox-grouped-1` | Hard-coded Frontend and Backend `CommandGroup` headings. |
| `combobox-grouped-2` — Categories with Separators | `combobox/grouped/combobox-grouped-2.tsx` | `combobox/grouped/combobox-grouped-2` | Three unheaded primary/secondary/other groups divided by separators. |
| `combobox-grouped-3` — Nested/Hierarchical Groups | `combobox/grouped/combobox-grouped-3.tsx` | `combobox/grouped/combobox-grouped-3` | Maps region headings and country items; a `ChevronRight` is visual decoration, not a submenu. |
| `combobox-grouped-4` — Groups with Item Counts | `combobox/grouped/combobox-grouped-4.tsx` | `combobox/grouped/combobox-grouped-4` | Maps categories with a custom heading containing the category name and `items.length`. |
| `combobox-grouped-5` — Collapsible Groups | `combobox/grouped/combobox-grouped-5.tsx` | `combobox/grouped/combobox-grouped-5` | Local `Record<string, boolean>` state; category heading is a button that conditionally omits its items. |
| `combobox-grouped-6` — Recent vs All Items | `combobox/grouped/combobox-grouped-6.tsx` | `combobox/grouped/combobox-grouped-6` | “Recent” projects, clock icons, separator, then a de-duplicated “All Projects” group. |
| `combobox-grouped-7` — Favorites + All Items | `combobox/grouped/combobox-grouped-7.tsx` | `combobox/grouped/combobox-grouped-7` | Same de-duplication structure as `-6`, but favorites use a filled yellow star. |

**Boundary:** recent/favorite ordering and category counts are static demo data. `-5` only hides items in local rendering; an application must decide whether collapse state, filtering, and keyboard semantics belong to its data model.

### multi-select

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `combobox-multi-select-1` — Multiple Items with Badges | `combobox/multi-select/combobox-multi-select-1.tsx` | `combobox/multi-select/combobox-multi-select-1` | Selected tags render as removable badges inside the full-width trigger; item selection toggles an array without closing. |
| `combobox-multi-select-2` — With Select All Option | `combobox/multi-select/combobox-multi-select-2.tsx` | `combobox/multi-select/combobox-multi-select-2` | A leading command item selects/clears all four hard-coded permission IDs. |
| `combobox-multi-select-3` — With Item Count in Trigger | `combobox/multi-select/combobox-multi-select-3.tsx` | `combobox/multi-select/combobox-multi-select-3` | Starts with JavaScript and TypeScript selected; trigger only shows singular/plural count. |
| `combobox-multi-select-4` — With Checkboxes Visible | `combobox/multi-select/combobox-multi-select-4.tsx` | `combobox/multi-select/combobox-multi-select-4` | Uses controlled `Checkbox` visuals inside command items and a category-count trigger. |
| `combobox-multi-select-5` — With Clear All Functionality | `combobox/multi-select/combobox-multi-select-5.tsx` | `combobox/multi-select/combobox-multi-select-5` | Starts red/blue selected; an inner X button clears the array while preventing trigger propagation. |
| `combobox-multi-select-6` — With Max Selections Limit | `combobox/multi-select/combobox-multi-select-6.tsx` | `combobox/multi-select/combobox-multi-select-6` | Defines `MAX_SELECTIONS = 3`; unselected items become disabled once reached, while selected items remain removable. |
| `combobox-multi-select-7` — Selected Items List Below | `combobox/multi-select/combobox-multi-select-7.tsx` | `combobox/multi-select/combobox-multi-select-7` | Starts with two topics and repeats selected labels as non-removable badges below the popover. |

**Caveat:** `-1` and `-5` put native buttons inside the trigger button (`...-1.tsx:39-79`, `...-5.tsx:41-66`), so they should not be adopted verbatim. `-1` adds Enter and mouse-down handling to badge removal, but no accessible name is supplied for its X-only control.

### rich-content

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `combobox-rich-content-1` — Items with Avatars | `combobox/rich-content/combobox-rich-content-1.tsx` | `combobox/rich-content/combobox-rich-content-1` | Selected user and each option render `AvatarImage` plus first-letter fallback. |
| `combobox-rich-content-2` — Items with Descriptions | `combobox/rich-content/combobox-rich-content-2.tsx` | `combobox/rich-content/combobox-rich-content-2` | 280 px list with integration name and stacked description. |
| `combobox-rich-content-3` — Items with Status Indicators | `combobox/rich-content/combobox-rich-content-3.tsx` | `combobox/rich-content/combobox-rich-content-3` | Task items render a `Badge`; static `statusConfig` maps completed/in-progress/todo to labels/variants. |
| `combobox-rich-content-4` — Items with Metadata | `combobox/rich-content/combobox-rich-content-4.tsx` | `combobox/rich-content/combobox-rich-content-4` | 300 px member rows with avatar, name, role, and joined-date metadata. |
| `combobox-rich-content-5` — Items with Icons and Descriptions | `combobox/rich-content/combobox-rich-content-5.tsx` | `combobox/rich-content/combobox-rich-content-5` | Plan/feature items render imported icons with descriptive text. |
| `combobox-rich-content-6` — Color-Coded Items | `combobox/rich-content/combobox-rich-content-6.tsx` | `combobox/rich-content/combobox-rich-content-6` | Labels use locally specified color classes/swatch-like color treatment. |
| `combobox-rich-content-7` — Items with Action Buttons | `combobox/rich-content/combobox-rich-content-7.tsx` | `combobox/rich-content/combobox-rich-content-7` | Repository item has name/description plus an inner external-link icon button; it stops selection propagation and calls `window.open(url, "_blank")`. |

**Dependencies/data:** avatars, descriptions, task status mappings, color classes, and repositories are all inline demo data. `-7` needs a real navigation policy (including opener/security treatment) and avoids neither nested interactive descendants nor an accessible label for the icon-only action (`...-7.tsx:68-108`).

### standard

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `combobox-standard-1` — Simple Single Select | `combobox/standard/combobox-standard-1.tsx` | `combobox/standard/combobox-standard-1` | Empty local framework selection; choosing toggles the value and closes. |
| `combobox-standard-2` — With Default Selected Value | `combobox/standard/combobox-standard-2.tsx` | `combobox/standard/combobox-standard-2` | Same structure, initialized to language ID `en`. |
| `combobox-standard-3` — With Item Icons | `combobox/standard/combobox-standard-3.tsx` | `combobox/standard/combobox-standard-3` | Platform records carry icon components rendered with React `createElement`. |
| `combobox-standard-4` — Small Size Variant | `combobox/standard/combobox-standard-4.tsx` | `combobox/standard/combobox-standard-4` | 150 px trigger/content and compact input/item sizing. |
| `combobox-standard-5` — Large Size Variant | `combobox/standard/combobox-standard-5.tsx` | `combobox/standard/combobox-standard-5` | 280 px trigger/content and larger input/item sizing. |
| `combobox-standard-6` — Disabled State | `combobox/standard/combobox-standard-6.tsx` | `combobox/standard/combobox-standard-6` | Trigger is disabled while its static selected option remains displayed. |
| `combobox-standard-7` — Full Width Variant | `combobox/standard/combobox-standard-7.tsx` | `combobox/standard/combobox-standard-7` | Outer wrapper and trigger/content use `w-full`; otherwise the single-select pattern. |

### with-states

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `combobox-with-states-1` — Loading State | `combobox/with-states/combobox-with-states-1.tsx` | `combobox/with-states/combobox-with-states-1` | On each open, shows four Skeleton rows for two seconds, then hard-coded options. |
| `combobox-with-states-2` — Error State with Retry | `combobox/with-states/combobox-with-states-2.tsx` | `combobox/with-states/combobox-with-states-2` | Starts in a “Failed to load” panel; Retry merely sets local `hasError` false. |
| `combobox-with-states-3` — Empty State with Action | `combobox/with-states/combobox-with-states-3.tsx` | `combobox/with-states/combobox-with-states-3` | Starts with no items and a decorative inbox/create panel; Create replaces state with three fixed labels. |
| `combobox-with-states-4` — No Results Variation | `combobox/with-states/combobox-with-states-4.tsx` | `combobox/with-states/combobox-with-states-4` | Custom `CommandEmpty` contains search icon, “No results,” and guidance text. |
| `combobox-with-states-5` — With Validation Feedback | `combobox/with-states/combobox-with-states-5.tsx` | `combobox/with-states/combobox-with-states-5` | Effect derives a local currency-required string; trigger gets destructive border and error appears below. |
| `combobox-with-states-6` — With Disabled Items | `combobox/with-states/combobox-with-states-6.tsx` | `combobox/with-states/combobox-with-states-6` | Static premium/enterprise records are disabled and visually muted. |
| `combobox-with-states-7` — Read-Only/View Mode | `combobox/with-states/combobox-with-states-7.tsx` | `combobox/with-states/combobox-with-states-7` | No popover/command: a disabled outline button shows fixed “Option 2,” Eye icon, and explanatory text. |

**Boundary:** `-1`’s timer has no cleanup (`...-1.tsx:24-33`); `-2` and `-3` do no request/create work (`...-2.tsx:23-31`, `...-3.tsx:23-31`); `-5` provides visual text but no form field/`aria-describedby` wiring (`...-5.tsx:25-83`). Replace each with application lifecycle, cancellation, retry, validation, and submission behavior.

---

## Command

### Shared composition and adaptation boundary

All command patterns use `@/components/ui/command` primitives. The seven content variants recur identically across three presentation collections:

| Variant | Actual source content |
|---|---|
| `1` | One “Suggestions” group: Calendar, Search Emoji, Calculator. |
| `2` | Suggestions and Settings groups with Lucide icons; only Profile/Billing/Settings show `CommandShortcut` strings. |
| `3` | Recent/Folders/Media groups separated by `CommandSeparator`, with file-type icons. |
| `4` | Component list with icons and `Badge` metadata. |
| `5` | Contact rows with icons and secondary descriptive text. |
| `6` | Quick Actions and File Actions groups; icons and shortcut *display* values. |
| `7` | Service rows with visual status indicators. |

These items have no action handlers in the source. Shortcut text is presentation only; no keyboard listener is installed. The inline labels, services, contacts, files, and actions are demo content, not application commands.

### dialog

| ID — title | Local source suffix | Preview suffix | Container behavior |
|---|---|---|---|
| `command-dialog-1` — Simple Command Dialog | `command/dialog/command-dialog-1.tsx` | `command/dialog/command-dialog-1` | Local `open` state; button opens `CommandDialog`; variant 1 content. |
| `command-dialog-2` — Command Dialog with Icons and Shortcuts | `command/dialog/command-dialog-2.tsx` | `command/dialog/command-dialog-2` | Same controlled dialog; variant 2 content. |
| `command-dialog-3` — Command Dialog with Separators | `command/dialog/command-dialog-3.tsx` | `command/dialog/command-dialog-3` | Same controlled dialog; variant 3 content. |
| `command-dialog-4` — Command Dialog with Badges | `command/dialog/command-dialog-4.tsx` | `command/dialog/command-dialog-4` | Same controlled dialog; variant 4 content. |
| `command-dialog-5` — Command Dialog with Descriptions | `command/dialog/command-dialog-5.tsx` | `command/dialog/command-dialog-5` | Same controlled dialog; variant 5 content. |
| `command-dialog-6` — Command Dialog Actions Menu | `command/dialog/command-dialog-6.tsx` | `command/dialog/command-dialog-6` | Same controlled dialog; variant 6 content. |
| `command-dialog-7` — Command Dialog with Status Indicators | `command/dialog/command-dialog-7.tsx` | `command/dialog/command-dialog-7` | Same controlled dialog; variant 7 content. |

`command-dialog-2.tsx:1-74` shows the required `Button`, `CommandDialog`, input/list/group/item/empty/shortcut imports and the only dialog behavior: button `setOpen(true)` plus `onOpenChange={setOpen}`.

### popover

| ID — title | Local source suffix | Preview suffix | Container behavior |
|---|---|---|---|
| `command-popover-1` — Simple Command Popover | `command/popover/command-popover-1.tsx` | `command/popover/command-popover-1` | Uncontrolled outline-button `Popover`, start-aligned 400 px content; variant 1. |
| `command-popover-2` — Command Popover with Icons and Shortcuts | `command/popover/command-popover-2.tsx` | `command/popover/command-popover-2` | Same container; variant 2. |
| `command-popover-3` — Command Popover with Separators | `command/popover/command-popover-3.tsx` | `command/popover/command-popover-3` | Same container; variant 3. |
| `command-popover-4` — Command Popover with Badges | `command/popover/command-popover-4.tsx` | `command/popover/command-popover-4` | Same container; variant 4. |
| `command-popover-5` — Command Popover with Descriptions | `command/popover/command-popover-5.tsx` | `command/popover/command-popover-5` | Same container; variant 5. |
| `command-popover-6` — Command Popover Actions Menu | `command/popover/command-popover-6.tsx` | `command/popover/command-popover-6` | Same container; variant 6. |
| `command-popover-7` — Command Popover with Status Indicators | `command/popover/command-popover-7.tsx` | `command/popover/command-popover-7` | Same container; variant 7. |

See `command/popover/command-popover-1.tsx:1-38` for the precise popover imports/composition.

### standard

| ID — title | Local source suffix | Preview suffix | Container behavior |
|---|---|---|---|
| `command-standard-1` — Simple Command Menu | `command/standard/command-standard-1.tsx` | `command/standard/command-standard-1` | Inline `Command` with `w-full max-w-lg`, border, rounded corners, and shadow; variant 1. |
| `command-standard-2` — Command with Icons and Shortcuts | `command/standard/command-standard-2.tsx` | `command/standard/command-standard-2` | Same inline container; variant 2. |
| `command-standard-3` — Command with Separators | `command/standard/command-standard-3.tsx` | `command/standard/command-standard-3` | Same inline container; variant 3. |
| `command-standard-4` — Command with Badges | `command/standard/command-standard-4.tsx` | `command/standard/command-standard-4` | Same inline container; variant 4. |
| `command-standard-5` — Command with Descriptions | `command/standard/command-standard-5.tsx` | `command/standard/command-standard-5` | Same inline container; variant 5. |
| `command-standard-6` — Command Actions Menu | `command/standard/command-standard-6.tsx` | `command/standard/command-standard-6` | Same inline container; variant 6. |
| `command-standard-7` — Command with Status Indicators | `command/standard/command-standard-7.tsx` | `command/standard/command-standard-7` | Same inline container; variant 7. |

**Safe adaptation:** choose the dialog/popover/inline shell based on product context, retain the command-list composition, then provide a typed command registry, action execution, enabled/visible states, close/focus policy, and real platform-specific shortcut handling. Do not treat shortcut strings as functionality. Imported primitive accessibility and focus behavior were not validated in a browser.

---

## Context menu

### Shared composition and adaptation boundary

Every source uses `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, and `ContextMenuItem` from `@/components/ui/context-menu`, usually with Lucide icons, separators, labels, shortcuts, and/or submenus. The trigger is a fixed dashed 200 px demo box saying what to right-click; it is not a real canvas, file row, table cell, or editable text target. See `context-menu/canvas/context-menu-canvas-2.tsx:1-81`.

Except standard `-5` and `-6`, menu items have no handlers: actions, shortcuts, destructive operations, and submenus are display-only. The checkbox and radio examples only update local React state. Production adaptation must bind the target entity/selection, permissions, disabled states, command execution, mutation feedback, and confirmation/undo policy—especially destructive entries. No browser or assistive-technology validation was performed.

### canvas

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `context-menu-canvas-1` — Layer Arrange Menu | `context-menu/canvas/context-menu-canvas-1.tsx` | `context-menu/canvas/context-menu-canvas-1` | Bring forward/front and send backward/back items, split by separator, with shortcut display. |
| `context-menu-canvas-2` — Align and Distribute Menu | `context-menu/canvas/context-menu-canvas-2.tsx` | `context-menu/canvas/context-menu-canvas-2` | Separate Align and Distribute submenus; six alignment and two distribution labels. |
| `context-menu-canvas-3` — Group and Lock Menu | `context-menu/canvas/context-menu-canvas-3.tsx` | `context-menu/canvas/context-menu-canvas-3` | Group/Ungroup then Lock/Unlock sets with icons and shortcut text. |
| `context-menu-canvas-4` — Layer Management Menu | `context-menu/canvas/context-menu-canvas-4.tsx` | `context-menu/canvas/context-menu-canvas-4` | “Layer Options” label; visibility, layer duplication, and layer actions separated into sections. |
| `context-menu-canvas-5` — Transform Menu | `context-menu/canvas/context-menu-canvas-5.tsx` | `context-menu/canvas/context-menu-canvas-5` | Rotate submenu plus flip/transform entries and separators. |

### file

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `context-menu-file-1` — File Operations Menu | `context-menu/file/context-menu-file-1.tsx` | `context-menu/file/context-menu-file-1` | Open, rename, duplicate, and destructive Delete, with shortcut display. |
| `context-menu-file-2` — Copy and Move Menu | `context-menu/file/context-menu-file-2.tsx` | `context-menu/file/context-menu-file-2` | Cut/copy/copy-path items then move/copy destination items. |
| `context-menu-file-3` — Archive and Compress Menu | `context-menu/file/context-menu-file-3.tsx` | `context-menu/file/context-menu-file-3` | Compress submenu offers ZIP/TAR.GZ/7Z; Extract Here and Extract to… are top-level items. |
| `context-menu-file-4` — Share and Export Menu | `context-menu/file/context-menu-file-4.tsx` | `context-menu/file/context-menu-file-4` | Share submenu, then separated link/export items. |
| `context-menu-file-5` — File Properties Menu | `context-menu/file/context-menu-file-5.tsx` | `context-menu/file/context-menu-file-5` | “File Management” label, information/permissions actions, then a separated final item. |

### standard

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `context-menu-standard-1` — Simple Context Menu | `context-menu/standard/context-menu-standard-1.tsx` | `context-menu/standard/context-menu-standard-1` | Bare Back/Forward/Reload/More Options items and no sizing class. |
| `context-menu-standard-2` — Context Menu with Icons and Shortcuts | `context-menu/standard/context-menu-standard-2.tsx` | `context-menu/standard/context-menu-standard-2` | 56-width icon items with shortcut labels and destructive Delete. |
| `context-menu-standard-3` — Context Menu with Separators | `context-menu/standard/context-menu-standard-3.tsx` | `context-menu/standard/context-menu-standard-3` | Clipboard/edit block, separators, then destructive delete. |
| `context-menu-standard-4` — Context Menu with Labels | `context-menu/standard/context-menu-standard-4.tsx` | `context-menu/standard/context-menu-standard-4` | “My Account” and “Support” labels split account/help/destructive logout sections. |
| `context-menu-standard-5` — Context Menu with Checkboxes | `context-menu/standard/context-menu-standard-5.tsx` | `context-menu/standard/context-menu-standard-5` | Three controlled `ContextMenuCheckboxItem` settings in local state. |
| `context-menu-standard-6` — Context Menu with Radio Items | `context-menu/standard/context-menu-standard-6.tsx` | `context-menu/standard/context-menu-standard-6` | Controlled `ContextMenuRadioGroup` for four panel positions, initialized to bottom. |
| `context-menu-standard-7` — Context Menu with Submenus | `context-menu/standard/context-menu-standard-7.tsx` | `context-menu/standard/context-menu-standard-7` | Two nested submenus for invitation/contact-style actions, plus separators and a final item. |

`context-menu-standard-5.tsx:1-48` and `...-6.tsx:1-42` are the only assigned context-menu examples with local state transitions; neither persists settings.

### table

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `context-menu-table-1` — Table Sort Menu | `context-menu/table/context-menu-table-1.tsx` | `context-menu/table/context-menu-table-1` | Ascending/descending sort items, separator, Clear Sort. |
| `context-menu-table-2` — Table Filter Menu | `context-menu/table/context-menu-table-2.tsx` | `context-menu/table/context-menu-table-2` | Filter-condition submenu (contains/equality/prefix/suffix) and Clear Filter. |
| `context-menu-table-3` — Table Export Menu | `context-menu/table/context-menu-table-3.tsx` | `context-menu/table/context-menu-table-3` | Export submenu with several formats, followed by a separated top-level action. |
| `context-menu-table-4` — Table Row Operations Menu | `context-menu/table/context-menu-table-4.tsx` | `context-menu/table/context-menu-table-4` | Move row up/down, duplicate, destructive delete/remove operations, and shortcuts. |
| `context-menu-table-5` — Table Column Operations Menu | `context-menu/table/context-menu-table-5.tsx` | `context-menu/table/context-menu-table-5` | Show/hide, move left/right, resize, and auto-fit column actions. |

### text

| ID — title | Local source suffix | Preview suffix | Actual distinguishing implementation |
|---|---|---|---|
| `context-menu-text-1` — Text Editing Menu | `context-menu/text/context-menu-text-1.tsx` | `context-menu/text/context-menu-text-1` | Cut/copy/paste with shortcut display, separator, Select All. |
| `context-menu-text-2` — Text Formatting Menu | `context-menu/text/context-menu-text-2.tsx` | `context-menu/text/context-menu-text-2` | Bold/italic/underline/strikethrough with shortcut labels, then Clear Formatting. |
| `context-menu-text-3` — Text Alignment Menu | `context-menu/text/context-menu-text-3.tsx` | `context-menu/text/context-menu-text-3` | Alignment submenu plus increase/decrease indent items. |
| `context-menu-text-4` — Spell Check Menu | `context-menu/text/context-menu-text-4.tsx` | `context-menu/text/context-menu-text-4` | “Suggestions” label, three static suggestions, Add to Dictionary, Ignore. |
| `context-menu-text-5` — Font and Style Menu | `context-menu/text/context-menu-text-5.tsx` | `context-menu/text/context-menu-text-5` | Font Family and Font Size submenus, separator, text/highlight color items. |

---

## Coverage and missing inputs

- **Covered:** all assigned collections and patterns: combobox **42** (6 collections × 7), command **21** (3 × 7), context-menu **27** (5/5/7/5/5) — **90 total** source files.
- **Required imports/primitives:** documented per family; rich/multi/state variants additionally import `Avatar`, `Badge`, `Checkbox`, `Skeleton`, or Lucide icons as indicated by their source.
- **Demo-only behavior/data:** all static option/entity arrays, fake loading/search/retry/create behavior, `alert`, display-only shortcut text, and unbound menu actions.
- **Missing application inputs:** product command registry; option/entity API and lifecycle contract; form/value ownership; permission/selection model; action handlers; destructive-action policy; shortcut policy; navigation policy; validation/error semantics.
- **Not claimed:** preview availability, visual fidelity, runtime correctness, keyboard behavior, focus handling, screen-reader behavior, or browser accessibility validation.
