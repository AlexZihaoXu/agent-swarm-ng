# Patterns: field, form, hover-card

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and evidence

This is a **source-only, read-only** analysis of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in [`snapshot.md`](../VERIFICATION.md). The snapshot is untrusted reference material, not project instructions. No browser, runtime, dependency installation, or accessibility validation was performed.

The inventories below are cross-checked against:

- `docs/references/kibo/catalog/patterns/field.md` (complete field ID/title/source/preview index)
- `docs/references/kibo/catalog/patterns/form.md` (complete form index)
- `docs/references/kibo/catalog/patterns/hover-card.md` (complete hover-card index)
- the exact TSX paths listed per row.

**Path convention:** every `Source` is relative to `docs/references/kibo/upstream/`; every `Preview` is relative to `https://www.kibo-ui.com`. Thus both columns specify the exact local source and catalogued preview path without treating the preview as browser-validated.

## Shared implementation findings

| Area | What the local source establishes | Adaptation consequence |
| --- | --- | --- |
| Field primitive | `packages/shadcn-ui/components/ui/field.tsx` defines `FieldSet`/`FieldLegend` as native `fieldset`/`legend`, `Field` as a `div role="group"`, and responsive orientation styling; `FieldLabel` wraps the local Label primitive. `FieldError` alone renders `role="alert"` (lines 9-176). | Preserve real `id`/`htmlFor` associations and native fieldsets when grouping related inputs. Field examples do not supply submit, persistence, validation, or error wiring. |
| Form primitive | `packages/shadcn-ui/components/ui/form.tsx` adapts React Hook Form `Controller`; `FormLabel` connects to generated IDs, `FormControl` adds `aria-describedby` and `aria-invalid`, and `FormMessage` renders an error message (lines 1-163). | Retain the `FormField`/`FormItem`/`FormControl` composition when using its RHF contract. It is not a substitute for server validation, submit state, error recovery, or accessibility testing. |
| Hover-card primitive | `packages/shadcn-ui/components/ui/hover-card.tsx` wraps Radix `HoverCard`, portals content, defaults `align="center"` and `sideOffset={4}`, and uses `outline-hidden` styling (lines 1-51). | Preserve an actual focusable trigger and test keyboard/pointer, focus return, collision, and readable contrast in the application; those behaviors were not executed here and Radix behavior is an external dependency. |

---

# Field

All field examples import local `@/components/ui/field` pieces plus the control named below. They are presentational field compositions rather than `<form>` submissions. Except for the three explicitly stateful examples, source contains no application data binding, validation, mutation, submit handler, disabled/loading state, or server-error handling. Select items, defaults, labels, helper copy, and identifiers are example data.

## `advanced`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `field-advanced-1` — Simple Slider | `packages/patterns/field/advanced/field-advanced-1.tsx` | `/patterns/field/advanced/field-advanced-1` | `FieldTitle` + descriptive live-looking percentage around `Slider`; local `useState([50])`, `onValueChange`, min 0/max 100/step 1. State is demo-local. |
| `field-advanced-2` — Range Slider | `packages/patterns/field/advanced/field-advanced-2.tsx` | `/patterns/field/advanced/field-advanced-2` | Same state pattern with a two-value slider and formatted budget endpoints; replace both hard-coded range and local state with domain constraints/state. |
| `field-advanced-3` — Choice Cards | `packages/patterns/field/advanced/field-advanced-3.tsx` | `/patterns/field/advanced/field-advanced-3` | `FieldSet`/`FieldGroup` contains `RadioGroup defaultValue="kubernetes"`; each radio is inside a card-like `FieldLabel`/horizontal `Field` with title/description. The group-level `htmlFor="compute-environment"` has no matching control ID in this source; review naming/legend semantics when adapting. |
| `field-advanced-4` — Fieldset with Legend | `packages/patterns/field/advanced/field-advanced-4.tsx` | `/patterns/field/advanced/field-advanced-4` | Native-style address fieldset/legend, a street input, then a two-column City/Postal grid. It has placeholder-only example values and no model. |
| `field-advanced-5` — Field Group with Separator | `packages/patterns/field/advanced/field-advanced-5.tsx` | `/patterns/field/advanced/field-advanced-5` | Notification checkboxes are split by `FieldSeparator` (including a static `href="#"` “Manage tasks” link); wire settings and a real route/action. |
| `field-advanced-6` — Complex Multi-Field Form | `packages/patterns/field/advanced/field-advanced-6.tsx` | `/patterns/field/advanced/field-advanced-6` | Personal-information fieldset: two-column names, email, and a country `Select` with six inline options. It is only a collection of uncontrolled controls. |
| `field-advanced-7` — Mixed Field Types with Separators | `packages/patterns/field/advanced/field-advanced-7.tsx` | `/patterns/field/advanced/field-advanced-7` | Contact phone/email and an additional-information `Textarea`, separated into sections. Add actual validation, submit, and privacy/business rules outside this composition. |

