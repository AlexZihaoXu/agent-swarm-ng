# Patterns: accordion, alert, alert-dialog

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), recorded in `docs/references/kibo/metadata/manifest.json` (lines 1–14). This covers only the 85 assigned pattern files: **21 accordion**, **25 alert**, and **39 alert-dialog** files.

Preview URLs below come from the local catalog; they were **not opened or browser-validated**. Findings are from source reading only.

## Files retrieved

1. `docs/references/kibo/catalog/patterns/accordion.md` (lines 1–27) — authoritative local IDs, titles, source paths, and preview URLs.
2. `docs/references/kibo/catalog/patterns/alert.md` (lines 1–31) — alert inventory metadata.
3. `docs/references/kibo/catalog/patterns/alert-dialog.md` (lines 1–45) — alert-dialog inventory metadata.
4. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/accordion.tsx` (lines 1–66) — Accordion wrapper composition.
5. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/alert.tsx` (lines 1–66) — Alert role, variants, title/description slots.
6. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/alert-dialog.tsx` (lines 1–157) — dialog wrapper, overlay/content, action/cancel components.
7. `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/{button,input,checkbox,label,radio-group,select,textarea,collapsible}.tsx` — supporting primitives imported by assigned patterns.

## Shared source observations

- The Accordion wrapper is Radix Accordion-based; its trigger includes a default ChevronDown and its content uses open/closed animation classes. `[source](../upstream/packages/shadcn-ui/components/ui/accordion.tsx)`
- The Alert wrapper renders `role="alert"` and supports only `default` and `destructive` component variants; family-specific info/success/warning/error appearance is supplied by pattern Tailwind classes. `[source](../upstream/packages/shadcn-ui/components/ui/alert.tsx)`
- AlertDialog is Radix AlertDialog-based. Its content always creates a portal and overlay; `Action` and `Cancel` receive button styles from the wrapper. `[source](../upstream/packages/shadcn-ui/components/ui/alert-dialog.tsx)`
- All pattern files export a presentational `Example`; no assigned pattern contains application requests, callbacks, mutation state, analytics, or persistence.

---

# Accordion

**Required imports:** all variants import `Accordion`, `AccordionItem`, `AccordionTrigger`, and `AccordionContent` from `@/components/ui/accordion`. Form variants also import `Input`; multi-level variants add `Collapsible`, `CollapsibleTrigger`, and `CollapsibleContent`. All accordion collections use `@faker-js/faker` for generated UUIDs and text; this is demo-only data/dependency.

**Common behavior:** sources use uncontrolled `type="single" collapsible` accordions and usually `defaultValue={data[0]...}`. Production adaptation should replace faker IDs/text with stable application records and decide whether uncontrolled defaults are sufficient. The plus/minus variants hide the wrapper’s default chevron with CSS and provide visual state icons; preserve a textual trigger label. No source-level browser or assistive-technology validation was performed.

## form

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `accordion-form-1` — Form | `docs/references/kibo/upstream/packages/patterns/accordion/form/accordion-form-1.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/form/accordion-form-1) | Three bordered sections with leading User/Mail/MapPin icons; contents are uncontrolled placeholder inputs. |
| `accordion-form-2` — Form with Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/form/accordion-form-2.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/form/accordion-form-2) | Same fields and leading icons, but hides the built-in chevron and swaps end-aligned Plus/Minus icons by accordion state. |

**Adaptation boundary:** inputs have no labels, names, values, validation, submit handler, or field persistence in source. Add application form state, labels, validation, and submission behavior rather than treating the placeholders as a usable form.

