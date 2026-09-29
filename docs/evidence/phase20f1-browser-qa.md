# Phase 20F.1 Browser QA — real-Chromium grading-UI closeout

## Environment
- Branch `fix/phase20f1-grading-ui-closeout` @ `23d56e57` (Worker A `8e24970d` + Worker B).
- Chromium **153.0.8010.52** (Arch Linux), headless, production build:
  `npm run build` (clean, ~11s) served by `vite preview` on 127.0.0.1:4174.
- Harness: repo Playwright config (`tests-browser/`, workers:1), no new
  framework. Spec: `tests-browser/cad-grading-20f1-qa.spec.ts` (10 tests) +
  `tests-browser/cad-grading-before.spec.ts` (1 test, env-gated manual run).
- Viewports: 1366×768, 1920×1080, 2560×1440.

## Workflows executed (all through the live /cad shell, zero mocks)
| Flow | What was driven | Result |
|------|-----------------|--------|
| A | Distance create (form defaults −2%, 20m) → Calculate → CURRENT Exact → Properties (Distance) → Inquiry (`target 20`) → edit distance 20→15 → recalc (ties 15.00–15.00m) | PASS |
| B | Elevation create (target 9.8) → Calculate → CURRENT → Properties (Elevation) → Inquiry (`9.8`) → ties 10.00–10.00m | PASS |
| C | Distance+override group → reset override → Edit Criteria → Surface: target selector appears, EG chosen, grade 50% → `Criteria updated`, row method Surface → Calculate CURRENT | PASS |
| D | Surface+override group → reset override → edit to Distance → commits, `Overrides: 0`, recalc CURRENT | PASS |
| E | Distance group: locked composer (no method selector), override both courses to 25m → `2 courses overridden`, Type `Distance`, Inquiry `target 25`, CSV download carries `Target Value` header + `25` | PASS |
| F | Elevation group: locked composer, override both courses to 9.5 → Type `Elevation`, Inquiry `target 9.5` | PASS |
| G | Surface group: composer offers `Fixed grade` + `Cut / Fill` only (no method/distance/elevation fields), rows read `Surface Fixed`, legacy rows all `Default`; cut-fill override (`2:1`/`3:1`) labels `Surface Cut/Fill` | PASS |
| H | Distance+override group → switch to Surface → rejected: `one termination family per group…`, editor stays open, row still `distance` | PASS |

Stability: full suite **10/10 passed on three consecutive runs** (~21–27s each).

## Error counts
- Page errors (uncaught exceptions): **0** in all 11 tests.
- Console errors: **0** in all 11 tests.
- Every test funnels `pageerror` + `console error` into an array and ends
  with `expect(errors).toEqual([])`.
- BEFORE baseline run: 0 page / 0 console errors.

## Screenshot inventory (45 PNGs under `docs/evidence/phase20f1/`)
- 1366×768 (27): manager-blank, create-distance, create-elevation,
  distance-current, elevation-current, properties-distance, properties,
  inquiry-distance, inquiry-elevation, inquiry-distance-override,
  inquiry-elevation-override, inquiry, criteria-distance,
  criteria-elevation, criteria-surface, criteria-surface-cutfill,
  edit-analytic-to-surface, edit-rejected-notice,
  surface-after-analytic-switch, distance-after-surface-switch,
  shell-overview, manager-definition, manager-editor, ribbon-flyout,
  a11y-focus, a11y-criteria, a11y-disabled-calculate.
- 1920×1080 (8): shell-overview, manager-definition, manager-editor,
  criteria-distance, criteria-surface, inquiry, properties, ribbon-flyout.
- 2560×1440 (8): same set as 1920.
- `before/` (2): before-criteria-2way-mislabel, before-edit-no-selector.

## Visual defects + fixes
See `phase20f1-visual-qa.md` (every PNG manually inspected). Fixed, all
bounded CSS/layout or test-only, no grading math, no shell redesign:
1. Group + criteria tables squeezed/wrapped in the 480px dialog → one-line
   cells + horizontal scroll (`CadGradingGroupManager.tsx`,
   `CadGradingGroupCriteriaPanel.tsx` — the only app-code change).
