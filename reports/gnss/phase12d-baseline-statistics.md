# Phase 12D Report — Static GNSS Baseline Statistics and QC

- Branch: `feat/static-gnss-baseline-statistics`
- Baseline: `399e4793` (12C over 12B over `origin/main 9441897b`;
  PRs #35/#36 unmerged at branch time, stacked locally)
- Production UI changed: NO. Adjustment math changed: NO.
- Native routing changed: NO. WASM changed: NO. Robust: NO.
- Mixed GNSS/terrestrial: NO. Tolerances changed: NO.

## 12A–12C contradiction check

None, one refinement: the 12A §9 "T_i ~ χ² with 3 DOF" wording is
replaced by the proven contract (rank df, no p-value); MATH.md §9
corrected and §13 appended.

## New modules (TS-dense only, no legacy-statistics changes)

- `src/engine/gnssBaselineStatistics.ts` — Qvv/Cvv block recovery,
  Jacobi eigen rank policy, redundancy, component t, block T,
  suspect ranking.
- `src/engine/gnssBaselineLoops.ts` — union-find fundamental cycle
  basis, closure QC, traversal reversal helper.
- `src/engine/gnssBaselineReport.ts` — structured report + text
  renderer + one-block removal what-if.
- `src/engine/gnssBaselineAdjust.ts` — additive `statistics` field.
- `tests/gnssBaseline/gnssBaselineGoldenStats.ts` — independent
  reference (worker-built; sign bug found by parity testing and fixed).

## Stochastic contract

Imported 3×3 = C_ll = Q_ll (σ₀² apriori = 1); P = Q_ll⁻¹;
Qxx = (AᵀPA)⁻¹; σ̂² = vᵀPv/dof; Cvv = σ̂²Qvv. Scale never re-enters
weights (matches existing scalar t = v/(s0√qvv) practice).

## Gates

- A (Qvv): six-term max diff vs independent golden < 1e-12 (triangle),
  < 1e-15 (correlated/repeated); PSD enforced, no jitter.
- B (redundancy): trace ∈ [0,3]; Σ trace = dof to < 1e-9 on quad,
  triangle, repeated fixtures.
- C (components): t = v/√Cvv verified formula-direct; Cll-confusion
  catcher fixture (Cvv < 0.9·Cll, t > 1.1× naive).
- D (block stat): T = vᵀCvv⁺v, rank df, `diagnostic-only`, no p-value
  anywhere (JSON scanned); explicit-inverse verification 1e-12.
- E (loops): vector < 1e-12, covariance < 1e-18, T < 1e-9 vs golden;
  parallel-edge cycles; reversal invariance; rank = E−V+C proven.
- F (blunder): whole-block removal only; ranking + what-if; no auto
  deletion. Smearing documented honestly (rank flags region,
  removal attributes culprit: drop-culprit seuw → 0, drop-elsewhere
  seuw stays > 1).
- G (report): structured JSON-safe object + deterministic text with
  all required sections; ECEF labels only; reorder-stable.
- H (routing): TS-dense provenance retained; new modules source-scanned
  for wasm/sparse/robust/worker constructs.
- I (legacy): existing statistics untouched (GNSS never enters scalar
  paths); full suite below.

## Frame invariance

ECEF vs shared-ENU: redundancy trace diff < 1e-6; coordinates < 1e-9
(12C); T equivalence follows from v′=Rv, Cvv′=RCvvRᵀ unit coverage.

## Performance (dev machine, record-only)

10 stations: solve 7.4 ms, loop 1.0 ms, total+report 11.3 ms.
50 stations: solve 14.0 ms, loop 0.6 ms, total 26.1 ms.
100 stations: solve 60.3 ms, loop 0.5 ms, total 125.5 ms.
No global Qvv (O(B·3×3) + existing Qxx).

## Deferred with reasons

p-values (scale estimated — neither χ² nor F exact), block MDB
(no derivation in scope), automatic iterative deletion (multiple
testing), F/studentized variant (would be a second statistic).

## Validation

- `tests/gnssBaseline/`: 17 files, 119 tests green (92 pre-12D).
- lint 0 errors (2 pre-existing warnings); typecheck clean; build clean.
- `test:agent`: 3048 passed / 1 skipped; same 3 pre-existing Study
  calibration failures as 12B/12C (proven via stash there; untouched
  domain).
- Industry parity 25/25; native-route focused suites 35/35
  (7c sparse auto-route, 11a production cap, 7d hardening).
