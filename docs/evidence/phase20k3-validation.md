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
| `tests/cad_grading_worker_agreement_20k3.test.ts` | 16 | shared anchored agreement, source-boundary, mismatch ladder |
| `tests/cad_grading_surface_products_20k3.test.ts` | 16 | Surface canonicalization, Design Patch, Extract/Bake capabilities, fan |
| **total** | **55** | |

`npx vitest run <the four suites>` → **4 files, 55 passed** (this batch).

## 2. Regression runs (this batch, current worktree)

| command | result |
|---|---|
| `npx vitest run tests/cad_grading` | **71 files, 1039 passed** |
| `npm run lint` | **0 errors, 2 pre-existing warnings** |
| `npm run typecheck` | **clean** |
| `npm run check:portable-paths` | **5494 tracked paths, 0 violations** |
| `npx tsx scripts/phase20k3SurfaceAuthorityPerf.ts` | complete run (measurement only) |

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

`tests-browser/cad-grading-curved-20k2.spec.ts` is the current curved-grading
Chromium spec. No 20K.3-specific browser spec or visual-QA record is present in
this worktree; browser QA for 20K.3 is owned by a separate sibling and is not
claimed by this batch. This document therefore records engine/worker/product
gates only.

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
