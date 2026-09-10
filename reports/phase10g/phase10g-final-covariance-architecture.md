# Phase 10G final-covariance architecture decision

Branch: `feat/3d-final-covariance-architecture-evidence`
Baseline: `6f3ae19838eb6bf9e9677b54632667c93e0ddfa5`
HEAD: `455940d8` (pre-review fix)
PR: #21

Production behavior changed: **NO**  
Mathematical contract changed: **NO**  
Public result contract changed: **NO**  
Production routing changed: **NO**

Evidence-only campaign (`tests/evidence/phase10g_final_covariance_architecture.test.ts`,
suite `phase10g`). Corpus: Phase 10F set (industry_demo terrestrial +
gps-3d-cov-08/16/32/64/128 + synthetic orientation-heavy gps-3d-16 with 16
direction sets, orientation ratio 0.25). No production behavior, math,
routing, or contract changes. Machine artifacts (gitignored):
`artifacts/evidence/phase10g/phase10g-evidence.{json,md}`.

## Decision

**Keep the dense TypeScript all-entry Qxx as the final-covariance
architecture. No production change.** The native sparse selected-covariance
and row-product routes remain test-only experimental. Revisit only when
(a) a tolerance-based parity bar replaces bit-identity, (b) per-phase
native timings are exposable through the solver ABI, (c) an explicit
contract decision is taken on the legacy all-pairs omission, and (d) a
controlled reuse seam for native-derived Qxx is designed (currently
blocked by the fail-closed gate by design — see Route B note).

## Routes measured

- **Route A (native all-entry dense Qxx):** `sparseSelectedCovarianceSolver`
  injected without selected mode; every Qxx entry queried, dense matrix
  reconstructed, existing precision/report contract preserved.
- **Route B (selected legacy-all-pairs):** selected mode +
  `experimentalSelectedCovarianceLegacyAllPairs`; station blocks + all
  unknown pairs queried into a store. A/B/C timing legs inject only the
  selected-covariance solver; correction and statistics remain TypeScript.
  The statistics reuse gate therefore fails closed on
  `sparse-selected-solver-active`, and the statistics stage rebuilds the
  legacy path. Route B is native Qxx for final covariance + TS legacy
  statistics, NOT native Qxx feeding stats reuse. A reuse-feeding-native
  combination needs a new evidence-only seam (production gate change — out
  of scope).
- **Route C (selected network):** selected mode without legacy compat;
  station blocks + connected/requested pairs only (upper-bound demand).
- **Row-products leg:** `sparseRowProductsSolver` injected alone;
  standardized-residual quadratics/cross products via the native factor.

## Headline measurements (real-WASM bundle present, 1 warm-up + 5 measured, median [min–max])

Dense baseline: warm-up + 3 clean production solves (wall median).
Native walls use 1 warm-up + 5 measured runs, reported as median [min–max]
boundary observations. No timing assertions or production speedup claims.

| Fixture | P/coord | rows | dense wall | A med [min–max] | B med [min–max] | C med [min–max] | RP med [min–max] |
|---|---:|---:|---:|---|---|---|---|
| gps-3d-128 | 384/384 | 1027 | 205.14 | 209.49 [202.81–218.36] | 239.80 [232.20–252.44] | 203.32 [201.99–207.01] | 200.56 [198.79–208.98] |
| gps-3d-64 | 192/192 | 515 | 39.00 | 40.87 [40.30–41.83] | 46.40 [45.99–63.89] | 40.16 [39.35–40.46] | 40.60 [40.10–41.02] |
| orientation-synth (inadmissible) | 64/48 | 179 | 12.77 | 11.00 [10.63–11.24] | 11.62 [10.64–13.69] | 10.69 [10.34–12.54] | 10.09 [9.79–10.24] |

gps-3d-128 demand (exact, from the real query plan): A raw 147456 /
unique 73920 / 384 cols; B raw 75959 / unique 73920 / 384 cols;
C raw 2807 / unique 1911 / 384 cols (127 parameter-bearing connected
pairs; fixed-control pairs excluded). Mode B raw counts plan-level
duplication (connected pairs re-listed alongside all-station pairs) that
deduplication removes before the WASM call. Orientation-synth largest
values: A raw 4096, B raw 1720, C raw 640; plan avoids 16/64 columns
(25%).

## Demand (corrected): plan covers coordinate columns only

The selected plan (`buildCovarianceQueryPlan`) is built from the station
parameter index — orientation columns are never queried. Mode A (dense)
demands all P columns; Modes B/C demand the 3·U coordinate columns:

| Fixture | P | coord cols | avoided orientation | A cols | B cols | C cols |
|---|---:|---:|---:|---:|---:|---:|
| gps-3d-128 | 384 | 384 | 0% | 384 | 384 | 384 |
| orientation-synth | 64 | 48 | 25% | 64 | 48 | 48 |

