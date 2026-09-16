# Phase 15B §1 BASELINE (measurement only, no production changes)

- Branch: `perf/2d-final-qxx-statistics-reuse`
- Baseline HEAD SHA: `7a73da0f995aa6ff1989678cfbd02d0a7a052b83`
  (Merge PR #78, post-QC covariance performance audit)
- Date (UTC): 2026-09-16; machine: linux x64, AMD Ryzen 7 5800X3D, node v26.8.1

## WASM build identity

- Built via `npm run wasm:build` → `node scripts/cppBuild.mjs wasm`
  (Emscripten toolchain `cpp/cmake/emscripten_toolchain.cmake`).
- `cpp/build-wasm/webnet_core.wasm` md5 `df94d377b3a569448c779e9a7e26fe22`,
  identical to `dist/webnet_core.wasm`; built 2026-09-13.
- Toolchain present: emcc 6.0.9-git. WASM **not rebuilt** in this baseline run.

## Relevant Phase 15A evidence files (at HEAD)

- `reports/performance/phase15a-covariance-operations.json` (+ `.md`)
- `reports/performance/phase15a-memory-boundary.md`
- `tests/evidence/phase15a_covariance_operation_benchmark.test.ts`
- `tests/evidence/phase15a_memory_boundary.test.ts`

## Working-tree state note (pre-existing, not mine)

At session start the tree already contained uncommitted changes beyond HEAD:
`src/engine/statisticsQxxReuse.ts` (drops the `is2D` gate → 2D dense eligible
for final-Qxx reuse), `src/engine/adjustStatisticsStandardizedResiduals.ts`,
`tests/phase10e_production_qxx_reuse.test.ts`. This baseline run changed
nothing in `src/`; it only regenerated the two phase15a covariance report
files as a side effect of the benchmark rerun (§7). Only the new file
`reports/performance/phase15b-baseline.md` is committed here; all other
dirty files are left untouched.

## Command results

| Command | Result | Detail |
|---|---|---|
| `npm run lint` | PASS | 0 errors, 2 warnings (pre-existing unused eslint-disable) |
| `npm run typecheck` | PASS | `tsc --noEmit` clean |
| `npm run test:agent` | 600/603 files PASS, **3 pre-existing failures** | `study-desktop/tests/study_ai_unit_{calibration,calibration_v5,preflight}` — frozen-corpus `ok === false` assertions, no diff on this branch in `study-desktop/`, unrelated to statistics/Qxx |
| `npm run parity:industry-reference` | PASS | 25/25 |
| `npm run test:wasm` | PASS | 12 files, 74/74 |
| `npm run build` | PASS | 8.91 s, chunk-size warning only |

## 2D dense timing reproduction (chain-2d-128)

`tests/evidence/phase15a_covariance_operation_benchmark.test.ts` → 1/1 PASS
(1 warm-up + 5 measured runs, medians).

| Source | FINAL accum / recover | STATS accum / recover | reuse reason | wall |
|---|---|---|---|---|
| HEAD-committed Phase 15A report | 1 / 1 | 1 / 1 | `two-dimensional-legacy` | 117.77 ms |
| Reproduced in this (dirty) tree | 1 / 1 | 0 / 0 | `reused-final-dense-qxx` | 84.57 ms |

Reproduced full chain-2d-128 row (medians, ms): wall 84.57, NORMAL
assembly 6.29 / accumulate 2.14 / factor-solve 12.59 / state 0.20, FINAL
assembly 1.44 / accumulate 0.59 / recover 23.89, STATS total 15.79
(assembly 1.22, accumulate 0, recover 0, row-products 0.87,
per-equation 0.25), precision 8, report 8, packaging 3.
Fixture: 4 iters, 256 params, 514 equations, 514 Qvv rows traced, 0 WASM transfers.

Interpretation: with the working tree's 2D-reuse gate open, the 2D dense arm
skips the STATS normal accumulation + Qxx recovery entirely (STATS 0/0) and
wall time drops ~33 ms vs the committed legacy-path number. Committed HEAD
numbers remain the authoritative pre-15B reference.
