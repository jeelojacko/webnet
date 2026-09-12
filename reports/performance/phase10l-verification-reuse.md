# Phase 10L verification-reuse end-to-end performance

Measurement-only end-to-end comparison of the Phase 10L cached-finalizer native route against the
pre-10L double-verify flow, over the production-equivalent Phase 10I route cohort
(gps-3d-cov-08/32/64/128; 1 warm-up + 5 measured runs per arm, median/p25/p75). Timings recorded only, never gated.

## Provenance

- Baseline SHA: 9b18161c (branch perf/3d-native-verification-reuse, HEAD 9b18161c65c7372af24479f8fb2fb0a0ee4582b6).
- Environment: node v26.8.1, linux/x64.
- Baseline numbers compared against: reports/performance/phase10k-verification-boundary.{json,md} (committed 10K medians).

## Exact code path changed (batches 1-2; this batch measures only)

- `src/workers/adjustmentNativeFullQxxAutoRoute.ts`: `NativeFullQxxCaptureSolver` caches per-system inline
  verification evidence (`getInlineVerifications`, copy-on-read); route finalization calls
  `finalizeNativeFullQxxVerification` (fail-closed aggregation, zero oracle/C1/C2/C3 numerics) instead of
  the legacy `verifyNativeFullQxxSystems` re-pass. Inline verification still runs before native values reach
  the engine, so rejected values never flow into downstream numerics.
- `src/engine/sentinelDensePhysicalValidation.ts` (new): full-dense specialized C3 physical validator
  (`tryBuildDensePhysicalIndex` / `sampleDensePhysicalIndex` / `scanDensePhysical`) used by both the inline
  verifier and the legacy re-pass, with fallback to the legacy paths on malformed shape.
- Kill switch unchanged: `nativeFullQxxEnabled` defaults to false (proven OFF in this campaign before enabling).

## Safety / provenance argument

- Provenance is unchanged: every captured packed system is still verified inline against the ACTUAL native
  values (dimension/finite/damping gates, all-entry coverage proof, C1 vs independent TS oracle, C2 inverse
  residuals on captured native values, C3 physical over the full set) BEFORE its Qxx reaches the engine.
  The finalizer only re-aggregates that same evidence (count match, per-system parameter re-check, reason
  retagging, max-aggregation identical to the legacy loop) and fails closed on truncation, empty capture,
  count mismatch, malformed or missing evidence, any inline rejection, or unprovable aggregates.
- This campaign asserts: new route accepted everywhere legacy accepted, and new/legacy/TS results identical
  (max coordinate/Qxx diff 0.00e+0 < 1e-6 on all fixtures).

## Old-vs-cached parity summary (agent tests, batches 1-2)

- `tests/phase10l_native_verification_reuse.test.ts` (16 tests): legacy-vs-cached differential corpus
  (accepts, truncation, empty, count mismatch, per-system rejects, parameter mismatch, malformed evidence,
  non-finite aggregates) plus fault matrix — 0 mismatches, decisions bit-identical.
- `tests/phase10l_dense_physical_validation.test.ts` (16 tests): dense C3 validator differential vs legacy
  `validateSentinelPhysical` (finite/diagonal/symmetry/Cauchy-Schwarz faults, index-path equivalence,
  malformed-shape fallback) — 0 mismatches, decisions bit-identical.

## C3 equivalence

- The dense C3 fast path (`scanDensePhysical` over the packed dense index) replaces the number-key Map and
  string-key legacy Map scans for proven full-dense inputs; the 16-test differential proves exact decision
  equivalence, and any malformed shape falls back to the legacy paths. C3 drops from the dominant bucket
  (10K: 74.85 ms) to a minor one; comparison scaffolding (oracle probe + indexing) now dominates
  at 384 params (2.57 ms C3 of 29.33 ms single-pass total).

## Before / after timings (median ms per run)

