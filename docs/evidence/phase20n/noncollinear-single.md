# Phase 20N — Candidate B: single non-collinear same-family transition

- Baseline: `9805da77` (branch `research/phase20n-transition-expansion-decision`).
- Scope: **STUDY / EVIDENCE ONLY. Zero `src/` edits** (verified: `git diff
  9805da77...HEAD -- src` empty; working tree also clean of `src/` changes).
- Candidate B: one non-collinear same-family transition — the 20M.1 §9 `trp1`
  predicate with the `source deflection == 0` collinearity gate removed.
- Study core: `scripts/phase20nTransitionExpansionStudy.ts` (CANDIDATE B
  section, `candidateB*` exports; pure-math, synthetic joints only).
- Corpus: `docs/evidence/phase20n/corpus.json` — Candidate B appends **81
  rows** (9 angles × 3 families × {identity, mirror, reversal}) and preserves
  the 11 Candidate A rows already present. Every Candidate B row is
  `synthetic: true`, `studyOnly: true`, `candidate: "B"`.
- Verdict: **POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW** (§4).

Study-only discipline: every probe is labelled STUDY-ONLY. No probe is a
default, an admission authority, or a proposed production value. No new
epsilon is introduced. Comparison floors used in the study: the shared
`coordinateAgreementTol` (as a materiality band only); literal `1e-9`
equality bands inside `factsEqual` and the miter-match check; and `r12`
(`toPrecision(12)`) rounding for deterministic corpus output. Those are
study comparison floors, not admission epsilons — no production tolerance
changes. The Candidate B
probes deliberately are **not** the miter point, the straight T0 connector,
a width-curvature law, a hidden arc, or smoothstep — none of those is
smuggled as law.

## 1. C1 — reproduce the obstruction

### 1.1 The live gate rejects every non-collinear deflection (authority pin)

`src/engine/cad/grading/gradingTransitionPolicy.ts:141-144`:

```ts
const cross = left.dirX * right.dirY - left.dirY * right.dirX;
const dot = left.dirX * right.dirX + left.dirY * right.dirY;
if (!(cross === 0 && dot > 0)) return fail('NON_COLLINEAR', 'source deflection must be exactly 0');
```

The study calls `admitGradingTransition` on every row. Result:
`candidateBAdmissionAuthorityRejectsNonCollinear() === true` — **ADMITTED**
only at `angleDeg === 0`; **NON_COLLINEAR** for all δ ∈
{1, 5, 15, 30, 45, 90, 135, 179}° in all three families. This pins the 20M.1
§9 "source deflection == 0" predicate to the current authority.

### 1.2 Scalar C0 holds, but the plan direction breaks by exactly the deflection

The legislated interior scalar `v(s) = vL + (vR−vL)·t` meets both natives at
the interval ends by construction: every Candidate B row records
`c0Gap == 0`, measured through production `evaluateTransitionLinearV1` at
`sL`/`sR` against live-admitted `(vL,vR)` of the same family/width
(`candidateBFacts`; the scalar law is angle-independent, so the collinear
admission supplies the endpoints — non-collinear rows cannot admit).
Scalar-C0 here means the scalar law meets the natives; it says nothing about
the plan frame, which is where the break lives. So at scalar level the
candidate is position-continuous.

The obstruction is the **frame**, not the scalar. The two members' daylight
lines are parallel to their own sources; at a joint with deflection δ the
daylight direction changes by exactly δ. Every measured row records
`kinkDeg == angleDeg` (9 angles × 3 families × 3 transforms). The scalar
cannot repair a discontinuous frame.

### 1.3 Foldover

`foldover` is `true` only past perpendicular: `true` at 135°/179°, `false`
at exactly 90° (`dot===0`, perpendicular, not doubling back) and at all
shallower angles. This matches the 20M.1 §4 statement exactly.

### 1.4 Mesh consequences under the current single-frame construction

The production transition plan does not have a frame law; it inherits one
member's frame:

