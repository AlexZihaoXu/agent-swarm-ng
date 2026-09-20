# Blocks: compare, compliance, contact, cta

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


Read-only reference analysis of **compare, compliance, contact, and cta** only, from the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`). Snapshot provenance and limits are recorded in [`docs/references/kibo/VERIFICATION.md`](../VERIFICATION.md).

The project uses React + Vite, shadcn/ui, Tailwind, and Kibo as an on-demand registry; additions must remain within the explicitly agreed dashboard scope ([`README.md`](../../../../README.md), [`README.md`](../../../../README.md)). No source was executed, no browser preview was opened, and no visual, responsive, or accessibility validation is claimed.

## Files retrieved

1. [`docs/references/kibo/upstream/apps/docs/content/blocks/compare.mdx`](../upstream/apps/docs/content/blocks/compare.mdx#L1-L6) — frontmatter and installer mapping.
2. [`docs/references/kibo/upstream/apps/docs/content/blocks/compliance.mdx`](../upstream/apps/docs/content/blocks/compliance.mdx#L1-L6) — frontmatter and installer mapping.
3. [`docs/references/kibo/upstream/apps/docs/content/blocks/contact.mdx`](../upstream/apps/docs/content/blocks/contact.mdx#L1-L6) — frontmatter and installer mapping.
4. [`docs/references/kibo/upstream/apps/docs/content/blocks/cta.mdx`](../upstream/apps/docs/content/blocks/cta.mdx#L1-L6) — frontmatter and installer mapping.
5. [`docs/references/kibo/upstream/apps/docs/examples/compare.tsx`](../upstream/apps/docs/examples/compare.tsx#L1-L164) — `Compare7` implementation.
6. [`docs/references/kibo/upstream/apps/docs/examples/compliance.tsx`](../upstream/apps/docs/examples/compliance.tsx#L1-L129) — `Compliance1` implementation.
7. [`docs/references/kibo/upstream/apps/docs/examples/contact.tsx`](../upstream/apps/docs/examples/contact.tsx#L1-L292) — `Contact` form implementation.
8. [`docs/references/kibo/upstream/apps/docs/examples/cta.tsx`](../upstream/apps/docs/examples/cta.tsx#L1-L65) — `Cta10` implementation.
9. [`docs/references/kibo/catalog/blocks.md`](../catalog/blocks.md) and [`catalog/examples.md`](../catalog/examples.md) — catalog entries.
10. [`docs/references/kibo/upstream/apps/docs/components/preview/index.tsx`](../upstream/apps/docs/components/preview/index.tsx#L22-L134) and [`app/(docs)/[[...slug]]/page.tsx`](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx#L44-L79) — documentation-to-example resolution.

## Variant and documentation mapping

Each assigned MDX page contains only frontmatter; the actual preview is resolved from its `installer` value. The docs page passes that value to `Preview`, which reads and dynamically imports `apps/docs/examples/<installer>.tsx` ([page](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx#L57-L66), [Preview](../upstream/apps/docs/components/preview/index.tsx#L22-L34)).

| Block doc / installer | Matching snapshot implementation | Variant identified by source | Result |
|---|---|---|---|
| [`compare.mdx`](../upstream/apps/docs/content/blocks/compare.mdx#L1-L6) / `compare` | [`examples/compare.tsx`](../upstream/apps/docs/examples/compare.tsx#L39-L164) | `Compare7`; source comment cites `compare7` | one matching example |
| [`compliance.mdx`](../upstream/apps/docs/content/blocks/compliance.mdx#L1-L6) / `compliance` | [`examples/compliance.tsx`](../upstream/apps/docs/examples/compliance.tsx#L26-L129) | `Compliance1`; comment cites `compliance1` | one matching example |
| [`contact.mdx`](../upstream/apps/docs/content/blocks/contact.mdx#L1-L6) / `contact` | [`examples/contact.tsx`](../upstream/apps/docs/examples/contact.tsx#L44-L292) | `Contact`; comment cites `contact2` | one matching example |
| [`cta.mdx`](../upstream/apps/docs/content/blocks/cta.mdx#L1-L6) / `cta` | [`examples/cta.tsx`](../upstream/apps/docs/examples/cta.tsx#L21-L65) | `Cta10`; comment cites `cta10` | one matching example |

The assigned glob has exactly these four TSX files; the catalog independently lists the same four entries. There is no `packages/blocks` directory at this revision ([snapshot inventory](../VERIFICATION.md)); the example files are the retained implementations. Variant numbers in source comments point to `shadcnblocks.com`, but those remote pages were not consulted or validated.

## Block notes

### Compare — `Compare7`

**Composition and data model.** A padded `<section>` contains centered heading/description and a horizontally scrollable three-column table. `CompareRow` supplies `feature`, `primary`, `secondary`, and optional `secondaryTooltip`; public configuration also permits heading, description, both labels, rows, and `className` ([source](../upstream/apps/docs/examples/compare.tsx#L20-L37), [rendering](../upstream/apps/docs/examples/compare.tsx#L103-L158)). The primary column is visually muted. Default content is a Shadcn-vs-Bootstrap comparison, including two tooltip rows, so it is demo content rather than project data ([defaults](../upstream/apps/docs/examples/compare.tsx#L39-L100)).

**Behavior.** A `secondaryTooltip` changes the secondary value from plain text to a dotted-underlined `span` wrapped in a Radix-backed tooltip; the source requests `sideOffset={8}` ([source](../upstream/apps/docs/examples/compare.tsx#L124-L150)). The supplied table primitive itself adds an overflow wrapper and renders semantic `<table>`, `<th>`, and `<td>` elements ([`table.tsx`](../upstream/packages/shadcn-ui/components/ui/table.tsx#L7-L90)). The tooltip primitive uses `radix-ui`, portals content, and defaults provider delay to zero ([`tooltip.tsx`](../upstream/packages/shadcn-ui/components/ui/tooltip.tsx#L8-L57)).

**Dependencies.** Kibo/shadcn imports: `cn`, `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`TableRow`, and `Tooltip`/`TooltipContent`/`TooltipProvider`/`TooltipTrigger` ([imports](../upstream/apps/docs/examples/compare.tsx#L1-L18)). `cn` is `clsx` plus `tailwind-merge` ([`utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6)).

**Integration gaps.** The source has no exported reusable `Compare7` or prop types—only the no-prop default example ([source](../upstream/apps/docs/examples/compare.tsx#L39-L40), [export](../upstream/apps/docs/examples/compare.tsx#L161-L164)). An application would need an adapter/export and real comparison data. For mutable application rows, the source’s array-index key merits replacement with a stable domain key ([source](../upstream/apps/docs/examples/compare.tsx#L125-L126)). The tooltip trigger is a non-native `span`; keyboard and assistive-technology behavior must be tested in the actual integrated build rather than inferred from source.

### Compliance — `Compliance1`

**Composition and data model.** A muted, responsive two-column section has: (1) outlined status-style badge with a hard-coded green dot; title, description, and supplied certification images; (2) a bordered card mapping feature title/description/badge image. The first and last feature receive different borders ([source](../upstream/apps/docs/examples/compliance.tsx#L71-L123)). Configurable values are tagline, heading, description, badge array, feature array, and `className` ([types](../upstream/apps/docs/examples/compliance.tsx#L5-L24)).

**Demo versus production.** All default copy makes compliance/security claims, and defaults name GDPR, CCPA, ISO-27001, ISO-27017, and ISO-27018 ([defaults](../upstream/apps/docs/examples/compliance.tsx#L26-L67)). Treat those statements and badge labels as marketing demo data, not evidence of this project’s compliance status.

**Dependencies and assets.** The only imported Kibo/shadcn UI component is `Badge`, plus `cn` ([imports](../upstream/apps/docs/examples/compliance.tsx#L1-L3)); the badge supports its outlined variant ([`badge.tsx`](../upstream/packages/shadcn-ui/components/ui/badge.tsx#L7-L44)). Five default SVGs are remote CloudFront assets: GDPR, CCPA, ISO-27001, ISO-27017, and ISO-27018 ([source](../upstream/apps/docs/examples/compliance.tsx#L30-L65)). They are not contained in the pinned snapshot and availability, licensing, content, and delivery were not checked.

**Integration gaps.** Replace or deliberately approve remote assets, and source every visible claim/badge from project-approved compliance evidence. The component is also only locally declared, not exported for reuse ([source](../upstream/apps/docs/examples/compliance.tsx#L26-L26), [export](../upstream/apps/docs/examples/compliance.tsx#L126-L129)). Its image `alt` fields are configurable and present in the defaults, but appropriateness of alternative text requires product content review.

### Contact — `Contact` / source-comment variant `contact2`

**Composition and behavior.** This is a client component with a two-column layout: phone/email/website anchors on the left and a five-field form on the right ([source](../upstream/apps/docs/examples/contact.tsx#L92-L151)). It validates non-empty first/last name, subject, message, and a valid email with Zod and React Hook Form ([schema](../upstream/apps/docs/examples/contact.tsx#L21-L32), [form setup](../upstream/apps/docs/examples/contact.tsx#L59-L70)). Field errors render through `FieldError`, whose implementation emits `role="alert"` ([form fields](../upstream/apps/docs/examples/contact.tsx#L151-L280), [`field.tsx`](../upstream/packages/shadcn-ui/components/ui/field.tsx#L186-L234)).

With a supplied async `onSubmit`, the handler awaits it. Without one, it logs submitted data to the console and waits one second; success then resets the form, shows a success message, fades it after 4.5 seconds, and removes it after 5 seconds. Rejection produces a root error ([source](../upstream/apps/docs/examples/contact.tsx#L72-L90)). That fallback is explicitly demo behavior, not message delivery.

**Dependencies.** Kibo/shadcn: `cn`, `Button`, `Field`, `FieldError`, `FieldGroup`, `FieldLabel`, `Input`, and `Textarea` ([imports](../upstream/apps/docs/examples/contact.tsx#L3-L19)). External runtime imports are `@hookform/resolvers/zod`, `react-hook-form`, `zod/v3`, and Lucide icons. The snapshot’s docs app declares the first three libraries, but declares Zod `^4.3.6` while this example imports the `zod/v3` subpath ([`apps/docs/package.json`](../upstream/apps/docs/package.json#L11-L13), [`apps/docs/package.json`](../upstream/apps/docs/package.json#L71-L92)); compatibility should be verified in a target app rather than assumed.

**Integration gaps.** The application would need to implement and approve the asynchronous `onSubmit` transport, handling of failure/retry, and data/privacy policy; current project scope does not establish a contact feature or authentication ([`README.md`](../../../../README.md), [`README.md`](../../../../README.md)). Replace placeholder contact details and the default external website ([source](../upstream/apps/docs/examples/contact.tsx#L44-L52)). The website anchor opens a new tab but supplies no `rel` attribute ([source](../upstream/apps/docs/examples/contact.tsx#L118-L125)); integrated link policy should address that. The frontmatter describes a grid including address and live chat, whereas the implementation supplies phone, email, website, and a form—implementation is the authoritative example here ([frontmatter](../upstream/apps/docs/content/blocks/contact.mdx#L2-L5), [rendering](../upstream/apps/docs/examples/contact.tsx#L103-L126)).

### CTA — `Cta10`

**Composition and behavior.** A compact padded section contains an accent-background rounded panel, heading/description, and optional secondary then primary action. Mobile stacks the action controls; `lg` places content and controls in a row ([source](../upstream/apps/docs/examples/cta.tsx#L32-L59)). Both actions are ordinary anchors styled with shadcn `Button` using `asChild`: secondary is `outline`, primary is default `lg` ([source](../upstream/apps/docs/examples/cta.tsx#L44-L54)). `Button` delegates to a Radix Slot when `asChild` is set ([`button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L39-L58)).

**Demo versus production.** Default content is generic marketing copy and a single “Buy Now” action to `https://www.shadcnblocks.com` ([source](../upstream/apps/docs/examples/cta.tsx#L21-L30)). It performs only native navigation; it contains no routing, mutation, analytics, or loading state.

**Dependencies and integration gaps.** Direct Kibo/shadcn dependencies are `cn` and `Button` ([imports](../upstream/apps/docs/examples/cta.tsx#L1-L3)). The app must provide approved labels and URLs, decide internal React Router versus ordinary-anchor navigation, and retain only actions relevant to an agreed dashboard workflow. Both `primary` and `secondary` are optional, so an empty `buttons` object renders no actions ([types](../upstream/apps/docs/examples/cta.tsx#L5-L19), [conditions](../upstream/apps/docs/examples/cta.tsx#L44-L54)). As with the other examples, the reusable component and prop interface are not exported; only the no-prop example is ([source](../upstream/apps/docs/examples/cta.tsx#L21-L31), [export](../upstream/apps/docs/examples/cta.tsx#L62-L65)).

## Cross-cutting implementation boundary

The examples import private workspace paths such as `@repo/shadcn-ui/...`; the documentation preview rewrites these only for displayed code, while runtime imports the example directly ([`Preview`](../upstream/apps/docs/components/preview/index.tsx#L27-L44)). A project adaptation therefore needs its own local shadcn/Kibo import paths and required dependencies, not a direct copy of the docs-app aliases. This aligns with the project’s on-demand Kibo registry approach ([`README.md`](../../../../README.md)).

## Coverage / missing inputs

- **Covered:** all four assigned frontmatter pages and all four matching `apps/docs/examples/<name>*.tsx` files; one retained implementation/variant per assigned block.
- **Catalog/metadata:** catalog entries checked; manifest records the four example files and hashes ([`manifest.json`](../metadata/manifest.json), [`manifest.json`](../metadata/manifest.json), [`manifest.json`](../metadata/manifest.json)).
- **Missing inputs:** no product decision establishes a use for these blocks; no approved copy, routes, comparison data, compliance evidence/assets, or contact-submission contract was supplied.
- **Unverified:** external URLs/assets, package compatibility in this repository, and all browser, visual, responsive, keyboard, screen-reader, and automated-test behavior.
