# Phase 20O — Non-collinear transition forensics

Branch: `research/phase20o-noncollinear-transition-plan-law` @ `d093faf8`.
Verdict inherited from Phase 20N: **`POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW`**.

Production admits only a strictly-separated **collinear, same-family,
equal-grade, exactly-flat, open, same-side** transition (`trp1` /
`TRANSITION_LINEAR_V1`). Every non-collinear source deflection fails closed
at the `NON_COLLINEAR` gate. This document is a **study-only** inventory of
the production authorities a non-collinear transition would touch, the
pieces reusable unchanged, and the pieces that would need **new authority**.

All line references are at `d093faf8`; ranges marked `≈` were re-verified
against this checkout and are the authoritative values where the original
trace differed by a few lines.

## 1. The single admission authority (`trp1`)

`src/engine/cad/grading/gradingTransitionPolicy.ts`

- Version/law constants: `TRANSITION_POLICY_VERSION = 'trp1'`,
  `TRANSITION_LAW_KIND = 'TRANSITION_LINEAR_V1'`,
  `TRANSITION_LAW_VERSION = 'v1'` (:19–21).
- **`NON_COLLINEAR` gate** (:176–179):
  ```ts
  const cross = left.dirX * right.dirY - left.dirY * right.dirX;
  const dot   = left.dirX * right.dirX + left.dirY * right.dirY;
  if (!(cross === 0 && dot > 0))
    return fail('NON_COLLINEAR', 'source deflection must be exactly 0');
  ```
  EXACT check — no tolerance, no default. Deflection `δ ≠ 0` always
  produces `cross ≠ 0` (and `δ = 180°` produces `cross = 0, dot < 0`), so
  both fail closed. The check runs *before* `NON_FLAT`, `JOINT_Z_STEP`,
  `SIDE_MISMATCH`, `FAMILY_MISMATCH`, `GRADE_MISMATCH`, and all width
  checks, so no adverse input can smuggle a non-collinear joint past it.
- Reject vocabulary: `TransitionRejectCode` includes `NON_COLLINEAR`:35.
- Authoring mirror string (:168):
  `'source deflection must be exactly 0 (collinear only)'` from
  `reasonOf('NON_COLLINEAR')` inside `transitionJointEligibility`
  (`gradingTransitionAuthoring.ts`).
- Policy reject → bounded group diagnostic:
  `transitionRejectGroupCode` (:310) maps `NON_COLLINEAR` (and the other
  non-stale content rejects) to `TRANSITION_REJECTED`.

## 2. `TRANSITION_LINEAR_V1` is scalar-only

`gradingTransitionPolicy.ts`

- `evaluateTransitionLinearV1(vL, vR, sL, sR, s)` (:208–216):
  `v(s) = vL + (vR - vL) * t`, `t = (s - sL)/(sR - sL)`; interval
  `[-W/2, +W/2]`.
- `scalarOf` (:148) resolves the endpoint scalar **per family**: Distance
  `d`, Relative-Elevation `Δz`, flat Elevation `E`.
- The law knows **only a scalar along the source station**; it carries no
  plan direction. Scalar → plan XYZ happens later in
  `transitionDaylightAt` (`gradingGroupTransitionTile.ts`:99) using a
  caller-supplied `(nx, ny)` normal. That normal is the entire frame input:
  for a non-collinear joint **there is no single correct normal**, and the
  law has no way to encode the choice.

## 3. Single-frame assumption in the tiler

`src/engine/cad/grading/gradingGroupTransitionTile.ts`

- `planTransitionJoint` (:125) admits the intent, then tiles both incident
  members.
- `frameL = solved[L]`, and **both** cut points take their tangent/normal
  from the LEFT frame: `tx = frameL.tOut.nx`, `ty = frameL.tOut.ny`,
  `nx = frameL.nOut.nx`, `ny = frameL.nOut.ny` (:246–249).
