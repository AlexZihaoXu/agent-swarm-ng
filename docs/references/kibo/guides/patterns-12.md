# Patterns: menubar, navigation-menu, pagination

> Curated source-reading notes, not project instructions or an API contract. [Entry guide](../README.md) · [Guide index](README.md). Application observations refer to project HEAD `389caad059016ad1a9b9b61f58d3723aaf42fe90`; recheck before future adaptation. Line references are reading hints; exact linked source is authoritative.


## Scope and revision

Read-only source analysis of the local passive Kibo snapshot at upstream commit `3d63cdb15b79d972e3dc38a10997987672f9b263` (project HEAD supplied: `389caad059016ad1a9b9b61f58d3723aaf42fe90`). The snapshot identifies itself as non-runnable reference data; catalog preview URLs are navigational only, not browser validation ([`docs/references/kibo/README.md`](../README.md):1-38; [`metadata/manifest.json`](../metadata/manifest.json):1-6).

All 49 TSX files under the assigned families were read. Source paths below are rooted at `docs/references/kibo/upstream/packages/patterns/`; preview URLs are `https://www.kibo-ui.com/patterns/` plus the listed preview path.

## Shared implementation facts

| Family | Required primitive/import basis | Source-backed behavior and adaptation boundary |
| --- | --- | --- |
| Menubar | Pattern imports resolve to `@/components/ui/menubar`; the mirrored primitive wraps `radix-ui` Menubar and uses Lucide check/circle/chevron icons. | Preserve the `Menubar > MenubarMenu > Trigger + Content` nesting and use the primitive in a client-capable React environment. Content is portaled and defaults to `align="start"`, `alignOffset={-4}`, and `sideOffset={8}`; item, checkbox, radio, submenu, separator, and shortcut wrappers are available ([`menubar.tsx`](../upstream/packages/shadcn-ui/components/ui/menubar.tsx):1-276). |
| Navigation menu | Every pattern imports `@/components/ui/navigation-menu`; primitive wraps `radix-ui` NavigationMenu and uses `class-variance-authority` plus Lucide’s trigger chevron. Some variants also import Button, Badge, Avatar, or Tabs. | Keep `NavigationMenu > List > Item > Trigger/Content or Link`. The wrapper renders a viewport by default; `viewport={false}` changes content styling/positioning. Trigger chevron is `aria-hidden`; link styling honors primitive `active` state ([`navigation-menu.tsx`](../upstream/packages/shadcn-ui/components/ui/navigation-menu.tsx):1-168). |
| Pagination | Every pattern imports `@/components/ui/pagination`; its primitive is React markup plus Lucide icons and shadcn Button variants. | Preserve `Pagination(nav) > PaginationContent(ul) > PaginationItem(li)`. `PaginationLink` is an anchor and maps `isActive` to `aria-current="page"`; previous/next get explicit labels; ellipsis is `aria-hidden` ([`pagination.tsx`](../upstream/packages/shadcn-ui/components/ui/pagination.tsx):1-127). |

The upstream patterns use the `@/components/ui/*` alias while primitives import `@repo/shadcn-ui/*`; an application adaptation must supply equivalent components and path aliases rather than copying an unresolved alias.

## Menubar

All variants are in collection **standard** and are static JSX examples: no item callback, routing, command dispatch, authorization, or persisted state is supplied.

