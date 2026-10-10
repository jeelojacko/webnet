# STRUCT-241.8 Architecture — CAD TIN provenance and surface-edit type contracts

Baseline: origin/main EXACT `539e87d58d9a3690bd1e69653312ce5ef2b60f8e` (PR #249 merge, STRUCT-241.7).
Branch: `refactor/issue2418-tin-provenance-surface-edit-types`. Refs #241 ONLY
(never Closes/Fixes; #241 stays OPEN; #195/#240 stay CLOSED).
No SCC reduction claimed. Cohesion only: no bug fix, no runtime/behavior change.

## What moved (verbatim, type-only)

NEW `src/engine/cad/cadTinProvenanceTypes.ts` (206 lines) owns ELEVEN
TIN provenance / explicit-payload contracts in original source order:
`LandxmlTinProvenance`, `WebnetBakeTinProvenance`,
`ExplicitFormatTinProvenance`, `WebnetComposeTinProvenance`,
`WebnetGradingBakeTinProvenance`, `WebnetGradingDesignPatchTinProvenance`,
`WebnetGradingGroupBakeTinProvenance`, `CadExplicitTinProvenance`,
`ImportedTinProvenance`, `ImportedTinPayload`, `ExplicitTinPayload`.

NEW `src/engine/cad/cadSurfaceEditTypes.ts` (160 lines) owns FOURTEEN
surface-edit contracts in original source order: `CadSurfaceVertexRef`,
`CadSurfaceEdgeRef`, `CadSurfaceSwapEdgeEdit`, `CadSurfaceAddLineEdit`,
`CadSurfaceDeleteLineEdit`, `CadSurfaceAddPointEdit`,
`CadSurfaceDeletePointEdit`, `CadSurfaceMovePointEdit`,
`CadSurfaceSetElevationEdit`, `CadSurfaceRaiseLowerEdit`,
`CadSurfaceSetElevationsEdit`, `CadSurfaceRaiseLowerVerticesEdit`,
`CadSurfaceMoveVerticesEdit`, `CadSurfaceEdit`.

Worker-verified 11/11 + 14/14 declarations byte-identical (Worker A whole-
region `leaf === header + hubLines[621..822]` plus per-declaration strict
`===`; Worker B whole-region hub lines 875–1027, 4151 bytes, plus per-
declaration char counts; parent independently re-verified post-integration:
PROV BYTE-IDENTICAL true, EDIT BYTE-IDENTICAL true), preserving discriminant
shapes and read-tolerant/write-strict contracts: LandXML `kind` optional on
legacy readers, webnet-bake strict writers, `format:'explicit'` read-only
alias, compose `policy:'overlay-coverage-wins'` + optional `resultDigest`,
grading/group/design-patch `targetKind` additions, `analyticKinds` and
`terminationKinds` canonical orders, `side`/`accuracy`/`cornerMode`/
`includesInterior:true`/`interiorPolicy` literals, optional provenance
`fileName`/`surfaceName`/`sourceId` reader compatibility, the exact 7-variant
`CadExplicitTinProvenance` union order, the `ImportedTinProvenance` /
`ExplicitTinPayload` aliases, `ImportedTinPayload` vertex/face/provenance
arrays, stable ref identity (`source:`/`imported:`/`edit:`, unaddressable
boundary/Steiner), canonicalized edge endpoints, edit `kind` discriminants
and `enabled?` (absent = true), required-z vs XY-only fields, whole-surface
vs selected raise/lower distinction, canonical lexicographic deduped bulk
arrays, and the 11-branch `CadSurfaceEdit` order. Encoded TIN data and
revision serialization untouched.

Both leaves are import-free (zero `import` statements; all referenced names
declared in-leaf plus TS built-ins); no value exports. Each stripped emit is
`export {};` (verified via transpileModule). No cross-import between the
leaves; no `cadTypes`/barrel/runtime/`cadTransactions` imports.

## Hub edit (parent-owned, mechanical)

`src/engine/cad/cadTypes.ts` 1340 -> 1048 lines:

1. The 25 moved definitions with attached JSDoc deleted (provenance block +
   edit block); nothing else touched. One mid-splice repair: the insertion
   anchor briefly consumed the grip-snap export `from` line (caught by the
   edge-multiplicity check 2->1); restored immediately, verified 2 edges.
2. One grouped `import type` + one grouped `export type` block per leaf
   (11 provenance names, 14 edit names, alphabetical), same pattern as
   STRUCT-241.3–241.7.
3. Kept verbatim in hub: runtime `surfacePointGroupIds` and the four runtime
   surface topology predicates (`isExplicitTopologyDefinition`,
   `isExplicitSurfaceDefinition`, `isNativeSurfaceDefinition`,
   `isImportedTinDefinition`); `CadSurfaceDefinition` (`edits?`,
   `importedTin?`, `sourceKind?` + JSON key order/presence rules);
   `CadSurfacePointSource`, `CadSurfaceBreakline(Source)`, `CadSurfaceBoundary`,
   `CadSurfaceBuildOptions`, `CadSurfaceStatus`/`Purpose`, `CadSurface`/styles,
   all volume/profile/section contracts, `CadProject`/`CadDrawingDocument`,
   and all other unrelated families. `CadEntity` 19-union order,
   `CadBlockChild` 6-union order, `CadBlockChildType` untouched. No consumer
   migration: every historic `from './cadTypes'` import keeps compiling
   (tsc clean).

## Regression suite (parent-owned)

NEW `tests/cad_tin_provenance_surface_edit_type_leaves_2418.test.ts`
(127 tests): leaf presence/order, 21 interface shape pins + 2 alias-text pins
+ 2 union-branch-order pins (7-variant provenance, 11-variant edit),
provenance/edit JSDoc parity (10 + 7 markers + policy/ref position checks),
25 hub re-exports + no leftover originals + type-only leaf imports,
25 bidirectional `expectTypeOf` equalities, `CadSurfaceDefinition` + 5 runtime
value-export + unrelated-contract hub pins, CadEntity/CadBlockChild pins,
zero-import/marker-only/type-only pins, hub emit pin, scoped + full graph
pins (+2/+4 each, digests + SCCs unchanged), 20 in-memory negative controls
(each makes a real pin fail) plus a worktree-hygiene check, 12
neighbour-suite existence pins.

## Graphs (measured, not guessed)

- CAD+F2F: 495/2440 -> 497/2444 (+2 nodes / +4 type edges: each leaf 0 out +
  hub import + hub export; no retired hub edge). Full src: 1667/7551 ->
  1669/7555 (same allowlist; every 241.8 edge resolves inside `src`).
- Scoped value/mixed 1585 edges / 1567 pairs digest `0bc9bae1…fcb7` unchanged;
  full value/mixed 4444/4385 digest `415f97f0…2448` unchanged.
- Scoped VALUE/TYPE SCC 0/0; full VALUE 0, TYPE 7 SCC / 38 modules.
- Historical SHAs, exact edge fixtures, graph-negative controls preserved;
  only affected count guards rolled forward (2412/2413/2414/2415/2416/2417
  counts, 2413 hub line count 1048, 19511/19512/19514 delta consts), each with
  a documented 241.8 allowlist. No weakening/deletion/skip.

## Risks

- Mechanical risk only: 25 declarations moved; byte-identity proven three
  ways (workers + parent + 127-test suite with 20 failing-if-weakened
  negative controls plus a worktree-hygiene check). No semantic change possible: hub emit byte-identical,
  tsc clean, all neighbour suites green.
- One splice slip (grip-snap export `from`) occurred and was caught by the
  multiplicity check before any commit; repaired and re-verified (edge counts
  + tsc + emit + full suite).
