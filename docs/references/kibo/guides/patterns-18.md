# Patterns: toggle, tooltip

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of Kibo **toggle** and **tooltip** pattern families only. The local reference is pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (tree `db16e3c8338b75f5bdd453acd598c6137fe1365a`), per [`metadata/manifest.json`](../metadata/manifest.json). The snapshot is passive reference data, not an installed dependency or runnable application ([`docs/references/kibo/README.md`](../README.md)).

This report is based on local source reading and catalog metadata. Preview URLs below were inventoried but **not browser-validated**.

## Files Retrieved

1. [`docs/references/kibo/catalog/patterns/toggle.md`](../catalog/patterns/toggle.md) — complete toggle catalog: 7 entries.
2. [`docs/references/kibo/catalog/patterns/tooltip.md`](../catalog/patterns/tooltip.md) — complete tooltip catalog: 8 entries.
3. [`packages/patterns/toggle/sizes/toggle-sizes-1.tsx`](../upstream/packages/patterns/toggle/sizes/toggle-sizes-1.tsx#L1-L14) through [`toggle-standard-4.tsx`](../upstream/packages/patterns/toggle/standard/toggle-standard-4.tsx#L1-L15) — all toggle demos.
4. [`packages/patterns/tooltip/content/tooltip-content-1.tsx`](../upstream/packages/patterns/tooltip/content/tooltip-content-1.tsx#L1-L28) through [`tooltip-standard-4.tsx`](../upstream/packages/patterns/tooltip/standard/tooltip-standard-4.tsx#L1-L25) — all tooltip demos.
5. [`packages/shadcn-ui/components/ui/toggle.tsx`](../upstream/packages/shadcn-ui/components/ui/toggle.tsx#L1-L47) and [`tooltip.tsx`](../upstream/packages/shadcn-ui/components/ui/tooltip.tsx#L1-L61) — actual mirrored primitives used by the demos.
6. [`button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L1-L60), [`kbd.tsx`](../upstream/packages/shadcn-ui/components/ui/kbd.tsx#L1-L28), and [`lib/utils.ts`](../upstream/packages/shadcn-ui/lib/utils.ts#L1-L6) — supporting primitives used only by tooltip variants.
7. [`packages/patterns/package.json`](../upstream/packages/patterns/package.json#L1-L26) and [`packages/shadcn-ui/package.json`](../upstream/packages/shadcn-ui/package.json#L5-L26) — source-package dependency declarations.

## Key Code

### Shared primitive requirements

- Every demo is a client component (`"use client"`).
- `Toggle` wraps `radix-ui`’s `TogglePrimitive.Root`, forwards its remaining props, and uses CVA/Tailwind variants. It has `default`/`outline` variants and `sm`/default/`lg` sizes; on-state styles depend on `data-state=on` ([`toggle.tsx`](../upstream/packages/shadcn-ui/components/ui/toggle.tsx#L3-L43)).
- `Tooltip` wraps each root in a `TooltipProvider` whose default `delayDuration` is `0`; `TooltipContent` renders in a Radix portal, defaults `sideOffset` to `0`, and always adds an arrow ([`tooltip.tsx`](../upstream/packages/shadcn-ui/components/ui/tooltip.tsx#L8-L61)).
- Tooltip demos use `Button` with `variant="outline"` except the icon example, which uses a native `button`. `Button` itself uses Radix `Slot`, CVA, and focus-visible styling ([`button.tsx`](../upstream/packages/shadcn-ui/components/ui/button.tsx#L1-L60)).
- Source-level dependencies for these pieces are React, `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, and—where icons appear—`lucide-react`; the snapshot declares `radix-ui` as `"latest"` rather than a pinned version ([`shadcn-ui/package.json`](../upstream/packages/shadcn-ui/package.json#L5-L26)). This is reference evidence, not a recommendation to change project dependencies.

### Toggle

Source root: `docs/references/kibo/upstream/packages/patterns/toggle/`

| Collection | ID / title | Local source | Preview | Source-read composition and distinction |
|---|---|---|---|---|
| sizes | `toggle-sizes-1` — Small Toggle | [`toggle-sizes-1.tsx`](../upstream/packages/patterns/toggle/sizes/toggle-sizes-1.tsx#L1-L14) | https://www.kibo-ui.com/patterns/toggle/sizes/toggle-sizes-1 | Icon-only `Toggle`, `size="sm"`, `BoldIcon`, and `aria-label="Toggle bold"`. |
| sizes | `toggle-sizes-2` — Default Size Toggle | [`toggle-sizes-2.tsx`](../upstream/packages/patterns/toggle/sizes/toggle-sizes-2.tsx#L1-L14) | https://www.kibo-ui.com/patterns/toggle/sizes/toggle-sizes-2 | Icon-only italic control; omits `size`, thus uses primitive default sizing. |
| sizes | `toggle-sizes-3` — Large Toggle | [`toggle-sizes-3.tsx`](../upstream/packages/patterns/toggle/sizes/toggle-sizes-3.tsx#L1-L14) | https://www.kibo-ui.com/patterns/toggle/sizes/toggle-sizes-3 | Icon-only underline control with `size="lg"`. |
| standard | `toggle-standard-1` — Default Toggle | [`toggle-standard-1.tsx`](../upstream/packages/patterns/toggle/standard/toggle-standard-1.tsx#L1-L14) | https://www.kibo-ui.com/patterns/toggle/standard/toggle-standard-1 | Default-variant, default-size icon-only bold control. |
| standard | `toggle-standard-2` — Outline Toggle | [`toggle-standard-2.tsx`](../upstream/packages/patterns/toggle/standard/toggle-standard-2.tsx#L1-L14) | https://www.kibo-ui.com/patterns/toggle/standard/toggle-standard-2 | Same icon-only shape, but passes `variant="outline"`. |
| standard | `toggle-standard-3` — Disabled Toggle | [`toggle-standard-3.tsx`](../upstream/packages/patterns/toggle/standard/toggle-standard-3.tsx#L1-L14) | https://www.kibo-ui.com/patterns/toggle/standard/toggle-standard-3 | Underline icon with native primitive `disabled`; primitive styling includes disabled pointer-event and opacity rules. |
| standard | `toggle-standard-4` — Toggle with Text | [`toggle-standard-4.tsx`](../upstream/packages/patterns/toggle/standard/toggle-standard-4.tsx#L1-L15) | https://www.kibo-ui.com/patterns/toggle/standard/toggle-standard-4 | Default toggle containing `BoldIcon` followed by visible “Bold” text. |

**Demo boundaries and adaptation.** These seven examples provide no `pressed`, `defaultPressed`, `onPressedChange`, formatting target, persistence, authorization, error handling, or loading logic. The bold/italic/underline semantics are demo labels, not a connected editor implementation. Safely retain the `Toggle` composition, choose only documented size/variant props, give icon-only controls contextual accessible names, and connect the forwarded Radix props to application state and the real command. Preserve `disabled` when action availability requires it rather than using the disabled demo as a static appearance.

### Tooltip

Source root: `docs/references/kibo/upstream/packages/patterns/tooltip/`

| Collection | ID / title | Local source | Preview | Source-read composition and distinction |
|---|---|---|---|---|
| content | `tooltip-content-1` — Tooltip with Title and Description | [`tooltip-content-1.tsx`](../upstream/packages/patterns/tooltip/content/tooltip-content-1.tsx#L1-L28) | https://www.kibo-ui.com/patterns/tooltip/content/tooltip-content-1 | `Tooltip` → `TooltipTrigger asChild` → outline “Hover me” button; `TooltipContent max-w-xs` holds bold “Pro Feature” plus a `text-xs` description. |
| content | `tooltip-content-2` — Tooltip with Icon | [`tooltip-content-2.tsx`](../upstream/packages/patterns/tooltip/content/tooltip-content-2.tsx#L1-L27) | https://www.kibo-ui.com/patterns/tooltip/content/tooltip-content-2 | Outline “Status” trigger; content is a horizontal row with `CheckCircleIcon` and “All systems operational.” |
| content | `tooltip-content-3` — Tooltip with Keyboard Shortcut | [`tooltip-content-3.tsx`](../upstream/packages/patterns/tooltip/content/tooltip-content-3.tsx#L1-L27) | https://www.kibo-ui.com/patterns/tooltip/content/tooltip-content-3 | Outline “Save” trigger; content pairs text with `Kbd` displaying `⌘S`. `Kbd` is presentational markup/style; this source registers no shortcut handler. |
| content | `tooltip-content-4` — Tooltip with Image | [`tooltip-content-4.tsx`](../upstream/packages/patterns/tooltip/content/tooltip-content-4.tsx#L1-L36) | https://www.kibo-ui.com/patterns/tooltip/content/tooltip-content-4 | Outline “Preview” trigger; zero-padding/max-width content contains an image, title, and description in a padded column. The image is the external demo URL `https://placehold.co/514x300`, with `alt="Preview"` and specified rendered/intrinsic dimensions. |
| standard | `tooltip-standard-1` — Simple Tooltip | [`tooltip-standard-1.tsx`](../upstream/packages/patterns/tooltip/standard/tooltip-standard-1.tsx#L1-L23) | https://www.kibo-ui.com/patterns/tooltip/standard/tooltip-standard-1 | Minimal outline text trigger and one paragraph of content. |
| standard | `tooltip-standard-2` — Tooltip Positions | [`tooltip-standard-2.tsx`](../upstream/packages/patterns/tooltip/standard/tooltip-standard-2.tsx#L1-L49) | https://www.kibo-ui.com/patterns/tooltip/standard/tooltip-standard-2 | A `flex gap-4` row of four independent tooltip triplets. Each explicit `side` (`top`, `bottom`, `left`, `right`) matches its visible button/content label. |
| standard | `tooltip-standard-3` — Tooltip with Longer Text | [`tooltip-standard-3.tsx`](../upstream/packages/patterns/tooltip/standard/tooltip-standard-3.tsx#L1-L26) | https://www.kibo-ui.com/patterns/tooltip/standard/tooltip-standard-3 | Outline text trigger; `TooltipContent max-w-xs` wraps a multi-line paragraph. |
| standard | `tooltip-standard-4` — Tooltip on Icon | [`tooltip-standard-4.tsx`](../upstream/packages/patterns/tooltip/standard/tooltip-standard-4.tsx#L1-L25) | https://www.kibo-ui.com/patterns/tooltip/standard/tooltip-standard-4 | `asChild` wraps a custom rounded native button containing `InfoIcon`; simple text content. Unlike the toggle icon controls, this button has no visible text or `aria-label` in source. |

**Demo boundaries and adaptation.** The shown “Pro,” status, save, preview, and information text is fixed demo content; no source supplies application data, actions, loading/error state, permissions, or a `⌘S` listener. Replace the placeholder-image URL with an approved application asset/data source. Keep the `Tooltip`/`TooltipTrigger asChild`/`TooltipContent` nesting when adapting, because that is the actual composition used to bind the trigger and portal content; alter content, side, and width only as required by the product.

**Accessibility caveats from source.**

- Icon-only toggle demos include `aria-label`; retain an equivalent context-specific name. The icon-tooltip trigger does **not** have one, so add an accessible name before reuse. If it can appear inside a form, explicitly choose the intended native button `type`; the demo does not set one.
- The `Kbd` display does not make the keyboard command functional. Implement and test any advertised shortcut separately.
- Toggle and Button class strings include focus-visible styling, but no keyboard, screen-reader, pointer, placement, collision, or rendered accessibility validation was performed here. Tooltip interaction is delegated to `radix-ui`; source delegation is not browser validation.

## Architecture

The catalog inventories titles, source locations, and public preview routes only ([toggle catalog](../catalog/patterns/toggle.md); [tooltip catalog](../catalog/patterns/tooltip.md)). Each assigned file exports a title and a single static default `Example` component.

The imported UI aliases map conceptually to the mirrored shadcn-ui primitives examined above. In the upstream docs application, a root `TooltipProvider` also wraps children ([`apps/docs/app/layout.tsx`](../upstream/apps/docs/app/layout.tsx#L27-L35)); that is upstream-docs context, not an application integration requirement. The primitive itself additionally wraps each `Tooltip` in a provider.

## Start Here

Open [`packages/shadcn-ui/components/ui/tooltip.tsx`](../upstream/packages/shadcn-ui/components/ui/tooltip.tsx#L8-L61) first for tooltip adoption: it establishes provider delay, portal, arrow, offset, and content behavior shared by all eight examples. For toggle work, next open [`packages/shadcn-ui/components/ui/toggle.tsx`](../upstream/packages/shadcn-ui/components/ui/toggle.tsx#L9-L47) to see the only size/variant boundaries the demos exercise.

## Coverage and missing inputs

- **Covered:** all cataloged toggle collections (`sizes`: 3; `standard`: 4) and tooltip collections (`content`: 4; `standard`: 4), **15/15** sources.
- **Not supplied/validated:** browser preview rendering, runtime interaction, dependency installation compatibility, project-local primitive availability, product semantics, action/state contracts, and accessibility test results.