- Joint daylight uses the left normal (:255).
- `PcL` on the left tangent (≈:267) and `PcR` **also on the left tangent**
  (≈:297) — `PcR = V + tx * W/2`. This is correct only when
  `frameL.tOut === frameR.tIn` (collinear). For `δ ≠ 0` the right cut point
  should follow the right tangent; today it lands `W·sin(δ/2)` off the
  right member.
- Comment (:123–127) states the C0 construction explicitly: "natives meet
  the transition law exactly (C0 by construction). **No C1.**"

`src/engine/cad/grading/gradingGroupTransitionPlural.ts`

- `planTransitionGroup` (:271) and `stitchGroupMember` (:73, :503) repeat
  the same single-frame construction for the plural (N > 1) path; the
  joint plan (:457–460) again consumes the left frame's tangent.
- `frameL = solved[L]` (:503) and the same left-normal daylight apply.

`src/engine/cad/grading/gradingGroupCompute.ts`

- Frame source: `chordDir` (:165) → `gradingSideNormal` (:511–518)
  (`tIn/tOut`, `nIn/nOut`).
- Comment (:123–127 region) repeats "No C1".
- The merge/corner loop records a **`TANGENT`** corner per transitioned
  joint (≈:633–644) with
  `miterRay = { mx: jointPlan.tx, my: jointPlan.ty }` — a **single tangent**,
  never a real miter between the two member tangents.

## 4. Tangent / normal authorities

- `gradingSideNormal(tx, ty, side)` (`gradingCourseFrame.ts`:35–49):
  `Nleft = (-ty, tx)`, `Nright = (ty, -tx)`; degenerate input → `null`.
- The worker's cut-line normal is `gradingSideNormal` at
  `surfaceGradingCompute.ts` (:644), derived from the source chord
  `pCutR - pCutL`. **Collinearity-dependent**: it is the correct tangent
  only when the source is straight.

## 5. Worker agreement and result validation

`src/workers/surfaceGradingCompute.ts`

- `checkGroupTransitionAgreement` (:357) re-admits through
  `admitGradingTransition` (so a non-collinear plan rejects there);
  `NON_COLLINEAR` is not in the switch and falls to the `default` →
  `GRADING_AGREEMENT_TRANSITION_GEOMETRY` (:437–442).
- `validateTransitionInteriorVertices` (:484) checks the scalar law at each
  station — scalar-only, frame-independent.
- `validateTransitionResultMesh` (:614) expects **9-wide checkpoints**
  `qCutL/q0/qCutR` and `pCutL/V/pCutR`; after the law/native/anchoring
  checks it derives **one** normal from `pCutR - pCutL` (:~652) and asserts
  a constant-direction offset `d(s)·n` for all three stations. For a
  non-collinear joint this single-normal basis is wrong by construction.
- Multi-joint: `checkGroupTransitionPlansAgreement` (:707),
  `validateGroupTransitionLegsMesh` (:778).
- Handler `surfaceWorkerHandler.ts`: `transitionPlansOf` (:579),
  `resolveTransitionMemberViews` (:600/:615),
  `validateTransitionResultMeshAgainst` (:663),
  `canonicalTransitionFromPlan` (:709).

## 6. Topology: expectation + gtop2 certificate

- `buildGradingStripMesh` (`gradingMesh.ts`:89): deterministic strip
  triangulation between a source and a daylight polyline; tied cells
  contribute no triangles; a single tied hinge is a vertex pinch.
- Region counting has **two** authorities that differ deliberately:
  `countPositiveWidthRegions` (`gradingTopologyCertificate.ts`:94,
  cell-pair runs) vs `countPositiveWidthStationRuns`
  (`gradingTopologyExpectation.ts`:31, station runs — a single tied station
  breaks a run).
- `deriveGradingTopologyExpectation` (:78, policy `20k3.1`) derives the
  declaration **pre-mesh**; `deriveTransitionExpectation` (:299) and
  `deriveTransitionSetExpectation` (:241) declare the 1/1/1 merged open
  strip from pre-mesh scalars only.
