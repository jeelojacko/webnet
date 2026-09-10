# Phase 10F — Post-Reuse 3D Performance Reprofile

## Scope and identity

- Branch: `feat/3d-post-reuse-performance-reprofile`
- Baseline: `39407fa65a400b48fa0eb32149c1a0dd9c30acf2`
- HEAD: final branch tip (see PR; hash reported with completion)
- PR: https://github.com/jeelojacko/webnet/pull/20
- Phase 10E merge present: yes
- Working tree: clean except preserved untracked `graft/` (ignored)
- Production behavior changed: **NO**
- Mathematical contract changed: **NO**
- Public contract changed: **NO**
- Routing changed: **NO**

Phase 10F is evidence only. No selected covariance, sparse row products, native correction, equation-assembly reuse, 2D reuse, or output reduction was enabled.

## Method

Node controlled campaign. Each fixture used one clean warm-up and five clean uninstrumented production solves. Clean medians are headline values. Production solves used no evidence-only override, no native correction, no selected covariance, and no sparse row products. Eligible 3D solves automatically selected `reused-final-dense-qxx`.

Each fixture also used one profiler warm-up and three profiled production runs. Profiler medians are attribution values, not headline wall values. The profiler is opt-in and adds measurable overhead.

Legacy comparison used `forceLegacyStatisticsQxx` only for `gps-3d-32`, `gps-3d-64`, and `gps-3d-128`: one warm-up plus five clean runs, with one uninstrumented parity solve. `industry_demo` is a weak/non-convergent observation, not a scaling anchor.

The primary ladder is the genuine generated 3D corpus. No larger than 128-unknown case was added: current dense TypeScript 384-parameter evidence already takes about 0.2 s uninstrumented and the requested evidence did not justify turning this campaign into a stress test.

### Timing semantics

- `wallMedianMs`: clean uninstrumented `performance.now()` median.
- `profiledWallMedianMs`: profiled production wall median; not compared as an equal-cost replacement for clean wall.
- `solveTimingProfile` buckets are top-level exclusive buckets. `precisionPropagationMs` and `reportDiagnosticsMs` are nested in `precisionAndDiagnosticsMs`; they are not added again.
- Detailed profiler fields are nested attribution. They are not added to top-level buckets.
- `unclassified` is `solveTimingProfile.totalMs - classifiedBucketSum`; it is not derived from profiled wall.

## Post-10E scaling table

| Fixture | Unknown stations | Fixed stations | Coord params | Orientation params | Total params | Scalar rows | DOF | Iterations | Clean wall ms | Profiled wall ms | Final Qxx inversion ms | All-pairs rows |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gps-3d-cov-08 | 8 | 2 | 24 | 0 | 24 | 75 | 43 | 4 | 3.62 | 3.49 | 0.08 | 28 |
| gps-3d-16 | 16 | 2 | 48 | 0 | 48 | 147 | 83 | 4 | 5.41 | 9.08 | 0.46 | 120 |
| gps-3d-32 | 32 | 2 | 96 | 0 | 96 | 291 | 163 | 4 | 12.31 | 14.96 | 1.40 | 496 |
| gps-3d-64 | 64 | 2 | 192 | 0 | 192 | 579 | 323 | 4 | 39.46 | 52.02 | 11.33 | 2,016 |
| gps-3d-128 | 128 | 2 | 384 | 0 | 384 | 1,155 | 643 | 4 | **212.28** | 262.63 | **93.33** | 8,128 |

All five ladder cases succeeded and converged. Design NNZ totals were 544, 1,088, 2,176, 4,352, and 8,704 respectively; final normal/Qxx dimensions were 24, 48, 96, 192, and 384. Final covariance recovery calls were exactly one per case.

Precision row counts: station covariance rows were 8, 16, 32, 64, and 128; connected relative-covariance rows were 28, 56, 120, 248, and 504; explicit REL/PTOL requested pairs were zero for every generated case because fixtures contain no `.RELATIVE` or `.PTOLERANCE` directives. Relative-covariance rows therefore report connected-pair topology only.

