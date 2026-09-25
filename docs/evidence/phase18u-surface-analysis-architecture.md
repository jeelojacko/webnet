# Phase 18U — Surface Analysis Maps & Legends Architecture

Baseline: `origin/main 5ac21ea0` (PR #111 merge). Branch: `feat/cad-surface-analysis-bands-legends`.
Scope: analysis-map drawing model, definitions-only persistence, legend presentation
model, geometry-vs-appearance revision split. No solver/18I formula change.

## 1. Confirmed: no first-class analysis map exists today

Repo-wide grep at baseline `5ac21ea0` (this phase's files did not exist yet):

```bash
rg -i "analysisMap|analysisLegend|cadAnalysis|analysisBands" src tests docs
# no matches
```

What exists instead:

| Existing thing | Location | Why it is not an analysis map |
|---|---|---|
| Surface display style | `cadTypes.ts:1048 CadSurfaceStyle` | One style per surface; recolor/contour display only, no band ranges |
| Contour intervals | `CadSurfaceStyle.minorContourInterval` / `majorContourEvery` | Contour LINE levels, not filled ranges; no per-band color/metric |
| Volume display style | `cadTypes.ts:1097 CadVolumeSurfaceStyle` | Global cut/fill colors + opacity, no ranges |
| Slope inquiry | `surfaceAnalysis.ts:128 querySurfaceSlopeAt` | One point at a time; nothing persisted/listed |
| Face stats | `surfaceAnalysis.ts:225 computeSurfaceFaceStats` | Aggregates only, not a display banding |

There was therefore no owned resource for "banded elevation/slope/depth display",
which is why the map is a new drawing-owned table rather than a field on the
existing style records.

## 2. Current exact surface-plane math (reused, not re-derived)

`src/engine/cad/surfaceAnalysis.ts` is the single home of the TIN plane math. The
18U engine slice must call these helpers; it must never re-derive slope math.

- `planeGradient(a,b,c)` (`:18`) — exact face plane `z = ax + by + c` from the
  cross-product normal: `nx=uy·vz−uz·vy`, `ny=uz·vx−ux·vz`, `nz=ux·vy−uy·vx`;
  returns `{a:−nx/nz, b:−ny/nz}`, `null` on a degenerate/plan-degenerate face
  (`|nz| ≤ 1e-18` or non-finite). NO finite differences: the TIN is
  piecewise-linear, so the face plane IS the surface on that face.
- `slopeRatioOf` (`:39`) = `hypot(a,b)`; `slopePercentOf` (`:42`) = `100·ratio`;
  `slopeAngleDegOf` (`:45`) = `atan(ratio)·180/π`.
- `downslopeAspectDegOf` (`:52`) — survey azimuth `atan2(−a,−b)`, `null` (never 0)
  when the ratio ≤ 1e-12.
- `querySurfaceSlopeAt` (`:128`) — barycentric point-in-triangle over retained
  triangles, `tol = 1e-9`, lowest-index primary face, EDGE/VERTEX ambiguity
  disclosed via `faceNote` + slope range instead of silently picking a plane.
  Fail-closed: `null` outside the mesh/voids.

Band membership for elevation/slope bands therefore evaluates the metric ONCE per
sampled/rendered vertex through these helpers, then classifies into the band
table — it never averages per-face metrics into a fake continuous field
(planimetric-area-weighted means stay in `computeSurfaceFaceStats`, `:225`).

## 3. Surface Style display model (18F/18H) and what it proves

`CadSurfaceStyle` (`cadTypes.ts:1048`) is display intent only:
`color`, `opacity`, `showTriangles`, `showContours`, `showPoints`,
`showBoundary`, `description`, plus 18H contour appearance
(`minorContourInterval`, `majorContourEvery`, `contourBaseElevation`,
`minorContour`/`majorContour` colors, label options). Style CRUD lives in
`cadSurfaceStyles.ts`; recoloring never changes `srev1:` because
`computeCadSurfaceSourceRevision` (`cadSurfaceRevision.ts`) hashes only
definition content.

`CadVolumeSurfaceStyle` (`cadTypes.ts:1097`) follows the same contract with
`showCut`/`showFill`/`cutColor`/`fillColor`/`opacity` (+ optional
`showZeroBoundary`), seeded by `cadVolumeSurfaces.ts` (Cut/Fill, Cut Only,
Fill Only, No Display). `computeVolumeSurfaceRevision` (`vrev1:`) excludes
styles by construction.

These prove the repo convention 18U reuses: **appearance tables are separate
drawing-owned records with their own CRUD and a refcount-guarded delete; they
never participate in geometry revisions.** An analysis map is the same kind of
object, but its band ranges ARE geometry identity (they define what is displayed
and measured), so the map carries both halves and its revision includes ranges.

## 4. 18I delta-plane math (reference for volume-sourced bands)

`src/engine/cad/surfaces/volume/`:

- `overlap.ts:67 clipTrianglePair` — Sutherland–Hodgman convex XY clip in a
  local frame; 0 verts = disjoint, <3 unique/zero-area = contact only (never
  counted as overlap), 3–6 verts = overlap polygon.
- `integrate.ts:52 fitPlane` / `:70 buildVertices` / `:192 integratePolygon` —
  per-vertex Z from the OWNING pair plane (base plane for base Z, comparison
  plane for comparison Z; never a global mesh query, which would be ambiguous on
  shared edges). `delta = cmpZ − baseZ`; both planes linear ⇒ delta linear over
  the overlap polygon; deterministic fan triangulation with
  `∫Δz dA = Area·(δ1+δ2+δ3)/3` (exact, no quadrature).
- Sign split: `delta > 0` = FILL, `delta < 0` = CUT; mixed triangles are clipped
  by the `delta ≥ 0` / `delta ≤ 0` half-planes with `t = δA/(δA−δB)`
  interpolating XY + both Zs.
- `zero.ts:17 zeroDelta` = `4·ε·max(1,|baseZ|,|cmpZ|)`; vertices within ±zeroDelta
  snap to exactly 0, so zero-measure regions contribute to overlap area only —
  never to cut/fill areas or volumes.

18U's `signed-depth` metric is that same `delta`: bands are ranges over `delta`
with the identical sign convention (positive = fill). 18U adds NO new numeric
policy and NO user tolerance; it consumes the 18I engine result regions.

## 5. Existing worker/cache patterns (18U must fit them)

- **Latest-revision maps in the handler**: `surfaceWorkerHandler.ts:406-478`
  keeps `latestRevisionBySurface` / `latestVolumeBySurface` /
  `latestProfileByProfile` / `latestSectionsByGroup`. Before every post-work
  emit it re-checks the map; a late result for a superseded revision is dropped,
  never promoted to CURRENT.
- **Service ownership + generation guards**: `surfaceVolumeService.ts:80`
  (`SurfaceVolumeService`) owns `pending: Map<volumeId, {requestId, revision}>`
  and a session diagnostic map (`:85`), with `statusOf` deriving the volume
  status from the cache revision. Possession tuple = (requestId, drawingId,
  volumeSurfaceId, volumeRevision); foreign/late/stale results are discarded.
- **Session caches**: `surfaceVolumeCache.ts:26` keys
  `scopeId::volumeId@volumeRevision` and keeps an EXPLICIT insertion-order
  keeper list (current + ≤1 stale), never lexicographic eviction — the contour
  `surfaceContourCache.ts:33 boundSurface` recency bug is deliberately not
  repeated.
- **Additive WNCAD backfill**: `cadPersistence.ts` clone/load plus
  `cadDrawingFile.ts` open/migrate paths append new tables at the tail of
  `CadProject`, because `buildCadProjectSignature` is
  `JSON.stringify(project)` and therefore key-order sensitive
  (`cadProjectState.ts:144`). Missing fields backfill additively with NO schema
  bump (18E/18F/18I/18J/18K/18N/18O precedent).
- **Display discipline**: `cadVolumeView.ts:101` builds ONE aggregated SVG path
  for CUT + one for FILL from cached `displayRegions` — never per-triangle DOM.
- **Transform discipline**: `cadProjectTransform.ts` moves XY geometry exactly
  once (`applyPoint`), leaves Z alone, and nulls `cachedRevision` so old-frame
  worker results are retired by revision ownership.

## 6. Analysis resource model decision

**Decision: separate drawing-owned `CadAnalysisMap` + `CadAnalysisLegend` tables
(NOT fields on `CadSurfaceStyle`/`CadVolumeSurfaceStyle`).**

Reasons:

1. **Cardinality** — one surface/volume may carry several maps (elevation bands,
   slope bands, different band counts). A style field would force one map.
2. **Ownership** — maps are listed, renamed, duplicated, and deleted as
   first-class drawing resources (Toolspace/manager precedent), with an
   independent refcount guard from legends.
3. **Blast radius** — baking bands into a style would drag band geometry into the
   style CRUD and the surface/volume revision audit. Keeping them separate keeps
   `CadSurfaceStyle`/`CadVolumeSurfaceStyle` byte-for-byte unchanged (this slice
   changes neither file).
4. **Multiple sources** — volume-sourced maps must not require a surface style,
   and a map may outlive/outnumber the surfaces it references (broken references
   are legal and derived, never repaired silently).

`CadAnalysisMap.source` is a discriminated union: `{kind:'surface', surfaceId,
metric:'elevation'|'slope-percent'|'slope-angle'}` or `{kind:'volume',
volumeSurfaceId, metric:'signed-depth'}`. One map has one source and one metric;
switching either is a geometry edit (new thresholds may be needed).

Resource constants live in `cadAnalysisTypes.ts` and are the single home:
`MAX_ANALYSIS_BANDS = 64`, `DEFAULT_ANALYSIS_BAND_COUNT = 5`. The (future) 18U
engine slice imports these from here rather than re-declaring them.

## 7. Persistence: definitions only, results session-only

Persisted on `CadProject` (additive, **schema stays v2**):

```ts
analysisMaps?: CadAnalysisMap[];      // id, name, source, bands[], layerId?, opacity?,
                                      // showBoundaries?, description?
analysisLegends?: CadAnalysisLegend[];// id, analysisId, insertionX/Y, title?, textStyleId?,
                                      // swatchWidth?, rowHeight?, show* flags?
```

Never persisted (session cache only, mirroring 18I `vrev1`/result caches):
band areas, percentages, volumes, derived fill polygons, statuses/diagnostics,
and geometry revisions. A reopen always derives `UNBUILT`/`SOURCE_NOT_CURRENT`,
never a false `CURRENT`.

Trailing key order (the one hard rule):

- `cadPersistence.ts:286-291` — `cloneCadProject` appends `analysisMaps`,
  `analysisLegends` AFTER `annotationSettings` (last 18O key).
- `cadPersistence.ts:393-396` — `sanitizeSurveyCadPersistedState` backfills both
  tables (absent ⇒ `[]`) after `blockDefinitions`.
- `cadDrawingFile.ts:141-142` — `createBlankCadProject` appends both after
  `backfillCadAnnotationTables`.
- `cadDrawingFile.ts:305-308`, `:399-402` — the `.wncad` open path and the legacy
  `surveyCad` migration append both after `sanitizeAnnotationTables`
  (which itself appends the 18O tables last).
- `cadProjectTransform.ts:607-612` — the transform overrides the EXISTING
  `analysisLegends` key in place (position preserved) with XY-moved insertions.

`cloneCadAnalysisMaps` / `backfillAnalysisMaps` /
`cloneCadAnalysisLegends` / `backfillAnalysisLegends` live in the model files
(volume precedent: `cadVolumeSurfaces.ts` owns its clone/backfill).
`clearAnalysisCacheOnLoad` (`cadAnalysisMaps.ts`) is the documented load-time
clear: derived results are session-only, so the correct load behavior is a clone
that drops everything derived (nothing today), giving future derived fields one
home and keeping every load path uniform.

## 8. Geometry-vs-appearance revision split

`computeAnalysisGeometryRevision(def, sourceRevisions)` → `arev1:` + FNV-1a
(`cadRevisionHash.ts` — the shared hash home; never re-implemented; the same
helper backs `srev1:`/`vrev1:`).

Hashed parts, in fixed order:

1. `kind:` source kind (`surface` | `volume`)
2. `id:` `surfaceId` | `volumeSurfaceId`
3. `metric:` elevation | slope-percent | slope-angle | signed-depth
4. `src:` the referenced source's own content revision
   (`srev1:` surface / `vrev1:` volume; `none` when never built)
5. `thresholds:` sorted, de-duplicated, canonically-numbered band edges
   (`canonicalNum`, so `-0` ≡ `0`)

EXCLUDED by construction: band colors and labels, map name/description/opacity/
`showBoundaries`/`layerId`, legend placement and flags. Band ARRAY order is also
excluded (the threshold set is the identity), which makes row reordering cosmetic
— correct, since reordering draws the same picture.

Consequences pinned by tests:

- recolor/relabel/opacity/name/edit → SAME `arev1:` (no recalculation)
- threshold / metric / source id / source revision change → DIFFERENT `arev1:`
- a volume-backed map identity-switches on `vrev1:`, not on the volume's
  quantities.

## 9. Derived status (pure, fail-closed)

`deriveAnalysisStatus(def, sourceStatuses, hasCurrentResult, resultRevision,
geometryRevision, session?)` → `CadAnalysisStatus`:

```
BUILDING > BROKEN_REFERENCE > SOURCE_NOT_CURRENT >
  FAILED / UNBUILT (no result) > NEEDS_RECALC > NO_DATA > CURRENT
```

- `BUILDING` is a session-only in-flight fact (`session.building`).
- `BROKEN_REFERENCE` — the source id does not resolve (`found: false`).
- `SOURCE_NOT_CURRENT` — source exists but its own derived status is anything
  other than `CURRENT` (including `null`/unknown: never assume current).
- `FAILED` vs `UNBUILT` — no session result plus a failure diagnostic vs none.
- `NEEDS_RECALC` — a result exists but its `resultRevision` ≠ current
  `geometryRevision`.
- `NO_DATA` — result current but measured an empty domain (18I `NO_OVERLAP`
  analogue: current source, zero-measure/void-only domain).
- `CURRENT` — source current AND result revision matches AND data present.

Legends never invent currency: `deriveAnalysisLegendStatus(legend,
analysisStatus)` returns `BROKEN_REFERENCE` when `analysisId` is empty or the map
does not resolve, else the referenced map's status verbatim.

## 10. Rendering strategy

- **Derived fills UNDER contours/edges.** Analysis fills are a display layer
  beneath the existing surface contours/edges/triangles, so contour lines and the
  surface boundary stay legible over the fills (volume-view precedent: fills are
  painted regions, edges are separate passes).
- **Aggregated paths.** One SVG path per band (or per band-color run) built from
  cached derived regions — never one DOM node per triangle
  (`cadVolumeView.ts:101` precedent; path-D wall policy carried over).
- **Band boundaries optional.** `showBoundaries` draws band edge lines as one
  extra aggregated path; it never affects membership or measured areas.
- **Opacity** is a fill-level `opacity` attribute (map-level `opacity`), so
  recoloring/opacity changes repaint only — no recalculation, no revision move.
- **Layer semantics** reuse the established contract: explicit `layerId` honours
  OFF/FROZEN as hidden and LOCK as edit-blocked without a rebuild
  (`isSurfaceDisplayVisible` pattern).
- **Determinism**: band order in the render pass is the stored `bands` order;
  path command order follows cached region order, so identical inputs produce
  byte-identical path strings.

## 11. Legend model

`CadAnalysisLegend` references `analysisId` (never embeds band data) and carries
presentation: `insertionX/Y`, optional `title`, `textStyleId` (18O text styles —
legends reuse the professional text-style table rather than inventing fonts),
`swatchWidth`, `rowHeight`, and `showRange`/`showArea`/`showPercent`/
`showVolume` flags. Row content is read from the referenced map + session result
at render time, so a stale result can never be baked into a legend.

- CRUD: `cadAnalysisLegends.ts` create / move / update / delete, plus
  `transformAnalysisLegendInsertion` (XY-only `applyPoint`, appearance fields
  preserved) for PROJECTTRANSFORM.
- Reference guard: deleting a map with legends is BLOCKED and returns the
  referencing legend ids (`BLOCKED_BY_LEGEND`); `deleteLegendsToo: true` removes
  map + legends atomically. Map delete never silently rebinds a legend.
- Broken references are legal on load (a missing map is not a failed open) and
  derive `BROKEN_REFERENCE`.

## 12. Performance risks

1. **Band rasterization over a large TIN.** Fills are computed from derived
   regions, not by classifying every triangle per frame; classification happens
   once per build/worker pass. Risk medium (same family as 18I region storage).
2. **Keeper list memory.** Session results keep current + ≤1 stale per map
   (`surfaceVolumeCache.ts` precedent). With N maps this is O(N) regions; maps are
   user-created and bounded in practice. Use explicit insertion-order keepers;
   never lexicographic eviction.
3. **Legend render cost.** Legend rows read cached summaries; O(bands) DOM per
   legend, not O(surface size). Low.
4. **Path size.** One aggregated path per band-color run keeps DOM small; extreme
   band counts (cap 64) could still make giant paths for huge regions — accepted
   ceiling, mitigated by band cap and optional viewport suppression policy
   carried from 18I §48.
5. **Revision churn.** Threshold edits invalidate the cached result (correct);
   recolor/opacity moves must NOT (pinned by the revision tests) or the worker
   would thrash on cosmetic edits.
6. **Worker reuse.** Analysis should extend the existing surface worker
   message/service pattern with latest-revision maps rather than adding a new
   worker file (18I §4 precedent) to bound worker count per session.

## 13. Module map (this slice)

| File | Responsibility |
|---|---|
| `src/engine/cad/cadAnalysisTypes.ts` | Types + `MAX_ANALYSIS_BANDS` / `DEFAULT_ANALYSIS_BAND_COUNT` (single home) |
| `src/engine/cad/cadAnalysisRevision.ts` | `arev1:` geometry revision (appearance excluded) |
| `src/engine/cad/cadAnalysisStatus.ts` | Pure fail-closed status derivation |
| `src/engine/cad/cadAnalysisMaps.ts` | Map CRUD, `validateAnalysisBands`, band generation, clones/backfill, cache-clear |
| `src/engine/cad/cadAnalysisLegends.ts` | Legend CRUD, broken-ref derivation, insertion transform |
| `src/engine/cad/cadTypes.ts` | Two trailing optional tables (schema v2) |
| `src/engine/cad/cadPersistence.ts` | Clone + load backfill (trailing order) |
| `src/engine/cad/cadDrawingFile.ts` | Blank/open/migrate backfill (trailing order) |
| `src/engine/cad/cadProjectTransform.ts` | Legend insertion XY move |
| `src/engine/cad/surfaceAnalysis/scalarClip.ts` (slice B) | Shared numeric band validator that `cadAnalysisMaps` delegates to |
| `src/engine/cad/surfaceAnalysis/rangeGenerator.ts` (slice B) | Equal-width range generator; imports the model's band cap/default |

Untouched by design: `CadSurfaceStyle`, `CadVolumeSurfaceStyle`, 18I
`zeroDelta`/`integratePolygon`, and the 18H plane/slope helpers.

## 14. Validation contract

`validateAnalysisBands(bands)` (shared, one home) returns `null` or a stable
reason code: `ANALYSIS_BANDS_EMPTY`, `ANALYSIS_BANDS_TOO_MANY`,
`ANALYSIS_BAND_ID`, `ANALYSIS_BAND_ID_DUPLICATE`, `ANALYSIS_BAND_NON_FINITE`,
`ANALYSIS_BAND_RANGE` (`lower ≥ upper`), `ANALYSIS_BAND_COLOR`,
`ANALYSIS_BAND_LABEL`, `ANALYSIS_BAND_OVERLAP`. Touching edges
(`next.lower === prev.upper`, relative tolerance `1e-12·max(1,|edge|)`) and gaps
are legal. Generated bands share exact edge values, so touching holds without
tolerance games.

Note: the 18U engine slice (slice B) provides
`src/engine/cad/surfaceAnalysis/scalarClip.ts` (`validateAnalysisBands`, the
numeric array/type/finite/`lower < upper`/overlap core) and
`rangeGenerator.ts` (`generateEqualRanges`, `MAX_ANALYSIS_BANDS` re-export).
`cadAnalysisMaps.ts` DELEGATES the numeric core to the scalarClip validator and
adds only the display-layer checks (cap, duplicate ids, color, label) plus
stable reason codes; `generateAnalysisBands` delegates range math to
`generateEqualRanges`. The single constant home is `cadAnalysisTypes.ts`
(`MAX_ANALYSIS_BANDS`, `DEFAULT_ANALYSIS_BAND_COUNT`); the engine generator
imports them from there, so the two slices cannot drift.
