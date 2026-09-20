# Components: video-player

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only reference analysis of the **Video Player component** only, from the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), as recorded in `docs/references/kibo/metadata/manifest.json` (lines 1-10). No source was executed, changed, or browser-validated.

The catalog classifies this as a **component** documentation page, not a pattern: `docs/references/kibo/catalog/components.md` (component index entry for `video-player`). Its use in the Hero source is a block composition, not a separate Video Player variant.

## Files Retrieved

1. `docs/references/kibo/upstream/apps/docs/content/components/video-player.mdx` (lines 1-23) — component metadata and upstream feature claims.
2. `docs/references/kibo/upstream/packages/video-player/index.tsx` (lines 1-125) — complete implementation and all exports.
3. `docs/references/kibo/upstream/packages/video-player/package.json` (lines 1-18) — package identity and declared dependencies.
4. `docs/references/kibo/upstream/packages/video-player/tsconfig.json` (lines 1-13) — resolves `@/lib/utils` to `packages/shadcn-ui/lib`.
5. `docs/references/kibo/upstream/packages/shadcn-ui/lib/utils.ts` (lines 1-6) — `cn` helper used by styled child wrappers.
6. `docs/references/kibo/upstream/apps/docs/examples/video-player.tsx` (lines 1-37) — dedicated Video Player example.
7. `docs/references/kibo/upstream/apps/docs/examples/hero.tsx` (lines 24-35, 124-141) — the only other matching docs-example use.
8. `docs/references/kibo/upstream/apps/docs/content/blocks/hero.mdx` (lines 1-10) — establishes Hero as a block that depends on Video Player.
9. `docs/references/kibo/upstream/apps/docs/content/components/meta.json` (lines 25-43) — navigation metadata includes `video-player`.
10. `docs/references/kibo/catalog/examples.md` — indexed example inventory, including `video-player.tsx` and `hero.tsx`.
11. `docs/references/kibo/metadata/manifest.json` (lines 996-1002, 11461-11482) — verifies the exact component-doc and three-package-file snapshot entries.

## Key Code

### Public exports

All exports are named and defined in `packages/video-player/index.tsx`; each exposes the corresponding `ComponentProps` type.

| Export | Props source / wrapper behavior | Source |
| --- | --- | --- |
| `VideoPlayer` | `ComponentProps<typeof MediaController>`; renders `MediaController`. | `packages/video-player/index.tsx` (lines 17-39) |
| `VideoPlayerControlBar` | Direct `MediaControlBar` passthrough. | `packages/video-player/index.tsx` (lines 41-45) |
| `VideoPlayerTimeRange` | `MediaTimeRange` with default `p-2.5`. | `packages/video-player/index.tsx` (lines 47-54) |
| `VideoPlayerTimeDisplay` | `MediaTimeDisplay` with default `p-2.5`. | `packages/video-player/index.tsx` (lines 56-65) |
| `VideoPlayerVolumeRange` | `MediaVolumeRange` with default `p-2.5`. | `packages/video-player/index.tsx` (lines 67-76) |
| `VideoPlayerPlayButton` | `MediaPlayButton` with default `p-2.5`. | `packages/video-player/index.tsx` (lines 78-85) |
| `VideoPlayerSeekBackwardButton` | `MediaSeekBackwardButton` with default `p-2.5`. | `packages/video-player/index.tsx` (lines 87-96) |
| `VideoPlayerSeekForwardButton` | `MediaSeekForwardButton` with default `p-2.5`. | `packages/video-player/index.tsx` (lines 98-107) |
| `VideoPlayerMuteButton` | `MediaMuteButton` with default `p-2.5`. | `packages/video-player/index.tsx` (lines 109-116) |
| `VideoPlayerContent` | Native `<video>` props; adds `mt-0 mb-0`. | `packages/video-player/index.tsx` (lines 118-125) |

### Styling and composition

`VideoPlayer` applies Media Chrome CSS custom properties mapped to the host shadcn-style tokens—primary, background, foreground, accent, font, muted foreground, destructive, and border. Caller-provided `style` is spread after these defaults, so supplied values override them. `className`, children, and other controller props pass through to `MediaController`.  
Source: `docs/references/kibo/upstream/packages/video-player/index.tsx` (lines 19-39).

The other styled wrappers merge their fixed Tailwind class with a caller `className` using `cn`. That helper is `twMerge(clsx(inputs))`, so conflicting Tailwind utilities are merged rather than simply concatenated.  
Sources: `docs/references/kibo/upstream/packages/video-player/index.tsx` (lines 49-125); `docs/references/kibo/upstream/packages/shadcn-ui/lib/utils.ts` (lines 1-6).

