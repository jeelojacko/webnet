# Phase 10O native factorization lifecycle study

STUDY ONLY. No production, routing, default, cap, eligibility, tolerance,
S3, C1/C2/C3, or 2D-route changes. Correction switch stays default OFF.
10M route stays ON. No prototype was wired to production (none was built).

## Provenance

- Baseline SHA: `8c2e3954` (branch `perf/3d-native-factorization-lifecycle`).
- Environment: node v26.8.1, linux/x64. Real WASM bundle (`cpp/build-wasm/`).
- Evidence: `tests/evidence/phase10o_factorization_lifecycle.test.ts`
  (1 warm-up + 5 measured runs; raw machine output in
  `artifacts/evidence/phase10o/`, gitignored).
- Headline: iterations rebuild an L2-identical symbolic system, but the
  final covariance N equals the last-correction N (L3) in 8/10 cases;
  even so, factorization reuse saves ~0.3 ms of a ~150 ms wall (~0.2%).
  Prototype SKIPPED with measured justification. GATE A unmet (reuse line
  stops); GATE B MET (S3 ~38% of wall is the structural blocker) ->
  recommend a bounded Phase 10P correction-verification boundary study.

## 1. System timeline (traced; refs verified while writing)

| step | where | what happens |
|---|---|---|
| loop state | `adjustSolveWorkflow.ts:282-512` | `ctx.stations/orientations` carried across iterations |
| per-iter rebuild | `:294-337` | cache-clear + `assembleAdjustmentEquations` (TS-side N assembly) |
| TS dense N | `adjustmentIteration.ts:108-116` | `accumulateNormalEquationsFromSparseRows` |
| TS dense solve | `adjustNormalEquationHelpers.ts:26-49` | `solveNormalEquations` |
| sparse solve | `adjustmentIteration.ts:84-105/132-149` | `solveFromEquations` (native correction call, one per iteration) |
| apply | `:468-476`, impl `:205-245` | `applyAdjustmentCorrections` |
| convergence | `:477-512` | relative weighted-objective change; preanalysis forces it `:449-466` |
| iter failure | `:520-528` | skips covariance |
| final covariance | `:554-558` -> `adjustCovarianceRecovery.ts:421-457` | snapshot stations; weak float-zenith LEAF projection `:424`; geometry clear `:432-433`; relinearize sparse `:295-309` / dense `:356-370`; sparse factor+query `:313-342`; dense zero-misclosure N + invert `:374-391` via `invertNormalMatrixForStats` `:388-390`; restore `:452-457` |
| robust loop | `adjustmentIteration.ts:151-162` | Huber reweighting can change numeric P/N mid-iterations |

## 2. Fingerprints (diagnostic-only, FNV-1a)

Pattern hash: param count, eq count, design rowOffsets/columns,
weight rows/columns. N-only hash (`nValues`): pattern + design/weight values
quantized at 1e-12, misclosures excluded (RHS is unused in N accumulation).
`values` adds misclosures where present; `full` adds the rhs/norhs tag.
Captured via the existing `SparseAutoRouteCaptureSolver` /
`NativeFullQxxCaptureSolver` packing entry points; never production.
Caveat: L3 below is N-equality at 1e-12 absolute quantization, not bitwise;
a production reuse gate would need exact-bit or tolerance-proven comparison.

- Iter i -> i+1 (RHS-inclusive): **L2 30/30**. Pattern bit-identical
  (incl. normalNnz/factorNnz constant, e.g. 1910/1147 at 384); values differ
  every step (relinearization at updated coords + evolving misclosures).
- Genuine RHS-only iter pairs (same N, changed RHS): **0/30**. Every
  iteration relinearizes N values; there are no RHS-only updates.
- Last-correction -> final-cov (N-only hash; identical N yields L3 via the
  rhs/norhs tag, so L3/L4 are genuinely reachable): **L3 8/10, L2 2/10**.
  In 8 cases the final covariance N equals the last-correction N at 1e-12
  (converged relinearization reproduces N); gps-3d-64 and gps-3d-112 move
  enough to differ (L2). Dims/sparsity shared in all 10 (eq counts equal,
  e.g. 1027 == 1027 at 384). L4 (bit-identical packed systems): 0.