**Required primitives:** field exports; #1–2 add `Slider`; #3 adds `RadioGroup`/`RadioGroupItem`; #4/#6 add `Input` (#6 also `Select` parts); #5 adds `Checkbox`; #7 adds `Input` and `Textarea`. #1–2 require React `useState` only for displayed demo values.

## `basic-inputs`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `field-basic-inputs-1` — Simple Input with Label | `packages/patterns/field/basic-inputs/field-basic-inputs-1.tsx` | `/patterns/field/basic-inputs/field-basic-inputs-1` | One `FieldLabel htmlFor` and email `Input id`; basic association only. |
| `field-basic-inputs-2` — Input with Description Below | `packages/patterns/field/basic-inputs/field-basic-inputs-2.tsx` | `/patterns/field/basic-inputs/field-basic-inputs-2` | Username label/input followed by `FieldDescription`. |
| `field-basic-inputs-3` — Input with Description Above | `packages/patterns/field/basic-inputs/field-basic-inputs-3.tsx` | `/patterns/field/basic-inputs/field-basic-inputs-3` | Password label, description, then password input; ordering is the distinguishing choice. |
| `field-basic-inputs-4` — Multiple Inputs in Group | `packages/patterns/field/basic-inputs/field-basic-inputs-4.tsx` | `/patterns/field/basic-inputs/field-basic-inputs-4` | `FieldSet`/`FieldGroup` stacks first name, last name, and email fields. |
| `field-basic-inputs-5` — Horizontal Layout Input | `packages/patterns/field/basic-inputs/field-basic-inputs-5.tsx` | `/patterns/field/basic-inputs/field-basic-inputs-5` | A horizontal `Field` constrains its label (`w-32`) beside a display-name input. |

**Required primitives:** `Field`/`FieldLabel` and `Input`; #2–3 additionally `FieldDescription`; #4 additionally `FieldGroup`/`FieldSet`. All example placeholders and IDs must be replaced to fit the receiving form model.

## `layouts`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `field-layouts-1` — Vertical Layout (Default) | `packages/patterns/field/layouts/field-layouts-1.tsx` | `/patterns/field/layouts/field-layouts-1` | Default vertical fieldset/group: public name and email, each with description. |
| `field-layouts-2` — Horizontal Layout | `packages/patterns/field/layouts/field-layouts-2.tsx` | `/patterns/field/layouts/field-layouts-2` | Horizontal username plus language select arrangement. |
| `field-layouts-3` — Responsive Layout | `packages/patterns/field/layouts/field-layouts-3.tsx` | `/patterns/field/layouts/field-layouts-3` | Two `orientation="responsive"` fields (display name/username); responsive behavior comes from the field primitive’s container-query styling. |
| `field-layouts-4` — Grid Layout | `packages/patterns/field/layouts/field-layouts-4.tsx` | `/patterns/field/layouts/field-layouts-4` | Fieldset with a two-column name grid and three-column location grid where City spans two columns. |
| `field-layouts-5` — Nested Fields | `packages/patterns/field/layouts/field-layouts-5.tsx` | `/patterns/field/layouts/field-layouts-5` | Shipping-address legend/description, individual street/apartment fields, then a nested `FieldGroup` two-column City/ZIP grid. |
| `field-layouts-6` — Mixed Orientations | `packages/patterns/field/layouts/field-layouts-6.tsx` | `/patterns/field/layouts/field-layouts-6` | Vertical project-name input plus horizontal public checkbox and archive switch, each using `FieldContent` description copy. |

**Required primitives:** field layout exports and `Input`; #2 adds select parts; #6 adds `Checkbox` and `Switch`. The responsive and grid classes are source styling choices, not evidence of validated responsive behavior.

