# Phase 18P — Annotation Hardening Map

Branch: `perf/cad-annotation-production-hardening`
Baseline: `fef23556b16cd0fdfc87353bef2a98126ddb753d` (origin/main at mission creation; fetch confirmed no advancement — `24c64869..fef23556`).
Phase 18O merge: PR #105 (`fef23556`), commits `3bf057a1` + `6d7e8bf1` on top of `24c64869` (PR #104).
Perf evidence: `docs/evidence/phase18o-annotation-performance.md` (125/1250/12500: exportScene 1.34/42.7/2414.6 ms, 31.8×→56.5×; snapQuery 0.19/3.66/64.4 ms). Fresh probe 2026-09-19 on this machine: export-scene 14.6×→74.3×, snap 6.8×→24.3× — confirms O(n²).

## R1 — Fixed creation anchors

ROOT CAUSE: `src/hooks/surveyCad/useSurveyCadAnnotationSessions.ts:35-39` `fixedAnchor` discards `CommandPoint.snapSourceEntityId/snapSourceSegmentId/snapKind` (canonical type `src/hooks/surveyCad/useSurveyCadCommandTypes.ts:14-19`). All DIM kinds (`commitDimension` L95-104) + LEADER (`commitAnnotationSession` L252-258) commit `kind:'fixed'`. Anchor union (`src/engine/cad/annotation/cadAnnotationAnchors.ts:19-63`) + resolver (`L92-108`) + broken semantics already production-ready; creation never emits refs (grep: `survey-point|line-endpoint|arc-point|block-insertion` in `src/` only in sanitizer + types).
FILES: `useSurveyCadAnnotationSessions.ts`, new `src/engine/cad/annotation/cadAnnotationAnchorFromCommandPoint.ts`, `cadTransactionsAnnotationCommands.ts` (L152-227, radius/diameter audit), `CadAnnotationProperties.tsx` (reattach LEADER-only L160-175; dimension engine slots exist `cadTransactions.types.ts:1166-1172` with no UI).
INTENDED FIX: one pure factory `cadAnnotationAnchorFromCommandPoint(project, point)`; wire DIMLINEAR/DIMALIGNED/DIMANGULAR/DIMRADIUS/DIMDIAMETER + LEADER through it; associative only for survey-point / line-endpoint (deterministic start|end, tie→start) / arc-center / arc-endpoint / block-insertion-at-insertion; midpoint/nearest/quadrant/arc-midpoint/child-snaps/intersection/apparent/extension/perpendicular/parallel/direction/tangent/free-pick/typed-input/unknown-entity → FIXED. Radius/diameter: persist arc association when snap identifies arc. No migration of existing fixed anchors.
NUMERICAL/SEMANTIC RISK: low — fallbackX/Y = picked point so positions identical at creation; wrong endpoint disambiguation or false child→insertion association would corrupt associativity (mitigate: deterministic tie policy, epsilon insertion check, child→FIXED). Polyline vertices stay FIXED per header constraint.
TEST PLAN: new `cadAnnotationAnchorFromCommandPoint.test.ts` (matrix: every snap kind × source type → assoc/fixed); creation-seam test asserting persisted anchor OBJECT kind; broken-ref flow (assoc → delete source → BROKEN → undo restores); browser QA A–F via actual commands (leader→survey-point, aligned→2 endpoints, radius→arc, block-insertion, free-pick fixed, midpoint fixed).

## R2 — Missing manual screenshot QA

ROOT CAUSE: 18O closed on numerical tests only; no 3-resolution or print-scale visual evidence.
FILES: new captures under `docs/evidence/phase18p-*` (not committed binary-heavy; record procedure + observations); fixture with MText/Leader/Linear/Aligned/Angular/Radius/Diameter/Bearing/Curve/survey blocks/F2F points.
INTENDED FIX: manual QA at 1366×768, 1920×1080, 2560×1440 + print scales 1:250/1:500/1:1000 (paper-height text/arrowheads, model-height text, legacy labels). Associative-creation + broken-ref + large-annotation (1k, manual 5k/10k) browser QA.
NUMERICAL/SEMANTIC RISK: none (observational).
TEST PLAN: §50–55 browser QA checklist; record measurements, no ms gates.