## 3. Reuse levels (L0 dims-differ, L1 pattern-differs, L2 pattern-same /
values-differ, L3 N-same / RHS-differs, L4 bit-identical)

Corpus frequencies: L0 0, L1 0, **L2 32, L3 8**, L4 0
(iter pairs L2 30/30; last-to-final L3 8/10, L2 2/10). Same-N solve-only
reuse is valid for the final covariance in 8/10 cases; nothing qualifies
for full (L4) reuse. Iteration-to-iteration reuse stays symbolic-only.

## 4. Lifecycle audit (what rebuilds per call)

| artifact | correction call | selected-covariance call |
|---|---|---|
| packed structs | rebuilt by TS wrapper per call; alloc/free per call in `finally` (`wasmSparseNormalSolver.ts:31-91`, `wasmSparseCovariance.ts:94-169`) | same |
| assembled N | rebuilt (`factor_packed_system`, hpp pipeline) | rebuilt |
| symbolic (ordering+analyze) | rebuilt per damping attempt (`sparse_normal_solver.cpp:224-234`: "every attempt re-analyzes its own damped candidate"; AMDOrdering `:19`) | rebuilt |
| numeric factor | rebuilt | rebuilt |
| equilibration | rebuilt per call | rebuilt |
| condition | native per-call on raw N pre-equilibration (`:334-359/419-424/465-476`); ABI via correction export only; TS first-iteration fallback otherwise (`adjustmentIteration.ts:44-76`) | n/a (no condition export) |
| phase timings | NOT exposed (correction ABI `:109-143`, wrapper `:55-76`) | exposed (`SparsePhaseTimings` hpp`:22-28`, wrapper `:19-36/154-168`, bindings `:146-263`) |
| scratch/transfer | all Eigen objects local per call, nothing persistent; transfer freed per call | same |

S3/C1/C2 oracles are TS-side dense re-verifies (`measurePhase7b7DenseOracle`),
likewise rebuilt per verification.

## 5. Symbolic vs numeric split

Correction ABI has no timings, so the selected-covariance entry point was run
diagnostically on the exact captured correction systems (<=16 diagonal
queries) as a proxy, plus the inline final-system timings. Method limit
stated honestly: proxy solve covers 16 queries, not the full correction RHS,
but analyze/factorize/assembly phases are query-count independent.

- analyze median 0.034 ms (p25 0.019, p75 0.046; 0.053-0.061 at 384),
  ~29% of the native kernel total — but the native kernel is ~1 ms of a
  ~142 ms end-to-end wall.
- Removable by factorization reuse (even L3 solve-only: skip analyze +
  factorize on 4 correction calls + final) ~= **0.3 ms, ~0.2% end-to-end**.
- Verdict: factorization reuse is worth nothing end-to-end, with or without
  the L3 finding. The suspected negligible outcome is confirmed with numbers.

## 6. Handle design (doc only; no production wiring)

Opaque-handle API as specified: integer handles with generations;
use-after-free and double-free rejected; parameter validation on every entry;
deterministic dispose; no raw pointers across the ABI; bounded pool with an
alloc-failure path; module-reset invalidation; no cross-worker sharing
(handles are per-worker WASM-module state). No code was written because §7
did not trigger.

## 7. Prototype

SKIPPED with measured justification: even where same-N solve-only reuse is
valid (L3, 8/10 last-to-final), skipping analyze+factorize saves ~0.3 ms
(<0.5% end-to-end; gate was 5%) with S3 unchanged. A diagnostic-only
factor-once/solve+query export was therefore not built. Final covariance is
never forced onto a correction factor without an exact-bit/tolerance proof
of N-equality (the 2/10 L2 cases forbid blanket reuse).

## 8/9. Benchmarks (fixed-system CURRENT; 1 warm-up + 5 runs, medians)

End-to-end route-C walls (10N correction-ON route, includes inline S3):