## multi-level

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `accordion-multi-level-1` — Multi-level | `docs/references/kibo/upstream/packages/patterns/accordion/multi-level/accordion-multi-level-1.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/multi-level/accordion-multi-level-1) | Four outer accordion rows; each content area contains two independently collapsible accent-background rows with a rotated ChevronDown. |
| `accordion-multi-level-2` — Multi-level with Icon | `docs/references/kibo/upstream/packages/patterns/accordion/multi-level/accordion-multi-level-2.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/multi-level/accordion-multi-level-2) | Adds FileText/Folder/Settings/Users icons before outer titles; nested structure is otherwise the same. |
| `accordion-multi-level-3` — Multi-level with Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/multi-level/accordion-multi-level-3.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/multi-level/accordion-multi-level-3) | Outer trigger uses end-aligned Plus/Minus state icons; nested collapsibles retain ChevronDown. |
| `accordion-multi-level-4` — Multi-level with Left Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/multi-level/accordion-multi-level-4.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/multi-level/accordion-multi-level-4) | Same as -3, with the Plus/Minus indicator at the left of each outer title. |

**Adaptation boundary:** nested labels and paragraphs are faker-generated. The inner `defaultOpen` receives an optional field that the demo never populates; choose explicit defaults/control based on product requirements.

## standard

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `accordion-standard-1` — Standard | `docs/references/kibo/upstream/packages/patterns/accordion/standard/accordion-standard-1.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/standard/accordion-standard-1) | Connected, bordered rows with the default right chevron and paragraph content. |
| `accordion-standard-2` — Standard with Left Chevron | `docs/references/kibo/upstream/packages/patterns/accordion/standard/accordion-standard-2.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/standard/accordion-standard-2) | Reverses trigger flex order so the default chevron sits left; content is indented to align under the title. |
| `accordion-standard-3` — Standard with Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/standard/accordion-standard-3.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/standard/accordion-standard-3) | Replaces the visible default chevron with an end-aligned Plus/Minus pair. |
| `accordion-standard-4` — Standard with Left Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/standard/accordion-standard-4.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/standard/accordion-standard-4) | Left Plus/Minus pair; content has left padding matching the indicator. |
| `accordion-standard-5` — Icon | `docs/references/kibo/upstream/packages/patterns/accordion/standard/accordion-standard-5.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/standard/accordion-standard-5) | Leading per-row file/folder/settings/users icon; default right chevron; indented content. |
| `accordion-standard-6` — Icon with Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/standard/accordion-standard-6.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/standard/accordion-standard-6) | Leading icon plus end Plus/Minus indicator; default chevron is hidden. |
| `accordion-standard-7` — Full Featured | `docs/references/kibo/upstream/packages/patterns/accordion/standard/accordion-standard-7.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/standard/accordion-standard-7) | Leading icon, title/subtitle stack, end Plus/Minus indicator, and indented content. |

