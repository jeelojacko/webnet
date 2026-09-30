# Phase 20I — surface↔analytic grading corner: validation

Status: FILLED (evidence-only, zero `src/` change). Branch
`research/phase20i-surface-analytic-corner-feasibility`, baseline
`9dd28c94715daa3583c907224a04652d3ae99cc3` (= PR #137 merge), HEAD
`e3225546` (PR #138) with the reviewer-fix working tree on top.

Numbers are produced by the core study
(`scripts/phase20iSurfaceAnalyticCornerCore.ts`,
`scripts/phase20iSurfaceAnalyticCornerStudy.ts`): corpus
`docs/evidence/phase20i/corpus.json` (114 rows, 0 mismatches, sha256
`b8de58ba0a6aed024bf3fe6285ef5ee28534ebb7ab34991ccb20ee7ac7d73cf9`), plus the
two focused test files (47 tests). Every number below is a script/test run,
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
| J | closed square (2 mixed + 2 analytic-analytic joints) | four tie coordinates agree; controls agree; freeze fail-closed | 4 exact ties at 20√2 extent; tie-checks only, no assembled closed-ring mesh |
| K | triangulation variants (same plane) | identical `T*` across two triangulations | identical (40,−20,90), xy gaps ≤3.2e-14, z gap 0 |
| L | arc ladder (mixed arc-adjacent) | `CURVE_APPROXIMATED`, `d` constant | monotone convergence, no branch jump |
| M | large coords (`E≈2M / N≈7M`) | XY/Z offsets within `1e-6` | offset 0; outcome/topology unchanged |
| N | determinism digests | identical repeats | corpus re-run sha256 identical; 15/15 → 1 digest |
| O | corpus batch | zero crashes; outcome histogram | 114 rows, 0 mismatches (histogram below) |
| P | source joint-Z discontinuity | fail closed `SOURCE_JOINT_MISMATCH`, no mesh | joint Z 100 vs 101 → `SOURCE_JOINT_MISMATCH` both orders; equal-Z still exact |
| Q | disconnected V/tie target | tie recorded but mesh request fails closed | `EXACT_COMMON_TIE` unmeshed (Qs null); `buildMesh` → `MESH_PROTOTYPE_FAILED` |

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
ELEV(−0.5,0), REL(−0.5,−10)]`. Honest accounting: corners 0 and 3 are
mixed surface↔analytic joints checked through the study core; corners 1
and 2 are analytic↔analytic joints checked through `intersectAnalyticPair`
(two existing terminal lines, no target). Each corner is an independent
tie-coordinate check — the study does NOT assemble a closed-ring mesh, so
no closed-mesh validation is claimed. What is proven: the four tie
coordinates.

- Four corners tie exactly at `(120,−20,0)`, `(120,120,0)`, `(−20,120,0)`,
  `(−20,−20,0)`; extent `28.284271247461902 = 20√2`.
- Production controls agree: `control.all-surface`,
  `control.all-distance`, `control.mixed-analytic` all `ok` and return the
  same corner ties; 43-file / 604-test grading suite passes.
- One off member (`D=24`): corner 0 → `TRANSITION_REQUIRED` (tie
  `(124,−24,−2)`, `xyGap=5.656854249492381=√32`, `zGap=2`, `mesh=null`),
  corner 1 → analytic-pair `z-disagree`. No partial mesh is emitted.
- Freeze: a real surface+analytic mixed group fails
  `MEMBER_NO_SOLUTION` / `GRADING_GROUP_MIXED_TERMINATION_DOMAIN` (unchanged).
- Tie-check vs mesh-check: the square proves tie coordinates, not a meshed
  ring. Likewise the open two-course prototype (mesh test file) checks the
  two member strips and the corner fan mesh separately — it does not merge
  them into one combined topology, so no combined-mesh claim is made.
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
  `b8de58ba0a6aed024bf3fe6285ef5ee28534ebb7ab34991ccb20ee7ac7d73cf9` on two
  consecutive runs.
- Harness `--quick` deterministic repeats: B exact fixed/Relative and
  fixed/Distance each 15/15 → **1** unique digest `d7f04bdfd80a9537`.
- Mesh prototype tests assert digest-stable mesh repeats.

## §O — corpus batch

`npx tsx scripts/phase20iSurfaceAnalyticCornerStudy.ts`: 114 rows, **0**
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
| `SOURCE_JOINT_MISMATCH` | 2 |
| `ANALYTIC_SEAM_PARALLEL` | 1 |
| `DEFENSE_IN_DEPTH` | 1 |
| `CORNER_NO_SOLUTION` | 1 |
| `tie` (quirk probe) | 1 |
| `MEMBER_NO_SOLUTION/GRADING_GROUP_MIXED_TERMINATION_DOMAIN` | 1 |

Failure/guard taxonomy (each exactly as expected): coincident →
`PLANE_DEGENERATE`; seam-parallel → `ANALYTIC_SEAM_PARALLEL`; U-turn and
same-travel collinear → `SIDE_REJECT`; early-root patch with far analytic tie
→ `MAX_EXTENT_REJECT` (both orders); non-finite grade/target and zero-length
member → `NON_FINITE_INPUT` / `PLANE_DEGENERATE`. Joint-Z discontinuity
(analytic joint Z 101 vs `vz` 100, both orders) → `SOURCE_JOINT_MISMATCH`
with no ties and no mesh (see §P). `record.behind-unreachable`:
192-config direction×order×criterion grid (`grid=192 behind=0`; 96
`SIDE_REJECT` + 96 `EXACT_COMMON_TIE`), so `ANALYTIC_TIE_BEHIND_VERTEX` is
unreachable for side-consistent inputs and stays defense-in-depth.

## §P — source joint-Z continuity gate

Reviewer-found fabrication: the core checked joint XY but not Z, then built
both corner planes through the supplied `vz`. Analytic joint Z 101 vs `vz`
100 still reported `EXACT_COMMON_TIE` with `Qa=(40,0,90)` while the real
strip starts at 101 — a tie on geometry neither member owns. Production
requires exact XYZ continuity (`exactXyz`,
`gradingGroupCompute.ts:99-100`; gate `:281-285`), so the study now mirrors
that rule as closely as its input shape permits: both members' joint Z must
`===`-equal each other and `vz`, checked BEFORE either plane is built. `===`
(not `zeroDelta`) is deliberate — the study inputs are exact-typed literals
and production compares with `===`.

- `fail.joint-z-analytic-off` + `fail.joint-z-analytic-off-reversed`
  (corpus, both member orders): `SOURCE_JOINT_MISMATCH`
  (`joint-z-mismatch`), no ties, no mesh.
- Equal-Z exact fixtures still tie (`exact.*` unchanged, §A–§D).
- Taxonomy note: `SOURCE_JOINT_MISMATCH` is evidence-only (the study
  taxonomy is "at minimum", extension allowed); production enums untouched.
- Consequence for the no-fabrication claim (§G5 in the decision record): it
  holds only from this gate onward — pre-gate exact ties on Z-discontinuous
  joints were fabricated and are now rejected.

## §Q — an unmeshed `EXACT_COMMON_TIE` is not a buildable corner

Exact tie classification alone does not prove a daylight path from the
member endpoint to the tie. Thin seam-covering target (CCW triangle
`V(0,0,95)`, `(40,−18,91)`, `(40,−22,89)`): covers V and the tie but neither
the surface strip daylight (`y=−20`) nor the side-normal fallback ray
(`x=0`), so `Qs` is null while both ties agree at `(40,−20,90)`.

- Without mesh request: `EXACT_COMMON_TIE` with `qs=null`, `mesh=null` —
  the classification is recorded, but nothing claims a corner was built.
- With `buildMesh: true`: `MESH_PROTOTYPE_FAILED`, ties still recorded,
  `mesh=null` (correctly fail-closed).
- Rule: a mesh verdict requires the mesh prototype. An unmeshed
  `EXACT_COMMON_TIE` must never be read as a buildable corner.

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
