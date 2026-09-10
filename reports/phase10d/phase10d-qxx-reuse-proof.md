# Phase 10D — Final Qxx Equivalence + Statistics Reuse Proof

## Repository

- Branch: `feat/3d-final-qxx-reuse-proof`
- Baseline: `e1c700383a907c0bbb51ae5e6fc913cb6b65d3c5`
- HEAD: recorded at commit time
- PR: pending

## Contract

- Production behavior changed: **NO**
- Mathematical contract changed: **NO**
- Public result contract changed: **NO**
- Production routing changed: **NO**

Test-only `reuseFinalCovarianceInStatistics` defaults to legacy recomputation. No production caller enables it.

## Systems compared

System A is `recoverFinalNormalCovariance` / `recoverDenseCovariance`. It uses active observations, covariance augmentation, constraints, final adjusted geometry, final direction parameter map, assembled design rows, structured/dense weights, `N_cov`, then `Qxx_cov = inv(N_cov)`.

System B is `computeStandardizedResidualStatistics`. It reassembles active observations and constraints at the same final state, builds the statistics direction map, design rows and weights, then computes `N_stats` and `Qxx_stats = inv(N_stats)` before standardized-residual row products.

Probe captures deep copies of both normals and Qxx matrices. On every admissible ladder case:

| Fixture | params | N dimensions | max abs `N_cov-N_stats` | max abs `Qxx_cov-Qxx_stats` | classification |
|---|---:|---:|---:|---:|---|
| `gps-3d-cov-08` | 24 | 24 × 24 | 0.00e+0 | 0.00e+0 | EXACT SYSTEM EQUIVALENCE |
| `gps-3d-16` | 48 | 48 × 48 | 0.00e+0 | 0.00e+0 | EXACT SYSTEM EQUIVALENCE |
| `gps-3d-32` | 96 | 96 × 96 | 0.00e+0 | 0.00e+0 | EXACT SYSTEM EQUIVALENCE |
| `gps-3d-64` | 192 | 192 × 192 | 0.00e+0 | 0.00e+0 | EXACT SYSTEM EQUIVALENCE |
| `gps-3d-128` | 384 | 384 × 384 | 0.00e+0 | 0.00e+0 | EXACT SYSTEM EQUIVALENCE |
| `industry_demo` | 9 | 9 × 9 | 0.00e+0 | 0.00e+0 | NOT COMPARABLE (weak/damped case) |

No loose tolerance was introduced. Exact zero means every captured entry matched in this deterministic run; therefore worst row/column, diagonal, coordinate, height, orientation, and cross-block differences are also zero. Bit-identical entry count is full matrix size squared.

Structural audit found identical observation membership/order, augmented-row count zero on admissible fixtures, constraints, equation counts, parameter counts/order, direction indexes, design assembly, and weighting route. `N` equality was independently captured, not inferred from dimensions.

## Divergence audit and eligibility

- `augmentCovarianceObservations`: final-only synthetic rows can change `N_cov`; reuse fails closed with `covariance-augmentation-active`.
- Weak floating zenith projection and geometry cache: final recovery restores station snapshots and clears cache; reuse is disabled for augmented/damped outcomes.
- Coordinate constraints and direction/orientation sets: same inputs and map construction; mismatch is not admitted by the evidence cohort.
- GPS vector rows/covariance and TS correlation: identical transforms and covariance representations. `.TSCORR ON` fixture measured `N` and Qxx max differences `0.00e+0`, with full parity and reuse taken.
- Huber: final and statistics robust-weight semantics are not admitted; reuse fails closed with `robust-mode-inadmissible` and legacy parity.
- Effective standard deviations, final geometry, inactive/excluded observations, auto sideshots: no divergence observed in admissible corpus; future production eligibility must retain same-state/membership checks.
- Damping/singular, non-finite, missing Qxx, dimension mismatch, selected covariance, sparse row-product, and preanalysis routes fail closed. Damped `industry_demo` retains legacy duplicate damping warning and full log parity.

Result: **B — equivalent under bounded cohort**. Evidence supports reuse only for dense, converged, non-preanalysis, non-robust, non-augmented, non-damped, non-selected, non-sparse-statistics routes with finite matching dimensions and identical final state/system construction. TS correlation is included in this measured cohort.

## Evidence-only reuse seam

Reuse still assembles statistics equations for `L`, `rowInfo`, sparse rows, weights, metadata, GPS cross-products, and diagnostics. It changes one variable: `B = A * Qxx` reads recovered final dense Qxx. It skips only statistics normal accumulation and dense inversion. Existing formulas for qvv, standardized residuals, redundancy, MDB, local tests, GPS cross-products, precision, station covariance, relative covariance, and all-pairs `relativePrecision` remain unchanged.

## Full-result parity

Legacy versus reuse is **BIT-IDENTICAL** for all five admissible ladder fixtures and the TS-correlation fixture. Comparisons include success, convergence, iteration count, adjusted coordinates, orientations, residuals and GPS components, SEUW, stdRes/components, redundancy/components, MDB/components, local/global tests, station covariances, precision blocks, relative covariances, all-pairs relativePrecision lengths/order/values, REL/PTOL results, and dependent diagnostics. Huber and damped fallback cases retain full legacy parity.

## Call counts

| Route | final covariance accumulation | final covariance inversion | statistics accumulation | statistics inversion |
|---|---:|---:|---:|---:|
| legacy | 1 | 1 | 1 | 1 |
| reuse experiment | 1 | 1 | 0 | 0 |

Profiler independently reports zero statistics accumulation and inversion time on reuse. Equation assembly remains present.

## Performance

Uninstrumented wall medians use one warm-up plus three measured runs per route:

| Fixture | legacy ms | reuse ms | saved ms | improvement |
|---|---:|---:|---:|---:|
| `gps-3d-32` | 17.48 | 15.83 | 1.65 | 9.4% |
| `gps-3d-64` | 66.39 | 54.16 | 12.23 | 18.4% |
| `gps-3d-128` | 382.30 | 260.38 | 121.92 | 31.9% |

Headline `gps-3d-128`: legacy **382.30 ms**, reuse **260.38 ms**, **31.9%** improvement. Phase 10C predicted ideal saving from the ~90 ms statistics inversion; measured saving is larger because accumulation and associated stage overhead also disappear. Exact savings vary with machine and run state.

Statistics equation assembly remains, so future assembly-product reuse is **possible but unproven** and not pursued here.

## Decision

- Qxx reuse equivalence: **proven for bounded cohort**
- Qxx reuse cohort: dense TypeScript, converged, finite undamped final covariance, no covariance-only augmentation, no Huber/robust mode, no selected covariance, no sparse row-product route, no preanalysis, matching parameter dimension/system
- Statistics inversion removed: **yes**
- Statistics accumulation removed: **yes**
- `gps-3d-128` legacy: **382.30 ms**
- `gps-3d-128` reuse: **260.38 ms**
- Speedup: **31.9%**

**GO — narrow cohort.** Recommended Phase 10E: fail-closed bounded production final-Qxx statistics reuse, after extending eligibility checks and preserving the exact fallback/log boundary under independent review. No production optimization is enabled in Phase 10D.