For the pure-GPS ladder (no orientation parameters) all 384 columns are
demanded in every mode — the selected plan saves queries, never columns,
there. Symmetric-unique entries at 128: A 73920 / B 73920 / C 1911.

## Parity, reuse boundary, factor metadata

- Admissible cohort, Routes A/B/row-products: converge, 0 fallbacks,
  positive solver-call diagnostics (5 calls per leg), station +
  all-pairs row counts match, numeric results equivalent to 1e-6
  (asserted). Bit-identity does NOT hold (FP-order diffs to ~4e-10) —
  a native drop-in needs the tolerance bar used here.
- Route C omits legacy all-pairs rows by design (all-pairs rows do not
  resolve on any fixture) — breaks the public contract as-is. The
  common output subset (everything except `relativePrecision`, top-level
  and nested in precision models) is compared at the same 1e-6 bar and
  holds on the admissible cohort, so corrupted station or
  connected-pair output would still fail the campaign.
- Reuse boundary (measured): Route A reports
  `sparse-selected-solver-active`; selected-store Routes B/C report
  `missing-final-qxx`; production statistics reuse refuses sparse covariance
  or selected-store output, so native Qxx never feeds reuse. Separate
  row-products leg reports `sparse-row-products-active`.
- Factor metadata limitation (stated): normalNnz / factorNnz / damping /
  attempts are returned by the WASM ABI only to the internal caller and
  are not exposed via route diagnostics or the probe. Dense-path damping=0
  on the admissible cohort is proven by reuse eligibility
  (`reused-final-dense-qxx` requires finalCovarianceDamping == 0); the
  damped synth records `damped-final-recovery`. Native per-solve damping
  metadata is returned by the WASM bridge but not routed through route
  diagnostics and is not captured by this campaign. Each
  selected/row-product call performs one factorization (5 calls per leg =
  5 measured solves; warm-up uses a separate diagnostics instance).
  Fallback reasons are recorded before damping inference, so a
  damping-driven fallback is never misreported as undamped. No
  sparse-correction solver is injected on any leg, so no
  correction-condition estimate is recorded (stated gap, not a
  measurement). Orientation-synth dense path routes
  `damped-final-recovery` (inadmissible by policy, same bar as 10F).

## Applicability matrix (C1 admissible GPS / C2 orientation-heavy / C3 weak-case)

| Route | C1 (admissible 08–128) | C2 (orientation synth) | C3 (industry_demo) |
|---|---|---|---|
| A all-entry | applicable, 1e-6 equiv | runs, not asserted (damped inadmissible) | runs, not asserted (non-converged) |
| B legacy-all-pairs | applicable, 1e-6 equiv | runs, not asserted | runs, not asserted |
| C selected-network | BLOCKED: omits all-pairs contract | BLOCKED: same + 25% cols uncovered | BLOCKED: same |
| Row products | applicable, 1e-6 equiv | runs, not asserted | runs, not asserted |

## Fallback / blocker matrix

| Blocker | Observed | Evidence |
|---|---|---|
| Sparse fallback (selected/row-products) | none (0 on all legs) | diagnostics |
| Damping in native factor | not captured (not routed via diagnostics) | WASM bridge returns damping per solve; dense-path 0 proven by `reused-final-dense-qxx`, synth `damped-final-recovery` |
| Bit-identity parity | BLOCKED (~4e-10 FP-order) | tolerance 1e-6 asserted instead |
| Stats reuse over native Qxx | BLOCKED by gate design | A=`sparse-selected-solver-active`; B/C=`missing-final-qxx`; row-products=`sparse-row-products-active` |
| All-pairs from selected store | BLOCKED by omission design | C leg all-pairs rows mismatch |
| Native phase timings | UNAVAILABLE via ABI | boundary walls only |

## Semantic audit (measured dense + probe rows)

| Audit row | Coverage | obs mix | fixed | solves | reuse / fallback reason | REL/PTOL |
|---|---|---|---|---|---|---|
| mixed-ts-gnss-lev-control | mixed TS+GNSS+leveling, fixed control (`mixed_grid_tutorial.dat`) | angle 3, dist 3, zenith 3, gps 3, lev 5 | 3 | yes/yes | `reused-final-dense-qxx` | 0 |
| rel-ptol-requested | gps-3d-cov-08 + `.RELATIVE U1->U2` + `.PTOLERANCE U1->U3` | dist 17, bearing 17, lev 17, gps 8 | 2 | yes/yes | `reused-final-dense-qxx` | 2 |
| tscorr-admissible | gps-3d-cov-08 + `.TSCORR ON` | dist 17, bearing 17, lev 17, gps 8 | 2 | yes/yes | `reused-final-dense-qxx` | 0 |
| robust-tscorr-fail-closed | `chain-2d-robust-tscorr-16` (robust Huber + TSCORR, 2D) | dist 33, bearing 33 | 2 | yes/yes | `two-dimensional-legacy` (fail-closed) | 0 |
| industry_demo (headline) | terrestrial TS + leveling, weak-case | — | — | no/no | `not-converged` (inadmissible) | — |
| orientation-synth (headline) | 16 DB/DN direction sets | — | — | yes/yes | `damped-final-recovery` (inadmissible) | — |
| augmentation / excluded-obs | covariance-augmentation rows; excluded observations | — | — | — | unobserved on corpus; fail-closed by gate/parser construction | — |

