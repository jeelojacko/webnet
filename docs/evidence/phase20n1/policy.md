# Phase 20N.1 — Policy: the authorized predicate as shipped

Admit T1..TN per open group iff **all** of the following hold; any failure
rejects the **whole group** (fail-closed, no partial tiling):

1. **Per-joint trp1**: every Ti passes the full 20M.2 admission
   (`admitGradingTransition`, policy version `trp1`, law
   `TRANSITION_LINEAR_V1`) with count 1 at its own joint.
2. **Canonical consecutive order**: joint ids parse via
   `parseCanonicalJointIndex` (strict), sort ascending, and form a
   consecutive run — no gaps (sparse rejected), no duplicates, no
   out-of-order input accepted as-is.
3. **Strict separation**: for each adjacent pair, exact
   `Wi/2 + W(i+1)/2 < Lshared` where `Lshared` is the authoritative shared
   middle-member length (`checkGroupTransitionSeparation`). Touching (`==`)
   and overlap (`>`) both reject.
4. **Independent pre-mesh expectation**: `deriveGroupTransitionExpectation`
   (delegating to the one plural authority `deriveTransitionExpectation`)
   declares 1/1/1 per transition **before** meshing, from bounded codes only.
5. **Whole-group fail-closed**: one bad intent ⇒ zero transitions applied.

## Explicit exclusions (rejected by predicate, pinned by tests)

- Touching intervals (`==`) and overlaps.
- Sparse (non-consecutive) joint sets for N > 1.
- Non-collinear / bent control joints.
- NaN / Inf / zero / negative widths; stale / malformed / dual-field intents.
- Max width `W == 2·min` admits; just-over rejects (boundary pinned).

## What this is not

- **20N study**: study-side `deriveCandidateAPreMeshExpectation` was the
  prototype of rule 4; the shipped rule 4 is the production delegate above.
- **Candidate B**: any non-collinear policy remains deferred
  (POLICY_REQUIRED); exclusion of bent joints is intentional, not a gap.
- **Narrowings**: consecutive-only for N > 1 and exact-`<` separation were
  discovered during implementation (Wave J boundary pins) and are now part
  of the shipped predicate, not study assumptions.
