# Phase 20K.3 — validation

Status: **IMPLEMENTATION COMPLETE on branch
`fix/phase20k3-surface-curve-authority-certificate`, baseline `884b36e8` =
PR #143 merge.** Docs/evidence batch; behavior and tests were produced by the
sibling waves. Counts below are from this batch's independent runs on the
current worktree (2026-10-01).

## 1. Wave A–E test inventory

| Suite | Tests | Subject |
|---|---|---|
| `tests/cad_grading_topology_expectation_20k3.test.ts` | 11 | pre-mesh expectation, extra-cycle rejection, straight-group seam gate |
| `tests/cad_grading_certificate_exact_20k3.test.ts` | 12 | `gtop1` collision RED, `gtop2` Float64/SHA-256 GREEN, fail-closed |
| `tests/cad_grading_worker_agreement_20k3.test.ts` | 18 | shared anchored agreement, source-boundary, mismatch ladder, sliver plane |
| `tests/cad_grading_surface_products_20k3.test.ts` | 18 | Surface canonicalization, Design Patch, Extract/Bake capabilities, translated fan |
| **total** | **59** | |

`npx vitest run <the four suites>` → **4 files, 59 passed** (review rerun). Additional gtop2 product and Design Patch preflight regressions are in `tests/cad_grading_topology_gtop2_gate_20k3.test.ts` and `tests/cad_design_patch_preflight.test.ts`.

## 2. Regression runs (this batch, current worktree)

| command | result |
|---|---|
| `npx vitest run tests/cad_grading` | **71 files, 1039 passed** |
| `npm run lint` | **0 errors, 2 pre-existing warnings** |
| `npm run typecheck` | **clean** |
| `npm run check:portable-paths` | **0 violations** |
| `npx tsx scripts/phase20k3SurfaceAuthorityPerf.ts` | complete run (measurement only) |

On this review worktree `npm run test:agent` passed all grading tests (7399 passing overall) but has 3 unrelated local `study-desktop` calibration/preflight failures: the local cal80-v4 source-package ID is `nb-sit-statute-corpus-2026-08-29` while the frozen test expects `…2026-09-11`. No `study-desktop` files are changed by this review; final-head CI must be checked after push.

The two lint warnings are the pre-existing unused-eslint-disable directives in
`tests/gnssBaseline/gnssBaselinePerformance.test.ts` and the matching study
file; both are present on the clean tree and are not introduced by 20K.3.

## 3. Performance evidence

`docs/evidence/phase20k3-surface-authority-performance.md` (produced by the
perf wave) is present and records the `gtop2` cost surface: expected-topology
derivation sub-microsecond, `gtop2` digest + certificate sub-millisecond on
the 128-face square, `gtop2` product revalidation ~1 ms, boundary-cycle
validation super-linear only in boundary size (128.7 ms at 4096 boundary
edges). Measurement only; nothing there gates CI, and exactness is never
relaxed for speed.

## 4. Browser QA

The 20K.3 Chromium spec is
`tests-browser/cad-grading-curved-20k3.spec.ts` (6 flows × 3 viewports =
18 tests, production build + real worker). Results, zero-error ledgers, and
the PNG inventory are recorded in
`docs/evidence/phase20k3-browser-qa.md` and
`docs/evidence/phase20k3-visual-qa.md`. This document records the
engine/worker/product gates; browser QA is claimed by those sibling records,
not duplicated here.

## 5. Honest bounds carried (unchanged)

- arc×arc hybrid joints remain blocked
  (`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`).
- transition-less surface+analytic mixing remains blocked
  (`GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED`).
- offset-radius behavior is unchanged (no new radius/offset sweep support).
- root-UX is unchanged; the nearest-outward root policy is untouched.
- No curved-surface, refinement, welding, persistence, or auto-calculation
  behavior is added. The `gtop2` certificate is session-only, never persisted.
- The 1 nm `AGREEMENT_FLOOR` is an explicit agreement bound, not a geometry
  tolerance; the global `zeroDelta` is unchanged.
- Read-only-zone note: `src/` was frozen for this evidence batch and was not
  modified.

## 6. Provenance

- Wave B: `gradingTopologyExpectation.ts`, `gradingTopologyCertificate.ts`.
- Wave C: `gradingChordSeam.ts`.
- Wave D: `gradingGroupSectors.ts`, `src/workers/surfaceGradingCompute.ts`.
- Wave E1: `gradingProductCapabilities.ts`, `gradingTargetFanCoverage.ts`.
- Perf: `scripts/phase20k3SurfaceAuthorityPerf.ts`.
