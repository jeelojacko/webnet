# Phase 20B grading performance evidence (worker compute, real TINs)

Script: `scripts/phase20bGradingPerf.ts` (`npx tsx scripts/phase20bGradingPerf.ts`;
`--quick` = 1k/10k smoke). Full run: **52.8 s**, exit 0. No `src/` changes.

Method: the authoritative worker function `computeGradingFromSnapshots` on
deterministic grid TINs (jittered generic-position vertices, §5) at
1k/10k/50k/**100k triangles actually run — no extrapolation**. One ordinary
100 m course per leg. Cases: A flat, B sloping plane, C plane-break teeth,
D rolling, E void (expects fail), F cut/fill transition, G arc chord at two
tolerances. Columns: total wall ms (median), standalone `buildSurfaceGrid`
ms (the engine builds it 2× per call), standalone agreement-gate ms,
candidates, segments/multi, daylight nodes, mesh tris, plan area, heap delta
(noisy, advisory only).

## Measured table (median ms)

| tris | A total | B total | C | D | E total | F total | G total |
|---:|---:|---:|---|---|---:|---:|---:|
| 1,020 | 4.28 EXACT | 2.23 EXACT | BRANCH | DISAGREE | 1.71 NO_SOL | 13.1 DISAGREE | 2.39 CURVE_APPROX |
| 10,152 | 15.5 EXACT | 15.6 EXACT | BRANCH | DISAGREE | 6.73 NO_SOL | 231 DISAGREE | 14.8 CURVE_APPROX |
| 50,400 | 48.0 EXACT | 53.7 EXACT | BRANCH | DISAGREE | 25.3 NO_SOL | 2337 DISAGREE | 57.6 CURVE_APPROX |
| 100,048 | **96.5 EXACT** | **106 EXACT** | BRANCH | DISAGREE | 45.5 NO_SOL | 6444 DISAGREE | 107–109 CURVE_APPROX |

Detail @100k: A — idxPrep 13.4 ms, validate 0.01 ms, 30,660 candidates,
1 seg, 2 daylight nodes, 2 mesh tris, area 2000 m². B — 38,544 candidates,
area 2500 m². G — 46,208 candidates, area 1414 m², coarse ≡ fine
(544/544 candidates, identical daylight). Correction (Gate-10): the G leg's
arc source carries no circle params, so it measures the legacy single-chord
fallback (hence tolerance-invariant) — NOT the production path, which now
subdivides param-carrying arcs per chord at curveChordTolerance (§90/§91). E (void) fails in 45.5 ms via the empty-candidate path.

Scaling exponents (1.00 = linear): 1k→10k: 0.56–0.85 (F 1.25);
10k→50k: 0.70–0.92 (F 1.45); 50k→100k: **0.85–1.02 (F 1.48)**.
Replay probe (A @10k): candidate select 0.27 ms (3,220 tris), local transform
0.33 ms (9,660 verts) — the solve core is candidate-driven, not grid-bound.

## Complexity

Cost = index build (~2× idxPrep: 27 ms @100k) + candidate interactions
(clip/zero-locus/envelope over the strip bbox subset: 30.7k of 100k tris for
A) + result size (2 nodes / 2 tris here). Never O(samples × all triangles):
10k→100k total grows 6–7× for 10× triangles (exponents ≤1.02). F is the
exception (1.45–1.48): cut/fill coverage probes call `elevationAt` per
candidate-vertex station, i.e. per-candidate queries with a large constant —
still linear-ish, but 60× slower than fixed grade at 100k (6.4 s). No timing
gate is proposed; one ordinary course at 100k is practical in all cases.

## Determinism, large coordinates, convergence (all PASS, fail-closed)

- Determinism (A @10k, triangle order shuffled + vertex storage reversed):
  daylight + mesh **IDENTICAL** (JSON-equal).
- Large coordinates (+2,000,000 / +7,000,000): max daylight diff **0.00e+0**,
  tie-distance diff **0.00e+0** — the (u,d) frame conditions exactly.
- Curve convergence (§41/§91, quarter-circle R=50, per-chord exact solve on
  flat target): tol 0.5 → 6 subdivisions, sagitta 0.4278; 0.05 → 18, 0.0476;
  0.005 → 56, 0.0049. Sagitta within tolerance ✓, monotone growth ✓,
  daylight vs-fine error 7.46 → 1.83 → 0.00 m, monotone ✓.

## Engine findings (fail-closed, out of scope — engine is read-only here)

1. **Snap-vs-floor gate (D, F at every scale).** Interior daylight nodes carry
   the worker's 1e-12 snap (≤5e-13 coord noise); the GO-gate floor is
   4ε·|z| ≈ 1e-14. Measured exhibit (F @1k): node (3.70, 3.70),
   |zt−zg| = **1.79e-13 vs floor 1.05e-14** → GRADING_DAYLIGHT_DISAGREE.
   Integer-coordinate nodes (A/B/G ties, worker-test fixtures) survive the
   snap losslessly, which is why coarse fixtures pass and dense real TINs
   fail. The gate is tighter than the pipeline's own node noise.
2. **Crossover-doppelgänger BRANCH (C at every scale).** At a kink joint the
   pairwise segment-crossing computes ~1 ulp off the exact endpoint; dedup
   keeps the doppelgänger and drops the exact joint; the carrier-agreement
   check (4ε) then fails on evaluation-order noise (measured 16ε = 3.55e-15).
   Any kinked locus can trip this with probability growing in joint count.
3. **Vertex-graze alignment.** An exact axis-aligned grid lets a straight
   locus graze TIN vertices → BRANCH_DISCONTINUITY; a 0.37 m shift ties
   cleanly (one merged segment). Benchmark TINs carry +0.37/+0.41 m jitter
   to stay in generic position; verified jitter-independent for the F-case
   density split (11×6 passes at all jitters, 31×18 fails at all).
4. Heap deltas swing ±26 MB run-to-run (GC noise) — recorded, not evidence.

Net: the success path (A/B/G/E) is timed at all scales incl. 100k; C/D/F
 legs time the fail-closed paths and characterize two numerical-contract
 issues for the engine owner. No engine/worker/shell files touched.
