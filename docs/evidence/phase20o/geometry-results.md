# Phase 20O — geometry results (evidence grid)

- Branch: `research/phase20o-noncollinear-transition-plan-law`, baseline `d093faf8`.
- Scope: STUDY ONLY. Zero `src/` changes. No law below is production behavior:
  live `trp1` rejects every δ≠0 at `NON_COLLINEAR` (pinned per corpus row,
  `liveAdmit == NON_COLLINEAR` on all 720 grid rows).
- Study core: `scripts/phase20oNoncollinearPlanLawStudy.ts`; corpus
  `docs/evidence/phase20o/corpus.json` (736 rows: 720 grid + 16 adversarial),
  sha256 `9685974d4194bd1cb2d4aaadd91a4d1a4a3bd3125603ee42e08b45353d7422c0`
  (regen-pinned, double-build byte-identical).
- Law definitions: `candidate-laws.md`. Shared setup for all three laws: same
  legislated scalar `v(s)` via production `evaluateTransitionLinearV1`, same
  endpoints, same 9 stations. Comparison basis is **same-station separation**
  (same legislated scalar contour), not closest-point distance.
- Agreement band at this scale: `coordinateAgreementTol ≈ 1.4e-13`.

## 1. Per-angle divergence (comfortable cuts, W=8, max over signs×families×sides, n=12 rows per angle)

| δ | heading−nlerp max | heading−hermite max | nlerp−hermite max | hermite m W/2−W/4 max |
|---|---|---|---|---|
| 0.1° | 5.8e-10 | 0.53 | 0.53 | 0.19 |
| 1° | 5.8e-7 | 0.54 | 0.54 | 0.19 |
| 5° | 7.3e-5 | 0.58 | 0.58 | 0.19 |
| 15° | 2.0e-3 | 0.73 | 0.73 | 0.19 |
| 30° | 1.6e-2 | 1.11 | 1.11 | 0.21 |
| 45° | 5.5e-2 | 1.78 | 1.78 | 0.22 |
| 90° | 0.50 | 4.13 | 4.13 | 0.35 |
| 135° | 2.02 | 6.73 | 6.73 | 0.46 |
| 170° | 5.44 | 8.70 | 8.70 | 0.50 |
| 179° | 7.04 | 9.17 | 9.17 | 0.50 |

(Full precision: §7. Minima over the 12-row cell track the maxima within
~7%: e.g. 179° heading−nlerp min 6.77 m; 0.1° hermite-magnitude min 0.1875 m.
Sign, family, and side do not change the order of magnitude.)

Every entry exceeds the 1.4e-13 agreement band by 3–13 orders of magnitude.
Heading−nlerp exceeds it by ~4e3× already at 0.1°.

On **daylight area**: this corpus does not store an enclosed-area field — the
decision metric is same-station separation (a law must fix where each
v-contour sits). For context, the prior 20N two-probe study measured up to
22.7 m² enclosed area at 179° (`noncollinear-single.md` §2.3); the 20O
separations above (7–9 m at 179°) imply same-order enclosed areas.

## 2. Hermite magnitude sensitivity (W/2 vs W/4)

The `m0 = m1 = W/2` rule is stated but non-principled (no derivation from
member lengths, grades, or offsets). Halving the magnitude alone moves the
path by ~0.19 m at every small deflection and 0.50 m at 179° (comfortable
cuts). Near-bound cuts (W = 2·min(LL,LR) − 0.001) amplify it to 0.94 m at
0.1° and 2.50 m at 179°. Legislating `m0 = m1 = W/2` would enshrine an
arbitrary number, not a geometric necessity.

## 3. C0 / mid-kink (C1) / endpoint residuals

- **C0 exact on all laws, all feasible rows** (`c0 == true`, endpoint
  position residuals at FP noise). Determinism is not the blocker.
- **Endpoint tangent residuals are NOT pure C1 jumps.** They combine the
  legislated offset-blend slope with a deflection term: at δ=0.1°
  (comfortable, distance/left/sign+) heading residuals are already
  14.05°/14.06° — the atan((7−5)/8)≈14.04° blend slope with offL≠offR —
  rising to 24.8°/39.9° (heading) and 23.7°/36.0° (nlerp) at δ=45°. The
  same blend slope exists in production collinear transitions with unequal
  endpoint offsets, so endpoint residuals cannot discriminate laws.
- **Mid-interval kink (deflection-specific C1 break).** Angle between the
  two segments meeting at the middle station, where the source anchor
  corners at V: grid-wide over feasible rows at δ≤45°, heading/nlerp kink
  within [0.63δ, 1.82δ] (pinned in test as [0.5δ, 2δ]) while Hermite stays
  below 0.09δ (pinned <0.2δ). Frame laws inherit the source corner;
  Hermite smooths it — but only via the arbitrary magnitude (G2). Past
  ~90° the kink saturates as paths loop/degrade (self-intersection /
  foldover §4), so the clean comparison domain is δ≤45°.
