# Phase 10N native 3D correction integration proof

Experiment-only proof that the existing WASM `SparseCorrectionSolver` drives the
current <=384 3D native full-Qxx cohort behind a SEPARATE default-OFF kill switch.
No production, routing, cap, tolerance, C1/C2/C3, S3, 2D-route, or default changes.

## Provenance

- Baseline SHA: `c5e4cee0` (branch `perf/3d-native-correction-integration`).
- Environment: node v26.8.1, linux/x64. Real WASM bundle (`cpp/build-wasm/`).
- Production contract held throughout: worker-only, 3D single-solve, no robust,
  no TS correlation, no orientation, unchanged weighting eligibility, <=384 params,
  full dense native Qxx, 10L cached inline C1/C2/C3 evidence, clean TS fallback,
  full-Qxx switch default ON (10M), correction switch default OFF (10N).

## 1. Architecture trace

- Kill switch: `native3dCorrectionEnabled` (default `false`) + setter/getter in
  `src/workers/adjustmentNativeFullQxxAutoRoute.ts`; internal/test-only, no
  persisted/UI field, independent of `nativeFullQxxEnabled`. OFF = exact 10M path.
- Correction branch (same file): when enabled AND full-Qxx eligibility passes, the
  runtime injects BOTH `sparseCorrectionSolver` (real bundle, wrapped in the shared
  `SparseAutoRouteCaptureSolver`) AND `sparseSelectedCovarianceSolver` (10M capture
  unchanged). No row-products solver, no selected mode
  (`experimentalSelectedCovarianceMode: false`), `allowVerifiedNativeDenseQxxReuse`
  unchanged.
- Proof gates: S3 via shared `verifySparseAutoRouteSystems` (contract unchanged:
  count==iterations, 1e-9 dense-oracle agreement, finite, damping==0, finite
  condition evidence, first-system condition agreement, warnings stay warnings) AND
  C1/C2/C3 via `finalizeNativeFullQxxVerification` (10L cached finalizer, unchanged).
  Any failure — init/throw/fallback/truncation/S3/C1-C3/non-convergence/non-finite —
  reruns the whole attempt in clean TypeScript. Never a mixed
  TS-correction+native-Qxx attempt (no proven restart boundary).

## 2. Solver capability audit

- `SparseCorrectionSolver` (`src/engine/numericalBackend.ts`) is dimension-agnostic;
  the C++ solver (`sparse_normal_solver.hpp`) is generic. The 2D gate is TS policy
  only (`adjustmentSparseAutoRoute.ts`, `sparseProductionEligibility.ts`) — untouched.
- No new correction solver, no handle API, no persistent-factor export (none exists
  in `wasm_bindings.cpp`).

## 3. S3 dimension audit

- S3 reused verbatim (shared capture class + shared verifier, same 1e-9 tolerance,
  same 512-system bound). Dimension-agnostic packed math
  (`measurePhase7b7DenseOracle`). Evidence: 4/4 correction calls oracled per case,
  max correction diff 8.33e-16..4.83e-15, first-system condition agreement holds,
  zero damping, warnings stay warnings (none fired).

## 4. Correction-level + final-result parity (real WASM)

1 warm-up + 5 measured runs/arm. Three arms: A pure-TS, B 10M, C experimental.

| case | params | iters | A med | B med | C med | C/B | verdict | C/A | maxCorrDiff | A/C parity |
|---|---|---|---|---|---|---|---|---|---|---|
| gps-3d-32 | 96 | 4 | 16.78 | 17.10 | 15.61 | 0.913 | PARITY | 0.93 | 8.33e-16 | 0 (bit-identical) |
| gps-3d-64 | 192 | 4 | 44.74 | 45.91 | 41.58 | 0.906 | PARITY | 0.93 | 1.61e-15 | 0 (bit-identical) |
| gps-3d-128 | 384 | 4 | 228.63 | 161.01 | 153.21 | 0.952 | PARITY | 0.67 | 4.00e-15 | 0 (bit-identical) |
| gps-3d-128-altseed | 384 | 4 | 228.70 | 164.21 | 150.59 | 0.917 | PARITY | 0.66 | 4.83e-15 | 0 (bit-identical) |

All walls ms (medians; p25/p75 + raw in
`artifacts/evidence/phase10n/phase10n-evidence.json`). C1 max diff ~1e-20,
C2 residual ~1e-15, native condition first-iteration agrees with result.condition.
Final-result parity covers coordinates/heights/residuals/Qxx/stddev/ellipses/SEUW/
statistics/condition/convergence at the approved 1e-6 contract — actual: exact.

