# STRUCT-240.1 — Break surveyCad command-session 3-node TYPE SCC

Branch: `refactor/issue2401-surveycad-command-session-type-cycle`.
Baseline: `origin/main` exact `bf585435abb8f187b609f8098576bd730defc27e` (PR #239 merge, STRUCT-195.15).
Working tree at branch creation: clean; 14 pre-existing user stashes preserved untouched, order intact.
Refs #240 ONLY (no Closes/Fixes). Issue #195 stays CLOSED; #241 stays OPEN untouched.

## 1. Root cause (exact 3-node TYPE SCC, full `src/**` component 8)

- `src/hooks/surveyCad/useSurveyCadCommandTypes.ts` type-imported `CadCurveF1ExtentMode`
  from `./useSurveyCadCurveF1Session`.
- `src/hooks/surveyCad/useSurveyCadCurveF1Session.ts` type-imported `CommandPoint, CommandSession`
  from Types and `CadCommandPreviewState` from Preview.
- `src/hooks/surveyCad/useSurveyCadCommandPreview.ts` type-imported `CommandSession` and
  `CadLineL1SessionState` from Types.
- Backedges form a 3-node TYPE SCC (no VALUE SCC). Only CAD-adjacent TYPE SCC in the repo;
  CAD+Field-to-Finish scope itself was already VALUE 0 / TYPE 0.

## 2. Fix (type-only leaf, minimal cut)

New leaf `src/hooks/surveyCad/useSurveyCadCurveF1ExtentTypes.ts` (only content):
```ts
import type { CadCurveMetricMode } from '../../engine/cad/cadCurveMetricsSolver';

/** Extent metric modes (radius excluded: the radius is carried separately). */
export type CadCurveF1ExtentMode = Exclude<CadCurveMetricMode, 'radius'>;
```
Alias + comment moved verbatim; no runtime exports; no imports from F1/Types/Preview; no barrels.

- `useSurveyCadCommandTypes.ts`: ONE-LINE change — alias import repointed to the leaf.
  Union, fields, exports, all other imports unchanged.
- `useSurveyCadCurveF1Session.ts`: removed inline alias declaration; added
  `import type { CadCurveF1ExtentMode } from './useSurveyCadCurveF1ExtentTypes'` for local uses
  (`CurveF1Extent`, `parseCurveF1ExtentToken` cast) + `export type { CadCurveF1ExtentMode } from
  './useSurveyCadCurveF1ExtentTypes'` at the old position preserving the historic old-path public API
  (`useSurveyCadCurveF1Submit.ts` keeps importing from the session module untouched).
  No function-body, key, parser, preview, or session-shape changes. F1 still type-imports
  `CommandSession` from Types and `CadCommandPreviewState` from Preview — now ONE-WAY.
- `useSurveyCadCommandPreview.ts`: BYTE-IDENTICAL (verified empty `git diff`).

## 3. Graph measurements (`scripts/cadTypeImportGraph.mjs`, no aliases)

BASE at exact `bf585435` (re-measured): full `src/**` 1654 nodes / 7507 edges,
VALUE 0 SCC, TYPE 8 SCC / 41 cyclic nodes; VALUE|mixed 4444 edges, 4385 unique pairs,
SHA256 `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`;
CAD+F2F 483/2400 VALUE 0/0 TYPE 0/0 SHA `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`;
GRAPH_DIRS (+cad-app/blocks) 490/2424 VALUE 0/0 TYPE 0/0.

AFTER (working tree): full `src/**` **1655 nodes / 7510 edges, VALUE 0, TYPE 7 SCC / 38 nodes**
(target trio gone; residual 7 are unrelated non-CAD domains, §5).
VALUE|mixed still **4444 edges / 4385 pairs / SHA `415f97f0…2448` IDENTICAL** (no runtime delta).
CAD+F2F **483/2400 VALUE 0/0 TYPE 0/0 SHA `0bc9bae1…2fcb7` IDENTICAL**;
GRAPH_DIRS **490/2424 0/0 IDENTICAL**. Unresolved full-src 491 (unchanged; `react` dominant).

## 4. Exact edge-delta allowlist (live vs `git show bf585435:src`, multiset compare)

Added (all `type`):
- `useSurveyCadCommandTypes.ts -> useSurveyCadCurveF1ExtentTypes.ts [type] x1`
- `useSurveyCadCurveF1ExtentTypes.ts -> cadCurveMetricsSolver.ts [type] x1`
- `useSurveyCadCurveF1Session.ts -> useSurveyCadCurveF1ExtentTypes.ts [type] x2`
  (value 2 = one `import type` + one `export type ... from` re-export; same pair, both type-only)
Removed:
- `useSurveyCadCommandTypes.ts -> useSurveyCadCurveF1Session.ts [type] x1`
Net: +4/−1 = +3 edges, +1 node (leaf). No VALUE or MIXED edge added/removed anywhere
(full-src VALUE SHA identical). No new unresolved imports. No new cycle (TYPE 8/41 → 7/38).

Runtime-emit stability: `esbuild --format=esm` output of both modified modules is
md5-identical base-vs-work (type-only change erases at emit). Preview module untouched.

## 5. Residual full-src TYPE SCCs (7, all unrelated domains)

16-node project-workflow hub; 10-node adjustment hub; gnssBaseline pair;
gnssMultifile composition/duplicates pair; importUnitProvenance/importers/terrestrialCsv triple;
numericalBackend/sparse pair triple; preanalysisPlanning shared/solveAudit pair.
Zero files under `src/engine/cad`, `fieldToFinish`, `cad-app`, or `src/hooks/surveyCad/*`
in any residual component. Cohesion follow-on #241 untouched.

## 6. Tests

New `tests/cad_surveycad_command_session_type_cycle_2401.test.ts` (8 tests, ~445 ms):
leaf source pin; alias bidirectional equality (leaf ≡ old-path re-export ≡
`Exclude<CadCurveMetricMode,'radius'>`); negative controls (mutated alias admits `'radius'`,
in-memory source mutation breaks exclusion); `CURVE_FROM_END` + `REVERSE_OR_COMPOUND`
`extentMode: CadCurveF1ExtentMode | null` AST pins; import-direction pins (no Types→F1,
leaf purity, historic re-export, never value-imported); curated 5-source in-process graph pin
(trio singletons, zero cyclic) + in-memory revert recreating exactly the 3-node SCC;
oracle-suite presence (`cad_curves_f1_sessions`, `cadCogo/cadCurvesF1.transactions`).
No `git show`/subprocess/network; no full-src scan in-tier (whole-`src` string scan 22 ms only).

Fixed oracles preserved: `tests/cad_curves_f1_sessions.test.ts`,
`tests/cadCogo/cadCurvesF1.transactions.test.ts`, Chromium
`tests-browser/cad-draw-curves-f1.spec.ts` (9/9). No historic 1954/57/58/59/510/511/512/513/514
frozen graph guards touched (out of scope).

## 7. Limitations

"Zero" = zero SCCs among statically analyzable, resolvable internal TS edges
(`cadTypeImportGraph.mjs`): dynamic `import()`/`require()` unparsed; externals
(`react` ×421 etc.) excluded; scoped runs drop cross-scope edges. Whole-repo runtime
guarantee is not claimed. Full-src scan (~13.8 s class) run offline for evidence only,
never inside the agent-tier suite.