- Hermite is C1-exact at the endpoints (0.0° both ends, all rows) — bought
  entirely with the arbitrary magnitude. Each law's fix is another law's gap.

## 4. Curvature / self-intersection / foldover / daylight inversion

Representative row (comfortable, distance, left, sign+); extremes over all
480 feasible grid rows per law in parentheses:

- δ ≤ 45°: no self-intersection, foldover, normal-flip, or overlap on any law.
  Min radii stay above ~0.46 m (heading/nlerp at 45°) and ~0.66 m (Hermite).
- δ = 90°: nlerp self-intersects (26/480 rows study-wide: 4 at 90°, 10 at
  135°, 12 at 170°) with min radius
  0.027 m; heading folds over (foldover on 26/480 heading rows: 16 at 90°,
  10 at 135°); Hermite shows daylight inversion on 18/48 feasible rows —
  genuine unnecessary inversion (no necessity at 90°), while the frame
  blends never fire there.
- δ ≥ 135°: interior `normalFlip == true` on every frame-law row (144/480
  per law) — necessary for ANY C0 frame blend (some interior frame must sit
  >90° from an endpoint), not a law defect. Hermite totals 150/480 (18 at
  90° genuine + 36 at 135° + all at 170°/179°): the cubic overshoots and
  opposes an endpoint frame it need not oppose. The flag is measured on
  interior stations only (endpoint firing is input geometry, excluded).
  Hermite never self-intersects (0/480) and
  keeps the largest min radius (study-wide min 0.12 m vs 0.050 m heading,
  0.027 m nlerp); nlerp folds over on 72/480 rows (18 each at 90°/135°/
  170°/179°).
- `overlap` (non-adjacent station coincidence within the agreement band) is
  false on all 1440 feasible law evaluations — 9 stations are too coarse to
  catch near-coincidence, so this flag is weak evidence, recorded for
  completeness, not relied on.
- Transition-vs-native overlap (bridge interior crossing a native daylight
  line outside the cut interval) is NOT separately metered; interior
  pathology is bounded by the self-intersection/foldover/overlap flags
  above. No native-clearance claim is made.
- Rejected-law numeric fields serialize as null in corpus.json (NaN in the
  builder): only the exact-180° adversarial row rejects, all three laws
  ANTIPARALLEL. Null `rejectCode`/`rejectDetail`/`reject` elsewhere means
  "no reject", not missing data.

## 5. W + coordinate-magnitude sensitivity

- **W**: near-bound cuts amplify every divergence. Heading−hermite at 45°:
  1.78 m (comfortable) → 6.24 m (near-bound); at 179°: 9.17 m → 21.04 m.
  Hermite-magnitude sensitivity at 179°: 0.50 m → 2.50 m. The laws diverge
  more exactly where the interval is longest — there is no W regime in which
  the candidates agree.
- **Coordinate magnitude**: rigid translation by 1e6 reproduces every law to
  ≤2.4e-10 m; by 1e8 to ≤3.0e-8 m (FP-level, scales with |coordinate| as
  expected). Translation is not a policy input — no law selection, epsilon,
  or branch depends on absolute position.

## 6. Mirror / translation / reversal identities

Study-wide maxima over feasible grid rows: mirror 0 (exact — δ negates under
y→−y by construction), reversal 5.4e-15, translate-1e6 2.4e-10,
translate-1e8 3.0e-8. Pinned in test: mirror < 1e-9, reversal < 1e-9,
t6 < 1e-8, t8 < 1e-6. Stability holds for all laws — the obstruction is
selection, not determinism.

## 7. Adversarial rejections (16 rows, all pinned live against trp1)

- Exact δ=0 (all 3 families): `ADMITTED`, routes to trp1, never to a new law
  (`laws == null`, `route == trp1`).
- Exact δ=180°: live `NON_COLLINEAR`; all three study laws reject
  `ANTIPARALLEL` (boundary ||δ|−180°| < 1e-9 deg; 180−5e-10° still rejects,
  179° defined on all laws).
- Width zero/negative/NaN/Inf → `WIDTH_INVALID`; W=41 > 2·min → `WIDTH_INFEASIBLE`.
- Family/grade/side/slope/step/arc/closed → `FAMILY_MISMATCH`,
  `GRADE_MISMATCH`, `SIDE_MISMATCH`, `NON_FLAT`, `JOINT_Z_STEP`, `NON_LINE`,
  `CLOSED` respectively. No row admits; no law is reachable past a reject.

## 8. Decisive comparison

Three explicit legislated-form laws sharing endpoints and the SAME scalar
law differ by decimetres at every realistic deflection (0.53 m at 0.1° for
any Hermite-vs-frame pair; heading−nlerp reaches 5.5 cm at 45° and 7.0 m at
179°) and by metres at large deflections — while no existing authority
(forensics §§2–5, §10) selects between them. The 20N obstruction (two probes,
up to 7.6 m) reproduces with three candidates and a wider grid: multiple
plausible laws materially diverge under the SAME scalar law. Shipping any
one of them would be inventing geometry, not relaxing a gate.