## subtitle

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `accordion-subtitle-1` — Subtitle | `docs/references/kibo/upstream/packages/patterns/accordion/subtitle/accordion-subtitle-1.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/subtitle/accordion-subtitle-1) | Two-line title/subtitle trigger with default right chevron. |
| `accordion-subtitle-2` — Subtitle with Left Icon | `docs/references/kibo/upstream/packages/patterns/accordion/subtitle/accordion-subtitle-2.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/subtitle/accordion-subtitle-2) | Adds a leading icon and indents content. |
| `accordion-subtitle-3` — Subtitle with Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/subtitle/accordion-subtitle-3.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/subtitle/accordion-subtitle-3) | Two-line trigger with the default chevron hidden in favor of end Plus/Minus icons. |
| `accordion-subtitle-4` — Icon, Subtitle, and Chevron | `docs/references/kibo/upstream/packages/patterns/accordion/subtitle/accordion-subtitle-4.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/subtitle/accordion-subtitle-4) | Leading icon, two-line title/subtitle, default chevron, and indented content. |

## tabs

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `accordion-tabs-1` — Tabs with Left Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/tabs/accordion-tabs-1.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/tabs/accordion-tabs-1) | Separately rounded, gapped cards rather than connected rows; left Plus/Minus indicator. |
| `accordion-tabs-2` — Tabs | `docs/references/kibo/upstream/packages/patterns/accordion/tabs/accordion-tabs-2.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/tabs/accordion-tabs-2) | Separately rounded, gapped cards with default chevrons. |
| `accordion-tabs-3` — Tabs with Plus Trigger | `docs/references/kibo/upstream/packages/patterns/accordion/tabs/accordion-tabs-3.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/tabs/accordion-tabs-3) | Card layout with end Plus/Minus state indicator. |
| `accordion-tabs-4` — Tabs with Left Chevron | `docs/references/kibo/upstream/packages/patterns/accordion/tabs/accordion-tabs-4.tsx` | [preview](https://www.kibo-ui.com/patterns/accordion/tabs/accordion-tabs-4) | Card layout with the wrapper’s chevron moved left and content indented. |

---

# Alert

**Required imports:** all patterns import `Alert` and `AlertTitle`; description variants add `AlertDescription`; action variants add `Button`. “Everything” variants import one Lucide icon. `[Alert source](../upstream/packages/shadcn-ui/components/ui/alert.tsx)` and `[Button source](../upstream/packages/shadcn-ui/components/ui/button.tsx)`.

**Common behavior and boundary:** these are static alert layouts. Buttons have visible labels but no `onClick`, navigation, dismissal state, retry, or mutation behavior. Keep the selected composition, then wire actions and decide whether an alert should remain mounted, be dismissible, or announce a later update. `role="alert"` is supplied by the wrapper, but no browser/accessibility test was run. Family color classes (`info`, `success`, `warning`) require compatible project tokens.

## error

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-error-1` — Error with Title | `docs/references/kibo/upstream/packages/patterns/alert/error/alert-error-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/error/alert-error-1) | Destructive-tinted bordered alert with title only. |
| `alert-error-2` — Error with Title and Description | `docs/references/kibo/upstream/packages/patterns/alert/error/alert-error-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/error/alert-error-2) | Adds a destructive-toned explanation. |
| `alert-error-3` — Error with Title and Action | `docs/references/kibo/upstream/packages/patterns/alert/error/alert-error-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/error/alert-error-3) | Title plus Retry destructive button and Dismiss outline button. |
| `alert-error-4` — Error with Title, Description, and Action | `docs/references/kibo/upstream/packages/patterns/alert/error/alert-error-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/error/alert-error-4) | Adds the explanation to the -3 action layout. |
| `alert-error-5` — Error with Everything | `docs/references/kibo/upstream/packages/patterns/alert/error/alert-error-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/error/alert-error-5) | CircleX icon, title/description column, and end-aligned Retry/Dismiss buttons in a horizontal flex layout. |

## info

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-info-1` — Info with Title | `docs/references/kibo/upstream/packages/patterns/alert/info/alert-info-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/info/alert-info-1) | Info-tinted bordered alert with title only. |
| `alert-info-2` — Info with Title and Description | `docs/references/kibo/upstream/packages/patterns/alert/info/alert-info-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/info/alert-info-2) | Adds explanation text. |
| `alert-info-3` — Info with Title and Action | `docs/references/kibo/upstream/packages/patterns/alert/info/alert-info-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/info/alert-info-3) | Title plus custom info-color Learn More button and outline Dismiss button. |
| `alert-info-4` — Info with Title, Description, and Action | `docs/references/kibo/upstream/packages/patterns/alert/info/alert-info-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/info/alert-info-4) | Adds explanation to the action layout. |
| `alert-info-5` — Info with Everything | `docs/references/kibo/upstream/packages/patterns/alert/info/alert-info-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/info/alert-info-5) | Info icon, title/description column, and Learn More/Dismiss actions in horizontal layout. |

## standard

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-standard-1` — Standard with Title | `docs/references/kibo/upstream/packages/patterns/alert/standard/alert-standard-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/standard/alert-standard-1) | Default Alert appearance with a “Success” title only. |
| `alert-standard-2` — Standard with Title and Description | `docs/references/kibo/upstream/packages/patterns/alert/standard/alert-standard-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/standard/alert-standard-2) | Default appearance plus description. |
| `alert-standard-3` — Standard with Title and Action | `docs/references/kibo/upstream/packages/patterns/alert/standard/alert-standard-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/standard/alert-standard-3) | Title plus default View Details and outline Dismiss buttons. |
| `alert-standard-4` — Standard with Title, Description, and Action | `docs/references/kibo/upstream/packages/patterns/alert/standard/alert-standard-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/standard/alert-standard-4) | Description plus View Details/Dismiss actions. |
| `alert-standard-5` — Standard with Everything | `docs/references/kibo/upstream/packages/patterns/alert/standard/alert-standard-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/standard/alert-standard-5) | CircleCheck icon, title/description, and end-aligned View Details/Dismiss. |

## success

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-success-1` — Success with Title | `docs/references/kibo/upstream/packages/patterns/alert/success/alert-success-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/success/alert-success-1) | Success-tinted bordered title alert. |
| `alert-success-2` — Success with Title and Description | `docs/references/kibo/upstream/packages/patterns/alert/success/alert-success-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/success/alert-success-2) | Adds success-toned explanation. |
| `alert-success-3` — Success with Title and Action | `docs/references/kibo/upstream/packages/patterns/alert/success/alert-success-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/success/alert-success-3) | Custom success-color View Details plus outline Dismiss. |
| `alert-success-4` — Success with Title, Description, and Action | `docs/references/kibo/upstream/packages/patterns/alert/success/alert-success-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/success/alert-success-4) | Explanation plus View Details/Dismiss. |
| `alert-success-5` — Success with Everything | `docs/references/kibo/upstream/packages/patterns/alert/success/alert-success-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/success/alert-success-5) | CircleCheck icon, title/description, and end-aligned View Details/Dismiss. |

## warning

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-warning-1` — Warning with Title | `docs/references/kibo/upstream/packages/patterns/alert/warning/alert-warning-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/warning/alert-warning-1) | Warning-tinted bordered title alert. |
| `alert-warning-2` — Warning with Title and Description | `docs/references/kibo/upstream/packages/patterns/alert/warning/alert-warning-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/warning/alert-warning-2) | Adds warning-toned explanation. |
| `alert-warning-3` — Warning with Title and Action | `docs/references/kibo/upstream/packages/patterns/alert/warning/alert-warning-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/warning/alert-warning-3) | Custom warning-color Proceed plus outline Cancel. |
| `alert-warning-4` — Warning with Title, Description, and Action | `docs/references/kibo/upstream/packages/patterns/alert/warning/alert-warning-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/warning/alert-warning-4) | Explanation plus Proceed/Cancel actions. |
| `alert-warning-5` — Warning with Everything | `docs/references/kibo/upstream/packages/patterns/alert/warning/alert-warning-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert/warning/alert-warning-5) | TriangleAlert icon, title/description, and end-aligned Proceed/Cancel. |

---

# Alert Dialog

**Required imports:** every variant imports the dialog parts it renders from `@/components/ui/alert-dialog` and a trigger `Button`. Forms additionally use `Input`, `Label`, `Textarea`, `Select`, `RadioGroup`, or `Checkbox` as applicable. Icon-oriented variants use `lucide-react`. Supporting primitives are in `docs/references/kibo/upstream/packages/shadcn-ui/components/ui/`.

**Common behavior and boundary:** every example uses uncontrolled `<AlertDialog>` and source-level trigger/action/cancel composition only. No action callback performs the described operation. Production use must supply application actions, error/pending state, and dynamic resource names/counts. Form controls are mostly uncontrolled and are not wrapped in `<form>` or submitted. Although wrappers use Radix primitives, this analysis does not claim browser, keyboard, focus-return, screen-reader, or visual validation.

## confirmation

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-dialog-confirmation-1` — Simple Confirmation Dialog | `docs/references/kibo/upstream/packages/patterns/alert-dialog/confirmation/alert-dialog-confirmation-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/confirmation/alert-dialog-confirmation-1) | Standard header, destructive-consequence copy, Cancel and Continue. |
| `alert-dialog-confirmation-2` — Confirmation with Icon | `docs/references/kibo/upstream/packages/patterns/alert-dialog/confirmation/alert-dialog-confirmation-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/confirmation/alert-dialog-confirmation-2) | Amber AlertCircle beside title; Go Back/Continue labels. |
| `alert-dialog-confirmation-3` — Confirmation with Detailed Description | `docs/references/kibo/upstream/packages/patterns/alert-dialog/confirmation/alert-dialog-confirmation-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/confirmation/alert-dialog-confirmation-3) | Transfer Ownership dialog with a four-item consequence list inside the description. |
| `alert-dialog-confirmation-4` — Confirmation with Custom Button Labels | `docs/references/kibo/upstream/packages/patterns/alert-dialog/confirmation/alert-dialog-confirmation-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/confirmation/alert-dialog-confirmation-4) | Standard structure with symmetric, context-specific Stay/Leave Workspace labels. |
| `alert-dialog-confirmation-5` — Confirmation with Short Content | `docs/references/kibo/upstream/packages/patterns/alert-dialog/confirmation/alert-dialog-confirmation-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/confirmation/alert-dialog-confirmation-5) | Minimal single-sentence completion confirmation. |
| `alert-dialog-confirmation-6` — Confirmation with Centered Icon | `docs/references/kibo/upstream/packages/patterns/alert-dialog/confirmation/alert-dialog-confirmation-6.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/confirmation/alert-dialog-confirmation-6) | Centered HelpCircle in a blue circular container; centered header copy; Not Now/Enable actions. |

