# Phase 20K.1 curved-seam validation (Waves B–D1 oracle record)

Suites: `cad_grading_topology_audit_20k1` (14, B1 validator oracles),
`cad_grading_curved_group_topology_20k1` (13, B2 gate),
`cad_grading_curved_products_20k1` (6, B2 products),
`cad_grading_analytic_seam_20k1` (4, C1),
`cad_grading_arc_surface_seam_20k1` (23, C2),
`cad_grading_arc_internal_seam_20k1` (3, A2 RED freeze — updated old→new
where C2 heals, D/G/H rows).

## §17 hand numbers

Primary exact tie `(40,−20,90)` √2000 Qs/Qa carried from 20J; Surface
`FIXED(−0.5)` vs analytic `DIST(−0.5,20)` agree on plan bitwise (level
arc), tessellation differs honestly (Surface runs follow TIN structure).

## §18 equivalences

Surface/Distance plan-bitwise on the level arc; CutFill active −0.5
bitwise-identical to Fixed; sloped source (10→10.5, 10→12) assembles valid
strips; tilted-plane-below-source solves with bitwise-identical alternate
triangulation; all-Distance vs mixed-analytic squares bitwise identical;
C2 leaves E/F unchanged + bitwise.

## §19 ladder

Tolerance ladder 30 → 0.001: every positive width passes with converging
area and no NaN; seam counts follow subdivisions; digests deterministic;
excessive subdivision fails closed (never hangs).

## §20 rounded squares

E all-Distance / F mixed-analytic CURRENT 128/128 plan 9452.124826335;
H all-Surface CURRENT 156/156 plan == E with 4 ties, 1 component, simple
rings; 20K corpus regenerated.

## §21 hybrid / §22 tied

G one-arc hybrid CURRENT 43/41 exact tie, internal seams valid, arc×arc
still blocked; fully-tied arc reports ALREADY_TIED with empty mesh;
source-length partition complete (tied line measure-zero).

## §23 target/root pathologies

Target hole / void fail closed (never CURRENT); tie on triangle edge and
vertex resolve exactly; one root ties exactly, empty candidates fail
closed; multi-root keeps nearest outward root; overlapping sheets fail at
the branch gate.

## §24 large coords

E≈2M/N≈7M holds geometry to 1e-9 relative, no NaN, no zeroDelta change.

## §25 translation invariance + §26 determinism

Translated squares solve identically (perf: 1.80/3.70 ms large vs
1.95/1.13 ms local); repeated runs byte-identical digests.

Perf source: `scripts/phase20k1CurvedSeamPerf.ts`, numbers in
`phase20k1-curved-seam-performance.md`.
