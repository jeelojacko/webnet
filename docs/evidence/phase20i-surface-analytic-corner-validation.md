# Phase 20I — surface↔analytic grading corner: validation

Status: FILLED (evidence-only, zero `src/` change). Branch
`research/phase20i-surface-analytic-corner-feasibility`, baseline
`9dd28c94715daa3583c907224a04652d3ae99cc3` (= PR #137 merge), HEAD == baseline
with an uncommitted evidence-only working tree.

Numbers are produced by the core study
(`scripts/phase20iSurfaceAnalyticCornerCore.ts`,
`scripts/phase20iSurfaceAnalyticCornerStudy.ts`): corpus
`docs/evidence/phase20i/corpus.json` (112 rows, 0 mismatches, sha256
`3189d1cd038b5a76ae19afb1c294a97e7ff5dac5144874475b3c8f85c7d05b42`), plus the
two focused test files (42 tests). Every number below is a script/test run,
not hand-entered. The production contract today is still fail-closed for a
mixed group (`MEMBER_NO_SOLUTION` / `GRADING_GROUP_MIXED_TERMINATION_DOMAIN`).

Duration convention: `extent` is `|T* − V|` of the analytic tie; `xy gap` /
`z gap` are `|surfaceTie − analyticTie|`. `zeroDelta` is the shared 18I floor
(`surfaces/volume/zero.ts:19`), ≈`4·ε·max(1,|Z|)` (≈`8.9e-14` at Z=90/100).

## Oracle index

| § | case | expected (architecture) | actual |
|---|---|---|---|
| A | exact fixed surface ↔ Distance, flat target | common tie `T* = M ∩ La`; target residual 0 | `EXACT_COMMON_TIE` at (40,−20,90), extent 44.721359549995796, gaps 0 |
| B | order reversal (Distance ↔ surface fixed) | same tie `T*` and residual 0 | `EXACT_COMMON_TIE` at (40,20,90), extent 44.721359549995796, gaps 0 |
| C | Elevation limit line | `T*` on the constant-Z line; residual 0 | `EXACT_COMMON_TIE` at (40,−20,90), gaps 0 |
| D | Relative-elevation limit line | `T*` with `Zlimit = Zsrc + Δ`; residual 0 | `EXACT_COMMON_TIE` at (40,−20,90), gaps 0 |
| E | residual mismatch | fail closed `CORNER_HYBRID_TARGET_DISAGREE` (proposed) | `TRANSITION_REQUIRED` (`tie-disagree`), gaps √80 / 2 |
| F | target void under the tie | fail closed `CORNER_TARGET_GAP` | `SURFACE_TARGET_GAP` (`gap-at-V`) |
| G | multi-root / branch (TIN edge graze) | deterministic nearest outward root, stable | 3 roots → `ROOT_POLICY_CONFLICT`; single transverse triangle 1 root exact |
| H | GAP prototype (outside turn) | wedge fan; positive patch area | mesh valid, 2 tris, plan area 800, 3D 859.5241580617239 |
| I | OVERLAP prototype (inside turn) | trim both strips to the miter line once | tie (−40,−20,90); valid tiled-once mesh (9 verts) |
| J | closed square (4 hybrid joints) | mesh validates; plan area finite | 4 exact ties at 20√2 extent; controls agree; freeze fail-closed |
| K | triangulation variants (same plane) | identical `T*` across two triangulations | identical (40,−20,90), xy gaps ≤3.2e-14, z gap 0 |
| L | arc ladder (mixed arc-adjacent) | `CURVE_APPROXIMATED`, `d` constant | monotone convergence, no branch jump |
| M | large coords (`E≈2M / N≈7M`) | XY/Z offsets within `1e-6` | offset 0; outcome/topology unchanged |
| N | determinism digests | identical repeats | corpus re-run sha256 identical; 15/15 → 1 digest |
| O | corpus batch | zero crashes; outcome histogram | 112 rows, 0 mismatches (histogram below) |

## §A — exact fixed surface ↔ Distance

Joint `V=(0,0,100)`, surface incoming `(−60,0,100)→V`, analytic outgoing
`V→(0,60,100)`, side right, flat target Z=90. `FIXED(−0.5)` surface,
`ANALYTIC` Distance/Elevation/Relative variants.

- Actual: `EXACT_COMMON_TIE`, `turn=GAP`, `rootCount=1`.
- `T* = (40,−20,90)`, extent `44.721359549995796 = √2000`, `xyGap=0`, `zGap=0`,
  target residual 0.
- `Qs = (0,−20,90)` (surface strip end), `Qa = (40,0,90)` (analytic line origin).
- Fan mesh: valid, 2 triangles, plan area `800`, 3D area
  `859.5241580617239` (= `hypot(0,−400,800)/2 + hypot(200,0,800)/2`).

## §B — order reversal

Analytic incoming `(0,−60,100)→V`, surface outgoing `V→(−60,0,100)`, mirrored
frames. Actual: `EXACT_COMMON_TIE`, `turn=GAP`, tie `(40,20,90)`, extent
`44.721359549995796`, gaps 0. Target-92 reversal keeps `xyGap=√80`,
`zGap=2`.

## §C — Elevation variant

`ELEV(−0.25, 90)` on the same exact fixture. Actual: `EXACT_COMMON_TIE`,
tie `(40,−20,90)`, gaps 0. Upward mirror `FIXED(0.5)` + `REL(0.25,10)` + target
110 ties at `(40,−20,110)`.

## §D — Relative-elevation variant

`REL(−0.25,−10)` (`d = Δ/g = 40`, `oz = 100−10 = 90`). Actual:
`EXACT_COMMON_TIE`, tie `(40,−20,90)`, gaps 0; `Distance(−0.25,40)` identical.

## §E — residual mismatch fails closed

- Target Z=92: surface tie `(32,−16,92)`, analytic tie `(40,−20,90)`,
  `xyGap = 8.94427190999916 = √80`, `zGap = 2`, `mesh=null`,
  `TRANSITION_REQUIRED`.
- Analytic `Δ=−12` (d=48, Z=88): surface tie `(40,−20,90)`, analytic tie
  `(48,−24,88)`, same gaps, `TRANSITION_REQUIRED`.
- Both orders report the same gap magnitudes; no averaging, no bridge, no wall.
- Actual code is the study taxonomy `TRANSITION_REQUIRED`; the proposed
  production name `CORNER_HYBRID_TARGET_DISAGREE` is **not** in production
  vocabulary.

## §F — target void

TIN translated to (500,500) leaves V uncovered: `SURFACE_TARGET_GAP`
(`gap-at-V`), `rootCount=0`, `mesh=null`. Mirrors `solveMiterTie`
(`gradingGroupSectors.ts:206-211`). Degenerate (collinear) triangle also
`SURFACE_TARGET_GAP`; covered target plane above the ray is
`SURFACE_NO_ROOT`.

## §G — branch / multi-root

- Disconnected same-plane patches + V-covering triangle → 3 roots;
  surface keeps the nearest root (V) while the analytic tie matches the far
  root → `ROOT_POLICY_CONFLICT` (`analytic-matches-later-root`), never a
  re-pick.
- Single tilted triangle through the tie → 1 root, `EXACT_COMMON_TIE`.
- `fail.no-root` → `SURFACE_NO_ROOT`; `fail.degenerate-triangle` →
  `SURFACE_TARGET_GAP`; triangulation permutation
  (`exact.target-alt-triangulation`) → `EXACT_COMMON_TIE` at (40,−20,90).
- Repeated runs are identical (see §N).

## §H — GAP prototype

Outside turn: valid fan `V→Qs→T*` + `V→T*→Qa`; 4 verts, 2 CCW triangles,
plan area `800`, 3D `859.5241580617239`; no vertical wall. Mesh digest stable
across repeats.

## §I — OVERLAP prototype

Inside turn (`V→(0,−60,100)`): `turn=OVERLAP`, tie `(−40,−20,90)`, valid mesh
with 9 verts, tiled once (no duplicate faces, no inversion), V and T* survive
the clip. OVERLAP is recorded as a **valid** outcome, not a NO-GO.

## §J — closed square

Four-member closed square (Z=10), criteria `[FIXED(−0.5), DIST(−0.5,20),
ELEV(−0.5,0), REL(−0.5,−10)]`; one surface + one analytic member per corner
by construction.

- Four corners tie exactly at `(120,−20,0)`, `(120,120,0)`, `(−20,120,0)`,
  `(−20,−20,0)`; extent `28.284271247461902 = 20√2`.
- Production controls agree: `control.all-surface`,
  `control.all-distance`, `control.mixed-analytic` all `ok` and return the
  same corner ties; 43-file / 599-test grading suite passes.
- One off member (`D=24`): corner 0 → `TRANSITION_REQUIRED` (tie
  `(124,−24,−2)`, `xyGap=5.656854249492381=√32`, `zGap=2`, `mesh=null`),
  corner 1 → analytic-pair `z-disagree`. No partial mesh is emitted.
- Freeze: a real surface+analytic mixed group fails
  `MEMBER_NO_SOLUTION` / `GRADING_GROUP_MIXED_TERMINATION_DOMAIN` (unchanged).
- Design Patch: not implemented in this study; a hybrid ring would still have
  to pass the existing bit-flat / exactly-coplanar gate or stay BLOCKED.

## §K — triangulation variants

Flat target with the alternate diagonal, and the sloped target
(`z = 90 + 0.05(x−40) + 0.02(y+20)`, spun 10°) under both triangulations:
all `EXACT_COMMON_TIE` at `(40,−20,90)`, `zGap=0`, `xyGap` ≤ `3.18e-14`
(within `zeroDelta`), valid mesh.

## §L — arc ladder

Last chord of an N-chord circular-arc sampling (R=100, arc through V),
straight analytic member.

- Surface-arc incoming ends: tie Y `−20.000000000000007` (N=1) →
  `−11.230531735625744` (N=4) → `−9.09741503818178` (N=16); extents
  `44.721359549995796` → `41.546658626956955` → `41.02149388280412`.
- Reverse (analytic-arc incoming): tie X `40` → `36.41599707635226` →
  `35.81568037015262`; extents `44.721359549995796` → `41.546658626956955` →
  `41.021493882804116`.
- Monotone from one side, no branch jump, all `EXACT_COMMON_TIE`. This is the
  bounded arc-adjacent configuration: **arc chord/tangent only**, straight
  member on the other side (see performance doc §F for the arc×arc harness
  limitation and decision §G9/risk note).

## §M — large coordinates

V translated to `(2000000, 7000000)`, target/members shifted; exact case →
`EXACT_COMMON_TIE`, tie `(2000040, 6999980, 90)`, `xyGap=0`, `zGap=0`,
`turn=GAP`. Mismatch case keeps `xyGap=√80`, `zGap=2`. Coordinate offset
`0 ≤ 1e-6`; outcome and topology unchanged.

## §N — determinism

- Corpus regeneration is byte-identical: sha256
  `3189d1cd038b5a76ae19afb1c294a97e7ff5dac5144874475b3c8f85c7d05b42` on two
  consecutive runs.
- Harness `--quick` deterministic repeats: B exact fixed/Relative and
  fixed/Distance each 15/15 → **1** unique digest `d7f04bdfd80a9537`.
- Mesh prototype tests assert digest-stable mesh repeats.

## §O — corpus batch

`npx tsx scripts/phase20iSurfaceAnalyticCornerStudy.ts`: 112 rows, **0**
mismatches. Outcome histogram (actual):

| outcome | rows |
|---|---:|
| `EXACT_COMMON_TIE` | 53 |
| `TRANSITION_REQUIRED` | 38 |
| `ok` (production controls) | 3 |
| `SURFACE_TARGET_GAP` | 2 |
| `ROOT_POLICY_CONFLICT` | 2 |
| `NON_FINITE_INPUT` | 2 |
| `PLANE_DEGENERATE` | 2 |
| `SIDE_REJECT` | 2 |
| `MAX_EXTENT_REJECT` | 2 |
| `SURFACE_NO_ROOT` | 1 |
| `ANALYTIC_SEAM_PARALLEL` | 1 |
| `DEFENSE_IN_DEPTH` | 1 |
| `CORNER_NO_SOLUTION` | 1 |
| `tie` (quirk probe) | 1 |
| `MEMBER_NO_SOLUTION/GRADING_GROUP_MIXED_TERMINATION_DOMAIN` | 1 |

Failure/guard taxonomy (each exactly as expected): coincident →
`PLANE_DEGENERATE`; seam-parallel → `ANALYTIC_SEAM_PARALLEL`; U-turn and
same-travel collinear → `SIDE_REJECT`; early-root patch with far analytic tie
→ `MAX_EXTENT_REJECT` (both orders); non-finite grade/target and zero-length
member → `NON_FINITE_INPUT` / `PLANE_DEGENERATE`. `record.behind-unreachable`:
192-config direction×order×criterion grid (`grid=192 behind=0`; 96
`SIDE_REJECT` + 96 `EXACT_COMMON_TIE`), so `ANALYTIC_TIE_BEHIND_VERTEX` is
unreachable for side-consistent inputs and stays defense-in-depth.

## Incidental findings (recorded, not fixed — `src/` untouched)

- `record.quirk-axis-aligned`: `solveMiterTie`'s shared ray/edge interval code
  returns `CORNER_NO_SOLUTION` for an axis-parallel ray on an axis-aligned
  triangulation even when the ray runs inside the target
  (`denom = 0` sign slip in `rayTriangleInterval`). The same probe on a
  10°-rotated target ties at `(0,−20,90)`, extent 20. Production behavior;
  study only records it.
- `jointQs` 20B note: the strict chord-agreement gate
  (`solveGradingChord` → `GRADING_DAYLIGHT_DISAGREE`) refuses sloped targets
  with a flat grade `−0.499`, so `jointQs` falls back to `solveMiterTie` along
  the member side normal. Recorded as an interaction, not changed.
- Perf harness arc×arc joints (both adjacent members being arc chords) are
  outside the validated §L configuration; ~half fail closed. See performance
  doc §F; folded into the bounded arc risk in the decision record.

## Non-regression

- Zero `src/` diff on this branch → existing Surface↔Surface and
  Analytic↔Analytic bytes, legacy `grev1:`/`ggrev1:` revision pins, and
  persisted fixtures are structurally untouched.
- Grading-prefix suite: **43 files / 599 tests passed**.
- Corpus controls (`control.all-surface`, `control.all-distance`,
  `control.mixed-analytic`) return the same ties and `ok`; `freeze.*` stays
  fail-closed.
- `npm run lint`: 0 errors, 2 warnings (pre-existing, unrelated `tests/evidence`
  and `tests/gnssBaseline` unused-disable directives). `npm run typecheck`:
  clean. `npm run check:portable-paths`: 5404 tracked paths, 0 violations.