## custom-actions

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-dialog-custom-actions-1` — Actions with Icons | `docs/references/kibo/upstream/packages/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-1) | External-link warning with an ExternalLink icon inside Continue. |
| `alert-dialog-custom-actions-2` — Vertical Button Stack | `docs/references/kibo/upstream/packages/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-2) | Footer deliberately remains a vertical stack: Edit, Duplicate, Share, Cancel. The middle two are plain Buttons, not AlertDialogActions. |
| `alert-dialog-custom-actions-3` — Mixed Button Styles | `docs/references/kibo/upstream/packages/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-3) | Split footer: Cancel at left; outline On Hold and green Complete at right. |
| `alert-dialog-custom-actions-4` — Actions with Loading State | `docs/references/kibo/upstream/packages/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-4) | Download-icon trigger/action plus static file-size and format details. Despite title, source contains no loading state. |
| `alert-dialog-custom-actions-5` — Split Actions Layout | `docs/references/kibo/upstream/packages/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/custom-actions/alert-dialog-custom-actions-5) | Save as Draft plain Button separated from Cancel/Publish Now group. |

## destructive

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-dialog-destructive-1` — Simple Delete Confirmation | `docs/references/kibo/upstream/packages/patterns/alert-dialog/destructive/alert-dialog-destructive-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/destructive/alert-dialog-destructive-1) | Destructive trigger and custom destructive Action styling. |
| `alert-dialog-destructive-2` — Delete Confirmation with Icon | `docs/references/kibo/upstream/packages/patterns/alert-dialog/destructive/alert-dialog-destructive-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/destructive/alert-dialog-destructive-2) | Trash2 beside title, otherwise standard destructive footer. |
| `alert-dialog-destructive-3` — Destructive with Checkbox Confirmation | `docs/references/kibo/upstream/packages/patterns/alert-dialog/destructive/alert-dialog-destructive-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/destructive/alert-dialog-destructive-3) | Centered warning icon/copy and labeled checkbox confirmation panel. Checkbox is not bound to or gating Delete Account. |
| `alert-dialog-destructive-4` — Destructive with Consequence Details | `docs/references/kibo/upstream/packages/patterns/alert-dialog/destructive/alert-dialog-destructive-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/destructive/alert-dialog-destructive-4) | Red-tinted panel contains a four-item consequence list. |
| `alert-dialog-destructive-5` — Destructive with Custom Styled Buttons | `docs/references/kibo/upstream/packages/patterns/alert-dialog/destructive/alert-dialog-destructive-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/destructive/alert-dialog-destructive-5) | X icon beside title and inside destructive action; custom Keep Member label. |
| `alert-dialog-destructive-6` — Destructive with Warning Badge | `docs/references/kibo/upstream/packages/patterns/alert-dialog/destructive/alert-dialog-destructive-6.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/destructive/alert-dialog-destructive-6) | Database icon in title and a styled “Permanent Action” text badge. |
| `alert-dialog-destructive-7` — Destructive with Item Count | `docs/references/kibo/upstream/packages/patterns/alert-dialog/destructive/alert-dialog-destructive-7.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/destructive/alert-dialog-destructive-7) | Hard-coded count `24` in title/action plus a destructive warning panel. Replace every count and dependency warning with live data. |

