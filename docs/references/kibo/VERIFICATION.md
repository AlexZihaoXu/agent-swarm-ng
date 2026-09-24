# Integration verification and review disposition

## Snapshot identity and coverage

- Upstream: `https://github.com/shadcnblocks/kibo.git`
- Commit: `3d63cdb15b79d972e3dc38a10997987672f9b263`
- Tree: `db16e3c8338b75f5bdd453acd598c6137fe1365a`
- Project baseline for application observations: `389caad059016ad1a9b9b61f58d3723aaf42fe90`.

Counts below were measured from the pinned Git tree, [manifest](metadata/manifest.json), [generated inventory](catalog/summary.json), and source imports—not treated as expected constants:

| Surface | Coverage |
| --- | ---: |
| Tracked upstream files (no exclusions) | 1,644 |
| Pattern TSX files | 1,101 |
| Pattern families / collections | 53 / 209 |
| Component / block / general documentation pages | 41 / 28 / 10 |
| Example files / shadcn-ui files | 168 / 62 |
| Generated catalog files | 60 |
| Integrated reading guides | 36 (18 patterns, 9 components, 7 blocks, 2 general docs) |
| Direct component-to-example import relationships | 158 across 146 unique example files |
| Block installer-to-example mappings | 28 / 28 |

Each family/documentation ID has one primary guide assignment in [guide-map.json](guide-map.json). Shared examples and contextual cross-reading intentionally overlap. Every pattern ID is represented in its assigned notes. The entire repository is retained even where only navigational indexing (rather than detailed semantic analysis) is appropriate. No `packages/blocks` exists at this pin. `feature-tabs.tsx` is retained as an adjacent example, not a 29th mapped block.

**Notifications Button remains exact and available:** [`packages/patterns/button-group/badges/button-group-badges-1.tsx`](upstream/packages/patterns/button-group/badges/button-group-badges-1.tsx), with literal title and preview mapping tested.

## Sol findings — all resolved in the integrated guides

The original temporary recordings/reviews were not edited. The durable versions are [here](guides/README.md).

