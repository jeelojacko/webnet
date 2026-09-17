# Phase 16B Level-2 decision: GO-WITH-HYBRID-THRESHOLD

Iteration solve path + Level-2 gates + hybrid policy + full parity
(branch `perf/structured-weight-solve-transfer`, Worker B on top of 62f37ad0).

## What shipped (production)

- Correction loop (`adjustSolveWorkflow.ts`) assembles sparse + `omitDenseP`
  and accumulates N/rhs from structured weights where admitted; the
  per-iteration dense P allocation is gone on those systems.
- Iteration solve (`adjustmentIteration.ts`) gains a structured-TS branch:
  exact writer-metadata density gate, bit-identical oracle accumulation,
  fail-closed materialize-and-go-dense on any doubt.
- Covariance recovery (Worker A block) gains the same pre-assembly UB +
  post-assembly exact gates.
- Hybrid policy (`structuredWeightOracle.ts`): admit iff m >= 128 AND
  density <= 0.02 (pre-assembly upper bound from observation metadata,
  never a dense P; exact post-assembly backstop), Huber excluded,
  `structuredWeightTransfer: false` kill switch, malformed fails dense.
- Untouched: statistics dense-P handling, Qxx/Qvv/reliability/14C math,
  robust math, solver equations, settings, exports, native/sparse routes.

## Gate table (measured, medians)

| Gate | Case | Result |
|---|---|---|
| A §10 | chain-1000 (m=2000): total 64.8 → 34.9 ms (1.86x), N+rhs bitwise | PASS (>=20%) |
| A §10 | ts-250x8 (m=2000, d=0.004): total 158.6 → 114.9 ms (1.38x), N+rhs bitwise | PASS (>=20%) |
| B §11 | 11 families (dist/bearing, direction, angle, dir-azimuth, zenith, level, GPS 2D/3D, GNSS, weighted + correlated controls): N+rhs bitwise each | PASS |
| C §12 | GPS 2x2/3x3, TS set/setup blocks: N exact + expected triplet counts + diagonal-only negative control differs | PASS |
| §13 | vTPv non-bitwise case: 1–4 ULPs, maxRel ~1e-16 (ceiling 1e-12) | REPORTED |
| §24 | Packing O(nnz): structured pack 10–1000x faster than dense pack; never dominates assembly | PASS |
| §25 | Builder finalize isolated: ~0.9 ms at 7–8k pairs (rest of the dense-shape gap is Map-set writes, not redesigned) | RECORDED |
| §27 | ts-setup-32/128 (d≈1.0): routed dense, 0% regression by construction | PASS |
| §33 | LOO primary + blunder-excluded alternate via solveEngine+excludeIds: whole-result identical | ADMITTED |
| §34 | Auto-adjust GPS network with real removal (cycles=2, removed=[blunder], seuw→0): whole-result identical | ADMITTED |
| §35 | 6 fixtures + m=200 network: whole-result JSON identical (timing/telemetry stripped) | PASS |
| §36 | Exports representation-only; pinned suites 23/23 + parity 25/25 | PASS |
| §38 | m=200, 5 iters: dense-P allocs 7→1, bytes 2.24M→0.32M (−85.7%), attribution exact (iters+1) | PROVEN |
| §§41-42 | m=200 wall 22.6 vs 22.2 ms (no regression); memory leg −85.7% ≥ 50% | PASS via memory |
| Huber | TS path stays dense (inner-reweighting proof deferred) | REJECTED with reason |

Rejected-with-reason: robust-Huber structured iteration (existing native-route
hooks untouched). Conservative misses (stay dense, zero regression): 3D solves
assume 3-row GPS in the UB; every constraint row budgets one off-diagonal;
TS groups estimated from observations (writer skips only shrink them).

## Validation

lint 0 errors (2 pre-existing warnings), typecheck clean, test:agent 4204
pass + 3 pre-existing study-desktop fails, parity:industry-reference 25/25,
test:wasm 74/74, build clean, export pins 23/23.