## R3 — O(n²) lookup/export behavior

ROOT CAUSE: repeated linear `.find` inside per-entity/per-item loops; no lookup maps; snap "index" is a per-query closure with no broad phase; whole-scene re-derive per edit + export re-derives display scene.
FILES: `src/engine/cad/cadRenderer.ts` (L919/L923 bearing, L960/L961 curve, L632/L783/L449 styles, L119 layers, ctx L98-105, derive L1207-1226), `src/engine/cad/cadSpatialBounds.ts` (L238/L240, L270/L271, L211, L64; per-call allocs L146/L149), `src/engine/cad/cadExportScene.ts` (L481-501, L538-550, L650-670, L530 re-derive, L531 sort contract), `src/engine/cad/cadSpatialIndex.ts` (L48-392 factory-closure, L69-73 O(entities) per query, L271 locked-branch find), `useSurveyCadWorkspace.ts:134` whole-project memo, new `src/engine/cad/cadProjectLookup.ts`.
INTENDED FIX: (1) `CadProjectLookup` derived O(n) Maps (entity/layer/styles/blocks as needed), built once per pass, memoized by project identity only when immutable-safe. (2) Renderer/bounds/export thread lookup → O(1) source/style/layer; export memoizes appearance per sourceEntityId, Set for omitted ids. (3) Spatial: prepare entity bounds + lookup maps once per `buildCadSpatialIndex(project)`; memoize index on project state; add uniform-grid broad phase ONLY if bounds-caching leaves snap slow (decision doc). (4) Dirty cache: measure after indexing; implement entity-keyed derivation + source→dependent map ONLY if full scene still material (evidence decides; 18O: single-label 0.001 ms vs full 6.5 ms).
NUMERICAL/SEMANTIC RISK: medium — must keep byte-identical SVG (deterministic), unchanged DXF/PDF primitives + dispositions, id-sort + warnings ordering, source-entity color (not labels layer), hidden primitives retained. No tolerance/solver/statistic changes.
TEST PLAN: `cadAnnotationPerf` probe (125/1250/12500, same warmup/median; target ~10×/decade, 2nd decade >20× = review); SVG/PDF/DXF suites; `cad_render_standards`, `cad_appearance`; snap suites (intersection/apparent/extension/perpendicular/parallel/tangent correctness); block bounds-first expansion regression; LandXML coverage matrix unchanged; parity 25/25.

## R4 — Annotation placement partials