## `selects`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `field-selects-1` — Simple Select | `packages/patterns/field/selects/field-selects-1.tsx` | `/patterns/field/selects/field-selects-1` | Country label and placeholdered select with static country items. |
| `field-selects-2` — Select with Description | `packages/patterns/field/selects/field-selects-2.tsx` | `/patterns/field/selects/field-selects-2` | Department selector followed by helper description. |
| `field-selects-3` — Select with Groups | `packages/patterns/field/selects/field-selects-3.tsx` | `/patterns/field/selects/field-selects-3` | Timezone choices are divided with `SelectGroup`/`SelectLabel` (Americas and Europe). |
| `field-selects-4` — Multiple Selects | `packages/patterns/field/selects/field-selects-4.tsx` | `/patterns/field/selects/field-selects-4` | One fieldset/group holds separate Language and Currency selects. |
| `field-selects-5` — Select with Helper Text Above | `packages/patterns/field/selects/field-selects-5.tsx` | `/patterns/field/selects/field-selects-5` | Priority helper description appears before label/select. |
| `field-selects-6` — Select in Horizontal Layout | `packages/patterns/field/selects/field-selects-6.tsx` | `/patterns/field/selects/field-selects-6` | Horizontal Theme label/select treatment. |
| `field-selects-7` — Select with Default Value | `packages/patterns/field/selects/field-selects-7.tsx` | `/patterns/field/selects/field-selects-7` | Status `Select defaultValue="active"` plus explanatory description; default is presentation/demo data, not persisted state. |