| Site | Behaviour | Consequence for δ≠0 |
| --- | --- | --- |
| `gradingGroupCompute.ts:449-450` | `tx,ty = frameL.tOut` (left frame only) | one tangent used for the whole interval |
| `gradingGroupCompute.ts:458` | joint daylight `q0raw = transitionDaylightAt(…, nx, ny)` with the left normal | joint daylight ignores the right native direction |
| `gradingGroupCompute.ts:470` | `PcL = V − t·(W/2)` | left cut on the left tangent (correct only for the left member) |
| `gradingGroupCompute.ts:500` | `PcR = V + t·(W/2)` | **right cut placed on the left tangent**, off the right member line by `W·sin(δ/2)` |
| `gradingGroupCompute.ts:902-913` | transitioned joint recorded as `TANGENT` and `continue`d; `miterRay = {transitionPlan.tx,ty}` | the real corner (GAP/OVERLAP) is never patched; the "miter ray" is a single member tangent, not a miter |
| `workers/surfaceGradingCompute.ts:640-642` | `normal = gradingSideNormal(pCutR.x−pCutL.x, pCutR.y−pCutL.y, side)` | worker agreement assumes the cut line is one straight transition tangent — false for δ≠0 |

Measured plan consequences (W = 8 m), family-independent for the cut-point
error and monotone in δ:

| δ° | `cutPointErrorM` = W·sin(δ/2) (derived study model) | `jointDaylightGapM` (distance) | `jointDaylightGapM` (relEl / elev) |
| --- | --- | --- | --- |
| 1 | 0.0698 | 2.0027 | 4.0012 |
| 5 | 0.3490 | 2.0655 | 4.0303 |
| 15 | 1.0442 | 2.5269 | 4.2639 |
| 30 | 2.0706 | 3.6576 | 4.9573 |
| 45 | 3.0615 | 4.9500 | 5.8945 |
| 90 | 5.6569 | 8.6023 | 8.9443 |
| 135 | 7.3910 | 11.1129 | 11.1917 |
| 179 | 7.9997 | 11.9996 | 11.9996 |

So the current construction either refuses the joint (the live gate) or, were
the gate removed without a frame law, would truncate the right member along
the wrong line, skip the real corner, and hand the worker a normal derived
from a cut line that is not the member's own frame. (`cutPointErrorM` is a
derived study model of that single-frame construction — `W·sin(δ/2)` from the
plan geometry — not measured production output; production REJECTS δ≠0.) The pre-existing
`TRANSITION_REQUIRED` hard stops that would otherwise fire at a
line/analytic joint remain unchanged
(`gradingGroupHybridCorners.ts:242`, `:356`;
`gradingChordSeam.ts:478`).

### 1.5 20M.1 claims vs current authorities

| 20M.1 claim | Current authority / study evidence | Status |
| --- | --- | --- |
| scalar C0 holds at all angles | production-law endpoint evaluation (`c0Gap == 0` measured via `evaluateTransitionLinearV1` on all 81 rows) | consistent |
| `kinkDeg == deflection` (recorded, never masked) | study `kinkDeg == angleDeg` on all 81 rows; single-frame construction §1.4 | consistent |
| foldover past perpendicular only; exactly 90° is not foldover | study `foldover` true only at 135°/179° | consistent |
| production predicate narrows to collinear (`angleDeg==0`) | `gradingTransitionPolicy.ts:141-144`; admission code ADMITTED only at 0 | consistent |
| non-collinear rows are SCALAR-ONLY, never production | study `admissionCode == NON_COLLINEAR` for all δ≠0 | consistent |

## 2. C2 — underdetermination: two study-only plan/frame laws

### 2.1 Probe definitions (both STUDY-ONLY, neither is law)

On the synthetic interval `s ∈ [−W/2, +W/2]`, both probes use the same bent
source path (left member then right member) and the same legislated scalar
law `v(s)=vL+(vR−vL)·t`, `t=(s+W/2)/W`. They differ only in the interior
frame:

- **Probe N ("nlerp")**: `n(t) = normalize((1−t)·nL + t·nR)`.
- **Probe H ("heading")**: `θ(t) = θL + t·wrap(θR−θL)`,
  `n(t) = (cos θ(t), sin θ(t))`.

`nL / nR` are the production side normals (`gradingSideNormal`) of the left
and right member tangents. Both probes reproduce the native frame at `t=0`
and `t=1`, so both share the same two daylight endpoints exactly.

### 2.2 Shared endpoints / scalar C0

Both probes equal `nL·offL` at the left endpoint and `nR·offR` at the right
endpoint; `c0Gap == 0` (production-law measurement, §1.2) on every row. The divergence below is interior only.

### 2.3 Measured divergence (identity transform, W = 8 m)

Distance family (offsets 5 m / 7 m):

