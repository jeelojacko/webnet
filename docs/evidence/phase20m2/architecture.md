# Phase 20M.2 architecture — collinear same-family transition production

Single implemented predicate (frozen, §9 of `docs/evidence/phase20m1/decision.md`):

- OPEN group, line-source members only, EXACTLY ONE transition (`trp1`, cardinality ≤ 1; `>1` rejects).
- Stable adjacent joint via `courseCriterionKey`; both members flat; exact joint Z (`endZ === startZ`).
- Same side; same target-free family (Distance / RelativeElevation / flat Elevation); exact `gL === gR`.
- Exact collinearity 0 (no bend); explicit user width W, finite, `0 < W <= 2*min(LL,LR)` exact.
- Blended interval `[-W/2, +W/2]` about the joint; law `TRANSITION_LINEAR_V1`: `v(s) = vL + (vR-vL)*t`.
- Both adjacent natives independently resolve ok (bounded analytic resolution at authoritative source Z;
  maxSearch/in-bounds where applicable; no extension/target-root machinery).

Fail-closed exclusions (all reject, never fallback): Surface members, hybrid/domain mixes, arc members,
closed groups, sloped/stepped/diff-Z joints, mixed families, non-collinear joints, second transitions,
unsupported families, malformed or stale intents (stale = recorded revision ≠ live revision).
Old files without intents solve legacy-identical; `>1` staged intent rejects.

No C1 claim: the mesh is C0 (position-continuous) only; tangents are not matched.

## Module map

| Concern | Authority |
| --- | --- |
| Admission predicate | `src/engine/cad/grading/gradingTransitionPolicy.ts` (`selectGroupTransition`, `transitionRejectGroupCode`) |
| Pre-mesh expectation | `deriveTransitionExpectation` (group 1/1/1; pre-mesh `WIDE`/`MALFORMED`/`OVERLAP` fails; legacy identical; `gtop2` reused) |
| Worker agreement | `GroupTransitionPlan` (extends canonical `CadGradingTransition`) + agreement/vertex validators under shared tols + handler pre-solve gate |
| Product/provenance | `gradingTransitionProvenance` (builder + gate + citation) + `GROUPBAKE` citation |
| Authoring/UI | `gradingTransitionAuthoring` + `GROUP_SET`/`CLEAR_TRANSITION` commands + TransitionPanel tab |
| Service carry | `planGroupTransitionRequest` in `src/workers/surfaceGradingService.ts` (pure; absent intent = exact legacy request) |
| Persistence | Additive optional `transitions` intents; sanitation retains invalid intent; `ggrev1` participation without circularity (see `persistence-revision.md`) |

## Data flow

Author (TransitionPanel → `GROUP_SET_TRANSITION`, one intent, explicit W) → persist/sanitize (every present entry retained as invalid-or-valid intent; present-but-unreadable fields/entries become malformed markers that fail closed, never legacy) → service `planGroupTransitionRequest` (selects intent, verifies refs against live traversal keys, runs frozen admission authority, pins endpoint evidence + recorded revision AND carries persisted endpoints/provenance verbatim; any reject fails closed pre-dispatch with a bounded `TRANSITION_*` code) → worker handler pre-solve gate (member geometry re-resolved from the request's own memberSources, never service-supplied views) → engine admission (rechecks persisted evidence) → pre-mesh `deriveTransitionExpectation` (declares the 1/1/1 budget; invalid fails before meshing) → mesh (C0) → `gtop2` certificate against the declared expectation → worker post-solve mesh gate (owned checkpoints rechecked against the law inside + re-resolved natives at the boundaries) → result-owned transition leg → products (Extract/Bake gated; Bake cites the result leg only; Design Patch unavailable for the open route).

Defense in depth: the service pins endpoint evidence, but the worker re-resolves and rechecks everything;
a malformed or stale intent FAILS CLOSED at every layer and never falls back to legacy or to a default width.

## Narrowing from 20M.1

None. The flat-Elevation mesh proof SURVIVED (browser flow C CURRENT) — no narrowing.
