# Phase 20L — Offset-Radius Safety Study (evidence)

**Scope:** evidence/feasibility only. Zero `src/` changes. No production route,
gate, UI, persistence, or certificate touched. Branch
`research/phase20l-offset-radius-safety`, baseline
`d9400af7157e343e7b6ca932c2b05fb5795ac8c2`.

## 1. What is studied

A curved grading source offset on side L/R by a constant plan distance `d` has
an **exact parallel offset**: a concentric arc of signed radius

```
Roff = R + radialSign·d
radialSign = (side === (sweepCCW ? 'left' : 'right')) ? -1 : +1
```

`radialSign` is exact geometry (the centre lies on the curvature side), never a
tolerance. Production does **not** model this arc: it linearizes the source
(`linearizeGradingArc`) and offsets each chord along its **own** frame normal
(`analyticTerminalLine`), so the daylight is a chord-parallel polyline. 20K's
`offsetRadiusSafety` was strictly symbolic (resolver never run). 20L runs the
arithmetic and measures the residual.

Reused authorities (unchanged): `linearizeGradingArc`, `gradingSideNormal`,
`zeroDelta`, `coordinateAgreementTol`, `auditMesh` /
`validateGradingMeshTopology`.

Shared vocabulary: this study and the core track
(`scripts/phase20lOffsetRadiusCore.ts`) use the same four literals
`OFFSET_RADIUS_OK | COLLAPSE | INVERTED | NONFINITE`; no new code is invented.
The sign is sweep-aware (`radialSign` from the actual curvature side); the core
track keeps the sweep-agnostic 20K symbolic control separately.

## 2. Parameter matrix (§1)

Full cross product: `7 radii × 6 sweeps × 2 CW/CCW × 2 sides × 11 ratios ×
3 coordinate frames × 2 Z modes = 11088 cells`, all finite. Radii
`[1e-3, 10, 60, 100, 252.5, 500, 1e6]`, sweeps `[1, 5, 45, 90, 135, 179.9]°`,
ratios `[0, 1e-6, 0.01, 0.1, 0.5, 0.9, 0.999999, 1, 1.000001, 1.1, 2.0]`,
coordinates origin / ~1e6 / ~1e8.

- Every cell is `deterministic finite` with exact endpoints and a
  `OFFSET_RADIUS_*` classification.
- Inward (`Roff = R − d`) collapses exactly at `d/R = 1` (`OFFSET_RADIUS_COLLAPSE`)
  and inverts above (`OFFSET_RADIUS_INVERTED`). Outward never collapses.
- Every coordinate frame is recomputed NATIVELY (translated centre through
  the real linearizer + residual), never copied from the origin frame:
  residuals agree within 1e-4 absolute across frames (measured worst e8 drift
  1.3e-5 on a 2825 m residual; small-residual worst 8e-7) and endpoints shift
  exactly by the frame offset.

## 3. Production comparison (§3, observe only)

Chord-normal offset residual vs `curveChordTolerance` (R=252.5, 90° arc,
d=20 m, flat):

| tolerance (m) | subdivisions | residual (m) |
|---|---|---|
| 25 | 3 | 7.80e+0 |
| 10 | 4 | 5.22e+0 |
| 1 | 13 | 1.74e+0 |
| 0.1 | 41 | 5.61e-1 |
| 0.01 | 125 | 1.76e-1 |
| 0.001 | 394 | 5.61e-2 |

Monotone convergence with the SQUARE ROOT of tolerance: residual/√tol ≈
1.56–1.77 across the band (offset error ≈ d × half-step angle, half-step ∝
√tol; theory d·√(2·tol/R) ≈ 1.78·√tol here). The earlier
“0.56·tolerance” reading was wrong by 10× at tol 0.1 m (0.056 m predicted vs
0.561 m measured). This is a **discretization** error, not a gate: no
production change is claimed from linearization alone. The residual itself is
station-sampled (stations + seam kinks; mid-chord maxima are NOT sampled), so
it is a LOWER BOUND on the full-daylight residual, not the full daylight.

Collapse approach (R=60, inward): `Roff` `30 → 6 → 0.6 → 0.06 → 0.006`; curvature
`1/Roff` grows `0.033 → 166.7`; the chord offset stays finite but the exact
offset arc becomes sub-tolerance and its own chord budget (if ever modeled)
would collapse to a single chord.

## 4. Variable distance (§2)

`d` sampled at 10 stations over flat/graded sources × flat/sloped/ridge targets
× fixed/distance/elevation/relative/cut-fill criteria: **13/30 rows are
`OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR`**. Constant verdicts are
`OFFSET_SAMPLED_CONSTANT_DISTANCE` — exact-zero range over the 10 samples only,
certifying nothing about the between-station gaps (a fixed/distance-law `d` is
constant by construction; any other law varying between samples escapes
detection).

- `distance` and `relative-elevation` are constant-offset families → circular.
- `elevation`/`fixed` on a graded source, or any sloped/non-planar target,
  vary with station → never forced into `Roff`.