Run-to-run note: an independent re-run of the same evidence suite on the same
machine produced C/B medians 0.863 / 0.891 / 0.930 / 0.907 (committed:
0.913 / 0.906 / 0.952 / 0.917), with the two small cases straddling the 0.90
CLEAR-WIN threshold across runs while the 384-param S3 tax (~59-61 ms) and
bit-identical parity reproduced exactly. The committed PARITY classifications in
the table above stand under the predefined thresholds, but small-size verdicts
are noise-sensitive near 0.90; the robust conclusion is no reproducible
performance win over Phase 10M, and the keep-OFF recommendation is unchanged.

The evidence corpus is limited to the four synthetic GPS-3D ladder cases
(gps-3d-32/64/128/128-altseed); full-corpus validation (mixed, GPS+dist+height,
terrestrial, weak-chain, low-redundancy, uneven, compact per the mission list) is
a required gate before any future default-ON or user-facing enablement.

## 5. Fallback matrix (agent tier, 12/12 pass)

Bundle init failure, native run throw, correction throw, mixed-trajectory (late)
fallback, covariance throw, S3 mismatch (1e-3 corruption), damping (1e-9),
non-finite correction (NaN), covariance C1/C2 rejection, missing result.condition,
non-convergence, non-finite final station — every case: route `typescript`, clean
rerun with no native runtime state (asserted via rerun flag), outcome success,
S3 + C1/C2/C3 contract hold fail-closed on truncation/empty capture. Kill-switch
matrix: default OFF (fresh import), ON => captured proof, OFF => exact 10M path
(bit-identical), full-Qxx OFF => clean TS regardless of correction switch, 2D
never enters the experiment. 2D regression: Phase 7 suites run unchanged (see §8).

## 6. Stage decomposition + S3 oracle tax (384-param case)

Per-run means across measured C runs + diagnostic re-run walls over one
instrumented capture (ms):

| case | correction kernel | covariance kernel | S3 verify | C1/C2/C3 (cached finalizer) |
|---|---|---|---|---|
| 32 (96p) | 0.52 | 0.54 | 2.87 | 0.002 |
| 64 (192p) | 0.58 | 1.77 | 11.71 | 0.002 |
| 128 (384p) | 0.92 | 7.34 | 59.15 | 0.002 |
| 128-alt (384p) | 0.96 | 7.38 | 59.86 | 0.002 |

S3 tax: the dense-oracle re-verify (~59 ms at 384) consumes essentially all of the
~60-70 ms TS-correction saving the ~1 ms native kernel delivers — hence PARITY, not
a win. The cached C1/C2/C3 finalizer stays µs-scale (10L reuse proven again).
Net C-vs-B at 384: -7.8 ms / -13.6 ms absolute.

## 7. Browser / worker performance

NOT-RUN. Reason: no 10N three-arm browser harness exists; the committed driver
(`scripts/phase10mBrowserEvidence.mjs`) measures the two-arm 10M production route
only. Node evidence uses the real WASM bundle (same kernels browsers run) and is
the decision-grade signal for this proof. No browser numbers are claimed or
implied. Browser corroboration is deferred to the phase that proposes correction
default-ON.

## 8. Validation

- `npm run lint`, `typecheck`: clean.
- `tests/phase10n_native_correction.test.ts`: 12/12 (agent tier).
- `tests/evidence/phase10n_native_correction_evidence.test.ts`: pass (8.8 s).
- Phase 7 sparse-route + 10I/10J/10L/10M suites: run in the agent gate (see worker
  summary); 2D route files untouched (`git diff --stat` proves scope).
- No tolerance, cap, eligibility, C1/C2/C3, S3, or default changes
  (`NATIVE_FULL_QXX_MAX_PARAMS` still 384; correction switch still default OFF).

## 9. Factorization duplication + final-covariance reuse semantics

Option B confirmed: the final Qxx is rebuilt at converged coordinates via
`recoverFinalNormalCovariance`, NOT the final correction N — so factor reuse
across correction→covariance is NOT valid without a new WASM export. The native
backend factorizes once per correction iteration AND again for final covariance.
No handle API implemented (explicitly out of scope; none exists in
`wasm_bindings.cpp`). The bigger prize remains the 10M single-factorization
opportunity (~62-65 ms), which needs that export.

## 10. Recommended next phase

Proof succeeds (PARITY + bit-identical final parity) but C shows no clear win over
B: the S3 oracle tax consumes the kernel saving. Small-size C/B verdicts are
noise-sensitive near the 0.90 threshold across runs, so the robust conclusion is
no reproducible performance win over Phase 10M. Do NOT default ON. Options:
(a) keep the experiment OFF and pursue the single-factorization handle API;
(b) bound S3 cost with a sampled-iteration oracle (weakens the contract — not
recommended); (c) accept parity-only integration for code-path unification (no
perf motive — weak case). Recommendation: (a).
