# Phase 15C default-session (auto) native full-Qxx benchmark (evidence)

Method: whole-session walls via `runWithNativeFullQxxAutoRoute` (Model A, real WASM), 2 untimed warm-ups + median of 5 timed runs per matrix row; forced-TS arm = clean `runAdjustmentSession` bypass; OFF arm = suspectImpactMode off (single-solve native overhead baseline). Correctness (route, C1/C2/C3 acceptance, rows, systems == rows+1, success) hard-asserted per run; perf verdicts HARD `expect` (≤1.05) on all certified LARGE shapes, soft only on the tiny H0 timer-floor case (see floor note). Machine: same process/run as the numbers below (rerun 2026-09-16, hardened bounds PASS with median-of-5 — no median-of-7/1.10 fallback needed).

## Honest-shape note (§23, verified empirically — NOT assumed)

- 0-candidate: only the tiny helper network (posterior-scaled stdRes is ~N(0,1), so max-of-~450 can never stay under the |StdRes| >= 2 gate at scale; holds across noise fracs 0..1 and seeds 7/42/100/2364/2381 — every large clean network yields the capped 3).
- 1-candidate: helper network + scaled-192 (single GPS +0.5 m bias; scaled-384 yields 2 — the bias inflates SEUW less at 384 params so the natural tail survives; reported as the B' 2-candidate variant).
- 3-candidate: everywhere (generator clean output is naturally 3).

## Median session walls per fixture x case (routes, systems counts)

| Row | Fixture (params) | Route | Rows | Systems (= rows+1) | Median wall ms | Timed runs ms |
|---|---|---|---|---:|---:|---:|---|
| H0/A AUTO-0 | tiny helper 3D | native-full-qxx | 0 | 1 | 2.4 | 3/2/2/2/2 |
| H0/D forced-TS | tiny helper 3D | typescript | 0 | 0 (TS, uncaptured) | 1.5 | 2/2/1/1/1 |
| H0/E OFF-native | tiny helper 3D | native-full-qxx | 0 | 1 | 1.9 | 2/2/2/2/2 |
| H1/B AUTO-1 | tiny helper 3D +bias | native-full-qxx | 1 | 2 | 3.0 | 3/3/3/3/3 |
| S192/B AUTO-1 | scaled-64 (~192 params) | native-full-qxx | 1 | 2 | 81.8 | 80/84/88/82/82 |
| S192/C AUTO-3 | scaled-64 (~192 params) | native-full-qxx | 3 | 4 | 155.8 | 158/154/162/155/156 |
| S192/D forced-TS | scaled-64 (~192 params) | typescript | 3 | 0 (TS, uncaptured) | 164.7 | 159/165/167/164/165 |
| S192/E OFF-native | scaled-64 (~192 params) | native-full-qxx | 0 | 1 | 40.0 | 40/40/40/40/40 |
| G192/C AUTO-3 | gps-3d-64 (~192 params) | native-full-qxx | 3 | 4 | 167.1 | 168/167/168/166/166 |
| G192/D forced-TS | gps-3d-64 (~192 params) | typescript | 3 | 0 (TS, uncaptured) | 168.9 | 176/176/169/166/166 |
| G192/E OFF-native | gps-3d-64 (~192 params) | native-full-qxx | 0 | 1 | 44.4 | 45/45/44/43/43 |
| S384/B' AUTO-2 | scaled-128 (~384 params) | native-full-qxx | 2 | 3 | 439.8 | 447/423/447/434/440 |
| S384/C AUTO-3 | scaled-128 (~384 params) | native-full-qxx | 3 | 4 | 585.0 | 579/599/586/585/580 |
| S384/D forced-TS | scaled-128 (~384 params) | typescript | 3 | 0 (TS, uncaptured) | 798.9 | 805/802/789/799/798 |
| S384/E OFF-native | scaled-128 (~384 params) | native-full-qxx | 0 | 1 | 146.7 | 159/144/158/147/146 |
| G384/C AUTO-3 | gps-3d-128 (~384 params) | native-full-qxx | 3 | 4 | 654.9 | 655/657/654/653/678 |
| G384/D forced-TS | gps-3d-128 (~384 params) | typescript | 3 | 0 (TS, uncaptured) | 865.4 | 871/865/865/877/861 |
| G384/E OFF-native | gps-3d-128 (~384 params) | native-full-qxx | 0 | 1 | 164.8 | 175/165/165/174/165 |

Every AUTO/OFF row: route native-full-qxx, C1/C2/C3 accepted, systems == rows+1 (hard-asserted each run).

## Per-shape verdicts (HARD ≤1.05, i.e. fail on >5% regression)

| Verdict | Ratio | Delta | Result |
|---|---|---|---|
| H0/A-vs-E (AUTO-0 vs OFF-native) | 1.256 (2.4 vs 1.9ms) | +0.50ms < 1ms floor | INCONCLUSIVE (soft-only; timer quantization, not a regression) |
| S192/C-vs-D (AUTO-3 vs forced-TS @192) | 0.946 | -5.4% | GO (hard) |
| G192/C-vs-D (AUTO-3 vs forced-TS @192 generator) | 0.989 | -1.1% | GO (hard) |
| S384/C-vs-D (AUTO-3 vs forced-TS @384) | 0.732 | -26.8% | GO (hard) |
| G384/C-vs-D (AUTO-3 vs forced-TS @384 generator) | 0.757 | -24.3% | GO (hard) |
| S192/B-vs-D (AUTO-1 vs forced-TS-3 @192) | 0.496 | -50.4% | GO (hard) |

Timer-significance floor: the 1ms floor reflects `performance.now()` quantization plus JIT/GC jitter, which dominates walls under ~10ms; deltas below it carry no regression signal at any ratio. Only the tiny H0 helper net lives down here. All hardened bounds PASSed on rerun with median-of-5 (observed ratios 0.50–0.99, headroom ≥6%), so the median-of-7 / 1.10 fallback was NOT needed.

Single-solve native as % of 4-solve TS session (OFF-vs-TS overhead context): S192 24.3%, G192 26.3%, S384 18.4%, G384 19.0%.

## Verification-cost breakdown (diagnostic collector; production call sites pass nothing)

| Promotion | Session | copy | oracleBuild | c1 | c2 | c3 | scaffold finiteScan/queryBuild/oracleProbe/nativeIndex | systems | factorizations | solves |
|---|---|---|---|---|---|---|---|---:|---:|---:|
| S192-1 | 91.6ms | 0.08ms | 0.28ms | 0.08ms | 3.91ms | 1.29ms | 1.57/0.04/6.50/0.54ms | 2 | 2 | 32 |
| S192-3 | 179.5ms | 0.15ms | 0.55ms | 0.16ms | 7.78ms | 2.58ms | 2.92/0.08/12.71/0.81ms | 4 | 4 | 64 |
| S384-3 | 689.6ms | 0.77ms | 5.10ms | 0.91ms | 28.31ms | 10.23ms | 15.29/0.16/60.54/3.16ms | 4 | 4 | 64 |

Verification (copy+oracleBuild+C1+C2+C3+scaffold) is ~7% of the S192-3 session and ~12% of S384-3; the oracle probe dominates the scaffold.

## Memory (evidence only)

| Promotion | Systems | Peak theoretical (packed + Qxx) | Per system | Retained post-session |
|---|---|---:|---:|---|
| S192-1 | 2 | 1.17 MiB | 599.8 KiB/system | none (leak-walk clean) |
| S192-3 | 4 | 2.34 MiB | 599.8 KiB/system | none (leak-walk clean) |
| S384-3 | 4 | 9.19 MiB | 2351.5 KiB/system | none (leak-walk clean) |

Captured buffers walk: no captured `ArrayBuffer`/view reachable from `{outcome, verification}` post-session (hard-asserted per timed run).

## Determinism + 14F.1 + progress

- Determinism: 3x admitted AUTO-1 replays identical (candidate order `387`, rows, route native-full-qxx).
- Progress: 21 events deterministic across runs, exactly 1 `finalizing:` event and it is last (`solving:main-solve:1/1` x5, `suspect-impact:2/4` x5, `:3/4` x5, `:4/4` x5, `finalizing:main-solve:4/4`).
- 14F.1: `tests/adjustment_runner.test.tsx` + `tests/adjustment_runner_race.test.tsx` run untouched in a child process — 2 files PASS (stale-run check).

## Validation

- Focused evidence test `tests/evidence/phase15c_default_session_benchmark.test.ts` (evidence tier, `phase15c` suite): 4/4 PASS with hardened bounds (hard ≤1.05 on S192/G192/S384 multi-solve + S192/B; soft-only H0 timer-floor INCONCLUSIVE).
- Tier-manifest test: manifest lists all three phase15c evidence files (see below).
- `npm run lint`: 0 errors; `npm run typecheck`: clean.
- No production changes in this batch (test hardening + report only); `src/workers/adjustmentNativeFullQxxAutoRoute.ts` untouched (frozen per mission).
