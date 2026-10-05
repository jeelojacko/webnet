# Phase 20Q.1 — Worker agreement: per-checkpoint source Z

## Per-checkpoint-Z mesh validator

`validateTransitionResultMesh` (`src/workers/surfaceGradingCompute.ts`) checks
the result-owned leg against the legislated law:

- **Interior** (`validateTransitionInteriorVertices`): each transition-owned
  vertex re-evaluates `evaluateTransitionLinearV1` at its own station. The
  observed scalar uses the vertex's own source mate: distance =
  horizontal distance to `srcX/srcY`; relative-elevation = `z - srcZ`;
  elevation = `z`. Non-finite or out-of-interval stations fail closed.
- **Boundary**: `checkNativeBoundary` resolves each end criterion at that
  checkpoint's own `srcZ` (Phase 20Q.1 — never a frozen `jointZ`). On flat
  inputs `srcZ === jointZ` bitwise, so flat validation is unchanged.
- **Direction + Z**: the plan offset must leave along the production side
  normal; the expected daylight Z is `source.z + g·expectedV` for distance and
  `(expectedV - source.z)/g` for elevation — per-checkpoint source Z.
- **Anchoring**: every checkpoint pair must occur in the result-owned
  daylight/source boundary arrays (`GRADING_AGREEMENT_TRANSITION_GEOMETRY`).

No new epsilon: the shared `coordinateAgreementTol` / `elevationAgreementTol`
+ `AGREEMENT_FLOOR` authorities are reused verbatim.

## Agreement path

- **Plan-level** `checkGroupTransitionAgreement(plan, members, liveRevision)`:
  re-admits from the worker-resolved member views via
  `admitGradingTransition`, then compares the re-resolved endpoint scalars
  against the pinned `endpointEvidence` (exact same-build comparison) and the
  `recordedRevision` against the live revision.
- **Plural** `checkGroupTransitionPlansAgreement`: canonical order, per-plan
  re-admission, strict separation recomputed from authoritative lengths, and
  the singular-sloped cardinality gate applied whole-group before any plan.
- Distance scalars are slope-independent, so a flat-pinned distance evidence
  matches the sloped re-resolution exactly — the singular sloped leg agrees.

## Tamper / stale behavior (bounded codes)

| Condition | Outcome |
|-----------|---------|
| `recordedRevision !== liveRevision` | `GRADING_AGREEMENT_TRANSITION_STALE` |
| member/ref identity mismatch, `MEMBER_REF_STALE` | `…STALE` |
| pinned `vL`/`vR` ≠ re-resolved (evidence tamper) | `…STALE` |
| policy/`trp1` version unknown | `…VERSION_UNKNOWN` |
| law kind/version unknown | `…LAW_UNKNOWN` |
| `transitionCount !== 1` | `…OVERLAP` |
| family/grade mismatch | `…FAMILY_MISMATCH` |
| width infeasible | `…WIDE` |
| boundary/offset off the law | `…OFF_LAW` |
| checkpoint not in result boundary | `…GEOMETRY` |
| plural set with any non-flat joint | `…GEOMETRY` (whole-group) |

## Evidence

- `tests/cad_grading_transition_sloped_20q1.test.ts` — worker agreement holds
  on sloped members; `vL + 1` tamper rejects.
- `tests/cad_grading_transition_robust_20q1.test.ts` — singular sloped agrees,
  tampered `vR` rejects; plural sloped worker rejects whole-group; all-flat
  plural still agrees.
- `tests/cad_grading_transition_sloped_plural_20q1.test.ts` — sloped 2-plan
  group rejects at `GRADING_AGREEMENT_TRANSITION_GEOMETRY`.
- `tests/cad_grading_transition_step_20q.test.ts` — M2 step-J1 width
  accounting is now `156 applicable caught / 0 inapplicable / 0 missed`
  (own-Z resolution makes every step row applicable to the validator; the
  validator never sees a stepped mesh in production because admission
  refuses steps).

## What this is not

- **A study oracle**: these are the production worker entry points.
- **A slope bound**: no new tolerance or angle threshold is introduced.
- **Joint-step admission**: the validator can be probed on step meshes, but
  production admission still refuses them (`JOINT_Z_STEP`).
