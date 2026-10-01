# Phase 20K.2 — validation

Status: **IMPLEMENTATION COMPLETE (uncommitted on branch
`fix/phase20k2-curved-topology-product-closeout`, baseline `fbac7c88`)**.
Evidence/docs/scripts batch (this document). Behavior and tests were produced
by the sibling workers and are frozen here; the counts below are from the
recorded handoffs plus this batch's independent runs of the new suites.

## 1. Test inventory (Phase 20K.2)

| Suite | Tests | Subject |
|---|---|---|
| `tests/cad_grading_topology_cycles_20k2.test.ts` | 31 | graph-level `traceBoundaryCycles`, validator cycle/geometry gates, RED replay |
| `tests/cad_grading_topology_certificate_20k2.test.ts` | 9 | `gtop1` shape, determinism, tied recording, fail-closed revalidation |
| `tests/cad_grading_tied_products_20k2.test.ts` | 9 | tied-split Calculate/Product consistency (standalone + group) |
| `tests/cad_grading_curved_design_patch_20k2.test.ts` | 12 | curved Design Patch product path |
| `tests/cad_grading_cutfill_seam_target_20k2.test.ts` | 14 | CUT/FILL direct-fan membership + 1 nm ladder |
| **total** | **75** | |

`npx vitest run tests/cad_grading` → **67 files, 978 tests passed** (this
batch, 2026-10-01).

## 2. A1 RED replay — pre-fix `traceLoops` false-passes

Recorded from the unfixed validator (Phase 20K.2 Wave A1), and frozen in the
cycles suite header. The old `traceLoops` counted boundary-graph components
and never noticed a boundary that was not a simple cycle. Every row below
**now fails closed**; the two valid rows (`strip`, `annulus`) still pass with
identical component counts.

| Fixture | Shape | Pre-fix verdict | Post-fix verdict |
|---|---|---|---|
| `bowtie` | degree-4 vertex, 2 triangles sharing 1 vertex | `ok:true components:2 loops:1` | fail `PINCH` |
| `sharedv` | 2 quads sharing 1 vertex (tied) | `ok:true components:2 loops:1` | fail `PINCH` |
| `slit` | self-touching 8-edge cycle, duplicate coords | `ok:true components:1 loops:1` | fail `PINCH` |
| `tspike` | T-branch, boundary vertex degree 4 | `ok:true components:2 loops:1` | fail `PINCH` |
| `xquads` | 2 disjoint quads, cycles cross in plan | `ok:true components:2 loops:2` | fail `PINCH` |
| `cw` | single clockwise triangle (negative plan area) | `ok:true components:1 loops:1` | fail `NON_MANIFOLD` |
| `strip` | valid single quad | `ok:true components:1` | pass, unchanged |
| `annulus` | valid ring with a hole | `ok:true components:1` | pass, `boundaryCycles = 2` |

The open-chain (degree-1) and odd-degree (degree-3) classes are pinned at the
graph level on `traceBoundaryCycles`, which is also where repeated-edge input
is covered (the incidence map can never emit a duplicate boundary edge).

## 3. A2 RED (Worker B) — tied-split product mismatch

Pre-fix: a genuine Surface arc tied split returned CURRENT from Calculate,
with `components = 2`, while Extract/Bake returned null. The products
re-validated with `{ scope: 'arc' }` (default `expectedComponents = 1`) and no
tied coordinates. The certificate closes the gap: products consume the
worker-recorded topology + tied stations. Post-fix the legacy
`validateGradingMeshTopology(..., { scope: 'arc' })` call **still** fails
(`ok:false, components:2`) — pinned in the suite to document why the
certificate, not a default re-check, is required.

Multi-region result: `gradingTopologyCertificateProductError` returns
`GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE`; Extract/Bake commit nothing
(undo stack length 0, project bytes unchanged); a forged mesh swap, a stale
revision, and a missing certificate all block with zero mutation.

## 4. Worker C conformance — the two scoped fixes

- **A3 curved Design Patch**: all-Distance and mixed-analytic reach CURRENT
  (128/128, 4 GAP ties, plan 9452.124826335) and pass Extract + Bake; Design
  Patch now passes. all-Surface reaches CURRENT (156/156) and passes
  Extract + Bake, but Design Patch stays restricted
  (`DESIGN_PATCH_NON_SIMPLE_RING : SURFACE_EDIT_NOT_APPLICABLE`). Pre-fix RED
  stages: all-Distance/mixed failed at `validateSourceRing` on the exact `V`
  triples (`self-intersection 0/2`); all-Surface failed at `earClip`.
- **A4 CUT/FILL direct fan**: accept (flat planar, sloped planar, alternate
  triangulation, coplanar multi-triangle, tied-station collapse, translated);
  reject (non-cut/fill criterion, off-target `V`, ridge, valley, void,
  stepped/branched bridge). The curved CUT/FILL tilted-cross arc is CURRENT
  at 181/177 (CUT + FILL regions).

## 5. Regression and gate runs

From the recorded `topofix` handoff (sibling topology worker):

- `tests/cad_grading*`: **978 passed** (independently re-run by this batch,
  §1).
- `npm run test:agent`: **7328 passed + 3 unrelated pre-existing study-desktop
  failures** (proven identical on the clean tree).
- `npm run test:wasm`: **74/74**.
- `npm run lint`: clean; `npm run typecheck`: clean.

This evidence batch additionally ran, against the current worktree:

- `npx vitest run tests/cad_grading_topology_cycles_20k2.test.ts
  tests/cad_grading_tied_products_20k2.test.ts
  tests/cad_grading_topology_certificate_20k2.test.ts
  tests/cad_grading_curved_design_patch_20k2.test.ts
  tests/cad_grading_cutfill_seam_target_20k2.test.ts` → **5 files, 75 passed**.
- `npx vitest run tests/cad_grading` → **67 files, 978 passed**.
- `scripts/phase20k2TopologyProductPerf.ts` → complete run, raw output in
  `docs/evidence/phase20k2/perf-output.txt`.
- `npm run lint` and `npm run check:portable-paths` (see the post-merge audit
  for the exact results).

## 6. Honest bounds

- The 1 nm floor (`AGREEMENT_FLOOR`) is an explicit agreement bound, not a
  geometry tolerance; the global `zeroDelta` is unchanged.
- The non-adjacent face-overlap audit remains `O(F^2)` **test-only**; the
  production path is bounded in boundary size.
- `components`, `boundaryCycles`, and the deprecated `loops` are distinct and
  are not interchangeable.
- arc×arc hybrid joints and transition-less surface+analytic mixing remain
  blocked; the all-Surface Design Patch remains restricted.

## 7. Provenance

- Recorded handoff: topology worker (`topofix`), Worker B, Worker C.
- `docs/evidence/phase20k2-curved-design-patch-cutfill.md` (Worker C).
- `docs/evidence/phase20k2-topology-contract.md`,
  `docs/evidence/phase20k2-product-consistency.md`,
  `docs/evidence/phase20k2-post-merge-audit.md`.