There is **no component-specific CSS file** in the package snapshot: its complete package directory contains only `index.tsx`, `package.json`, and `tsconfig.json`, corroborated by the manifest entries at `docs/references/kibo/metadata/manifest.json` (lines 11461-11482).

### Dependencies

`@repo/video-player` is private package version `0.0.0`; it declares `media-chrome@^4.14.0`, React/React DOM `^19.2.0`, and workspace `@repo/shadcn-ui`.  
Source: `docs/references/kibo/upstream/packages/video-player/package.json` (lines 2-16).

The implementation imports its primitives from `media-chrome/react`; the snapshot contains no vendored Media Chrome implementation. Therefore, Media Chrome-specific prop semantics beyond the displayed types are not established by this source review.  
Source: `docs/references/kibo/upstream/packages/video-player/index.tsx` (lines 3-15).

### Controlled/uncontrolled behavior

The Kibo wrapper layer has no React state, hooks, callbacks, or explicit controlled/uncontrolled API. It delegates prop types and behavior to `MediaController` and the other `media-chrome/react` primitives, while `VideoPlayerContent` accepts normal native-video props.  
Source: `docs/references/kibo/upstream/packages/video-player/index.tsx` (lines 17-125).

Accordingly, controlled media behavior is **not documented or evidenced in Kibo’s wrapper implementation**. The examples are static compositions: they do not hold playback, volume, time, or event state.  
Sources: `docs/references/kibo/upstream/apps/docs/examples/video-player.tsx` (lines 16-35); `docs/references/kibo/upstream/apps/docs/examples/hero.tsx` (lines 124-141).

## Architecture

```text
VideoPlayer / control wrappers
  ├─ media-chrome/react primitives
  ├─ VideoPlayerContent → native <video>
  └─ cn helper → @repo/shadcn-ui/lib/utils
       └─ clsx + tailwind-merge
```

`VideoPlayer` is a compositional facade over `MediaController`; it does not construct controls automatically. Consumers provide a media element and whichever control components they want as children. The dedicated example explicitly marks the video as `slot="media"` and then provides a control bar.  
Source: `docs/references/kibo/upstream/apps/docs/examples/video-player.tsx` (lines 17-33).

## Usage examples and gotchas

| Example | Actual composition | Notes |
| --- | --- | --- |
| `apps/docs/examples/video-player.tsx` | Rounded/bordered player; muted, preloaded remote MP4 with `crossOrigin=""`, `slot="media"`; play, backward/forward seek, range, duration display, mute, and volume controls. | This is the dedicated component demo, not evidence that these props or the external Mux URL are production defaults. Source: lines 16-37. |
| `apps/docs/examples/hero.tsx` | Reuses the exact same Video Player subtree inside a broader marketing Hero example. | This is a **Hero block** composition, not a second Video Player API variation. Hero metadata declares Video Player as a dependency. Sources: `hero.tsx` lines 24-35 and 124-141; `content/blocks/hero.mdx` lines 2-9. |

Concrete integration considerations evidenced by source:

- A usable composition needs the consumer to place `VideoPlayerContent` and desired controls within `VideoPlayer`; the wrapper itself supplies no default child media or controls. `packages/video-player/index.tsx` (lines 31-39, 43-125).
- The examples explicitly use `slot="media"` on the native video; retain or independently verify this integration requirement when adapting the composition. `apps/docs/examples/video-player.tsx` (lines 18-24).
- The default visual tokens assume CSS variables such as `--primary`, `--background`, and `--font-sans` exist in the consuming application. `packages/video-player/index.tsx` (lines 19-29).
- The upstream docs claim keyboard accessibility, responsive design, format support, interactive seeking, and cross-browser compatibility, but those are documentation claims only—not validated by this review. `apps/docs/content/components/video-player.mdx` (lines 10-23).

## Start Here

Open `docs/references/kibo/upstream/packages/video-player/index.tsx` first. It is the complete implementation surface: all ten exports, prop delegation, token styling, and the only local styling behavior are contained in its 125 lines.

## Coverage / missing inputs

- **Accounted for:** component documentation page; all three `packages/video-player` files; no package CSS file exists; both matching `apps/docs/examples` usages; required `@/lib/utils` helper; component catalog and snapshot metadata.
- **Not claimed:** browser, keyboard, responsive, media-format, cross-browser, accessibility, network, or visual validation.
- **Missing input:** the external `media-chrome` implementation is not vendored in this snapshot, so its detailed prop and playback-control semantics cannot be confirmed from local Kibo source.