Slope+zenith legs are covered via the zenith/dist rows above and the
synthetic direction sets; constraints via fixed control stations. No
corpus input triggers augmentation rows or excluded observations, so
those two routes are recorded as fail-closed-by-construction, not measured.

## Demand-reduction ratios (query demand only, NOT time bounds)

These are entry-count ratios from the plan-derived demand table, not
Amdahl time bounds: p is the eliminated symmetric-unique-entry fraction
vs Mode A, and no measured mapping exists from entry counts to
factorization, solve, copy, or reconstruction time, so no speedup claim
is made.

| Fixture | Mode B p | Mode B demand ratio | Mode C p | Mode C demand ratio | C raw-query fraction |
|---|---:|---:|---:|---:|---:|
| gps-3d-64 | 0.0000 | 1.00 | 0.9487 | 19.48 | 0.0379 |
| gps-3d-128 | 0.0000 | 1.00 | 0.9741 | 38.68 | 0.0190 |
| orientation-synth | 0.4346 | 1.77 | 0.7462 | 3.94 | 0.1562 |

Mode B saves no unique entries on pure-GPS shapes (ratio 1.00) — only
raw-query reduction. Mode C ratios assume the factor cost scales with
queries; it does not (factor spans all demanded columns: 384/384 at
128), so these ceilings do not transfer to time-based speedups.

## Memory estimates (derived; factor/packed sides estimated)

| Fixture | dense normal+Qxx (exact) | C store values (exact) | C query indices (exact) |
|---|---:|---:|---:|
| gps-3d-64 | 589824 B | 7608 B | 7608 B |
| gps-3d-128 | 2359296 B (~2.25 MiB) | 15288 B (~14.9 KiB) | 15288 B (~14.9 KiB) |
| orientation-synth | 65536 B | 4224 B | 4224 B |

Exact = P\u00b2\u00b78 B per dense matrix; store values = unique\u00b78 B; query
indices = unique\u00d72\u00d74 B (deduplicated typed buffers actually sent to
WASM, not pre-dedupe plan length). Packed design arrays and the native factor
fill are unmeasured (design nnz not recorded; dense P\u00b2\u00b712 B upper bound)
— a future campaign should record design/weight nnz to close this.

## Final comparison and decision

Fastest contract-preserving route:

- **gps-3d-128:** production dense 205.14 ms; Route B native legacy-all-pairs 239.80 [232.20–252.44] ms covariance-stage boundary; Route C 203.32 [201.99–207.01] ms covariance-stage boundary but contract-different. Route B does not feed native Qxx into statistics reuse, so no fair whole-session gain is established.
- **Statistics-stage asymmetry (disclosure):** the dense baseline enjoys production automatic Qxx reuse (skips statistics accumulation+inversion) while every native leg is fail-closed out of reuse by the active sparse solvers and runs legacy statistics, so boundary-wall comparisons are conservative against the native legs and are not apples-to-apples on the statistics stage.
- **orientation-heavy largest:** production dense 12.77 ms; Route B 11.62 [10.64–13.69] ms boundary; Route C 10.69 [10.34–12.54] ms boundary, both inadmissible because dense reference covariance is damped and Route C omits all-pairs output.
- **Whole-session improvement:** not established. Native Route B retains legacy statistics rebuild; row-products whole-session boundary is 200.56 [198.79–208.98] ms versus 205.14 ms at gps-3d-128, below the required 15% threshold.

Decision: **NO-GO for transparent production covariance optimization.**
Recommended Phase 10H: **none**. If work resumes, first run shared-factor/per-phase-timing and controlled native-Qxx statistics-reuse evidence; do not widen production routing.

Production final covariance stays dense TypeScript all-entry with automatic Qxx
reuse (10E/10F unchanged); experimental seams stay test-only. Semantic audit
covers mixed TS+GNSS+leveling, slope/zenith, leveling, fixed controls,
REL/PTOL, TSCORR, robust fail-closed, damping, and non-convergence. Covariance
augmentation and excluded-observation cases were absent from admissible corpus
and remain explicitly fail-closed-by-construction. Demand-reduction ratios and
exact dense/selected-store memory estimates are recorded above; native packed
and factor memory remain unmeasured.
