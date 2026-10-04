# Phase 20O candidate plan/frame laws

STUDY ONLY. Reproducible independently from this file + `scripts/phase20oNoncollinearPlanLawStudy.ts`.
Zero `src/` changes. No law below is production behavior: live `trp1` still
rejects every δ≠0 at `NON_COLLINEAR` (pinned per corpus row and in
`tests/cad_grading_transition_planlaw_20o.test.ts`).

## Shared setup (all three laws)

- Synthetic flat line-line joint at V. Left member arrives along tL = (1,0);
  right member departs along tR = (cos δ, sin δ), δ = signed deflection
  (left turn positive; both signs gridded). Members are exactly flat at joint
  Z; same target-free analytic family both sides with equal gradeRatio
  (Distance d=5/7, RelEl Δz=2/4, flat Elevation E=12/14 at Z=10, g=0.5).
- Endpoint frames from the production side convention only:
  nL = gradingSideNormal(tL, side), nR = gradingSideNormal(tR, side).
- Interval s ∈ [−W/2, +W/2], t = (s + W/2)/W. Cut points PcL = V − tL·W/2,
  PcR = V + tR·W/2. Cut daylight points QcL = PcL + nL·offL,
  QcR = PcR + nR·offR, with family offsets offL/offR (Distance d,
  RelEl Δz/g, Elevation (E−Z)/g).
- Source anchor a(s) = V + tL·s for s ≤ 0, V + tR·s for s ≥ 0 (kinked at V
  by construction when δ≠0).
- Legislated scalar (identical for all laws, production authority):
  v(s) = vL + (vR−vL)·t via `evaluateTransitionLinearV1`, vL/vR the family
  endpoint scalars. Offset blend off(t) = offL + (offR−offL)·t.
- Comparison basis: same station t (same legislated scalar v). A law must fix
  where each v-contour sits, so same-station separation is the decision
  metric, not closest-point distance.
- Orientation: δ negates under x-axis mirror (y→−y); side convention
  carried. Reversal walks the route backwards (tangents negated, normals
  carried on the same physical strip, scalars/offsets swapped): positions
  must reproduce in reverse order. W dependence: cuts, anchors, and Hermite
  magnitudes all scale with W; near-bound rows use W = 2·min(LL,LR) − 0.001.

## LAW_HEADING — shortest-turn heading blend

- Frame: θL = atan2(nL), Δθ = wrapPi(θR−θL) with wrapPi to (−π,π];
  θ(t) = θL + t·Δθ; n(t) = (cos θ, sin θ).
- Shortest-turn policy is explicit: the wrap takes the smaller rotation;
  branch ambiguity is rejected, not resolved silently.
- Near-180 policy: if |(|Δθ| − π)| < 1e-9 rad → reject AMBIGUOUS_TURN.
  δ = ±179° stays defined (0.017 rad from π); exactly ±180° rejects via the
  shared antiparallel boundary below.
- Plan: p(t) = a(s(t)) + n(t)·off(t). C0 exact. Endpoint tangents do NOT match the member tangents, but the residual is NOT a pure deflection jump: it combines the legislated offset-blend slope (e.g. ~14° already at δ→0 for offL=5 vs offR=7 over W=8) with a deflection term (24.8°/39.9° at δ=45°, comfortable distance/left). The deflection-specific C1 break is the mid-interval kink (≈δ at the anchor corner, metered per row as midKinkDeg).

## LAW_NLERP — normalized linear blend of endpoint normals

- Frame: n(t) = normalize((1−t)·nL + t·nR).
- Singular policy: closed-form min blend length over t ∈ [0,1]; if it is
  < 1e-9 → reject SINGULAR_FRAME (exact fail-closed boundary for near-180
  antiparallel). δ = ±179° stays defined (min length cos(89.5°) ≈ 0.0087);
  exactly ±180° rejects via the shared antiparallel boundary.
- Plan: same anchored form p(t) = a(s(t)) + n(t)·off(t). C0 exact; endpoint-tangent residuals share the offset-blend base with heading plus a deflection term (23.7°/36.0° at δ=45°); mid-interval kink ≈δ like heading.

## LAW_HERMITE_EXPLICIT — cubic Hermite daylight connector

- Plan: p(t) = h00·QcL + h10·T0 + h01·QcR + h11·T1 with standard Hermite
  basis; endpoint tangents T0 = tL·m0, T1 = tR·m1.
