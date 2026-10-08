# PERF-186.1 — single viewport visibility filter validation

All numbers are deterministic operation/invocation counts (never wall-clock).
Full production code paths are measured; nothing is gated on time.

## Root-path invocation counts

Measured by wrapping the exported filter functions around the real
`SurveyCadWorkspace` root (`tests/cad_viewport_filter_root_186.test.tsx`,
jsdom, agent tier). Baseline figure is from an instrumented probe on baseline
`a64c3568`; after is asserted by the committed test.

| Action | Baseline full filters | After full filters | After derived filters |
| --- | ---: | ---: | ---: |
| Mount (`SurveyCadWorkspace`) | **4** (hook + 3 stages) | **1** | **3** |
| Unrelated parent re-render | 1 (steady state) | **0** | ≤ 1 (grading stage, snapshot republish) |
| Drafting-panel toggle (internal shell state) | 1 | **0** | ≤ 1 |
| Selection change | 0 | **0** | 0 |
| Layer transaction (project replaced) | 1 | **1** | 3 |
| Undo | 1 | **1** | 3 |
| Idle pointer moves | 0 | **0** | 0 |
| StrictMode mount (dev) | 2 | **2** (double render) | 6 |
| StrictMode unrelated re-render | — | **0** (memo bail-out) | 0 |

Chromium/prod root mount therefore runs one full primitive scan instead of
four.

## Deterministic per-fixture operation counts

Fixture for the count test (`tests/cad_viewport_filter_186.test.ts`): 2000
line entities on 60 layers, 250 synthesized labels, 1 transient preview
primitive → **2251 primitives**, 2000 unique entities, 60 layers.

| Counter | Baseline (4-pass pipeline) | After (1 full + 3 derived) |
| --- | ---: | ---: |
| Full primitive scans | 4 | **1** |
| Entity-map builds | 4 | 0 (1 indexed build, WeakMap-memoized) |
| Index builds | 0 | **1** |
| Entity visibility resolutions | 9004 (per primitive) | **2000** (per unique entity) |
| Primitive visibility evaluations | 9004 | **2251** |
| Layer linear finds / index queries | **10000** | **2250** |

The baseline and the new pipeline produce a **deep-equal final scene**
(ordered primitive ids/props, all nine derived arrays) — asserted by
`expect(newFinal).toEqual(legacyFinal)` against a verbatim pre-fix pipeline
replica.

## Parity coverage (`tests/cad_viewport_filter_186.test.ts`, 14 tests)

- OFF layer, FROZEN layer, missing layer, `entity.visible: false`.
- Full staged 4-pass-vs-new pipeline deep-equal with hidden layers,
  `entity.visible: false`, missing layers/sources, synthetic labels under the
  label-vs-backing rule, a block hover child, a transient overlay with no
  backing entity, and **populated** surface/volume raw arrays plus every
  attached derived family (profile/sample/section/analysis/legend/grading/
  group) — ordered primitive ids/props and final derived visibility asserted; a
  second variant toggles the `labels` layer OFF on the same fixture.
- Unknown/transient preview primitives kept even on a hidden layer.
- Synthesized label hidden under either the `labels` layer or the backing
  entity layer; `sourceEntityId` / `sourceSegmentId` preserved.
- Primitive whose own layer differs from the entity layer and is OFF/FROZEN.
- Appearance fields preserved (opacity, `strokeDasharray`, `dashPatternUnits`,
  `dashOffsetUnits`, stroke) and all primitive kinds (line/arc/circle/point/
  text).
- Every derived family (surface/volume/analysis/legend/profile/sample/
  section/grading/group) plus the analysis-legend `'general'` fallback for a
  broken reference.
- `withBlockHoverTitles` adds hover metadata only (ids/segment ids unchanged)
  and the derived stage reuses the titled list with zero primitive
  re-evaluations.
- Post-filter surface-edit overlay primitives stay visible.
- Index invalidation: memo per identity, rebuild on replacement with identical
  ids, no strong retention, no id-only stale state, first-wins duplicate
  layers/entities.

## #189 selection retirement

`tests/cad_viewport_filter_root_186.test.tsx` selects an entity, then turns its
layer OFF:

- entity is removed from the rendered scene;
- selection is retired (`selectedEntityIds === []`);
- `viewportHiddenEntityIds` calls during the retirement: **baseline 3 → after
  2** (the render-scoped capture + the post-retirement effect pass; the
  history updater no longer recomputes).

Backed by the same index, so `viewportHiddenEntityIds` itself is an O(1)
`WeakMap` read.

## Focused / neighbor unit suites

