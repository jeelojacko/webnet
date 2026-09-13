# Phase 12F.3 — Bounded Native Selected Covariance (R2B) Production Proof

Branch `feat/gnss-native-r2b-production-proof`. Baseline `d890c6a6` (PR #43 merge).
PRODUCTION ROUTE but DEFAULT OFF. No math/tolerance/formula/C++/dispatcher changes.
No Takahashi. R1 stays OFF. No vendor files committed.

## 1. Production architecture (§2, §3)

```
TypeScript: parse/import → frame validation → connectivity → setup augmentation
  → effective covariance → baseline problem → R2B eligibility → block plan
Native/WASM: sparse correction solve → factorization → batched selected blocks
TypeScript: selected-block store → coords → residuals → vTPv/SEUW → Qvv/Cvv
  → standardized residuals → redundancy → block stats → loop QC → reports
```

New numerical route inside the existing 12F.1 plumbing (nativeRuntime seam,
worker-only routing, capture/S3 verification, clean-TS fallback, kill-switch
conventions). No parallel framework. No dense Qxx anywhere on the route.
Setup stays TS-side (effective 3x3 to native). No native parser.

Files:
- `src/engine/gnssBaselineAdjust.ts` — provenance union + `nativeSelectedBlocksProvider` seam + R2B branch
- `src/engine/gnssSelectedBlockVerify.ts` — NEW pure selected-output safety gate
- `src/workers/gnssBaselineNativeR2BRoute.ts` — NEW kill switch + eligibility + fill gate + fallback
- `src/engine/gnssSelectedBlockPlan.ts`, `gnssSelectedBlockQuery.ts`, `gnssBlockStatistics.ts` — promoted to production-shared (headers only, zero logic change)

## 2. Feature control (§4, §33)

Dedicated `setGnssNativeR2BRouteEnabled` / `isGnssNativeR2BRouteEnabled`, default OFF.
OFF = bit-identical TypeScript (`typescript-dense`). R1 switch independent (tested).
Production fallback is R2B → TypeScript, never R2B → R1. No `querySelected` reference
in the route (source-guarded). Default-OFF proven: kill-OFF legs show zero bundle
loads; Chromium page-load smoke shows 0 `webnet_core`/`*.wasm` requests (14 requests
intercepted, none matching).

## 3. Provenance (§5)

`typescript-dense` (TS) · `native-sparse-full-qxx` (R1, still OFF) ·
`native-sparse-selected-qxx` (R2B). Result type is a Dense/Selected union: Selected
results carry `selectedBlocks{store,meta,uniqueColumns}` and NO `qxx` field
(compiler-enforced; overloads keep existing dense callers zero-change).
Fallback results report the route actually used.

## 4. Eligibility (§6, §7)

Fixed order: kill ON → worker-only → WASM available + `queryBlocks` present →
baselines non-empty → all `gnssBaseline`+ECEF (never G/GPS) → valid full 3x3
covariance → zero Tarjan bridges → params measurable → params ≥ 225 →
totalStations ≤ 750 → params ≤ 2250 → block plan measurable → blocks ≤ 4000.
Robust/terrestrial/orientation/TSCORR exclusions are structural (the module cannot
receive them; engine hardcodes robust `none`). Setup allowed (TS-side augmentation
flows effective covariance to native; proven §22–24). Multi-component admitted under
the existing TS rule (parity-tested, no single-component restriction).
Size vars (totalStations/freeStations/fixedStations/numParams/baselineCount/
uniqueFreeFreeEdges/selectedBlockCount/uniqueColumns/factorNnz) logged per job.

## 5. Bounds (§8, §9, §12, W3 derivation in `phase12f3-perf.md`)

MIN_PARAMS 225 = ring TOTAL-wall crossover (222 params, 41→35 ms) + margin.
Mesh crosses at 747 but sub-floor mesh is bitwise-identical at 0.68–0.82x
(correct but slower; stays TS by design). Raising MIN to 747 would forfeit
1.3–8.1x ring/repeated-edge wins in 225–747.
MAX 750 stations / 2250 params = largest measured leg (all admitted topologies OK,
no timeout/OOM). Never exceeds 1000 in this phase; TS fallback stays available
throughout the cohort. MAX_BLOCKS 4000 = max observed 3733 (mesh@750) + 7%.
MAX_FACTOR_NNZ 1.5M = max observed 669,414 (mesh@750, fill 11.07) × 2.24.

## 6. Topology / fill gate (§10, §11)

Preflight records vertices/unique/repeated edges, avg/max degree, free-free unique
edges, block count. No new C++ was needed: the mandatory native correction solve
already returns exact `factorNnz`/`normalNnz`, so the provider closure enforces the
pre-solve fill gate from captured correction metadata BEFORE any block query reaches
the bridge; post-hoc `meta.factorNnz` verification backs it (fail-closed to TS).
Fill ladder (factorNnz / fill): ring 0.55–0.81, repeated-edge 0.56, mesh
0.89→11.07. Worst admitted: mesh@750 (669,414 nnz, 3733 blocks, 23.4 s).
First rejected: none in-cohort by fill (cap 1.5M unreached); chain/survey rejected
pre-load by F-BRIDGE.

## 7. Selected plan + API (§13, §14)

Canonical `buildGnssSelectedBlockPlan` (one Q_ii per free station, one Q_ij per
unique free-free pair, transpose by accessor, fixed/free uses free diagonal only,
repeated pairs once, deterministic order). Generic `solve_sparse_selected_covariance_blocks`
reused unchanged: one factorization, one multi-RHS solve, one bridge call
(provider-call count asserted === 1), compact Float64 store, exact cardinality.

## 8. Safety contract (§16) + tripwires (§15)

`verifyGnssSelectedBlocks` (exact 12F.2 thresholds): cardinality/ordering/finite,
diagonal symmetry ≤ 2e-9, strict positive variances, bitwise transpose contract,
strict 6x6 Cholesky PSD spot — then engine identity gate |Σtrace−dof| < 1e-9
(existing Phase12D policy, no native relaxation). No dense Qxx formed for
verification. Tripwires: full-Qxx canary 0 calls, no `qxx` field, no `querySelected`
(source-guarded), both-providers-present throws.

## 9. Faults (§17) + transposed Q_AB (§18)

15-fault agent matrix + fill/damped/init faults: every leg → route `typescript`,
provenance `typescript-dense`, JSON-identical to clean TS. Transposed Q_AB is
structurally invisible (documented honestly, no fake detector); the contract rests
on canonical orientation + native transpose memoization + deterministic metadata +
full-oracle parity on CI nets (coords bitwise, Qvv rel ≤ 1.7e-14).

## 10. F-BRIDGE (§19)

Pre-existing shared-path condition (near-zero-redundancy bridges yield Qvv
eigenvalues ~−1e-18; R0 itself throws). Math unchanged. Policy: bridged graphs are
NOT admitted (eligibility rejects pre-load; chain/survey legs prove zero bundle
loads). No jitter, no relaxed tolerance. Shared-statistics follow-up recommended.

## 11. Fallback (§20, §21)

Technical native failure → clean TS rerun (bit/JSON-identical where deterministic
contracts permit). Shared domain failures (e.g. F-BRIDGE PSD gate) are NOT fallbacks —
bridge-excluded legs surface the identical TS throw with zero native calls, never
masked as native fallback.

## 12. Commercial evidence (§22, §23, §24; `phase12f3-datasets.md`)

REAL production route, kill ON in-script, real bundle, force-admitted below the
economics-only floor. All 8 legs route `native-sparse-selected-qxx`:

| leg | claim | coords | SEUW rel | Qvv/Cvv rel | identity | TS SEUW → pin |
| --- | --- | --- | --- | --- | --- | --- |
| DatasetA-A0 | controlled TBC | bitwise | 0 | ≤ 1.0e-14 | 0 | 2.100053 ✓ (TBC 2.10) |
| DatasetA-AC | controlled TBC | bitwise | 0 | ≤ 1.7e-14 | 5.7e-14 | 1.297104 ✓ (TBC 1.30) |
| DatasetA-AH | controlled TBC | bitwise | 0 | ≤ 1.4e-15 | 2.8e-14 | 1.988831 ✓ (TBC 1.99) |
| DatasetA-A | controlled TBC | bitwise | 0 | ≤ 3.2e-15 | 2.8e-14 | 1.102511 ✓ (TBC 1.10) |
| DatasetB-B0 | commercial zero-setup | bitwise | 0 | ≤ 1.4e-14 | 2.8e-14 | 1.965038 ✓ (TBC 1.97; GVX coord parity ~1.4e-9 m stands) |
| DatasetB-AC/AH/A | INTERNAL regressions | bitwise | 0 | ≤ 3.2e-15 | ≤ 2.8e-14 | 1.123544/1.885533/0.958125 (no TBC claim) |

Residuals bitwise; station-covariance abs ≤ 5.1e-20; blockT diffs ≤ 3.9e-14;
loops match (A 76/76, B 43/43). Completeness (§25): coords, corrections,
residuals, vTPv/SEUW, station covariance (diagonals), Qvv/Cvv, standardized
residuals, redundancy + trace, block T, loop QC, what-if (re-solve based, unaffected)
— no fast mode, nothing omitted.

## 13. Browser/worker (§28; `phase12f3-worker-proof.md`)

11/11 real-Worker real-WASM legs: below-min→TS, ring/mesh/setup/repeated→R2B
(bitwise, no qxx), chain→TS (5 cut-edges, 0 loads), fill-gate→TS, above-max→TS,
forced-fail→TS, kill-OFF→TS, non-worker→TS. Worker-only enforced; no main-thread
route; no default WASM load from gnssBaseline.

## 14. Performance (§29; `phase12f3-perf.md`, 60 legs, seed 7)

TOTAL-wall TS vs R2B (median): ring 1.15x@75 → 8.1x@750; repeated-edge 1.3x@100 →
5.9x@750; hub-spoke 1.4x@100 → 5.2x@500; mesh 1.25x@250 → 1.59x@750
(37.2 s → 23.4 s). Crossover ≈ 75–100 stations (sparse) / 250 (mesh); MIN 225
sits at the sparse crossover with margin. Worst admitted speedup 1.25x (mesh@250);
nothing admitted runs slower than TS (sub-floor stays TS).

## 15. Memory (§30)

No dense Qxx (tripwire-proven), no boxed p² covariance (the R2B engine path
skips the dead dense-normal accumulation; the shared TS-side sparse assembly is
retained on both routes), no dense A/P (sparse-only assembly shared with the TS path). Upper-cap legs complete with margin (no OOM at 10 GB
heap): mesh@750 R2B 23.4 s, blocks 3733 (134 KB store vs 40 MB dense). Heap-delta
comparison is GC-timing-noisy at GB scale (TS 1790 MB vs R2B 2248 MB on mesh@750 —
both dominated by the shared TS-side assembly, present on either route); the safety
case rests on allocation shape (no p²), not on delta direction. Fallback-safe: TS
fallback available throughout the ≤750 cohort.

## 16. Legacy regression (§32)

Full agent tier: 3245 pass / 1 skip; only 3 `study-desktop` frozen-calibration
failures, re-proven at pristine baseline `d890c6a6` (missing local run data —
environmental, unrelated). WASM tier 54/54 (incl. new 5-test RealWasm route proof).
Industry parity 25/25. TS GNSS, legacy G/GPS, mixed nets, 2D/3D native routes, R1
(default OFF, behavior-balls narrowing-only diff), preanalysis, data-check, blunder
detection, restarts — all unchanged (no dispatcher wiring; no production imports of
the R2B route; overloads keep dense callers source-identical).

## 17. Acceptance A–S

A classifier exact (boundary tests min±1/max±1/cap±1/fill below/exact/above) ✓ ·
B plan exact/deduplicated (canonical, 1 bridge call) ✓ · C no dense Qxx (type-level +
canary + source-guard) ✓ · D correction parity (S3, coords bitwise) ✓ ·
E selected parity (Qvv/Cvv ≤ 1.7e-14) ✓ · F Phase12D complete ✓ ·
G identity ≤ 3e-11 vs 1e-9 policy ✓ · H Dataset A controlled parity ✓ ·
I Dataset B commercial parity ✓ · J setup regressions ✓ ·
K 15-fault detection, all clean-TS ✓ · L F-BRIDGE exclusion safe ✓ ·
M fallback clean (JSON-identical) ✓ · N browser/worker 11/11 + OFF smoke ✓ ·
O fill gate proven (pre-solve + post-hoc) ✓ · P 1.25–8.1x total-wall in cohort ✓ ·
Q memory safe at 750 (no p², no OOM) ✓ · R legacy routes unchanged ✓ ·
S default OFF (kill-OFF + browser proof) ✓.

## 18. Decision (§36): GO-ENABLE-R2B

Bounded R2B is numerically safe (bitwise coords, ≤1.7e-14 statistics, identity
80–30000x under policy), materially faster (1.25–8.1x TOTAL wall everywhere
admitted), memory-safe (no p², 750 proven), fallback-safe (15/15 clean),
browser-safe (real-Worker proof, default-OFF smoke). Bounds stand as certified;
no lowering required. Recommended Phase 12F.4: flip the certified cohort
(225 ≤ params ≤ 2250, ≤ 750 stations, ≤ 4000 blocks, fill ≤ 1.5M nnz,
bridgeless) default ON behind the existing kill switch. Research track stays
separate: Takahashi sparse-inverse-subset (solve count still ~p).