| Review / finding | Disposition and exact evidence |
| --- | --- |
| patterns-a P1: broken local evidence links | Normalized every integrated guide's source/catalog/project destinations; replaced temporary snapshot links with this durable verification page. Local inline links are checked across guides and catalog. |
| patterns-a P1: collection totals | Corrected [patterns-03](guides/patterns-03.md) to 17 (2 + 5 + 10), [patterns-05](guides/patterns-05.md) to 13 (7 + 1 + 5); confirmed from pattern inventory. |
| patterns-a P2: impossible primitive lines | Corrected [checkbox](upstream/packages/shadcn-ui/components/ui/checkbox.tsx#L9-L31), its [indicator](upstream/packages/shadcn-ui/components/ui/checkbox.tsx#L23-L28), and [collapsible](upstream/packages/shadcn-ui/components/ui/collapsible.tsx#L5-L31) hints in patterns-05. |
| patterns-b P1: broken local links | Resolved by the same full-library normalization/check, including patterns-10/12/13/14. |
| patterns-b P2: Sheet header/title claim | [patterns-14](guides/patterns-14.md) now records that all 29 sources use `SheetHeader` and `SheetTitle`; navigation generally omits `SheetDescription`. Checked all Sheet source files; [navigation example](upstream/packages/patterns/sheet/navigation/sheet-navigation-1.tsx#L3-L20). |
| components P1: broken evidence links | Normalized local links, including immutable GitHub blob links to their exact local equivalents; checked existence offline. Remote URLs were not opened. |
| components P1: omitted Cursor/Dropzone consumers | Added [collaborative-canvas](upstream/apps/docs/examples/collaborative-canvas.tsx#L3-L10) and [form](upstream/apps/docs/examples/form.tsx#L281-L291) to [components-03](guides/components-03.md). Correct total: 25 relationships (4/7/3/4/7). Notes distinguish simulated collaboration and local file state from services; Form omits Dropzone `src`. |
| components P2: components-02 count | Corrected 28 to 27; direct imports measure Code Block 11, Color Picker 1, Combobox 5, Comparison 3, Contribution Graph 7. |
| blocks-docs P1: fabricated MCP history | Removed HTTP-500/user-history claims from both [docs-01](guides/docs-01.md) and [docs-02](guides/docs-02.md). Only the actual task prohibition remains; no runtime result is invented. |
| blocks-docs P1: broken local block links | Resolved in blocks-01/02/06 and all other integrated notes. No durable guide depends on temporary workflow artifacts. |
| blocks-docs P1: ineffective Roadmap Kanban drop | [blocks-07](guides/blocks-07.md) explicitly explains that [Roadmap](upstream/apps/docs/examples/roadmap.tsx#L393-L438) initializes `column` but updates only `status`, with no `onDataChange`; [KanbanCards](upstream/packages/kanban/index.tsx#L159-L163) filters by `column`. Cross-column movement is therefore ineffective; card-over targets can fail the status lookup. This is a source-level finding, not an executed interaction test. |
| blocks-docs P2: Feature tabs overclassification | [blocks-05](guides/blocks-05.md) distinguishes four mapped examples from adjacent Feature51. Verified [installer-to-Preview wiring](upstream/apps/docs/app/(docs)/[[...slug]]/page.tsx#L59-L64) and [exact example loading](upstream/apps/docs/components/preview/index.tsx#L22-L34), not a filename-prefix guess. |

No speculative reviewer suggestion was adopted as an application requirement. Guidance retains required adaptation cautions without implementing any UI or architecture.

## Additional integration corrections

- The generated family overview incorrectly linked `patterns/<family>.md` from inside `catalog/patterns/`. Fixed the local generator to emit `<family>.md` and regenerated all indexes; exact upstream files were unchanged.
- Expanded compact Button ID suffixes for unambiguous lookup and aligned toggle-group/toggle guide assignments with actual recording boundaries, rather than naïve lexical grouping.
- Removed duplicated Deck API and Rating demo code from guidance in favor of exact source links. Long exact upstream/generated files remain intact. Bounded guide tables are retained because their rows document distinct variants; common lookup and adaptation rules are centralized in the entry guide.
- Corrected 12 additional out-of-bounds upstream link hints after checking the exact files, including Spinner MDX features and shadcn package dependencies. Removed stale line anchors on evolving non-upstream documentation. Local viewers may still lack source-line anchor support; use an editor.
- Initial refresh failed on Windows while deleting a read-only Git pack index in the dedicated cache, before any mirror publication. With supervisor approval, the local tool now reuses only the validated project-local Git cache, rejects an unexpected origin, initializes a missing origin, and fetches the same pin. No broad permission change or source edit was used. Check-time temporary directories now also stay under project `.scratch/`.

## Validation evidence

The following were run without installing dependencies or executing upstream code:

- `python docs/references/kibo/tools/test_snapshot.py` — 7 tests pass, including cache reuse, unexpected-origin refusal, and wrong-location refusal.
- `python docs/references/kibo/tools/test_reference.py` — focused navigation/coverage tests pass. The initial red run caught broken generated family links (and incomplete integration artifacts); corrected before acceptance.
- `python docs/references/kibo/tools/snapshot.py` — refresh succeeded twice after the Windows fix, exercising cache reuse.
- Repeat-refresh comparison — all source-manifest entries and catalog bytes identical; only manifest `generatedAt` differs.
- Pinned `git ls-tree -r -z` comparison — every path/mode/blob entry matches the manifest; pinned tree object agrees; independently recomputed Git blob SHA-1 identities agree for all 1,644 copied files.
- `python docs/references/kibo/tools/snapshot.py --check` — 1,644 source files and 60 indexes pass hash/size, exact inventory, symlink, and regeneration checks.
- Final project diff/status inspection — only root integration plus `docs/references/kibo/` changed by this work; no application/dependency/Docker edits; no staged files. An unrelated untracked root `nul` was already present at integration start and was left untouched.

## Limits

Semantic reviews were source-based and risk-sampled, not runtime audits of all implementations. This integration checks complete inventory/navigation and resolves every reported defect; it does not prove every descriptive claim or every transitive dependency correct. Source remains authoritative.

No website, browser, visual, keyboard, screen-reader, responsive, network asset, registry CLI, MCP, or application integration validation occurred. Remote assets/dependencies are not mirrored unless already tracked upstream. Upstream-internal links and instructions are preserved as untrusted data, not corrected or promoted to project rules. Licensing is retained [verbatim](upstream/license.md). See the [entry guide](README.md) for safe lookup and adaptation boundaries.
