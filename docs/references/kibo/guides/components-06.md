# Components: qr-code, rating, reel, relative-time, sandbox

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


**Scope/revision.** Static, read-only review of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in [`docs/references/kibo/metadata/manifest.json`](../metadata/manifest.json). This covers only component packages **qr-code, rating, reel, relative-time, sandbox** and their documentation/example sources. These are component packages, not Kibo pattern sources.

## Code Context

### Files Retrieved

1. Component docs:
   - [`apps/docs/content/components/qr-code.mdx`](../upstream/apps/docs/content/components/qr-code.mdx#L1-L37)
   - [`apps/docs/content/components/rating.mdx`](../upstream/apps/docs/content/components/rating.mdx#L1-L35)
   - [`apps/docs/content/components/reel.mdx`](../upstream/apps/docs/content/components/reel.mdx#L1-L43)
   - [`apps/docs/content/components/relative-time.mdx`](../upstream/apps/docs/content/components/relative-time.mdx#L1-L29)
   - [`apps/docs/content/components/sandbox.mdx`](../upstream/apps/docs/content/components/sandbox.mdx#L1-L25)
2. Implementations:
   - [`packages/qr-code/index.tsx`](../upstream/packages/qr-code/index.tsx#L1-L88), [`server.tsx`](../upstream/packages/qr-code/server.tsx#L1-L42)
   - [`packages/rating/index.tsx`](../upstream/packages/rating/index.tsx#L1-L243)
   - [`packages/reel/index.tsx`](../upstream/packages/reel/index.tsx#L1-L745), [`reel-controlled.tsx`](../upstream/packages/reel/reel-controlled.tsx#L1-L327)
   - [`packages/relative-time/index.tsx`](../upstream/packages/relative-time/index.tsx#L1-L181)
   - [`packages/sandbox/index.tsx`](../upstream/packages/sandbox/index.tsx#L1-L251)
3. Package metadata:
   - [`packages/qr-code/package.json`](../upstream/packages/qr-code/package.json#L1-L21), [`rating/package.json`](../upstream/packages/rating/package.json#L1-L19), [`reel/package.json`](../upstream/packages/reel/package.json#L1-L20), [`relative-time/package.json`](../upstream/packages/relative-time/package.json#L1-L18), [`sandbox/package.json`](../upstream/packages/sandbox/package.json#L1-L18).
4. Helper sources used by the packages:
   - [`packages/shadcn-ui/lib/utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6) (`cn`)
   - [`components/ui/button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L1-L60) and [`progress.tsx`](../upstream/packages/shadcn-ui/components/ui/progress.tsx#L1-L31) (Reel)
   - [`components/ui/resizable.tsx`](../upstream/packages/shadcn-ui/components/ui/resizable.tsx#L1-L56) (Sandbox documentation demo).
5. The catalog identifies 41 component-doc pages and 168 example files, but is only an index, not behavioral validation: [`catalog/summary.json`](../catalog/summary.json), [`catalog/components.md`](../catalog/components.md), [`catalog/examples.md`](../catalog/examples.md).

All five package directories contain TS/TSX, `package.json`, and `tsconfig.json`; none contains a standalone CSS file. Their styling is Tailwind class strings, merged by `cn`. Each `tsconfig.json` maps `@/components/*` and `@/lib/*` to `packages/shadcn-ui`; for example [`packages/reel/tsconfig.json`](../upstream/packages/reel/tsconfig.json#L1-L13).

## Key Code

| Component | Actual exports / state model | Direct runtime dependencies |
| --- | --- | --- |
| QR Code | `QRCode`, `QRCodeProps`; separate server entry exports the same names. Stateless externally; client-generated SVG is internal state. | `qrcode`, `culori`, React, `@repo/shadcn-ui` ([metadata](../upstream/packages/qr-code/package.json#L6-L11)) |
| Rating | `Rating`, `RatingButton` and prop types. `value`/`onValueChange` controlled; `defaultValue` uncontrolled. | Radix controllable state, Lucide, React, shadcn-ui ([metadata](../upstream/packages/rating/package.json#L6-L11)) |
| Reel | `Reel`, `ReelContent`, `ReelItem`, `ReelVideo`, `ReelImage`, `ReelProgress`, controls/buttons, navigation, overlay, header, footer, plus prop/item types. Index, playing, and muted each support controlled/uncontrolled forms. | Radix controllable state, Motion, Lucide, React, shadcn-ui ([metadata](../upstream/packages/reel/package.json#L6-L12)) |
| Relative Time | `RelativeTime`, `RelativeTimeZone`, `RelativeTimeZoneDisplay`, `RelativeTimeZoneDate`, `RelativeTimeZoneLabel` and prop types. `time` is controlled; `defaultTime` is uncontrolled. | Radix controllable state, React, shadcn-ui ([metadata](../upstream/packages/relative-time/package.json#L6-L10)) |
| Sandbox | Sandpack wrappers: provider, layout, editor, console, preview, file explorer; tab root/list/trigger/content; corresponding types. Tab value supports controlled/uncontrolled use. | `@codesandbox/sandpack-react`, React, shadcn-ui ([metadata](../upstream/packages/sandbox/package.json#L6-L10)) |

### QR Code

- The client export is a `"use client"` component. It regenerates an SVG when `data`, colors, or `robustness` changes; before generation it renders `null`, and errors are only sent to `console.error` ([`index.tsx`](../upstream/packages/qr-code/index.tsx#L31-L78)). `robustness` is `"L" | "M" | "Q" | "H"` and defaults to `"M"` ([lines 8-13, 31-35](../upstream/packages/qr-code/index.tsx#L8-L35)).
- Client colors are read from `--foreground`/`--background`, parsed only as the specific `oklch(...)` form, then converted to hex. **Gotcha:** a supplied client hex color does not match that regex and falls back to hard-coded OKLCH values rather than using the supplied hex ([lines 15-29, 44-64](../upstream/packages/qr-code/index.tsx#L15-L64)).
- It asks `qrcode` for 200-wide, margin-zero SVG and injects it with `dangerouslySetInnerHTML`; the wrapper and descendant SVG use `size-full`, so usable dimensions depend on the parent/class ([lines 56-65, 80-86](../upstream/packages/qr-code/index.tsx#L56-L86)).
- The server entry is `async`, requires `foreground` and `background`, passes them directly to `qrcode`, and throws if no SVG is returned ([`server.tsx` lines 5-31](../upstream/packages/qr-code/server.tsx#L5-L31)). It is materially different from the client entry; the documented server demo uses hex values ([`qr-code-server.tsx`](../upstream/apps/docs/examples/qr-code-server.tsx#L1-L11)).

**All matching documentation examples:** baseline [`qr-code.tsx`](../upstream/apps/docs/examples/qr-code.tsx#L1-L7); wrapper styling [`qr-code-styling.tsx`](../upstream/apps/docs/examples/qr-code-styling.tsx#L1-L12); all four robustness values [`qr-code-robust.tsx`](../upstream/apps/docs/examples/qr-code-robust.tsx#L1-L26); server import/color requirement above. The docs describe styling, robustness, and server variation ([`qr-code.mdx`](../upstream/apps/docs/content/components/qr-code.mdx#L19-L37)).

### Rating

The baseline composition is linked, not copied:  ([`rating.tsx`](../upstream/apps/docs/examples/rating.tsx#L1-L13)); count is determined by children, not a `max` prop.

- `RatingButton` defaults to a 20px Lucide `StarIcon`, accepts a custom Lucide `ReactElement`, and clones each child to assign its zero-based index ([`index.tsx` lines 42-52, 231-239](../upstream/packages/rating/index.tsx#L42-L52)). Active icons are filled; hover and focused values temporarily determine visual activation ([lines 64-119](../upstream/packages/rating/index.tsx#L64-L119)).
- `Rating` delegates controlled/uncontrolled synchronization to Radix. `onChange` receives the DOM event and new value; `onValueChange` receives only the number ([lines 123-165](../upstream/packages/rating/index.tsx#L123-L165)).
- Arrow Right/Left change the value; Shift/Meta with those arrows moves to the last/first child. It moves focus to the corresponding contained button ([lines 168-208](../upstream/packages/rating/index.tsx#L168-L208)). The container has `role="radiogroup"` and `aria-label="Rating"`; each item is a native button, disabled when `readOnly` ([lines 93-119, 221-240](../upstream/packages/rating/index.tsx#L93-L119)).
- **Source/doc mismatch:** the docs list “Hidden input support for forms” ([`rating.mdx` line 17](../upstream/apps/docs/content/components/rating.mdx#L10-L18)); this implementation contains no input element or form-value prop. Do not rely on that feature without adding application-level form handling.
- **Gotcha:** when value is zero, every non-read-only button receives `tabIndex={-1}` because only a selected button becomes tabbable ([lines 64-70](../upstream/packages/rating/index.tsx#L64-L70)).

**All matching documentation examples:** color class (`text-yellow-500`) [`rating-colors.tsx`](../upstream/apps/docs/examples/rating-colors.tsx#L1-L13); `size={30}` [`rating-size.tsx`](../upstream/apps/docs/examples/rating-size.tsx#L1-L13); `HeartIcon` [`rating-icon.tsx`](../upstream/apps/docs/examples/rating-icon.tsx#L1-L14); controlled number input [`rating-controlled.tsx`](../upstream/apps/docs/examples/rating-controlled.tsx#L1-L29).

### Reel

- Root props are `data`, controlled/default index, playing and muted triples, plus `autoPlay`; defaults are index `0`, muted `true`, and playing from `defaultPlaying ?? autoPlay` where `autoPlay` defaults to `true` ([`index.tsx` lines 72-131](../upstream/packages/reel/index.tsx#L72-L131)). The root takes full parent height and a fixed 9:16 aspect ratio ([lines 156-163](../upstream/packages/reel/index.tsx#L156-L163)).
- `ReelContent` is context-dependent and fades each index change for 0.3 seconds via Motion ([lines 168-214](../upstream/packages/reel/index.tsx#L168-L214)). All compositional children require a `Reel` ancestor; otherwise the internal hook throws ([lines 62-70](../upstream/packages/reel/index.tsx#L62-L70)).
- `ReelVideo` drives progress from the declared `ReelItem.duration`, not media metadata; it loops the actual video, calls `video.play()` but deliberately ignores rejected autoplay promises, and loops index back to zero after the declared duration ([lines 231-346](../upstream/packages/reel/index.tsx#L231-L346)). `ReelImage` does analogous animation-frame timing and defaults its own `duration` to five seconds ([lines 349-446](../upstream/packages/reel/index.tsx#L349-L446)). **Gotcha:** `ReelImage` does not automatically consume `ReelItem.duration`; callers must pass `duration={item.duration}`, as the image demo does.
- `ReelProgress` renders standard shadcn progress segments or calls a render function with `(item, index, isActive, progress)` ([lines 448-516](../upstream/packages/reel/index.tsx#L448-L516)). Previous/next controls stop at boundaries; automatic duration completion loops, so their behaviors differ ([lines 531-605](../upstream/packages/reel/index.tsx#L531-L605)).
- `ReelNavigation` is a full-cover button that changes index based on click position across its left/right halves; it has no explicit keyboard handler in this source ([lines 669-710](../upstream/packages/reel/index.tsx#L669-L710)). Header/footer/overlay are layout primitives; overlay is explicitly `pointer-events-none` ([lines 712-745](../upstream/packages/reel/index.tsx#L712-L745)).

**All matching documentation examples:** default video reel with controls [`reel.tsx`](../upstream/apps/docs/examples/reel.tsx#L1-L66); image timing and footer metadata [`reel-images.tsx`](../upstream/apps/docs/examples/reel-images.tsx#L1-L81); minimal video/progress/navigation [`reel-minimal.tsx`](../upstream/apps/docs/examples/reel-minimal.tsx#L1-L53); custom author/social *presentation* [`reel-custom.tsx`](../upstream/apps/docs/examples/reel-custom.tsx#L1-L128). The social buttons in the custom demo have no action handlers, so they are demo UI rather than implemented social behavior.

`packages/reel/reel-controlled.tsx` is an additional package-local controlled-state example, not one of the matching docs-example imports. It demonstrates externally managing all three state axes and passing callbacks back to `Reel` ([lines 45-194](../upstream/packages/reel/reel-controlled.tsx#L45-L194)).

### Relative Time

- Despite its name, this renders formatted absolute date/time values for supplied IANA timezone strings; it does not calculate “time ago.” `RelativeTime` owns time and exposes format options, while each `RelativeTimeZone` supplies `zone` by context ([`index.tsx` lines 12-63, 105-133](../upstream/packages/relative-time/index.tsx#L12-L63)).
- With no controlled `time`, it advances internal time every second. A controlled `time` disables that interval; the parent then owns updates ([lines 65-103](../upstream/packages/relative-time/index.tsx#L65-L103)).
- Defaults include the zone in `Intl.DateTimeFormat` options. **Gotcha:** supplied `dateFormatOptions` or `timeFormatOptions` replace the default object rather than merge with it; unless the caller includes `timeZone`, formatting follows the runtime default zone, not the child’s `zone` ([lines 12-38](../upstream/packages/relative-time/index.tsx#L12-L38)). The format-option demos omit `timeZone`, so they demonstrate this replacement behavior.
- `RelativeTimeZoneProps` declares per-zone format options, but `RelativeTimeZone` does not consume them; only root context options are used. `RelativeTimeZoneDate` also destructures `className` but does not apply it ([lines 105-165](../upstream/packages/relative-time/index.tsx#L105-L165)).

**All matching documentation examples:** default three-zone display [`relative-time.tsx`](../upstream/apps/docs/examples/relative-time.tsx#L1-L31); root date options [`relative-time-format-date.tsx`](../upstream/apps/docs/examples/relative-time-format-date.tsx#L1-L31); root time options [`relative-time-format-time.tsx`](../upstream/apps/docs/examples/relative-time-format-time.tsx#L1-L31); controlled time maintained by a parent one-second interval [`relative-time-controlled.tsx`](../upstream/apps/docs/examples/relative-time-controlled.tsx#L1-L43).

### Sandbox

- This is a composition/styling wrapper around Sandpack, not an independent editor/runtime implementation. Provider and layout pass Sandpack props through; editor defaults `showTabs` to `false`, preview defaults `showOpenInCodeSandbox` to `false`, and file explorer defaults `autoHiddenFiles` to `true` ([`index.tsx` lines 32-56, 203-251](../upstream/packages/sandbox/index.tsx#L32-L56)).
- `SandboxTabs` is controlled when `value` is defined; otherwise it initializes from `defaultValue` and updates internal state. `onValueChange` is called in both modes ([lines 79-124](../upstream/packages/sandbox/index.tsx#L79-L124)).
- The custom tab wrapper sets `role="tablist"`, `role="tab"`, `role="tabpanel"`, and active state/`aria-selected`; inactive panels are visually hidden and pointer-events disabled but remain rendered ([lines 126-201](../upstream/packages/sandbox/index.tsx#L126-L201)). There is no explicit arrow-key tab navigation in this wrapper source.
- The full demo adds a resizable file explorer/editor split using shadcn’s `react-resizable-panels` wrapper ([`sandbox.tsx` lines 16-70](../upstream/apps/docs/examples/sandbox.tsx#L16-L70); helper implementation [`resizable.tsx`](../upstream/packages/shadcn-ui/components/ui/resizable.tsx#L1-L56)). That resizing is demo composition, not a behavior built into `SandboxLayout`.

**All matching documentation examples:** full file-explorer/resizable composition [`sandbox.tsx`](../upstream/apps/docs/examples/sandbox.tsx#L1-L70); no-explorer layout with editor tabs enabled [`sandbox-no-file-explorer.tsx`](../upstream/apps/docs/examples/sandbox-no-file-explorer.tsx#L1-L51).

## Architecture

All assigned packages are source-distributed React components using the shared `@repo/shadcn-ui` path aliases and `cn` helper. Documentation examples import packages by `@repo/<name>` and are documentation demos, not production application code. Reel additionally composes the shared Button and Progress; Sandbox delegates editor/preview/console behavior to Sandpack. The snapshot’s docs feature lists are useful navigational claims, but the implementation files above are the evidence for actual wrapper behavior.

No source was executed, no browser/visual/accessibility validation was performed, and external dependency behavior (qrcode, Motion, Radix, Sandpack) was not independently validated.

## Start Here

Open [`packages/reel/index.tsx`](../upstream/packages/reel/index.tsx#L72-L214) first if evaluating adoption: it contains the largest API surface, all three controlled-state axes, required composition/context, and the duration-driven playback model.

## Coverage / missing inputs

- **Covered:** all five assigned MDX pages, every implementation and package metadata file (including QR server entry and Reel’s package-local controlled demo), all 19 matching `apps/docs/examples` imports, shared helper imports, and catalog/manifest identity.
- **CSS:** no standalone CSS exists in the five assigned package directories.
- **Missing/unvalidated:** no tests, browser execution, rendered preview, dependency installation, or upstream website validation was supplied/performed. Documentation claims not directly evidenced by wrapper source—especially Rating’s hidden-input claim and Sandpack-provided editor capabilities—remain uncertain.