## form

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-dialog-form-1` — Single Input Dialog | `docs/references/kibo/upstream/packages/patterns/alert-dialog/form/alert-dialog-form-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/form/alert-dialog-form-1) | Labeled project-name input with hard-coded `defaultValue="Untitled Project"`. |
| `alert-dialog-form-2` — Multiple Inputs Dialog | `docs/references/kibo/upstream/packages/patterns/alert-dialog/form/alert-dialog-form-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/form/alert-dialog-form-2) | Subject input plus Message textarea, each with labels. |
| `alert-dialog-form-3` — Form with Select | `docs/references/kibo/upstream/packages/patterns/alert-dialog/form/alert-dialog-form-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/form/alert-dialog-form-3) | Email input and role Select with static Admin/Member/Viewer options, defaulting to Member. |
| `alert-dialog-form-4` — Form with Description | `docs/references/kibo/upstream/packages/patterns/alert-dialog/form/alert-dialog-form-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/form/alert-dialog-form-4) | API-key-name input plus descriptive helper text. |
| `alert-dialog-form-5` — Form with Validation State | `docs/references/kibo/upstream/packages/patterns/alert-dialog/form/alert-dialog-form-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/form/alert-dialog-form-5) | Static mismatch error for `my-project`; Transfer is permanently `disabled` in the example. No validation logic exists. |
| `alert-dialog-form-6` — Form with Radio Group | `docs/references/kibo/upstream/packages/patterns/alert-dialog/form/alert-dialog-form-6.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/form/alert-dialog-form-6) | Default JSON RadioGroup with three bordered, label-associated format choices. |
| `alert-dialog-form-7` — Form with Checkboxes | `docs/references/kibo/upstream/packages/patterns/alert-dialog/form/alert-dialog-form-7.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/form/alert-dialog-form-7) | Email/push default checked and SMS unchecked notification preferences, with labels and descriptive text. |

