# Phase 18K §2 — Cross-Section / Sample-Line Architecture Audit

Baseline: `origin/main 5700cd80863e433e87569844751ed42985de799f` (PR #100 merge; verified `git rev-parse HEAD` matches).
Branch: `feat/cad-cross-sections-sample-lines` (clean, only `TODO.md` modified at audit time).

## 1. Production Sample Line / Cross Section subsystem: confirmed ABSENT

`ffgrep` for `sample.?line|cross.?section|SampleLine|CrossSection` (case-smart) returns **zero**
production hits in `src/` or `tests/`:

- Only `TODO.md:1` (this phase's placeholder) and `docs/CURRENT_BEHAVIOR.md:490` (18J history prose).
- `graft/` hits are unrelated (ellipsoid SVG cross-sections, test helpers).
- Toolspace (`src/cad-app/shell/CadToolspace.tsx:215-216`) carries only
  `SurfaceProfilesNode` + `ProfileViewsNode` in the Survey tab — **no Alignments node**.
- Ribbon (`src/cad-app/shell/CadRibbon.tsx:186/188`) carries only
  `Create Surface Profile` / `Create Profile View` in the Profile group — no sample/section keys.
- Command registry (`src/cad-app/shell/cadCommandRegistry.ts:144/288`) carries only
  `PROFILE*` actions (`PROFILECREATE`, `PROFILEVIEW`, …) — no `SAMPLE*`/`SECTION*` verbs.
- Doc-schema project keys (`src/engine/cad/cadTypes.ts:461-474`) end at
  `surfaces/surfaceStyles/volumeSurfaces/volumeSurfaceStyles/surfaceProfiles/profileViews/profileStyles`
  then `entities` — no sample-line / section tables.

Conclusion: 18K builds a first-class subsystem from scratch; nothing to migrate or backfill.

## 2. Alignment station / tangent contract (reuse, never re-implement)

- `CadAlignmentEntity` (`src/engine/cad/cadTypes.ts:306-312`): `type:'alignment'`,
  `name`, `elements: CadAlignmentElement[]`, `startStation`, `stationEquations?`.
- Elements (`cadTypes.ts:277-293`): `line {start,end}` | `arc {center,radius,startAngleDeg,endAngleDeg}`
  (+ optional `sourceEntityId`). Station equations (`cadTypes.ts:295-299`):
  `{backStation, aheadStation, rawStation?}`.
- **Raw chainage = `startStation` + cumulative element length** (continuous, geometry truth).
  Display station = raw + cumulative equation delta, exactly at an equation → `aheadStation`;
  inside `(backStation, aheadStation)` → `null` (fail-closed, never guessed).
  Authority: `cadAlignmentRawStationToDisplayStation` /
  `cadAlignmentDisplayStationToRawStation` (`src/engine/cad/cadAlignmentStationing.ts`),
  `cadAlignmentEndStation`, `formatCadStation` (the ONE formatter).
- `cadBuildAlignmentStationPoints` (`src/engine/cad/cadAlignment.ts:288-339`): interval
  stationing over display stations, honours includeStart/includeEnd.
- **Tangent contract: NO tangent-at-station helper exists** in `src/engine/cad/`. Sample-line
  direction MUST derive from the two points returned by the offset helper below
  (centre ± small along-alignment delta), not from a new tangent API. Do not invent one in 18K
  engine scope; if needed later it belongs in `cadAlignment.ts` next to the offset helper.
- **NO exported element-boundary policy** exists; boundary handling is inline in
  `walkLine` (`src/engine/cad/profiles/profileSampling.ts`). Section extraction reuses the
  walker rather than exporting a new boundary API.

## 3. Positive-left offset contract (section geometry foundation)

- `cadPointAtAlignmentStationOffset` (`src/engine/cad/cadAlignment.ts:98-194`) is the single
  authority for cross-section endpoints:
  - Line elements: `leftNormal = (-dy/L, +dx/L)`; `point = onLine + leftNormal * offset`.
  - Arc elements: `radialDistance = radius ∓ offset` (sign follows sweep direction).
  - Takes a **display** station (converts via `cadAlignmentDisplayStationToRawStation` first).
- **Contract: positive offset = LEFT of increasing chainage; negative = RIGHT.**
  Sample lines are therefore `station ± {leftWidth, rightWidth}` mapped through this helper;
  section chainage increases left→right on screen when viewed in chainage-increasing direction.
- Reuse for: sample-line endpoints, section-view datum placement, inquiry projection
  (`cadProjectPointToAlignment` in the same file returns `{station, offset}` with the same sign).

## 4. Reusable 18J straight-line / TIN extraction logic

All paths below are `src/engine/cad/profiles/` (engine-only, pure + deterministic):

- `extractSurfaceProfile` (`profileExtraction.ts:84-143`): orchestrator over alignment elements;
  emits `ProfileSampleEventKind` = `edge-crossing | vertex | boundary-entry | boundary-exit |
  void-entry | void-exit | plane-break`. Raw chainage is the parameter; display station is
  labels-only (never inverted). Boundaries terminate segments; voids create gaps (never bridged).
- `candidateTriangles` + `locateProfileElevation` (`profileMeshLocate.ts`): uniform-grid
  candidate set (sorted — triangle order never affects output) + barycentric plane values.
  Shared with extraction and inquiry from here; never re-implemented per caller.
- `lineEvents` / `walkLine` (`profileSampling.ts`): topology-exact line walker — TIN
  edge-crossing events, Z linear in chainage within one triangle. **`walkArc` is NOT needed
  for sections** (sample lines are straight centrelines); section extraction calls only the
  line path.
- `PROFILE_ARC_VERTICAL_TOLERANCE = 0.001` (`profileExtraction.ts`): arc display-approximation
  only — irrelevant to sections, cited so reviewers know it is deliberately not reused.
- Large-coordinate conditioning: `buildTinBase` (`src/engine/cad/tin/tinBase.ts`) subtracts
  `floor(minX/minY)` origin before Delaunay; section code works in world XY and inherits this.
- Query index: `CadSurfaceGrid {minX,minY,cellSize,cells}` (`src/engine/cad/cadSurfaces.ts:99-104`).
  Session mesh: `CachedSurfaceMesh` (`src/engine/cad/cadSurfaceCache.ts:18-28`)
  `{revision, points, triangles, stats, grid, adjacency, edgeKinds}`, scoped per document/session.

## 5. Current civil-view rendering utilities (what Section View copies)

- `resolveProfileViewDatum` (`src/engine/cad/cadProfileView.ts:52-60`) + 
  `buildProfileViewDisplayLayers` (`cadProfileView.ts:62-184`): CURRENT-only aggregated SVG
  (grid + one path per profile segment set + equation markers + bounded labels, `maxLabels`
  default 200). Section View mirrors this adapter shape (own datum + grid + one path per
  section trace) rather than generalising it.
- Render: `renderProfileViewLayers` (`src/components/surveyCad/SurveyCadPreviewProfiles.tsx:12-98`):
  one grid path + one path per member + markers + labels per view; clicks select the VIEW object.
- Snapshot: `src/cad-app/shell/cadProfileSnapshot.ts` (pure derivation over drawing + session
  caches; mutations via undoable `PROFILE_*` commands). Editors:
  `CadProfileViewSettings` / `CadProfileStyleEditor` / `CadProfileManager` /
  `CadProfileInquiryPanel` (manager-first pattern; section UI follows it).
- Layer/visibility pattern to copy: OFF/FROZEN hides display without rebuild; LOCK blocks edits
  (`isProfileDisplayVisible` / `isProfileLayerLocked` in `src/engine/cad/cadProfileTypes.ts`).

## 6. Candidate Sample Line Group ownership

Proposed (no code yet — audit-level contract for the 18K engine slice):

- **Drawing-owned table** (sibling of `surfaceProfiles`): `sampleLineGroups?: CadSampleLineGroup[]`,
  one alignment per group (`alignmentEntityId`), ordered `stationIds`/`sampleLines`
  (each: `{station, leftWidth, rightWidth}` + name). Trailing position in `CadProject`
  (after `profileStyles`, before `entities`) preserves key-order-sensitive signatures.
- Definitions persist; derived section geometry never persists (mirrors
  `CadSurfaceProfile` `src/engine/cad/cadTypes.ts:806-814`: alignment + surface refs only).
- Undoable `SAMPLE_*` transactions mirror `cadTransactionsProfileCommands.ts`; clone/sanitize
  extend `src/engine/cad/cadPersistence.ts:146-200` / `:249-293` and
  `src/engine/cad/cadDrawingFile.ts` (serialize/parse/sanitize/migrate) exactly as 18J did.

## 7. Section derivation / cache model (mirrors 18J, new key)

- Revision: `prev1:` FNV-1a over canonical sample-line geometry (group id + ordered
  station/width digests via `canonicalNum`) + source surface `srev1`
  (mirror `computeSurfaceProfileRevision` in `src/engine/cad/cadProfileRevision.ts`;
  surface side `computeCadSurfaceSourceRevision` in `src/engine/cad/cadSurfaceRevision.ts`
  (`srev1:`)). Display intent (colors, section-view scales) excluded by construction.
- Cache: scoped `scopeId::groupId@revision` keeper ≤ 2 (current + ≤1 stale), explicit
  insertion-order eviction (mirror `createCadProfileCache` in `src/engine/cad/profileCache.ts`).
  Session-only; invalidate on group delete or drawing switch; stale rejected on apply.
- Status: derived-only enum mirroring `deriveSurfaceProfileStatus`
  (`src/engine/cad/cadProfileStatus.ts`):
  `UNBUILT / CURRENT / NEEDS_REBUILD / BUILDING / FAILED / BROKEN_REFERENCE /
  SOURCE_NOT_CURRENT / NO_OVERLAP`. Never persisted.
- Service: `src/workers/surfaceProfileService.ts` pattern — `(drawingId, profileId, revision,
  requestId)` ownership, `notifyMeshBuilt`, `notifyAlignmentChanged`, `supersede (:326-336)`.
  Section service adds `notifySampleGroupChanged` on the same shape.

## 8. Worker batching strategy (GO-level requirement)

- Current single-profile path: ops `build | contours | volume | profile | cancel`
  (`src/workers/surfaceWorkerHandler.ts`); `SurfaceProfileRequest` (`:198-209`) carries one
  flat-array mesh snapshot; `handleProfile` (`:548-602`) latest-wins on
  `profileId@profileRevision`; client `deriveProfile` (`src/workers/surfaceWorkerClient.ts:406-429`).
- 18K batch rule: **send each source mesh ONCE + an array of sample-line geometries** in one
  `sections` request (`{groupId, groupRevision, surfaceRevision, mesh, lines: [{station,
  leftWidth, rightWidth, lineRevision}]}`); the handler loops the line walker over the single
  materialised mesh and posts one `sections-success` with per-line results. This bounds
  structured-clone cost to O(mesh) per batch instead of O(mesh × lines) and is a GO gate for
  the worker slice — a per-line request loop is not acceptable.
- Ownership key becomes `groupId@groupRevision`; per-line revisions ride inside the payload
  for cache apply. Cancel/cross-drawing/supersede semantics unchanged.

## 9. Section View persistence

- New drawing-owned `sectionViews?: CadSectionView[]` (sibling of `profileViews`):
  `{id, name, sampleGroupId, sectionIds, insertionX/Y, width/height, horizontalScale,
  verticalExaggeration, datumElevation/datumMode/datumStep, grid intervals, styleId?, layerId}`.
- **`CadProfileView` (`cadTypes.ts:831-849`) carries NO `layerId`** (resolves via
  `resolveProfileLayerId` at build time) — **the section view MUST add one** so sections
  honour OFF/FROZEN/LOCK per view without a rebuild.
- Persist view settings only — never section sample arrays, statuses, or derived paths.
  Reopen → `UNBUILT`, never false CURRENT (mirror `clearProfileCacheOnLoad`).

## 10. Cross-sectional area math (scope guard)

- Pairwise **piecewise-linear overlay** between two section traces (e.g. existing vs design)
  sharing one sample line: intersect segment pairs, insert **exact zero-crossings**, integrate
  cut/fill trapezoids per sub-segment. Deterministic vertex order; no resampling grid.
- Explicitly OUT: end-area / average-end-area / prismoidal **volumes** — 18K reports per-section
  cut/fill areas only. Volume-from-sections is a later phase; no volume tables or registry verbs.
- Gaps (void/boundary, §4) contribute zero area and break the overlay locally; diagnostics
  name the station interval.

## 11. Expected performance scale

Extraction is O(lines × segments × candidate-triangles); batching (§8) removes the mesh-copy
term so cost ≈ one grid build + N line walks:

| TIN \ lines | 10 | 100 | 500 |
| --- | --- | --- | --- |
| 1k | trivial (<100 ms) | trivial | fast (grid dominates) |
| 10k | trivial | fast | moderate (500 walks × ~10 events) |
| 50k | fast | **realistic design pair** (corridor surface × 100 sections) | heavy but bounded (worker batch, progress per line) |
| 100k | fast | **realistic design pair** (large site × 100 sections) | stress (evidence tier only, never agent tier) |

Realistic GO pairs: **50k×100 and 100k×100** must complete in-worker without jank (bounded
labels, aggregated paths per §5). 500-line cases are soak/evidence campaigns under
`tests/evidence/` (per `scripts/testTiers.ts`), never in the agent tier.
