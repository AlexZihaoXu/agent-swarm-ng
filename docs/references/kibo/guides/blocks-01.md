# Blocks: about, awards, blog, blogpost

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), per [snapshot foundation](../VERIFICATION.md). This report covers only the four assigned block docs and their matching examples. The catalog confirms 28 block docs and 168 examples, and that this revision has no `packages/blocks` directory ([snapshot.md](../VERIFICATION.md); [catalog/blocks.md](../catalog/blocks.md); [catalog/examples.md](../catalog/examples.md)).

The upstream snapshot was read as untrusted reference data. Source was **not run** and no browser, visual, responsive, or accessibility validation was performed ([snapshot.md](../VERIFICATION.md)).

## Variant and source mapping

| Block | Doc metadata | Implementation variant | Example source |
|---|---|---|---|
| About | `installer: about`; explicitly declares `/components/marquee` dependency ([about.mdx](../upstream/apps/docs/content/blocks/about.mdx#L1-L8)) | `About3`, identified by its source comment ([about.tsx](../upstream/apps/docs/examples/about.tsx#L239-L242)) | [about.tsx](../upstream/apps/docs/examples/about.tsx#L1-L242) |
| Awards | `installer: awards` ([awards.mdx](../upstream/apps/docs/content/blocks/awards.mdx#L1-L6)) | `Awards1` ([awards.tsx](../upstream/apps/docs/examples/awards.tsx#L81-L84)) | [awards.tsx](../upstream/apps/docs/examples/awards.tsx#L1-L84) |
| Blog | `installer: blog` ([blog.mdx](../upstream/apps/docs/content/blocks/blog.mdx#L1-L6)) | `Blog7` ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L145-L148)) | [blog.tsx](../upstream/apps/docs/examples/blog.tsx#L1-L148) |
| Blog Post | `installer: blogpost` ([blogpost.mdx](../upstream/apps/docs/content/blocks/blogpost.mdx#L1-L6)) | `Blogpost1` ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L171-L174)) | [blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L1-L174) |

The matching-name source inventory contains one example for each assigned block ([catalog/examples.md](../catalog/examples.md)); no additional assigned-name variants were found in this pinned snapshot. The MDX files are frontmatter-only, so implementation details come from the TSX sources rather than the docs.

## About — `About3`

**Composition.** A heading/description leads a three-column responsive image area: primary image, breakout card with logo/copy/outline link-button, and secondary image. It conditionally renders a scrolling company-logo marquee, then an achievements panel and optional two-column content sections ([about.tsx](../upstream/apps/docs/examples/about.tsx#L62-L160)).

**Inputs and demo behavior.**
- `title`, both images, and `breakout` are required by `About3Props`; description, companies, achievements, and content sections are optional ([about.tsx](../upstream/apps/docs/examples/about.tsx#L11-L46)).
- The component merges supplied props over static `defaultProps` ([about.tsx](../upstream/apps/docs/examples/about.tsx#L48-L60)); the exported example always passes those demo defaults ([about.tsx](../upstream/apps/docs/examples/about.tsx#L198-L241)).
- `companies` controls marquee presence and `contentSections` controls the final section ([about.tsx](../upstream/apps/docs/examples/about.tsx#L102-L123), [#L147-L158](../upstream/apps/docs/examples/about.tsx#L147-L158)). `companiesTitle` is declared and given a default, but is neither destructured nor rendered ([about.tsx](../upstream/apps/docs/examples/about.tsx#L31-L35), [#L48-L60](../upstream/apps/docs/examples/about.tsx#L48-L60), [#L219-L220](../upstream/apps/docs/examples/about.tsx#L219-L220)).

**Dependencies.** Directly uses local `cn`, shadcn `Button`, and Kibo `Marquee`, `MarqueeContent`, `MarqueeFade`, and `MarqueeItem` ([about.tsx](../upstream/apps/docs/examples/about.tsx#L1-L9)). The bundled marquee wrapper defaults to infinite looping, auto-fill, and pause-on-hover, while this block sets speed to 40 ([marquee/index.tsx](../upstream/packages/marquee/index.tsx#L17-L31); [about.tsx](../upstream/apps/docs/examples/about.tsx#L103-L121)). That package depends on `react-fast-marquee` ([marquee/package.json](../upstream/packages/marquee/package.json#L1-L17)). The Button’s `asChild` path renders the outbound anchor rather than a nested button ([button.tsx](../upstream/packages/shadcn-ui/components/ui/button.tsx#L39-L60)).

**External assets.** Demo defaults reference two CloudFront photos, a CloudFront block SVG, six CloudFront fictional-company SVG logos, and `https://shadcnblocks.com` for the breakout action ([about.tsx](../upstream/apps/docs/examples/about.tsx#L164-L189), [#L202-L218](../upstream/apps/docs/examples/about.tsx#L202-L218)). These assets are remote references, not files supplied by the snapshot.

**Integration notes.** Replace all demo branding, images, achievement figures, and outbound URL with product-owned content. Import paths are monorepo aliases (`@repo/...`), not the application’s local imports ([about.tsx](../upstream/apps/docs/examples/about.tsx#L1-L9)); adaptation must resolve those against the project’s React/Vite shadcn/Tailwind frontend ([README.md](../../../../README.md)) without automatically adding the marquee dependency.

## Awards — `Awards1`

**Composition and behavior.** A static section contains an `h1` and a semantic three-column table (`Award`, `Description`, `Year`). It maps four in-component demo records into table rows; each award name is an external-link anchor ([awards.tsx](../upstream/apps/docs/examples/awards.tsx#L9-L38), [#L40-L78](../upstream/apps/docs/examples/awards.tsx#L40-L78)). The only component prop is `className` ([awards.tsx](../upstream/apps/docs/examples/awards.tsx#L5-L9)).

**Dependencies.** Only `cn` is imported ([awards.tsx](../upstream/apps/docs/examples/awards.tsx#L1-L3)); it does not depend on a Kibo or shadcn visual component.

**External/demo data.** Three demo records use `"#"` URLs and one points to `https://www.shadcnblocks.com` ([awards.tsx](../upstream/apps/docs/examples/awards.tsx#L10-L38)). No image assets occur.

**Integration notes.** Production needs an award/recognition data source and real destinations; the reference offers no loading, empty-state, pagination, sorting, or routing behavior. Its `target="_blank"` anchors lack `rel="noreferrer"`/`noopener` in source ([awards.tsx](../upstream/apps/docs/examples/awards.tsx#L61-L68)); address that during any application adaptation. Source reading only: no table overflow or keyboard behavior was tested.

## Blog — `Blog7`

**Composition and behavior.** The block is a centered tagline badge, heading, and description above a responsive card grid (one, two, then three columns through Tailwind breakpoints). Each post card has linked image, linked title, author/date metadata, summary, and linked “Read more” text with an `ArrowRight` icon ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L80-L142)).

**Inputs and demo behavior.**
- It accepts `tagline`, `heading`, `description`, `posts`, and `className`; `Post` includes id, text, date string, URL, and image fields ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L14-L33)).
- Default rendering is three static demo posts ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L35-L76)); the exported example provides no application data ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L145-L148)).
- `Post.label`, plus `buttonText` and `buttonUrl` props, are declared but not rendered or otherwise used ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L14-L33), [#L80-L142](../upstream/apps/docs/examples/blog.tsx#L80-L142)).

**Dependencies.** Uses `lucide-react`’s `ArrowRight`, local `cn`, shadcn `Badge`, and shadcn `Card`, `CardHeader`, `CardContent`, and `CardFooter` ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L1-L12)). The referenced shadcn Card pieces supply the card container and section padding ([card.tsx](../upstream/packages/shadcn-ui/components/ui/card.tsx#L5-L28), [#L64-L92](../upstream/packages/shadcn-ui/components/ui/card.tsx#L64-L92)).

**External assets.** All three demo posts reuse `https://deifkwefumgah.cloudfront.net/shadcnblocks/block/placeholder-dark-1.svg`; their destinations are one `https://www.shadcnblocks.com` URL and two `"#"` placeholders ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L39-L76)).

**Integration notes.** Connect post records to an agreed application route/data contract; this source supplies neither. Do not retain demo URL placeholders or remote placeholder imagery. All three card links use `target="_blank"` without `rel` ([blog.tsx](../upstream/apps/docs/examples/blog.tsx#L100-L116), [#L127-L135](../upstream/apps/docs/examples/blog.tsx#L127-L135)); this is a source-observed adaptation gap, not browser validation.

## Blog Post — `Blogpost1`

**Composition and behavior.** Header content is centered: title, description, author avatar/name, author-site link, formatted date, and hero image. A separate `prose` container follows with static heading/paragraph content, an alert, a table, a secondary image, blockquote, and list ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L38-L168)).

**Inputs versus demo content.**
- Customizable inputs are `className`, title, author object, hero image, `Date` publication date, and description ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L9-L36)).
- The body is hard-coded joke-tax prose rather than a content prop or children ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L76-L165)).
- The default `pubDate` is `new Date()` and is formatted as `MMMM d, yyyy` using `date-fns`; therefore the unconfigured demo’s displayed date is evaluated at render time ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L1-L2), [#L23-L36](../upstream/apps/docs/examples/blogpost.tsx#L23-L36), [#L64-L66](../upstream/apps/docs/examples/blogpost.tsx#L64-L66)).

**Dependencies.** Direct imports are `date-fns`, `lucide-react` `Lightbulb`, local `cn`, and shadcn `Alert`/`AlertDescription`/`AlertTitle` plus `Avatar`/`AvatarImage`/`AvatarFallback` ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L1-L7)). The snapshot’s Alert emits `role="alert"` ([alert.tsx](../upstream/packages/shadcn-ui/components/ui/alert.tsx#L22-L35)); the Avatar component is a Radix Avatar wrapper ([avatar.tsx](../upstream/packages/shadcn-ui/components/ui/avatar.tsx#L1-L52)).

**External assets.** Demo author avatar is CloudFront `avatar-2.webp`; both the default hero and inline article image reference CloudFront `placeholder-1.svg`; author website is `https://www.shadcnblocks.com` ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L26-L35), [#L57-L71](../upstream/apps/docs/examples/blogpost.tsx#L57-L71), [#L136-L144](../upstream/apps/docs/examples/blogpost.tsx#L136-L144)).

**Integration notes.** A production post needs a content model/rendering strategy, stable publication timestamp, image alt text sourced from the post, and application routing. The reference fixes hero and inline-image alt text to `"placeholder"` ([blogpost.tsx](../upstream/apps/docs/examples/blogpost.tsx#L68-L72), [#L136-L140](../upstream/apps/docs/examples/blogpost.tsx#L136-L140)); this is unsuitable as meaningful product content. No source establishes how rich article content is sanitized, fetched, or authored.

## Application-fit constraints

The project is a dashboard for template-based environment lifecycle operations, not a specified marketing/blog product ([README.md](../../../../README.md), [#L82-L87](../../../../README.md)). Consequently, none of these references establishes that a public About/Awards/Blog surface, an API endpoint, route, persistence model, or remote-image policy is in scope. Any adoption should first have an agreed product placement and data contract.

The repository directs UI work to inspect the exact Kibo pattern’s preview and source, preserve selected composition, and omit unnecessary demo data/dependencies ([AGENTS.md](../../../../AGENTS.md)). This recording inspected local source only; it did not validate a preview.

## Coverage / missing inputs

- **Covered:** all assigned docs—`about`, `awards`, `blog`, `blogpost`—and all four matching example implementations listed by the local catalog.
- **Variant coverage:** `About3`, `Awards1`, `Blog7`, and `Blogpost1`; no other assigned-name example variants are indexed in the pinned snapshot.
- **Missing inputs:** product decision to use any block; route and data/API contracts; final copy, owned asset sources and alt text; outbound-link policy; rich-content rendering/sanitization decision; and required browser/accessibility validation.
