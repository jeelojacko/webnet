# Phase 20F — Grading target distance/elevation validation (numerical oracles)

Branch: `feat/cad-grading-distance-elevation` (implementation in the working
tree, uncommitted). Oracle suite:
`tests/cad_grading_distance_elevation_oracles_20f.test.ts` (10 tests). All
figures below are asserted in that suite against the real engine seams
(`solveAnalyticGradingChord`, `computeGradingFromSnapshots`,
`computeGradingGroupFromSnapshots`, `linearizeGradingArc`).

## Oracle table

| # | Scenario | Input | Expected | Observed |
|---|---|---|---|---|
| A | Distance level source | `(0,0,100)→(100,0,100)` right `D=20 g=−0.5` | limit offset 20, elev 90, plan area 2000, EXACT | limit `(0,−20,90)→(100,−20,90)`, area 2000, EXACT |
| B | Distance sloped source | `(0,0,100)→(100,0,102)` right `D=20 g=−0.5` | limit follows grade: elev 90→92 | `(0,−20,90)→(100,−20,92)` |
| C | Elevation | `Z 100→102`, `E=98 g=−0.1` | `d = 20/40`, limit `Z=98`, plan area 3000 | `d = [20,40]`, both Z=98, area 3000 |
| D | Elevation over-search | same as C, `maxSearchDistance=30` | `MAX_DISTANCE_REACHED`, not clamped | `MAX_DISTANCE_REACHED / GRADING_ELEVATION_BEYOND_SEARCH` |
| E | Wrong direction | source Z=100, `E=98`, positive grade `+0.1` → `d<0` | fail closed `NO_SOLUTION` | `NO_SOLUTION / GRADING_ELEVATION_WRONG_DIRECTION` |
| F | Large coordinates | origin `E≈2 000 000`, `N≈7 000 000` vs local origin | identical solve after re-origin | max component diff `< 1e-6`, identical distances |
| G | Closed flat square | 100×100 flat `Z=10`, outward `D=20 g=−0.5` | outer 140×140, miter `20√2` each, areas 10000/19600/9600 | source 10000, daylight 19600, grading 9600, 4 GAP ties `(±120,±… )`, extent `20√2`; elevation `E=0 g=−0.5` equivalent |
| H | Arc convergence | concentric arc `R=100`, sweep 90°, `D=20`, coarse/med/fine | subdivisions monotone, source on arc, offset `R±D` monotone, no branch jumps | subdiv 6→18→56; source radius error `<1e-9`; outward err 0.143→0.016→0.002 m, inward 0.214→0.024→0.002 m; `d≡20`, Z≡10, `CURVE_APPROXIMATED` |
| I | Determinism | repeat chord + closed-group calc | identical digest | sha256(JSON) equal across runs |

## Test inventory (20F)

| Suite | Tests | Focus |
|---|---:|---|
| `tests/cad_grading_analytic_20f.test.ts` | 13 | termination helpers, authoring, dispatcher routing, snapshot compute, revision, resolve |
| `tests/cad_grading_distance_elevation_20f.test.ts` | 13 | persistence, legacy bytes, kind switch in one undo, bake provenance, transform scaling |
| `tests/cad_grading_group_analytic_20f.test.ts` | 14 | closed analytic pad geometry, corner family gate, group revision, design patch |
| `tests/cad_grading_distance_elevation_oracles_20f.test.ts` | 10 | numerical oracles A–I above |

All 50 pass on the agent tier (`--config vitest.agent.config.ts`).

## Fail-closed coverage asserted

- `MAX_DISTANCE_REACHED` for distance beyond search and for elevation beyond
  search (never a clamp).
- `GRADING_ELEVATION_WRONG_DIRECTION` for a non-positive offset.
- Machine-zero elevation grade and non-finite/missing fields rejected by
  authoring and by the persistence sanitizers.
- Analytic group corner mismatch (`GRADING_ANALYTIC_CORNER_Z`) and parallel
  limit lines (`GRADING_ANALYTIC_CORNER_PARALLEL`) fail the group closed.
- Mixed termination families rejected at authoring.
