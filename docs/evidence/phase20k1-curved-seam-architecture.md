# Phase 20K.1 curved-seam architecture (Waves B–C; D1 record)

Production chord-seam assembly for curved grading members. Predecessors:
Phase 20K study (chord-seam strip pinch ⇒ `NO_GO_TERMINAL_CHORD_ARC_PAIR`),
Wave A1 (corrected audit predicate), Wave A2 (production reproduction
matrix: E/F/G `VERTEX_PINCH`, D diagnostic-weld coincidences), Wave B1
(topology validator), Wave B2 (fail-closed gate), Wave C1 (analytic seam).

## §9 topology contract + validator (`gradingTopology.ts`, B1)

`validateGradingMeshTopology` is the single authority: finite XYZ, index
bounds, plan-area agreement, no duplicate triangles, no interior overlap,
edge incidence ≤ 2, edge-component count, open-continuous / closed-simple
ring checks, no bridge/self-cross. Detail codes `GRADING_*_SEAM_PINCH` /
`*_SEAM_NON_MANIFOLD` name the failure; the validator is pure and reused
as-is by every wave (B2 wires it, never forks it).

## §15 shared chain (`gradingChordSeam.ts`, C1)

`assembleSolvedGradingChain` stitches internal arc chord joints for
analytic members: internal stations via `analyticTerminalLine` +
`solveAnalyticCorner`, same effective criterion both sides. One helper
serves standalone (`arcSolve.ts`) and group (`gradingGroupCompute.ts`)
curved-analytic paths — no duplicated seam logic.

## §13/§14 seam solvers (C2)

- `gradingGroupSurfaceCorners.ts`: `solveSurfaceCorner` verbatim-extracted
  from the S↔S group path (active-grade planes, miter seam, outward ray +
  extent, nearest outward root via `solveMiterTie`, second-plane agreement,
  sector-path build/trim). Group compute calls it with bitwise-identical
  behavior for straight S↔S corners.
- `gradingChordSeam.ts` Surface assembly (`assembleSurfaceChain`): GAP
  sector-path splice, OVERLAP paired-trim with authority check, repeated-V
  fan pairs, exact-endpoint sharing, wedge-coincident canonicalization to
  the tie, per-side active grades, tieless cross-grade fan fallback.
  Routed via `arcSolve.ts` (standalone Surface arcs) and group
  curved-Surface members; C1 analytic path intact.

## §16 vertex authority + agreement hardening (C2, no new tolerances)

Sector final gate, seam-disagree, and chord daylight gates all use
`elevationAgreementTol` + 1 nm floor under one authority; snap-straddle
graph-key fallback (exact first); grid-quantization term; dust-span drop.
B2 gate kept as defense-in-depth (+ tied-split budget for partially-tied
arcs). arc×arc hybrid stays blocked
(`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`).

## Result

Standalone Surface arc D: CURRENT 39/37, plan == analytic. All-Surface
square H: CURRENT 156/156, plan == E. One-arc hybrid G: CURRENT 43/41,
exact tie. All-Distance / mixed-analytic squares E/F: unchanged and
bitwise-identical before/after C2.