| δ° | admission | `maxPlanSepM` | `areaM2` | `minRadiusNlerp` | `minRadiusHeading` | self-intersect |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | ADMITTED | 4.4e-16 | 0 | (straight) | (straight) | no |
| 1 | NON_COLLINEAR | 5.61e-7 | 6.99e-8 | 2.454 | 2.454 | no |
| 5 | NON_COLLINEAR | 7.02e-5 | 1.42e-5 | 0.4490 | 0.4490 | no |
| 15 | NON_COLLINEAR | 1.90e-3 | 7.49e-4 | 0.1183 | 0.1186 | no |
| 30 | NON_COLLINEAR | 1.54e-2 | 1.04e-2 | 0.0405 | 0.0414 | no |
| 45 | NON_COLLINEAR | 5.27e-2 | 5.06e-2 | 0.0182 | 0.0196 | no |
| 90 | NON_COLLINEAR | 0.4644 | 0.8057 | 0.00103 | 0.0209 | **yes** |
| 135 | NON_COLLINEAR | 1.9070 | 4.4572 | 0.00547 | 0.0632 | no |
| 179 | NON_COLLINEAR | 7.5377 | 21.1150 | 0.0104 | 0.1340 | **yes** |

RelativeElevation family (offsets 4 m / 8 m — identical plan to Elevation,
since both have dOff = 4/8):

| δ° | `maxPlanSepM` | `areaM2` | `minRadiusNlerp` | `minRadiusHeading` | self-intersect |
| --- | --- | --- | --- | --- | --- |
| 0 | 8.9e-16 | 3.3e-14 | (straight) | (straight) | no |
| 1 | 6.13e-7 | 2.47e-7 | 3.148 | 3.148 | no |
| 5 | 7.66e-5 | 3.63e-5 | 0.5936 | 0.5936 | no |
| 15 | 2.07e-3 | 1.35e-3 | 0.1717 | 0.1719 | no |
| 30 | 1.67e-2 | 1.53e-2 | 0.0715 | 0.0722 | no |
| 45 | 5.74e-2 | 6.71e-2 | 0.0428 | 0.0432 | no |
| 90 | 0.5031 | 0.9472 | 0.0468 | 0.0322 | no |
| 135 | 2.0395 | 4.9990 | 0.0851 | 0.0731 | no |
| 179 | 7.6441 | 22.6511 | 0.0403 | 0.1443 | no |

Flat-Elevation family = identical to RelativeElevation (same plan offsets).

`minSepM` is 0 (or float noise) on every row because the two probes coincide
at the shared endpoints and at the symmetric midpoint; it is recorded for
completeness but is not the discriminating metric. `minRadius*` is the
"min-width" proxy: the sharpest plan turn radius each law produces
(`1 / max curvature`); under 5 mm for nlerp at 90°.

### 2.4 Materiality vs shared agreement bands

The shared materiality band is `coordinateAgreementTol`: ≈ 7.1e-14 at
world scale 10 (and the shared elevation floor is 1e-9). Study-internal
comparison floors (`1e-9` in `factsEqual`/miter-match, `r12` output rounding)
are separate and introduce no production epsilon. Even the shallowest
non-collinear row (δ = 1°) separates the two study laws by 5.6e-7–6.1e-7 m —
about 10^7× the coordinate band and ~600× the elevation floor. At δ = 179°
the separation is 7.6 m with 22.7 m² of enclosed plan area. The divergence is
a real geometry difference, not rounding.

### 2.5 Mirror and reversal

All 81 rows are `mirrorStable == true` and `reversalStable == true`: every
row is compared against the identity row of its family/angle within 1e-9
(`factsEqual` — max plan separation, area, kink, foldover,
self-intersection). Identity rows are trivially self-equal; the informative
comparisons are the 54 mirror/reversal rows vs identity — all match, so
there are no unstable rows. Mirror (δ → −δ) and member
reversal preserve the measured obstruction and the classification.

## 3. C3 — does any existing authority select the plan path?

**No.** The audit is both documentary and machine-checked
(`candidateBAuditPlanLawAuthorities`, `CANDIDATE_B_AUTHORITY_INVENTORY`).

### 3.1 Miter point vs finite-width law

`miterSeam` / `selectMiterRay` / `miterExtent` (`gradingCornerMath.ts`) and
`solveAnalyticCorner` (`gradingGroupAnalyticCorners.ts`) intersect the two
**terminal offset lines** and return **one tie point plus a bounded ray**
(`t ≤ maxSearch / (M·Ni)`). This is a zero-width join. It fixes the point
where both member laws agree; it does not define any interior scalar, any
width, or any frame interpolation. It is **width-independent** (no width is
an input), so it cannot select a finite-width bridge law.