| ID / title | Local source | Preview path | Distinguishing composition |
| --- | --- | --- | --- |
| `menubar-standard-1` — Simple Text Menubar | [`menubar/standard/menubar-standard-1.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-1.tsx):1-24 | `menubar/standard/menubar-standard-1` | One File trigger with three text items. |
| `menubar-standard-2` — Menubar with Shortcuts | [`menubar/standard/menubar-standard-2.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-2.tsx):1-34 | `menubar/standard/menubar-standard-2` | Edit items append visual `MenubarShortcut` strings (`⌘Z`, etc.); no keyboard handler is registered. |
| `menubar-standard-3` — Menubar with Icons | [`menubar/standard/menubar-standard-3.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-3.tsx):1-34 | `menubar/standard/menubar-standard-3` | File/Folder/Save Lucide icons precede File actions; requires `lucide-react`. |
| `menubar-standard-4` — Menubar with Checkboxes | [`menubar/standard/menubar-standard-4.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-4.tsx):1-24 | `menubar/standard/menubar-standard-4` | View menu uses three checkbox items; two receive constant `checked`, with no `onCheckedChange`. |
| `menubar-standard-5` — Menubar with Radio Groups | [`menubar/standard/menubar-standard-5.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-5.tsx):1-29 | `menubar/standard/menubar-standard-5` | Label plus a radio group fixed to `value="grid"`; no change handler. |
| `menubar-standard-6` — Menubar with Submenu | [`menubar/standard/menubar-standard-6.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-6.tsx):1-34 | `menubar/standard/menubar-standard-6` | File menu nests `MenubarSub`, trigger, and sub-content for static recent-document labels. |
| `menubar-standard-7` — Menubar with Destructive Action | [`menubar/standard/menubar-standard-7.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-7.tsx):1-27 | `menubar/standard/menubar-standard-7` | Edit actions are split by a separator; Delete passes `variant="destructive"`. |
| `menubar-standard-8` — Application Menubar | [`menubar/standard/menubar-standard-8.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-8.tsx):1-63 | `menubar/standard/menubar-standard-8` | Three top-level File/Edit/View menus, separators, and shortcut labels; closest composition to an application command bar. |
| `menubar-standard-9` — Menubar with Sections | [`menubar/standard/menubar-standard-9.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-9.tsx):1-31 | `menubar/standard/menubar-standard-9` | One Edit menu with `MenubarLabel` headings (“Actions”, “History”) separated by a rule. |
| `menubar-standard-10` — Compact Menubar | [`menubar/standard/menubar-standard-10.tsx`](../upstream/packages/patterns/menubar/standard/menubar-standard-10.tsx):1-26 | `menubar/standard/menubar-standard-10` | One Options trigger with two settings items, separator, and Sign Out. |

**Menubar adaptation notes.** The static checkbox and radio props are demo state, not production preference management. Shortcut text is only a `span` wrapper in the primitive, so application keyboard bindings and conflict handling remain required ([`menubar.tsx`](../upstream/packages/shadcn-ui/components/ui/menubar.tsx):192-205). Replace labels/actions with authorized application commands; do not infer that actions such as Sign Out, Delete, or fullscreen exist.

## Navigation menu

Every source begins with `"use client"` and wraps its menu in an intentionally oversized preview canvas (`pr-[50vw] pb-[50vh]`) and a small bordered container. Those wrappers are demo presentation, not required application layout. Unless noted below, links are static `href="#"`; all menu data is local sample content.

### Complex collection

| ID / title | Local source | Preview path | Distinguishing composition and dependencies |
| --- | --- | --- | --- |
| `navigation-menu-complex-1` — Full Mega Menu | [`navigation-menu/complex/navigation-menu-complex-1.tsx`](../upstream/packages/patterns/navigation-menu/complex/navigation-menu-complex-1.tsx):1-238 | `navigation-menu/complex/navigation-menu-complex-1` | 900px three-column mega panel: core/advanced feature lists, resource/company links, and two sidebar CTA cards. Requires Lucide and Button; video-shaped sidebar region is an empty styled `div`. |
| `navigation-menu-complex-2` — Multi-level Nested Navigation | [`navigation-menu/complex/navigation-menu-complex-2.tsx`](../upstream/packages/patterns/navigation-menu/complex/navigation-menu-complex-2.tsx):1-100 | `navigation-menu/complex/navigation-menu-complex-2` | 600px two-column category panel; subcategory links display a ChevronRight and their child links permanently beneath them. This is visual nesting, not separately operable nested menus. Requires Lucide ChevronRight. |
| `navigation-menu-complex-3` — Tabbed Mega Menu | [`navigation-menu/complex/navigation-menu-complex-3.tsx`](../upstream/packages/patterns/navigation-menu/complex/navigation-menu-complex-3.tsx):1-151 | `navigation-menu/complex/navigation-menu-complex-3` | 700px menu contains controlled Tabs. This is the only assigned navigation example with local React state: `activeTab` starts as `web` and changes through `Tabs onValueChange`. Requires Tabs, React `useState`, Lucide, and navigation primitive. |
| `navigation-menu-complex-4` — Dashboard-style with Stats | [`navigation-menu/complex/navigation-menu-complex-4.tsx`](../upstream/packages/patterns/navigation-menu/complex/navigation-menu-complex-4.tsx):1-187 | `navigation-menu/complex/navigation-menu-complex-4` | 700px panel with four sample stat cards/trend badges above report and custom-report link columns. Requires Badge and Lucide; values/trends are hard-coded sample data. |
| `navigation-menu-complex-5` — Mixed Content Types | [`navigation-menu/complex/navigation-menu-complex-5.tsx`](../upstream/packages/patterns/navigation-menu/complex/navigation-menu-complex-5.tsx):1-168 | `navigation-menu/complex/navigation-menu-complex-5` | 800px two-column layout: badge-bearing solution tiles plus webinar and getting-started CTA cards. Requires Badge, Button, and Lucide; “video” is a decorative gradient `div`. |

### Features collection

| ID / title | Local source | Preview path | Distinguishing composition and dependencies |
| --- | --- | --- | --- |
| `navigation-menu-features-1` — Feature Cards with Icons | [`navigation-menu/features/navigation-menu-features-1.tsx`](../upstream/packages/patterns/navigation-menu/features/navigation-menu-features-1.tsx):1-92 | `navigation-menu/features/navigation-menu-features-1` | Six icon/description links in a 600px two-column grid; requires Lucide. |
| `navigation-menu-features-2` — Feature Grid Layout | [`navigation-menu/features/navigation-menu-features-2.tsx`](../upstream/packages/patterns/navigation-menu/features/navigation-menu-features-2.tsx):1-118 | `navigation-menu/features/navigation-menu-features-2` | Nine developer-tool links in a 700px three-column grid; requires Lucide. |
| `navigation-menu-features-3` — Feature Sections with Headers | [`navigation-menu/features/navigation-menu-features-3.tsx`](../upstream/packages/patterns/navigation-menu/features/navigation-menu-features-3.tsx):1-122 | `navigation-menu/features/navigation-menu-features-3` | Single 400px list grouped into Team Tools, Project Tools, and Management section headings; each link has icon and description. Requires Lucide. |
| `navigation-menu-features-4` — Features with Badges | [`navigation-menu/features/navigation-menu-features-4.tsx`](../upstream/packages/patterns/navigation-menu/features/navigation-menu-features-4.tsx):1-101 | `navigation-menu/features/navigation-menu-features-4` | Six 400px stacked feature links with New/Beta/Preview/Pro badges. Requires Badge and Lucide. |
| `navigation-menu-features-5` — Feature Categories | [`navigation-menu/features/navigation-menu-features-5.tsx`](../upstream/packages/patterns/navigation-menu/features/navigation-menu-features-5.tsx):1-176 | `navigation-menu/features/navigation-menu-features-5` | Six categories are sliced into two three-category columns inside a 600px panel; categories have icons, headings, and two links. Requires Lucide. |

### Marketing collection

| ID / title | Local source | Preview path | Distinguishing composition and dependencies |
| --- | --- | --- | --- |
| `navigation-menu-marketing-1` — Product Showcase with CTA | [`navigation-menu/marketing/navigation-menu-marketing-1.tsx`](../upstream/packages/patterns/navigation-menu/marketing/navigation-menu-marketing-1.tsx):1-107 | `navigation-menu/marketing/navigation-menu-marketing-1` | 600px 2:1 grid: three product links and a two-button trial/pricing CTA card. Requires Button and Lucide; buttons have no handler/link. |
| `navigation-menu-marketing-2` — Pricing Tiers Preview | [`navigation-menu/marketing/navigation-menu-marketing-2.tsx`](../upstream/packages/patterns/navigation-menu/marketing/navigation-menu-marketing-2.tsx):1-116 | `navigation-menu/marketing/navigation-menu-marketing-2` | Three price cards in a 700px grid, with one highlighted/badged tier and its CTA as a menu link. Requires Badge and Lucide Check. |
| `navigation-menu-marketing-3` — Case Studies & Testimonials | [`navigation-menu/marketing/navigation-menu-marketing-3.tsx`](../upstream/packages/patterns/navigation-menu/marketing/navigation-menu-marketing-3.tsx):1-119 | `navigation-menu/marketing/navigation-menu-marketing-3` | Four testimonial links in a two-column 700px panel; renders rating stars and Avatar images from external `github.com/{company}.png` URLs, with fallback initials. Requires Avatar and Lucide. |
| `navigation-menu-marketing-4` — Resources with Lead Magnets | [`navigation-menu/marketing/navigation-menu-marketing-4.tsx`](../upstream/packages/patterns/navigation-menu/marketing/navigation-menu-marketing-4.tsx):1-140 | `navigation-menu/marketing/navigation-menu-marketing-4` | 600px resource list plus featured-download card and webinar CTA. Requires Badge, Button, and Lucide; featured media is an empty aspect-ratio placeholder, and buttons are inert. |
| `navigation-menu-marketing-5` — Industry Solutions | [`navigation-menu/marketing/navigation-menu-marketing-5.tsx`](../upstream/packages/patterns/navigation-menu/marketing/navigation-menu-marketing-5.tsx):1-107 | `navigation-menu/marketing/navigation-menu-marketing-5` | Header/description plus six icon cards in a 700px three-column grid. Requires Lucide. |

### Standard collection

| ID / title | Local source | Preview path | Distinguishing composition and dependencies |
| --- | --- | --- | --- |
| `navigation-menu-standard-1` — Simple Navigation | [`navigation-menu/standard/navigation-menu-standard-1.tsx`](../upstream/packages/patterns/navigation-menu/standard/navigation-menu-standard-1.tsx):1-73 | `navigation-menu/standard/navigation-menu-standard-1` | Data-driven mix of two dropdowns and a direct Pricing link; each dropdown has a 192px text-only panel. |
| `navigation-menu-standard-2` — Navigation with Icons | [`navigation-menu/standard/navigation-menu-standard-2.tsx`](../upstream/packages/patterns/navigation-menu/standard/navigation-menu-standard-2.tsx):1-51 | `navigation-menu/standard/navigation-menu-standard-2` | One Features dropdown with four icon-bearing links in a 224px panel; requires Lucide. |
| `navigation-menu-standard-3` — Navigation with Descriptions | [`navigation-menu/standard/navigation-menu-standard-3.tsx`](../upstream/packages/patterns/navigation-menu/standard/navigation-menu-standard-3.tsx):1-68 | `navigation-menu/standard/navigation-menu-standard-3` | One Resources dropdown with three icon/title/description links in a 320px panel; requires Lucide. |
| `navigation-menu-standard-4` — Navigation without Viewport | [`navigation-menu/standard/navigation-menu-standard-4.tsx`](../upstream/packages/patterns/navigation-menu/standard/navigation-menu-standard-4.tsx):1-60 | `navigation-menu/standard/navigation-menu-standard-4` | Two 192px dropdowns pass `viewport={false}` to the root, selecting the primitive’s per-content popover styling rather than the shared viewport. |
| `navigation-menu-standard-5` — Mixed Links and Dropdowns | [`navigation-menu/standard/navigation-menu-standard-5.tsx`](../upstream/packages/patterns/navigation-menu/standard/navigation-menu-standard-5.tsx):1-82 | `navigation-menu/standard/navigation-menu-standard-5` | Product/Support dropdowns alongside Pricing/About links. Direct links explicitly receive `navigationMenuTriggerStyle()` to match trigger appearance. |

**Navigation adaptation notes.** Replace all placeholder links, sample marketing/stat data, external avatar URLs, inert buttons, and media placeholders with application data and real navigation/actions. Use a router-aware link only if it remains compatible with the primitive’s anchor semantics. The source does not supply responsive/mobile navigation, loading/error states, permissions, analytics data, or CTA behavior. Primitive/Radix interaction semantics were read from source; no rendered, keyboard, screen-reader, or browser validation was performed.

## Pagination

All pagination variants are static page selections with `href="#"`. They neither calculate page windows nor mutate the selected page. Production code must own current page, page count, URL/query synchronization, data loading, unavailable-page behavior, and disabled-action handling.

### Advanced collection

| ID / title | Local source | Preview path | Distinguishing composition |
| --- | --- | --- | --- |
| `pagination-advanced-1` — Start Ellipsis | [`pagination/advanced/pagination-advanced-1.tsx`](../upstream/packages/patterns/pagination/advanced/pagination-advanced-1.tsx):1-43 | `pagination/advanced/pagination-advanced-1` | Previous, page 1, ellipsis, 8–10; page 9 active. |
| `pagination-advanced-2` — End Ellipsis | [`pagination/advanced/pagination-advanced-2.tsx`](../upstream/packages/patterns/pagination/advanced/pagination-advanced-2.tsx):1-43 | `pagination/advanced/pagination-advanced-2` | Previous, pages 1–3, ellipsis, page 10; page 2 active. |
| `pagination-advanced-3` — Both Ellipsis | [`pagination/advanced/pagination-advanced-3.tsx`](../upstream/packages/patterns/pagination/advanced/pagination-advanced-3.tsx):1-49 | `pagination/advanced/pagination-advanced-3` | Previous, first page, ellipsis, 5–7, ellipsis, final page 20; page 6 active. |
| `pagination-advanced-4` — Many Pages | [`pagination/advanced/pagination-advanced-4.tsx`](../upstream/packages/patterns/pagination/advanced/pagination-advanced-4.tsx):1-24 | `pagination/advanced/pagination-advanced-4` | Generates ten contiguous links with `Array.from`; index 4 (page 5) is active. |
| `pagination-advanced-5` — Disabled State | [`pagination/advanced/pagination-advanced-5.tsx`](../upstream/packages/patterns/pagination/advanced/pagination-advanced-5.tsx):1-39 | `pagination/advanced/pagination-advanced-5` | Previous receives only `pointer-events-none opacity-50`; it remains an anchor with `href="#"`, not a semantic disabled control. |

### Basic collection

| ID / title | Local source | Preview path | Distinguishing composition |
| --- | --- | --- | ---|
| `pagination-basic-1` — Simple Page Numbers | [`pagination/basic/pagination-basic-1.tsx`](../upstream/packages/patterns/pagination/basic/pagination-basic-1.tsx):1-28 | `pagination/basic/pagination-basic-1` | Three numeric links; page 2 active. |
| `pagination-basic-2` — Five Page Numbers | [`pagination/basic/pagination-basic-2.tsx`](../upstream/packages/patterns/pagination/basic/pagination-basic-2.tsx):1-34 | `pagination/basic/pagination-basic-2` | Five numeric links; page 3 active. |
| `pagination-basic-3` — With Previous and Next | [`pagination/basic/pagination-basic-3.tsx`](../upstream/packages/patterns/pagination/basic/pagination-basic-3.tsx):1-36 | `pagination/basic/pagination-basic-3` | Previous/next surround pages 1–3; page 2 active. |
| `pagination-basic-4` — With Ellipsis | [`pagination/basic/pagination-basic-4.tsx`](../upstream/packages/patterns/pagination/basic/pagination-basic-4.tsx):1-35 | `pagination/basic/pagination-basic-4` | Pages 1–3, ellipsis, and page 10; page 2 active. |
| `pagination-basic-5` — Complete Pagination | [`pagination/basic/pagination-basic-5.tsx`](../upstream/packages/patterns/pagination/basic/pagination-basic-5.tsx):1-43 | `pagination/basic/pagination-basic-5` | Previous/next with pages 1–3, ellipsis, and page 10; page 2 active. |

### Navigation collection

| ID / title | Local source | Preview path | Distinguishing composition |
| --- | --- | --- | --- |
| `pagination-navigation-1` — Previous and Next Only | [`pagination/navigation/pagination-navigation-1.tsx`](../upstream/packages/patterns/pagination/navigation/pagination-navigation-1.tsx):1-24 | `pagination/navigation/pagination-navigation-1` | Only previous and next anchors. |
| `pagination-navigation-2` — With Page Counter | [`pagination/navigation/pagination-navigation-2.tsx`](../upstream/packages/patterns/pagination/navigation/pagination-navigation-2.tsx):1-27 | `pagination/navigation/pagination-navigation-2` | Previous/next flank static “Page 2 of 10” text. |
| `pagination-navigation-3` — First and Last | [`pagination/navigation/pagination-navigation-3.tsx`](../upstream/packages/patterns/pagination/navigation/pagination-navigation-3.tsx):1-32 | `pagination/navigation/pagination-navigation-3` | Text-sized custom `PaginationLink` anchors labeled First and Last around active page 5. |
| `pagination-navigation-4` — With First and Last | [`pagination/navigation/pagination-navigation-4.tsx`](../upstream/packages/patterns/pagination/navigation/pagination-navigation-4.tsx):1-40 | `pagination/navigation/pagination-navigation-4` | First, previous, active page 5, next, last. |

### Sizes collection

| ID / title | Local source | Preview path | Distinguishing composition |
| --- | --- | --- | --- |
| `pagination-sizes-1` — Small Size | [`pagination/sizes/pagination-sizes-1.tsx`](../upstream/packages/patterns/pagination/sizes/pagination-sizes-1.tsx):1-40 | `pagination/sizes/pagination-sizes-1` | Root `text-sm`, `gap-0.5`, links `size="sm"` with explicit `h-7` sizing. |
| `pagination-sizes-2` — Default Size | [`pagination/sizes/pagination-sizes-2.tsx`](../upstream/packages/patterns/pagination/sizes/pagination-sizes-2.tsx):1-36 | `pagination/sizes/pagination-sizes-2` | Default primitive spacing and sizing with previous/next and pages 1–3. |
| `pagination-sizes-3` — Large Size | [`pagination/sizes/pagination-sizes-3.tsx`](../upstream/packages/patterns/pagination/sizes/pagination-sizes-3.tsx):1-40 | `pagination/sizes/pagination-sizes-3` | Root `text-base`, `gap-2`, links `size="lg"` and explicit `h-11` dimensions. |
| `pagination-sizes-4` — Compact | [`pagination/sizes/pagination-sizes-4.tsx`](../upstream/packages/patterns/pagination/sizes/pagination-sizes-4.tsx):1-28 | `pagination/sizes/pagination-sizes-4` | Three numeric links using only `gap-0.5`; page 2 active. |
| `pagination-sizes-5` — Spacious | [`pagination/sizes/pagination-sizes-5.tsx`](../upstream/packages/patterns/pagination/sizes/pagination-sizes-5.tsx):1-28 | `pagination/sizes/pagination-sizes-5` | Same three-link composition as Compact but `gap-3`. |

**Pagination accessibility/adaptation caveats.** The wrapper provides a navigation landmark and label, active pages receive `aria-current`, and previous/next have labels ([`pagination.tsx`](../upstream/packages/shadcn-ui/components/ui/pagination.tsx):10-17, 47-84). Its ellipsis wrapper is itself `aria-hidden`, so its nested visually-hidden “More pages” text is also within hidden content ([`pagination.tsx`](../upstream/packages/shadcn-ui/components/ui/pagination.tsx):98-113). This is source inspection only, not an accessibility validation result. Keep the semantic nav/list/anchor structure, but implement real hrefs or router navigation and a semantic, keyboard-safe disabled policy.

## Coverage and missing inputs

- **Covered:** 10/10 menubar standard patterns; 20/20 navigation-menu patterns across complex, features, marketing, and standard; 19/19 pagination patterns across advanced, basic, navigation, and sizes — **49/49 assigned source files**.
- **Catalog sources read:** [`catalog/patterns/menubar.md`](../catalog/patterns/menubar.md), [`navigation-menu.md`](../catalog/patterns/navigation-menu.md), and [`pagination.md`](../catalog/patterns/pagination.md), each enumerating the linked IDs, titles, local paths, and preview routes.
- **Missing/unvalidated inputs:** no product information defining actual commands, routes, pagination data contract, authorization, responsive requirements, media assets, or URL strategy was supplied. No upstream code was run; no dependency installation, browser/preview visit, visual review, keyboard test, or assistive-technology validation was performed.