ROOT CAUSE (scout-place): leader `textAttachment` stored + sanitized (`cadTypes.ts:430-438`, `cadAnnotationPersistence.ts:453`) + DXF-honored (`dxfAnnotationExport.ts:214`) but canvas/SVG/PDF hardcoded `textAnchor:'start'` (`cadRenderer.ts:645,700`); no UI affordance (`CadAnnotationProperties.tsx:136-171`). Curve labels always horizontal — no `rotationDeg` (`cadRenderer.ts:994`) while bearing labels rotate (`:949`) and `cadReadableTextRotationDeg` exists for dims. Dimension `textPoint` declared/stored/mutated (`cadTypes.ts:451`, commands `:216`, `:274-306` with NO UI caller) but renderer/bounds/adapter use it fallback-only (`cadRenderer.ts:827`, `cadSpatialBounds.ts:226`, `cadMlightcadAdapter.ts:170`); honored manual text is `textOverride` (`:904`). DXF ignores style `offset`+rotation for labels (`dxfAnnotationExport.ts:299-316` vs renderer `:948-951`).
FILES: `cadRenderer.ts` (leader L600-706, dim L779-910, curve L954-996), `cadDimensionGeometry.ts` (`:95`, `:201-217`, `:324-408`), `dxfAnnotationExport.ts`, `cadSpatialBounds.ts` (L211-226), `cadMlightcadAdapter.ts` (`:152-190`), `CadAnnotationProperties.tsx`, `cadAnnotationPersistence.ts`.
INTENDED FIX: leader — honor all 9 attachment values consistently across viewport/SVG/PDF/DXF (landing/text position) or explicitly validate bounded subset; curve — deterministic mid-arc + radial offset placement, tangent rotation via arc helper + shared upright logic (fallback horizontal-only style option if needed), pin CW/CCW; dimension — ONE contract: (A) fully support `textPoint` (grip sets it, source edits update measurement but respect manual location, absolute-model-coords documented, auto-fit only when absent) since field persisted/UI-adjacent, or (B) remove/ignore path explicitly — prefer A; bounds include arrowheads/segments/MTEXT rows/dim arrows+text/extension lines/manual textPoint.
NUMERICAL/SEMANTIC RISK: low-medium — placement changes are visible by design; keep measurement values, bearings/distances/curve metrics, scale, TIN/civil untouched; WNCAD additive-migration only (anchors already exist; old 18O files open identically).
TEST PLAN: unit (attachment × 9 positions, CW/CCW curve rotation, textPoint manual-move + fit policy, bounds inclusion) + SVG/PDF/DXF R12/R2000 regression (FULL/APPROXIMATED dispositions unchanged, no native DIMENSION/LEADER) + WNCAD round-trip + manual visual QA (§50-51).

## Worker D — annotation placement closure (R4)

Scope: leader `textAttachment`, curve label rotation/placement, dimension
`textPoint`, annotation bounds. Renderer / SVG / PDF all consume one
`CadDisplayPrimitive` stream, so the viewport fix also fixes the sheet
deliverables.

### Leader text attachment (all 9 honored)
- New shared pure module `src/engine/cad/annotation/cadAnnotationPlacement.ts`.
  `normalizeTextAttachment` defaults an absent value to `middle-left` — the
  exact behavior the renderer already produced (`textAnchor:'start'`, no
  vertical shift) and the DXF writer already defaulted to, so old drawings
  render identically.
- Semantics: the reference point is the **landing endpoint advanced by
  `textGap`** along the leader departure direction; the horizontal component
  chooses the anchor (`left→start`, `center→middle`, `right→end`) and the
  vertical component stacks the block (`top` hangs below, `middle` centers,
  `bottom` sits above) with the same `chars*0.6*height` estimate as MTEXT.
- Renderer (`cadRenderer.ts` `leaderTextPrimitives`), spatial bounds and DXF
  (`pushAnnotationTextRows` after `leaderTextReferencePoint`) all use the
  module, so viewport/sheet/DXF agree. Multi-line leader text now emits one
  row primitive per line (`primitive:<id>:text`, `:text:2`, …); single-line
  leaders keep the historic `:text` id.
- DXF also gained the previously missing **landing segment** and the
  text was moved from `vertices[0]` to the landing end; the arrowhead bearing
  was corrected to point from the first vertex to the arrow anchor. Both were
  divergence bugs, not new approximations.
- Properties palette: a `Text attachment` select (empty = leader-style
  default) drives the `leader-update` op.

### Curve label placement + rotation
- `curveLabelPlacement` places the label at the **mid-sweep point** using the
  signed sweep (CW and CCW both get the true visual midpoint), applies the
  style offset **and** the entity E/N offset, and rotates along the local
  tangent folded upright by the shared `uprightRotation`. It matches the
  position the previous horizontal-only code produced (offset 0), and now adds
  the missing rotation.
- `deriveCurveLabel` now uses `|cadSignedSweepDeg|` instead of the
  counter-clockwise delta, so CW minor arcs produce a label instead of a
  BROKEN marker; the delta value is unchanged for CCW arcs.
- DXF emits group 50 on model TEXT (`DxfExportModel.texts.rotationDeg`) so
  curve/dimension text rotation round-trips into R12 and R2000. The curve
  style offset is now honored in DXF too (previously dropped).