### 3.2 20L.2 circular offset vs smoothed line-line

`solveExactOffsetJoin` (`gradingExactOffsetGeometry.ts`) is a constant-`d`
offset support intersection:

- line × line ⇒ the two parallel-offset lines meet in the **same miter
  point** (machine-checked: the study's `miterMatchesExactOffset == true`,
  `kind == 'line-line'`);
- line × arc / arc × arc ⇒ a **concentric circle** offset (exact `Roff`,
  arc-pair NO_GO) — documentary conclusion from the 20L.2 sources; the
  machine-checked row in this study is line-line only
  (`miterMatchesExactOffset == true`, `kind == 'line-line'`).

Either way it is a point join, never a finite-width bridge. The "circular"
20L.2 behaviour is the exact offset of a *constant-radius arc member*; it is
not a law for bridging two straight members, and it is not the same object as
the transition's finite-width scalar blend over a source interval. The
distinction matters: 20L.2's circle is a derivation from an existing arc's
radius, whereas Candidate B's interior would require a new plan/frame law
that has no source radius and no selecting authority.

### 3.3 Other authorities

| Authority | Role | Selects a plan path? |
| --- | --- | --- |
| source geometry | endpoints + two distinct per-member tangents | no — for δ≠0 no single frame exists |
| `maxSearchDistance` | upper extent bound (`miterExtent`) | no — bounds, does not choose |
| transition width `W` (`trp1`) | explicit persisted user interval | no — user-supplied, not derived |
| `gtop2` / `deriveTransitionExpectation` | validate a produced mesh against a declared budget | no — validates, never admits or legislates |
| worker agreement tols (`coordinateAgreementTol`, `elevationAgreementTol`, …) | agreement bands | no — compare a result against a chosen law; do not choose it |
| `trp1` admission | policy predicate | no — correctly rejects δ≠0 at `NON_COLLINEAR` |

Machine audit result (line-line machine-checked; arc remark documentary):
`miterMatchesExactOffset=true`, `exactOffsetKind='line-line'`,
`selectsPlanPath=false` (documentary conclusion: a point join cannot
legislate a finite-width interior law — no code path in the study derives a
path from the audit).

## 4. Verdict

**POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW.**

1. The live gate is correct: every δ≠0 deflection is rejected with
   `NON_COLLINEAR` (`gradingTransitionPolicy.ts:141-144`), and the 20M.1
   collinear-only narrowing is consistent with the current authority.
2. Removing the gate exposes a real obstruction: scalar C0 holds, but the
   plan direction breaks by exactly the deflection, foldover occurs past
   perpendicular, and the current single-frame construction truncates the
   right member along the left tangent (derived-study-model `cutPointErrorM = W·sin(δ/2)`
   up to 8 m) while skipping the real corner.
3. Two reasonable study-only plan/frame laws that share the same endpoints
   and the same scalar law diverge materially (up to 7.6 m separation and
   22.7 m² at 179°; self-intersection at 90°/179° in the distance family),
   while no existing authority — miter, 20L.2 offset, source geometry,
   `maxSearchDistance`, `W`, `gtop2`, worker tolerances — selects between
   them. (`cutPointErrorM = W·sin(δ/2)` in §1.4 is the derived study model
   of the single-frame truncation, not measured production output.)
4. A future non-collinear predicate would therefore require, at minimum: a
   **persisted plan/frame bridge law** (versioned, like `TRANSITION_LINEAR_V1`),
   an interior scalar law over the interval, explicit width, provenance, a
   worker agreement basis, and transition-specific topology/certificate
   handling. None of these exists; the missing piece is a product/policy
   decision, so the verdict is POLICY_REQUIRED, not NO_GO and not
   IMPLEMENTABLE_NOW.

## 5. Reproducibility

```
npx tsx scripts/phase20nTransitionExpansionStudy.ts
```

- Emits the 81 Candidate B rows, appends them to
  `docs/evidence/phase20n/corpus.json` (idempotent; Candidate A rows
  preserved), and prints the authority-gate pin and C3 audit.
- `PHASE20N_STDOUT=1` prints the rows to stdout instead of writing.
- Deterministic: `sha256(candidateB rows, generation order) =
  cdb4da536233e6c5491daa93d65ab6a3449f5b3f438ae610775a2e1fc2812610`.
- All probes are synthetic study geometry; none is solver output.
