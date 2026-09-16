# Phase 15F selected-covariance evidence — benchmark record

Base: feat/selected-covariance-production-contract-audit on origin/main cbceefbc.
Method: ROUTE A measured (TS full-dense, 1 warm-up + 3 timed medians, this machine);
ROUTES B/C/D conceptual (15F(a) prototype unit cost × real counts, no production routing).
Tolerances: existing; selected columns bit-identical (§40 proven in prototypes.json);
factor-solve CoordEff max rel err ~2e-15 across diagonal/GPS-block/TS-correlated P (§41).
Phase 15E micro-caches not revisited (lesson cited: <2% — reuse must be structural).

## 1. ROUTE A benchmark matrix (full-dense, measured)

| fixture | arm | params | equations | stations | relPrec rows | wall ms | final-Qxx ms | stats ms | cov ms |
|---|---|---|---|---|---|---|---|---|---|---|
| chain-2d-32 | base | 64 | 130 | 34 | 496 | 14.88 | 1.34 | 5.52 | 6.86 |
| chain-2d-64 | base | 128 | 258 | 66 | 2016 | 25.05 | 3.85 | 7.42 | 11.27 |
| chain-2d-128 | base | 256 | 514 | 130 | 8128 | 88.67 | 26.75 | 16.34 | 43.09 |
| gps-2d-64 | base | 128 | 322 | 66 | 2016 | 38.05 | 5.08 | 10.12 | 15.2 |
| gps-2d-128 | base | 256 | 642 | 130 | 8128 | 136.23 | 33.18 | 25.51 | 58.69 |
| gps-3d-64 | base | 192 | 451 | 66 | 2016 | 75.98 | 16.39 | 17.56 | 33.95 |
| gps-3d-128 | base | 384 | 899 | 130 | 8128 | 295.74 | 106.63 | 33.51 | 140.14 |
| chain-2d-64 | ts-correlated | 128 | 258 | 66 | 2016 | 23.93 | 4.34 | 7.2 | 11.54 |
| chain-2d-64 | robust-final | 128 | 258 | 66 | 2016 | 29.73 | 4.65 | 12.15 | 16.8 |

Arms: base, ts-correlated (parse flag only), robust-final (.ROBUST HUBER 1.5).
Weighted-control: production control constraints ride the same dense path (NOT-AFFECTED —
no separate arm needed). Free-network: NOT-RUN (no datum-defect fixture in scope).

## 2. Conceptual routes (derived, n=192 full-solve calibration 9.56 ms)

| fixture (arm) | A cov ms | B selected-station ms | C factor-on-demand ms | D hybrid ms |
|---|---|---|---|---|
| chain-2d-32 (base) | 6.86 | 0.56 | 0.72 | 1.28 |
| chain-2d-64 (base) | 11.27 | 4.38 | 5.71 | 10.09 |
| chain-2d-128 (base) | 43.09 | 34.54 | 45.52 | 80.06 |
| gps-2d-64 (base) | 15.2 | 4.38 | 7.13 | 11.51 |
| gps-2d-128 (base) | 58.69 | 34.54 | 56.85 | 91.39 |
| gps-3d-64 (base) | 33.95 | 9.86 | 22.47 | 32.33 |
| gps-3d-128 (base) | 140.14 | 77.71 | 179.13 | 256.84 |
| chain-2d-64 (ts-correlated) | 11.54 | 4.38 | 5.71 | 10.09 |
| chain-2d-64 (robust-final) | 16.8 | 4.38 | 5.71 | 10.09 |

Reading: B pays per station-coordinate column; C pays per equation RHS; D pays both.
Covariance (final-Qxx + statistics) is ~40-50% of ROUTE A wall, yet B/C/D still
lose or tie: B's column count ≈ n on GPS networks, and C's RHS count ≈ 2n.

## 3. All-pairs materialization cost (§19)

| stations | pairs | calc loop ms | retained | postMessage | JSON |
|---|---|---|---|---|---|
| 32 | 496 | 0.01 | 126.3 KiB | 126.3 KiB | 126.3 KiB |
| 64 | 2016 | 0.04 | 513.4 KiB | 513.4 KiB | 513.4 KiB |
| 128 | 8128 | 0.17 | 2069.7 KiB | 2069.7 KiB | 2069.7 KiB |
| 256 | 32640 | 0.66 | 8311.5 KiB | 8311.5 KiB | 8311.5 KiB |

Save/load impact: retained JSON scales ~O(S²) — 256 stations ≈ 8312 KiB
rel-precision section alone; full session JSON dominated by equations, not pairs.

## 4. Test-harness counters (§20, NOT src/ telemetry)

```json
{
  "chain-2d-64": {
    "fullQxxRequiredBy": [
      "station-covariances×64",
      "relative-precision×2016"
    ],
    "selectedCovarianceRequiredBy": [
      "station-cov-blocks×64"
    ],
    "relativePrecisionRows": 2016,
    "externalReliabilityRows": 258
  },
  "gps-3d-128": {
    "fullQxxRequiredBy": [
      "station-covariances×128",
      "relative-precision×8128"
    ],
    "selectedCovarianceRequiredBy": [
      "station-cov-blocks×128"
    ],
    "relativePrecisionRows": 8128,
    "externalReliabilityRows": 899
  }
}
```

## 5. Product-contract delta table (§30)