- **APPROXIMATED divergence (documented):** the sheet SVG/PDF path
  (`cadExportScene.ts` `primitiveToPaper`) does not yet carry
  `CadDisplayTextPrimitive.rotationDeg` into the paper text item, so curve and
  dimension text render horizontally on SVG/PDF. This is a pre-existing gap
  that also affected bearing labels; the viewport and DXF are correct.

### Dimension `textPoint` — option A (implemented)
- `CadDimensionEntity.textPoint` is in **absolute model coordinates**. When
  present, `deriveCadDimensionGeometry` uses it verbatim as `textPosition`,
  reports `textSide:'manual'`, and skips the automatic inside/outside fit
  (arrows stay inward/kind-default). The measurement still comes from the
  resolved anchors, so source edits move the measured value while the text
  stays where the operator put it.
- `UPDATE_DIMENSION_PLACEMENT` (already persisted) is now fully honored by the
  renderer, DXF and bounds; the adapter fallback is unchanged.
- Properties palette: `Text E` / `Text N` (seeded from the current manual point
  or the automatic position) plus `Auto text placement` to clear it. Clearing
  restores the automatic fit.
- Bounds now include the manual point (via `geometry.bounds`), leader landing
  text reference, and arrowhead bodies (padded by the arrow size), so culling
  and selection cannot miss drawn geometry.

### WNCAD
Additive only: `textPoint`/`textAttachment` were already persisted and
sanitized; an old 18O row without them opens with the fields absent (pinned by
`tests/cad_annotation_persistence.test.ts`).

- **DXF alignment APPROXIMATED (documented):** derived DXF TEXT rows stay
  left/baseline aligned (no group 72/73 alignment pair), so any rotated row
  turns about its left baseline instead of the display primitive's
  start/middle/end anchor point. Unrotated rows are exact; rotation was
  previously absent entirely, so this is strictly closer to the viewport.

## Outcome — QA closure (2026-09-20)

Full QA evidence: `docs/evidence/phase18p-browser-qa.md`. R1–R4 intended fixes
shipped as described above; the following divergences from the map's intent
were measured and are recorded here.

- **R2 closed.** Three-resolution screenshots (1366×768 / 1920×1080 /
  2560×1440) of a 17-entity plan fixture (MText, Leader, Linear/Aligned/
  Angular/Radius/Diameter, Bearing, Curve, block reference, control/free/F2F
  survey points) render 17/17 with zero BROKEN markers, plus print-scale
  numbers at 1:250/1:500/1:1000. Artifacts under `docs/evidence/phase18p/`;
  capture procedure `scripts/phase18pBrowserQa.ts`. Full headless sheet QA is
  still not possible (no sheet-creation UI on a blank drawing) — the
  annotation-scale contract is verified numerically instead.
- **R3 dirty cache DEFERRED (evidence decided).** The O(n) lookup/export
  fixes landed and the second-decade blow-up is gone (export-scene 74.1× →
  7.5×, 1,519 ms → 54 ms at 12.5k on the same machine). The entity-keyed
  derivation cache + source→dependent map were **not** built: the full-scene
  rebuild stays ~2.2 ms / ~32 ms at 12.5k on project change, far below the
  map's "still material" bar; rationale + revisit thresholds in
  `docs/evidence/phase18p-spatial-index-decision.md`. Uniform-grid broad
  phase likewise deferred (prepared bounds leave snap at 2.25 ms at 12.5k).
- **R3 new restriction (not in the map):** interactive cursor movement with
  OSNAP on a ~1,250-entity drawing is ~115 ms/move (239/240 moves are
  main-thread long tasks), dominated by whole-viewport React/SVG re-render of
  ~15 k nodes — the spatial index itself is 0.33 ms. Recorded as a follow-up
  target, not addressed in 18P.
- **MOVE duplicates block references** (production transform, 18Q owns it):
  block-insertion association is proved through a Properties Insertion edit,
  not MOVE, in QA test D.
