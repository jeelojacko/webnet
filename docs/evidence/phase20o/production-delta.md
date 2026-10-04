# Phase 20O — production delta (future phase requirements, no implementation)

- Branch: `research/phase20o-noncollinear-transition-plan-law`, baseline `d093faf8`.
- Scope: STUDY ONLY. Zero `src/` changes. This document lists what a future
  production phase would require. None of it is implemented, authorized, or
  scheduled here. Verdict: POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW
  (`decision.md`) — the delta below is blocked until the §2 policy inputs of
  `decision.md` resolve.

## 1. Admission predicate delta

- Replace the exact-zero collinearity conjunct (`NON_COLLINEAR`,
  `gradingTransitionPolicy.ts` :176–179) with a bounded non-collinear
  predicate: admissible angle domain (with geometric rationale per
  `decision.md` §3), flat / joint-Z / side / family / grade / width checks
  unchanged, plus per-law reject boundaries (antiparallel, singular frame,
  cusp) as bounded codes — not silent fallbacks.
- Reject vocabulary additions: `ANTIPARALLEL`, `SINGULAR_FRAME`/`AMBIGUOUS_TURN`,
  `CUSP` (study codes), plus a stale-law-version code (cf. `MEMBER_REF_STALE`
  pattern). Authoring mirror strings for each, and group-diagnostic mapping.

## 2. Tiling / frame changes

- `planTransitionJoint` / `planTransitionGroup` (and the plural path) must
  stop consuming the single left frame: cut points per member tangent
  (`PcR` on the right tangent), joint daylight from the legislated bridge,
  and a real two-tangent corner record instead of the single-tangent `TANGENT`
  entry. Interior station measure over the bent interval must be defined
  (the single-frame `s` along the left tangent does not exist for δ≠0).

## 3. Worker recomputation

- Agreement: admit the persisted plan-law kind/version/params per joint;
  refuse unknown or stale laws fail-closed.
- Result validation: replace the single chord-normal basis with the
  bridge-derived basis (per-side normals or bridge frames); check every
  result leg against its OWN checkpoints. Interior scalar check
  (`validateTransitionInteriorVertices`) reuses unchanged.

## 4. Revision / provenance / citation / UI deltas

- `ggrev1` hashes plan-law kind/version/params in canonical joint order.
- Provenance records endpoint-frame evidence + law citations per bridge;
  Extract refuses leg↔intent mismatch per joint; Bake cites per-bridge law
  and refuses citation-less transitioned Bake.
- Transition panel gains a plan-law authoring surface (single-option
  selector today). UI work starts only after the law is legislated.

## 5. Topology handling

- None required beyond current machinery: declare the 1/1/1 merged open
  strip pre-mesh, measure post-tiling, certify with gtop2 (both-law-valid
  control proves law-agnosticism). Only new work: if a legislated law can
  produce a non-1/1/1 shape (e.g. self-intersecting 90° nlerp-class bridges),
  the expectation derivation must exclude or bound that domain — a policy
  input, not a code gap.

## 6. Explicitly out of scope for the future phase

- No tolerance/epsilon changes (study uses the shared agreement band as a
  comparison floor only). No smoothing of the C1 jump unless the legislated
  law owns it. No migration of existing collinear transitions (their law,
  hashes, and citations are unchanged).
