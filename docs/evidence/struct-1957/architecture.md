# STRUCT-195.7 — Architecture evidence (Workstream C: tests + evidence)

## Scope

Break the 4-node TYPE cycle
[`annotation/cadAnnotationAnchors.ts`, `cadCogoTypes.ts`,
`cadProjectLookup.ts`, `cadTypes.ts`] by extracting the pure record shapes
into two type-only leaf modules, with the hub repointing its 2 type imports
to the leaves:

| Leaf (owner) | Exports | Shape |
|---|---|---|
| `src/engine/cad/annotation/cadAnnotationAnchorTypes.ts` (Worker A) | 9 anchor types | 6 interfaces + 3 aliases (table below) |
| `src/engine/cad/cadCogoRecordTypes.ts` (Worker B) | 8 COGO DTOs | 7 interfaces + 1 alias (table below); `CadCogoResult` stays in `cadCogoTypes.ts` |

Hub splice (parent-owned, LANDED in the worktree): `cadTypes.ts` line 1
`import type { CadAnnotationAnchor } from './annotation/cadAnnotationAnchors'`
→ `from './annotation/cadAnnotationAnchorTypes'`, and line 11
`import type { CadCogoComputation } from './cadCogoTypes'`
→ `from './cadCogoRecordTypes'`. Entity usage is unchanged
(`arrowAnchor` / `anchors` / `defPoint1/2: CadAnnotationAnchor`,
`cogoComputations: CadCogoComputation[]`). The original modules keep
legacy re-exports (`export type { … } from './cadAnnotationAnchorTypes'` /
`'./cadCogoRecordTypes'`) plus their runtime functions
(`resolveCadAnnotationAnchor`, `buildCadCogoComputation`, …), so existing
consumers keep compiling with zero value-graph churn.

## Leaf tables

Anchor leaf (Worker A) — all 9 names, exactly (AST-pinned in the suite):

| Export | Kind | Fields / members |
|---|---|---|
| `CadAnnotationFixedAnchor` | interface | `kind: 'fixed'`, `x`, `y` |
| `CadAnnotationSurveyPointAnchor` | interface | `kind: 'survey-point'`, `entityId`, required `fallbackX/Y` |
| `CadAnnotationLineEndpointAnchor` | interface | `kind: 'line-endpoint'`, `entityId`, `endpoint: 'start' \| 'end'`, required `fallbackX/Y` |
| `CadAnnotationArcPointAnchor` | interface | `kind: 'arc-point'`, `entityId`, `point: 'center' \| 'start' \| 'end'`, required `fallbackX/Y` |
| `CadAnnotationBlockInsertionAnchor` | interface | `kind: 'block-insertion'`, `entityId`, required `fallbackX/Y` |
| `CadAnnotationAnchorRef` | alias (4 members) | the 4 entity-bound anchors (excludes `fixed`) |
| `CadAnnotationAnchor` | alias (2 members) | `Fixed \| AnchorRef` |
| `CadAnnotationAnchorPoint` | interface | `x`, `y` |
| `CadAnnotationAnchorResolution` | alias (2 members) | `{ ok: true; x; y }` \| `{ ok: false; fallbackX; fallbackY; reason: 'BROKEN_REFERENCE' }` |

The leaf imports only `type { CadEntityId } from '../cadCorePrimitiveTypes'`.

COGO leaf (Worker B) — all 8 DTOs, exactly (`CadCogoResult` stays behind):

| Export | Kind | Fields / members |
|---|---|---|
| `CadCogoToolKey` | alias (22 members) | 21 tool literals (`INVERSE` … `ALIGNMENT`) + `(string & {})` escape hatch |
| `CadCogoReportRow` | interface | `label`, `value`, `unit?` |
| `CadCogoReportTable` | interface | `title`, `columns: string[]`, `rows: string[][]` |
| `CadCogoReport` | interface | `title`, `summary`, `rows`, `tables?` |
| `CadCogoWarning` | interface | `code`, `message`, `severity: 'info' \| 'warning' \| 'error'` |
| `CadCogoAlternative` | interface | `id`, `label`, `point?: CadDisplayPoint`, `report?` |
| `CadCogoProvenance` | interface | `id`, `toolKey`, `inputs: Record<string, unknown>`, `parameters?`, `sourceEntityIds?`, `sourcePointIds?`, `resultSummary`, `createdAtIso?` |
| `CadCogoComputation` | interface | `id`, `toolKey`, `createdAtIso?`, `provenance`, `report`, `warnings`, `alternatives?`, `created/updated/removedEntityIds` |

The leaf imports only `type { CadEntityId } from './cadCorePrimitiveTypes'`
and `type { CadDisplayPoint } from './cadDisplayTypes'` — never `cadTypes`.

## Baseline graph (measured by Workstream C, recomputed honestly)

Ref: `517de78af6b151d0cd6776ec768d21c2668ea8cf` (`origin/main` at branch
creation). Scope: `src/engine/cad/` + `src/engine/fieldToFinish/`,
measured with `scripts/cadTypeImportGraph.mjs` (`buildGraphs` over
`loadSourcesFromGit('517de78…', …)`; mixed edges count toward both value
and type tallies, same convention as 195.6). Workstream C ran this itself
and recorded the observed values (not copied from any prompt):

- files/nodes: **473**, edges: **2373**, unresolved: **94**
- raw kinds: value **1330**, type **794**, mixed **249**
- tallies: valueEdges **1579** (= 1330 + 249), typeEdges **1043** (= 794 + 249)
- value graph: **4** non-trivial SCCs, largest **7**
- type graph: **7** non-trivial SCCs, largest **5**