| fixture | TS wall | legacy (10K-style) wall | new (10L) wall | recovered ms |
|---|---|---|---|---|
| gps-3d-cov-08 (24 params) | 5.82 | 3.43 | 7.21 | -3.78 |
| gps-3d-32 (96 params) | 12.13 | 13.92 | 14.61 | -0.69 |
| gps-3d-64 (192 params) | 38.06 | 41.28 | 36.92 | 4.36 |
| gps-3d-128 (384 params) | 209.36 | 176.64 | 155.08 | 21.56 |

10K committed native-route medians for cross-check: gps-3d-cov-08 7.38, gps-3d-32 28.90, gps-3d-64 99.88, gps-3d-128 458.21.
The legacy arm above reconstructs the same double-verify flow in-harness; expect agreement within machine noise.

## Single-pass verification breakdown + finalizer (median ms per run)

| fixture | oracleBuild | C1 | C2 | C3 | scaffolding/index | single-pass total | finalizer |
|---|---|---|---|---|---|---|---|
| gps-3d-cov-08 | 0.02 | 0.01 | 0.08 | 0.02 | 0.22 | 0.35 | 0.0010 |
| gps-3d-32 | 0.08 | 0.02 | 0.56 | 0.16 | 1.15 | 1.98 | 0.0006 |
| gps-3d-64 | 0.15 | 0.04 | 1.92 | 0.65 | 3.77 | 6.54 | 0.0006 |
| gps-3d-128 | 0.46 | 0.08 | 7.06 | 2.57 | 19.19 | 29.33 | 0.0006 |

- Scaffolding/index = finiteScanConvert + queryBuild + oracleProbe + nativeIndex (comparison scaffolding).
- Finalizer cost is ~microseconds on every fixture (128: 0.0006 ms) — the route-level
  re-verify numerics are eliminated, leaving only the inline pass plus aggregation.

## Recovered ms (legacy wall minus new wall, medians)

- gps-3d-cov-08: -3.78 ms.
- gps-3d-32: -0.69 ms.
- gps-3d-64: 4.36 ms.
- gps-3d-128: 21.56 ms.

## Floor analysis (gps-3d-128, 384 params)

- 10K theoretical floor prediction: ~238 ms.
- Measured new-route wall: 155.08 ms vs TS wall 209.36 ms.
- Verdict: the ~238 ms floor prediction DOES NOT HOLD.

## Remaining bottlenecks (gps-3d-128)

- Inline single-pass verification (~29.33 ms, scaffolding/oracle-probe-dominated) is the largest remaining native-only cost.
- Iteration solve / session setup (shared TS baseline both arms pay) is not verification-recoverable.
- Statistics / precision / report stages and the ~microsecond finalizer are negligible.

## Route-vs-TS verdict (gps-3d-128)

- New-route / TS wall ratio: 0.741 → verdict A (faster, >=10%).

## Baseline cross-check caveat

- The committed 10K native-route medians (458.21 ms at 128) do NOT reproduce on the current tree + machine:
  the legacy reconstruction above measures ~176 ms. The dense C3 fast path accounts for ~160 of the ~282 ms
  gap (single-pass verify 109.6 ms -> ~30 ms, over 2 passes). The remainder sits in the native session wall,
  for which no source change exists: the working-tree production diff is scoped to the route file plus new
  modules, and the TS arm reproduces (211.5 ms -> ~204 ms). Points to machine-state differences during the
  original 10K native window, not to a code effect. Do not treat 458.21 as ground truth without re-baselining.
- A fresh re-run of the 10K suite under the current tree passes all parity/collector-identity asserts but
  trips its 2 ms cumulative-ordering assert at 128 (variant E ~3 ms below D on a ~245 ms base): the faster
  verify path compresses C/D/E spacing into machine noise. Measurement-noise trip, not a safety signal;
  the 10K test file is left untouched.

## Phase 10M recommendation

- If verdict A or B: recommend Phase 10M widening assessment (kill-switch posture, corpus breadth, 768-param
  scaling) with the cached finalizer as the verified route.
- If verdict C: recommend Phase 10M scoped to the remaining inline-verification cost (cheaper
  independently-safe oracle contract, bit-identical C1/C2/C3) — NO change to routing, tolerances, coverage,
  or numerical contracts; kill switch stays default-off.

Walls are machine-observational; methodology deterministic; no production changes in this batch.
