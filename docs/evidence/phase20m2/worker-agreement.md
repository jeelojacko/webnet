# Phase 20M.2 worker agreement — re-resolve / recheck basis

The worker trusts nothing the service pins. `GroupTransitionPlan` (extends canonical
`CadGradingTransition`) carries the intent, but the handler pre-solve gate re-resolves every basis
element from live project state and rechecks the frozen predicate before any solve:

- Re-resolve: both adjacent natives through the bounded analytic authority at the authoritative source Z
  (must resolve ok/finite; maxSearch/in-bounds where applicable; no extension/target-root machinery).
- Recheck: OPEN group, line-only, flat both sides, exact joint Z, same side, same target-free family,
  exact `gL === gR`, exact collinearity 0, explicit W finite with `0 < W <= 2*min(LL,LR)` exact,
  exactly one transition (`>1` rejects), recorded revision == live revision (stale FAILS CLOSED).
- Agreement/vertex validators run under the shared tolerances (`zeroDelta` untouched, no new epsilon).

Bounded reject codes (fail closed, never fallback): `TRANSITION_*` family via the shared
`transitionRejectGroupCode` (policy-owned; compute re-exports), surfacing as `CORNER_NO_SOLUTION` /
`MEMBER_NO_SOLUTION` with the bounded detail at the group level. A malformed or stale intent yields a
bounded code pre-dispatch (service) or at the gate (worker) — the mesh path is never entered.

Covered by `tests/cad_grading_transition_worker_20m2.test.ts` 5/5, including a real kernel solve,
plus the Wave I production fix: the service previously dropped the intent in transit
(`requestGroupGrading` never sent plan/members/keys → 8/10 browser flows failed `CORNER_NO_SOLUTION`);
the fix (`planGroupTransitionRequest`, pure; `selectGroupTransition` + `TransitionSelection` moved to
policy as the single cardinality gate) is pinned by the same suite and the 10/10 browser spec.