**Required primitives:** `Field`/`FieldLabel` plus `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, and `SelectItem`; #2/#5/#7 add `FieldDescription`; #3 also imports `SelectGroup`/`SelectLabel`; #4 adds `FieldGroup`/`FieldSet`. Supply controlled value, available options, loading/error and persistence behavior in production.

## `text-areas`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `field-text-areas-1` — Simple Textarea | `packages/patterns/field/text-areas/field-text-areas-1.tsx` | `/patterns/field/text-areas/field-text-areas-1` | Single labelled message textarea. |
| `field-text-areas-2` — Textarea with Description | `packages/patterns/field/text-areas/field-text-areas-2.tsx` | `/patterns/field/text-areas/field-text-areas-2` | Feedback textarea followed by helper copy. |
| `field-text-areas-3` — Textarea with Character Count | `packages/patterns/field/text-areas/field-text-areas-3.tsx` | `/patterns/field/text-areas/field-text-areas-3` | React `useState` controls a 500-character textarea and renders `value.length/maxLength`; it does not communicate a limit/validation result beyond this demo UI. |
| `field-text-areas-4` — Textarea with Helper Text Above | `packages/patterns/field/text-areas/field-text-areas-4.tsx` | `/patterns/field/text-areas/field-text-areas-4` | Markdown-support helper precedes Description textarea. |
| `field-text-areas-5` — Multiple Textareas - Different Sizes | `packages/patterns/field/text-areas/field-text-areas-5.tsx` | `/patterns/field/text-areas/field-text-areas-5` | Fieldset/group stacks short, medium and long textarea examples with `rows` 2, 4 and 8. |
| `field-text-areas-6` — Textarea with Detailed Instructions | `packages/patterns/field/text-areas/field-text-areas-6.tsx` | `/patterns/field/text-areas/field-text-areas-6` | Long issue instructions plus a four-row textarea; source makes no support-ticket submission. |

**Required primitives:** `Field`/`FieldLabel` and `Textarea`; #2/#3/#4/#6 add `FieldDescription`; #5 adds `FieldGroup`/`FieldSet`; #3 also uses React `useState`. Do not carry forward the counter as the sole limit enforcement—enforce the same policy at the submit/server boundary.

## `toggles`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `field-toggles-1` — Simple Checkbox | `packages/patterns/field/toggles/field-toggles-1.tsx` | `/patterns/field/toggles/field-toggles-1` | Checkbox `id="terms"` with its label; no consent recording. |
| `field-toggles-2` — Multiple Checkboxes | `packages/patterns/field/toggles/field-toggles-2.tsx` | `/patterns/field/toggles/field-toggles-2` | Desktop-item `FieldSet` legend/description and four checkbox rows. |
| `field-toggles-3` — Radio Buttons | `packages/patterns/field/toggles/field-toggles-3.tsx` | `/patterns/field/toggles/field-toggles-3` | Notification-method radio group with three labelled choices and per-choice IDs. |
| `field-toggles-4` — Radio with Descriptions | `packages/patterns/field/toggles/field-toggles-4.tsx` | `/patterns/field/toggles/field-toggles-4` | Subscription radio group adds price descriptions under each option. |
| `field-toggles-5` — Simple Switch | `packages/patterns/field/toggles/field-toggles-5.tsx` | `/patterns/field/toggles/field-toggles-5` | Horizontal label and airplane-mode switch. |
| `field-toggles-6` — Switch with Description | `packages/patterns/field/toggles/field-toggles-6.tsx` | `/patterns/field/toggles/field-toggles-6` | Switch precedes `FieldContent` title/long MFA description. |
| `field-toggles-7` — Checkbox with Description | `packages/patterns/field/toggles/field-toggles-7.tsx` | `/patterns/field/toggles/field-toggles-7` | Checkbox precedes `FieldContent` title/description for folder sync. |

**Required primitives:** #1/#2/#7 `Checkbox`; #3/#4 `RadioGroup`/`RadioGroupItem`; #5/#6 `Switch`; all use field exports. State change exists only inside the imported control primitive; none of these examples has React state or a change callback. Connect optimistic updates, rollback and policy/consent persistence deliberately.

---

# Form

Every form source imports `zod`, `react-hook-form`, and `@hookform/resolvers/zod`, then composes the local `Button` and `Form` primitives. Each passes `zodResolver(formSchema)` to `useForm` and sends the successful `onSubmit` values only to `console.log`; this is **demo behavior**, not a backend integration. Static default values, select items, category data, and account/payment-like values are demo data. Production must provide authenticated mutation/API handling, pending/disabled feedback, server-error mapping, cancellation semantics, authorization, and server-side validation; no form source supplies those.

## `advanced`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `form-advanced-1` — Form with Select | `packages/patterns/form/advanced/form-advanced-1.tsx` | `/patterns/form/advanced/form-advanced-1` | Required country schema; `FormField` adapts `Select` through `defaultValue={field.value}`/`onValueChange={field.onChange}`, six static countries, description and message. |
| `form-advanced-2` — Form with Textarea | `packages/patterns/form/advanced/form-advanced-2.tsx` | `/patterns/form/advanced/form-advanced-2` | Required bio max 500; non-resizable textarea reads `field.value.length` for a counter. |
| `form-advanced-3` — Form with Checkbox | `packages/patterns/form/advanced/form-advanced-3.tsx` | `/patterns/form/advanced/form-advanced-3` | Three boolean fields; marketing/security default false, terms uses a refinement requiring true. |
| `form-advanced-4` — Form with Radio Buttons | `packages/patterns/form/advanced/form-advanced-4.tsx` | `/patterns/form/advanced/form-advanced-4` | Plan enum through `RadioGroup` with free default and a `FormMessage`. |
| `form-advanced-5` — Form with Switch | `packages/patterns/form/advanced/form-advanced-5.tsx` | `/patterns/form/advanced/form-advanced-5` | Three false-default notification switches in bordered horizontal rows; source imports no `FormMessage` for these switches. |
| `form-advanced-6` — Form with Multiple Selects | `packages/patterns/form/advanced/form-advanced-6.tsx` | `/patterns/form/advanced/form-advanced-6` | Name input plus country/timezone/language selects and static option lists; source defaults only `name` to an empty string. |
| `form-advanced-7` — Form with Mixed Controls | `packages/patterns/form/advanced/form-advanced-7.tsx` | `/patterns/form/advanced/form-advanced-7` | Title/type/priority/description/subscription combines Input, Select, RadioGroup, Textarea and Checkbox; schema requires title ≥2 and description ≥10 and enum type. |

**Additional UI imports by variant:** #1/#6 `Select` parts; #2/#7 `Textarea`; #3/#7 `Checkbox`; #4/#7 `RadioGroup`; #5 `Switch`; #6/#7 `Input`. All retain the common form stack above.

## `basic-forms`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `form-basic-forms-1` — Simple Text Input Form | `packages/patterns/form/basic-forms/form-basic-forms-1.tsx` | `/patterns/form/basic-forms/form-basic-forms-1` | One required username with display-name description. |
| `form-basic-forms-2` — Email Input Form | `packages/patterns/form/basic-forms/form-basic-forms-2.tsx` | `/patterns/form/basic-forms/form-basic-forms-2` | One required email input (`type="email"`) and subscription copy. |
| `form-basic-forms-3` — Password Input Form | `packages/patterns/form/basic-forms/form-basic-forms-3.tsx` | `/patterns/form/basic-forms/form-basic-forms-3` | One password input, schema min length eight. |
| `form-basic-forms-4` — Number Input Form | `packages/patterns/form/basic-forms/form-basic-forms-4.tsx` | `/patterns/form/basic-forms/form-basic-forms-4` | Coerced age number min 18 and `type="number"`. |
| `form-basic-forms-5` — URL Input Form | `packages/patterns/form/basic-forms/form-basic-forms-5.tsx` | `/patterns/form/basic-forms/form-basic-forms-5` | Required URL schema and `type="url"`. |
| `form-basic-forms-6` — Phone Input Form | `packages/patterns/form/basic-forms/form-basic-forms-6.tsx` | `/patterns/form/basic-forms/form-basic-forms-6` | Phone field rendered with `type="tel"`; schema applies an E.164-like `^\+?[1-9]\d{1,14}$` regex. |
| `form-basic-forms-7` — Search Input Form | `packages/patterns/form/basic-forms/form-basic-forms-7.tsx` | `/patterns/form/basic-forms/form-basic-forms-7` | Required query input uses `type="search"`; source logs rather than searches. |

**Required primitives:** common form stack plus `Input`. Native input type supplements the Zod schema but is not sufficient application validation.

## `layouts`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `form-layouts-1` — Vertical Layout (Default) | `packages/patterns/form/layouts/form-layouts-1.tsx` | `/patterns/form/layouts/form-layouts-1` | Three simple fields (name/email/phone) in `space-y-4`; phone is `tel`. |
| `form-layouts-2` — Horizontal Layout | `packages/patterns/form/layouts/form-layouts-2.tsx` | `/patterns/form/layouts/form-layouts-2` | Username/email fields are four-column label/control grids; action is right-aligned. |
| `form-layouts-3` — Grid Layout (2 Columns) | `packages/patterns/form/layouts/form-layouts-3.tsx` | `/patterns/form/layouts/form-layouts-3` | Six fields arranged as three two-column grids; schema includes email, phone minimum, and US ZIP regex. |
| `form-layouts-4` — Responsive Layout | `packages/patterns/form/layouts/form-layouts-4.tsx` | `/patterns/form/layouts/form-layouts-4` | Name/email and company/website use `grid-cols-1 md:grid-cols-2`; source styling only, not browser-tested responsiveness. |
| `form-layouts-5` — Inline Form | `packages/patterns/form/layouts/form-layouts-5.tsx` | `/patterns/form/layouts/form-layouts-5` | Email control and Subscribe button share a flex row; visible label is `sr-only`, retained through `FormLabel`. |
| `form-layouts-6` — Compact Form | `packages/patterns/form/layouts/form-layouts-6.tsx` | `/patterns/form/layouts/form-layouts-6` | Small-width/sign-in variant with short controls and text sizing; username ≥2/password ≥8. |
| `form-layouts-7` — Spacious Form with Sections | `packages/patterns/form/layouts/form-layouts-7.tsx` | `/patterns/form/layouts/form-layouts-7` | Separates Personal Information and Address headings with generous vertical spacing, including two name and two location grids. |

**Required primitives:** common form stack plus `Input`. Keep #5’s programmatic label; do not replace it with placeholder-only labelling.

## `multi-field`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `form-multi-field-1` — Two Field Form | `packages/patterns/form/multi-field/form-multi-field-1.tsx` | `/patterns/form/multi-field/form-multi-field-1` | Name/email vertical pair with helper descriptions. |
| `form-multi-field-2` — Three Field Form | `packages/patterns/form/multi-field/form-multi-field-2.tsx` | `/patterns/form/multi-field/form-multi-field-2` | First/last fields occupy a two-column grid; email follows. |
| `form-multi-field-3` — Four Field Profile Form | `packages/patterns/form/multi-field/form-multi-field-3.tsx` | `/patterns/form/multi-field/form-multi-field-3` | Username/email/bio/website with min length, email, and URL schema constraints. |
| `form-multi-field-4` — Mixed Input Types Form | `packages/patterns/form/multi-field/form-multi-field-4.tsx` | `/patterns/form/multi-field/form-multi-field-4` | Full name, coerced age number, email and tel phone; schemas require name ≥2, age ≥18, valid email, and an E.164-like phone regex. |
| `form-multi-field-5` — Form with Optional Fields | `packages/patterns/form/multi-field/form-multi-field-5.tsx` | `/patterns/form/multi-field/form-multi-field-5` | Required name/email plus optional company and website (URL or empty string); names are a two-column grid. |
| `form-multi-field-6` — Form with Field Groups | `packages/patterns/form/multi-field/form-multi-field-6.tsx` | `/patterns/form/multi-field/form-multi-field-6` | Visual Personal Information and Address sections; name and City/ZIP pairs are grids, ZIP uses a US regex. |
| `form-multi-field-7` — Long Form with Many Fields | `packages/patterns/form/multi-field/form-multi-field-7.tsx` | `/patterns/form/multi-field/form-multi-field-7` | Account, personal and address sections; schema includes username/email/name constraints, E.164-like phone regex and US ZIP regex. |

**Required primitives:** common form stack plus `Input`; the section headings/grids are plain markup/classes. Review jurisdiction-specific phone/ZIP/address assumptions before reusing #6–7 validation.

## `patterns`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `form-patterns-1` — Login Form | `packages/patterns/form/patterns/form-patterns-1.tsx` | `/patterns/form/patterns/form-patterns-1` | Centred welcome header, email/password controls, and static `href="#"` Sign up link. It logs credentials: do not use that submit behavior. |
| `form-patterns-2` — Signup Form | `packages/patterns/form/patterns/form-patterns-2.tsx` | `/patterns/form/patterns/form-patterns-2` | Centred account header, name/email/password, required terms checkbox, and static terms/sign-in links. |
| `form-patterns-3` — Profile Edit Form | `packages/patterns/form/patterns/form-patterns-3.tsx` | `/patterns/form/patterns/form-patterns-3` | Profile heading, username/email/bio counter/optional-or-empty website, Save and a Cancel button with no cancel callback. |
| `form-patterns-4` — Contact Form | `packages/patterns/form/patterns/form-patterns-4.tsx` | `/patterns/form/patterns/form-patterns-4` | Contact header and name/email/subject `Select`/message `Textarea`; inline subject choices are demo data. |
| `form-patterns-5` — Settings Form | `packages/patterns/form/patterns/form-patterns-5.tsx` | `/patterns/form/patterns/form-patterns-5` | Preference language/theme selects plus notification/security switch sections. |
| `form-patterns-6` — Checkout Form | `packages/patterns/form/patterns/form-patterns-6.tsx` | `/patterns/form/patterns/form-patterns-6` | Contact, card and billing sections; regex checks card number/expiry/CVV but no payment tokenization, PCI workflow, or purchase call exists. |
| `form-patterns-7` — Search Filter Form | `packages/patterns/form/patterns/form-patterns-7.tsx` | `/patterns/form/patterns/form-patterns-7` | Query, sort, min/max, checkbox-array categories from a four-item local `categories` constant, stock toggle, Apply, and a local `form.reset()` Reset action. It does not search. |

**Additional UI imports:** #2/#7 `Checkbox`; #3/#4 `Textarea`; #4–#7 `Select` parts; #5 `Switch`; #1–#4/#6/#7 `Input`. #7’s category array update is a useful RHF composition, but the static category data and console-only submit are demo-only.

## `validation`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `form-validation-1` — Required Field Validation | `packages/patterns/form/validation/form-validation-1.tsx` | `/patterns/form/validation/form-validation-1` | Name/email use explicit required/min/email messages and `FormMessage`; validation normally occurs on submission under RHF defaults. |
| `form-validation-2` — Min/Max Length Validation | `packages/patterns/form/validation/form-validation-2.tsx` | `/patterns/form/validation/form-validation-2` | Username requires 3–20; bio 10–160 and displays `field.value.length/160`. |
| `form-validation-3` — Email Validation | `packages/patterns/form/validation/form-validation-3.tsx` | `/patterns/form/validation/form-validation-3` | Email/confirm-email schemas plus object-level `.refine` attach mismatch error to `confirmEmail`. |
| `form-validation-4` — Password Strength Validation | `packages/patterns/form/validation/form-validation-4.tsx` | `/patterns/form/validation/form-validation-4` | Password needs length, uppercase, lowercase, number and special-character regexes; object refinement checks confirmation. |
| `form-validation-5` — Conditional Validation | `packages/patterns/form/validation/form-validation-5.tsx` | `/patterns/form/validation/form-validation-5` | `hasCompany` checkbox conditionally refines optional company name; website is optional URL or empty string. |
| `form-validation-6` — Custom Validation Messages | `packages/patterns/form/validation/form-validation-6.tsx` | `/patterns/form/validation/form-validation-6` | Username/email/coerced-age constraints supply deliberately informal emoji messages; copy is demo-specific and may not meet product tone/localization needs. |
| `form-validation-7` — Real-time Validation | `packages/patterns/form/validation/form-validation-7.tsx` | `/patterns/form/validation/form-validation-7` | The only assigned form explicitly sets `useForm({ mode: "onChange" })`; submit is disabled until `form.formState.isValid`, with username/email constraints. |

**Required primitives:** common form stack plus `Input`; #2 uses `Textarea`; #5 adds `Checkbox`. The local primitive supplies ID/description/invalid wiring, but neither source reading nor any preview validates announcement timing, error focus strategy, or assistive-technology output.

---

# Hover card

Each example imports `HoverCard`, `HoverCardTrigger`, and `HoverCardContent` from `@/components/ui/hover-card`; all static content is example data. No assigned pattern supplies open-state control, asynchronous loading, error/fallback/loading UI, analytics, route behavior, or a business action callback. Most triggers use `asChild` around an anchor (`href="#"`) or button; those `#` anchors and fixed metrics/copy must not be copied as production behavior.

