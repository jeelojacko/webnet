# Phase 20K.3 — pre-mesh grading topology expectation

Status: **IMPLEMENTATION COMPLETE on branch
`fix/phase20k3-surface-curve-authority-certificate`, baseline `884b36e8` =
PR #143 merge.** This document records the shipped Wave B declaration that
replaces observed-count self-certification.

## 1. The authority gap it closes

Before 20K.3 the validator enforced `expectedBoundaryLoops` only when a caller
supplied it, and `buildGradingTopologyCertificate` defaulted
`expectedComponents` to the **measured** count. A product revalidating against
that certificate therefore re-checked the mesh against the mesh's own
observation — a null-pass that could not reject an undeclared cycle or an
implicit multi-region shell. Wave A1 froze the exact pre-fix behavior in
`tests/cad_grading_topology_expectation_20k3.test.ts`.

## 2. The declaration (policyVersion `20k3.1`)

`deriveGradingTopologyExpectation` (`src/engine/cad/grading/gradingTopologyExpectation.ts`)
is a pure function of the definition, **never of the mesh**. Inputs are
`scope`, `closed`, `positiveWidthRegions`, `tiedSplitCoords`, `empty`.

| shape | scope | closed | components | cycles | regions |
|---|---|---|---|---|---|
| `empty-tied` | either | any | 0 | 0 | 0 |
| `open-strip` | standalone | n/a | 1 | 1 | 1 |
| `split-open-strips` | standalone | n/a | N | N | N |
| `open-strip` | group | no | 1 | 1 | 1 |
| `split-open-strips` | group | no | N | N | N |
| `closed-annulus` | group | yes | 1 | 2 | 1 |

`N = positiveWidthRegions`. A figure-eight is never declared: derivation has no
row for it, and the boundary trace rejects it as `PINCH`. `empty-tied` means a
fully-tied course (nothing to certify) and is exempt.

`countPositiveWidthStationRuns` is the pre-mesh authority for `N`. It is a
**station-run** count, not a cell-run count: a single tied station is a vertex
pinch that separates two edge-connected components (a CUT→TIED→FILL hinge), so
unlike a cell count it breaks the run exactly where the tie does. On the
6-station fixture with stations 2–3 tied this returns `regions = 2` in
0.001 ms (perf harness, §1 of the performance doc).

## 3. Every Calculate path supplies the expectation

The declared expectation is threaded into `buildGradingTopologyCertificateExact`
by:

- standalone `gradingResultAssemble` (including straight sources),
- group `gradingGroupCompute` (straight, curved, and hybrid),
- standalone `arcSolve`.

The old `if (curved)` straight-group seam-gate bypass is removed: every group
now runs the same seam gate against the same declared budget, and the
observed-count group fallback is deleted. A straight-only closed square
therefore certifies the explicit `1 component / 2 cycles` annulus (measured
`9600` plan area) instead of self-certifying.

## 4. What the validator still owns

`validateGradingMeshTopology` is unchanged as the measured probe: it reports
`components` (edge-connected faces) and `boundaryCycles` (traversed simple
cycles). The expectation is the **authority**; the probe is measurement only.
A raw probe call with no declaration (`{}`) still passes the 2-cycle ring and
the doubly-punctured shell, and is pinned that way in the suite to make the
distinction explicit: probing is never authority.

Against the declared `1/1` standalone-strip budget:

| fixture | measured | declared verdict |
|---|---|---|
| 2-cycle ring (1 face component, 2 cycles) | `1 / 2` | fail `PINCH` — `cycle count 2 != expected 1` |
| 6×6 grid with two punched holes (28 boundary edges) | `1 / 3` | fail `PINCH` |
| valid strip | `1 / 1` | pass |
| valid annulus | `1 / 2` | pass |
| tied split (tied coords supplied) | `2 / 2` | pass |

`gtop2` certificate construction refuses the extra-cycle fixtures outright
(returns `null`), so an undeclared cycle can never reach a product.

## 5. Wave A1 RED → GREEN

`tests/cad_grading_topology_expectation_20k3.test.ts` (11 tests) carries the
RED reproduction rows and the flipped GREEN rows: extra-cycle rejection,
doubly-punctured rejection, the straight-group seam gate, the declared 1/2
annulus certificate, and the valid controls (strip, annulus, tied split,
legacy straight GAP, legacy straight OVERLAP). All 11 pass on the branch.

## 6. Provenance

- `src/engine/cad/grading/gradingTopologyExpectation.ts`.
- `src/engine/cad/grading/gradingTopologyCertificate.ts` (expectation consumed
  by `buildGradingTopologyCertificateExact`).
- `tests/cad_grading_topology_expectation_20k3.test.ts`.
- `scripts/phase20k3SurfaceAuthorityPerf.ts` §1.
