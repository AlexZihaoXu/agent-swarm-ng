# Blocks: footer, form, hero, pricing

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of assigned Kibo blocks **footer, form, hero, and pricing** at upstream commit [`3d63cdb15b79d972e3dc38a10997987672f9b263`](../metadata/manifest.json) (manifest lines 3–13). The snapshot catalog confirms there is **no `packages/blocks` directory**; block docs and implementations are separately located under `apps/docs/content/blocks` and `apps/docs/examples` ([catalog](../catalog/blocks.md)).

The upstream docs page uses each block frontmatter `installer` value to load and render `apps/docs/examples/<installer>.tsx` ([page.tsx](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx), lines 44–78; [preview](../upstream/apps/docs/components/preview/index.tsx), lines 22–34, 121–128). Thus the following mappings are source-backed, not inferred solely from matching names.

| Block | Doc → example | Variants found |
|---|---|---|
| Footer | [`footer.mdx`](../upstream/apps/docs/content/blocks/footer.mdx) lines 1–6 → [`footer.tsx`](../upstream/apps/docs/examples/footer.tsx) lines 1–135 | One |
| Form | [`form.mdx`](../upstream/apps/docs/content/blocks/form.mdx) lines 1–12 → [`form.tsx`](../upstream/apps/docs/examples/form.tsx) lines 1–311 | One |
| Hero | [`hero.mdx`](../upstream/apps/docs/content/blocks/hero.mdx) lines 1–10 → [`hero.tsx`](../upstream/apps/docs/examples/hero.tsx) lines 1–145 | One |
| Pricing | [`pricing.mdx`](../upstream/apps/docs/content/blocks/pricing.mdx) lines 1–6 → [`pricing.tsx`](../upstream/apps/docs/examples/pricing.tsx) lines 1–168 | One |

## Files Retrieved

1. `docs/references/kibo/metadata/manifest.json` (lines 1–13, 646–678, 1647–1658, 1703–1707, 1892–1896) — pinned provenance and assigned-file inventory.
2. `docs/references/kibo/catalog/blocks.md` (lines 1–38) — block index and no-`packages/blocks` constraint.
3. `docs/references/kibo/upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx` (lines 21–79) and `components/preview/index.tsx` (lines 22–134) — explicit doc/installer/example rendering flow.
4. Assigned docs and examples listed in the mapping table — block composition and behavior.
5. `docs/references/kibo/upstream/packages/{choicebox,combobox,dropzone,mini-calendar,tags,announcement,marquee,video-player}/index.tsx` — dependent component behavior.
6. `frontend/package.json` (lines 1–37), `frontend/src/{main.tsx,app.tsx,styles.css}` (respectively lines 1–21, 1–49, 1–31) — current integration baseline.

## Key Code

### Footer

**Composition.** `Footer2` is a non-exported configurable component rendered by the default `FooterExample` export ([example](../upstream/apps/docs/examples/footer.tsx), lines 11–26, 132–135). It comprises:

- logo link/image/title and tagline;
- a responsive menu grid (two columns initially, six at `lg`, with the brand spanning two);
- copyright and policy-link row that stacks until `md` ([lines 84–128](../upstream/apps/docs/examples/footer.tsx)).

The doc promises 1–4 menu columns ([doc line 3](../upstream/apps/docs/content/blocks/footer.mdx)), but the `menuItems` type accepts an arbitrary array; no runtime limit is imposed ([example lines 3–9, 37–76](../upstream/apps/docs/examples/footer.tsx)).

**Demo versus application behavior.** This is static navigation markup: all default menu and policy destinations are `#`; it has no routing, analytics, consent, or legal-page behavior. The logo, texts, links, copyright, and `className` are props with demo defaults. In an application extraction, export or recreate `Footer2`, replace the demo content (including duplicated “Pricing”), and supply real destinations.

**Dependencies/assets.** Only `cn` from shadcn utilities is imported ([line 1](../upstream/apps/docs/examples/footer.tsx)). The default logo is an external CloudFront SVG and default logo link goes to `shadcnblocks.com` ([lines 29–34](../upstream/apps/docs/examples/footer.tsx)); this is not a local asset.

### Form