## `info`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `hover-card-info-1` — Simple Info Tooltip | `packages/patterns/hover-card/info/hover-card-info-1.tsx` | `/patterns/hover-card/info/hover-card-info-1` | “Storage Limit” text, `HelpCircle` trigger, and one paragraph of fixed plan/storage copy. |
| `hover-card-info-2` — Info with Title | `packages/patterns/hover-card/info/hover-card-info-2.tsx` | `/patterns/hover-card/info/hover-card-info-2` | `Info` icon next to API Rate Limit; content adds Rate Limiting heading and line-broken tier copy. |
| `hover-card-info-3` — Info with Icon and Badge | `packages/patterns/hover-card/info/hover-card-info-3.tsx` | `/patterns/hover-card/info/hover-card-info-3` | Secondary Verified badge is trigger; content is a coloured shield icon block with verification explanation. |
| `hover-card-info-4` — Warning Info | `packages/patterns/hover-card/info/hover-card-info-4.tsx` | `/patterns/hover-card/info/hover-card-info-4` | Orange alert-row shell, `AlertCircle`, and a “Details” span trigger; content states a fixed promotion/expiry. |
| `hover-card-info-5` — Technical Info | `packages/patterns/hover-card/info/hover-card-info-5.tsx` | `/patterns/hover-card/info/hover-card-info-5` | API Endpoint/Code trigger and `w-80` details card showing fixed Method/URL/Auth values in code-like spans. |

