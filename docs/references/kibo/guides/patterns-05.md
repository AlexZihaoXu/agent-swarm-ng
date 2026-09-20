# Patterns: chart, checkbox, collapsible

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and method

Read-only source inventory of the local Kibo snapshot pinned to upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (project HEAD supplied for this recording: `389caad059016ad1a9b9b61f58d3723aaf42fe90`). The snapshot foundation describes this as a static mirror, not a runnable dependency: [`snapshot.md`](../VERIFICATION.md). I read the three generated catalog indexes—[`docs/references/kibo/catalog/patterns/chart.md`](../catalog/patterns/chart.md), [`checkbox.md`](../catalog/patterns/checkbox.md), and [`collapsible.md`](../catalog/patterns/collapsible.md)—and every TSX file they enumerate below.

“Preview” links are catalog metadata, not browser validation. No preview was opened, no pattern was executed, and no accessibility/browser claim below is a validation result. “Demo” means literal local arrays/text/handlers in the cited pattern source, not application data or policy.

## Shared implementation facts

| Family | Required imports/primitives in the snapshot | What the local source actually provides | Adaptation boundary |
|---|---|---|---|
| Chart | Each pattern imports Recharts and `ChartContainer` plus `ChartConfig` from `@/components/ui/chart`; tooltipped/legend variants additionally import the named chart helpers. Some patterns also import Lucide icons. | [`packages/shadcn-ui/components/ui/chart.tsx` lines 11–102](../upstream/packages/shadcn-ui/components/ui/chart.tsx) defines the config and scopes `--color-*` variables in an injected style element; lines 37–69 wrap children in Recharts `ResponsiveContainer`. `ChartTooltipContent` and `ChartLegendContent` render presentation from Recharts payload/config (lines 105–309). | Bring a compatible chart wrapper, Recharts, the referenced CSS/theme tokens (`--chart-*`, foreground/background tokens), and real typed data. Preserve the wrapper/config relationship; replace static date/device/browser/activity data and hard-coded `en-US` formatting with application inputs/localization. |
| Checkbox | Patterns import `Checkbox` and `Label`; stateful examples import React `useState`; #5 uses `cn`; #6 uses a Lucide `Check`. | [`packages/shadcn-ui/components/ui/checkbox.tsx` lines 9–31](../upstream/packages/shadcn-ui/components/ui/checkbox.tsx) is a thin Radix `CheckboxPrimitive.Root` wrapper with a built-in `Indicator`/`CheckIcon`, focus-visible, invalid, checked, and disabled class styling. | Keep actual form state, IDs, labels, validation/submission and persistence in the application. Do not copy literal notification/todo/feature choices as product data. A compatible Radix checkbox is an external dependency of the mirrored primitive; its runtime behavior was not executed here. |
| Collapsible | Every variant imports `Collapsible`, `CollapsibleTrigger`, and `CollapsibleContent`; visual variants may import Lucide, `Badge`, and (standard #1) `Button`; only #5 imports `useState`. | [`packages/shadcn-ui/components/ui/collapsible.tsx` lines 5–31](../upstream/packages/shadcn-ui/components/ui/collapsible.tsx) only forwards props to Radix Root/Trigger/Content and adds `data-slot`; it supplies no animation, state policy, routing, or content fetching. | Retain Trigger/Content nesting and choose controlled state where surrounding app state needs it. Supply real FAQ/content, navigation actions, authorization/loading/error state, analytics, and an intentional icon state treatment. Radix is imported but not vendored/executed in this review. |

## Chart

All chart patterns use a bordered, padded `max-w-xl` demo shell and local `chartData`/`chartConfig`; all source paths in this section are under `docs/references/kibo/upstream/`. The Recharts composition and props named below are source observations, not a claim of rendered output. Many Cartesian patterns set Recharts `accessibilityLayer`; several polar/radial patterns do not. That source difference is not an accessibility audit.

### Collection: area (10)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `chart-area-axes` — An area chart with axes | `packages/patterns/chart/area/chart-area-axes.tsx` (lines 1–76); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-axes) | Two natural, `stackId="a"` areas (desktop/mobile), 0.4 fill opacity, X and Y axes, grid, and default tooltip. |
| `chart-area-default` — A simple area chart | `packages/patterns/chart/area/chart-area-default.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-default) | One natural desktop area; X/grid; line-indicator tooltip with cursor disabled. |
| `chart-area-gradient` — An area chart with gradient fill | `packages/patterns/chart/area/chart-area-gradient.tsx` (1–101); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-gradient) | Two stacked natural series use local SVG `fillDesktop`/`fillMobile` gradients. Those literal IDs would need instance-safe treatment if repeated in one document. |
| `chart-area-icons` — An area chart with icons | `packages/patterns/chart/area/chart-area-icons.tsx` (1–84); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-icons) | Two stacked natural series and legend; config assigns `TrendingDown`/`TrendingUp` icons, which the shared legend/tooltip source can render. |
| `chart-area-interactive` — An interactive area chart | `packages/patterns/chart/area/chart-area-interactive.tsx` (1–206); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-interactive) | 91 static daily device rows, fixed 250px chart, gradients, formatted date X/tooltip, and legend. Despite title, source has no hook, control, or event handler; it is not an application range/series selector. |
| `chart-area-legend` — An area chart with a legend | `packages/patterns/chart/area/chart-area-legend.tsx` (1–81); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-legend) | Two stacked natural areas plus `ChartLegendContent`; otherwise the simple month composition. |
| `chart-area-linear` — A linear area chart | `packages/patterns/chart/area/chart-area-linear.tsx` (1–64); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-linear) | One desktop area with `type="linear"`, dot indicator, and hidden tooltip label. |
| `chart-area-stacked-expand` — A stacked area chart with expand stacking | `packages/patterns/chart/area/chart-area-stacked-expand.tsx` (1–92); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-stacked-expand) | Three natural series on one stack with `stackOffset="expand"`; “other” uses 0.1 fill opacity. |
| `chart-area-stacked` — A stacked area chart | `packages/patterns/chart/area/chart-area-stacked.tsx` (1–78); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-stacked) | Standard two-series natural stack and dot tooltip indicator. |
| `chart-area-step` — A step area chart | `packages/patterns/chart/area/chart-area-step.tsx` (1–67); [preview](https://www.kibo-ui.com/patterns/chart/area/chart-area-step) | One `type="step"` desktop series; config carries an `Activity` icon but this pattern has no legend. |

### Collection: bar (10)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `chart-bar-active` — A bar chart with an active bar | `packages/patterns/chart/bar/chart-bar-active.tsx` (1–86); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-active) | Browser rows provide per-row `fill`; bar fixes `activeIndex={2}` and custom `Rectangle` active shape with dashed stroke. It does not manage a selected bar in React. |
| `chart-bar-default` — A bar chart | `packages/patterns/chart/bar/chart-bar-default.tsx` (1–52); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-default) | Single rounded desktop bar over abbreviated month X axis and grid. |
| `chart-bar-horizontal` — A horizontal bar chart | `packages/patterns/chart/bar/chart-bar-horizontal.tsx` (1–60); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-horizontal) | `layout="vertical"`, hidden numeric X, categorical month Y, and radius 5. |
| `chart-bar-interactive` — An interactive bar chart | `packages/patterns/chart/bar/chart-bar-interactive.tsx` (1–176); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-interactive) | 91 static daily rows and date formatting, but `activeChart` is literal `"desktop"`; no state/control changes it. Replace that constant with intentional selected-series behavior if needed. |
| `chart-bar-label-custom` — A bar chart with a custom label | `packages/patterns/chart/bar/chart-bar-label-custom.tsx` (1–96); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-label-custom) | Vertical hidden-axis desktop bars with two `LabelList`s: month inside-left and numeric desktop value right. |
| `chart-bar-label` — A bar chart with a label | `packages/patterns/chart/bar/chart-bar-label.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-label) | Single rounded bar with top numeric `LabelList` and added top margin. |
| `chart-bar-mixed` — A mixed bar chart | `packages/patterns/chart/bar/chart-bar-mixed.tsx` (1–80); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-mixed) | Vertical browser/visitor bars read per-row `fill` from data; source does not render multiple bar series despite “mixed” title. |
| `chart-bar-multiple` — A multiple bar chart | `packages/patterns/chart/bar/chart-bar-multiple.tsx` (1–57); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-multiple) | Grouped desktop and mobile rounded bars with dashed-indicator tooltip. |
| `chart-bar-negative` — A bar chart with negative values | `packages/patterns/chart/bar/chart-bar-negative.tsx` (1–52); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-negative) | No axes; negative visitor rows get chart-2 and positive get chart-1 through mapped `Cell`s, with month labels above bars. |
| `chart-bar-stacked` — A stacked bar chart with a legend | `packages/patterns/chart/bar/chart-bar-stacked.tsx` (1–67); [preview](https://www.kibo-ui.com/patterns/chart/bar/chart-bar-stacked) | Two `stackId="a"` bars use complementary corner radii plus default legend; tooltip cursor is not disabled in this file. |

### Collection: line (10)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `chart-line-default` — A line chart | `packages/patterns/chart/line/chart-line-default.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-default) | One natural desktop line, width 2, `dot={false}`, abbreviated month X. |
| `chart-line-dots-colors` — A line chart with dots and colors | `packages/patterns/chart/line/chart-line-dots-colors.tsx` (1–93); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-dots-colors) | Browser visitor line has a custom Recharts `Dot` per row using that row’s `fill`; no X axis is declared. |
| `chart-line-dots-custom` — A line chart with custom dots | `packages/patterns/chart/line/chart-line-dots-custom.tsx` (1–83); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-dots-custom) | Desktop line’s `dot` renderer places 24px `GitCommitVertical` icons at points; data still includes unused mobile values. |
| `chart-line-dots` — A line chart with dots | `packages/patterns/chart/line/chart-line-dots.tsx` (1–74); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-dots) | Desktop natural line has filled dots and active dot radius 6. |
| `chart-line-interactive` — An interactive line chart | `packages/patterns/chart/line/chart-line-interactive.tsx` (1–182); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-interactive) | Same fixed `activeChart = "desktop"` pattern as bar interactive, with 91 local daily rows, formatted tooltip date, monotone dotless line, and no selector/handler. |
| `chart-line-label-custom` — A line chart with a custom label | `packages/patterns/chart/line/chart-line-label-custom.tsx` (1–100); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-label-custom) | Browser visitor line uses a `LabelList` that maps browser keys through config labels; includes active dots. |
| `chart-line-label` — A line chart with a label | `packages/patterns/chart/line/chart-line-label.tsx` (1–82); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-label) | Desktop natural line with active/filled dots and top numeric labels. |
| `chart-line-linear` — A linear line chart | `packages/patterns/chart/line/chart-line-linear.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-linear) | Default single-line composition, changing curve to `linear`. |
| `chart-line-multiple` — A multiple line chart | `packages/patterns/chart/line/chart-line-multiple.tsx` (1–73); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-multiple) | Two dotless monotone desktop/mobile lines and regular tooltip. |
| `chart-line-step` — A line chart with step | `packages/patterns/chart/line/chart-line-step.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/line/chart-line-step) | Default single-line composition, changing curve to `step`. |

