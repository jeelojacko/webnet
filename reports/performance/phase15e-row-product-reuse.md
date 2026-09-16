# Phase 15E: solve-local residual-covariance row-product reuse (dense path)

## 1. Design (§42 ordering followed)

Step 1 of the preferred ordering was already satisfied before this phase:
the transient `B = A·Qxx` (m×n) has a solve-local lifetime inside
`computeStandardizedResidualStatistics` shared by every consumer (diagonal
qvv loop, `crossAqxxat`, GPS block covariance, stochastic blocks, external
reliability). No second B was created.

What repeated was the quadratic-form dot `B[rowA]·a_rowB` per ordered
equation pair:

- GPS 2×2/3×3 `solveQvv` dots every block pair, then the stochastic block
  assembly re-dots the same ordered pairs;
- the statistical-MDB sensitivity (`statisticalSensitivity`) re-dots
  coupled pairs already dotted by the stochastic cross-term assembly;
- the phase-one diagonal `a_i·u_i` is re-dotted as `cross(i, i)` by both
  of the above.

The fix is a solve-local ordered-pair memo
(`src/engine/statisticsDenseRowProductCache.ts`, ~150 lines): one tested
`dotRow` helper with the IDENTICAL accumulation order of the legacy inline
dots (sparse entries in order, `?? 0` fallbacks), keyed by equation-row
index (`rowA * rowCount + rowB`), storing one float per unique ordered
pair. Diagonal, GPS, sensitivity, and stochastic consumers all route
through it. First computation is bit-identical; the memo only skips exact
recomputation. `NaN`/missing rows flow through the same fail-closed paths
as the legacy code (cross readers already treat `undefined` as
unavailable; the diagonal keeps a verbatim legacy fallback that throws
identically on a corrupt missing B row).

Lifetime: one cache per statistics call (primary solve, each LOO
alternate, each auto-adjust solve, post-final robust stats); never across
solves/iterations; no module-global cached values. The sparse row-product
route (`adjustStatisticsRowProducts.ts`, WASM, C++) is untouched — the
cache is constructed only on the dense path. Native-derived verified dense
Qxx flows through the same provider (it only sees B + sparse rows).

Kill switch: module-local `setStatisticsDenseRowProductReuseEnabled`
(default ON), test-only, no user setting. OFF = legacy recompute-every-dot
with identical arithmetic.

## 2. Op-count evidence (kill-switch oracle)

Machine artifact: `artifacts/evidence/phase15e/phase15e-row-product-benchmark.json`
(gitignored); producer: `tests/evidence/phase15e_row_product_benchmark.test.ts`
(evidence tier, registered in `scripts/testTiers.ts`).

| fixture | m×n | requests | legacy dots | reuse dots | hits | saved |
|---|---|---|---|---|---|---|
| chain-2d-64 | 258×128 | 258 | 258 | 258 | 0 | 0% |
| chain-2d-128 | 514×256 | 514 | 514 | 514 | 0 | 0% |
| gps-2d-64 | 386×128 | 898 | 898 | 514 | 384 | 43% |
| gps-2d-128 | 770×256 | 1794 | 1794 | 1026 | 768 | 43% |
| chain-2d-tscorr-64 (+stat MDB) | 258×128 | 708 | 708 | 386 | 322 | 45% |
| gps-3d-64 | 515×192 | 1027 | 1027 | 643 | 384 | 37% |
| gps-3d-128 | 1027×384 | 2051 | 2051 | 1283 | 768 | 37% |

Hit breakdown by consumer (gps-2d-64: 642 quadratic + 256 cross requests):
diagonal pairs memoized in phase one are re-served to the GPS `solveQvv`
block transform and the stochastic GPS-block assembly; on the
tscorr+statistical arm the sensitivity sum re-serves pairs dotted by the
stochastic cross-term assembly. Legacy scalar traverse has zero
duplication in legacy-MDB mode (sensitivity short-circuits; stochastic
scalar rows need no cross terms), so the memo honestly reports 0 hits
there — no phantom win claimed.

## 3. Wall-clock benches (warmed median, 1 warm-up + 5 measured)

| fixture | legacy wall | reuse wall | Δ | stats stage legacy→reuse |
|---|---|---|---|---|
| chain-2d-64 | 21.45 ms | 18.28 ms | −14.8% | 6.64→6.01 ms |
| chain-2d-128 | 72.64 ms | 72.42 ms | −0.3% | 15.33→14.45 ms |
| gps-2d-64 | 25.02 ms | 24.12 ms | −3.6% | 8.89→8.89 ms |
| gps-2d-128 | 93.55 ms | 89.08 ms | −4.8% | 20.30→20.56 ms |
| chain-2d-tscorr-64 | 18.28 ms | 18.06 ms | −1.2% | 6.50→5.96 ms |
| gps-3d-64 | 44.22 ms | 43.27 ms | −2.2% | 10.11→10.22 ms |
| gps-3d-128 | 208.38 ms | 209.99 ms | +0.8% | 33.27→39.45 ms |

The dots saved are microsecond-scale against B construction (`m·n·nnz`)
and the statistics inversion, which dominate the stage. The chain-2d-64
−14.8% is a 3 ms move on a 21 ms solve and does not replicate at 128
(−0.3%): run-to-run noise, not a trend.

## 4. Memory deltas

No new retained storage. Peak transient is unchanged (the existing B,
`m·n·8` bytes: 258 KiB at chain-2d-64 … 3.0 MiB at gps-3d-128); the memo
adds one float per unique ordered pair actually dotted (≤ requests,
i.e. ≤ 16 KiB on the largest arm) and dies with the statistics call. The
chain-2d-512 shape (m2050×n1024 ≈ 16 MiB B) was deliberately not
materialized further: lazy ordered-pair memo, never an eager second B.

## 5. External reliability: decision B (left unchanged)

`shiftForRow` already consumes the shared transient B rows directly
(one saxpy per coupled row — inherent to producing one shift vector per
equation, not recomputation). The full-P column form `Qxx·A'·P·e_i` would
require NEW adjoint products (`Qxx·a_j'`, n-vectors per column) that share
nothing with the memoized `B[rowA]·a_rowB` row-products, so there is no
reuse gain to integrate — only new code and new risk on a bit-pinned path.
Measured cost of leaving it: zero (no duplicated dots found there).
Rationale recorded; no `P_ii·u_i` shortcut taken anywhere.

## 6. Parity

- OFF vs ON full-`AdjustmentResult` JSON parity (timing/telemetry
  stripped): bit-identical on all 7 benchmark fixtures plus a
  suspect-impact `on` LOO session (fresh cache per alternate solve).
- Agent tier `tests/phase15e_row_product_reuse.test.ts` (11/11): unit
  order/kill-switch/counters/fail-closed tests + OFF-vs-ON parity for
  scalar, GPS-2D, GPS-3D, orientation unknowns, correlated-TS, statistical
  reliability model, and residual-CSV export.
- `parity:industry-reference` 25/25, `test:wasm` 74/74 with reuse ON
  (production default).

## 7. GO / NO-GO

**NO-MEANINGFUL-GAIN on the §39 timing bar** (no arm reaches ≥5% total or
≥15% stats-stage beyond noise), reported honestly per mission. The change
is kept because it is zero-risk and does real, measured work: 37–45% fewer
quadratic-form dots on every GPS / correlated-TS + statistical arm, zero
added memory, zero numerical change (bit-identical everywhere), one small
module, full oracle coverage. It removes the R2/R3 re-dot duplication at
the source, so any future heavier consumer of `a_A·Qxx·a_B'` gets the memo
for free.