| product | Full-Dense | Selected (B) | On-Demand (C) |
|---|---|---|---|
| Coordinates | IDENTICAL | IDENTICAL | IDENTICAL |
| Residuals | IDENTICAL | IDENTICAL | IDENTICAL |
| SEUW | IDENTICAL | IDENTICAL | IDENTICAL |
| Chi-square | IDENTICAL | IDENTICAL | IDENTICAL |
| Local tests | IDENTICAL | IDENTICAL | IDENTICAL |
| Redundancy | IDENTICAL | IDENTICAL | IDENTICAL |
| MDB | IDENTICAL | IDENTICAL | IDENTICAL |
| CoordEff (external reliability) | IDENTICAL | IDENTICAL | IDENTICAL |
| 14C / verification | IDENTICAL | IDENTICAL | IDENTICAL |
| Station-cov blocks | IDENTICAL | IDENTICAL | AVAILABLE-LATER |
| Ellipses | IDENTICAL | IDENTICAL | AVAILABLE-LATER |
| Rel-precision (all pairs) | IDENTICAL | IDENTICAL | AVAILABLE-LATER |
| Text listing | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| Industry listing | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| CSV export | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| LandXML export | NOT-AFFECTED | NOT-AFFECTED | NOT-AFFECTED |
| Saved-JSON | IDENTICAL | REQUIRES-FULL | REQUIRES-FULL |

Rationale: B solves exactly the columns every covariance product needs → IDENTICAL
(bit-proven). C materializes nothing up front → products AVAILABLE-LATER on first
demand (same factor, same numerics). Saved-JSON REQUIRES-FULL only in the sense that
a saved session must remain self-contained: persisting factor + replaying solves on
load is an architecture change, hence NO-GO under §42 (below).

## 6. Threshold / crossover (§32-33)

Measured true covariance cost (profiler final-Qxx + statistics stages, NOT the
conflated solveTimingProfile factorization bucket) is 38-53% of ROUTE A wall —
covariance IS the largest single stage. The §42 bar (≥20% total-wall saving)
therefore needs a route that cuts covariance cost roughly in half. None does:

- B selected-station: GPS networks carry ~3 station-coordinate columns per
  station ≈ all params (gps-3d-128: 390 station cols vs 384 params) — the
  prototype 1.3-1.5× inversion-vs-solves delta applies to a column count
  barely below n. Derived B saving at gps-3d-128 ≈ 33 ms of 312 ms wall
  (~11%). Terrestrial chains exclude orientation unknowns (~n/4), capping
  the B win at ~25% of the final-Qxx stage ≈ ~8% of wall. Below the bar.
- C factor-on-demand: full product parity needs one RHS per equation, and
  m ≈ 2n. Prototype n=384: batched 768-RHS solve ≈ 133 ms vs full invert
  ≈ 72 ms — C costs ~2× ROUTE A covariance for identical output. It only
  wins when demanded RHS ≪ n (spot queries), which the full product set
  never is. Derived C at gps-3d-128 ≈ 181 ms vs A cov 146 ms. Below the
  bar (negative).
- D hybrid pays B + C. No crossover in-range; none projected: the B fraction
  shrinks as station-density rises, and C scales with m, not n.

Memory (§33): full Qxx 8n² bytes (n=384 → 1.18 MB; n=768 → 4.72 MB) vs
factor (8n², same order — Cholesky factor is dense for these profiles) + columns
(8nk) + RHS (8nm). Selected routes do NOT reduce peak factor memory on dense
profiles; they only trim retained Qxx. Relief is KiB-to-MB, not structural.

## 7. B-avoidance (§35)

Products obtainable without full B (Qxx): station-cov blocks (station columns),
ellipses (same columns), rel-precision pairs (pair-column dots), CoordEff (one
factor-solve per equation + dots), Qvv diagonal (same solves). Full B is needed
by NOTHING in the current product set — but avoiding its computation saves only the
inversion-vs-solves delta (≈30% of the final-Qxx stage, ≈8-11% of wall for B;
C is net-negative at full coverage).

## 8. Complexity / risk matrix (§43)

| change | numerical | arch | UI | persist | export | memory |
|---|---|---|---|---|---|---|
| B selected-station | LOW (bit-identical) | MED (query plan + store) | LOW | MED (saved-JSON) | LOW | LOW (trim retained) |
| C factor-on-demand | LOW (≈1e-15) | HIGH (lazy cache + lifecycle) | MED (AVAILABLE-LATER) | HIGH (factor persist) | LOW | MED |
| D hybrid | LOW | HIGH | MED | HIGH | LOW | MED |

## 9. Decision (§42: ≥20% total-wall or major scaling/memory relief, else NO-GO)

Preliminary decision: **NO-MEANINGFUL-GAIN (KEEP-FULL-DENSE)**.

Justification: (i) covariance is ~45% of wall, so the §42 20% bar needs a ~45%
covariance cut — but B saves only ~8-11% of wall (station columns ≈ all params
on GPS networks; orientation exclusion caps chains) and C costs ~2× full-dense
for full-equation coverage (m ≈ 2n RHS); (ii) memory relief is ≤ ~4 MB at the
native cap, not structural (factor stays dense); (iii) contract retention for C/D
requires lazy-materialization architecture + factor persistence (HIGH arch/persist
risk) with negative wall payoff; (iv) B is LOW-risk and bit-identical but buys ~1-3%
wall — below the bar, and adds store/query-plan surface for no user-visible gain.
Possible §44 outcomes A-F reviewed: GO-15G-HYBRID / SELECTED / FACTORIZATION-QC /
DEFERRED all fail §42 on these numbers; MORE-EVIDENCE unwarranted — the gap is
two orders of magnitude, not a measurement refinement. Revisit only if the
production cohort grows past n≈2000 (where memory scaling may dominate), since covariance
is already ~45% of wall and the gap to the §42 bar is structural, not measurement noise.
