# Phase 20H — mixed-analytic grading-group validation record

Every mission oracle and its actual observed result. Numbers are the exact
values asserted by the tests; the tests are the authority.

- Suites:
  - `tests/cad_grading_mixed_analytic_oracles_20h.test.ts` (§16–19)
  - `tests/cad_grading_mixed_analytic_groups_20h.test.ts` (compat / authoring / persist / provenance / status)
  - `tests/cad_grading_mixed_analytic_persist_20h.test.ts` (round-trip / sanitization)
  - `tests/cad_grading_analytic_validation_20h.test.ts` (authority / overflow / §21 E–J)
  - `tests/cad_grading_mixed_analytic_ui_20h.test.tsx` (§21 UI surface)
- Result: all five suites green on the 20H engine + UI (`553/553` across the
  full `tests/cad_grading*` set, including the 3 legacy 20G assertions updated
  for the domain change; 40 Phase 20G legacy revision pins byte-identical).

## §16 — two-line corner oracle

| expected | actual |
|---|---|
| line1 origin `(0,-20,90)` dir `(1,0,0)` | `{ ox:0, oy:-20, oz:90, dx:1, dy:0, dz:0 }` |
| line2 origin `(40,0,90)` dir `(0,1,0)` | `{ ox:40, oy:0, oz:90, dx:0, dy:1, dz:0 }` |
| tie `(40,-20,90)` | `(40,-20,90)` |
| extent `sqrt(2000) = 44.721359549995796` | `44.721359549995796` |
| absolute-Elevation `E=90` variant | identical tie + extent |

## §17 — open two-course mixed group

Expected: `CURRENT`, tie `(40,-20,90)`, projections `20/40`, source lengths
`0/0/0`, TIN counts zero, non-empty mesh, deterministic.

Actual (`computeGradingGroupFromSnapshots`, members `(-100,0,100)→(0,0,100)`
+ `(0,0,100)→(0,100,100)`, Distance then Relative, side right, open):

- `corners = 1`, `tiePointXyz = [40,-20,90]`, `miterExtent = 44.721359549995796`
- `minProjectionDistance = 20`, `maxProjectionDistance = 40`
- `cutSourceLength = fillSourceLength = tiedSourceLength = 0`
- `candidateTriangleCount = intersectionSegmentCount = multipleSolutionCount = 0`
- mesh points/triangles non-empty, `diagnostics = []`
- repeat digest identical

## §18 — closed 100×100 mixed pad vs all-Distance control

Expected: `d = 20`, limit Z = 0 on every course; source `10000`, outer `19600`,
shell `9600`; bounds `-20..120`; four GAP corners extent `20√2`; ties
`(120,-20,0)/(120,120,0)/(-20,120,0)/(-20,-20,0)`; full equivalence vs the
all-Distance control.

Actual:

- limit Z min/max `0`, projection `20–20`
- pad `gradingPlanArea = 9600`, outer bounds `-20..120` in X and Y
- `corners = 4`, every `classification = 'GAP'`, `miterExtent = 28.284271247461902`
- ties exactly the four above
- control equivalence: identical `gradingMesh.points/triangles`,
  `daylightPoints`, tie set, miter extents, plan/3D areas, all projection
  stats, diagnostics, accuracy, and full sha-256 digest

## §19 — incompatible-Z corner

Expected: `Δ=-12` → failure `CORNER_NO_SOLUTION / GRADING_ANALYTIC_CORNER_Z`.

Actual: `{ ok:false, code:'CORNER_NO_SOLUTION', detail:'GRADING_ANALYTIC_CORNER_Z' }`.

## §20 — cross-domain gate

| case | expected | actual |
|---|---|---|
| compute Fixed + Distance | `MEMBER_NO_SOLUTION / GRADING_GROUP_MIXED_TERMINATION_DOMAIN` before solve | exact (all three directions tested) |
| authoring surface default + analytic override | rejected | `ok:false` |
| authoring analytic default + surface override | rejected | `ok:false` |
| persist drop (surface default, `REL` sibling + `FIXED`) | only `FIXED` dropped, `REL` kept | `dropped=[{ref:'c>d',reason:'incompatible-domain'}]`, `REL` survives |
| surface fixed/cut-fill | still valid | `validateGroupTerminationDomainCriteria(FIXED,[CUTFILL])` = `null` |

## §21 — hardening / compatibility / determinism

| id | mission case | expected | actual |
|---|---|---|---|
| A | Distance↔Elevation valid corner | solves | `solveAnalyticCorner` returns a miter; §18 pad all-equal |
| B | Elevation↔Relative valid | solves | arc-adjacent mixed (`ELEV`×`REL`) computes `CURVE_APPROXIMATED` |
| C | different grades same limit use real directions | limit line uses the shared resolver | `analyticTerminalLine` returns the resolver-derived `d`/`limitZ` |
| D | over-search override `d > max` | fail closed, unclamped | `MAX_DISTANCE_REACHED` (no clamp) |
| E | wrong-sign override | rejected + sanitized + kernel defense | authoring rejects, sanitize drops `invalid-criterion`, chord/worker fail closed |
| F | distance overflow finite inputs | fail before geometry | `resolveAnalyticCriterionAt` → `GRADING_BAD_CRITERION`; terminal line `null`; chord/worker `ok:false` |
| G | large coords `E≈2M / N≈7M` | within `1e-6` | tie XY/Z offsets `< 1e-6`, extent equal to 9 dp |
| H | arc-adjacent mixed stable | stable + deterministic | computes, non-empty mesh, repeat digest identical |
| I | determinism digests | identical repeats | §17/§18/§21-H repeat digests identical |
| J | reversed storage invariant | either vertex order matches | override stored `c>b` matches traversal `b>c` |

## UI (§21 surface)

- `allowedMethodsForGroupDomain('analytic')` = `['distance','elevation','relative-elevation']`; `'surface'` = `['surface']`.
- `summarizeGroupMethods([DIST,REL,ELEV])` → label `Mixed Analytic`, detail `Distance + Elevation + Relative Elevation`.
- Composer offers the analytic method select (not a locked single family); surface stays locked.
- Snapshot row: `methodSummary.label = 'Mixed Analytic'`, `analytic = true`,
  `targetName = '—'`, `boundaryLabel = 'Grading Limit'`.
- Properties: `Mixed Analytic`, `Methods: Distance + Elevation + Relative Elevation`, `Domain: Analytic`, `Target: Not applicable`.
- Inquiry: `Termination: Mixed Analytic · Methods: …` + `Target: Not applicable`.
- CSV: `Termination,Mixed Analytic`, `Methods,Distance + Elevation + Relative Elevation`, `Target,Not applicable`.
- Member table: `Distance / Relative Elevation / Elevation / Distance` with `Default/Override/Override/Default`.

## Updated legacy assertions

Three Phase 20G assertions encoded the OLD cross-family rule and were updated
to the same-domain contract (no numeric pins touched):

- `cad_grading_group_relative_elevation_20g` — same-domain analytic mixes now
  accepted; only surface+analytic rejected.
- `cad_grading_relative_elevation_oracles_20g` (M) — same.
- `cad_grading_edit_flows_20f1` — the group domain switch now needs explicit
  confirmation and commits reset-then-edit as two Undo steps.

## Pending / gaps

None. Browser QA ran 9/9 green on the production bundle with 9 bounded
PNGs (see `phase20h-browser-qa.md`); visual review of every new frame is in
`phase20h-visual-qa.md`. Independent reviewer verdict REQUEST CHANGES
(2 majors: fully-overridden default in summary/provenance; visual-verdict
overclaims) — both fixed, fix rounds rerun below.