**Additional imports:** `lucide-react` icon per row; #3 also `Badge`. Use a semantically suitable, labelled/focusable trigger and dynamic, authorized data; source reading does not prove tooltip-like interaction access for every trigger construction.

## `preview`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `hover-card-preview-1` — Link Preview | `packages/patterns/hover-card/preview/hover-card-preview-1.tsx` | `/patterns/hover-card/preview/hover-card-preview-1` | `asChild` static article anchor opens a `w-80` title/summary/metadata card with ExternalLink icon. |
| `hover-card-preview-2` — Document Preview | `packages/patterns/hover-card/preview/hover-card-preview-2.tsx` | `/patterns/hover-card/preview/hover-card-preview-2` | Underlined document-name trigger and fixed PDF-size/date card with FileText tile. |
| `hover-card-preview-3` — Image Preview | `packages/patterns/hover-card/preview/hover-card-preview-3.tsx` | `/patterns/hover-card/preview/hover-card-preview-3` | Button trigger; card uses an `img alt="Preview"` from a hard-coded Unsplash URL, fixed image metadata and aspect-video crop. External URL/content and generic alt are demo-only. |
| `hover-card-preview-4` — Event Preview | `packages/patterns/hover-card/preview/hover-card-preview-4.tsx` | `/patterns/hover-card/preview/hover-card-preview-4` | Underlined event trigger; card contains Upcoming badge, static description, date/time and attendee count with calendar/clock/users icons. |
| `hover-card-preview-5` — Product Preview | `packages/patterns/hover-card/preview/hover-card-preview-5.tsx` | `/patterns/hover-card/preview/hover-card-preview-5` | Underlined product anchor; `w-80` card shows a Package placeholder tile, fixed sale price, review count and in-stock status. |

