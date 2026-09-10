# Phase 10E — Bounded Production Final-Qxx Statistics Reuse

## Repository

- Branch: `perf/3d-final-qxx-statistics-reuse`
- Baseline: `72f0d0921976f4de1fe503575d6e6cea29083913`
- HEAD: `pending commit`
- PR: pending

Production behavior changed: **YES**  
Mathematical contract changed: **NO**  
Public result contract changed: **NO**  
Public protocol changed: **NO**  
Sparse/native routing changed: **NO**

## Production cohort

Automatic reuse applies only to normal, converged 3D dense TypeScript adjustments with finite, correctly dimensioned final Qxx, no covariance augmentation, no damping, no selected covariance store, no active sparse selected-covariance solver, no sparse row-product statistics route, and no robust mode. Solver presence alone rejects reuse (conservative): while a sparse selected-covariance solver is active the final dense Qxx is normally sparse-derived even when no selected store is captured, and a solve whose sparse recovery fell back to dense still keeps the legacy path. TS correlation remains admitted. 2D, preanalysis, and non-converged solves remain legacy.

The production gate is `src/engine/statisticsQxxReuse.ts`. It performs only cheap state checks; it does not rebuild or compare normal matrices. Statistics equations still assemble for `L`, `rowInfo`, weights, sparse rows, and metadata. Eligible execution uses authoritative recovered `ctx.Qxx` for `B = A * Qxx`; all later formulas remain unchanged.

## Phase 10D boundary regression

| Condition | 10D evidence | 10E production |
|---|---|---|
| 3D normal | eligible | reuse |
| TS correlation | eligible | reuse |
| Huber/robust | inadmissible | legacy |
| preanalysis | inadmissible | legacy |
| augmentation | inadmissible | legacy |
| damping | inadmissible | legacy |
| non-converged | inadmissible | legacy |
| selected covariance | inadmissible | legacy |
| active sparse selected solver | inadmissible | legacy (`sparse-selected-solver-active`) |
| sparse row products | inadmissible | legacy |
| invalid/nonfinite Qxx | inadmissible | legacy |
| 2D | not target | legacy |

Fallback reasons are machine-readable and fail closed: `not-converged`, `two-dimensional-legacy`, `preanalysis-mode`, `missing-final-qxx`, `non-dense-selected-store`, `sparse-selected-solver-active`, `sparse-row-products-active`, `robust-mode-inadmissible`, `covariance-augmentation-active`, `damped-final-recovery`, and `dimension-mismatch-or-non-finite`. Test-only `forceLegacyStatisticsQxx` provides identical legacy oracle execution.

## Eligible corpus parity

`gps-3d-cov-08` (3D GNSS covariance), TS-correlation-on variant, and the 3D ladder (`gps-3d-32/64/128`) automatically reused final Qxx. Plain/mixed GNSS, direction/orientation-heavy, vertical/zenith, coordinate-constraint, excluded/inactive, and REL/PTOL semantics remain covered by existing engine contracts and use same final-state assembly; no new formula or result-field path was introduced. Production-vs-force-legacy comparisons were BIT-IDENTICAL on the representative 3D fixtures and all ladder cases.

## Fallback corpus parity

Agent tests prove full parity for 2D, Huber, and force-legacy. Gate tests cover preanalysis, non-converged, covariance augmentation, damping, selected store, active sparse selected solver, sparse row products, missing Qxx, non-finite Qxx, and dimension mismatch. `industry_demo` remains legacy because it is weak/non-convergent/damped. No user-visible success log is emitted for reuse.

Full parity includes success, convergence, iterations, adjusted XYZ/E-N-H, orientations, residuals and GPS component residuals, SEUW, standardized residuals/components, redundancy/components, MDB/components, local/global tests, station covariance and precision blocks, error ellipses/height precision, all-pairs `relativePrecision` lengths/order/values, `relativeCovariances`, REL/PTOL output, warnings, diagnostics, and array ordering.

## Call-count proof

| Route | final covariance accumulation | final covariance inversion | statistics accumulation | statistics inversion |
|---|---:|---:|---:|---:|
| automatic eligible production | 1 | 1 | 0 | 0 |
| forced legacy oracle | 1 | 1 | 1 | 1 |

Profiler and probe assertions independently verify statistics assembly remains present while duplicate accumulation/inversion disappear.

## Performance

Uninstrumented TypeScript production-path medians use one warm-up plus five measured runs per route:

| Fixture | forced legacy ms | automatic reuse ms | saved ms | improvement |
|---|---:|---:|---:|---:|
| `gps-3d-32` | 23.86 | 18.28 | 5.58 | 23.4% |
| `gps-3d-64` | 75.12 | 60.64 | 14.48 | 19.3% |
| `gps-3d-128` | 405.28 | 295.81 | 109.47 | 27.0% |

Headline `gps-3d-128` improvement: **27.0%**, above 15% gate. Statistics equation assembly remains; no assembly-product reuse or other optimization was included.

## Validation

- CTest: **7/7**
- Industry parity: **25/25**
- Agent: **450 files, 2688 passed, 1 skipped**
- WASM: **8 files, 41 passed**
- Release: **3 files, 4 passed**
- Lint: pass
- Typecheck: pass
- Evidence: `npm run test:evidence -- phase10e` pass
- Build: pass
- Browser: `wasm:browser:smoke` pass

## Decision

**GO — production Qxx reuse.** Automatic bounded reuse is enabled only for the proven 3D cohort; all other cases retain legacy statistics recomputation.

Recommended next phase: **Phase 10F — Post-Reuse 3D Performance Reprofile**. Re-measure new bottlenecks before selected covariance, row products, correction WASM, or all-pairs precision work.

Reviewer: independent Phase 10E reviewer **APPROVE**.
