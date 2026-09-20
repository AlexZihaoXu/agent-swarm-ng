# Patterns: input, input-group, input-otp

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

Read-only review of the local Kibo mirror pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (project `HEAD` supplied for this run: `389caad059016ad1a9b9b61f58d3723aaf42fe90`). Snapshot provenance, scope, and the explicit limitation that it is source-only are recorded in [`docs/references/kibo/VERIFICATION.md`](../VERIFICATION.md). Project constraints were read from [`AGENTS.md`](../../../../AGENTS.md) and [`README.md`](../../../../README.md).

This report covers only `input-group`, `input-otp`, and `input`. It is based on local source reading; neither the website previews nor a browser/runtime were opened or validated. Upstream material is reference data, not project instruction.

**Inventory notation.** Each table's **Source** is a path relative to `docs/references/kibo/upstream/packages/patterns/<family>/`; its full local root and canonical preview root are stated in that family heading. Titles, IDs, collections, exact source suffixes, and preview URLs come from the corresponding generated local catalog, linked below. Therefore every row gives both exact local source and preview path without reproducing the already mirrored file.

## Shared implementation context

| Primitive / dependency | What the local source establishes | Adaptation consequence |
| --- | --- | --- |
| [`input.tsx`](../upstream/packages/shadcn-ui/components/ui/input.tsx#L1-L21) | A thin native `<input>` wrapper; forwards native props, has focus and `aria-invalid` styling, native file styling, and disabled styling. | Use actual native attributes and application validation; the component itself does not validate or associate error copy. |
| [`input-group.tsx`](../upstream/packages/shadcn-ui/components/ui/input-group.tsx#L8-L170) | `InputGroup` is a `div role="group"`; `Addon` supports inline/block placement and focuses the first descendant `input` when the addon (not a nested button) is clicked; `InputGroupInput`/`Textarea` remove their own border and let the group show focus/error. `InputGroupButton` wraps `Button`, defaulting to `type="button"`, ghost, `xs`. | Preserve the group/control/addon hierarchy and choose placement rather than copying ad-hoc padding. Do not assume an addon click focuses a textarea: its source queries only `input`. |
| [`input-otp.tsx`](../upstream/packages/shadcn-ui/components/ui/input-otp.tsx#L1-L77) | Wraps the external `input-otp` package's `OTPInput`/context. Slots render context chars and fake caret; separator is `role="separator"` with a minus icon. | Requires the external `input-otp` dependency and its behavior. The local wrapper supplies visual slots, not server verification, rate limiting, or OTP lifecycle. |
| [`form.tsx`](../upstream/packages/shadcn-ui/components/ui/form.tsx#L1-L167) | React Hook Form integration: `FormControl` injects `id`, `aria-describedby`, and `aria-invalid` from field state; descriptions/messages get generated IDs. | The OTP form examples need `react-hook-form`, `zod`, and `@hookform/resolvers/zod`; retain this composition only when using that stack, otherwise reproduce equivalent labeling/error association. |
| [`button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L1-L60), [`label.tsx`](../upstream/packages/shadcn-ui/components/ui/label.tsx#L1-L24) | Button is a native button wrapper with focus/disabled styles; Label wraps Radix Label. | Icon-only application actions need accessible names; using these primitives does not add them automatically. |
| [`tooltip.tsx`](../upstream/packages/shadcn-ui/components/ui/tooltip.tsx#L1-L61), [`dropdown-menu.tsx`](../upstream/packages/shadcn-ui/components/ui/dropdown-menu.tsx#L1-L98) | Tooltip and dropdown wrappers delegate interaction/portal behavior to Radix UI. Tooltip creates a zero-delay provider by default; dropdown content is portaled. | The examples' menus/tooltips are compositional UI only. Connect menu selection and tooltip-provider policy deliberately. |

## input-group

**Catalog:** [`docs/references/kibo/catalog/patterns/input-group.md`](../catalog/patterns/input-group.md). **Local source root:** `docs/references/kibo/upstream/packages/patterns/input-group/`. **Preview root:** `https://www.kibo-ui.com/patterns/input-group/`.

All rows import the input-group primitives above; `lucide-react` imports are presentation icons. The source shows most visible actions as inert demo buttons: only copy/favorite/password-visibility have local state. None send a prompt, upload a file, select/persist a dropdown value, format rich text, calculate counters, or run/search/submit.

### ai

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-ai-1` — AI Prompt Input | `ai/input-group-ai-1.tsx` | `/ai/input-group-ai-1` | Textarea plus block-end add-on: plus icon, Radix mode menu, static `52% used`, separator, disabled send. Includes a demo link to AI Elements. |
| `input-group-ai-2` — Simple AI Prompt | `ai/input-group-ai-2.tsx` | `/ai/input-group-ai-2` | Minimal textarea footer: sparkle button, static `0/4000`, separator, enabled send; the same external demo link. |
| `input-group-ai-3` — AI with Attachments | `ai/input-group-ai-3.tsx` | `/ai/input-group-ai-3` | Textarea footer has a dropdown headed by file icon (File/Image menu labels), static `GPT-4`, and send; no file input or selection handler. |
| `input-group-ai-4` — AI with Voice | `ai/input-group-ai-4.tsx` | `/ai/input-group-ai-4` | Textarea footer pairs paperclip and mic buttons with a model dropdown, separator, and send; no attachment or microphone implementation. |

### buttons

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-buttons-1` — Copy Button | `buttons/input-group-buttons-1.tsx` | `/buttons/input-group-buttons-1` | Read-only URL plus labelled copy button; changes icon to check for 2 seconds, but never calls Clipboard API. |
| `input-group-buttons-2` — Multiple Action Buttons | `buttons/input-group-buttons-2.tsx` | `/buttons/input-group-buttons-2` | Read-only URL and two separate end add-ons: inert labelled Info and labelled Favorite, whose heart fill toggles local state. |
| `input-group-buttons-3` — Search Button | `buttons/input-group-buttons-3.tsx` | `/buttons/input-group-buttons-3` | Free-text input with a secondary text-and-icon Search end button; no submit/search handler. |
| `input-group-buttons-4` — Password Actions | `buttons/input-group-buttons-4.tsx` | `/buttons/input-group-buttons-4` | Password input with labelled visibility toggle (working local `type` state) and labelled Generate icon with no generator. |

### custom

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-custom-1` — Textarea with Actions | `custom/input-group-custom-1.tsx` | `/custom/input-group-custom-1` | 100px textarea and block-end, right-aligned Submit button; no action. |
| `input-group-custom-2` — Textarea with Counter | `custom/input-group-custom-2.tsx` | `/custom/input-group-custom-2` | `maxLength=500` textarea footer with hard-coded `0/500` and Post/send button. |
| `input-group-custom-3` — Textarea with Toolbar | `custom/input-group-custom-3.tsx` | `/custom/input-group-custom-3` | Block-start bordered Bold/Italic/Underline icon toolbar and block-end Submit; no editor commands. |
| `input-group-custom-4` — Textarea with Label | `custom/input-group-custom-4.tsx` | `/custom/input-group-custom-4` | `Label htmlFor="comment"` is inside a block-start add-on before its textarea, followed by Post Comment; the label/control association is present, action is not. |

### dropdown

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-dropdown-1` — Dropdown Actions | `dropdown/input-group-dropdown-1.tsx` | `/dropdown/input-group-dropdown-1` | File-name input with labelled More trigger and Settings/Copy path/Open location menu; items have no callbacks. |
| `input-group-dropdown-2` — Search Filters | `dropdown/input-group-dropdown-2.tsx` | `/dropdown/input-group-dropdown-2` | Rounded search field with Category trigger and static category menu; menu selection does not change the trigger/filter. |
| `input-group-dropdown-3` — URL Builder with Dropdown | `dropdown/input-group-dropdown-3.tsx` | `/dropdown/input-group-dropdown-3` | Two examples: leading scheme menu and trailing TLD menu; neither selection constructs a URL. |
| `input-group-dropdown-4` — Textarea with Dropdown | `dropdown/input-group-dropdown-4.tsx` | `/dropdown/input-group-dropdown-4` | Textarea with bordered footer: Format dropdown and Send; Plain/Markdown/HTML labels are not applied. |

### icons

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-icons-1` — Search with Icon | `icons/input-group-icons-1.tsx` | `/icons/input-group-icons-1` | Single search input with a leading search-icon addon. |
| `input-group-icons-2` — Contact Fields with Icons | `icons/input-group-icons-2.tsx` | `/icons/input-group-icons-2` | Two controls with native `email`/`tel` types and leading mail/phone icons. |
| `input-group-icons-3` — Dual Icons | `icons/input-group-icons-3.tsx` | `/icons/input-group-icons-3` | Card and password examples use leading and trailing static icons around a control. |
| `input-group-icons-4` — Multiple Icons | `icons/input-group-icons-4.tsx` | `/icons/input-group-icons-4` | Password/API-key examples arrange multiple static end icons; icons are not buttons and do not toggle/generate. |

### label

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-label-1` — Inline Labels | `label/input-group-label-1.tsx` | `/label/input-group-label-1` | Uses actual labels inside end/start add-ons for `@` and `$`; both are linked by `htmlFor`. |
| `input-group-label-2` — Label with Tooltip | `label/input-group-label-2.tsx` | `/label/input-group-label-2` | Block-start Email label plus labelled Help tooltip trigger; tooltip explains notification use. |
| `input-group-label-3` — Block Labels | `label/input-group-label-3.tsx` | `/label/input-group-label-3` | Block-start labels for input and textarea; textarea label add-on gets a border-bottom. |
| `input-group-label-4` — Label with Counter | `label/input-group-label-4.tsx` | `/label/input-group-label-4` | Block-start Title label and static `0/60`, while control has `maxLength=60`; no state update. |

### spinner

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-spinner-1` — Loading States | `spinner/input-group-spinner-1.tsx` | `/spinner/input-group-spinner-1` | Two disabled controls, `data-disabled` group, and Spinner at opposite inline positions. |
| `input-group-spinner-2` — Spinner with Text | `spinner/input-group-spinner-2.tsx` | `/spinner/input-group-spinner-2` | Disabled Saving input with trailing static `Saving...` and Spinner. |
| `input-group-spinner-3` — Animated Icon Spinner | `spinner/input-group-spinner-3.tsx` | `/spinner/input-group-spinner-3` | Disabled control with leading animated Lucide loader and trailing `Please wait...`. |
| `input-group-spinner-4` — Textarea Loading | `spinner/input-group-spinner-4.tsx` | `/spinner/input-group-spinner-4` | Disabled 100px textarea with bordered block footer spinner, plus disabled uploading input. |

### text

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-text-1` — Currency Input | `text/input-group-text-1.tsx` | `/text/input-group-text-1` | Two free-text controls framed by static `$`/`USD` and `€`/`EUR`; no numeric/currency parsing. |
| `input-group-text-2` — URL Builder | `text/input-group-text-2.tsx` | `/text/input-group-text-2` | Leading `https://` and trailing `.com` static text around a single input. |
| `input-group-text-3` — Email with Domain | `text/input-group-text-3.tsx` | `/text/input-group-text-3` | Username input with static `@vercel.com`; source does not set native `email` type. |
| `input-group-text-4` — Character Counter | `text/input-group-text-4.tsx` | `/text/input-group-text-4` | `maxLength=280` input plus hard-coded `0/280`; not a live counter. |

### textarea

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-textarea-1` — Code Editor | `textarea/input-group-textarea-1.tsx` | `/textarea/input-group-textarea-1` | 200px textarea with block-start filename/refresh and block-end static cursor position/Run. It is not a code editor or runner. |
| `input-group-textarea-2` — Character Counter | `textarea/input-group-textarea-2.tsx` | `/textarea/input-group-textarea-2` | 120px `maxLength=500` textarea and static `0/500` footer. |
| `input-group-textarea-3` — Rich Text Toolbar | `textarea/input-group-textarea-3.tsx` | `/textarea/input-group-textarea-3` | 150px plaintext textarea with bordered Bold/Italic/Underline/Link/List buttons; no formatting behavior. |
| `input-group-textarea-4` — Chat Input | `textarea/input-group-textarea-4.tsx` | `/textarea/input-group-textarea-4` | 80px textarea with bordered footer, Emoji button, static `0/2000`, and Send; no emoji picker or send handler. |

### tooltip

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-group-tooltip-1` — Password Requirements | `tooltip/input-group-tooltip-1.tsx` | `/tooltip/input-group-tooltip-1` | Two password controls with individual info tooltips, enclosed in an explicit provider. Requirements are explanatory only. |
| `input-group-tooltip-2` — Help Tooltips | `tooltip/input-group-tooltip-2.tsx` | `/tooltip/input-group-tooltip-2` | Email control with help-tooltip icon and privacy copy. |
| `input-group-tooltip-3` — API Key Info | `tooltip/input-group-tooltip-3.tsx` | `/tooltip/input-group-tooltip-3` | Password-type API-key control with info tooltip; no show/copy/validation behavior. |

**input-group adaptation boundaries and caveats.** Keep labels associated with their controls and retain existing explicit labels/sr-only send text where present. Add accessible names to copied icon-only controls that lack them (for example AI, toolbar, static icon, and several tooltip triggers), and make live counters genuinely derived from controlled values. Treat all AI model, attachment, speech, search, format, password generation, execution, and submission UI as presentation until real application behavior, error handling, and disabled/pending states are supplied. No accessibility or browser interaction validation was performed.

## input-otp

**Catalog:** [`docs/references/kibo/catalog/patterns/input-otp.md`](../catalog/patterns/input-otp.md). **Local source root:** `docs/references/kibo/upstream/packages/patterns/input-otp/`. **Preview root:** `https://www.kibo-ui.com/patterns/input-otp/`.

Every variant composes `InputOTP`, group(s), indexed slot(s), and often separators from the wrapper cited above. The local wrapper imports `OTPInput` and `OTPInputContext` from external `input-otp`; its implementation is not present in this source snapshot. Form examples additionally import `react-hook-form`, Zod/resolver, and Sonner; icons are from `lucide-react`.

### standard

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-otp-standard-1` — Standard OTP Input | `standard/input-otp-standard-1.tsx` | `/standard/input-otp-standard-1` | Uncontrolled six-slot OTP arranged 3 + separator + 3. |
| `input-otp-standard-2` — OTP with Pattern Validation | `standard/input-otp-standard-2.tsx` | `/standard/input-otp-standard-2` | Uncontrolled contiguous six slots with `REGEXP_ONLY_DIGITS_AND_CHARS` from `input-otp`. |
| `input-otp-standard-3` — OTP with Multiple Separators | `standard/input-otp-standard-3.tsx` | `/standard/input-otp-standard-3` | Six slots arranged as three groups of two, separated twice. |
| `input-otp-standard-4` — Controlled OTP Input | `standard/input-otp-standard-4.tsx` | `/standard/input-otp-standard-4` | Local controlled value renders either prompt text or `You entered: {value}`. |
| `input-otp-standard-5` — OTP in Form with Validation | `standard/input-otp-standard-5.tsx` | `/standard/input-otp-standard-5` | RHF/Zod field requiring min six characters, with label, description, FormMessage, submit button, and a success toast that echoes the submitted pin. |

### behavior

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-otp-behavior-1` — Auto-submit OTP | `behavior/input-otp-behavior-1.tsx` | `/behavior/input-otp-behavior-1` | RHF/Zod six-character field calls `handleSubmit` once length reaches six and shows a toast; no network verification. |
| `input-otp-behavior-2` — OTP with Enhanced Focus Management | `behavior/input-otp-behavior-2.tsx` | `/behavior/input-otp-behavior-2` | Controlled OTP receives a ref; clicking its surrounding `div` calls `focus()` on the input. |
| `input-otp-behavior-3` — OTP with Paste Optimization | `behavior/input-otp-behavior-3.tsx` | `/behavior/input-otp-behavior-3` | Button reads `navigator.clipboard`, strips non-digits, takes six, and sets local value; failures only `console.error`. |
| `input-otp-behavior-4` — OTP with Resend Flow | `behavior/input-otp-behavior-4.tsx` | `/behavior/input-otp-behavior-4` | Local 60-second timeout gates Resend; resend resets timer/value and only logs to console. |

### states

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-otp-states-1` — Disabled OTP Input | `states/input-otp-states-1.tsx` | `/states/input-otp-states-1` | Disabled six-slot 3+3 layout plus static explanation. |
| `input-otp-states-2` — OTP with Loading State | `states/input-otp-states-2.tsx` | `/states/input-otp-states-2` | On length six, local state shows a spinner and `Verifying code...` for 2 seconds; OTP is not disabled and no verification happens. |
| `input-otp-states-3` — OTP with Error State | `states/input-otp-states-3.tsx` | `/states/input-otp-states-3` | Rejects every completed value except literal `123456`, shakes wrapper and displays error/hint. It does **not** pass `aria-invalid` to the OTP. |
| `input-otp-states-4` — OTP with Success State | `states/input-otp-states-4.tsx` | `/states/input-otp-states-4` | After any six characters, marks success after 500ms, disables OTP, and shows success copy; simulated rather than verified. |

### use-cases

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-otp-use-cases-1` — Email Verification Flow | `use-cases/input-otp-use-cases-1.tsx` | `/use-cases/input-otp-use-cases-1` | Centered email header with hard-coded `user@example.com`, RHF/Zod code input, simulated 1.5s verification and toast; Resend button has no handler. |
| `input-otp-use-cases-2` — Two-Factor Authentication | `use-cases/input-otp-use-cases-2.tsx` | `/use-cases/input-otp-use-cases-2` | Toggles between OTP and native backup-code input; Zod makes only OTP min-six and backup code optional, while submit only toasts supplied values. |
| `input-otp-use-cases-3` — SMS Verification | `use-cases/input-otp-use-cases-3.tsx` | `/use-cases/input-otp-use-cases-3` | Hard-coded phone number, RHF/Zod form, 60-second local resend gate; resend resets form and emits an info toast, verification emits success toast. |
| `input-otp-use-cases-4` — Transaction Confirmation | `use-cases/input-otp-use-cases-4.tsx` | `/use-cases/input-otp-use-cases-4` | Transaction copy and security Alert precede the form; submit simulates 1.5s confirmation/toast, Cancel only emits an info toast. |

### variants

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-otp-variants-1` — Numeric Only OTP | `variants/input-otp-variants-1.tsx` | `/variants/input-otp-variants-1` | Uses `inputMode="numeric"` and `REGEXP_ONLY_DIGITS`, then notes mobile numeric keyboard. |
| `input-otp-variants-2` — Masked OTP Input | `variants/input-otp-variants-2.tsx` | `/variants/input-otp-variants-2` | Local visibility toggle conditionally applies CSS `blur-sm`/`select-none` to the rendered OTP. This is visual obfuscation, not secret input masking. |
| `input-otp-variants-3` — Different Length OTP Variants | `variants/input-otp-variants-3.tsx` | `/variants/input-otp-variants-3` | Presents uncontrolled 4-slot, 6-slot 3+3, and 8-slot 4+4 arrangements. |

**input-otp adaptation boundaries and caveats.** Use the standard/layout variants only as presentation of an application-managed challenge. Replace literal test codes, timeouts, console calls, toasts, hard-coded email/phone/transaction data, and optional backup-code validation with backend-backed issuance, verification, expiry, retry/rate-limit, cancellation, and error logic. Ensure auto-submit cannot repeatedly verify a completed value and make the appropriate pending state non-editable. Avoid treating the blurred variant as adequate OTP secrecy. State-2/state-3 copy is not shown as a live region in source; state-3 also lacks `aria-invalid`. Icon-only eye/paste controls likewise have no explicit accessible name in these files. This is source inspection only; no assertions are made about third-party `input-otp`, Radix, keyboard, paste, screen-reader, or browser behavior.

## input

**Catalog:** [`docs/references/kibo/catalog/patterns/input.md`](../catalog/patterns/input.md). **Local source root:** `docs/references/kibo/upstream/packages/patterns/input/`. **Preview root:** `https://www.kibo-ui.com/patterns/input/`.

All variants import the native-input wrapper and Label. Where shown, `Button`, React state, and Lucide icons are the only extra UI dependencies. Apart from the four local interactive demos noted below, these are static compositions; HTML input type/native constraints do not constitute application validation.

### special

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-special-1` — File Upload with List | `special/input-special-1.tsx` | `/special/input-special-1` | Multiple file input stores selected `File[]` in local state, displays name and KiB size, and removes by array index. It does not upload, validate, retain, or submit files. |
| `input-special-2` — Time Input | `special/input-special-2.tsx` | `/special/input-special-2` | Labelled native `type="time"` input with decorative-looking positioned clock icon; native browser UI is relied on. |
| `input-special-3` — Range Slider with Value | `special/input-special-3.tsx` | `/special/input-special-3` | Controlled native range 0–100, initial 50, with displayed percentage and endpoint text. |
| `input-special-4` — Disabled Input | `special/input-special-4.tsx` | `/special/input-special-4` | Disabled native text input with fixed account-ID value and explanatory copy. |
| `input-special-5` — Currency Input | `special/input-special-5.tsx` | `/special/input-special-5` | Labelled `type="number"`, `min=0`, `step=.01` control with dollar icon and USD helper text; no formatting/locale/currency validation. |

### standard

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-standard-1` — Input with Label | `standard/input-standard-1.tsx` | `/standard/input-standard-1` | Basic Label `htmlFor` plus name input. |
| `input-standard-2` — Input with Description | `standard/input-standard-2.tsx` | `/standard/input-standard-2` | Username label, free paragraph description before input; source does not associate paragraph with input. |
| `input-standard-3` — Input with Helper Text | `standard/input-standard-3.tsx` | `/standard/input-standard-3` | Email-type input with privacy helper after it; helper is not `aria-describedby` in source. |
| `input-standard-4` — Required Field | `standard/input-standard-4.tsx` | `/standard/input-standard-4` | Required native input and visible red asterisk/legend. |
| `input-standard-5` — Optional Field | `standard/input-standard-5.tsx` | `/standard/input-standard-5` | Label visibly marks middle name optional; input has no `required`. |
| `input-standard-6` — Input with Character Counter | `standard/input-standard-6.tsx` | `/standard/input-standard-6` | Controlled `maxLength=50` input; counter derives from local value length. |
| `input-standard-7` — Inline Label | `standard/input-standard-7.tsx` | `/standard/input-standard-7` | Horizontal layout with fixed-width, right-aligned Age label and number input. |

### types

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-types-1` — Email Input | `types/input-types-1.tsx` | `/types/input-types-1` | Labelled native email input with positioned mail icon. |
| `input-types-2` — Password with Toggle | `types/input-types-2.tsx` | `/types/input-types-2` | Local state toggles native input type between password/text with absolute eye button; button has no `aria-label` in source. |
| `input-types-3` — Number Input with Controls | `types/input-types-3.tsx` | `/types/input-types-3` | Controlled number, min 1, with minus capped at 1 and unbounded plus; icon buttons have no accessible names and direct typed input can set `NaN`/values below 1 in local state. |
| `input-types-4` — Search Input | `types/input-types-4.tsx` | `/types/input-types-4` | Labelled native search input with positioned search icon; no result/search logic. |
| `input-types-5` — Date Input | `types/input-types-5.tsx` | `/types/input-types-5` | Labelled native date input plus positioned calendar icon; browser date UI is not inspected. |
| `input-types-6` — Phone Input | `types/input-types-6.tsx` | `/types/input-types-6` | Native tel input with example format and helper only; no parsing or validation. |
| `input-types-7` — URL Input | `types/input-types-7.tsx` | `/types/input-types-7` | Native url input with protocol guidance; no canonicalization/validation handler. |

### validation

| ID — title | Source | Preview | Distinguishing composition / observed behavior |
| --- | --- | --- | --- |
| `input-validation-1` — Error State | `validation/input-validation-1.tsx` | `/validation/input-validation-1` | Static invalid email example has `aria-invalid="true"`, destructive styling/icon/message; message lacks an ID/`aria-describedby` association. |
| `input-validation-2` — Success State | `validation/input-validation-2.tsx` | `/validation/input-validation-2` | Static username availability copy with manually green input focus/border classes; no semantic valid state or lookup. |
| `input-validation-3` — Warning State | `validation/input-validation-3.tsx` | `/validation/input-validation-3` | Static weak-password copy with manually orange input classes; no validation handler or ARIA warning state. |
| `input-validation-4` — Multiple Validation Messages | `validation/input-validation-4.tsx` | `/validation/input-validation-4` | Static invalid password and three destructive messages; field has `aria-invalid` but messages are not associated/described. |
| `input-validation-5` — Real-time Validation | `validation/input-validation-5.tsx` | `/validation/input-validation-5` | Controlled password evaluates length, digit, uppercase, and `[!@#$%^&*]`, toggling check/X icon and color per rule; it neither sets `aria-invalid` nor exposes aggregate validity. |

**input adaptation boundaries and caveats.** Retain native `type`, `min`, `step`, `maxLength`, `required`, label association, and controlled-counter patterns when they match the product requirement, but provide server/client validation, error semantics, and submission separately. The file-list sample is only client-side selection/display: add MIME/size/count checks, upload transport/progress/error handling, and stable file identifiers before use. Add accessible names to password and quantity icon buttons; programmatically associate help/error text (`aria-describedby`) and expose validation updates appropriately. Date/time picker rendering and native constraint enforcement were not browser-validated.

## Coverage and missing inputs

- **Covered:** all catalogued source files in the assigned family directories: **39** `input-group` records across ai/buttons/custom/dropdown/icons/label/spinner/text/textarea/tooltip; **20** `input-otp` records across standard/behavior/states/use-cases/variants; and **24** `input` records across special/standard/types/validation (**83 total**). Exact ID/title/source/preview inventory is in the three cited local catalog files and the per-row paths above.
- **Read as implementation context:** local `input`, `input-group`, `input-otp`, `form`, `button`, `label`, `tooltip`, and `dropdown-menu` primitives cited in Shared implementation context.
- **Missing/unverified inputs:** no project feature brief or chosen screen/form data model; no browser/source execution; no installed dependency source for external `input-otp`, React Hook Form, Zod, Sonner, Radix, or Lucide; no backend OTP/upload/search/AI/editor API contract; and no accessibility audit. Consequently this report makes no visual, runtime, browser, third-party behavior, or accessibility-validation claim.
