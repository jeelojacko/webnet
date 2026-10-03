# Phase 20L.1 Task 4 — Analytic Circularity Law (evidence)

Study-only, zero `src/` changes. Branch `research/phase20l1-offset-radius-policy-resolution`,
baseline `4e25d803` (PR #146 merge). Resolves the "variable-distance daylight law"
gap 20L left open: replaces station sampling with a proof over the production
formulas. No production route is opened; `exactConstantPlanOffset` is specification
only.

## 0. What must be true for a radius offset

A circular source `C, R` with side normal rotating with the arc admits a concentric
offset `Roff = R + radialSign·d` **iff the plan distance `d` is the same constant at
every station** — a constant along the rotating normal is exactly a concentric arc
(`phase20lOffsetRadiusCore.ts:L189-L224`). Variable `d(station)` has no `Roff`; it is
`OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR` and must not be forced (`offset-radius-architecture.md` §2).
Sampling `d` at N stations proves nothing about the gaps (`phase20lOffsetRadiusAudit.ts:L386-L390`);
only a closed form proves circularity.

## 1. Authority (production formulas, cited)

- Analytic per-station resolve `resolveAnalyticCriterionAt`
  (`src/engine/cad/grading/gradingAnalyticCriterion.ts:L154-L172`):
  `distance d = D` (L86-L99); `relative-elevation d = Δ/g` via
  `resolveRelativeElevationParams` (L45-L60, L117-L146); `elevation d = (E − Zsrc)/g` (L101-L115).
- Arc elevation is exactly linear in arc fraction
  (`gradingCurve.ts:L44-L48`, `z = startZ + (endZ−startZ)·frac`), and each chord
  resolves `d` at both endpoints only (`solveAnalyticGradingChord.ts:L107-L133`).
- Surface termination is a TIN root: clip→zero-locus→nearest-envelope
  (`gradingSpanSolve.ts:L152-L218`); cut/fill branch from target−source sign
  (`gradingCutFill.ts:L22-L25`).
- Shared constant-offset reading `constantAnalyticOffset` (`gradingAnalyticCriterion.ts:L62-L72`).
- Effective per-member criteria / modes (`gradingGroupTermination.ts:L122-L136`).

## 2. Per-family classification

Legend: **A** structurally constant for every valid source; **B** constant only
under an exactly characterizable condition; **C** generally variable; **D**
target-dependent / not provable before solving. Samples are never authority.

| Family (`criterion.kind`) | Class | Exact derivation | Constant iff |
|---|---|---|---|
| Distance | **A** | `d = criterion.distance`, no source term (L86-L99) | always (valid `0<d≤maxSearchDistance`) |
| Relative Elevation | **A** | `d = Δ/g`, criterion scalars only (L45-L60, L117-L146) | always (valid finite `g,Δ`; `d>0`) |
| Elevation | **B** | `d(s) = (E − startZ − gs·s)/g`, `gs=(endZ−startZ)/L` (L101-L115 + curve L74) | `startZ === endZ` **exactly** (then `d=(E−startZ)/g` for any R/sweep). Sloped source → **C** |
| Surface Fixed | **D** | `d` solves `targetZ(q(s)+d·N(s)) = Zsrc(s)+g·d` over the TIN (span solve L152-L218); no closed form from the source rep | only `B` sub-case: persisted target is exactly a **horizontal plane** AND `startZ===endZ`, then `d=(T−z0)/g`; otherwise **C** in-target, **D** generically |
| Surface Cut-Fill | **D** | branch grade switches with `sign(targetZ−Zsrc)` (cut/fill L22-L25) mid-run; `d` is a branch-wise TIN root | never provable from source rep; sampled "constant" (`variable.flat.flat.cut-fill`) is not admitted |
| Mixed analytic-effective | **C** | one `d` per effective member (group resolve); global offset needs a single `d` | only if **every** effective member is A/B and resolves to the **same** `d`; any surface member → **D** |

No tolerance laundering: "nearly flat", "nearly constant" never qualify. A sloped
source whose `gs` is tiny is still **C**; a target that is "almost a plane" is still
**D**.

## 3. `exactConstantPlanOffset` — specification (not implemented in `src/`)

Pure classifier over the **resolved** source member + **effective** criterion.
Study-executable since Task 7 as `scripts/phase20l1EffectiveCriterion.ts`
(thin wrapper over the production `resolveAnalyticCriterionAt` +
exact flat/Roff gates; wired nowhere, zero `src/` changes) — every corpus
`d` is resolved through it, and flat/sloped (1-ULP boundary),
invalid/degenerate, `Roff===0`/`<0`, and mixed-effective cases are pinned
by the circularity test suite.

Inputs: `criterion: GradingCriterion` (post-override effective value); `source`
(a single resolved arc: finite `centerX/Y, radius>0, startAngle, endAngle, sweepCCW,
startZ, endZ, length`); `side: GradingSide`; `maxSearchDistance: number`.

```
type ConstantPlanOffset =
  | { proven: true; d: number; radialSign: 1|-1; radiusOffset: number;
      reason: 'DISTANCE' | 'RELATIVE_ELEVATION' | 'ELEVATION_FLAT_SOURCE' }
  | { proven: false; reason: NotProven }
```

Proof branch (exact comparisons only):
1. `kind==='distance'` → `d = distance`; require finite, `d > 0`, `d <= maxSearchDistance`.
2. `kind==='relative-elevation'` → `resolveRelativeElevationParams(g,Δ).ok`; `d = Δ/g`;
   same bounds. (Never re-derive; this is the one relative-elevation authority.)
3. `kind==='elevation'` → require `source.startZ === source.endZ` (`===`, no epsilon);
   `d = (E − startZ)/g`; same bounds.
4. Radial sign, exact: `t = traversalTangentAt(sweepCCW, startAngle)`;
   `n = gradingSideNormal(t, side)`; `dot = n·(cos startAngle, sin startAngle)`;
   `radialSign = dot > 0 ? +1 : −1` (sign only — the `|dot|≈1` guard is a
   unit-normal representation precondition, never a physical tolerance).
   `radiusOffset = R + radialSign·d`; require `radiusOffset > 0`
   (`===0` collapse, `<0` inverted).

`NotProven` reasons (each carries a failing gate, never a fallback constant):
- `ELEVATION_SLOPED_SOURCE` — `elevation` with `startZ !== endZ` (d linear, class C).
- `SURFACE_TARGET` — `fixed` / `cut-fill`: TIN root, branch-switching (class D).
- `MIXED_EFFECTIVE` — effective criteria differ or resolve to differing `d` (class C/D).
- `INVALID_CRITERION` — non-finite `g/E/Δ`, machine-zero grade, `d<=0`, `d>maxSearchDistance`, wrong direction.
- `DEGENERATE_SOURCE` — not one arc (ellipse/unknown fail-closed) or non-finite geometry.
- `RADIUS` — `radiusOffset <= 0` after the exact sign.

## 4. P0 admission and coverage

**Admitted constant-distance families (P0):** `distance` (A, any arc), `relative-elevation`
(A, any arc), `elevation` **only** on an exactly flat source (`startZ===endZ`, B).
All three are provable from the source rep + criterion alone.

**Stays on the chord path:** surface `fixed`, surface `cut-fill`, hybrid groups,
mixed-analytic chains (unless every member is provably the same constant `d`), and
`elevation` on any sloped source. Non-arc curves fail closed.

**Coverage implication.** The audit's 30-row variable matrix
(`docs/evidence/phase20l/offset-radius-corpus.json`) splits 17 sampled-constant / 13
variable — but sampling is a lower bound. The analytic law proves exactly **15/30**
constant: 6 `distance` + 6 `relative-elevation` + 3 flat-source `elevation`. The other
2 sampled-constant rows (`variable.flat.flat` fixed & cut-fill) are **not** admitted:
their constancy needs the *target* rep, not the source rep, so they remain target
roots. Concretely, the standard site-grading workflow — grade **to a TIN surface**
(fixed, cut/fill) — is precisely the case the circular offset cannot cover; the
radius route only reaches curved sources graded by a target-free distance or
relative-elevation, plus the degenerate flat-source elevation. So relaxing circularity
from "sampled constant" to "proven constant" *reduces* admission and leaves the
primary product workflow on chord-offset daylight.

## 5. Out of scope (unchanged)

The transition-less surface↔analytic problem is **not** solved here: no spiral/
transition geometry, no surface+analytic joint law, and no arc×arc corner join
(arc×arc stays `NO_GO_TERMINAL_CHORD_ARC_PAIR`). This task classifies the plan
distance law of a **single** curved member only; the extent constant, ambiguity
rule, outside-corner extension, and any production wiring remain the other 20L.1
tasks' (deferred) work.