## Phase 10E reuse sanity check

| Fixture | Final accumulations | Final inversions | Statistics reused | Statistics accumulations | Statistics inversions | Reason |
|---|---:|---:|---|---:|---:|---|
| gps-3d-cov-08 | 1 | 1 | yes | 0 | 0 | reused-final-dense-qxx |
| gps-3d-16 | 1 | 1 | yes | 0 | 0 | reused-final-dense-qxx |
| gps-3d-32 | 1 | 1 | yes | 0 | 0 | reused-final-dense-qxx |
| gps-3d-64 | 1 | 1 | yes | 0 | 0 | reused-final-dense-qxx |
| gps-3d-128 | 1 | 1 | yes | 0 | 0 | reused-final-dense-qxx |

Statistics normal accumulation and statistics dense inversion are absent on every eligible production ladder solve. No eligible case fell back.

## Wall reconciliation

Top-level bucket reconciliation is shown below. `total` is the coarse `solveTimingProfile.totalMs`; `profiledWallMedianMs` includes profiler overhead and is intentionally separate.

| Fixture | Clean wall ms | Profiled wall ms | Classified bucket sum ms | Unclassified ms | Unclassified % of coarse total |
|---|---:|---:|---:|---:|---:|
| gps-3d-cov-08 | 3.62 | 3.49 | 3 | 1 | 25.0% |
| gps-3d-16 | 5.41 | 9.08 | 5 | 0 | 0.0% |
| gps-3d-32 | 12.31 | 14.96 | 12 | 0 | 0.0% |
| gps-3d-64 | 39.46 | 52.02 | 39 | 1 | 2.5% |
| gps-3d-128 | 212.28 | 262.63 | 209 | 3 | 1.4% |

The meaningful largest case explains 98.6% of coarse clean-run solve timing through named top-level buckets. Small-case integer millisecond rounding makes the 8-unknown percentage noisy. Engine `otherMs` medians were ≈0 on all fixtures, and the shown `unclassified` is the cross-median residual (median of totals minus sum of per-field medians), so small-case values are rounding noise. The remaining blind spot at 128 is about 3 ms coarse time, not a hidden dominant stage.

## gps-3d-128 detailed stage attribution

Percentages below use clean wall median, 212.28 ms. These are exclusive or clearly scoped stage measurements; nested detail is not summed with its parent.

| Rank | Stage | ms | % wall | Growth trend |
|---:|---|---:|---:|---|
| 1 | Final covariance dense inversion | 93.33 | 44.0% | Near-cubic at large dimensions |
| 2 | Correction factor/solve | 34.52 | 16.3% | Grows with correction normal dimension; below final inversion |
| 3 | Precision propagation, all-pairs included | 10.53 | 5.0% | Quadratic output component; 8,128 rows |
| 4 | Statistics equation assembly | 4.33 | 2.0% | Roughly linear in rows/design size |
| 5 | Statistics row products | 3.62 | 1.7% | Grows with rows and Qxx row work |
| 6 | Correction normal accumulation | 8.15 | 3.8% | Included in correction-loop total; sparse row accumulation |
| 7 | Correction equation assembly | 18.39 | 8.7% | Included in correction-loop total |
| 8 | Final covariance assembly + accumulation | 5.86 | 2.8% | Below inversion |
| 9 | Residual/statistics non-standardized work | 2.90 | 1.4% | Residuals plus diagnostics |
| 10 | Per-equation statistics + GPS transforms + summary | 0.81 | 0.4% | Small |

Coarse top-level attribution gives parse/setup 9 ms, equation assembly 18 ms, matrix factorization 158 ms, precision/diagnostics 20 ms, packaging 3 ms, and 3 ms unclassified. The detailed profiler identifies the dominant part of the coarse factorization bucket: final covariance inversion at 93.33 ms, followed by correction factor/solve at 34.52 ms.

Statistics after reuse is not dominant. At 128, standardized-residual detail was: equation assembly 4.33 ms, row products 3.62 ms, per-equation statistics 0.26 ms, GPS cross-product transforms 0.32 ms, summary 0.23 ms, and zero statistics accumulation/inversion. Precision propagation was 10.53 ms, of which all-pairs materialization remains part of the public result cost.

