# Phase 20Q.1 — Architecture: production S1 singular sloped transitions

## Claim

One open group admits **exactly one** joint-continuous sloped transition
intent (S1, piecewise-physical) in all three analytic families. The source
is sloped, the joint Z is continuous, the interior scalar law is the
already-legislated `TRANSITION_LINEAR_V1`; only the outer native cuts are
solved on the true per-station source Z. Flat behavior is byte-identical.

## Production shape (S1)

- **Admission** (`gradingTransitionPolicy.ts`): collinearity/family/grade/
  side/width/native gates unchanged. The old hard `NON_FLAT` refusal becomes
  a bounded predicate — a non-flat pair admits iff the joint stays **exactly**
  continuous (`left.endZ === right.startZ === input.jointZ`) and all four
  member Zs are finite. `JOINT_Z_STEP` is untouched and still rejects a
  joint-discontinuous pair. No epsilon, no angle bound.
- **Tiling** (`gradingGroupTransitionTile.ts`): the joint carries the exact
  joint Z (`Z = mL.endZ`); the two cut points resolve their own member's
  physical source Z via `transitionSourceZAt` (left half on the left member,
  right half on the right member). The outer `solveGradingChord` sub-solves
  run on the true member start/end Z instead of a frozen joint Z. Interior
  interval endpoints stay shared object refs, so the natives meet the law
  C0-exactly (no C1 claim).
- **Plural scope** (`gradingGroupTransitionPlural.ts`): before per-joint
  admission, a set with more than one intent and **any** non-flat
  transitioned joint rejects the whole group via the one
  `checkSlopedPluralUnstudied` authority.
- **Authoring** (`gradingTransitionAuthoring.ts`): the same authority
  disables a joint offer that would form/extend a plural set while any
  transitioned joint is non-flat ("singular sloped only").
- **Service** (`surfaceGradingService.ts`): `planGroupTransitionRequest`
  applies the same gate before planning any intent.
- **Worker** (`surfaceGradingCompute.ts`): the post-solve mesh validator
  resolves every checkpoint at its **own** source Z; the pre-solve
  plans-agreement gate applies the same plural gate whole-group.

## Files changed (this branch, all uncommitted)

| File | Change |
|------|--------|
| `src/engine/cad/grading/gradingTransitionPolicy.ts` | sloped admission predicate; `checkSlopedPluralUnstudied`; `transitionSourceZAt` |
| `src/engine/cad/grading/gradingGroupTransitionTile.ts` | per-station cut Z; outer subsolves on true member Z |
| `src/engine/cad/grading/gradingGroupTransitionPlural.ts` | whole-group sloped-plural reject |
| `src/engine/cad/grading/gradingTransitionAuthoring.ts` | eligibility gate |
| `src/workers/surfaceGradingCompute.ts` | per-checkpoint-Z mesh validator; plans-agreement gate |
| `src/workers/surfaceGradingService.ts` | request-assembly gate |

Tests changed: `cad_grading_transition_mesh_20m2.test.ts` (new S1 full-compute
pin), `cad_grading_transition_panel_20n1.test.tsx` (4 sloped/step UI pins),
`cad_grading_transition_sloped_20q.test.ts` (freeze pins → admitted truth),
`cad_grading_transition_step_20q.test.ts` (validator width accounting). New:
`cad_grading_transition_sloped_20q1.test.ts`, `..._sloped_plural_20q1.test.ts`,
`..._robust_20q1.test.ts` (+ `..._sloped_20q1.helpers.ts`).

## Flat parity

When both members are exactly flat, `transitionSourceZAt` returns `startZ`
bitwise, so `cutLZ === cutRZ === Z`; every existing flat path (single,
multiple, sparse) is unchanged and bounded by the all-flat plural guards.

## What this is not

- **S2/S3**: smoothed-bridge / daylight-only smoothing laws are not
  implemented; the study rejected them (authority-violating source mutation).
- **Joint-step**: `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY` (20Q study) stands;
  the step path is unchanged and still fails at `JOINT_Z_STEP`.
- **Plural sloped**: unstudied, whole-group rejected — not partially tiled.
- **Non-collinear**: Phase 20O stays `POLICY_REQUIRED_NONCOLLINEAR` frozen.