- Magnitude rule: m0 = m1 = W/2. STATED BUT NOT PRINCIPLED — no derivation
  from member lengths, grades, or offsets exists, so this is an unresolved
  policy input, documented as counting against GO. Sensitivity m=W/4 vs W/2
  is measured per row (≈0.19 m at small δ, up to 0.5 m at 179°).
- Parametrization is linear in t (no arc-length reparam — that would be a
  further hidden policy choice).
- Frame: n(s) follows the path tangent under the production side convention
  (gradingSideNormal of p′(t)); tangent analytic from the basis derivative.
- C0 exact; C1 exact by construction at the endpoints (endpoint tangents ARE the member
  tangents) — Hermite's sole advantage, bought entirely with the arbitrary
  magnitude. The mid-interval kink stays small by construction (≤0.09δ for δ≤45°
  grid-wide), the smooth counterpart to the frame laws' ≈δ kink.
  Cusp policy: vanishing p′(t) at any station → reject CUSP.
- Note: fat magnitudes (W/2 vs chord) flatten the ends and rush the middle,
  so same-station positions differ from the frame laws by decimetres even at
  δ = 0.1° (0.53 m max, comfortable cuts). That is the law speaking, not a bug.

## Shared reject boundaries (all laws)

- Antiparallel: ||δ| − 180°| < 1e-9 deg → reject ANTIPARALLEL on every law
  (no unique turn direction). 180 − 5e-10° still rejects; 179° is defined.
- Non-finite/zero/negative W never reaches a law (WIDTH_INVALID); W beyond
  2·min(LL,LR) is WIDTH_INFEASIBLE; both pinned live against trp1.
- δ = 0 is NOT a law input: exactly collinear joints route to trp1
  (ADMITTED live, pinned for all three families).

## What the corpus measures per row per law

Cut points, 9 same-t stations (positions, tangents, normals, legislated
scalars), daylight positions (= the path), endpoint position/tangent
residuals, C0 flag, mid-interval kink (angle between the two segments meeting
at the middle station — the anchor corner — ≈δ on frame laws, small on
Hermite), curvature max + min radius, self-intersection (proper
crossing), foldover (consecutive-tangent reversal), daylight inversion
(INTERIOR stations only: the endpoint frames oppose each other past 90° by
input geometry, so endpoint firing carries no signal; past-90° interior firing
is necessary for any C0 blend, so only the δ≤90° domain discriminates laws),
overlap (non-adjacent station
coincidence within the agreement band), pairwise same-station divergences,
Hermite magnitude sensitivity, raw mirror / 1e6 / 1e8-translation / reversal
identities, live trp1 code, reject reason. Rejected-law numeric fields are NaN
in the builder and serialize as null in corpus.json (only the exact-180°
adversarial row rejects, all three laws ANTIPARALLEL).

## Headline numbers (comfortable cuts, W=8, max over signs×families×sides)

| δ | heading−nlerp | heading−hermite | nlerp−hermite | hermite m/2−m/4 |
|---|---|---|---|---|
| 0.1° | 5.8e-10 | 0.53 | 0.53 | 0.19 |
| 1° | 5.8e-7 | 0.54 | 0.54 | 0.19 |
| 5° | 7.3e-5 | 0.58 | 0.58 | 0.19 |
| 45° | 0.055 | 1.78 | 1.78 | 0.22 |
| 179° | 7.0 | 9.2 | 9.2 | 0.50 |

Agreement band at this scale: coordinateAgreementTol ≈ 1.4e-13. Every entry
above exceeds it by 3–13 orders of magnitude.

## Reading (verdict input, not verdict)

1. No unique path: three explicit laws sharing endpoints + scalar law differ
   by decimetres-to-metres at every realistic deflection — the 20N
   obstruction reproduced with legislated-form candidates.
2. The Hermite magnitude has no principled derivation, and the choice alone
   moves the path ~0.19 m. Legislating m0=m1=W/2 would enshrine an arbitrary
   number, not a geometric necessity.
3. Heading/nlerp buy explicit near-180 policies but leave a C1 tangent jump
   of order δ; Hermite buys C1 with the arbitrary magnitude. Each law's fix
   is another law's gap — no candidate dominates, and no existing authority
   selects between them.
4. Stability (mirror/reversal exact, translation at FP level) and C0 hold
   for all laws — determinism is not the blocker; selection is.
