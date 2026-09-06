# Phase 8B pre-sentinel cost (measured 2026-09-06)

Measured current production preanalysis-route sentinel scaling BEFORE the
Phase 8B bounded refactor. Method: deterministic synthetic SPD normals
(diagonally-dominant tridiagonal + weak links, diagonal weights) at
n = 16/32/64/128 through the exact production helpers
(`probeSelectedCovariance`, `invertSPDFromCholesky` +
`unscaleNormalInverse`, `buildAllPairsQueries` + `evaluateSentinelC2`)
via `npx tsx /tmp/phase8b_cost_probe.ts` (throwaway probe, not committed).
Times are per planning system on this machine; a session admits up to 64
planning systems, so per-system cost multiplies by the system count.

## C1: full dense inverse reference

| n   | full inverse (invert + unscale) | selected solves (factor once + n col solves) |
| --- | ------------------------------- | -------------------------------------------- |
| 16  | 0.12 ms                         | 0.21 ms                                      |
| 32  | 0.14 ms                         | 0.42 ms                                      |
| 64  | 0.53 ms                         | 1.48 ms                                      |
| 128 | 3.07 ms                         | 7.56 ms                                      |

The full inverse materializes a complete n x n Qxx (16,384 entries at
n = 128) purely as a C1 reference, plus a full-matrix unscale pass over
the same n^2 entries. It is the only full-Qxx allocation left on the
production preanalysis route (no dense P is ever built).

## C2: n^2 all-pairs verification

| n   | all-pairs entries | full-column solves | residual eval over n^2 | bounded k=16 (entries / total) |
| --- | ----------------- | ------------------ | ---------------------- | ------------------------------ |
| 16  | 256               | 0.23 ms            | 0.18 ms                | 256 / 0.33 ms                  |
| 32  | 1,024             | 0.44 ms            | 0.36 ms                | 512 / 0.41 ms                  |
| 64  | 4,096             | 1.67 ms            | 1.66 ms                | 1,024 / 0.90 ms                |
| 128 | 16,384            | 7.49 ms            | 7.38 ms                | 2,048 / 2.29 ms                |

At n = 128 the n^2 verification costs ~15 ms per planning system
(7.49 ms native-equivalent full-column solves + 7.38 ms residual eval)
and ships 16,384 query entries plus 16,384 native values per system.
Bounded k = 16 complete columns cost 2.29 ms total over 2,048 entries
(~6.5x cheaper, 8x fewer entries). Worst case over a full 64-system
session: ~960 ms sentinel overhead unbounded vs ~147 ms bounded.

## Decision recorded

- C1: drop `invertSPDFromCholesky` / full Qxx; factor dense N once and
  use selected column solves only (diagonal decode check).
- C2: drop `buildAllPairsQueries` (n^2 native re-query); verify a
  bounded deterministic set of complete columns with hard
  k = `PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT` = 16
  (all n rows per column, evenly spaced including 0 and n-1;
  every column below k verifies all columns). Full columns only:
  partial columns never verify, they fail closed as before.
- Keep C1 + C2 + physical C3 hybrid, warn-only condition, correction
  non-authority, no dense P / full Qxx, no adjustment-route changes.
- Add source/no-n^2 guards plus focused tests (see Phase 8B release report).