**Composition.** Client-side event-creation demo with basic information, radio-style event type, combobox venue, seven-day mini-calendar, multi-tag picker, image dropzone, and draft/create buttons ([example](../upstream/apps/docs/examples/form.tsx), lines 125–306). The frontmatter explicitly declares Kibo dependencies: Choicebox, Combobox, Dropzone, Mini Calendar, and Tags ([doc lines 5–10](../upstream/apps/docs/content/blocks/form.mdx)).

**Interactive source behavior (demo only).**

- State tracks event type, venue, date, accepted files, and selected tags; tags can be added once and removed ([lines 100–115](../upstream/apps/docs/examples/form.tsx)).
- Submit prevents navigation and emits a Sonner success toast; it makes no API request or persistence call ([lines 117–123](../upstream/apps/docs/examples/form.tsx)). “Save as Draft” is a plain `type="button"` without a handler ([lines 299–305](../upstream/apps/docs/examples/form.tsx)).
- Only the two text inputs are HTML-required. Their values, description, choicebox, combobox, calendar, tags, and files are not serialized through `name` fields or an API payload ([lines 143–168, 177–291](../upstream/apps/docs/examples/form.tsx)).
- The example stores accepted files but does **not** pass them back through `Dropzone src`; therefore the dependent `DropzoneContent` returns `null` and `DropzoneEmptyState` remains selected even after a drop, while the example separately displays its file-count text ([form lines 281–296](../upstream/apps/docs/examples/form.tsx); [Dropzone lines 119–127, 157–165](../upstream/packages/dropzone/index.tsx)).

**Dependencies.** Direct imports include shadcn `Button`, `Input`, `Label`, and `Textarea`, Lucide icons, React state, and `sonner` ([lines 3–52](../upstream/apps/docs/examples/form.tsx)). Kibo compounds additionally rely on shadcn radio/field (`choicebox`, [lines 3–25, 49–112](../upstream/packages/choicebox/index.tsx)), command/popover (`combobox`, [lines 14–29, 72–113](../upstream/packages/combobox/index.tsx)), `react-dropzone` ([package](../upstream/packages/dropzone/package.json), lines 44–50), date-fns ([mini-calendar package](../upstream/packages/mini-calendar/package.json), lines 63–70), and command/popover/badge (`tags`, [lines 14–29, 99–185](../upstream/packages/tags/index.tsx)).

There are no remote image/media URLs in this block. The hard-coded event types, venues, and tags are demo data ([lines 54–98](../upstream/apps/docs/examples/form.tsx)).

### Hero

**Composition.** Client component containing an announcement link, heading and description, two CTA buttons, a secondary “trusted by” marquee of seven branded icon links, then a controlled video player ([example](../upstream/apps/docs/examples/hero.tsx), lines 76–142). Frontmatter lists Announcement, Marquee, and Video Player ([doc lines 5–8](../upstream/apps/docs/content/blocks/hero.mdx)).

**Interactive/source behavior.**

- Both CTAs and the announcement point to `#`; branded logo links point to their respective external domains ([lines 79–102, 113–119](../upstream/apps/docs/examples/hero.tsx)).
- Marquee explicitly disables pause-on-hover. Its package wraps `react-fast-marquee`, defaults to infinite looping and autofill, and provides decorative fade elements ([hero lines 109–121](../upstream/apps/docs/examples/hero.tsx); [marquee lines 17–49](../upstream/packages/marquee/index.tsx)).
- The player passes a remote Mux MP4 as a muted, preloaded video and includes play, seek, time, mute, and volume controls ([hero lines 124–140](../upstream/apps/docs/examples/hero.tsx)). The Kibo wrapper delegates to `media-chrome/react` ([video-player lines 3–39, 41–124](../upstream/packages/video-player/index.tsx)).

**Dependencies/assets.** In addition to the three Kibo packages, it imports shadcn Button, `next/link`, and `@icons-pack/react-simple-icons` ([lines 3–36](../upstream/apps/docs/examples/hero.tsx)). External assets/destinations are the seven social/company URLs ([lines 38–74](../upstream/apps/docs/examples/hero.tsx)) and the Mux media URL ([line 130](../upstream/apps/docs/examples/hero.tsx)); neither is present in the project snapshot as a local asset.

### Pricing

**Composition.** Client-side pricing header, monthly/yearly tabs, and three responsive plan cards. Cards show descriptions, features with `BadgeCheck`, CTA buttons, and a “Popular” badge/ring for Pro ([example](../upstream/apps/docs/examples/pricing.tsx), lines 75–168).

