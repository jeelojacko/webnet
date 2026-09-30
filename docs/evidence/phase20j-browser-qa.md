# Phase 20J — hybrid grading browser QA

Status: RUN — 11/11 green, 0 page / 0 console / 0 unhandled errors.
Branch `feat/cad-grading-hybrid-exact-common-tie`, HEAD `71eae6dd`,
bundle `dist/assets/CadApp-DIj_MNGP.js` (built 11.2 s).
Chromium 151.0.7922.34 / Playwright 1.60.0, production build,
headless. Spec: `tests-browser/cad-grading-hybrid-20j.spec.ts`.
Command: `npx playwright test tests-browser/cad-grading-hybrid-20j.spec.ts --reporter=list`.
Duration: ~20 s. Screenshots: 12 PNGs under `docs/evidence/phase20j/`
(+ `geometry.json`).

## Seeding rules (product contracts, not test conveniences)

- Target-free hybrid groups are never seeded from file: persistence
  drops them fail-closed (verified: a target-free hybrid seed renders no
  group row). Flow A seeds an analytic group and attaches the target
  through the shipped criteria panel.
- Seeded surfaces read non-CURRENT until rebuilt through the shipped
  Surface manager (20F.1 honest-disabled pattern): every flow rebuilds
  Flat before Calculate. Calculate stays disabled until the target is
  CURRENT — the gate, not a hurdle.

## Flows

| flow | tests | asserts |
|---|---|---|
| A hybrid target gate + undo/redo @ 1366/1920/2560 | 3 | Distance seed, 4-method composer with no lock, Surface edit rejected without a CURRENT target (zero mutation), atomic attach (override + target, one Undo), undo → Distance/Not applicable, redo → Hybrid/Flat, Calculate enabled, shell regression, editor PNG |
| B hybrid CURRENT square @ 1366/1920/2560 | 3 | Hybrid row, CURRENT, Flat, 20.00–20.00 m, plan 9600.0, shell regression, current PNG; at 1366 also inquiry (Termination Hybrid · Methods Surface + Distance + Elevation + Relative Elevation, Target Flat, plan 9600.000, 4× miter 28.284, Grading Boundary) + CSV (Termination/Methods/Target/Plan Area/Grading Boundary columns) + inquiry PNG |
| C hybrid products + undo @ 1366 | 1 | Extract +1 FL / undo −1 (CURRENT retained), Bake +1 surface with `HybridPad - Baked` node, DesignPatch via the Design workflow panel +1 surface / undo / undo, products PNG |
| D hybrid mismatch FAILED @ 1366/1920/2560 | 3 | Δ=−12 on the Distance course → Failed, method stays Hybrid, CORNER_NO_SOLUTION / TRANSITION_REQUIRED, never Current, Extract + Bake disabled, diagnostic stable across recalcs, shell regression, failed PNG |
| E hybrid persistence + target clear @ 1366 | 1 | UNBUILT Hybrid seed with one Surface override, save/reopen → UNBUILT + Hybrid + Override/Surface Fixed, rebuild, CURRENT, reset last Surface override → Not applicable (target cleared atomically), one Undo restores Flat |

## Honest corrections found by the runs (all fixed in-spec)

- A target-free hybrid file seed renders no row (fail-closed persistence) → Flow A builds hybrid through the UI.
- The criteria target picker defaults to the first CURRENT surface, so the rejection demo needs a not-yet-rebuilt surface → Flow A asserts the live gate before rebuilding.
- Course checkboxes are 1-based (`Course N` = index N−1).
- Overriding course index 0 (Surface-riding) with an analytic kind silently converts the group to analytic; the hybrid mismatch must target the analytic course (index 1) → Flow D selects Course 2.
- The Design workflow group option reads `Name (status)` → Flow C selects by index.
- A single-course group can never be hybrid (the override IS the effective set) → Flow E uses two courses.

## Shell regression (folded into A/B/D per viewport)

Ribbon ≤ 130 px, one band, groups nowrap + auto/scroll overflow,
manager table auto/scroll overflow, one Properties palette, one command
input, no page overflow, viewport > 300 px with a live model. All
asserted in-run at all three viewports; no clipping or no-op actions
observed (Calculate/Extract/Bake/patch all mutate and undo cleanly).

## Addendum — 2026-09-30 (Phase 20J merge + Phase 20J.1)

- Original run recorded above at HEAD `71eae6dd`.
- Final PR #139 head: `74629c40c7b017b2abb664bb7dbc152cc48d1ab1`; merge
  `ffa89282c8e15e41ab959726b9ab3bc4415422aa` (base
  `6842723c935ffdbe1461225f0ef97b7ccbceee52`). Final-head CI run 36749390984,
  merge-push CI run 36750134664.
- Final-head reruns: 11/11 green, 0 page / 0 console / 0 unhandled errors on
  the merged head.
- Phase 20J.1 (persistence + tie-tolerance, branch
  `fix/phase20j1-hybrid-persistence-tolerance`, baseline `ffa89282`) makes no
  browser-visible changes in scope; browser regression result: TBD (no
  screenshots changed).
- Phase 20J.1 correction PR/head: TBD.