## Production versus forced legacy

| Fixture | Legacy median ms | Production median ms | Saved ms | Improvement | Full-result parity |
|---|---:|---:|---:|---:|---|
| gps-3d-32 | 13.18 | 12.31 | 0.87 | 6.6% | BIT-IDENTICAL |
| gps-3d-64 | 53.57 | 39.46 | 14.11 | 26.3% | BIT-IDENTICAL |
| gps-3d-128 | 292.71 | 212.28 | 80.43 | 27.5% | BIT-IDENTICAL |

Forced legacy is comparator only. Headline production values use automatic reuse.

## Precision and all-pairs scaling

| Unknown stations | Pair count N(N-1)/2 | All-pairs precision ms | % clean wall |
|---:|---:|---:|---:|
| 8 | 28 | 0.33 | 9.1% |
| 16 | 120 | 0.70 | 13.0% |
| 32 | 496 | 1.49 | 12.1% |
| 64 | 2,016 | 3.58 | 9.1% |
| 128 | 8,128 | 10.53 | 5.0% |

Pair count is exactly N(N-1)/2 at every ladder point. All-pairs output remains unchanged. At 128, numerical final covariance inversion is about 93.33 ms while all-pairs precision propagation is 10.53 ms; these costs are distinct. All-pairs construction is beginning to matter, but does not dominate current dense production wall.

The orientation synth produced 16 station covariance rows, 72 connected relative-covariance rows, and zero explicit REL/PTOL requests. Its additional connected rows come from direction-set station connections, not from a changed public output policy.

## Final covariance inversion scaling

Observed final inversion medians were 0.08, 0.46, 1.40, 11.33, and 93.33 ms for dimensions 24, 48, 96, 192, and 384. Successive observed exponents, using `t2/t1 = (n2/n1)^p`, were approximately:

- 24→48: 2.55
- 48→96: 1.60
- 96→192: 3.02
- 192→384: 3.04
- 24→384 overall: 2.55

Small cases are clock/noise sensitive. The large-ladder behavior is empirically near cubic, not merely theoretically asserted.

Approximate raw dense Qxx payload (`n² * 8`, Float64-equivalent):

| Parameters | Entries | Raw payload |
|---:|---:|---:|
| 24 | 576 | 4.5 KiB |
| 48 | 2,304 | 18 KiB |
| 96 | 9,216 | 72 KiB |
| 192 | 36,864 | 288 KiB |
| 384 | 147,456 | 1.125 MiB |

Actual JavaScript nested-array representation has additional array/number/object overhead and is not equal to the raw payload estimate.

## Correction-loop Amdahl check

At 128, all correction-loop stages totaled 61.29 ms: assembly 18.39, normal accumulation 8.15, factor/solve 34.52, and state update 0.24 ms. Correction loop was 28.9% of clean wall. If correction factor/solve became infinitely fast, the whole-session ceiling would be `1/(1 - 34.52/212.28) = 1.19x`. This remains too small for complicated native correction routing by itself. Phase 10B's NO-GO remains valid after reuse.

## Orientation-heavy 3D observation

`gps-3d-16-orientation-synth` is a deterministic evidence-only genuine 3D derivative with 16 direction setups and 16 orientation parameters: 48 coordinate parameters, 64 total parameters, orientation ratio 25%, 195 scalar rows, 115 DOF, and 3 iterations. It converged, but final covariance recovery required damping; production reuse correctly failed closed with `damped-final-recovery`, so this case is not a scaling anchor and statistics recomputed (one statistics accumulation and inversion). Its clean wall was 13.47 ms, final covariance inversion 1.44 ms, station/all-pairs precision 1.39 ms, and all-pairs rows 120. This confirms future covariance architecture must account for orientation augmentation and fail-closed eligibility; this phase does not alter that routing.

## Candidate opportunity matrix