| size | params | e2e med ms | corr kernel/run | cov kernel/run* |
|---|---|---|---|---|
| gps-3d-32 | 96 | 14.23 | 0.244 | 0.386 |
| gps-3d-64 | 192 | 37.12 | 0.406 | 1.453 |
| gps-3d-85 | 255 | 57.15 | 0.505 | 2.511 |
| gps-3d-128 | 384 | 143.23 | 0.757 | 6.09 |

\* bench cov wrapper includes the inline C1/C2/C3 dense verify (capture
path); native-only reference from 10N: correction 0.92, covariance 7.34 at
384. Decomposition: pack/assembly + symbolic + factorize + solve live inside
the kernel figures above (§5 splits analyze/factorize); transfer is wrapper
delta (sub-ms); the S3 oracle wall is §15. No prototype arm exists to compare
against; the iteration symbolic-reuse variant was not run (patterns are
identical but §5 shows the prize is 0.28 ms).

## 10/11. Option-B + augmentation

Last-correction vs final-cov: outcome **B 8/10** (same N: solve-only reuse
valid subject to the §2 caveat), **C 2/10** (symbolic-only); A 0, D 0.
Feature table (dims / sparsity / N / reuse):

| feature | dims | sparsity | N values | reuse |
|---|---|---|---|---|
| relinearization at converged coords | same | same | identical 8/10, differ 2/10 | solve-only (B) or symbolic-only (C) |
| weak-zenith LEAF projection | same | same | numeric-only | symbolic-only |
| synthetic zenith rows | same count both paths here (eq equal all 10 cases) | same | differ | symbolic-only |
| constraints (same set both paths) | same | same | same contribution | unaffected |
| weights rebuilt (+Huber mid-loop) | same | same structure | may differ | symbolic-only |
| precision query demand (planned vs n^2) | same | same | same N | solve count only |

## 12. Memory (retained-factor upper bound from reported nnz)

Formula: sparseN = nnzN\*8 + nnzN\*4 + (n+1)\*8; factorL likewise;
perm = n\*4; scratch = factorL; total = sum.

| params | nnzN/nnzL | sparse N | factor L | perm+scratch | total |
|---|---|---|---|---|---|
| 96 | 470/283 | 6.3 KB | 4.1 KB | 4.4 KB | 14.8 KB |
| 192 | 950/571 | 12.6 KB | 8.2 KB | 8.9 KB | 29.8 KB |
| 255 | 1265/760 | 16.8 KB | 10.9 KB | 11.9 KB | 39.6 KB |
| 384 | 1910/1147 | 25.4 KB | 16.4 KB | 17.9 KB | 59.8 KB |

A retained factor is <60 KB at cap: browser-worker pool practicality is a
non-issue. Memory is not the blocker; the missing prize (§5) is.

## 13. Handle safety

N/A: no prototype exists (see §7 reason). No matrix to fill.

## 14. Prototype parity

N/A: no prototype exists. All production parity figures are the 10N
bit-identical results, reproduced here as A/C diff 0 on all 10 cases.

## 15/16. S3 lower bound

At 384: S3 oracle alone ~53-58 ms (**~38% of the C wall**); removable
native duplication (all analyze+factorize phases) ~0.3 ms. This run:
C 151.32, B 168.66, floor = 151.32 - 0.28 = **151.04 ms** vs the
>=10%-over-10M bar (0.9 x 168.66) = **151.79 ms**; prior run: floor 142.16
vs bar 141.80. The floor straddles the bar within +/-1 ms while run-to-run
B spread is +/-10 ms (B raw 157-190) and the removable prize is 0.28 ms;
the committed 10N medians (C/B 0.952) miss the bar by ~8 ms.
**Can 10N reach a robust >=10% over 10M with S3 unchanged? NO.** S3 is
untouchable proof cost and the kernel saving is ~1 ms; no factorization
lifecycle change moves the needle. The only structural path to a robust
win is S3 cost reduction — hence GATE B.

## 18. Corpus: generator-ladder of a single 3D family (10/10 eligible, <=384)