**Additional imports:** a Lucide icon each; #4 also `Badge`. Fetching/authorization, link destination/navigation, image optimization and meaningful alt text are absent.

## `profile`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `hover-card-profile-1` — Simple Profile Hover Card | `packages/patterns/hover-card/profile/hover-card-profile-1.tsx` | `/patterns/hover-card/profile/hover-card-profile-1` | Static handle anchor opens avatar/name/role; `AvatarImage` loads `https://github.com/haydenbleasel.png` with HB fallback. |
| `hover-card-profile-2` — Profile with Follow Button | `packages/patterns/hover-card/profile/hover-card-profile-2.tsx` | `/patterns/hover-card/profile/hover-card-profile-2` | Adds fixed follower/following counts and a Follow button with no click handler. |
| `hover-card-profile-3` — Profile with Badge | `packages/patterns/hover-card/profile/hover-card-profile-3.tsx` | `/patterns/hover-card/profile/hover-card-profile-3` | Trigger itself is avatar plus name; content adds secondary Pro badge and joined date. |
| `hover-card-profile-4` — Profile with Location | `packages/patterns/hover-card/profile/hover-card-profile-4.tsx` | `/patterns/hover-card/profile/hover-card-profile-4` | `w-80` profile card adds a bio, MapPin San Francisco and CalendarDays joined value. |
| `hover-card-profile-5` — Profile with Stats | `packages/patterns/hover-card/profile/hover-card-profile-5.tsx` | `/patterns/hover-card/profile/hover-card-profile-5` | `w-80` profile card splits identity and a three-column Posts/Followers/Following block with `Separator`. |

