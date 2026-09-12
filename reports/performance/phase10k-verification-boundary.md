# Phase 10K native verification boundary

Measurement-only decomposition of the Phase 10I native full-Qxx route verification cost.
Diagnostic-only collector splits the old 10J wrapper-only attribution; production call sites pass nothing.
Column mapping (documented, disjoint by construction except where noted): native numerical = native
SparsePhaseTimings sum; wrapper = wrapper wall minus native sum; capture = captureCopy bucket;
oracleBuild/C1/C2/C3 = collector buckets; covCompare = finiteScanConvert + queryBuild + oracleProbe +
nativeIndex (comparison scaffolding); statsReuse = session precisionPropagationMs; precision = session
precisionAndDiagnosticsMs minus precisionPropagationMs (remainder, floored at 0); report = session
reportDiagnosticsMs; other = TOTAL minus all other columns (holds iteration-solve/setup/packaging plus noise).

## Required gps-3d-128 verification-boundary table (median ms per run)

| fixture | native numerical | wrapper | capture | oracleBuild | C1 | C2 | C3 | covCompare | statsReuse | precision | report | other | TOTAL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gps-3d-128 | 1.92 | 4.30 | 0.19 | 1.26 | 0.08 | 7.04 | 74.85 | 27.02 | 10.00 | 13.00 | 14.00 | 304.55 | 458.21 |

## Compact route-cohort tables (median ms per run)

| fixture | native numerical | wrapper | capture | oracleBuild | C1 | C2 | C3 | covCompare | statsReuse | precision | report | other | TOTAL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gps-3d-32 | 0.21 | 0.31 | 0.01 | 0.07 | 0.02 | 0.56 | 3.38 | 1.47 | 2.00 | 1.00 | 1.00 | 18.85 | 28.90 |
| gps-3d-64 | 0.53 | 1.06 | 0.20 | 0.15 | 0.04 | 1.92 | 14.63 | 5.42 | 3.00 | 4.00 | 3.00 | 65.94 | 99.88 |

## Scaling (24/96/192/384 params; empirical tendency only, no formal complexity claims)

24 params (gps-3d-cov-08): total 7.4 ms, verify 0.7 ms; 96 params (gps-3d-32): total 28.9 ms, verify 5.5 ms; 192 params (gps-3d-64): total 99.9 ms, verify 22.4 ms; 384 params (gps-3d-128): total 458.2 ms, verify 110.4 ms

- Qxx elements/bytes grow with numParams^2 by construction (all-entry contract); per-run verify buckets rise with n while native phase timings stay far below the route wall.
- Tendency notes only: no fitted exponents, no extrapolation beyond 384 params except the labeled 768 ESTIMATE below.

## gps-3d-256 conceptual bridge + hypothetical 768-param ESTIMATE

- Diagnostic engine walls median ms: TS 1298.00, native 585.44 (parity maxDiff 0.00e+0).
- Bridge stage medians ms (explicit 1024 cap, diagnostic-only): oracleBuild 1.62, queryBuild 0.07, oracleProbe 89.54, convert+index 70.97, C1 0.15, C2 26.97, C3 450.33; full-verify-equivalent 639.64.
- ESTIMATE of a hypothetical 768-param full verified route: 1865.63 ms = native engine wall + 2x full-verify-equivalent + capture copy. NOT a route measurement; assumes verify cost scales as measured at 768 params with the same 2x inline+route shape.

## Duplicated-work audit (from measured code facts; no redundancy conclusions)

| Work | native-computed | TS-recomputed | required by contract | reusable |
|---|---|---|---|---|
| Dense normal N (n x n) | factored internally per WASM query | rebuilt dense via accumulatePackedNormal once per verify call (x2: inline + route-level) | yes (oracle + C2 need N) | within one verify call (probe and C2 share it); NOT reused across inline/route verifies |
| Factorization | native Cholesky per query inside WASM | TS scaled-Cholesky probe once per verify (x2) | yes (independent oracle factor) | no (recomputed per verify) |
| Solves | all n^2 entries (all-entry Qxx) | <=16 columns per verify (x2) | yes for native (contract); bounded TS sample for verification | no |
| Qxx entries | n^2 materialized + transferred | never materialized (only <=16n samples indexed) | full Qxx required (statistics reuse + precision contract) | the native Qxx itself is reused by statistics (reused-final-dense-qxx) |
| Bounded selected columns (<=16) | n/a | queried from TS oracle per verify | verification-only demand, not production output | no |
| Statistics inputs | n/a | equations reassembled (multiplySparseRowsByDenseMatrix + per-equation loops) even under Qxx reuse | yes (residuals need per-equation data) | Qxx accumulation + inversion skipped under reuse; assembly retained |