**Interactive/source behavior (demo only).**

- Tabs update local `frequency`; numeric Pro prices animate/render through `NumberFlow` as USD `$90` monthly or `$75` yearly. Hobby and Enterprise render static strings ([lines 19–73, 75–137](../upstream/apps/docs/examples/pricing.tsx)).
- CTA buttons have neither links nor click handlers, so subscription/contact behavior is absent ([lines 151–158](../upstream/apps/docs/examples/pricing.tsx)).
- Plans, “20% off,” feature lists, and intentionally humorous Enterprise copy are fixture content to replace, not product facts ([lines 19–73](../upstream/apps/docs/examples/pricing.tsx)).

**Dependencies/assets.** Direct dependencies are `@number-flow/react`, Lucide, shadcn `Badge`, `Button`, `Card` family, `cn`, and `Tabs`/`TabsList`/`TabsTrigger` ([lines 3–17](../upstream/apps/docs/examples/pricing.tsx)). Its frontmatter declares no Kibo component dependencies ([doc lines 1–6](../upstream/apps/docs/content/blocks/pricing.mdx)), despite these base shadcn imports. It has no remote assets.

## Architecture and integration gaps

- **Upstream presentation flow:** frontmatter `installer` feeds the generic preview, which reads/imports the basename-matched example and renders it directly for a block ([page lines 59–66](../upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx); [preview lines 27–34, 121–128](../upstream/apps/docs/components/preview/index.tsx)). The MDX files are metadata only; the TSX files above are the complete examples.
- **Current project mismatch:** the target is a Vite/React Router dashboard ([README.md](../../../../README.md) lines 35–54), while Hero imports Next’s `Link`; it needs React Router link/navigation adaptation. Current routing exposes only the root app and fallback ([`frontend/src/main.tsx`](../../../../frontend/src/main.tsx), lines 10–20).
- **Missing component/dependency baseline:** current frontend dependencies do not include Kibo packages, Lucide, Sonner, NumberFlow, Media Chrome, Simple Icons, React Dropzone, Date-fns, or Radix’s controllable-state helper ([`frontend/package.json`](../../../../frontend/package.json), lines 13–35). Current local UI contains only Button, not the input/label/textarea/card/badge/tabs or Kibo compounds used above ([`frontend/src`](../../../../frontend/src) inventory; [`button.tsx`](../../../../frontend/src/components/ui/button.tsx), lines 1–26).
- **Theme-token gap:** current CSS declares background/foreground/primary/muted/border/ring only ([`styles.css`](../../../../frontend/src/styles.css), lines 3–22). The examples/dependent components use additional tokens such as `secondary`, `accent`, `card`, `destructive`, and `font-sans` ([hero lines 104–112](../upstream/apps/docs/examples/hero.tsx); [pricing lines 97–108](../upstream/apps/docs/examples/pricing.tsx); [video-player lines 19–29](../upstream/packages/video-player/index.tsx)).
- **Toast host gap:** upstream mounts `<Toaster />` in its layout ([`apps/docs/app/layout.tsx`](../upstream/apps/docs/app/layout.tsx), lines 27–36); current React root has no equivalent ([`frontend/src/main.tsx`](../../../../frontend/src/main.tsx), lines 10–20). Form’s toast therefore requires deliberate notification integration.
- **Product/API gap:** README defines a container-environment dashboard and says dynamic creation is pending ([README.md](../../../../README.md) lines 37, 82–87), not event creation, public pricing, or marketing navigation. Form must receive an agreed domain model, validation, endpoint, upload handling, error/pending states, and draft semantics before use. Pricing needs billing/contact ownership; footer needs actual information architecture/legal URLs; Hero needs approved messaging, destination routes, and media/brand licensing.

## Coverage / missing inputs

- **Covered:** all four assigned block docs and their one source-backed example variant; direct Kibo/shadcn dependencies; demo behavior; external assets; current project integration constraints.
- **Not claimed:** browser, visual, responsive, media-playback, keyboard, screen-reader, or accessibility validation. This report is source reading only.
- **Missing inputs:** desired screen(s)/routes, approved copy and brand assets, external-media policy/licensing, real footer/legal destinations, form schema/API/upload contract, and pricing/billing/contact flow.