- Production wiring (`gradingGroupCompute.ts`): pre-mesh expectation
  :932–938; per-joint / plural gates :555–586; gtop2 builder :525;
  measured-region revalidation :589; production gate `GROUP_NON_MANIFOLD`
  :343/:908/:951; certificate emitted :997–1010.
- **Key property (proved by the 20O test controls):** gtop2 validates a
  **declared** topology against whatever geometry it is handed. It never
  encodes or selects the plan/frame law. Two materially different daylight
  laws with the same 1/1/1 declaration both certify.

## 7. Revision and persistence

- `gradingGroupRevision.ts`: `transitions` in the hash input (:48),
  `exactTransitionWidth` (:148), `transitionText` (:158),
  `buildGroupRevision` (:175).
- `gradingGroupTypes.ts`: `CadGradingTransition` (:138–149),
  result transition legs (:260+), `result.transition` (:241) /
  `result.transitions` (:249).
- `gradingGroupPersistence.ts`: clone (:46), sanitize (:69/:87),
  re-attach verbatim (:229–231).

## 8. Provenance and commands

- `gradingTransitionProvenance.ts`: `transitionEvidenceMatchesIntent` (:29),
  `buildTransitionProvenance` (:68), `transitionResultBakeCitation` (:135),
  `transitionResultBakeCitations` (:148), `applyTransitionProductGate`
  (:184 — **UNWIRED**, test-only today).
- `cadTransactionsGradingGroupCommands.ts`: `transitionLegsOf` (:98),
  positional match (:112/:136), GROUPBAKE gate (:619–634/:668),
  extract refusal (:533–537).

## 9. UI

- `CadGradingGroupTransitionPanel.tsx`: imports (:22–25), row rendering
  (:222), and a **fixed single-option law selector** (:250–255) — the UI
  offers exactly `TRANSITION_LINEAR_V1`. There is no place to author a
  plan/frame law.

## 10. Point/seam-only authorities (NOT a path selector)

These all produce a **single point** (width-independent), so none of them
legislates a finite-width interior plan/frame law:

- `gradingCornerMath.ts`: `miterSeam` (:102), `selectMiterRay` (:118),
  `miterExtent` (:140).
- `solveAnalyticCorner` (`gradingGroupAnalyticCorners.ts`:154).
- `solveExactOffsetJoin` (`gradingExactOffsetGeometry.ts`:268) — line/line
  reduces to the same miter point; arc-bearing gives a concentric-circle
  point; never a bridge.
- Hybrid seams: `gradingGroupHybridCorners.ts` (:151/:195/:209/:242/:356).
- Chord seam: `gradingChordSeam.ts`:478.

## 11. Phase 20N prior art

- Only **two** study laws were exposed, both for the plan/frame bridge:
  `candidateBFrameNlerp` and `candidateBFrameHeading`
  (`scripts/phase20nTransitionExpansionStudy.ts`:111/:119).
- **No Hermite or Bezier** bridge appears anywhere in the tree.
- `smoothstep` was explicitly rejected as a smuggled default.
- Verdict: `POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW` — no existing authority
  selects a plan path, so a non-collinear law is a policy decision, not an
  implementation detail.

## 12. Study-test findings (this phase)

Pins live in `tests/cad_grading_transition_gates_20o.test.ts`.

**Gate / adversarial table.** Every signed deflection
`{±0.1, ±1, ±5, ±15, ±30, ±45, ±90, ±135, ±170, ±179}°` rejects with code
`NON_COLLINEAR` and detail `source deflection must be exactly 0`; the
authoring mirror returns `source deflection must be exactly 0 (collinear
only)`. Only the exact `0` (including `-0`) deflection admits. The full
adversarial table (antiparallel, zero/negative/NaN/Inf/over-member width,
family/grade/side mismatch, sloped source, joint-Z step, arc member, closed
group, cardinality, stale ref) rejects at its bounded code.