**Form caveat:** labels/IDs are present in the source, but no form serialization, validation, submit prevention, action binding, async pending state, or error recovery is implemented.

## informational

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-dialog-informational-1` — Simple Information Alert | `docs/references/kibo/upstream/packages/patterns/alert-dialog/informational/alert-dialog-informational-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/informational/alert-dialog-informational-1) | Standard information copy with a single OK Action and no Cancel. |
| `alert-dialog-informational-2` — Information with Icon | `docs/references/kibo/upstream/packages/patterns/alert-dialog/informational/alert-dialog-informational-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/informational/alert-dialog-informational-2) | Blue Info icon beside title, single Got it Action. |
| `alert-dialog-informational-3` — Information with Long Content | `docs/references/kibo/upstream/packages/patterns/alert-dialog/informational/alert-dialog-informational-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/informational/alert-dialog-informational-3) | Long description is constrained to `max-h-60` with vertical scrolling and includes a list. |
| `alert-dialog-informational-4` — Information with Action Button | `docs/references/kibo/upstream/packages/patterns/alert-dialog/informational/alert-dialog-informational-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/informational/alert-dialog-informational-4) | Bell icon, Not Now Cancel, and Learn More Action. |
| `alert-dialog-informational-5` — Information with Centered Icon | `docs/references/kibo/upstream/packages/patterns/alert-dialog/informational/alert-dialog-informational-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/informational/alert-dialog-informational-5) | Centered lightbulb treatment and keyboard-shortcut (`Cmd+K`) copy. |
| `alert-dialog-informational-6` — Information with Status Badge | `docs/references/kibo/upstream/packages/patterns/alert-dialog/informational/alert-dialog-informational-6.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/informational/alert-dialog-informational-6) | Calendar title icon and styled static “Upcoming” badge. |
| `alert-dialog-informational-7` — Information with Highlighted Content | `docs/references/kibo/upstream/packages/patterns/alert-dialog/informational/alert-dialog-informational-7.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/informational/alert-dialog-informational-7) | Sparkles trigger and three static feature highlight cards outside the header. |

