# Phase 12F.2 — Batched Selected-Covariance Native Architecture (evidence only)

Branch: `feat/gnss-native-batched-selected-covariance`. Baseline `c3730533` (PR #42 merge). HEAD `63ee1587`.
No production routing, no R1 default change (stays OFF), no GNSS/Phase12D math or tolerance changes, no UI,
no C++ parser logic, setup uncertainty stays TS-side, no vendor files committed.

## 1. Old-R2 root cause (§1)

Real-WASM profile (`reports/gnss/phase12f2-profile.md`, `npm run gnss:selected-profile`):
R2 already used **1 bridge call + 1 factorization** per run. Exonerated: bridge crossings (3 total,
milliseconds), factorization duplication (zero by construction).

- **Chain: A (repeated triangular solves).** Unique queried columns == parameter count at every size
  (ratio 1.0) — R2 solves effectively the full inverse. Solve 3.1 ms@100 → 634 ms@2000.
- **Mesh: D (TS-side pack) + G (TS dense assembly).** Pack 3.4 s@1000; JS heap Δ 2.9 GB@1000;
  mesh@1500/2000 OOM in TS dense equation assembly *before* native runs. Native heap Δ only ~85 MB@1000.
- Result representation (E): old R2 mirrors dense `qxx: number[][]` (p² boxed numbers).
- 1000-station ~27.7 s / ~2 GB = TS dense assembly + pack + mirror + GC + p column solves, not the bridge.

Topology dependence (§8): factor nnz 22 779 (chain@1000) vs 1 146 987 (mesh@1000) drives solve
173 ms vs 3518 ms. Fill-in, not station count alone, gates admission.

## 2. Request set + API + algorithm (§§2-7, 28)

- Canonical plan (`src/engine/gnssSelectedBlockPlan.ts`): one Q_ii per free station, one Q_ij per unique
  free-free pair (Q_ji = transpose, never re-requested), free side only for fixed edges, repeated
  baselines once. Raw → canonical scalars: chain@1000 28.6%, mesh@1000 50.0%.
- Generic C++ `solve_sparse_selected_covariance_blocks` (blockRow/ColStarts + blockSize, dimension-generic;
  no station semantics): one factorization, unique-column canonicalization, ONE multi-RHS
  `SimplicialLLT::solve` (n×m needed columns only), identical pairs memoized, (B,A) = bitwise transpose
  of canonical (A,B), streaming extraction (no p dense vectors retained), no dense Qxx.
  WASM `webnet_sparse_selected_covariance_blocks` + `queryBlocks` = exactly 1 bridge call.
- Algorithm verdict: unique columns ≈ p, so R2B is honestly **PARTIAL** on §7 (effectively full-inverse
  solve work; wins are storage/bytes/postprocess, not asymptotics). Takahashi/sparse-inverse-subset
  identified as the next research lever, explicitly NOT implemented (research-heavy, per §5).
- TS store (`src/engine/gnssSelectedBlockQuery.ts`): flat Float64Array chunks + transpose accessor;
  no dense mirror ever allocated. `recoverGnssBaselineStatisticsFromBlocks` reuses identical Phase12D
  formulas with the block accessor; missing block throws, never silent full-Qxx fallback (§27).

## 3. Numerical parity (§§10-12)

- Blocks vs TS dense Qxx: abs ≤ 7.4e-19, rel ≤ 6.5e-13 (small nets). Block-vs-scalar not bitwise
  (single- vs multi-RHS ULPs ~1.8e-15); intra-API duplicate/transpose/determinism bitwise by construction.
- R2B vs R0: coords/residuals **bitwise**; vTPv ≤ 8.1e-15; Qvv/Cvv ≤ 1.1e-11 (mesh ≤ 750); blockT ≤ 2.4e-10;
  what-if top1/top5 match; loop QC counts match.
- Redundancy identity (§13): worst |Σtrace(R) − DOF| = **4.0e-11** (gate 1e-6) over full corpus. PASS.
- Chain statistics blocked for ALL routes by pre-existing F-BRIDGE production PSD gate
  (λ_min ~ −1e-18 roundoff on ~zero-redundancy bridges; R0 itself throws — orthogonal to R2B).
- Dataset B (§14, local intake, never committed): R0-vs-R2B on all setup cases — coords bitwise,
  SEUW rel ≤ 5.7e-16, Qvv/Cvv rel ≤ 1.5e-14, identity 2.8e-14. A0 SEUW 1.965038 reproduces the pin.
- Setup cases (§15): A0/AC/AH/A all PASS (TS augmentation → effective covariance → native blocks).

| setup | SEUW R0 | coordAbs | seuwRel | qvvRel | identity R2B |
| --- | --- | --- | --- | --- | --- |
| A0 | 1.965038 | 0 | 5.7e-16 | 1.4e-14 | 2.8e-14 |
| AC | 1.123544 | 0 | 2.0e-16 | 3.1e-15 | 2.8e-14 |
| AH | 1.885533 | 0 | 0 | 1.1e-15 | 0 |
| A | 0.958125 | 0 | 0 | 3.2e-15 | 2.8e-14 |

## 4. Safety (§§20-22)

Selected-only checks (dims/cardinality, finite, symmetry, positive variance, transpose consistency,
6×6 PSD spot, redundancy identity, vTPv/SEUW finite, ordering) — no dense-Qxx verification tax (§20).
Fault matrix 9/10 caught (identity catches 8); transposed-Q_AB structurally invisible but numerically
identical here, covered by oracle-parity backstop (§21). Recommendation (§22): no runtime TS oracle;
sampled/periodic debug oracle only — production policy NOT chosen here.

## 5. Performance / memory / scaling (§§16-19, 23-24)

R2B vs R0 1.8–15.7× (mesh@750: 69 s → 12 s); R2B ≈ old-R2 on solves (same columns) but far fewer bytes
(bridge: 1 vs 1 call, 222→21 requests, 1776→1512 B on probe) and no p² retention anywhere (§§23-24).
Mesh@1000/1500 R2B-only PASS (30 s/84 s) where TS-dense legs OOM. 2000: chain TIMEOUT, mesh MEMORY FAIL
(TS-side) — documented bounds, not hidden. 3000/5000 probe NOT attempted (2000 gate failed, per §19 rule).
Multi-component: audit multi-component parity passes; R1 one-component restriction untouched (§25).

## 6. Decision (§30): GO-R2B-WITH-BOUNDS

Numerically safe (parity + identity), lower memory (scales with factorization + result set), browser/WASM
practical (O(1) bridge calls), faster than TS in target cohort — but NOT a solve-count fix, and NOT
viable at 1500–2000 without further bounds. Recommended Phase 12F.3: production-proof R2B inside strict
station/topology/fill-in bounds + F-BRIDGE gate policy; research track: Takahashi sparse-inverse-subset.

## Acceptance (§32)

A root cause identified (A/D/G, bridge exonerated) · B canonical/dedup plan + tests · C generic block API
· D no dense Qxx (asserts + fail-closed) · E block parity ≤ 6.5e-13 · F Phase12D complete (mesh/ring/spoke/B) ·
G identity 4.0e-11 · H Dataset B parity · I A0/AC/AH/A parity · J 9/10 fault matrix · K 222→21 requests,
O(1) calls · L no p² retention; mesh@1000/1500 survive where dense OOMs · M 1.8–15.7× vs TS · N 2000
TIMEOUT/MEMORY-FAIL documented · O no production routing change (R1 default OFF verified).