- CUT/FILL: a graded source whose profile straddles the target flips the
  branch across the source → `sideChange = true` (3 rows).

## 5. Independent topology audit (§4)

A buildable claim requires `Roff > 0` AND the exact offset strip passing
`auditMesh` (finite XYZ, valid CCW indices, positive plan area, no duplicate,
no interior overlap, incidence ≤ 2, one edge-connected component, simple open
daylight, no bridge, no coincident-unshared edge) AND
`validateGradingMeshTopology(points, triangles).ok`.

Buildable corpus strips (all PASS):

| fixture | R | sweep | d | subdiv | plan area (chord/exact) | rel err |
|---|---|---|---|---|---|---|
| `origin.R252.5.s90.ccw.right.d20` | 252.5 | 90° | 20 | 28 | 8242.356 / 8246.681 | 5.2e-4 |
| `origin.R60.s12.ccw.right.d6` | 60 | 12° | 6 | 1 | 78.591 / 79.168 | 7.3e-3 |
| `origin.R60.s179.9.ccw.left.d30` | 60 | 179.9° | 30 | 13 | 4197.702 / 4238.794 | 9.7e-3 |

Collapse/inversion/whole-circle sources return `ok:false` with
`OFFSET_RADIUS_COLLAPSE` / `OFFSET_RADIUS_INVERTED` / `OFFSET_RADIUS_NONFINITE`
— no strip is claimed. Injected defects (duplicate triangle, third face on an
interior edge) are detected by the audit, so a PASS is not the constructor
vouching for itself.

## 6. Tolerance audit (§5)

R=60, inward, tolerance 0.1:

| case | Roff | class | exactZero | conditioning | policy |
|---|---|---|---|---|---|
| ratio 0.999 | 0.06 | OK | false | true | `OFFSET_RADIUS_CONDITIONING_REVIEW` |
| ratio 1 | 0 | COLLAPSE | true | false | `OFFSET_RADIUS_COLLAPSE_GATE` |
| ratio 1.000001 | −6e-5 | INVERTED | false | false | `OFFSET_RADIUS_ORIENTATION_GATE` |
| ratio 1.1 | −6 | INVERTED | false | false | `OFFSET_RADIUS_ORIENTATION_GATE` |
| 179.9° sweep, ratio 0.5 | 30 | OK | false | false | `NONE_STUDY_RECOMMENDATION` |

`exactZero` is exact (`Roff === 0`). `conditioning` is `0 < Roff < tolerance`
(the offset arc is finer than the source chord budget, so it under-resolves to
one chord) — a STUDY WARNING (conditioning review), not a product gate: no
threshold value is chosen here and no production path reads it. `agreement` reuses the existing `coordinateAgreementTol` on the
two exact constructions of the same offset point; it is true for the
well-conditioned near-tangent and ~1e8-coordinate rows and false when the two
evaluation orders differ by more than that bound. No new tolerance was added.

## 7. Corpus (§6)

`docs/evidence/phase20l/offset-radius-corpus.json` — **48 bounded rows**
(9 boundary/matrix + 30 variable + 9 tolerance). Row fields: fixture id,
category, R, sweep, CW/CCW, side, d, d/R, Roff, classification, endpoints,
offset residual, join class (`OFFSET_JOIN_DEFERRED` on the buildable strip,
`OFFSET_JOIN_NOT_APPLICABLE` otherwise; no adjacent join is solved, so
extent is always null), topology, counts, areas, digest.

- Generated twice byte-identical post-fix (SHA-256 `edc23ab9a5cefa76…`).
- Classifications: 13 `OFFSET_RADIUS_OK`, 2 `COLLAPSE`, 3 `INVERTED`,
  17 `OFFSET_SAMPLED_CONSTANT_DISTANCE`, 13
  `OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR`.
- 3 buildable `PASS` topology strips.

## 8. Performance (measurement only)

`scripts/phase20lOffsetRadiusPerf.ts` (full, 15 reps, median):

| stage | ms |
|---|---|
| exact offset construction (924 cells) | 5.6e-2 |
| chord-offset residual (warm cache) | 9.2e-4 |
| chord-offset residual (cache miss) | 5.2e-2 |
| matrix batch (11088 cells, warm) | 8.3 |
| offset-strip audit (1 band) | 8.5e-1 |
| corpus generation (48 rows) | 3.1 |

## 9. Verdict

Production stays frozen on the existing fail-closed bounds. 20L supplies the
honest numeric offset-radius picture that 20K left symbolic: exact `Roff`,
`d/R ≥ 1` collapse/inversion boundary, variable-distance rejection, a
buildable topology gate for exact offset strips, and a station-sampled residual that
converges ~square-root with `curveChordTolerance` (residual/√tol ≈ 1.56–1.77). No production gate is wired
here; a future gate proposal would be `|Roff| < chordTolerance` conditioning
plus `Roff ≤ 0` orientation/collapse.
