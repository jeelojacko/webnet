# Phase 20K.3 — Surface source-station canonicalization (Wave C)

Status: **IMPLEMENTATION COMPLETE on branch
`fix/phase20k3-surface-curve-authority-certificate`, baseline `884b36e8` =
PR #143 merge.**

## 1. The representation defect

The 20K.1/20K.2 Surface chord-seam assembly resampled each shared seam station
as `atSource(u) = start + t·length`. The incoming run, the outgoing run, and
the corner fan each recomputed that expression independently, so the same
physical station was emitted as several Float64 values that differed in the
last bits — "ULP twins". Downstream that produced:

- exact-coincident vertex sets on the seam (reported as weld diagnostics);
- degree-4 boundary pinches / micro-edges that ear-clipping refused, so the
  all-Surface Design Patch stayed explicitly restricted
  (`DESIGN_PATCH_NON_SIMPLE_RING:SURFACE_EDIT_NOT_APPLICABLE`).

Wave C fixes this by **exact bitwise sharing**, not by a tolerance weld: no
coordinate is moved, averaged, projected, or rounded.

## 2. The fix

`assembleSurfaceChain` (`src/engine/cad/grading/gradingChordSeam.ts`) now
overwrites every internal chord-seam source run tip with the single exact
linearized joint `v` shared by the incoming run, the outgoing run, and the
corner fan. Consequences:

- The `start + t·length` ULP twins are gone by construction.
- Daylight target points are **not** modified for index matching; only the
  internal seam tip is unified.
- Member first/last are still canonicalized to the persisted endpoints at the
  caller boundary (the standalone source boundary authority, Wave D).
- Paired OVERLAP clipping reuses an existing endpoint **bit-exactly** when a
  crossing lands on it, and only interpolates genuine interior inserts.
- The consecutive-duplicate guard compares the **tie-canonicalized** daylight,
  so a tieless CUT→TIED→FILL fan collapses to exactly one seam sample instead
  of leaving a duplicate.

## 3. Measured oracle movements

Plan/3D areas, ties, projections, root, criterion, region, and target
agreement are all unchanged; only the seam-station representation changed. The
counts are vertex / triangle counts from the production oracles:

| fixture | before V/T | after V/T | coincident sets |
|---|---|---|---|
| standalone Surface arc | 39 / 37 | **32 / 30** | 2 → 0 |
| standalone sloped (10→10.5) | — | 32 / 30 | — |
| standalone sloped (10→11) | — | 32 / 30 | — |
| all-Surface rounded square | 156 / 156 | **128 / 128** | 11 / 4 → 0 |
| one-arc hybrid | 43 / 41 | **36 / 34** | — |
| CUT/FILL tilted-cross arc | 181 / 177 | 175 / 171 | — |

Real closed rounded-square group (perf harness §5), all-Fixed/Surface,
tolerance 0.1:

| V | F | E | B | C exp/meas | cycles exp/meas | facets |
|---|---|---|---|---|---|---|
| 128 | 128 | 256 | 128 | 1/1 | 2/2 | 2 |

Source canonicalization of that fixture: raw captured `sourceBoundaryPoints`
= **89 stations** → canonical **32 stations**, **microEdges = 0**, in
0.008 ms (`resolveDesignPatchRing`). The Wave C single exact linearized joint
replaces the ULP-twin seam tips; the canonical ring has one vertex per seam
and no plan-micro edges.

## 4. Products unlocked

- **All-Surface Design Patch now resolves end to end**: the canonical
  32-station simple ring ear-clips and builds a 128-vertex / 158-triangle
  `design-patch` surface through CURRENT → enabled → patch → provenance →
  Undo/Redo. The 20K.2 restricted fixture and the 20D curved outward ring both
  ear-clip cleanly.
- The obsolete legacy seam digest pin `b6bdc245` is replaced by the `gtop2`
  exact certificate digest as the authority (`docs/evidence/phase20k3-exact-certificate.md`).
- The hybrid corpus control row (`docs/evidence/phase20k/corpus.json`) is
  regenerated with planArea pinned at 9 decimals; the gtop2 digest changed
  because the geometry representation changed, while the plan areas are
  unchanged.

## 5. Test coverage

`tests/cad_grading_surface_products_20k3.test.ts` carries the canonical seam
inventory and the product-path coincidence reconciliation to zero. Related
regressions flipped/updated for the new counts:
`tests/cad_grading_arc_surface_seam_20k1.test.ts`,
`..._arc_internal_seam_20k1.test.ts`,
`..._curved_design_patch_20k2.test.ts`,
`..._curved_group_topology_20k1.test.ts`,
`..._cutfill_seam_target_20k2.test.ts`,
`..._hybrid_corner_20j.test.ts`.

## 6. Provenance

- `src/engine/cad/grading/gradingChordSeam.ts` (`assembleSurfaceChain`,
  `shareMiterSeam`, paired OVERLAP clipping, tie-canonicalized dupe guard).
- `docs/evidence/phase20k3-surface-authority-performance.md` §5.