**Topology negative control.** Two study bridge laws (`nlerp` vs `heading`)
over the same 45° source polyline:

- both measure **1** positive-width region via production
  `countPositiveWidthRegions`;
- both build a valid strip via production `buildGradingStripMesh`;
- both certify against the same production 1/1/1 expectation and revalidate
  clean (`gradingTopologyCertificateExactError` → `null`,
  `gradingTopologyCertificateProductionError` → `null`);
- their daylight geometry diverges by **`maxSep = 0.05270621892364438 m`**
  (≈3000× the shared agreement band), and their mesh digests differ
  (`a4c43fd1…` vs `4550f494…`) while the source-boundary digest is
  identical;
- a deliberately wrong 2-region expectation does **not** certify.

Conclusion: gtop2 validates **a declared law**, it never chooses one.

**Worker-basis gap.** `checkGroupTransitionAgreement` on a non-collinear
plan (member directions `1,0` / `cos45,sin45`) rejects with
`GRADING_AGREEMENT_TRANSITION_GEOMETRY`. The collinear control bridge
passes `validateTransitionResultMesh` (`null`), while both the `nlerp` and
`heading` law-correct non-collinear bridges are rejected at
`GRADING_AGREEMENT_TRANSITION_OFF_LAW` because the validator derives one
normal from the source chord. The worker has neither a plan/frame field nor
a per-side normal basis for a non-collinear joint.

## 13. Reusable / extensible / new authority

| Concern | Disposition | Evidence |
|---|---|---|
| `TRANSITION_LINEAR_V1` interior scalar law | **Reusable unchanged** — scalar-only, frame-independent | `gradingTransitionPolicy.ts`:208–216; `evaluateTransitionLinearV1` |
| Admission machinery minus the collinearity conjunct | **Reusable (modified predicate)** — all other exact checks (flat, joint-Z, side, family, grade, width, native) still apply | `gradingTransitionPolicy.ts`:180–207 |
| Worker interior-law check | **Reusable unchanged** — checks `d(s)` magnitude only | `validateTransitionInteriorVertices` |
| Topology validators + gtop2 certificate | **Reusable unchanged** — validate a declared 1/1/1 shape, law-agnostic | `gradingTopologyCertificate.ts`:94/:525; §12 controls |
| Revision / persistence shapes | **Reusable unchanged** — transitions ride verbatim; hash includes widths | `gradingGroupRevision.ts`:148/:158/:175; `gradingGroupPersistence.ts`:46/:229 |
| `lawKind` / `lawVersion` enums and citation arrays | **Extensible** — add a new kind/version and citation entries without touching the numeric law | `TransitionLawKind`/`TransitionLawVersion`; `transitionResultBakeCitation` |
| `NON_COLLINEAR` gate itself | **Extensible (policy)** — replace the exact-zero conjunct with a new admission predicate once a law exists | `gradingTransitionPolicy.ts`:176–179 |
| Plan/frame bridge law (finite-width interior path between two distinct tangents) | **NEW AUTHORITY required** | no selector exists; §2–§3; 20N C3 |
| Worker normal basis (per-side / bridge-derived, not one chord normal) | **NEW AUTHORITY required** | `validateTransitionResultMesh`:614–660 |
| Reversal / mirror identity semantics for a non-collinear bridge | **NEW AUTHORITY required** — must be defined and pinned before persist/undo | 20N `reversalStable`/`mirrorStable` only pin the point metrics today |
| UI law authoring surface | **EXTENSIBLE only after the law exists** | `CadGradingGroupTransitionPanel.tsx`:250–255 currently single-option |

**Bottom line.** The scalar law, admission checks (minus collinearity),
topology validators, and persistence shapes are reusable. The blocker is a
single missing authority: a persisted plan/frame bridge law plus the worker
normal basis and explicit reversal identity that go with it. Until that law
is chosen and certified by policy, production remains correctly fail-closed
at `NON_COLLINEAR`.
