# STRUCT-241.11 Architecture — CAD annotation + analysis command payload leaves

## Scope

Type-only cohesion extraction under issue #241 (optional maintainability;
Refs #241 only; #241 stays OPEN; #195/#240 CLOSED). No runtime, dispatch,
geometry, rendering, persistence, or numerical change; no SCC reduction
claimed (the 19 inline members were not a separate cycle).

- Baseline: origin/main `0ce916c673bb3fc6878ea2f380ca8ed0dc8266ff` (PR #253 merge).
- Branch: `refactor/issue24111-annotation-analysis-command-types`.
- Hub: `src/engine/cad/cadTransactions.types.ts` (1121 lines, 1121 -> ~995).
- New leaf A: `src/engine/cad/cadTransactionsAnnotationCommandTypes.ts`
  (`CadAnnotationCommandPayload`, 11 variants).
- New leaf B: `src/engine/cad/cadTransactionsAnalysisCommandTypes.ts`
  (`CadAnalysisCommandPayload`, 8 variants).

## What moved (verbatim, source order preserved)

Annotation group — previously inline immediately after
`CadBlockDefinitionCommandPayload`, before the Phase 18U comment:

1. CREATE_MTEXT (x/y/text; textStyleId?/rotationDeg?/attachment?)
2. CREATE_LEADER (arrowAnchor; vertices; text; leaderStyleId?/textStyleId?/textAttachment?)
3. CREATE_DIMENSION (dimensionKind; anchors; orientation?; dimLinePoint; textPoint?; style/override)
4. CREATE_BEARING_LABEL (sourceEntityId; style?; offset?; side?; manualTextOverride?)
5. CREATE_CURVE_LABEL (sourceEntityId; style?; offset?; manualTextOverride?)
6. UPDATE_DIMENSION_PLACEMENT (entityId; dimLinePoint?; textPoint? `| null`)
7. REATTACH_ANNOTATION (entityId; 4 slot literals; index?; anchor? + JSDoc
   "Omitted = convert the slot to a frozen point at its resolved position.")
8. SET_TEXT_OVERRIDE, 9. CLEAR_TEXT_OVERRIDE, 10. SET_ANNOTATION_SCALE,
11. ANNOTATION_COMMIT (project + JSDoc "Validated project from the
    annotation UI op applier (hook-owned)."; label)

Analysis group — previously inline after the Phase 18U comment, before the
Phase 20A FEATURELINE group:

1. ANALYSIS_MAP_CREATE, 2. ANALYSIS_MAP_UPDATE_BANDS,
3. ANALYSIS_MAP_UPDATE_APPEARANCE, 4. ANALYSIS_MAP_DELETE
   (+ JSDoc "True removes the map + every referencing legend atomically."),
5. ANALYSIS_LEGEND_CREATE, 6. ANALYSIS_LEGEND_UPDATE,
7. ANALYSIS_LEGEND_MOVE, 8. ANALYSIS_LEGEND_DELETE.

The Phase 18U two-line section comment moved with the analysis leaf to its
first branch (meaningful adjacency); the hub no longer carries it.

## Dependency ownership (all `import type`, acyclic)

Annotation leaf (4 type-only out-edges):

- `CadEntityId`, `CadTextStyleId` from `./cadCorePrimitiveTypes`
- `CadMTextAttachment`, `CadDimensionKind` from `./cadAnnotationEntityStyleTypes`
- `CadAnnotationAnchor` from `./annotation/cadAnnotationAnchorTypes`
  (low-level TYPE leaf, not the runtime `cadAnnotationAnchors` barrel)
- `CadProject` from `./cadTypes` (one-way; `cadTypes.ts` does not import back)

Analysis leaf (4 type-only out-edges):

- `CadLayerId` from `./cadCorePrimitiveTypes`
- `CadAnalysisBand`, `CadAnalysisLegend`, `CadAnalysisSource` from `./cadAnalysisTypes`
- `CadAnalysisAppearancePatch` from `./cadAnalysisMaps` (declared :172)
- `CadAnalysisLegendPatch` from `./cadAnalysisLegends` (declared :85)

Both runtime patch modules were scrutinized: they import only analysis
types (+ transform), never the new leaf or `cadTransactions*`. Zero
value/mixed edges from either leaf; zero back-edges to the hub.

## Hub splice

- Import block: +2 leaf `import type` lines (STRUCT-241.11 comment);
  removed the now-unused `./annotation/cadAnnotationAnchors` import,
  `CadDimensionKind`/`CadMTextAttachment`/`CadTextStyleId` from the
  `./cadTypes` specifier list, and the three analysis source imports
  (`cadAnalysisMaps`, `cadAnalysisLegends`, `cadAnalysisTypes`).
  `CadProject`/`CadEntityId`/`CadLayerId` stay (used by remaining members).
- Union: the 11 inline annotation members replaced by one
  `| CadAnnotationCommandPayload` after `CadBlockDefinitionCommandPayload`;
  the Phase 18U comment + 8 inline analysis members replaced by one
  `| CadAnalysisCommandPayload` before the FEATURELINE group.
- `CadCommandKey` untouched (248 literals / 241 unique / 7 legacy duplicate
  BLOCK keys; raw slice SHA `4ff8cd4a…1502` identical to STRUCT-241.2).
- AST: top-level 133 -> 116 (-17 = 19 inline removed, 2 refs added);
  inline 101 -> 82; refs 25 -> 27; intersections 7; flattened effective
  members stay exactly 168 in the original order.
- Stripped TS emit (`ts.transpileModule`, `removeComments`): hub
  `export {};` byte-identical to baseline (10 B, SHA `2e29cd9a…bf47c`);
  both leaves emit inert `export {};`.

## Graph deltas (`scripts/cadTypeImportGraph.mjs`)

- CAD+FieldToFinish: 501/2459 -> 503/2465 (+2/+6 = +10 new type edges:
  2 hub imports + 8 leaf out-edges; -4 retired hub edges to the anchor
  barrel + analysis maps/legends/types). VALUE/TYPE SCC 0/0.
  VALUE|mixed digest identical: 1585 edges / 1567 pairs,
  SHA `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`.
- Full `src`: 1673/7570 -> 1675/7576 (+2/+6, all inside `src`).
  VALUE 0 SCC; TYPE 7 SCC / 38 nodes unchanged.
  VALUE|mixed digest identical: 4444 edges / 4385 pairs,
  SHA `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`.

## Guard roll-forward (narrow, no weakening)

- 9 hardcoded count pins (2412-2419 + 2415): 501->503, 2459->2465,
  1673->1675, 7570->7576 with per-file 241.11 delta comments.
- Additive-constant guards 19511/19512/19514: +`STRUCT_24111_ADDED_NODES=2` /
  `STRUCT_24111_ADDED_EDGES=6` with measured-delta comments.
- 2411 + 2412 helpers learn the two new aliases (flatten stays 168);
  syntactic counts rolled to 116/82/27/7; 2412 splice sentinel now expects
  the ANN/ANL refs ahead of the FEATURELINE inline member.
- 2415 incoming-edge pin for `cadAnnotationEntityStyleTypes` gains the new
  command-leaf type edge. All other pins (key SHA, digests, SCC) unchanged.

## Risks

- `CadProject` keeps a TYPE edge from the annotation leaf into `cadTypes`;
  one-way only, verified no reverse edge. If `cadTypes` ever imports the
  annotation command leaf, a TYPE cycle forms — the 241.11 graph pins would
  catch it (leaf allowlist + acyclicity).
- `CadCommandKey` order keeps the historical analysis-inside-VOLUME_STYLE
  and annotation-after-BLOCK positions; the 241.11 suite pins both runs.
