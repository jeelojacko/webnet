# Phase 20L.2 offset-radius production — validation

## Suites (6 files, 90/90 green)

- `cad_grading_exact_offset_baseline_20l2` — 16-fixture chord-path pins,
  byte-identical vs committed `baseline-fallback.json`.
- `cad_grading_exact_offset_policy/geometry/builder_20l2` — route gates,
  Roff law, oracle joins, sagitta contract, tol-change J-invariance.
- `cad_grading_exact_offset_worker_20l2` (9) — production worker path,
  clone round-trip, unrelaxed capabilities, 6 §15 fallback pins.
- `cad_grading_exact_offset_robust_20l2` (39, new) — §16/§17 below.

## §16 robustness matrix (all via production entry points, shared
authorities only, no new epsilon)

Exact routes A1 (line→arc) + B (line→arc→line), DIST d=5 left unless noted:

| transform | classification | J | support/stats |
|---|---|---|---|
| origin | exact | oracle (builder suite) | Roff + d-stats |
| E/N ~1e6, ~1e8 | exact | rigid-carry ≤ `coordinateAgreementTol` | agree |
| rot 37°, rot37+1e6 | exact | rigid-carry | agree |
| similarity ×0.5 (d=2.5, ms=50) | exact | J scales by s | agree |
| similarity ×2 (d=10, ms=200) | exact | J scales by s | agree |
| fixed-d scale ×1.5 | exact | n/a (Roff itself changes) | agree |
| mirror-x, mirror-x+1e6 (side right) | exact | mirrored J | Roff=R+d |
| fixed-d scale ×0.5 (origin + 1e6) | bounded `FALLBACK_AMBIGUITY_B0` | — (R/d bound pinned) | — |
| CW/CCW complement (major arc, same endpoints) | exact-or-fallback, never aliases the CW join (>1e-6) | — | — |

Fallback representatives (sloped, arc-pair, Roff inversion, over-search,
tight small-R): identical bounded reason at origin and E/N~1e6, identical
chord-path ok/fail outcome.

maxSearch boundaries (A1, d=5, |J-V|≈6.912): `ms=|J-V|` exact;
`ms×(1−1e-9)` fallback; `ms=d=5` bounded `FALLBACK_EXTENT_E1` (the gate
covers the JOIN extent, not just d); `ms=d−1e-9` bounded
`FALLBACK_INVALID_CRITERION` (criterion refuses `d>ms` first).

## §17 tolerance evidence (tols 0.1 / 0.01 / 0.001)

Fixtures (all admitted exact): outward R50/R200 × 90°/shallow,
inward R200 × 90°/shallow, similarity-small R25, translated R50-90@1e6.

- Route decision independent of tessellation: exact at every tol.
- J bitwise-invariant across tol changes (analytic, never tessellated).
- Every daylight arc sample rides Roff (shared-authority agreement);
  worst neighbour-sagitta ≤ tol on every row.
- Mesh area converges with shrinking successive differences
  (|a₃−a₂| ≤ |a₂−a₁|); sample count non-decreasing as tol tightens;
  same-tol rerun bitwise-identical.
- Tight curves (small-R outward, R50-inward) stay tol-independent
  bounded ambiguity fallbacks — tessellation never aliases the decision.
- Accuracy is `CURVE_APPROXIMATED` on every row: the polygon mesh is a
  tessellation under tol, never the exact curved surface.

## Browser QA (real Chromium, production build, 4/4 green, 0 errors)

`tests-browser/cad-grading-exact-offset-20l2.spec.ts`
(`playwright.prod.config.ts`, Chromium/Playwright 1.60.0):

- A (1366 + 1920): flat line→arc→line, Calculate → Current,
  `Curve Approximated` WITHOUT `(corner)`; inquiry
  `min 5.000 / max 5.000 / mean 5.000`, triangles 84 — matches the engine
  contract. Daylight meets corners with no chord-miter kink (daylight
  rides Roff, robust suite).
- B (1366): arc-pair line→arc→arc, Calculate → Current WITH
  `(corner)` — chord fallback, existing behavior.
- C (1366): maxSearch 4 < d=5 → honest FAILED, Extract/Bake disabled,
  inquiry names the failure, no result shown.
- Zero page/console/unhandled errors on all flows (`errors` array
  asserted empty). Frames in `phase20l2-visual-qa.md`.

## Gates

- `test:agent` cad_grading group + worker suites: see completion run below.
- typecheck / lint / build / `check:portable-paths`: see completion run.
- Stashes: 14/14 untouched (this worker creates none, modifies none).
- Engine modules untouched except tests/docs/specs (no `src/engine/`
  production edits by this worker).