| Candidate | Measured fraction at 128 | Scaling trend | Plausible speedup | Complexity | Numerical risk | Contract risk | Existing experimental infrastructure |
|---|---:|---|---:|---|---|---|---|
| A. Final dense covariance inversion | 44.0% | Near O(n³) at large n | High; ~28% whole-session for 2x inversion improvement | High | High | High | Selected covariance store/native covariance seams exist, but not validated for this production demand |
| B. Statistics assembly / row products | 3.7% combined | Rows/Qxx work, lower than inversion | Low; <2% whole-session for 2x | Medium | Medium | Medium | Test-only row-product backend exists; not enabled or measured here |
| C. All-pairs relativePrecision | 5.0% | O(N²) output growth | Low now; grows with output size | Medium | Medium | High, because public all-pairs output must remain | Selected-query infrastructure exists, but changing output contract is out of scope |
| D. Correction factor/solve | 16.3% | Normal-system solve growth | ~9% whole-session for 2x | High | High | High | Native correction seam exists; Phase 10B parity evidence says routing is not worthwhile |
| E. Repeated final equation assembly | 2.8% assembly+accumulation | Linear-ish in rows | Low | Medium | Medium | Medium | No approved reuse of equation assemblies |
| F. Parse/setup/orchestration | 4.2% | Small relative to dense solve | Low | Low/medium | Low | Medium | Existing coarse timing only |
| G. Result packaging/diagnostics | 6.6% report/diagnostic/package coarse bucket | Mostly output/result size | Low | Medium | Medium | High | Existing result contract requires these outputs |

Fractions are approximate because detailed stages and coarse buckets have different nesting boundaries; no rows are double-counted in wall reconciliation.

## Amdahl table for top candidates

| Case | Candidate | f | Infinite-speed ceiling | Plausible improvement | Expected whole-session speedup |
|---|---|---:|---:|---|---:|
| gps-3d-64 | Final covariance inversion | 11.33/39.46 = 28.7% | 1.40x | 2x inversion | 1.17x |
| gps-3d-64 | Correction factor/solve | 4.66/39.46 = 11.8% | 1.13x | 2x factor/solve | 1.06x |
| gps-3d-64 | All-pairs precision | 3.58/39.46 = 9.1% | 1.10x | 2x all-pairs loop | 1.05x |
| gps-3d-128 | Final covariance inversion | 93.33/212.28 = 44.0% | 1.79x | 2x inversion | 1.28x |
| gps-3d-128 | Correction factor/solve | 34.52/212.28 = 16.3% | 1.19x | 2x factor/solve | 1.09x |
| gps-3d-128 | All-pairs precision | 10.53/212.28 = 5.0% | 1.05x | 2x all-pairs loop | 1.03x |

Statistics assembly plus row products is below the top-three candidates at 128: `(4.33 + 3.62)/212.28 = 3.7%`, with an infinite ceiling of only 1.04x.

## Browser perspective

Existing browser/app smoke validation remains the supplementary browser check. No browser number is mixed into this Node scaling curve. The production application uses the same TypeScript adjustment path for this 3D cohort, so the Node ranking is expected to transfer qualitatively; browser scheduling/rendering overhead is not measured here.

## Decision

New dominant stage: **final dense covariance inversion**.

Second-largest stage: **correction factor/solve**.

Third-largest stage: **all-pairs precision propagation** (with statistics equation assembly/row products below it).

gps-3d-128 production median: **212.28 ms** on this run.

Largest-case measured: **gps-3d-128, 128 unknown stations, 384 parameters**.
Largest-case median: **212.28 ms clean uninstrumented production wall**.

Decision: **Proceed with one evidence-only follow-up.** Final dense covariance inversion is the only remaining stage with a plausible >=15% whole-adjustment improvement on the meaningful 384-parameter workload. Current evidence does not select an implementation.

Recommended Phase 10G: **Phase 10G — Final Covariance Architecture Evidence**. Measure demand characteristics and parity/safety of final-covariance alternatives (selected covariance, native selected queries, or factorization reuse) without changing production routing. Include orientation-augmented and fail-closed cases before any implementation choice.

No production optimization was implemented in Phase 10F.