**Additional imports:** all use `Avatar`, `AvatarImage`, `AvatarFallback`; #2 adds `Button`, #3 `Badge`, #4 Lucide icons, #5 `Separator`. External GitHub avatar URLs, a fixed identity, counts and inert Follow are demo data/behavior—replace with trusted profile data, real route/action and optimistic/error semantics.

## `stats`

| ID / title | Source | Preview | Source-read composition and interaction distinction |
| --- | --- | --- | --- |
| `hover-card-stats-1` — Simple Stats | `packages/patterns/hover-card/stats/hover-card-stats-1.tsx` | `/patterns/hover-card/stats/hover-card-stats-1` | Card-like button trigger shows static total views; content breaks out today/week/month values. |
| `hover-card-stats-2` — Growth Stats | `packages/patterns/hover-card/stats/hover-card-stats-2.tsx` | `/patterns/hover-card/stats/hover-card-stats-2` | Compact revenue/ArrowUp percentage trigger; content compares current, previous and positive change. |
| `hover-card-stats-3` — User Stats | `packages/patterns/hover-card/stats/hover-card-stats-3.tsx` | `/patterns/hover-card/stats/hover-card-stats-3` | Card-like Active Users button; `w-72` content has two-column current counts, separator, online/peak rows. |
| `hover-card-stats-4` — Performance Stats | `packages/patterns/hover-card/stats/hover-card-stats-4.tsx` | `/patterns/hover-card/stats/hover-card-stats-4` | Secondary uptime `Badge` trigger; `w-80` card has Healthy badge, a CSS-width 98.5% bar, response time and error rate. The bar needs real accessible progress semantics if retained. |
| `hover-card-stats-5` — Financial Stats | `packages/patterns/hover-card/stats/hover-card-stats-5.tsx` | `/patterns/hover-card/stats/hover-card-stats-5` | Card-like monthly-revenue button; `w-80` card has fixed income/expense rows, net profit and month comparison. |

**Additional imports:** each uses Lucide icon(s); #3 adds `Separator`, #4 `Badge`. Static financial/operational values and colour-only positive/negative/status cues must be replaced with authorized live data and text/semantic status that is tested in context.

---

## Safe adaptation boundaries and accessibility caveats

1. **Composition to preserve:** copy only the selected row’s layout/primitive structure, imports and styling intent. Keep `FormControl` around actual form controls and labels associated with control IDs; keep `FieldSet`/`FieldLegend` for related native groups. Do not paste a whole demo form merely because a title resembles a feature.
2. **Behavior to add deliberately:** field examples need state/model, validation, submit and persistence; form examples need real mutation/error/loading/cancel paths instead of `console.log`; hover cards need real destinations/actions plus data fetch/error policy. #7 Search Filter’s `form.reset()` is the sole non-submit demo action found in the form patterns.
3. **Data/dependency boundary:** form families require React Hook Form, Zod, and `@hookform/resolvers/zod`; `field` needs only React state in slider/count variants; hover variants import Lucide and may import Avatar/Badge/Button/Separator. Do not inherit hard-coded select categories, personal names, dates, account/financial values, `href="#"`, or external Unsplash/GitHub image URLs.
4. **Accessibility uncertainty:** source establishes primitive wiring noted above and some explicit labels/alt text, but it does **not** constitute browser, keyboard, screen-reader, focus-management, contrast, mobile, or network validation. In particular, test hover cards with keyboard and touch alternatives; test dynamic errors and announcement/focus behavior; ensure every adopted link/button has a real, correct action; and review the choice-card group association and generic preview image alt.

## Coverage and missing inputs

- **Covered:** all 38 `field` patterns (7 advanced, 5 basic-inputs, 6 layouts, 7 selects, 6 text-areas, 7 toggles); all 42 `form` patterns (7 in each of advanced, basic-forms, layouts, multi-field, patterns, validation); and all 20 `hover-card` patterns (5 in each of info, preview, profile, stats): **100/100 assigned TSX files**.
- **Not supplied/validated:** an application feature or selected Kibo pattern, target data/API contract, installed alias/dependency compatibility, browser preview/runtime results, and accessibility audit results. Preview entries are catalog metadata only; no claim is made that URLs were opened or that upstream behavior works in this project.
