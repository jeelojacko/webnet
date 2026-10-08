# CAD Best Fit E1 — Worker C validation (commands/session/ribbon/icons/COGO/browser)

Scope: `BEST_FIT_LINE` / `BEST_FIT_ARC` / `BEST_FIT_PARABOLA` engine
transactions, `BESTFITLINE` / `BESTFITARC` / `BESTFITPARABOLA` sessions
(+ `BFL` / `BFA` / `BFP` aliases), ribbon family activation, curated
icons, COGO residual reports, browser flows A–G. Worker A numerics and
Worker B entity semantics are reused untouched.

## 1. Focused suites

| Suite | Tests | Result |
|---|---|---|
| `tests/cad_best_fit_commands_c1.test.ts` (atomic 1+1, undo/redo, layer, provenance snapshot, source-point gating, report rows=tables=sample count, failure-zero-mutation ×3) | 19 | pass |
| `tests/cad_best_fit_sessions_c1.test.tsx` (new: registry/aliases/gates, collection, typed, attribution, duplicates, U, min-gate, commit+report-forward, failure-stays, canFinish, prompt, preseed, preview, dock suppression) | 21 | pass |
| `tests/cad_best_fit_line.test.ts` (Worker A, untouched) | 10 | pass |
| `tests/cad_best_fit_arc.test.ts` (Worker A, untouched) | 9 | pass |
| `tests/cad_best_fit_parabola.test.ts` (Worker A, untouched) | 14 | pass |
| `tests/cad_parabola_entity_b1.test.ts` (Worker B, untouched) | 25 | pass |
| Circle / shapes / shell / dock neighbors (sessions, construction, consumers, transactions, panels, registry, dock) | 252 | pass |
| Polyline C3 command neighbors | 23 | pass |
| Ribbon families + controls + icon manifest + shell registry | 64 | pass |

Total focused: 75 new Worker C tests + 363 neighboring assertions green,
zero Worker A/B semantic changes.

## 2. Typecheck / build

- `npx tsc --noEmit`: clean.
- `npm run build`: clean (~10 s), production bundle used for browser QA.

## 3. Agent tier

`npm run test:agent`: **9265 pass + 1 skipped, 3 failed** — the 3 failures
are the pre-existing study-desktop real-data calibration trio, proven
identical on the pristine baseline via a controlled stash run (unrelated to
Best Fit: zero phase refs, gitignored real-data corpus).

## 4. Browser QA

`tests-browser/cad-draw-best-fit-e1.spec.ts`, production build, headless
Chromium: **7/7 flows pass, zero page/console/unhandled errors**
(see `browser-qa.md`; PNGs + `geometry.json` in this directory).

## 5. Honest coverage updates (no silent loosening)

- `tests/cad_ribbon_tool_families.test.ts`: the `keeps Best Fit / Ellipse /
  Hatch as honest planned rows` test now covers Ellipse/Hatch only; a new
  test pins all three Best Fit rows live with real command keys.
- `tests/cad_ribbon_controls.test.tsx`: the two planned-row contracts now
  use the all-planned Ellipse family (Best Fit is live and can no longer
  serve as the planned example).
- `tests/cad_ribbon_icon_manifest.test.tsx`: new `pins every Best Fit
  variant to its curated icon` test (icon + file + live key per row).

## 6. Explicit E1 deferrals (not regressions)

- Full-circle arc fits stay refused (Worker A 1-degree gap law, matching the
  existing arc-builder precedent); use CIRCLE for closed geometry.
- No `BESTFIT` combined key and no `PEDIT`-style editor; one command per
  geometry kind.
- Best-fit outputs are snapshots: no live dependency on the sampled
  sources, no re-fit on source move, no Z handling (plan only).
- Parabola TRIM/EXTEND/FILLET refusal, block exclusion, DXF
  chord-approximation, and LandXML omission are inherited unchanged from
  Worker B.
- No command repeat, no right-click finish, no multi-region or
  surface-draped fitting.
- Browser QA covers one viewport resolution (1366×768 headless); ribbon
  collapse behavior at narrow widths is unchanged generic chrome.
