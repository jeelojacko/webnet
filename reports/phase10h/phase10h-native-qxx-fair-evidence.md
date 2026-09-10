# Phase 10H — Fair Native-Qxx Statistics-Reuse + Native Phase-Timing Evidence

Branch: `feat/3d-native-qxx-fair-evidence`  
Baseline: `a0d5fdc7e2fcc3e5e7bfc4ddf0f23c08f98dc9e8`  
HEAD: `working tree validation`  
PR: pending

Production behavior changed: **NO**  
Mathematical contract changed: **NO**  
Public contract changed: **NO**  
Production routing changed: **NO**

## Evidence

Native selected-covariance and row-product C/WASM calls now expose existing `SparsePhaseTimings` through optional caller-owned output slots. Slots start as NaN and become metadata only after successful finite native completion. Failure and older artifacts leave timing metadata absent. NNZ, damping, attempts, and numeric buffers remain unchanged. Cheap C++ and WASM tests cover finite/non-negative success metadata, sentinel failure behavior, null output pointers, and numeric preservation.

Explicit evidence-only `allowEvidenceNativeDenseQxxReuse` bypasses only active-sparse-solver rejection. It is never enabled by production defaults. Native all-entry mode still requires converged 3D, dense full-size finite Qxx, zero damping, no selected store, no robust mode, no augmentation, and no fallback. Statistics normal accumulation and inversion report zero when reuse occurs. Selected-network mode remains contract-different.

Measured campaign (`1` warm-up + `5` runs) uses genuine `gps-3d-cov-08/16/32/64/128`. Direct Qxx probe differences are actual values, not tolerance claims. Full results compare after removing volatile logs/timing and rounding at existing 1e-6 evidence precision.

| Fixture | P | TS median ms | Native median ms | Qxx max abs diff | Full-result max abs diff | Statistics reuse |
|---|---:|---:|---:|---:|---:|---|
| gps-3d-cov-08 | 24 | 5.03 | 3.73 | 3.388e-21 | 0 | reused-final-dense-qxx |
| gps-3d-16 | 48 | 7.97 | 5.03 | 2.435e-21 | 0 | reused-final-dense-qxx |
| gps-3d-32 | 96 | 12.04 | 10.63 | 1.398e-20 | 0 | reused-final-dense-qxx |
| gps-3d-64 | 192 | 39.79 | 29.98 | 1.652e-20 | 0 | reused-final-dense-qxx |
| gps-3d-128 | 384 | 211.17 | 112.82 | 8.301e-20 | 0 | reused-final-dense-qxx |

At `gps-3d-128`, covariance architecture wall improvement is not separately isolated in this compact harness; whole-adjustment median improvement is **46.58%**. Both routes perform one final covariance recovery and zero statistics normal accumulations/inversions. Native phase fields are exposed as `assembly/equilibration/analyze/factorize/solve` milliseconds; detailed phase attribution remains available to follow-up evidence collection, not public results.

## Coverage and policy

`industry_demo` remains weak/non-convergent sentinel and is not counted. Mixed terrestrial+GNSS+leveling, REL/PTOL, TSCORR, robust, augmentation/excluded, orientation-heavy, duplicate-factorization, and C1/C2/C3 policy remain fail-closed audit items; no selected-network result is treated as contract-preserving. No shared-factor experiment was run: duplicate factorization was not measured as a material blocker in this bounded Route-A campaign.

Native output is **numerically equivalent under existing evidence tolerance**, not bit-identical. Direct Qxx differences are approximately `1e-20` on this corpus. If production policy requires bit identity, native covariance remains blocked; Phase 10H does not decide or weaken that policy.

`gps-3d-128 current production:` 211.17 ms  
`gps-3d-128 native-full + stats reuse:` 112.82 ms  
`covariance-stage improvement:` not isolated in compact harness  
`whole-session improvement:` 46.58% median  
`native dominant substage:` phase metadata now available; no clean phase breakdown collected here  
`bit-identical:` NO  
`numerically equivalent:` YES, existing 1e-6 evidence comparison

**Decision: GO**  
**Recommended Phase 10I:** bounded native full-Qxx production-routing proof, only if existing numerical policy accepts established tolerance and C1/C2/C3-equivalent production verification is added. No production routing in Phase 10H.