- `tests/cad_viewport_filter_186.test.ts` — 14/14
- `tests/cad_viewport_filter_root_186.test.tsx` — 5/5
- `tests/cad_render_standards.test.ts`, `tests/cad_section_ui.test.ts`,
  `tests/cad_grading_ui_20b.test.ts`, `tests/cad_surface_contour_ui.test.ts`,
  `tests/evidence/phase19b_sheet_layout_performance.test.ts` — all green
  (72 tests across the 7 files).
- #183/#184/#185 pins green: `cad_pointer_culling_183`,
  `cad_pointer_perf_183`, `cad_snap_state_dedupe_183`,
  `cad_command_pointer_seed_183`, `cad_shell_snapshot_memo_184`,
  `cad_surface_revision_cache_185`, `cad_surface_source_revision_memo_185`,
  `cad_surface_contour_race_185`, `cad_surface_contours` — 62/62.
- `tests/surveyCadWorkspace/` — 52 files / 144 passed / 1 skipped.

## Browser QA

New spec `tests-browser/cad-viewport-filter-186.spec.ts` (production bundle,
`playwright.prod.config.ts`): **3/3 green, zero page/console errors**.

- A: OFF/ON + Freeze/Thaw hide/restore; hidden entity dropped; selection
  retired; screenshot `docs/evidence/perf-186/186-A-layers.png`; counts in
  `docs/evidence/perf-186/browser-counts.json`.
- B: crossing box select, Select-All + Shift-click multi-select, undo/redo
  restore the filtered scene.
- C: endpoint-snapped polyline, middle-drag pan, wheel zoom, double-middle-
  click zoom extents — geometry stable, zero errors. The polyline starts on a
  base line's end endpoint: the pointer is moved ~10px past the endpoint (onto
  the empty canvas, clear of the hit stroke), the live snap badge must read
  `Endpoint: <coord>`, and the committed drawing is saved/parsed to assert the
  polyline's first vertex **equals the base line's `toX`/`toY` exactly** (the
  raw click was not on the endpoint). Counts/badge/vertex in
  `docs/evidence/perf-186/browser-counts.json`.

Existing neighbor specs (real `/cad` UI):

- `cad-drawing-18c.spec.ts` (dev server) — 11/11.
- `cad-pointer-perf-183.spec.ts` (prod) — 2/2.
- `cad-surface-revision-185.spec.ts` (dev server) — 1/1.
- `cad-sheet-layout-production-19b.spec.ts` — 22/24 (2 failures).
- `cad-sections-18k` — green except `18K-B`.
- `cad-grading-daylight-20b` non-visual — green; `...-visual` sweep 3 failures.

Pre-existing failures were re-run with the baseline production files restored
(no stash touched) and reproduce identically on `a64c3568`:

- `18C-C` / `18C-G` — only fail under the **prod** config; the spec's documented
  route is the dev server, where 18c is 11/11. (Config mismatch, not a
  regression.)
- `cad-surface-revision-185` — only fails under the prod config (it dynamically
  imports `/src/workers/surfaceClient.ts`, unavailable in `dist/`); dev config
  1/1.
- `18K-B` — pre-existing (`section status did not go stale after breakline`).
- `19B-A` / `19B captures@1920` — pre-existing (`Page Setup` menuitem outside
  the 1920 viewport in this environment).
- `cad-grading-daylight-20b-visual` × 3 — pre-existing (`Needs Recalc` not
  observed).

## Commands run

- `npx vitest run tests/cad_viewport_filter_186.test.ts tests/cad_viewport_filter_root_186.test.tsx …` — 72/72.
- `npx vitest run tests/surveyCadWorkspace/` — 144 passed / 1 skipped.
- `npx tsc --noEmit` — clean.
- `npm run build` — clean (10.3 s).
- `npx playwright test cad-viewport-filter-186 --config=playwright.prod.config.ts` — 3/3.
- Baseline reproductions with production files temporarily restored from
  `a64c3568` (backed up, then restored; **stashes untouched, still 14**).

## Risks

- The index is only valid while `CadProject`/layer/entity objects are treated
  immutably. Production writers replace them per transaction; in-place
  mutation is out of contract and pinned by test.
- `filterCadDerivedLayersForViewport` requires an already-filtered base and
  must only receive metadata-only primitive rewrites. This is asserted by the
  parity test (`withBlockHoverTitles` preserves the primitive id set) and the
  root mount contract (one full scan per transaction).
- Duplicate layer/entity/style ids now resolve first-wins (matching
  `.find(...)`), never the old `new Map` last-wins entity behavior. Real
  drawings have unique ids; the contract is pinned.
