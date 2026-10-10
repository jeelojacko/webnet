# STRUCT-195.6 — Architecture evidence (Workstream C: tests + evidence)

## Scope

Extract the 19 grading / grading-group command payload variants from the
`CadCommand` union in `src/engine/cad/cadTransactions.types.ts` into two
type-only leaf modules:

| Leaf (owner) | Export | Variants |
|---|---|---|
| `src/engine/cad/cadTransactionsGradingCommandTypes.ts` (Worker A) | `CadGradingCommandPayload` | 6: `GRADING_CREATE`, `GRADING_DELETE`, `GRADING_EDIT_CRITERIA`, `GRADING_REASSIGN_TARGET`, `GRADINGEXTRACTDAYLIGHT`, `GRADINGBAKE` |
| `src/engine/cad/cadTransactionsGradingGroupCommandTypes.ts` (Worker B) | `CadGradingGroupCommandPayload` | 13: `GROUP_CREATE`, `GROUP_DELETE`, `GROUP_EDIT_CRITERIA`, `GROUP_REASSIGN_TARGET`, `GROUP_EDIT_SPAN`, `GROUP_ADD_COURSE`, `GROUP_REMOVE_END_COURSE`, `GROUP_SET_COURSE_CRITERIA`, `GROUP_RESET_COURSE_CRITERIA`, `GROUP_SET_TRANSITION`, `GROUP_CLEAR_TRANSITION`, `GROUPEXTRACTDAYLIGHT`, `GROUPBAKE` |

Hub splice (parent-owned, LANDED): `CadCommand` keeps
`SURFACE_ADD_FEATURE_LINE_BREAKLINE` inline, then references
`CadGradingCommandPayload` (under the preserved Phase 20B comment), then
`CadGradingGroupCommandPayload` (under the preserved Phase 20C comment),
then `SURFPURPOSE` — in that order; the 19 inline variants were removed
verbatim. Import follow-through: the hub's
`import type { CadGradingResult, GradingCriterion, GradingSide } from
'./grading/gradingTypes'` was removed (no remaining hub use) and the
gradingGroupTypes import narrowed to `import type {
CadGradingGroupResult }` (DESIGNPATCH still uses it).
`CadCommandKey` stays byte-identical (248 ordered literals, pre-existing
duplicates such as `BLOCK_CREATE` kept).

## Baseline graph (measured by Workstream C, reproduced honestly)

Ref: `origin/main` = `68b324ac` (merge of STRUCT-195.5). Scope:
`src/engine/cad/` + `src/engine/fieldToFinish/`, measured with
`scripts/cadTypeImportGraph.mjs` (`buildGraphs` over
`loadSourcesFromGit('68b324ac', …)`; mixed edges count toward both
value and type tallies):

- nodes: **471**, edges: **2367**, unresolved: **94**
- valueEdges: **1579**, typeEdges: **1037**
- value graph: **4** non-trivial SCCs, largest **7**
- type graph: **7** non-trivial SCCs, largest **5**

Value SCC member lists (filenames, components sorted by smallest member):

1. `cadCogoEntityIntersections.ts`, `cadCogoMath.ts`, `cadParcelArcGeometry.ts`, `cadPolylineCourses.ts`, `cadPolylineGeometry.ts`
2. `cadCogoParcelDiagnostics.ts`, `cadCogoParcelGeometry.ts`, `cadCogoParcelGeometrySourceDraft.ts`, `cadCogoParcelLineworkDiagnostics.ts`
3. `cadGeometry.ts`, `cadGeometryArcBuilders.ts`, `cadGeometryArcPrimitives.ts`, `cadGeometryCurveCore.ts`, `cadGeometryCurveIntersections.ts`, `cadGeometryCurves.ts`, `cadGeometryTangentCurve.ts`
4. `cadProjectTransform.ts`, `cadProjectTransformRequest.ts`

Type SCC member lists:

1. `cadAnnotationAnchors.ts`, `cadCogoTypes.ts`, `cadProjectLookup.ts`, `cadTypes.ts`
2. `cadAnalysisExportScene.ts`, `cadExportScene.ts`, `cadGradingExportScene.ts`, `cadGradingGroupExportScene.ts`, `cadSheetScene.ts`
3. `cadProjectTransform.ts`, `cadProjectTransformRequest.ts`
4. `cadSurfaceEditMesh.ts`, `cadSurfaceEdits.ts`
5. `cadSurfaceRevision.ts`, `cadSurfaces.ts`
6. `dxfBlockExport.ts`, `dxfExportModel.ts`
7. `profileExtraction.ts`, `profileSampling.ts`

Workstream C re-ran this measurement itself (same script, same ref) and
reproduced every figure above exactly before writing them down.

## AFTER graph (parent-measured, Workstream C re-verified read-only)

AFTER = working tree with both leaves + landed hub splice, same scope and
method. Parent-reported figures, each confirmed by a read-only
Workstream C re-run (same script, current worktree) before recording:

| Metric | BEFORE (`68b324ac`) | AFTER (working tree) |
|---|---|---|
| nodes | 471 | **473** (+2: the two leaves) |
| edges | 2367 | **2373** (+6 net) |
| unresolved | 94 | **94** |
| valueEdges | 1579 | **1579** (delta 0 added / 0 removed, precise edge-membership diff) |
| typeEdges | 1037 | **1043** (+6 net: +7 added / −1 removed) |
| value SCC (non-trivial / largest) | 4 / 7 | **4 / 7, same members** |
| type SCC (non-trivial / largest) | 7 / 5 | **7 / 5, same members** |

7 added edges — ALL type-only:

1. hub -> grading leaf (`cadTransactionsGradingCommandTypes.ts`)
2. hub -> group leaf (`cadTransactionsGradingGroupCommandTypes.ts`)
3. grading leaf -> `cadCorePrimitiveTypes`
4. grading leaf -> `grading/gradingTypes`
5. group leaf -> `cadCorePrimitiveTypes`
6. group leaf -> `grading/gradingGroupTypes`
7. group leaf -> `grading/gradingTypes`

1 removed edge:

- hub -> `grading/gradingTypes` (re-owned by the grading leaf)

Zero value-graph delta; no new value SCCs; all SCC member lists below
are unchanged AFTER (verified, not assumed).

## No-SCC-reduction honesty

This workstream moves 19 inline `CadCommand` union members into two
type-only aliases. Those members participated in no dependency cycle: the
hub previously reached the grading domain types directly, and the leaves
reach the same targets through type-only edges. The extraction therefore
shrinks the hub file without reducing any SCC (value or type) — the AFTER
measurement above confirms it: value 4 SCC / largest 7 and type 7 SCC /
largest 5, both with identical members, i.e. honestly no reduction. Type-edge churn is exactly
the 7-add/1-remove re-ownership listed above; the value graph is
byte-identical in membership. No CI result is claimed in this document —
see `validation.md` for the explicit Workstream C vs parent split.
