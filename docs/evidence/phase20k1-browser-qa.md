# Phase 20K.1 curved-seam browser QA (Wave D2)

Status: **RUN — 4/4 green, 0 page / 0 console / 0 unhandled errors.**
Branch `fix/phase20k1-curved-grading-seam-topology`, HEAD `df0589fe`
(Wave D1 performance + evidence). Playwright 1.60.0 bundled Chromium,
headless, bounded **1366×768**. Spec:
`tests-browser/cad-grading-curved-20k1.spec.ts` (repo dash convention;
the D1 placeholder named a wider A–E set — Wave D2 scope is the four
flows below). Command:
`npx playwright test tests-browser/cad-grading-curved-20k1.spec.ts --reporter=list`.
Duration ~7 s (Vite dev server reused). No screenshots: no UI text
changed in this wave (product-validation only), so no pixel inspection
was required.

## Fixture geometry (production resolve path)

Phase 20K outward rounded square: closed Feature Line, 4 genuine arc
courses, chord 100, R = 252.5 (exact `bulge = 0.1`), Z = 10. Members are
resolved from `segmentGeometry` arc bulges through `resolveGroupInputs`
(not from pre-resolved sources), so the browser exercises the shipped
persistence → resolve → worker path. Flat `Z = 0` target TIN is rebuilt
through the shipped Surface manager only for the hybrid flows.

## Flows

| flow | fixture | asserts | result |
|---|---|---|---|
| A valid curved all-Distance analytic group | closed 4-arc, all-Distance, target-free | Unbuilt (Not applicable, `4 (closed)`) → Calculate → Building dispatch notice → Current; row area `9452.1`, tri `128`, tie `20.00–20.01 m`; inquiry `Termination: Distance`, `Areas: plan 9452.125 / 3D 10567.797`, `Members: 4 · corners: 4`, `#0 GAP · miter 24.417 m`; Extract +1 feature line → one Undo −1 (Current retained); Bake +1 surface → one Undo −1 | **PASS** |
| B save/reopen | closed 4-arc all-Distance | Save Drawing → reopen → method `Distance`, `4 (closed)`, Unbuilt, area `--`, no Current; Calculate → Current, area `9452.1`, tri `128`, `Members: 4 · corners: 4`, no `Failure:` | **PASS** |
| C arc×arc hybrid FAILED, no products | closed 4-arc hybrid (Surface override on course 0, flat target) | rebuild Flat → Calculate → Failed, never Current; Extract + Bake disabled; inquiry `No CURRENT result…`; Design workflow `Build Design Patch` disabled; row count, entity count and surface count unchanged (zero partial mutation) | **PASS** |
| D arc×arc freeze diagnostic | same arc×arc hybrid | notice `Calculate failed — CORNER_NO_SOLUTION (corner 0): GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED.`; row `Failed — CORNER_NO_SOLUTION`, method `Hybrid`, never Current; recalculate → byte-stable notice text | **PASS** |

Frozen actuals (probe + in-run): plan `9452.124826335094`, 3D
`10567.796821749318`, 128 points / 128 triangles, 4 `GAP` corners
(miter 24.41742021679842), diagnostics `[CURVE_CORNER_APPROXIMATED]`,
group topology `ok: 1 component / 2 boundary loops`.

## Error counts

| viewport | page errors | console errors | unhandled rejections |
|---|---|---|---|
| 1366×768 | 0 | 0 | 0 |

Every flow asserts its own zero ledger at teardown (pageerror,
`console.error`, `unhandledrejection`). No engine/`src/` change was made
in Wave D2.

## Honest notes

- `BUILDING` is a transient worker status; the spec pins the
  operator-visible dispatch notice (`Computing grading group …`) that is
  set synchronously on the click, then awaits `CURRENT`. No racy wait on
  the interim row status.
- Flow C/D use the same arc×arc hybrid fixture: C validates the
  fail-closed products/zero-mutation gate, D validates the exact bounded
  diagnostic and its stability. The arc×arc hybrid is the mission's
  "unsupported fixture" and is a corner-solve failure (not a mesh
  topology failure); the shipped `GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`
  freeze is the honest terminal state.
