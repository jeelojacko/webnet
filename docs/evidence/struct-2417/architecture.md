# STRUCT-241.7 Architecture — CAD parcel-layout and grip/snap type contracts

Baseline: origin/main EXACT `cbc130247d61e3f2aed7f92e1c2204c59bb5c38f` (PR #248 merge, STRUCT-241.6).
Branch: `refactor/issue2417-cad-layout-grip-snap-types`. Refs #241 ONLY
(never Closes/Fixes; #241 stays OPEN; #195/#240 stay CLOSED).
No SCC reduction claimed. Cohesion only: no bug fix, no runtime/behavior change.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadParcelLayoutTypes.ts` (65 lines) owns FIVE
parcel-layout contracts in original source order:
`CadParcelLayoutSolutionPreference`, `CadParcelLayoutAutomaticMode`,
`CadParcelLayoutRemainderDistribution`, `CadParcelLayoutSettings`,
`CadParcelLayoutUiState`.

NEW `src/engine/cad/cadGripSnapTypes.ts` (122 lines) owns SIX grip/snap
contracts in original source order: `CadGripHandleKind`, `CadGripHandle`,
`CadSnapKind`, `CadSnapCandidate`, `CadSnapLock`,
`CadSnapConstructionContext`.

Worker-verified 5/5 + 6/6 declarations verbatim (Worker A diff proof on the
hub 517-557 region; Worker B diff proof on the hub 559-650 region;
parent re-verified post-integration via python diff: PAR_MATCH True,
GRIP_MATCH True), preserving frontage/area/width/depth constraints,
auto/single_preview/fill_parent meanings, remainder preferences, UI
dock/float position/size, nullable `activeParentParcelId` /
`activeFrontageEntityId`, optional `activeFrontageParcelSegmentIds`, the
complete grip-kind union with its inline Phase C3 polyline-insert JSDoc in
position, the snap-kind literal order, optional `vertexIndex`/`courseIndex`,
`computedScale`, `viewportGeneration`, `compoundKinds`, `guideSegments`,
`lockGuidePoint`, `tangentSeedArcSegmentId`, `scopeSeedSegmentId`,
`tangentSeedPoint`, `lockedSnap` including nullable fields.
Layout type-only imports: `CadEntityId` (core primitives only). Grip
type-only imports: `CadEntityId` + `CadDisplayPoint`. No cross-import
between the leaves; no `cadTypes`/barrel/runtime/`cadTransactions`
imports; each stripped emit is `export {};` (verified via transpileModule).

## Hub edit (parent-owned, mechanical)

`src/engine/cad/cadTypes.ts` 1440 -> 1340 lines:

1. The 11 moved definitions with attached/inline comments deleted (parcel-
   layout block + grip/snap block); nothing else touched.
2. One grouped `import type` + one grouped `export type` block per leaf
   (5 layout names, 6 grip/snap names), same pattern as STRUCT-241.3-241.6.
3. `CadEntity` 19-union order, `CadBlockChild` 6-union order,
   `CadBlockChildType`, `CadProject`, `CadDrawingDocument`,
   `SurveyCadPersistedState` (keeps `parcelLayout?: CadParcelLayoutUiState`
   on the old path), drawing key-order persistence, MlightcadSpike,
   surface/volume/profile/section/analysis modules, and all runtime type
   guards untouched. No consumer migration: every historic
   `from './cadTypes'` import keeps compiling (tsc clean).

## Regression suite (parent-owned)

NEW `tests/cad_parcel_layout_grip_snap_type_leaves_2417.test.ts` (88 tests):
leaf presence/order, 6 interface shape pins, 4 alias-text pins + 5
union-branch-order pins, grip JSDoc parity (6 markers + 3 position checks),
11 hub re-exports + no leftover originals + type-only leaf imports,
11 bidirectional `expectTypeOf` equalities, CadEntity/CadBlockChild pins,
type-only + emit pins (hub 680 B `37445357…5454` byte-identical, leaves
`export {};`), CAD+F2F + full-src graph pins (+2/+7, digests unchanged),
17 in-memory negative controls, neighbour-suite existence pins.
Portable: no git at test runtime; all baselines transcribed constants.

## Guard roll-forward (parent-owned, counts + comments only)

2412/2413/2414/2415/2416 node/edge pins -> 495/2440 scoped, 1667/7551 full;
2413 hub line-count pin -> 1340 lines; 19511/19512/19514
STRUCT_2417_ADDED_NODES=2 / EDGES=7 constants. No assertion weakened,
deleted, or skipped.

## Recommendation

Next safe optional phase: surface/project type-boundary extraction (the
remaining `cadTypes.ts` ~1340-line hub surface around `CadProject` /
drawing persistence). Not started here.
