# Phase 20O — topology, worker, and provenance (production use + future delta)

- Branch: `research/phase20o-noncollinear-transition-plan-law`, baseline `d093faf8`.
- Scope: STUDY ONLY. Zero `src/` changes. This document records (a) what the
  production topology certificate and worker validators do with non-collinear
  plans today, and (b) the exact design delta a future production phase would
  need. Nothing in (b) is implemented or authorized here.

## 1. Topology / gtop2 certificate: validates a declared law, never chooses one

Both-law-valid negative control (`tests/cad_grading_transition_gates_20o.test.ts`,
20O.3 — production authorities only, 20N study bridge laws as geometry input):

- Two study bridge laws (`nlerp` vs `heading`) over the same 45° source
  polyline (201 stations) both measure **1** positive-width region via
  production `countPositiveWidthRegions`, both build a valid strip via
  production `buildGradingStripMesh`, and both certify against the same
  production 1/1/1 expectation with clean revalidation
  (`gradingTopologyCertificateExactError → null`,
  `gradingTopologyCertificateProductionError → null`).
- Their daylight geometry diverges by **maxSep = 0.05270621892364438 m**
  (≈3000× the shared agreement band); mesh digests differ (`a4c43fd1…` vs
  `4550f494…`) while the source-boundary digest is identical.
- A deliberately wrong 2-region expectation does **not** certify (returns
  null) — the certificate is not vacuous.

Conclusion (forensics §6, §12): gtop2 validates **a declared topology**
against whatever geometry it is handed. It never encodes or selects the
plan/frame law. Disposition for any future phase: **reusable unchanged**.

## 2. Worker fail-closed evidence

- `checkGroupTransitionAgreement` on a non-collinear plan (member directions
  `1,0` / `cos45,sin45`) rejects with
  `GRADING_AGREEMENT_TRANSITION_GEOMETRY`: the worker re-admits through
  `admitGradingTransition`, `NON_COLLINEAR` falls to the `default` arm, and
  the plan is refused before any solve.
- `validateTransitionResultMesh` accepts the collinear control bridge
  (`null`) but rejects both law-correct non-collinear bridges (`nlerp` and
  `heading` at 45°) with `GRADING_AGREEMENT_TRANSITION_OFF_LAW`: the
  validator derives ONE normal from the source chord (`pCutR − pCutL`,
  `surfaceGradingCompute.ts` :~652) and asserts a constant-direction offset
  `d(s)·n`. For a non-collinear joint that single-normal basis is wrong by
  construction — the validator has no per-side or bridge-derived normal
  basis and no plan/frame field to carry one.

## 3. Future worker / provenance design delta (not implemented)

A future production phase would need, at minimum, each item below. Every
extra reproducibility parameter counts against policy-complete (decision
criterion G7/G8): the list is long because the law is missing, and each
entry is a policy input, not an implementation detail.

1. **Request/response plan fields**: the worker agreement request and the
   persisted plan must carry the interior plan/frame bridge (per-station
   frames or an equivalent closed form), not just endpoints + width.
2. **Law kind + version + law-specific params**: a versioned plan-law
   identifier (peer to `TRANSITION_LINEAR_V1`/`v1`) plus every param the law
   needs — including the Hermite magnitude rule or its replacement, the
   near-180 branch policy, and the C1 acceptance budget. Each param is a
   separate policy decision.
3. **Endpoint/frame evidence**: pinned endpoint frames (`nL`/`nR` under the
   production side convention) recorded per joint so re-admission reproduces
   the exact basis.
4. **Result-leg checkpoints**: per-joint result legs checked against their
   OWN bridge-derived checkpoints (the 20N.1 plural pattern:
   `validateGroupTransitionLegsMesh` per leg), never against one chord normal.
5. **Revision hashing**: the plan-law kind/version/params join the
   `ggrev1` hash input (canonical order); a law change must rehash, never
   silently reuse.
6. **Extract/Bake citations**: per-joint leg↔intent match plus a plan-law
   citation per bridge (`transitionResultBakeCitation` extended); citation-
   less transitioned Bake refuses as today.
7. **Stale/mismatch refusal**: stale plan-law version or param mismatch
   fails the group closed (`MEMBER_REF_STALE`-class bounded code); no silent
   fallback to another law or to the chord basis.
8. **UI fields**: the transition panel gains a plan-law authoring surface
   (currently a fixed single-option selector, `CadGradingGroupTransitionPanel`
   :250–255) — extensible only after the law exists, never before.

Until (1)–(8) are specified by policy, production remains correctly
fail-closed at `NON_COLLINEAR`, and the worker correctly refuses
non-collinear plans at `GEOMETRY`/`OFF_LAW`.
