# Phase 20L — Offset-Radius Validation (evidence)

Study-only. Zero `src/` changes. All pins below are in `tests/` on this branch;
production behavior is observe-only.

## 1. Oracle pins (independent analytic math)

- 20K symbolic controls preserved: R=60, ratios [0.1, 0.5, 0.9, 1.0, 1.1],
  right growth / left shrink, collapse at 1 / inversion above, resolver-null
  symbolic-only (`cad_grading_offset_radius_feasibility_20l`, §20K-controls).
- Endpoints equal source endpoints shifted; sweep preserved iff `Roff > 0`.
- `d = R` collapses every endpoint to C; `d > R` same-orientation
  unrepresentable. Nonfinite inputs fail closed, never OK.
- Join stub defers OK rows; policy required exactly on
  collapse/inversion/nonfinite. CW/CCW mirror pinned (CW-right shrinks like
  CCW-left).

## 2. Matrix pins (11088 cells)

Full cross product `7 radii × 6 sweeps × 2 CW/CCW × 2 sides × 11 ratios ×
3 coordinate frames × 2 Z modes`: every cell deterministic-finite with exact
endpoints or a precise classification. Exact-geometry radial sign and
collapse/inversion boundary; zero residual at `d = 0`, finite non-negative
elsewhere. Every frame recomputed natively (never copied): residuals agree
within 1e-4 absolute (measured worst e8 drift 1.3e-5), endpoints shift
exactly; rotation invariant (rigid-frame residual unchanged). Exact-sign
boundary pins (just-below/exactly/just-above R, tiny ±Roff, NaN/±Inf) and
band-gating pins (`d = 0` zero-area, NaN/Inf distance, failed topology →
`ok:false`, never `ok:true`).

## 3. Join pins (31 fixtures under 25 test cases in `joins_20l`, plus 11 numerical-authority cases)

5 `UNIQUE` (inside-corner OVERLAP only), 12 `AMBIGUOUS` (incl. every arc→arc
reference, half the line→arc cases, the unresolved near-tangent contact, and
the coincident-circle degeneracy), 2 `NONE` (parallel + clean miss),
8 `NONLOCAL` (hairpin, span mismatch, and the single-branch outside-corner
GAP joins — structurally past the member ends; multi-local GAP joins stay
`AMBIGUOUS`), 1 `WRONG_SIDE` (stress only),
1 `SELF_INTERSECTION` (stress only), 2 `COLLAPSE`/`INVERSION`. GAP/OVERLAP
branch pattern derived then verified; rotation (37°) + translation
(123.4, −56.7) preserves class, extent, conditioning, radii; large-coord
(E/N ~ 1e6) copies preserve class with 1e-9 relative extent agreement. The
miter probe compares against the GEOMETRIC join (first branch-consistent
intersection), not the span-gated usable join.

## 4. Locality pins

Locality is bounded exactly by `|J − V| ≤ maxSearchDistance` (one fixture →
UNIQUE at 100 m, NONLOCAL at 1 m), AND by member span (usable joins land on
the bodies; a single-branch outside-corner GAP join needs extension past the
member ends → `NONLOCAL`, while a multi-local GAP join stays `AMBIGUOUS`). `miterExtent` never rejects an honest offset join (20× loose on
a right-angle miter; 11459.30 m bound vs a NONLOCAL 572.97 m hairpin join)
— it is not a truthful offset-join gate. Near-parallel conditioning recorded
as raw determinant/discriminant (`sin 1° ≈ 0.01745`); a constructed tangent
landing inside conditioning noise is UNRESOLVED (`AMBIGUOUS`, never a snapped
tangent), and coincident offset circles are `AMBIGUOUS` (infinite
intersections), never `NONE`.

## 5. Variable-distance pins

13/30 rows `OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR`. Constant-offset families
(`distance`, `relative-elevation`) are `OFFSET_SAMPLED_CONSTANT_DISTANCE` —
exact-zero range over the 10 samples only, certifying nothing about the
between-station gaps; `elevation`/`fixed` on graded sources or any
sloped/non-planar target vary with station. CUT/FILL straddling flips the
branch (`sideChange = true`, 3 rows).

## 6. Production observe-only pins

