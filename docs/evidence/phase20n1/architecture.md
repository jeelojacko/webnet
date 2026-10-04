# Phase 20N.1 — Architecture: multi-member atomic tiling

## Claim

One open group admits transitions T1..TN (N ≥ 1) iff **every** Ti passes the
full 20M.2 single-transition admission (`trp1`) **and** the whole set passes
group separation. Validation is **all-first**: every intent is validated
against immutable solves before any member is rebuilt; then each affected
member is rebuilt **exactly once** (stitch-once).

## Where it lives

- Policy authority: `src/engine/cad/grading/gradingTransitionPolicy.ts`
  (`selectGroupTransitions`, `parseCanonicalJointIndex`,
  `checkGroupTransitionSeparation`, `deriveGroupTransitionExpectation`).
  `selectGroupTransition` (singular) kept byte-identical with its N ≤ 1 cap;
  `admitGradingTransition` untouched.
- Engine tiling: `planTransitionGroup` + `stitchGroupMember` in
  `src/engine/cad/grading/gradingGroupCompute.ts`. `GroupSolveInput`
  gains `transitions[]` (mutually exclusive with the singular field;
  length-1 routes the legacy path byte-identical).
- Shared-member rule: a member claimed by two adjacent transitions is rebuilt
  once with **one native mid-subsolve**; singly-claimed ends keep the legacy
  shape and share V/q0 refs. TANGENT legs recorded per joint via map.
- Gate before topology: measured mesh regions must equal expected
  (`measured===expected`), then `gtop2` exact revalidation.
- Result shape: `result.transitions[]` in canonical joint order.

## Single-transition parity path

N = 1 never touches the group path: singular input still flows through
`selectGroupTransition` → legacy stitch. Wave L re-verified one staged
transition solves CURRENT (the only behavior change: per-joint authoring
keeps Add/Update visible, superseding the old 20M.2 "Add is gone" pin).

## What this is not

- **Merged Phase 20N study proof**: study harness (`scripts/phase20nMultiTransitionMesh.ts`,
  39 pins) proved a shared-member 2T/3T mesh *can* tile; it never shipped a
  production path. 20N.1 is the production path described above.
- **Candidate B (non-collinear)**: still deferred, POLICY_REQUIRED. Nothing
  here admits a bent joint (Flow H fails closed).
- **Narrowings found during implementation**: consecutive joints only for
  N > 1 (sparse sets rejected whole-group); strict separation is the exact
  `<` comparison `Wi/2 + W(i+1)/2 < Lshared` (touching `==` rejects).