gps-3d-cov-08 (24p), gps-3d-16 (48p), gps-3d-32 (96p), gps-3d-48 (144p),
gps-3d-64 (192p), gps-3d-85 (255p), gps-3d-96 (288p), gps-3d-112 (336p),
gps-3d-128 (384p), gps-3d-128-altseed (384p). Per case: A/C parity 0
(bit-identical, tol 1e-6), S3 accepted, C1/C2/C3 accepted, zero damping,
zero fallbacks, no truncation. NOT covered: terrestrial-only, weak-chain,
low-redundancy, uneven, and compact families — no such 3D generator inputs
exist, so the corpus varies size and seed within the single synthetic GPS-3D
ladder (which does mix GPS vectors with terrestrial D/B/V + height
observations). Findings generalize to that ladder only.

## 19/24. Browser

NOT-RUN. Reason: no three-arm/fingerprint browser harness exists; the
committed driver (`scripts/phase10mBrowserEvidence.mjs`) measures the two-arm
10M production route only. Node evidence uses the same real WASM bundle
kernels and is the decision-grade signal. No browser numbers claimed.

## 20. Performance campaign (384-param, Node)

A (pure-TS) 227.15 ms / B (10M, correction OFF) 168.66 ms /
C (10O diagnostic = 10N correction-ON route) 151.32 ms (this run's medians;
p25/p75 + raw in artifacts; prior run 209.49/157.56/142.44, C/B 0.904).
C/B 0.897 this run — the verdict straddles the 0.90 line across runs (see
§15/§16 noise analysis; committed 10N: PARITY at 0.952/0.917). C/A 0.666.
Decomposition: correction kernel ~0.8 ms/run, covariance kernel ~6 ms/run
(incl. inline verify), S3 oracle ~53-58 ms, cached C1/C2/C3 finalizer
µs-scale (10N). Browser: see §19 (separate; NOT-RUN).

## 21. Decision: GATE B

Exactly one gate, with criteria arithmetic:

- GATE A (build retained-factor prototype): required same-system L3/L4
  >50% AND projected saving >=10% over 10M. Actual: L3 8/10 last-to-final
  but saving ~0.2% (S3 unchanged). **UNMET — the factorization-reuse line
  stops here.**
- GATE B (S3-bound: verification cost is the structural blocker): MET iff
  S3 dominates the wall AND no factorization change reaches a robust >=10%
  win. Actual: S3 ~38% of the C wall; floor-vs-bar straddles within noise
  with a 0.28 ms prize; committed 10N misses by ~8 ms. **MET.**
- GATE C (stop everything) / GATE D (defer): not taken — B gives the work
  a bounded next step.

**GATE B: recommend a bounded Phase 10P correction-verification boundary
study — reduce/bound the S3 dense-verify cost WITHOUT weakening S3
acceptance. Correction stays default OFF, no prototype, production
contract/routing/defaults unchanged.** (Even a perfect S3 outcome leaves
the ~0.3 ms reuse ceiling untouched; the L3 finding needs no follow-up
unless a future S3 win reopens correction economics.)

## 22. Future verification inventory (list only)

- Any future default-ON proposal for correction re-runs the 10N A/B/C +
  S3 + 12-case fallback matrix on the then-current baseline.
- Any future retained-factor API needs handle-safety (§13) + parity (§14)
  suites before merge consideration.
- Browser three-arm harness, if built, re-corroborates §20 in a real worker.
- Full mixed/terrestrial 3D corpus if the generator gains those families.

## 24. Validation

- New 10O evidence suite: pass (10/10 corpus + benchmarks + A/B/C).
- Phase 7/7D/10I/10J/10K/10L/10M/10N suites, C++ tests, real-WASM,
  industry parity, lint, typecheck, build: see completion summary
  (3 pre-existing Study Desktop calibration failures noted if they recur).

## 25. Files

- `tests/evidence/phase10o_factorization_lifecycle.test.ts` (new)
- `scripts/testTiers.ts`, `scripts/runEvidence.mjs`, `docs/TEST_TIERS.md`
  (suite wiring only)
- `reports/performance/phase10o-factorization-lifecycle.json` + `.md`
- `TODO.md` progress line