Production bounds untouched (`linearizeGradingArc` / `gradingSideNormal` still
fail closed). Station-sampled chord-normal residual converges with the SQUARE
ROOT of `curveChordTolerance` (residual/√tol ≈ 1.56–1.77 ≈ d·√(2/R);
7.80 m at tol 25 → 0.056 m at tol 0.001, R=252.5 90° d=20) — the earlier
“0.56·tolerance” reading was wrong 10× at tol 0.1. The residual is a lower
bound (mid-chord maxima unsampled), not the full daylight. Collapse approach:
`Roff` 30 → 0.006, curvature `1/Roff` 0.033 → 166.7, chord offset stays
finite.

## 7. Topology pins

3 buildable strips PASS both the independent audit and
`validateGradingMeshTopology` (rel. area err 5.2e-4 – 9.7e-3).
Collapse/inversion/whole-circle sources claim no strip. Injected defects
(duplicate triangle, third face on interior edge) are detected — a PASS is
not the constructor vouching for itself.

## 8. Tolerance pins

`exactZero` is exact (`Roff === 0` → `COLLAPSE_GATE`); `conditioning` is
`0 < Roff < tolerance` (offset arc under-resolves to one chord →
`CONDITIONING_REVIEW`); above-zero negative → `ORIENTATION_GATE`. Agreement
reuses `coordinateAgreementTol` on two exact constructions of the same offset
point. No new tolerance added.

## 9. Corpus pins

`offset-radius-corpus.json`: 48 bounded rows (9 boundary/matrix + 30 variable
+ 9 tolerance), byte-identical across builds. `corpus-core.json`: 400 rows
(radii [10, 60, 100, 252.5, 500] × sweeps [5, 45, 90, 135] × CCW/CW ×
left/right × 5 ratios = 5×4×2×2×5), all endpoint-agreeing, identical twice.

## 10. Test counts (actual `it` blocks on branch)

| Suite | `it` count |
|---|---|
| `cad_grading_offset_radius_feasibility_20l` | 20 |
| `cad_grading_offset_radius_joins_20l` | 25 |
| `cad_grading_offset_radius_robust_20l` | 25 |
| `cad_grading_offset_radius_topology_20l` | 18 |
| `cad_grading_offset_radius_numerical_20l` | 11 |
| **Total** | **99** |

## 11. Numerical-authority fix round (study-only, zero `src/`)

All seven absolute epsilons in `phase20lOffsetJoinCore.ts` are replaced by
bounds derived from the shared 20J1 authorities (imported, never copied):
span/branch/locality/probe-comparison via `seamParameterAgreementTol`
(no absolute floor — at 1e8 the coordinate quantum ≈ 2.2e-8 × 32 ≈ 7e-7
governs, at the origin the EPS term ≈ 7e-15·scale); line-line NONE gate
exact-`det === 0` plus an `OPS·EPS` near-parallel band reported AMBIGUOUS
like the curve contacts (never snapped); line-line conditioning
informational-only dimensional `OPS·EPS·local_scale`; line-circle
`OPS·EPS·max(1,R²,|f|²)` local; circle-circle centres per-axis
`coordinateAgreementTol` with same-radius `OPS·EPS·max(1,R1,R2)`;
circle-contact `OPS·EPS·max(1,R1²,R2²,aa²,dist²)` local. `Roff`
construction and `collapsed()` stay EXACT. The classifier translates
world → V=(0,0) by exact subtraction (canonical incoming V, never
averaged/welded; no rotation inside) and reports back `x_world = x′ + V.

Measured: 31-fixture corpus regenerated byte-identical (SHA-256
`4667909f…`, counts unchanged 5/12/2/8/1/1/2 — zero fixture deltas, local
frame transparent at origin); line-line flips cleanly at the band (1e-12°
resolves, 1e-13° AMBIGUOUS with zero roots, 0° exact NONE); line-circle
±1e-14 around the constructed tangent is AMBIGUOUS with no roots, −1e-12
secant resolves 2-local (AMBIGUOUS by branch policy), +1e-12 miss is NONE;
coincident circles AMBIGUOUS at dR ≤ 1e-15, concentric NONE at dR ≥ 1e-12;
span endpoint-exact and ±1ulp stay UNIQUE, +1e-9 past-band goes NONLOCAL,
no translation flip at 1e8 (sub-quantum shift stays inside the widened
band); all 31 fixtures class-identical at origin/1e6/1e8/1e8-rotated with
extents inside `seamParameterAgreementTol`, except `LA_TANGENT_CONTACT`
under 1e8+rotation resolving 2 arithmetic branches (fixture-level trig
rounding) while staying AMBIGUOUS — fail-closed preserved, no bitwise
demand on ill-conditioned contact.
