# Phase 20L — Offset-Radius Decision (evidence)

Study-only. Zero `src/` changes. This doc applies the §16 verdict framework to
exactly one verdict. No production route is opened here.

## §16 — Verdict framework

Exactly one of:

- `GO_BOUNDED_OFFSET_RADIUS` — admit with stated numeric bounds and wired
  gates. Requires: unique joins everywhere admitted, a truthful extent gate,
  circularity over the admitted input class.
- `PARTIAL_GO_OFFSET_RADIUS` — admit an explicit subset with gates at explicit
  locations. Requires: the subset boundary expressed in existing quantities and
  every gate value chosen (not deferred).
- `NO_GO_OFFSET_RADIUS` — reject: the geometry is unsound or unmeasurable.
- `POLICY_REQUIRED_OFFSET_RADIUS` — the geometry is solved and measured, but
  admission needs explicit product policy choices this study must not make.

## Verdict: `POLICY_REQUIRED_OFFSET_RADIUS`

The evidence rules out two verdicts cleanly. Not `NO_GO`: the
constant-distance circular offset is exact (`Roff = R + radialSign·d`),
measured over 11088 matrix cells (every frame natively recomputed), with 3
buildable topology strips and a station-sampled residual converging
~square-root with chord tolerance (residual/√tol ≈ 1.56–1.77). Not
`GO_BOUNDED`: 12/31 join fixtures are `AMBIGUOUS` (10 with ≥2 local branch
intersections, including every arc→arc reference, plus the 2 unresolvable
degeneracies), outside-corner joins structurally need member-end extension,
`miterExtent` is proven not a truthful offset-join gate (20× loose on a
right-angle miter; passes a NONLOCAL hairpin), and 13/30 variable-distance
rows are non-circular — so no honest bound covers the full input class.

`PARTIAL_GO` vs `POLICY_REQUIRED` turns on whether the gate values exist.
They do not, and the candidate subset below is measured — not proven sound:
its extent gate is an unchosen constant, its disambiguation rule does not
exist, outside-corner joins are structurally excluded without an
extension policy nobody has stated, variable-distance families have no
daylight law at all, and the residual bound is station-sampled (a lower
bound, not the full daylight). Admitting even the unique-join subset without
those choices would silently re-enact the through-V / auto-pick errors this
study was built to prevent. Hence `POLICY_REQUIRED_OFFSET_RADIUS` — exactly:
the geometry is solved and measured, but admission needs explicit product
policy choices (extent constant, disambiguation rule, extension policy,
circularity law) this study must not make.

## Admitted subset (if policy is later set)

Constant plan distance `d`, circular source arc, `Roff > 0` strictly,
`OFFSET_JOIN_UNIQUE` with all intersections local AND on the member bodies
(inside-corner only — outside-corner joins need extension past the member
ends), `|J − V| ≤ <extent>` under an explicitly chosen offset-join extent
constant, and no station-variation of `d` (`OFFSET_SAMPLED_CONSTANT_DISTANCE`
only, gaps between samples uncertified). Everything else —
collapse/inversion, ambiguous/multi-local joins, nonlocal/span-exceeding
joins, near-tangent conditioning noise, coincident degeneracies,
variable-distance families, arc→arc corners — stays fail-closed.

## Explicit gate locations (no implementation)

1. **Extent gate:** a new offset-join extent constant applied as
   `|J − V| ≤ extent`, evaluated at each adjacent-member join — not
   `miterExtent`, which bounds the miter seam ray parameter and diverges from
   the true join distance by 10–100×.
2. **Collapse/orientation gate:** `Roff === 0` → collapse; `Roff < 0` →
   orientation; `0 < Roff < chordTolerance` → conditioning review — evaluated
   where the offset radius is constructed.
3. **Circularity gate:** station-sampled `d` exactly constant over the samples
   → sampled-circular; varying → `OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR`,
   evaluated where the daylight distance law is selected. No tolerance band
   certifies circularity, and the between-station gaps stay uncertified.
4. **Disambiguation rule:** a signed branch-continuity rule (e.g. the branch
   continuous with the chain's own offset path) applied wherever ≥2 local
   intersections survive — currently none exists; the study surfaces all
   branches instead of picking.

## §17 — Future gate proposal (no implementation)

- **REQUIRED (engine correctness):** gates 1–3 above, with the extent constant
  and the conditioning band chosen and pinned by corpus rows before any
  production route reads `Roff`. Arc×arc stays `NO_GO_TERMINAL_CHORD_ARC_PAIR`
  regardless; transition curves remain deferred work with their own study.
- **OPTIONAL (UX):** surface the classification vocabulary
  (`UNIQUE`/`AMBIGUOUS`/`NONLOCAL`/`COLLAPSE`/`INVERSION`/`NOT_CIRCULAR`) in
  diagnostics so operators see *why* a daylight fell back to chord-offset —
  display only, never a solve path.
- **Diagnostics proposal:** per-joint record `{joinClass, |J−V|, branches,
  Roff, classification}` on the existing diagnostic channel; fail-closed
  fallback keeps today's chord-offset daylight whenever any gate trips.

## What 20L leaves for later

Transition geometry, the extent-constant value, the disambiguation rule, and
any production wiring — each needs its own proposal, pins, and review. This
study supplies the numbers those proposals must satisfy.
