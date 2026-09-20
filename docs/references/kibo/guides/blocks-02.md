# Blocks: careers, case-studies, case-study, changelog

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the local Kibo snapshot pinned to upstream commit [`3d63cdb15b79d972e3dc38a10997987672f9b263`](../README.md). The snapshot catalog states that this revision has no `packages/blocks`; block material is instead documented under `apps/docs/content/blocks` and implemented as docs examples ([catalog/blocks.md:1-5](../catalog/blocks.md)).

The four assigned MDX pages contain only frontmatter, so behavior below is based on their matching TSX sources—not on the frontmatter descriptions alone.

## Files Retrieved

1. [`docs/references/kibo/upstream/apps/docs/content/blocks/careers.mdx`](../upstream/apps/docs/content/blocks/careers.mdx#L1-L6) — block metadata and installer key.
2. [`docs/references/kibo/upstream/apps/docs/examples/careers.tsx`](../upstream/apps/docs/examples/careers.tsx#L1-L107) — sole matching Careers implementation; `Careers4`.
3. [`docs/references/kibo/upstream/apps/docs/content/blocks/case-studies.mdx`](../upstream/apps/docs/content/blocks/case-studies.mdx#L1-L7) — block metadata and installer key.
4. [`docs/references/kibo/upstream/apps/docs/examples/case-studies.tsx`](../upstream/apps/docs/examples/case-studies.tsx#L1-L124) — sole matching Case Studies implementation; `CaseStudies2`.
5. [`docs/references/kibo/upstream/apps/docs/content/blocks/case-study.mdx`](../upstream/apps/docs/content/blocks/case-study.mdx#L1-L7) — block metadata and installer key.
6. [`docs/references/kibo/upstream/apps/docs/examples/case-study.tsx`](../upstream/apps/docs/examples/case-study.tsx#L1-L163) — sole matching Case Study implementation; `CaseStudy8`.
7. [`docs/references/kibo/upstream/apps/docs/content/blocks/changelog.mdx`](../upstream/apps/docs/content/blocks/changelog.mdx#L1-L7) — block metadata and installer key.
8. [`docs/references/kibo/upstream/apps/docs/examples/changelog.tsx`](../upstream/apps/docs/examples/changelog.tsx#L1-L164) — sole matching Changelog implementation; `Changelog1`.
9. [`docs/references/kibo/upstream/apps/docs/components/preview/index.tsx`](../upstream/apps/docs/components/preview/index.tsx#L16-L38) — docs preview convention: reads and dynamically imports `examples/${path}.tsx`.
10. [`README.md`](../../../../README.md) — application scope and frontend stack constraints.

## Variant and example mapping

| Assigned block | Metadata / installer | Matching implementation and variant | Composition and dependencies |
|---|---|---|---|
| Careers | [`careers.mdx:2-5`](../upstream/apps/docs/content/blocks/careers.mdx#L2-L5) | [`careers.tsx`](../upstream/apps/docs/examples/careers.tsx#L16-L107): `Careers4` (explicitly attributed to `careers4` at lines 104-106). | `cn` utility; Lucide `ArrowRight`. Category heading plus rows of job-title and arrow links. |
| Case Studies | [`case-studies.mdx:2-5`](../upstream/apps/docs/content/blocks/case-studies.mdx#L2-L5) | [`case-studies.tsx`](../upstream/apps/docs/examples/case-studies.tsx#L5-L124): `CaseStudies2` (attributed to `case-studies2` at lines 121-123). | `cn`; shadcn `Separator`. Centered heading, two repeated testimonial/metric groups, separated between groups. |
| Case Study | [`case-study.mdx:2-5`](../upstream/apps/docs/content/blocks/case-study.mdx#L2-L5) | [`case-study.tsx`](../upstream/apps/docs/examples/case-study.tsx#L3-L163): `CaseStudy8`. | `cn`; Tailwind Typography-style `prose` classes. Article plus responsive sidebar; no shadcn component import. |
| Changelog | [`changelog.mdx:2-5`](../upstream/apps/docs/content/blocks/changelog.mdx#L2-L5) | [`changelog.tsx`](../upstream/apps/docs/examples/changelog.tsx#L8-L164): `Changelog1`. | `cn`; shadcn `Badge` and `Button`; Lucide `ArrowUpRight`. Header and mapped, responsive/sticky version entries. |

The mappings follow the identical block/example basenames and the docs preview loader’s `examples/${path}.tsx` lookup ([`preview/index.tsx:22-34`](../upstream/apps/docs/components/preview/index.tsx#L22-L34)). No additional `careers*`, `case-studies*`, `case-study*`, or `changelog*` example files were present in the pinned snapshot.

## Key Code and integration notes

### Careers — `Careers4`

`Careers4Props` accepts optional `heading`, structured `jobs`, and `className`; a job requires `title`, `location`, and `url` ([`careers.tsx:5-20`](../upstream/apps/docs/examples/careers.tsx#L5-L20)). It maps categories and openings into bordered rows, with both the title and an icon anchor targeting the same `job.url` ([`careers.tsx:69-98`](../upstream/apps/docs/examples/careers.tsx#L69-L98)).

**Demo vs. production gap:** default content is fictional job data and all URLs are `"#"` ([`careers.tsx:24-65`](../upstream/apps/docs/examples/careers.tsx#L24-L65)). Production use needs a job-source/data contract, legitimate destinations, and state handling for empty/error/loading cases—none is supplied by this example. The icon-only second anchor has no text or explicit accessible name in source ([`careers.tsx:91-93`](../upstream/apps/docs/examples/careers.tsx#L91-L93)); name it or avoid the duplicate link when adapting.

### Case Studies — `CaseStudies2`

This is fixed presentation data, not a parameterized component: it renders two testimonial blocks, each with a portrait, quotation, identity/logo, and two metrics ([`case-studies.tsx:9-117`](../upstream/apps/docs/examples/case-studies.tsx#L9-L117)). At `lg`, a three-column grid allocates the testimonial to two columns and its metrics to the third ([`case-studies.tsx:20-66`](../upstream/apps/docs/examples/case-studies.tsx#L20-L66)); `Separator` separates the records ([line 66](../upstream/apps/docs/examples/case-studies.tsx#L66)).

**Demo vs. production gap:** heading, claims, quotations, people, roles, and metrics are all hard-coded. It would need a content model plus a mapped renderer before it can represent real customer evidence. The images are external CloudFront URLs and use generic `"placeholder"` / `"logo"` alt text ([`case-studies.tsx:22-25`](../upstream/apps/docs/examples/case-studies.tsx#L22-L25), [`40-43`](../upstream/apps/docs/examples/case-studies.tsx#L40-L43), [`69-72`](../upstream/apps/docs/examples/case-studies.tsx#L69-L72), [`87-90`](../upstream/apps/docs/examples/case-studies.tsx#L87-L90)); replace with accurate alternative text or explicitly decorative treatment.

### Case Study — `CaseStudy8`

The layout is semantic at its outer level: an `article` containing cover image and long-form prose, followed by an `aside` for company information ([`case-study.tsx:9-18`](../upstream/apps/docs/examples/case-study.tsx#L9-L18), [`106-155`](../upstream/apps/docs/examples/case-study.tsx#L106-L155)). The article demo includes headings, paragraph text, a quote, list, table, and inline `"#"` link ([`case-study.tsx:18-103`](../upstream/apps/docs/examples/case-study.tsx#L18-L103)). The sidebar supplies logo, company, industry, location, size, website, and topics ([`case-study.tsx:109-153`](../upstream/apps/docs/examples/case-study.tsx#L109-L153)).

**Demo vs. production gap:** aside from `className`, the component exposes no content props ([`case-study.tsx:3-9`](../upstream/apps/docs/examples/case-study.tsx#L3-L9)); every narrative and metadata value is demo copy. A production adaptation needs a case-study content/schema boundary, safe rich-content rendering, real URL validation, and media ownership. The `prose dark:prose-invert` classes assume typography styles are available ([line 17](../upstream/apps/docs/examples/case-study.tsx#L17)); this snapshot does not establish the target app’s Tailwind typography configuration.

### Changelog — `Changelog1`

This is the most reusable implementation. It exports:
- `ChangelogEntry` with required version/date/title/description and optional `items`, `image`, and `{url,text}` button ([`changelog.tsx:8-19`](../upstream/apps/docs/examples/changelog.tsx#L8-L19));
- `Changelog1Props` with optional title, description, entries, and class name ([`lines 21-26`](../upstream/apps/docs/examples/changelog.tsx#L21-L26));
- `defaultEntries` fixture data ([`lines 28-90`](../upstream/apps/docs/examples/changelog.tsx#L28-L90)).

Each mapped entry renders a secondary Badge/date, title/description, then optional list, image, and link-style Button. The version/date column becomes sticky at medium widths ([`changelog.tsx:109-155`](../upstream/apps/docs/examples/changelog.tsx#L109-L155)).

**Demo vs. production gap:** the entries are fixture release notes, three images resolve to the external CloudFront placeholder, and action URLs point to `https://shadcnblocks.com` ([`changelog.tsx:28-90`](../upstream/apps/docs/examples/changelog.tsx#L28-L90)). Integrate a release data source and stable entry ID: the implementation currently keys entries and list items by array index ([`lines 110-113`](../upstream/apps/docs/examples/changelog.tsx#L110-L113), [`130-137`](../upstream/apps/docs/examples/changelog.tsx#L130-L137)). Its new-tab link specifies `target="_blank"` but no `rel` value ([`lines 146-151`](../upstream/apps/docs/examples/changelog.tsx#L146-L151)); add an appropriate relationship when adapting.

## Architecture

Upstream’s docs configuration permits an optional frontmatter `installer` field ([`source.config.ts:8-16`](../upstream/apps/docs/source.config.ts#L8-L16)), but the assigned MDX files provide no embedded implementation or dependency declaration. The docs preview resolves an example from the supplied path, reads it as code, dynamically imports its default export, and rewrites monorepo aliases for display ([`preview/index.tsx:22-38`](../upstream/apps/docs/components/preview/index.tsx#L22-L38)). That is a documentation mechanism, not an application installation path.

For this project, these are reference patterns only: the product scope is an environment-management dashboard ([`README.md:35-43`](../../../../README.md)), while its frontend uses React/Vite, shadcn/ui, Tailwind, React Router, and TanStack Query ([`README.md:45-56`](../../../../README.md)). None of the four examples connects to the project API, router, query layer, or dashboard data. The upstream aliases (`@repo/shadcn-ui/...`) and remote assets must be intentionally adapted rather than imported as app behavior.

## Start Here

Open [`docs/references/kibo/upstream/apps/docs/examples/changelog.tsx`](../upstream/apps/docs/examples/changelog.tsx#L8-L26) first if a data-driven release-history layout is needed: it alone exposes a reusable content type and props. For job listings, next open [`careers.tsx`](../upstream/apps/docs/examples/careers.tsx#L5-L20) for its minimal data shape.

## Coverage and missing inputs

- **Covered:** all four assigned block docs and all matching implementation files: Careers/`Careers4`, Case Studies/`CaseStudies2`, Case Study/`CaseStudy8`, and Changelog/`Changelog1`.
- **External assets:** Case Studies, Case Study, and Changelog use `https://deifkwefumgah.cloudfront.net/...`; Careers has none. Changelog’s fixture CTA URLs are external; Careers and Case Study use `"#"` demo links.
- **Missing inputs:** no approved product requirement selects any of these marketing/content patterns; no production data contracts, target routes, asset policy, or content source was provided.
- **Validation boundary:** source was read only. No upstream code was run, no browser/rendering or accessibility validation was performed, and no claim is made about website availability or current upstream behavior.
