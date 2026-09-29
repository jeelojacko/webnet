# Phase 20F.1 Visual QA — manual screenshot inspection log

Scope: grading-group manager, per-course criteria editor, inline edit panel,
inquiry report, group Properties block, ribbon subgroups — at 1366×768,
1920×1080, 2560×1440. Every PNG below was opened and inspected by the QA
operator. Shell: production build, headless Chromium 153.0.8010.52.

Seed worlds: 2-course open chain (z=10) + 4-course closed square + flat EG
explicit-TIN surface; groups seeded via engine definitions (results never
persist) except flows A/B which create through the live form.

## Defects found and fixed (bounded CSS/layout only)

### V1 — group + criteria tables squeezed instead of scrolling (FIXED)
- Seen in: `1366-distance-current.png`, `1366-criteria-surface.png` (pre-fix).
- Symptom: 12-column group table and 8-column criteria table are `w-full`
  inside a 480px dialog, so headers wrapped to 2–3 lines
  ("Default Criterion", "Tie (min–max)") and metric values wrapped
  ("20.00–20.00 m" over three lines). Values stayed complete — no ellipsis —
  but the rows were hard to scan.
- Fix (no math, no wording, no ordering change):
  `src/cad-app/shell/CadGradingGroupManager.tsx` — group table
  `w-full` → `w-max min-w-full`, single-line headers/cells
  (`whitespace-nowrap` + `pr-2`).
  `src/cad-app/shell/CadGradingGroupCriteriaPanel.tsx` — same treatment for
  the course table (4-way type tags + long effective-criterion strings now
  read on one line; the existing `overflow-auto` wrappers scroll).
- Verified in: `1366-criteria-surface.png`,
  `1366-criteria-distance.png`, `1366-manager-editor.png` (post-fix).

### V2 — flow screenshots taken at 1440×900, not 1366×768 (FIXED, test-only)
- The Playwright config default viewport is 1440×900; flow tests never called
  `setViewportSize`, so files named `1366-*` were 1440 wide (caught by
  reading PNG dimensions).
- Fix: explicit `page.setViewportSize({1366,768})` in all six flow tests
  (plus the a11y test, which already had it). All `1366-*` PNGs re-captured
  at true 1366×768.

### V3 — criteria/inquiry captures showed the create form, not the tab (FIXED, test-only)
- The manager renders create form + table above the tab panels, so captures
  after switching to Course Criteria / Inquiry showed the top of the dialog
  while the asserted content sat below the fold (assertions still passed —
  they read the DOM, not pixels).
- Fix: `scrollIntoViewIfNeeded()` + 300ms settle on the criteria section and
  the inquiry report before every criteria/inquiry capture (11 sites).

### V4 — arc-flyout geometry race (FIXED, test-only)
- The shell auto-dismisses ribbon flyouts on the next state change, so a
  post-open `evaluate` intermittently threw (detached node) and once hung a
  click to the 60s test timeout in full-suite runs.
- Fix: arm a `MutationObserver` BEFORE the caret click, record the flyout's
  first non-zero bounding box, assert containment from the recording.
  Deterministic across three consecutive full-suite runs. No app code touched.

## Per-viewport verdicts (post-fix captures)

### 1366×768 — usable, all controls reachable
- `1366-shell-overview.png`: ribbon single band (120px), manager floats
  right without covering the command input; toolspace/viewport/properties
  all visible.
- `1366-manager-definition.png` / `1366-create-distance.png` /
  `1366-create-elevation.png`: labels left-aligned, selects/inputs aligned
  in the 2-column grid, Method offers Surface/Distance/Elevation.
- `1366-distance-current.png` / `1366-elevation-current.png`: CURRENT rows
  with metrics on one line; table scrolls horizontally inside the dialog.
- `1366-properties-distance.png`: group block reads Name/Method/Distance
  Source/Courses/Side/Target/Default/Override Count/Corner/Max/Status/
  Accuracy/Member rows — long vertex-id lists wrap inside their own rows,
  nothing clipped.
- `1366-criteria-distance.png` / `-elevation` / `-surface` /
  `-surface-cutfill.png`: truthful 4-way tags (Distance/Elevation/
  Surface Fixed/Surface Cut-Fill), Override/Default source column, locked
  family label, no cross-family fields, Apply/Reset buttons in reach
  (dialog scrolls; bottom row sits above the command dock after scroll).
- `1366-edit-analytic-to-surface.png`: target selector appears only after
  the Surface switch, lists the real EG surface.
- `1366-edit-rejected-notice.png`: rejection notice visible above the tabs,
  editor stays open, row still Distance.
- `1366-inquiry-*.png`: CURRENT report with `target <value>` member lines,
  readable at 11px.
- `1366-a11y-focus.png`: Cancel carries a visible white focus ring.
- `1366-a11y-disabled-calculate.png`: Calculate/Extract/Bake honestly dimmed
  for the non-CURRENT surface group; Edit/Inquiry/Course Criteria/Delete stay
  enabled.
- Ribbon `GRADING` + `GRADING GROUPS` subgroups fit; no Cut/Fill mislabel
  anywhere; no clipped button labels.

### 1920×1080 — comfortable, no changes needed
- `1920-shell-overview.png`, `-manager-definition.png`, `-manager-editor.png`,
  `-criteria-distance.png`, `-criteria-surface.png`, `-inquiry.png`,
  `-properties.png`, `-ribbon-flyout.png`: same content as 1366 with room to
  spare; flyout fully on-screen.

### 2560×1440 — comfortable, no changes needed
- `2560-*` set mirrors 1920; viewport canvas dominates, manager + toolspace +
  properties coexist without overlap pressure.

## Intentionally NOT changed (out of scope, recorded for follow-up)
- Manager dialog bottom can sit behind the command dock at 1366 until
  scrolled (shared `ManagerShell` trait, all managers — shell redesign
  territory, not grading layout).
- Cut/Fill composer bare defaults (`2`/`3`) stay `Criterion: invalid` until
  colon-form (`2:1`) is typed — the summary + rejection notice are honest;
  changing defaults would alter shared draft behavior + unit tests.
- `Computing grading group for "X"…` notice persists after success until the
  next action (manager-local notice state, pre-existing pattern).
- Opened drawings read `MANUAL-ONLY — conflicting ownership` in the viewport
  banner (pre-existing session trait, unrelated to grading).

## BEFORE baseline (4c966e4d, `before/`)
- `before-criteria-2way-mislabel.png`: old composer offers cross-family
  `Fixed grade` for a Distance group; Type column mislabels analytic rows as
  `Cut/Fill` (B1/B3 as filed).
- `before-edit-no-selector.png`: old analytic→Surface switch shows Method +
  Criterion with NO target-surface selector (the false-success path).
- Baseline SHA recorded in `phase20f1-browser-qa.md` with the worktree recipe.
