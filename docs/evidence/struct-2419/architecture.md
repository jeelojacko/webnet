# STRUCT-241.9 Architecture — CAD volume, profile and section type contracts

Baseline: origin/main EXACT `7e4d0b2f2b746d821d25e99f008e97ffac8ba26e` (PR #250 merge, STRUCT-241.8).
Branch: `refactor/issue2419-volume-profile-section-type-leaves`. Refs #241 ONLY
(never Closes/Fixes; #241 stays OPEN; #195/#240 stay CLOSED).
No SCC reduction claimed. Cohesion only: no bug fix, no runtime/behavior change.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadVolumeSurfaceTypes.ts` (92 lines) owns SIX Phase 18I
volume contracts in original source order: `CadVolumeSurface`,
`CadVolumeSurfaceStyle`, `VolumeSurfaceStatus`, `CadVolumeDisplayRegion`,
`CadVolumeStats`, `CadVolumeResult`.

NEW `src/engine/cad/cadProfileSectionTypes.ts` (181 lines) owns TEN Phase 18J
profile plus Phase 18K sample-line/section contracts in original source order:
`CadSurfaceProfile`, `CadProfileStyle`, `CadProfileView`,
`SurfaceProfileStatus`, `CadSectionSurfaceSource`, `CadSampleLine`,
`CadSampleLineGroup`, `CadSectionStyle`, `CadSectionView`, `CadSectionStatus`.

Worker-verified 6/6 + 10/10 declarations byte-identical (Worker A hub-lines
body diff IDENTICAL plus per-declaration JSDoc table; Worker B hub lines
900–1048 vs leaf body 149-line `VERBATIM_MATCH` plus canonical order check;
parent independently re-verified post-integration: both leaf bodies `in hub`
true, combined `hub tail == vol + prof` true), preserving member order,
optionality, discriminants, union branches and inline comments.

Preserved semantics: TIN-to-TIN base/comparison ref-only persisted
relationship plus layer/style display binding (overlap polygons, cut/fill
cache, worker status always derived, never serialized); presentation-only
style cut/fill/showZeroBoundary/opacity; derived never-persisted statuses
(volume `NEEDS_RECALC`, profile `NEEDS_REBUILD`, section 9-branch with
`OUT_OF_RANGE`/`NO_COVERAGE`); displayRegions convex XY polygons
session-only with optional stats counters/computeMs; full `CadVolumeResult`
required fields with signed `netVolume = fill - cut`, positive cut/fill
magnitudes, `vrev1:` revision, area/depth/stat field order; profile
alignment+surface refs vs derived samples, insertion XY / scales / datum
modes / grid intervals; sample-line identity by RAW chainage (never the
display label), skew degrees clockwise from alignment perpendicular, group
bound to exactly one alignment with ordered sampleLines/surfaceSources and
optional `layerId`/`areaComparison`; section view explicit `layerId` for
OFF/FROZEN/LOCK without rebuild plus scale/datum/source IDs and optional
`showCutFill`. Phase 18J/18K provenance JSDoc and the original Phase 18K
section separator comment travel in the profile leaf at the adjacent
position. No algorithm, numeric-unit, or derived-state persistence change.

Both leaves use `import type` ONLY from the low-level
`./cadCorePrimitiveTypes` (volume: `CadLayerId`; profile: `CadEntityId`,
`CadLayerId` — both verified used, no unused imports) and declare only
exported types/interfaces. Each stripped emit is `export {};`. No
cross-import between the leaves, no back-edge to `cadTypes`, no barrel,
transaction, runtime, or UI import.

## Hub splice (parent-owned)

`src/engine/cad/cadTypes.ts` 1048 -> 858 lines: removed ONLY the sixteen
moved definitions plus their immediately preceding/related docs; added one
grouped `import type` + one grouped `export type { ... } from` per leaf with
ALL 16 names (volume block alpha-sorted, profile block alpha-sorted).
Old public `from './cadTypes'` paths and hub-local references (`CadProject`
volume/profile/section tables, `CadDrawingDocument`, survey persisted state)
keep compiling unchanged; no consumer import rewritten.

Kept in hub: all CAD entity/project/drawing persistence types,
`CadSurfacePointSource` + `surfacePointGroupIds`, `CadSurfaceDefinition` and
other surface input/model/edit consumers, `CadSurfaceStatus`/`Purpose`/
`CadSurfaceStyle`, the four explicit/native predicate value exports plus
`surfacePointGroupIds` (all 5 runtime exports), and the untouched `CadEntity`
19-branch and `CadBlockChild` 6-branch union orders. No runtime code edits,
value imports, ordering, serialization, schema, key-order, geometry, volume
numeric, or profile/section generation/display changes. Hub
transpileModule(`removeComments:true`) emit BYTE IDENTICAL to pinned main:
680 bytes, sha256
`3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454`
(independently recomputed before and after).

## Graph delta (measured, not guessed)

- CAD+F2F: 497/2444 -> 499/2450 (+2 nodes / +6 type edges). Per leaf:
  1 out-edge to `cadCorePrimitiveTypes` + hub `import type` + hub
  `export type ... from` (import and re-export counted separately); no
  retired hub edge. VALUE SCC 0, TYPE SCC 0.
- Full src: 1669/7555 -> 1671/7561 (same +2/+6; every 241.9 edge resolves
  inside `src`). VALUE SCC 0, TYPE 7 SCC / 38 nodes.
- VALUE/MIXED membership and both digests IDENTICAL:
  CAD `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`
  (1585 edges / 1567 pairs); full
  `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`
  (4444 edges / 4385 pairs).

## Workers

- Worker A (`worker-volume-2419-A`, commandcode/deepseek/deepseek-v4.1-flash):
  volume leaf only; full content + JSDoc table + AST/order/optionality proof
  + import justification + tsc/emit/portable checks. Did not touch hub.
- Worker B (`worker-profile-section-2419-B`, opencode-go/deepseek-v4.1-flash):
  profile/section leaf only; full content + verbatim diff proof + order +
  import justification + checks. Did not touch hub.
- Parent: baseline lock, hub splice, 103-test suite, guard roll-forwards,
  TODO/docs/PR, independent review loop.
