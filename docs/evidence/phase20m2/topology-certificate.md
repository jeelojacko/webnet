# Phase 20M.2 topology certificate (`gtop2` validates, never admits)

Principle (carried from 20K.3 Wave B): the certificate VALIDATES a produced mesh against a declared
expectation; it never ADMITS a transition. Admission is owned solely by the frozen predicate in
`gradingTransitionPolicy.ts` + the worker pre-solve gate. Proof sketch:

1. `deriveTransitionExpectation` runs BEFORE any mesh exists and declares group 1/1/1
   (1 component / 1 cycle / matching boundary budget for the single-transition open group).
2. Pre-mesh rejects (`WIDE` / `MALFORMED` / `OVERLAP`) fire before meshing — topology cannot conjure
   an admission the predicate denied.
3. After meshing, `gtop2` (`buildGradingTopologyCertificateExact`: exact IEEE-754 Float64 bits,
   validated uint32 indices, length-prefixed sections, SHA-256) revalidates digests + observed counts
   against the EXPECTED budget. Mismatch fails closed (`GRADING_TOPOLOGY_CERTIFICATE_EXACT_*`).
4. A stale `gtop1` certificate is rejected outright (no migration); NaN/Infinity never certify.

Therefore no code path exists in which a certificate turns a rejected intent into a CURRENT mesh:
rejects die at admission (policy/service/worker gate) or at pre-mesh expectation, before `gtop2`
is ever built. `gtop2` can only confirm or refuse — never authorize.

Covered by `tests/cad_grading_transition_topology_20m2.test.ts` 7/7 (expectation, pre-mesh fails,
legacy-identical no-intent path reusing the unchanged `gtop2` machinery).