## success

| ID / title | Local source | Preview | Source-established composition |
|---|---|---|---|
| `alert-dialog-success-1` — Simple Success Message | `docs/references/kibo/upstream/packages/patterns/alert-dialog/success/alert-dialog-success-1.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/success/alert-dialog-success-1) | Standard success copy with one Continue Action. |
| `alert-dialog-success-2` — Success with Icon | `docs/references/kibo/upstream/packages/patterns/alert-dialog/success/alert-dialog-success-2.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/success/alert-dialog-success-2) | Green CheckCircle2 beside payment title. |
| `alert-dialog-success-3` — Success with Centered Icon | `docs/references/kibo/upstream/packages/patterns/alert-dialog/success/alert-dialog-success-3.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/success/alert-dialog-success-3) | Centered green circular icon treatment and centered account-created copy. |
| `alert-dialog-success-4` — Success with Next Steps | `docs/references/kibo/upstream/packages/patterns/alert-dialog/success/alert-dialog-success-4.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/success/alert-dialog-success-4) | Icon title plus a numbered three-step next-actions block. |
| `alert-dialog-success-5` — Success with Summary Details | `docs/references/kibo/upstream/packages/patterns/alert-dialog/success/alert-dialog-success-5.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/success/alert-dialog-success-5) | Green-tinted bordered summary grid with hard-coded upload totals/status. |
| `alert-dialog-success-6` — Success with Multiple Actions | `docs/references/kibo/upstream/packages/patterns/alert-dialog/success/alert-dialog-success-6.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/success/alert-dialog-success-6) | Centered invitation-success treatment with Close Cancel and Invite Another Action. |
| `alert-dialog-success-7` — Success with Celebration | `docs/references/kibo/upstream/packages/patterns/alert-dialog/success/alert-dialog-success-7.tsx` | [preview](https://www.kibo-ui.com/patterns/alert-dialog/success/alert-dialog-success-7) | Centered PartyPopper gradient icon, gradient “Achievement Unlocked” panel, and hard-coded milestone copy. |

## Coverage and missing inputs

- **Covered:** all cataloged files in `packages/patterns/accordion/` (21), `packages/patterns/alert/` (25), and `packages/patterns/alert-dialog/` (39): **85/85**.
- **Demo-only inputs identified:** faker-generated accordion records; hard-coded dialog resource names, counts, choices, file metadata, status labels, next steps, and achievement text; static form defaults/errors.
- **Missing production inputs:** application data models, stable IDs, mutations/navigation, controlled state decisions, async/loading/error behavior, form validation/submission rules, and authorization/product confirmation requirements.
- **Not claimed:** preview availability, visual fidelity, runtime behavior, browser behavior, or accessibility validation.
