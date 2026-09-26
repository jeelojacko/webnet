# Phase 19A — Survey Table Performance (§§119-120)

**Branch:** `feat/cad-survey-plan-production` · **Probe:** `scripts/phase19aTablePerf.ts`
(`npx tsx scripts/phase19aTablePerf.ts [--quick]`) · **Status:** measurement only, no `src/` changes.

## Machine note

AMD Ryzen 7 5800X3D (16 threads), 31 GiB RAM, Node v26.8.1, `npx tsx`.
Medians of 5 reps after warmup (2 reps + 100/1,000 scales with `--quick`).
Times are wall-clock on this machine — use for scaling shape, not as a budget.

## 1. Full derive / bounds / export-scene at scale

Point table (N survey-point sources + N-row point table); line table
(N line sources + N-row line table). `scene` = `buildExportSheetScene`
(model + table + title block); `svg` = `serializeExportSceneToSvg`.

| table | rows | derive (ms) | bounds (ms) | scene (ms) | svg (ms) |
| --- | --- | --- | --- | --- | --- |
| point | 100 | 0.5 | 0.3 | 2.3 | 0.9 |
| point | 1,000 | 13.4 | 9.0 | 19.8 | 7.5 |
| point | 10,000 | 529.2 | 528.7 | 476.0 | 83.5 |
| line | 100 | 0.4 | 0.3 | 1.5 | 0.8 |
| line | 1,000 | 13.1 | 8.7 | 12.2 | 8.1 |
| line | 10,000 | 574.7 | 570.2 | 510.0 | 101.1 |

## 2. Scaling exponents (1.00 = linear, 2.00 = quadratic)

| range | point derive | point bounds | point scene | point svg | line derive | line bounds | line scene | line svg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 → 1,000 | 1.44 | 1.42 | 0.94 | 0.94 | 1.50 | 1.52 | 0.90 | 0.98 |
| 1,000 → 10,000 | 1.60 | 1.77 | 1.38 | 1.04 | 1.64 | 1.81 | 1.62 | 1.10 |

No catastrophic O(rows²) blowup, but derive/bounds are clearly
**superlinear** (exponent climbing toward 2 at 10k). Known cause, not a
mystery: every row resolves its source with a linear `project.entities`
scan (`findEntity` in `cadSurveyTables.ts` / `cadSurveyTableDerive.ts`),
so a full N-row derive is N linear scans. SVG serialization stays
~linear throughout. The export scene tracks the derive at 10k because the
display scene derives the table the same way.

Two compounding notes:

- `cadSurveyTableWorldBounds` re-runs the **full** `deriveCadSurveyTable`
  and keeps only the corners (identical cost to derive at every scale).
  Callers that need both should derive once and reuse the grid.
- At ≤1,000 rows none of this matters: full derive ≈ 13 ms.

## 3. Incremental source update

10 point tables × 100 rows (1,000 sources); one source point moved
(+1.5/−0.5 m). Guard verified the edited value actually flows into the
derived row (no stale cache to fool the timer). Derivation is stateless
read-time, so "incremental" = re-derive only the affected table:

| re-derive scope | ms (median) |
| --- | --- |
| affected 100-row table only | 0.29 |
| all 10 tables (1,000 rows) | 13.03 |

Even the blunt full re-derive of all tables is ~13 ms. Targeted
re-derive after an edit is sub-millisecond. No invalidation machinery
is needed to hit interactive latency.

## 4. §120 verdict: skip memoization

Full derive is trivial at practical survey-plan sizes (sub-ms at
~100 rows, ~13 ms at 1,000 rows) and incremental re-derive of the
affected table is 0.3 ms — so **no memoization layer** (§120 stays
un-triggered). Honest caveats, recorded so a future 10k-row table
doesn't surprise anyone:

1. The per-row linear entity scan makes derive superlinear; at 10,000
   rows it costs ~0.5 s. If 10k-row tables ever become a real case, the
   fix is a scoped entity-by-id lookup map threaded through
   `resolveCadSurveyTableRows`, not a memoization cache (derivation is
   already stateless, so a lookup map keeps it correct by construction).
2. `cadSurveyTableWorldBounds` should reuse a single derivation instead
   of re-deriving; same fix site as (1).

Raw JSON from the probe run is printed to stdout as `[19A-PERF] JSON`.
