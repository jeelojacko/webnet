# Phase 20Q.1 Wave L — browser QA (sloped-source transitions, S1)

Scope: production-build Chromium QA for singular joint-continuous sloped
transition intents (all 3 analytic families) through the real `/cad` shell.
Spec: `tests-browser/cad-grading-transition-20q1.spec.ts` (398 lines,
3 tests, 10 flows). No `src/` changes in this wave.

## Run record

- Command: `npx playwright test --config=playwright.prod.config.ts
  tests-browser/cad-grading-transition-20q1.spec.ts`
- Date: 2026-10-05. Headless Chromium, fresh `npm run build` + `vite
  preview` (prod config, port 4175), viewport 1366×768.
- Result: **3/3 green in 17.7 s, 0 page errors, 0 console errors**
  (every test asserts its collected error list is empty).
- Static gates on the spec: `tsc --noEmit` clean, `eslint` clean,
  `prettier --check` clean.

## Flows

| # | Flow | Result | PNG |
|---|------|--------|-----|
| 1 | Distance sloped singular (8→10→12) staged → Calculate → CURRENT; Transition tab still lists `joint:0` / 8 m | PASS | `flow-A-current.png` |
| 2 | Relative-elevation sloped singular → CURRENT | PASS | `flow-B-current.png` |
| 3 | Elevation sloped singular → CURRENT | PASS | `flow-C-current.png` |
| 4 | CREST (8→10→8) + SAG (12→10→12), plan-collinear → both CURRENT | PASS | `flow-4-crest-current.png`, `flow-4-sag-current.png` |
| 5 | Save Drawing → reopen: intent (`joint:0`, 8 m) persists, recalc → CURRENT | PASS | `flow-5-save-reopen-current.png` |
| 6 | FLRAISELOWER +1 m on the source line: row leaves Current (old result invalidated) → recalc → CURRENT, never Failed | PASS | `flow-6-raised-rebuilt-current.png` |
| 7 | 2 m Z jump in a 1 mm course (sanitize tol 1e-9 passes; width ceiling 2 mm ≪ 8 m): Calculate → Failed, never Current; `Calculate failed` notice; Extract/Bake disabled | PASS | `flow-7-step-failed.png` |
| 8 | Second sloped joint: option text carries the bounded refusal (`singular sloped only`), Add disabled; file with two sloped intents → whole group Failed, products disabled, no partial CURRENT | PASS | `flow-8-second-refused-ui.png`, `flow-8-double-failed.png` |
| 9 | All-flat sparse pair (transitions at joint:0 + joint:2, gap at joint:1) → CURRENT (20P.1 behavior intact) | PASS | `flow-9-flat-sparse-current.png` |
| 10 | Sloped CURRENT: Extract disabled→enabled→+1 entity→Undo restores; Bake disabled→enabled→+1 surface→Undo restores; row stays Current | PASS | `flow-10-products.png` |

`geometry.json` records viewport/manager boxes per shot (1366×768;
manager ~480×276, no overlap anomalies vs. the 20F layout pins).

## Notes (non-blocking, pre-existing, out of scope)

- A literal zero-plan-length course never reaches the worker: the file
  sanitize rejects it (`ZERO_PLAN_LENGTH_COURSE` — "callers must
  drop/merge the vertex explicitly"). Flow 7 therefore uses the closest
  producible step shape: a 1 mm course carrying the 2 m jump.
- The 12 PNGs are re-exported captures that collapse the manager's CREATE
  form and frame the status/notices instead. The CREATE form (Side=Right,
  Method=Surface, Max search 20 m, Chord 0.1 m — local `useState` defaults
  in `CadGradingGroupManager.tsx`) is therefore not shown and does not
  reflect the seeded groups (all assertions read the row table, notices, and
  control disabled states). Spec still 3/3 with 0 page/console errors.
- Stash count verified 14 before and after the run; no stash touched.