## Qxx consumer audit (from measured code facts)

| Consumer | shape | frequency | production-critical |
|---|---|---|---|
| Statistics standardized residuals (reused-final-dense-qxx via decideStatisticsQxxReuse) | full dense Qxx | once per eligible session | yes (gated: normal converged 3D dense TS final Qxx, finite correct dimension) |
| Precision propagation all-pairs relativePrecision rows | full Qxx, repeated per-pair reads | repeated (one row per pair; 8,128 rows at 128 params per Phase 10F) | yes (contract rows preserved) |
| Report diagnostics | full Qxx derived values | once per session | yes (result contract) |
| Verification C1/C2 sampling | selected <=16 columns | twice per system (inline + route-level) | no (never reaches production output) |
| Diagonal-only use | insufficient alone (off-diagonals needed for Cauchy-Schwarz/precision pairs) | n/a | no |

## C1/C2/C3 safety-evidence inventory (purpose class + independent protections; no redundancy conclusions)

| Check | purpose class | independent protections already measured |
|---|---|---|
| Metadata gates (timings present, damping == 0, finite attempts) | degenerate-input rejection | run before any numeric check; fail-closed |
| Dense all-entry query-coverage proof (n^2 entries) | demand-shape proof | dimension + length gates; truncation bound 64 systems |
| C1 sampled-column agreement vs independent TS oracle | value-corruption detection | tolerance floor 1e-12 abs; bounded columns, no full inverse |
| C2 inverse residuals on CAPTURED native values (never re-solved TS) | consistency detection | full-column coverage required; fail-closed on partial |
| C3 physical (finite, positive diagonal, symmetry, Cauchy-Schwarz) | physical-plausibility detection | independent of N; full n^2 scan |
| Inline-before-engine + route-level re-verify | provenance timing | rejected values never reach engine numerics; 10I parity + fallback-matrix evidence |
| Collector on/off bit-identity (this campaign) | instrumentation-safety proof | accepted/reasons/maxC1Diff/maxC2Residual equal with collector on vs off |

## Controlled variant verdicts

| Variant | verdict | reason |
|---|---|---|
| A engine numerical only | measured (forced-TS session wall) | production-equivalent baseline |
| B +capture/materialization | measured (pure deep-copy on captured systems) | benchmark-only, never a route |
| C +C1 | measured (pure oracle+probe+C1 stages) | benchmark-only, never a route |
| D +C1+C2 | measured (pure stages) | benchmark-only, never a route |
| E +full C1+C2+C3 | measured (full verify, fresh collector) | benchmark-only, never a route |
| F +statistics/reuse/report | measured (session precision/report buckets) | production session metadata |
| G production-equivalent | measured (native route wall with collector) | reconciled to session total + route-level re-verify + eligibility pre-work |
| gps-3d-256 production route | ineligible (diagnostic cohort instead) | above the 384-param route cap |

## Recommendation (exactly one primary GATE for 10L direction; no implementation)

GATE B (optimize verification implementation, keep C1/C2/C3 acceptance logic bit-identical): the measured ~2x inline+route-level double verification runs the same function on the same inputs twice, and TS-side oracle/probe/C2 work dominates the route wall while native phase timings stay small. 10L should remove the redundant pass and optimize the TS-side oracle path under the bit-identity assertion proven here. GATE A (status quo) leaves the ~2x cost; GATE C (reduce coverage/demand) changes the safety contract without independent evidence; GATE D (more evidence first) is unnecessary for the duplication removal, which this campaign already proves decision-neutral.

GO for 10L scoped to GATE B only (verification-implementation optimization with bit-identical C1/C2/C3 decisions); NO-GO for any 10L change to routing, tolerances, coverage, or numerical contracts.
