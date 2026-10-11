# STRUCT-241.12 Architecture — CAD feature-line + design-surface command payload leaves

## Scope

Type-only cohesion extraction under issue #241 (optional maintainability;
Refs #241 only; #241 stays OPEN; #195/#240 CLOSED). No runtime, dispatch,
geometry, rendering, persistence, DXF/TIN/grading numerics, serialization,
stored CAD data, key order, or history change; no SCC reduction claimed
(the 16 inline members were not a separate cycle).

- Baseline: origin/main `a7e14a6bf0affbd9ad63b8699d69fb643ade2017` (PR #254 merge).
- Branch: `refactor/issue24112-featureline-design-command-types`.
- Hub: `src/engine/cad/cadTransactions.types.ts` (997 lines -> ~875).
- New leaf A: `src/engine/cad/cadTransactionsFeatureLineCommandTypes.ts`
  (`CadFeatureLineCommandPayload`, 11 variants).
- New leaf B: `src/engine/cad/cadTransactionsDesignSurfaceCommandTypes.ts`
  (`CadDesignSurfaceCommandPayload`, 5 variants).

## What moved (verbatim, source order preserved)

Feature-line group — previously inline immediately after
`CadAnalysisCommandPayload`, before the Phase 20B comment:

1. FEATURELINE | FEATURELINECREATE (ONE object, TWO key literals;
   sourceEntityIds; sourceKind 'survey-points'|'chain';
   elevation: FeatureLineElevationMethod; name?/description?/closed?)
2. FEATURELINEELEV | FLSETZ (ONE object, TWO key literals; entityId; z;
   vertexIds?)
3. FLRAISELOWER (entityId; deltaZ; vertexIds?)
4. FLGRADE (entityId; startVertexId?/endVertexId?/startStation?/endStation?;
   gradePercent required; mode? 'set-end-only'|'grade-all-intermediates')
5. FLINTERPOLATE (entityId; startVertexId?/endVertexId?/startStation?/endStation?)
6. FLSURFACEELEV (entityId; surfaceId)
7. FLREVERSE (entityId)
8. FLINQUIRY (entityId; startStation?/endStation?)
9. FLINSERTVERTEX (entityId; courseIndex; station)
10. FLDELETEVERTEX (entityId; vertexIndex)
11. SURFACE_ADD_FEATURE_LINE_BREAKLINE (surfaceId; entityId; name?)

Leading comment `// Phase 20A — 3D feature lines (create + edit + report).`
moved into leaf A adjacent to first member; hub keeps bare
`| CadFeatureLineCommandPayload` at the exact position (241.11 precedent:
hub splices stay bare, section comments live in leaves).

Design-surface group — previously inline after
`CadGradingGroupCommandPayload`, before the Phase C3 comment:

1. SURFPURPOSE (surfaceId; purpose?: CadSurfacePurpose|null;
   JSDoc "Explicit role; null/undefined clears back to legacy neutral.")
2. DESIGNSURFACE (sourceSurfaceId/name/expectedRevision required;
   sessionCurrent?; layerId?; styleId?: string|null; JSDoc: current source
   revision / stale reject, session-owned CURRENT assertion,
   undefined-keep / null-clear)
3. DESIGNAPPLY (targetSurfaceId/targetExpectedRevision/patchSurfaceId/
   patchExpectedRevision required; sessionCurrent?; JSDoc: never
   existing-ground, byte-identical topology-only patch, stale reject)
4. DESIGNVOLUME (baseSurfaceId/comparisonSurfaceId required;
   name?/layerId?/styleId?)
5. DESIGNPATCH (groupId; result: CadGradingGroupResult;
   expectedRevision required; sessionCurrent?/name?/layerId?/
   styleId?: string|null; JSDoc: cached-CURRENT snapshot, undefined vs null)

Leading comment `// Phase 20D Wave-1A — design surface workflow (engine
only).` moved into leaf B; hub keeps bare
`| CadDesignSurfaceCommandPayload` at the exact position.

## Import ownership (all `import type`, acyclic)

- Leaf A: `CadEntityId` <- `./cadCorePrimitiveTypes` (zero-import leaf);
  `FeatureLineElevationMethod` <- `./cadFeatureLineCreate` (same path the
  hub used; that module's deps never reference the new leaf or hub).
- Leaf B: `CadLayerId` <- `./cadCorePrimitiveTypes`;
  `CadSurfacePurpose` <- `./cadSurfaceModelStyleTypes` (direct owning leaf,
  not the `cadTypes` barrel); `CadGradingGroupResult` <-
  `./grading/gradingGroupTypes` (transitive closure verified cycle-free).
- Hub retires exactly three now-unused imports
  (`FeatureLineElevationMethod`, `CadGradingGroupResult`,
  `CadSurfacePurpose` — zero remaining hub occurrences verified);
  `CadEntityId`/`CadLayerId` stay (used elsewhere in hub).
- No cross-leaf imports; no hub/runtime/barrel/value edges; both leaves
  transpile (transpileModule, removeComments:true) to inert `export {};`.

## Union shape pins (measured, never guessed)

- Hub top-level: 116 -> **102** (66 inline / 29 refs / 7 inter; net -14 =
  16 removed + 2 refs). Flattened effective members stay **168** via
  per-member leaf expansion (double-key objects kept whole, no widening).
- `CadCommandKey`: 248 literals / 241 unique / 7 historical block
  duplicates, raw bytes/order/SHA (`4ff8cd4a…1502`) byte-identical.
- Post-union `CadTransaction`/`CadCommandState`/`CadWorkspaceSnapshot`/
  `CadCommandDefinition` block verbatim.

## Graph (measured via scripts/cadTypeImportGraph.mjs)

- Scoped CAD+F2F: 503/2465 -> **505/2470** (+2 nodes, +7 new type edges
  -2 retired hub edges to `cadFeatureLineCreate` + `gradingGroupTypes`);
  VALUE/MIXED digest `0bc9bae1…fcb7` IDENTICAL; VALUE SCC 0, TYPE SCC 0.
- Full src: 1675/7576 -> **1677/7581** (+2/+5); VALUE/MIXED digest
  `415f97f0…97d` IDENTICAL; VALUE SCC 0, TYPE SCC 7/38 cyclic modules.
