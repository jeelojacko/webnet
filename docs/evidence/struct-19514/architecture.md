# STRUCT-195.14 — Eliminate final CAD geometry runtime cycle: architecture

## Root cause

The VALUE graph over `src/engine/cad` + `src/engine/fieldToFinish` held one
last 7-module nontrivial SCC — the CAD geometry barrel-backedge:

- `src/engine/cad/cadGeometry.ts` (7,254 bytes) mixed broad facade + core:
  `export *` from `./cadGeometryCurves` and `./cadGeometryCurveIntersections`,
  then directly defined 5 geometry interfaces + ~15 primitive runtime
  functions;
- `src/engine/cad/cadGeometryCurves.ts` (169-byte barrel) re-exported the
  four arc/curve leaves (ArcBuilders, ArcPrimitives, CurveCore, TangentCurve);
- all five implementation leaves VALUE/mixed-imported their core
  types/functions (`cadDistance`, `cadPointOnCircle`,
  `cadAngleDegFromCenter`, `cadNormalizeAngleDeg`, `cadSignedSweepDeg`,
  `CadArcDefinition`/`CadWorldPoint`/…) from the broad facade that
  re-exported those same leaves. Every leaf therefore closed a runtime
  barrel-backedge through the facade.

## Fix (primitive core + compatible facade)

Worker A (exclusive: `cadGeometry.ts` + new `cadGeometryPrimitives.ts`):

- New dependency-light `src/engine/cad/cadGeometryPrimitives.ts` (229 lines):
  verbatim move of the entire low-level region (baseline `cadGeometry.ts`
  lines 6–234) — all 5 interfaces, all 15 primitive runtime functions,
  private `normalizeDmsToken`, comments, source order, `1e-12`/`1e-9`
  epsilons, DMS/bearing rounding, `Math.atan2(east, north)` order. Omits only
  the two old facade `export *` lines and the unused
  `import type { CadArcEntity }` (grep-verified unreferenced). Zero imports,
  zero barrel/leaf dependencies — a genuine graph sink.
- `src/engine/cad/cadGeometry.ts` thinned to a 3-line public facade
  (`export *` from Primitives, Curves, CurveIntersections; the two original
  stars keep original relative order). No local declarations, no wrappers —
  direct primitive import and facade export return the SAME function object.

Worker B (exclusive: the five leaves) changed ONLY the module specifier
`'./cadGeometry'` → `'./cadGeometryPrimitives'` (one line per file, binding
names and bodies byte-identical). The `cadIsAngleOnArcSweep` import from
`./cadGeometryCurves` stays; `cadGeometryCurves.ts` is byte-identical. All
app consumers keep importing the facade unchanged.

## Core/facade DAG (post-refactor VALUE edges)

- Primitives → (nothing). Sink.
- 5 leaves → Primitives (mixed, one each). One-way.
- Curves → 4 leaves (value re-export stars). One-way down.
- CurveIntersections → Primitives + Curves. One-way down.
- Facade → Primitives + Curves + CurveIntersections (value stars). Fan-out only.
- No edge points back up: VALUE SCC 0, TYPE SCC 0.

## Graph delta (exact, parent-measured c7987ebc vs integrated head)

Scope `src/engine/cad` + `src/engine/fieldToFinish`, guard canonicalization
(repo-relative POSIX pairs, sorted unique, `JSON.stringify`):

- nodes 482 → 483 (+1: the new core), total edges 2400 → 2400 (net-zero),
  value|mixed 1584 → 1585 (+1), unique VALUE pairs 1566 → 1567 (+1),
  SHA `76838237…` → `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`,
  VALUE 1 SCC/7 nodes → 0/0, TYPE 0 → 0.
- Removed (6): five `mixed|<leaf>|cadGeometry.ts`, one
  `type|cadGeometry.ts|cadTypes.ts`.
- Added (6): five `mixed|<leaf>|cadGeometryPrimitives.ts`, one
  `value|cadGeometry.ts|cadGeometryPrimitives.ts`.

## Public API and behavior parity

- Facade exposes exactly the 51 historical runtime values + 5 types (56
  names); every runtime value is `===`-identical to its direct owner;
  `export *` order is TDZ-safe (core star first). Cold-load verified
  facade/Primitives/Curves/Intersections/tangent-first via `vi.resetModules`.
- Moved bodies: SHA256 `d7167ba2…` over the new core bytes equals the genuine
  baseline tail bytes. Fixed oracles pin all primitives, all eight arc
  builders (CW/CCW, major/minor, continued/tangent), arc start/end/midpoint,
  sweep membership, metrics constructors, segment/circle/arc intersections
  (incl. tangent + coincident fail-closed), external tangent points, offsets,
  parallels, feet, fillet, NaN/degenerate fail-closed, and no input mutation.

## Residual limitations / closeout recommendation

- `git diff --check` clean; `cadGeometryCurves.ts` untouched; 14 user stashes
  preserved; no `manual/` changes.
- This dissolves the LAST nontrivial VALUE SCC in the tracked scope. After
  controller verifies whole-issue acceptance, #195 can be closed by the
  controller in a separate closeout (never `Closes #195` from this phase).
