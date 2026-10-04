# Phase 20N.1 — Worker agreement: plural wiring

Every transition plan carries **its own** checkpoints, re-checked at each
stage (per-transition, not per-group):

- **Normalizer**: `transitionPlansOf` (in `surfaceWorkerHandler.ts`)
  accepts singular or plural request shapes; dual-field (both set) is
  malformed and rejects.
- **Service planner**: routes via `selectGroupTransitions` with per-joint
  `jointStation`; any joint failure rejects the whole group.
- **Pre-solve**: `checkGroupTransitionPlansAgreement` re-admits every plan
  (canonical order + per-joint re-admission + strict separation recomputed
  from authoritative member lengths) against the live revision.
- **Post-solve**: `validateGroupTransitionLegsMesh` checks EVERY leg
  against its OWN checkpoints (no cross-leg averaging).
- **Plumbing**: `canonicalTransitionsFromPlans` / `toGroupSolveInput`
  carry the plural shape engine-side; legacy singular request/response
  shapes are preserved byte-identical.

## What this is not

- **20N study**: study wording about "plural wiring" was explicitly scoped
  as *not proven*; 20N.1 proves it (Wave F+G tests + Wave J real-kernel
  agreement pins + Wave I browser flows).
- **Candidate B**: agreement covers collinear transitions only; bent joints
  never reach agreement (rejected at policy).
- **Narrowing**: per-joint re-admission uses authoritative (post-edit)
  lengths, so a middle-width edit invalidates the group (Flow F) — agreement
  is re-derived, never cached across edits.
