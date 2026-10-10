# STRUCT-195.11 — Architecture: break project-transform runtime + type cycle

## Baseline

- Branch `refactor/issue19511-project-transform-runtime-cycle`, baseline
  `origin/main 78a71ca4d37ccedbbeb80cb96adf742d8dfb0248` (PR #234 merge,
  STRUCT-195.10; exact-head CI 5/5 green, run 38050269407). Issue #195 OPEN.
- Graph scope `src/engine/cad` + `src/engine/fieldToFinish` via
  `scripts/cadTypeImportGraph.mjs` (`buildGraphs` + `tarjanSCC`):
  nodes 480, edges 2392, value|mixed 1579, unique value pairs 1561,
  pair SHA `2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f`
  (guard canonicalization: `relPosix(from)\nrelPosix(to)`, dedup, sort,
  `JSON.stringify`, sha256).
- TYPE: 1 nontrivial SCC / 2 nodes —
  `cadProjectTransform.ts <-> cadProjectTransformRequest.ts`.
- VALUE: 4 nontrivial SCCs / 18 nodes — 7-node geometry group, 5-node
  COGO-arc group, 4-node COGO-parcel group, 2-node projectTransform pair.

## Root cause

- `cadProjectTransform.ts` (~25.7k chars / 663 lines) is the authoritative
  low-level kernel (`applyCadProjectCoordinateTransform`,
  `hasProjectCoordinateTransform`, `projectTransformMixedFrameError`,
  `PROJECT_COORDINATE_TRANSFORM_TOOL_KEY`, `PROJECT_TRANSFORM_*` warnings,
  `CadProjectTransformOptions/Affected/Counts`, gate/preflight/transform
  helpers). Its only link to the request module was a 9-line re-export
  block (lines 97–105) re-exporting 4 request types + 2 request values so
  command/panel/report seams import from one path.
- `cadProjectTransformRequest.ts` (181 lines) solves Helmert/Grid-Ground
  then delegates to the kernel; it imported
  `{ applyCadProjectCoordinateTransform, type ProjectTransformAffectedCounts }`
  from the facade — the back-edge closing both the TYPE and VALUE SCC.
- Note: the phase brief mentioned an `fnv1a` re-export in the kernel; at
  baseline `fnv1a` lives in `cadRevisionHash.ts`, not in the kernel, so
  there was nothing to move.

## Change (1 new module, 2 import/facade edits, no algorithm change)

- NEW `src/engine/cad/cadProjectTransformCore.ts` (658 lines): mechanical
  move of the complete kernel content minus the 9-line request re-export
  block (generated via `sed '97,105d'` + 5-line header; verified byte-exact
  by diff modulo header/blank lines). Same folder, all relative specifiers
  unchanged. Declaration order, defaults, signatures, constants, comments
  preserved. No duplicate definitions.
- `src/engine/cad/cadProjectTransform.ts` (663 lines -> 11): narrow public
  facade — `export * from './cadProjectTransformCore'` + explicit 4-type /
  2-value re-exports from `./cadProjectTransformRequest`. All 17 historical
  public symbols remain reachable from the old path; `export *` plus
  explicit names cannot collide ambiguously (explicit names shadow the star).
- `src/engine/cad/cadProjectTransformRequest.ts`: ONE line changed —
  import source `./cadProjectTransform` -> `./cadProjectTransformCore`;
  execution body byte-identical (`git diff`: 1 insertion / 1 deletion).
- No other consumer needed repointing (`tsc --noEmit` exit 0 across repo):
  commands, report, `cadTransactions.types.ts`, submit/panel seams keep
  importing the facade.

## New DAG

- facade -> core (value, via `export *`) + facade -> request (type + value,
  via explicit re-exports); request -> core (mixed single-clause import);
  core imports NEITHER facade NOR request (statically pinned by tests).
- Import-order safe under both orders (request-first, facade-first):
  no cycles remain, so no TDZ / live-binding hazard; function identity
  (`===`) across facade/core/request pinned by tests.

## Measured graph delta (authorized runtime topology change)

- Nodes 480->481 (+1 = Core), edges 2392->2393 (+1), value|mixed
  1579->1580 (+1), unique value pairs 1561->1562 (+1),
  SHA `2bf1817d…` -> `3d7284dbb0d33d8ba7afaad3dc2c0a7136945e98910ac026eebd03c0fbdc835e`.
- Removed 14 value edges (12 `value` facade->kernel-deps + 1 `mixed`
  facade->cadTransform2D + 1 `mixed` request->facade); added 15
  (1 `value` facade->core + 12 `value` core->kernel-deps + 1 `mixed`
  core->cadTransform2D + 1 `mixed` request->core). Every changed edge is
  incident to {facade, core, request} — the planned relocation, nothing else.
- TYPE 1 SCC/2 nodes -> **0**. VALUE 4 SCC/18 nodes -> **3 SCC/16 nodes**
  (only the 3 pre-existing unrelated Cogo/Geometry groups). Core, facade,
  and Request are all singletons in both graphs.

## Compatibility / parity

- esbuild emit (identical settings) old kernel vs new Core: normalized
  function bodies and constants identical; only delta is the 2 request-value
  re-exports now living behind the facade (same runtime identities).
- Old vs new request emit: identical modulo the import specifier string.
- Behavior: Helmert + Grid/Ground determinism, malformed imported-TIN
  atomic BLOCK with same reason/counts/audit, WNCAD persistence/undo —
  pinned by existing 18R/18R.1 oracles (unchanged) + new 195.11 suite.
  Existing 18R/18R.1 oracles preserved.

## Residual roadmap (#195 stays OPEN)

- Remaining runtime VALUE SCCs: 3 components / 16 nodes, all pre-existing
  and unrelated (geometry 7, cogo-arc 5, parcel-diagnostics 4) — future
  phases. TYPE graph is now fully acyclic (0 nontrivial SCCs).
- Refs #195 (never Closes/Fixes).
