# Phase 18I — TIN-to-TIN Volume Architecture

Baseline: `origin/main 7e26a547` (PR #98 merge). Branch: `feat/cad-surface-cut-fill-volumes`.
Status: architecture decision (mission §2). No implementation until this is written — it now is.

## 1. No current production cut/fill engine

Repo-wide search (scout-verified): zero volume code exists. The only hits are the
comment "No contour/volume commands in 18F" (`cadCommandRegistry.ts:124`) and
unrelated LandXML `volumeUnit` attribute strings. `CadSurfaceBuildStats` has 3D
face area but no volume field; `m³`/`ft³` appear nowhere in the CAD app.
Phase 18I is greenfield on top of the retained TIN.

## 2. Source mesh representation (what the volume engine consumes)

`CachedSurfaceMesh` (`src/engine/cad/cadSurfaceCache.ts:18-28`):

- `points`: canonical world coords (boundary synthetic tail + Steiner tail included —
  legitimate mesh vertices with interpolated Z; volume must NOT filter them out).
- `triangles: Array<[i,j,k]>`: math-CCW index triples, non-overlapping retained set.
- `adjacency`, `edgeKinds`: derived topology; not needed for volume integration.
- Retained-domain truth = the triangle list itself (flood-classified in 18G).
  Voids/boundaries need no special handling: absent triangles simply don't overlap.

Worker transfer shape: `{ points: number[] (flat XY pairs + Z?), triangles: flat
uint32 }` — flat arrays, no Maps, no class instances. The surface worker already
ships `SurfaceWorkerMesh` (`surfaceWorkerHandler.ts:42-52`); the volume op reuses
that exact shape for base + comparison.

## 3. Triangle-pair indexing (decision: uniform grid over comparison bboxes)

Options considered:

| Option | Verdict |
|---|---|
| O(N×M) brute force | Rejected by mission §12 outright. |
| Uniform grid on comparison-triangle bboxes | **Chosen.** Matches existing `CadSurfaceGrid` philosophy (`cadSurfaceInterpolation.ts`: cellSize from span/√T), trivially serializable to worker, deterministic. |
| Adapt `CadSurfaceGrid` (point-location grid) | Rejected: that grid answers point-in-triangle, not bbox overlap; triangle bbox registration differs. A sibling builder is cleaner. |
| R-tree / sweep-line | Rejected: no dependency, more code, same asymptotics for this use. |

Design: `buildTriangleBboxIndex(comparisonTris)` → `Map<cellKey, triIdx[]>` with
cellSize = max(spanX, spanY) / √M (same heuristic as interpolation grid).
For each base triangle, query covered cells, dedupe pair ids via last-seen stamp
array (no giant Set), then **canonicalize pair order** (sort by baseIdx, cmpIdx)
before accumulation so math never depends on cell size/insertion order (§68).
Pair identity `(baseIdx, cmpIdx)` processed at most once by construction (§21).

## 4. Worker architecture (decision: extend surface worker, new service class)

Established pattern is one lazily-created transport per service, two workers per
drawing session (`SurfaceBuildService` + `SurfaceContourService`). Decision:

- New `volume` request/response on the **same** `surfaceWorker.ts` entry via
  `createSurfaceWorkerHandler` (new `handleVolume`, `VOLUME_*` message types,
  `vreq-N` request ids). One surface-analysis worker architecture (§9) — no new
  worker file, no unbounded workers.
- New `src/workers/surfaceVolumeService.ts` mirroring `surfaceContourService.ts`:
  `statusOf`, `requestVolume`, `notifyMeshBuilt`, `complete` with
  latest-generation + cross-drawing guards; `computeVolumeRevision` mismatch ⇒
  discard. Third transport per session follows the contour precedent (§76 risk
  note acknowledged).
- Ownership tuple: `(requestId, drawingId, volumeSurfaceId, volumeRevision)`.
  Late/foreign/stale results never become CURRENT (§10-11). `BUILDING` is
  session-only; worker failure ⇒ `FAILED`, retry possible.
- Manual calculation default (§55): source rebuild never auto-starts volume work;
  explicit Calculate/Recalculate only.
- Quantity-only vs display mode (§80-81): request carries `includeDisplay:
  boolean` (false when style is No Display). Engine streams/integrates and
  discards intermediates unless display requested; quantities must be bitwise
  identical between modes (pinned test).

## 5. Persistence model (relationship only, never derived geometry)

New trailing tables on `CadProject` (key-order-sensitive; surfaces/styles stay
trailing per `cadPersistence.ts` convention):

```ts
CadVolumeSurface { id, name, baseSurfaceId, comparisonSurfaceId,
                   layerId?, styleId?, description? }
CadVolumeSurfaceStyle { id, name, showCut, showFill, showZeroBoundary?,
                        cutColor, fillColor, opacity }
```

- `backfillVolumeSurfaces` / `backfillVolumeSurfaceStyles`: missing ⇒ `[]` /
  deterministic seeds (Cut/Fill, Cut Only, Fill Only, No Display). Additive, no
  schema bump (18G/18H precedent); honest bump only if forced.
- `cloneCadVolumeSurface(s)` deep-clones relationship; **computed overlap
  polygons, cut/fill cache, worker status are never serialized**.
- On load: meshes are UNBUILT ⇒ volume derives `SOURCE_NOT_CURRENT`, never false
  CURRENT (§62). `cachedRevision`-style fields are not trusted in-session anyway
  (scout risk note: session truth = `computeCadSurfaceSourceRevision` + cache hit).
- Mutations (`VOLUME_SURFACE_{CREATE,DELETE,UPDATE_SOURCES,SET_LAYER_STYLE}`,
  `VOLUME_STYLE_{CREATE,DUPLICATE,RENAME,UPDATE,DELETE}` with refcount guard)
  go through `commitLayerProject` (undoable, LOCK-gated).

## 6. Status / revision / cache (all derived, no mutable trusted flags)

- `VolumeSurfaceStatus = UNBUILT | CURRENT | NEEDS_RECALC | BUILDING | FAILED |
  BROKEN_REFERENCE | SOURCE_NOT_CURRENT | NO_OVERLAP`, via pure
  `deriveVolumeSurfaceStatus(project, volume, {building, result})`.
  `CURRENT` ⇔ both source meshes CURRENT **and** cached result revision ==
  current revision. `NO_OVERLAP` ⇔ successful calculation with zero common area
  (distinct from zero-earthwork quantities, §24).
- `computeVolumeSurfaceRevision({baseId, baseRev, cmpId, cmpRev})` → `vrev1:` +
  FNV-1a. Style/layer/name excluded (§6, §61).
- `surfaceVolumeCache.ts`: key `scopeId::volumeId@volumeRevision`, stores summary
  quantities + display regions + diagnostics; current + ≤1 stale (TIN-cache
  precedent; explicit keeper list, NOT lexicographic-key eviction — the contour
  `boundSurface` recency bug is not repeated).

## 7. Math core (pure engine, `src/engine/cad/surfaces/volume/`)

All pure, worker-safe, no React/UI imports:

1. **Local-frame conditioning** (§14): subtract `floor(minX/minY)`-style origin
   from the pair under test (18F `tinBase` philosophy); robust predicates from
   `robust-predicates` via `tinPredicates.ts` wrappers. Translation oracle
   (+2e6/+7e6) pins equivalence.
2. **Triangle-triangle XY overlap** (§13): Sutherland–Hodgman convex clip in the
   local frame. 0 verts ⇒ disjoint; <3 unique / zero-area ⇒ contact only;
   3–6 verts ⇒ overlap polygon. Bbox never counts as overlap.
3. **Per-vertex Z from the owning pair** (§15): Base Z from base-triangle plane,
   Comparison Z from comparison-triangle plane — never a global mesh query
   (shared-edge triangle ambiguity). `delta = cmpZ - baseZ`; **FILL iff Δz>0,
   CUT iff Δz<0**, everywhere (§sign convention).
4. **Delta-plane contract** (§16): both planes linear ⇒ delta linear over the
   overlap polygon. Fan-triangulate deterministically; per fan triangle
   `∫Δz dA = Area·(δ1+δ2+δ3)/3` — exact, no quadrature (§17).
5. **Sign split** (§18): all-≥0 ⇒ fill; all-≤0 ⇒ cut; mixed ⇒ clip by
   `delta≥0` / `delta≤0` half-planes with edge crossing
   `t = δA/(δA−δB)`, interpolating XY + baseZ + cmpZ. Conservation pinned:
   `signed ≈ fill − cut`, `direct unsplit ≈ split`, area conservation (§72-73).
6. **Zero policy** (§19): numerical, not survey: per-vertex
   `zeroDelta = 2·ε·max(1,|baseZ|,|cmpZ|)`-scale (exact constant pinned in code
   + documented; evidence-backed by identical-plane oracle demanding ≈0 without
   erasing shallow real earthwork). Zero-measure regions count toward overlap
   area only (§26). No user tolerance in 18I.
7. **Summation** (§20): Neumaier compensated accumulation per accumulator
   (cut/fill volumes + areas + overlap), deterministic pair order (§39).
8. **Cleanup** (§70): drop consecutive duplicates/zero-length edges; collinear
   collapse only under a justified robust policy; area ≤ true numerical-zero ⇒
   zero measure. Slivers preserved.

No grid/raster/average-end-area fallback anywhere; uncomputable ⇒ FAIL CLOSED
(§94). No `robust-predicates` beyond existing dep; no new dependencies (no GPL).

## 8. Quantities

`CadVolumeResult`: `overlapArea, cutArea, fillArea, cutVolume, fillVolume`
(positive magnitudes), `netVolume = fill − cut`, `averageCutDepth =
cutVolume/cutArea`, `averageFillDepth`, `maxCutDepth, maxFillDepth, minDelta,
maxDelta`, `baseArea, comparisonArea`, stats (pair/polygon counts, timings),
`displayRegions?`. Drawing units throughout (§27, m²/m³ or ft²/ft³, no yd³).

## 9. Toolspace / UI / display

- Toolspace: volume rows under `Surfaces` with `[VOLUME]` type tag; Definition
  (Base/Comparison) + Statistics children; status text never color-only
  (existing `SurfacesNode` pattern).
- Manager: VOLUME SURFACES section — definition/status/layer/style + quantities
  (Overlap/Cut/Fill areas, Cut/Fill/Net volumes, avg/max depths) + source
  statuses. Stale quantities shown only with explicit STALE label (reviewer to
  approve exact treatment, §84).
- Styles Settings page: bounded CRUD (New/Duplicate/Rename/Delete/Edit,
  refcount-guarded delete), fields cut/fill visibility+color, opacity, optional
  zero boundary. Recoloring never recalculates (§61).
- Display: one aggregated SVG path for CUT + one for FILL (opacity), built from
  cached derived regions; layer OFF/FROZEN hides (§46), LOCK blocks definition
  edits. Display suppression/viewport policy allowed for path-D walls —
  quantities untouched (§48). Zero-boundary lines optional display-only (§49).
- No volume contours (§93), no CAD-entity extraction (§98), no paste/composite
  (§95), no TIN edit stack (§96), no LandXML volume (§97).

## 10. Difference inquiry + report

- `Surface Difference` inquiry mirrors the 18H `CadSurfaceInquiryPanel` pattern
  (mode + E/N + viewport pick + `role="status"` answer): Base elev, Comparison
  elev, Δ = C−B, CUT/FILL/BALANCED + depth magnitude. Rule (§85): both source
  TINs CURRENT suffices; aggregate recalc not required — UI labels it live
  source inquiry vs result-cache inquiry honestly.
- Volume Summary CSV mirrors `cadCogoReports` (txt/csv/md + filename builder +
  `unit` per row, explicit m²/m³ or ft²/ft³, source revisions included),
  export-only (not persisted as `cogoComputations`), enabled only for CURRENT.

## 11. Oracles / QA / gates (mission §§28-41, 99-104)

Analytic closed-form oracles (never circular vs WebNet queries): flat ±1 fill/
cut, crossing-plane 0.125/0.125, different-triangulation ≈0, offset×area,
partial overlap, void/concave exclusion, zero-line through vertex/edge, large
translation, shuffled order, sliver, edge-touch ⇒ NO_OVERLAP. Conservation gates
on every success. Browser QA A–K flow + 1k/10k/50k perf (worker/transfer/ingest/
display/first-frame) + optional 100k stress. Reviewer 15-question gate; NO-GO on
3,5,6,7,8,9,10,11. Adjustment math untouched; parity 25/25 required.

## 12. Work split

- Worker A (engine): `volume/` pure modules + analytic oracle tests (§§12-27,
  69-74) + performance bench hooks.
- Worker B (worker/persist): protocol extension + `surfaceVolumeService` +
  cache + `CadVolumeSurface`/styles types + transactions + WNCAD round-trip.
- Worker C (UI/report): Toolspace/manager/styles editors/ribbon/commands +
  display layers + difference inquiry + CSV export + browser QA spec.
- Parent: conservation cross-checks, reviewer gate, PR (unmerged).