Value SCC member lists (filenames):

1. `cadCogoEntityIntersections.ts`, `cadCogoMath.ts`, `cadParcelArcGeometry.ts`, `cadPolylineCourses.ts`, `cadPolylineGeometry.ts`
2. `cadCogoParcelDiagnostics.ts`, `cadCogoParcelGeometry.ts`, `cadCogoParcelGeometrySourceDraft.ts`, `cadCogoParcelLineworkDiagnostics.ts`
3. `cadGeometry.ts`, `cadGeometryArcBuilders.ts`, `cadGeometryArcPrimitives.ts`, `cadGeometryCurveCore.ts`, `cadGeometryCurveIntersections.ts`, `cadGeometryCurves.ts`, `cadGeometryTangentCurve.ts`
4. `cadProjectTransform.ts`, `cadProjectTransformRequest.ts`

Type SCC member lists:

1. `cadAnnotationAnchors.ts`, `cadCogoTypes.ts`, `cadProjectLookup.ts`, `cadTypes.ts` ← the cycle this workstream breaks
2. `cadAnalysisExportScene.ts`, `cadExportScene.ts`, `cadGradingExportScene.ts`, `cadGradingGroupExportScene.ts`, `cadSheetScene.ts`
3. `cadProjectTransform.ts`, `cadProjectTransformRequest.ts`
4. `cadSurfaceEditMesh.ts`, `cadSurfaceEdits.ts`
5. `cadSurfaceRevision.ts`, `cadSurfaces.ts`
6. `dxfBlockExport.ts`, `dxfExportModel.ts`
7. `profileExtraction.ts`, `profileSampling.ts`

Cycle anatomy (baseline): the hub reaches both record modules by type
(`cadTypes` → `cadAnnotationAnchors`, `cadTypes` → `cadCogoTypes`), while
both reach back (`cadAnnotationAnchors` → `cadTypes` for
`CadEntity`/`CadProject` + → `cadProjectLookup`; `cadCogoTypes` →
`cadTypes`; `cadProjectLookup` → `cadTypes`), closing the 4-node loop.

## AFTER graph (measured by Workstream C on the landed worktree)

AFTER = working tree with both leaves + both worker re-export splices +
landed parent hub splice (all present as worktree changes at time of
writing), same scope and method. Every figure below was measured by a
Workstream C re-run (same script, current worktree), not copied:

| Metric | BEFORE (`517de78`) | AFTER (worktree) |
|---|---|---|
| nodes | 473 | **475** (+2: the two leaves) |
| edges | 2373 | **2380** (+7 net) |
| unresolved | 94 | **94** |
| valueEdges (raw value + mixed) | 1330 / 1579 | **1330 / 1579** (delta 0 added / 0 removed, exact pair-membership diff) |
| typeEdges (raw type + mixed) | 794 / 1043 | **801 / 1050** (+7 net edges) |
| value SCC (non-trivial / largest) | 4 / 7 | **4 / 7, same members** |
| type SCC (non-trivial / largest) | 7 / 5 | **6 / 5** (the 4-node cycle is gone) |

Type-edge churn, exact (9 added edges over 7 pairs / 2 removed edges):

Added (all type-only):

1. hub → anchor leaf (`cadTypes.ts` → `cadAnnotationAnchorTypes.ts`)
2. hub → COGO leaf (`cadTypes.ts` → `cadCogoRecordTypes.ts`)
3. old anchors → anchor leaf ×2 (`import type` for local resolver signatures + `export type … from` re-export, same specifier)
4. old COGO → COGO leaf ×2 (same import + re-export pair)
5. anchor leaf → `cadCorePrimitiveTypes`
6. COGO leaf → `cadCorePrimitiveTypes`
7. COGO leaf → `cadDisplayTypes`

Removed (the two severed back-edges):

- hub → `annotation/cadAnnotationAnchors.ts`
- hub → `cadCogoTypes.ts`

SCC membership AFTER: the 4-node component is fully dissolved — all six
touched files are TYPE singletons (`cadAnnotationAnchors.ts`,
`cadAnnotationAnchorTypes.ts`, `cadCogoTypes.ts`, `cadCogoRecordTypes.ts`,
`cadProjectLookup.ts`, `cadTypes.ts`). The remaining 6 type SCCs are the
export-scene 5-node plus the five 2-node pairs, members unchanged. Zero
value-graph delta; no new value SCCs.

Correction note (parent, post-PR): the committed VALUE-membership guard no
longer diffs against a live `loadSourcesFromGit` baseline (CI shallow
checkouts lack the 517de78 object). It pins the baseline as constants:
1561 unique value pairs with sha256
`2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f`
(JSON of sorted repo-relative POSIX pairs) plus 1579 total value|mixed
edges — generated one-time from the real baseline and verified MATCH
before pinning. See validation.md.

## Residual roadmap (out of scope for 195.7, tracked honestly)

- Export-scene 5-node TYPE SCC (`cadAnalysisExportScene`,
  `cadExportScene`, `cadGradingExportScene`, `cadGradingGroupExportScene`,
  `cadSheetScene`) — untouched, largest type component (5).
- Five 2-node TYPE pairs: `cadProjectTransform( Request)`,
  `cadSurfaceEditMesh/cadSurfaceEdits`, `cadSurfaceRevision/cadSurfaces`,
  `dxfBlockExport/dxfExportModel`,
  `profileExtraction/profileSampling` — untouched.
- Value SCCs (4, largest 7) are pre-existing runtime cycles, unchanged by
  this types-only workstream.