### Collection: pie (11)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `chart-pie-donut-active` — A donut chart with an active sector | `packages/patterns/chart/pie/chart-pie-donut-active.tsx` (1–76); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-donut-active) | Browser donut (`innerRadius=60`) fixes sector 0 active and expands it by 10px through `Sector`; no active-index state. |
| `chart-pie-donut-text` — A donut chart with text | `packages/patterns/chart/pie/chart-pie-donut-text.tsx` (1–101); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-donut-text) | Donut, stroke width 5, and custom center SVG label summing local visitor rows. |
| `chart-pie-donut` — A donut chart | `packages/patterns/chart/pie/chart-pie-donut.tsx` (1–70); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-donut) | Basic browser donut with `innerRadius=60` and hidden-label tooltip. |
| `chart-pie-interactive` — An interactive pie chart | `packages/patterns/chart/pie/chart-pie-interactive.tsx` (1–125); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-interactive) | `id` and `activeIndex` are constants; double-ring active shape and center text always use first local month. Source has no event/state selection. |
| `chart-pie-label-custom` — A pie chart with a custom label | `packages/patterns/chart/pie/chart-pie-label-custom.tsx` (1–82); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-label-custom) | Custom `label` renderer prints each numeric visitor value outside/at Recharts-provided positions with no label line. |
| `chart-pie-label-list` — A pie chart with a label list | `packages/patterns/chart/pie/chart-pie-label-list.tsx` (1–74); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-label-list) | `LabelList` renders config-mapped browser labels; container targets Recharts text fill to background. |
| `chart-pie-label` — A pie chart with a label | `packages/patterns/chart/pie/chart-pie-label.tsx` (1–62); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-label) | Uses Pie’s boolean `label` with browser `nameKey`; container sets pie-label text foreground. |
| `chart-pie-legend` — A pie chart with a legend | `packages/patterns/chart/pie/chart-pie-legend.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-legend) | Simple pie has no tooltip; custom legend uses `nameKey="browser"` and wrapped quarter-width entries. |
| `chart-pie-separator-none` — A pie chart with no separator | `packages/patterns/chart/pie/chart-pie-separator-none.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-separator-none) | Simple browser pie explicitly sets `stroke="0"`. |
| `chart-pie-simple` — A simple pie chart | `packages/patterns/chart/pie/chart-pie-simple.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-simple) | Bare browser pie plus hidden-label tooltip. |
| `chart-pie-stacked` — A pie chart with stacked sections | `packages/patterns/chart/pie/chart-pie-stacked.tsx` (1–94); [preview](https://www.kibo-ui.com/patterns/chart/pie/chart-pie-stacked) | Two concentric month datasets: desktop radius 60 and mobile 70–90; tooltip maps label to data key and item names to month. |

### Collection: radar (14)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `chart-radar-default` — A radar chart | `packages/patterns/chart/radar/chart-radar-default.tsx` (1–50); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-default) | One desktop filled (0.6) radar with month angle axis and default polar grid. |
| `chart-radar-dots` — A radar chart with dots | `packages/patterns/chart/radar/chart-radar-dots.tsx` (1–54); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-dots) | Default composition plus opaque radius-4 dots. |
| `chart-radar-grid-circle-fill` — A radar chart with a grid and circle fill | `packages/patterns/chart/radar/chart-radar-grid-circle-fill.tsx` (1–53); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-grid-circle-fill) | Circular polar grid filled with desktop color at 0.2 opacity; radar fill 0.5. |
| `chart-radar-grid-circle-no-lines` — A radar chart with a grid and circle fill (no lines) | `packages/patterns/chart/radar/chart-radar-grid-circle-no-lines.tsx` (1–57); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-grid-circle-no-lines) | Circular grid sets `radialLines={false}`; radar has dots and 0.6 fill. |
| `chart-radar-grid-circle` — A radar chart with a grid and circle | `packages/patterns/chart/radar/chart-radar-grid-circle.tsx` (1–57); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-grid-circle) | Circular grid, visible radial lines, and dotted/filled single radar. |
| `chart-radar-grid-custom` — A radar chart with a custom grid | `packages/patterns/chart/radar/chart-radar-grid-custom.tsx` (1–53); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-grid-custom) | `PolarGrid` has only `polarRadius={[90]}`, no radial lines, stroke width 1. |
| `chart-radar-grid-fill` — A radar chart with a grid filled | `packages/patterns/chart/radar/chart-radar-grid-fill.tsx` (1–53); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-grid-fill) | Default-shaped polar grid has 0.2 desktop-colored fill; single radar fill is 0.5. |
| `chart-radar-grid-none` — A radar chart with no grid | `packages/patterns/chart/radar/chart-radar-grid-none.tsx` (1–56); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-grid-none) | Omits `PolarGrid`; keeps month axis and dotted filled radar. |
| `chart-radar-icons` — A radar chart with icons | `packages/patterns/chart/radar/chart-radar-icons.tsx` (1–70); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-icons) | Two series, legend, and `ArrowDownFromLine`/`ArrowUpFromLine` config icons; tight negative top/bottom chart margins. |
| `chart-radar-label-custom` — A radar chart with a custom label | `packages/patterns/chart/radar/chart-radar-label-custom.tsx` (1–95); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-label-custom) | Custom angle tick renders desktop/mobile values, slash, and month as multi-line SVG text; two series. |
| `chart-radar-legend` — A radar chart with a legend | `packages/patterns/chart/radar/chart-radar-legend.tsx` (1–67); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-legend) | Same two-series/range/margin shape as icons but ordinary config and legend markers. |
| `chart-radar-lines-only` — A radar chart with lines only | `packages/patterns/chart/radar/chart-radar-lines-only.tsx` (1–66); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-lines-only) | Two radars set `fillOpacity={0}`, colored strokes width 2; grid radial lines are disabled. |
| `chart-radar-multiple` — A radar chart with multiple data | `packages/patterns/chart/radar/chart-radar-multiple.tsx` (1–58); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-multiple) | Two series over regular polar grid; desktop has 0.6 fill, mobile uses default fill opacity. |
| `chart-radar-radius` — A radar chart with a radius axis | `packages/patterns/chart/radar/chart-radar-radius.tsx` (1–63); [preview](https://www.kibo-ui.com/patterns/chart/radar/chart-radar-radius) | Omits angle axis and adds middle `PolarRadiusAxis` at 60°; tooltip labels through `labelKey="month"`. |

### Collection: radial (6)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `chart-radial-grid` — A radial chart with a grid | `packages/patterns/chart/radial/chart-radial-grid.tsx` (1–66); [preview](https://www.kibo-ui.com/patterns/chart/radial/chart-radial-grid) | Browser visitor radial bars, circular `PolarGrid`, inner/outer radii 30/100, no bar background. |
| `chart-radial-label` — A radial chart with a label | `packages/patterns/chart/radial/chart-radial-label.tsx` (1–78); [preview](https://www.kibo-ui.com/patterns/chart/radial/chart-radial-label) | Background radial bars, -90° to 380° sweep, and inside-start browser `LabelList` with white luminosity blend. |
| `chart-radial-shape` — A radial chart with a custom shape | `packages/patterns/chart/radial/chart-radial-shape.tsx` (1–85); [preview](https://www.kibo-ui.com/patterns/chart/radial/chart-radial-shape) | Single Safari 1260 demo value, 100° gauge, concentric custom polar grid, and custom central numeric/Visitors SVG label; no tooltip. |
| `chart-radial-simple` — A radial chart | `packages/patterns/chart/radial/chart-radial-simple.tsx` (1–65); [preview](https://www.kibo-ui.com/patterns/chart/radial/chart-radial-simple) | Browser radial bars with background and 30/110 radii, plus hidden-label browser tooltip. |
| `chart-radial-stacked` — A radial chart with stacked sections | `packages/patterns/chart/radial/chart-radial-stacked.tsx` (1–88); [preview](https://www.kibo-ui.com/patterns/chart/radial/chart-radial-stacked) | Single month’s desktop/mobile bars stack in a half gauge (end 180°); center label sums the two literals. |
| `chart-radial-text` — A radial chart with text | `packages/patterns/chart/radial/chart-radial-text.tsx` (1–86); [preview](https://www.kibo-ui.com/patterns/chart/radial/chart-radial-text) | Single Safari 200 value, 0°–250° background gauge, custom rings and central text; no tooltip. |

### Collection: tooltip (9)

All nine use the same static six-day running/swimming stacked-bar fixture, date-to-weekday X formatter, and `defaultIndex={1}`. This is configuration in source, not proof of initial visual behavior.

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `chart-tooltip-advanced` — Tooltip - Advanced | `packages/patterns/chart/tooltip/chart-tooltip-advanced.tsx` (1–107); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-advanced) | Custom formatter emits color square, `kcal`, and after second payload item a calculated running+swimming total. |
| `chart-tooltip-default` — Tooltip - Default | `packages/patterns/chart/tooltip/chart-tooltip-default.tsx` (1–74); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-default) | Shared default tooltip; additionally exports preview-only `iframeHeight` and `containerClassName`. |
| `chart-tooltip-formatter` — Tooltip - Formatter | `packages/patterns/chart/tooltip/chart-tooltip-formatter.tsx` (1–86); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-formatter) | `formatter` makes a fixed-min-width row with mapped label and value suffixed `kcal`; label hidden. |
| `chart-tooltip-icons` — Tooltip - Icons | `packages/patterns/chart/tooltip/chart-tooltip-icons.tsx` (1–74); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-icons) | Config supplies Footprints/Waves icons, so shared tooltip chooses icons over indicator blocks; label hidden. |
| `chart-tooltip-indicator-line` — Tooltip - Line Indicator | `packages/patterns/chart/tooltip/chart-tooltip-indicator-line.tsx` (1–74); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-indicator-line) | Requests `indicator="line"`; exports the same preview-only iframe/container metadata as default. |
| `chart-tooltip-indicator-none` — Tooltip - No Indicator | `packages/patterns/chart/tooltip/chart-tooltip-indicator-none.tsx` (1–71); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-indicator-none) | Requests `hideIndicator`; otherwise shared default label/payload content. |
| `chart-tooltip-label-custom` — Tooltip - Custom Label | `packages/patterns/chart/tooltip/chart-tooltip-label-custom.tsx` (1–76); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-label-custom) | Config adds `activities`; tooltip passes `labelKey="activities"` and line indicator. |
| `chart-tooltip-label-formatter` — Tooltip - Label Formatter | `packages/patterns/chart/tooltip/chart-tooltip-label-formatter.tsx` (1–81); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-label-formatter) | Formats source date as long month/day/year in tooltip label. |
| `chart-tooltip-label-none` — Tooltip - No Label | `packages/patterns/chart/tooltip/chart-tooltip-label-none.tsx` (1–71); [preview](https://www.kibo-ui.com/patterns/chart/tooltip/chart-tooltip-label-none) | Requests both `hideIndicator` and `hideLabel`. |

**Chart-specific gaps/caveats.** None of the files fetches data, exposes loading/error/empty states, provides a user series/range control, or persists selection. The three “interactive” sources are fixed as noted above; fixed active pie/bar indices are demo composition, not managed application interactions. Data labels/tooltips are visual payload renderers, not a textual data-table alternative. The shared wrapper calls `dangerouslySetInnerHTML` only to generate its own CSS-variable rules (chart primitive lines 72–102); it should not be broadened to insert application-controlled markup.

## Checkbox

### Collection: standard (12)

| ID / title | Local source / preview | Distinguishing source composition and demo behavior |
|---|---|---|
| `checkbox-standard-1` — Simple Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-1.tsx` (1–13); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-1) | Uncontrolled checkbox and associated `Label` via literal `terms` ID. |
| `checkbox-standard-11` — With Description | `packages/patterns/checkbox/standard/checkbox-standard-11.tsx` (1–18); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-11) | Top-aligned checkbox, marketing-emails label, and explanatory paragraph. |
| `checkbox-standard-12` — With Subtitle and Description | `packages/patterns/checkbox/standard/checkbox-standard-12.tsx` (1–22); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-12) | Top-aligned checkbox with label, literal “Recommended” subtitle, and security-alert description. |
| `checkbox-standard-13` — Nested List | `packages/patterns/checkbox/standard/checkbox-standard-13.tsx` (1–64); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-13) | Client state for parent and three named child features. Parent changes all children; child changes do **not** recompute parent checked/indeterminate state. This is a one-way demo selection rule, not a complete tree-state model. |
| `checkbox-standard-2` — Indeterminate Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-2.tsx` (1–26); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-2) | Controlled state starts as literal `"indeterminate"` and forwards `onCheckedChange` directly. |
| `checkbox-standard-3` — With Subtitle | `packages/patterns/checkbox/standard/checkbox-standard-3.tsx` (1–16); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-3) | Uncontrolled checkbox with inline label and literal “Recommended” text. |
| `checkbox-standard-4` — Disabled Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-4.tsx` (1–23); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-4) | Two literal disabled examples: one uncontrolled/unchecked and one `checked`; labels are muted. |
| `checkbox-standard-5` — Todo Style Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-5.tsx` (1–33); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-5) | Controlled boolean demo applies muted strike-through label when checked; handler casts callback value to boolean. Replace literal documentation task and connect persistence. |
| `checkbox-standard-6` — Custom Indicator Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-6.tsx` (1–19); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-6) | Adds a child Lucide `Check` and green checked root classes. The shared primitive also always renders its own `CheckboxPrimitive.Indicator` (checkbox primitive lines 23–28), so source does not replace the built-in indicator; review the resulting child/icon treatment before adopting. |
| `checkbox-standard-7` — Horizontal List Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-7.tsx` (1–25); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-7) | Maps five local weekday `{id,label}` rows into wrapping horizontal label/control pairs. |
| `checkbox-standard-8` — Vertical List Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-8.tsx` (1–25); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-8) | Maps five local programming-language rows into vertically spaced pairs. |
| `checkbox-standard-9` — Right-Aligned Checkbox | `packages/patterns/checkbox/standard/checkbox-standard-9.tsx` (1–23); [preview](https://www.kibo-ui.com/patterns/checkbox/standard/checkbox-standard-9) | Maps three literal notification options with label left and checkbox right using `justify-between`. |

**Checkbox-specific gaps/caveats.** The explicit `htmlFor`/`id` pairs are a source-positive association, and the primitive source includes focus-visible/disabled/invalid class hooks; neither fact validates keyboard, screen-reader, contrast, or form behavior in a browser. Ensure IDs are unique per rendered instance, use fieldset/group semantics where the application needs group context, and provide real validation/error text. Examples #1, #3–4, #6–9 are uncontrolled; #2, #5, #13 are only local client-state demos.

## Collapsible

With the exception of controlled standard #5, no variant explicitly passes `open`, `onOpenChange`, or `defaultOpen`; their state policy is delegated to the external Radix primitive. Most decorative chevrons/pluses only have static or generic transition classes—no cited pattern source binds their transform/text to `data-state`, so do not assume they communicate open state visually.

### Collection: card (5)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `collapsible-card-1` — Card Collapsible | `packages/patterns/collapsible/card/collapsible-card-1.tsx` (1–26); [preview](https://www.kibo-ui.com/patterns/collapsible/card/collapsible-card-1) | Shadowed card with full-width Features trigger, static ChevronDown, and border-top bullet-list demo content. |
| `collapsible-card-2` — Card with Icon Header | `packages/patterns/collapsible/card/collapsible-card-2.tsx` (1–27); [preview](https://www.kibo-ui.com/patterns/collapsible/card/collapsible-card-2) | Trigger contains a primary-tinted Plus icon box plus title/subtitle; content is one literal paragraph. |
| `collapsible-card-3` — Nested Card Content | `packages/patterns/collapsible/card/collapsible-card-3.tsx` (1–33); [preview](https://www.kibo-ui.com/patterns/collapsible/card/collapsible-card-3) | Hover-tinted Product Details trigger opens a border-top, divide-y three-row dimensions/weight/material detail list. |
| `collapsible-card-4` — Card with Badge | `packages/patterns/collapsible/card/collapsible-card-4.tsx` (1–27); [preview](https://www.kibo-ui.com/patterns/collapsible/card/collapsible-card-4) | Card trigger combines Premium Features, secondary “New” badge, static chevron; source content is marketing text. |
| `collapsible-card-5` — Subtle Card Collapsible | `packages/patterns/collapsible/card/collapsible-card-5.tsx` (1–24); [preview](https://www.kibo-ui.com/patterns/collapsible/card/collapsible-card-5) | Dashed muted card, text-only trigger, and literal `pre > code` hello-world snippet. |

### Collection: faq (5)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `collapsible-faq-1` — FAQ Item | `packages/patterns/collapsible/faq/collapsible-faq-1.tsx` (1–26); [preview](https://www.kibo-ui.com/patterns/collapsible/faq/collapsible-faq-1) | Border-bottom question row with static Plus, then onboarding-answer paragraph. |
| `collapsible-faq-2` — FAQ with Icon | `packages/patterns/collapsible/faq/collapsible-faq-2.tsx` (1–25); [preview](https://www.kibo-ui.com/patterns/collapsible/faq/collapsible-faq-2) | Padded hover-border card; HelpCircle aligned with payment question, answer indented `ml-8`. |
| `collapsible-faq-3` — FAQ Card Style | `packages/patterns/collapsible/faq/collapsible-faq-3.tsx` (1–23); [preview](https://www.kibo-ui.com/patterns/collapsible/faq/collapsible-faq-3) | Shadowed card with hover-muted trigger, static transition chevron, border-top free-trial answer. |
| `collapsible-faq-4` — Numbered FAQ | `packages/patterns/collapsible/faq/collapsible-faq-4.tsx` (1–26); [preview](https://www.kibo-ui.com/patterns/collapsible/faq/collapsible-faq-4) | Border-bottom question prefixed by a literal circular “1”; answer indented `ml-10`. |
| `collapsible-faq-5` — FAQ with Badge | `packages/patterns/collapsible/faq/collapsible-faq-5.tsx` (1–30); [preview](https://www.kibo-ui.com/patterns/collapsible/faq/collapsible-faq-5) | Text layout with static transition ChevronRight, outline “Popular” badge, and `ml-7` enterprise-plan answer. |

### Collection: outline (4)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `collapsible-outline-1` — Outlined Collapsible | `packages/patterns/collapsible/outline/collapsible-outline-1.tsx` (1–32); [preview](https://www.kibo-ui.com/patterns/collapsible/outline/collapsible-outline-1) | Two-pixel outlined System Information panel; static chevron and three literal status rows behind a 2px top border. |
| `collapsible-outline-2` — Warning Outline | `packages/patterns/collapsible/outline/collapsible-outline-2.tsx` (1–30); [preview](https://www.kibo-ui.com/patterns/collapsible/outline/collapsible-outline-2) | Yellow light/dark bordered alert with AlertTriangle, title/subtitle, and warning paragraph. Colors are literal Tailwind palette classes, not semantic application status mapping. |
| `collapsible-outline-3` — Info Box Outline | `packages/patterns/collapsible/outline/collapsible-outline-3.tsx` (1–25); [preview](https://www.kibo-ui.com/patterns/collapsible/outline/collapsible-outline-3) | Blue light/dark outlined Info panel with Info icon and literal notice text. |
| `collapsible-outline-4` — Dashed Outline | `packages/patterns/collapsible/outline/collapsible-outline-4.tsx` (1–30); [preview](https://www.kibo-ui.com/patterns/collapsible/outline/collapsible-outline-4) | Dashed outlined optional-configuration panel with static `[expand]` text and two demo option/value rows. |

### Collection: sidebar (4)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `collapsible-sidebar-1` — Nested Sidebar Items | `packages/patterns/collapsible/sidebar/collapsible-sidebar-1.tsx` (1–39); [preview](https://www.kibo-ui.com/patterns/collapsible/sidebar/collapsible-sidebar-1) | Two nested collapsibles (Documentation → Components), left border indentation, static ChevronRight icons, and Button/Input leaf **divs** with decorative circles. Add actual navigation semantics/actions. |
| `collapsible-sidebar-2` — Settings Menu | `packages/patterns/collapsible/sidebar/collapsible-sidebar-2.tsx` (1–40); [preview](https://www.kibo-ui.com/patterns/collapsible/sidebar/collapsible-sidebar-2) | Card-wrapped Preferences trigger with settings/chevron icons opens tinted list of Profile/Notifications/Privacy **divs** with icons; no routes/clicks. |
| `collapsible-sidebar-3` — Sidebar with Counts | `packages/patterns/collapsible/sidebar/collapsible-sidebar-3.tsx` (1–35); [preview](https://www.kibo-ui.com/patterns/collapsible/sidebar/collapsible-sidebar-3) | Inbox trigger shows secondary `12` badge; indented border-left child divs show outline 8/4 badges. Counts are literals. |
| `collapsible-sidebar-4` — Minimal Sidebar Group | `packages/patterns/collapsible/sidebar/collapsible-sidebar-4.tsx` (1–32); [preview](https://www.kibo-ui.com/patterns/collapsible/sidebar/collapsible-sidebar-4) | Uppercase muted Getting Started header with static ChevronDown opens three hoverable text **divs**, not links. |

### Collection: standard (5)

| ID / title | Local source / preview | Distinguishing source composition |
|---|---|---|
| `collapsible-standard-1` — Simple Collapsible | `packages/patterns/collapsible/standard/collapsible-standard-1.tsx` (1–26); [preview](https://www.kibo-ui.com/patterns/collapsible/standard/collapsible-standard-1) | Uses `CollapsibleTrigger asChild` around a ghost `Button` containing Toggle and ChevronDown; content is one paragraph. This is the only assigned variant importing Button. |
| `collapsible-standard-2` — Inline Trigger Collapsible | `packages/patterns/collapsible/standard/collapsible-standard-2.tsx` (1–23); [preview](https://www.kibo-ui.com/patterns/collapsible/standard/collapsible-standard-2) | Full-width question/`ChevronsUpDown` row and a brief answer, with no card boundary. |
| `collapsible-standard-3` — Collapsible with Icon | `packages/patterns/collapsible/standard/collapsible-standard-3.tsx` (1–28); [preview](https://www.kibo-ui.com/patterns/collapsible/standard/collapsible-standard-3) | Underline-on-hover trigger combines Plus and “Show more”; content is two literal paragraphs. |
| `collapsible-standard-4` — Text-only Collapsible | `packages/patterns/collapsible/standard/collapsible-standard-4.tsx` (1–25); [preview](https://www.kibo-ui.com/patterns/collapsible/standard/collapsible-standard-4) | Static Settings heading sits next to text `[expand]` trigger; content contains three bordered option divs. |
| `collapsible-standard-5` — Controlled Collapsible | `packages/patterns/collapsible/standard/collapsible-standard-5.tsx` (1–35); [preview](https://www.kibo-ui.com/patterns/collapsible/standard/collapsible-standard-5) | The sole controlled example: `useState(false)`, `open={isOpen}`, `onOpenChange={setIsOpen}`, and a literal Open/Closed status. Lift/replace state if URL, parent, or persistence should control it. |

**Collapsible-specific gaps/caveats.** The source uses literal product FAQs, plans, status values, source snippet, counts, and options; replace them rather than representing them as live product state. Sidebar leaves are noninteractive divs, so source does not supply navigation or active/current-page semantics. The forwarded primitive source has no application animation, disclosure icon-state styling, group coordination, or error/loading behavior. Trigger control comes from the external Radix component; its actual keyboard/ARIA behavior was not browser- or dependency-validated here.

## Coverage and missing inputs

- **Covered:** all catalog entries in the assigned directories: chart **70** (area 10, bar 10, line 10, pie 11, radar 14, radial 6, tooltip 9), checkbox **12** (standard 12), collapsible **23** (card 5, faq 5, outline 4, sidebar 4, standard 5): **105 patterns / 13 collections**. Catalog source/preview inventory is in the three cited catalog files; each entry above gives its exact local TSX path and preview URL.
- **Also read:** chart, checkbox, and collapsible primitive sources cited in Shared implementation facts; these establish wrapper boundaries but do not replace the external Recharts/Radix source or runtime tests.
- **Missing/uncertain by design:** no application requirements/data schema, design-token availability, installed dependency versions, target runtime, browser output, keyboard/screen-reader behavior, color contrast, responsive layout, or website-preview availability was supplied/validated. No claim of production readiness follows from this source-only review.