2. Flow captures ran at 1440×900 despite `1366-*` names (config default) →
   explicit 1366×768 pins, all re-captured.
3. Criteria/inquiry captures showed the create form (content below fold) →
   scroll-into-view before capture.
4. Ribbon-flyout auto-dismiss race → MutationObserver geometry recording,
   green on three straight full-suite runs.

## Phase 21 shell regression (all three viewports, measured in-page)
- Ribbon height **120px** (≤130) at 1366/1920/2560; strip `nowrap`.
- `document.scrollWidth/Height` == viewport size (no page scrollbars;
  intended horizontal overflow only inside the table/dialog scrollers).
- Exactly **1** `[data-cad-properties]` and **1** `[data-cad-command-input]`.
- `[data-cad-viewport]` visible everywhere, no paint-seam anomaly in captures.
- Arc flyout box (302×260 @ x=222.9, y=167) fully inside the viewport at all
  three sizes (recorded geometry, not pixels — the shell dismisses flyouts
  on the next state change).

## Accessibility
- All manager inputs/selects/buttons expose accessible names (evaluated, zero
  unnamed).
- Keyboard walk from the edit panel: Grading method → Grade input method →
  Grade magnitude → Grade direction → Target distance → Apply Criteria →
  Cancel (logged `TAB ORDER`; Apply/Cancel both reachable by Tab, Enter
  activates, Space toggles course checkboxes).
- Visible focus: white ring on the focused Cancel (`1366-a11y-focus.png`).
- Rejection/override notices use `role="status"` (asserted).
- Honest disabled states: Calculate/Extract/Bake dimmed (`disabled` attr)
  for the non-CURRENT surface group while Edit/Inquiry/Course
  Criteria/Delete stay enabled (`1366-a11y-disabled-calculate.png`).

## BEFORE baseline (4c966e4d)
- Baseline SHA: `4c966e4d` (merge of the Distance/Elevation feature, parent of
  Worker A/B). Captured via `git worktree` + worktree dev server.
- Production build at 4c966e4d **fails in this environment**
  (`@tauri-apps/api/*` absent from that commit's deps — Rollup resolution
  error); dev server needed a local `@tauri-apps/api` stub because that
  era's vite resolves the `@vite-ignore` dynamic imports at transform time.
  Recipe: `git worktree add /tmp/webnet-before 4c966e4d`, own
  `npm install`, stub package, `vite --port 4176`,
  `WEBNET_BEFORE_BASE=http://127.0.0.1:4176 npx playwright test
  tests-browser/cad-grading-before.spec.ts`.
- Defects visible in `before/`: cross-family `Fixed grade` composer on a
  Distance group + `Cut/Fill` type tags on analytic rows; Surface switch
  with no target selector.

## Restrictions / known behaviors (NOT changed — out of scope)
- Engine truthfulness verified, not altered: an asymmetric 90°-corner
  override (course 1 → 25m, course 2 → 20m) fails in the worker with
  `CORNER_NO_SOLUTION … GRADING_ANALYTIC_CORNER_Z`; the row honestly keeps
  `Needs Recalc (stale)`. Same-revision worker failures on a stale group do
  not flip the row to FAILED (FAILED surfaces only for UNBUILT groups) —
  pre-existing status-derivation behavior, all flows use solvable symmetric
  scenarios (15m default edit; both-course overrides).
- Cut/Fill composer bare defaults (`2`/`3`) stay `Criterion: invalid` until
  `nH:1V` colon form is typed; summary + rejection are truthful.
- Dock chrome (toolspace tree, Properties block) refreshes worker results on
  the next session interaction: proven live (manager `Current` vs tree
  `Unbuilt` immediately after calc; tree flips to `Current` after select-all).
  Pre-existing 20C session-silent calc architecture; the 20F.1 surfaces
  (manager/inquiry/CSV) are live.
- Surface-family Calculate requires a CURRENT target: the seeded EG is
  rebuilt through the shipped Surface manager (20B pattern) inside the
  G/H/C/D/viewport tests; without it Calculate is honestly disabled.
- `Computing grading group for "X"…` notice persists after success until the
  next manager action (pre-existing local-notice pattern).
- Results never persist (seeded definitions only); CSV asserted via the
  download event (`Target Value` + value present).
