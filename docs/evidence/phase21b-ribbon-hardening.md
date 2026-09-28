# Phase 21B §§9-13 — ribbon hardening evidence

Branch: `feat/cad-shell-closeout-civil-icons` (base `origin/main` 0407a4d).
Scope: ribbon height gate, vertical-overflow decision, flyout viewport
hardening, real-path sticky-face (New/Open) browser coverage, collapse-helper
documentation, Survey tab label casing. Icons/manifest/parcel/tool-family
logic untouched.

## 1. Ribbon height gate (before → after)

`tests-browser/cad-shell-compact-ribbon-21a.spec.ts::assertSingleRibbonBand`
previously allowed `ribbonH <= 170`, `groupsH <= 110`, `scrollHeight <= clientHeight + 2`.
Now it asserts the CSS contract (`max-height: 128px`) plus a small tolerance,
one band, nowrap, and no vertical overflow, and the sweep asserts the drawing
viewport is not reduced.

| Resolution | ribbon before/after | groups before/after | viewport |
|------------|---------------------|---------------------|----------|
| 1366x768   | 120 → 120           | 93 → 93             | 345      |
| 1920x1080  | 120 → 120           | 93 → 93             | 657      |
| 2560x1440  | 120 → 120           | 93 → 93             | 1017     |

New assertions: `ribbonH <= 130`, `groupsH <= 104`,
`scrollHeight <= clientHeight + 1`, `flexWrap === 'nowrap'`,
`overflowY === 'hidden'`, exactly one `.cad-shell-ribbon-groups`, and the
viewport height equals the recorded baseline ±2px. All three resolutions pass.

## 2. Vertical overflow decision

`.cad-shell-ribbon-groups` changed `overflow-y: auto` → `overflow-y: hidden`.
Open family flyouts paint `position: fixed` at a caret-computed viewport
anchor (Phase 21A fix), so the strip's vertical clip cannot hide them. This is
proven by browser QA, not assumed: after the change the 21B flyout spec opens
Arc/Line/Curves flyouts and asserts each has a non-empty box fully inside the
viewport at 1366x768, 1920x1080, and 2560x1440, plus keyboard/Escape focus
restore, outside-click close, and scroll/resize close. The Line flyout
(17 rows) exceeds the 260px cap and scrolls internally
(`scrollHeight > clientHeight`) with no document-level overflow. A far-right
(`hatch`) caret clipped by the strip still anchors on-screen.

Keeping `auto` was rejected: with `hidden` the band can never grow a vertical
scrollbar or wrap; the fixed flyout is unaffected. The horizontal access path
is preserved: the spec sets `scrollLeft` and asserts it moves whenever
`scrollWidth > clientWidth`.

## 3. Flyout hardening

- New `src/cad-app/shell/cadRibbonFlyout.constants.ts` is the single source of
  truth for the box (`352px`/`260px`, matching `cadShell.css` max-width
  `22rem`/max-height `260px`) plus viewport margin (`8px`) and caret gap
  (`2px`).
- `CadRibbonSplitButton.openMenu` no longer uses magic `368`/`268`: it clamps
  left with `viewportWidth - maxWidth - margin`, picks the side with more room,
  and caps `maxHeight` to `min(260, available space)`.
- `CadRibbonFlyout` receives `{ top, left, maxHeight }` and applies the
  viewport-capped inline `max-height`; internal `overflow-y: auto` unchanged.
- Caret anchor, keyboard navigation, focus restore, outside-click close, and
  scroll/resize-close behavior preserved (unit suite 23/23 plus the new
  browser assertions).

No portal was introduced.

## 4. Real-path New/Open reset coverage

New `tests-browser/cad-shell-ribbon-hardening-21b.spec.ts` drives the shipped
shell: arc flyout pick sticks; quick-access **Save** does not reset;
ribbon collapse/restore does not reset; a typed dock `ARC_SCA` starts but does
not move the sticky face; **New Drawing** resets to Arc 3-Point; model-tab
**Open** resets; sheet-tab **Open** resets. 4/4 pass (lifecycle @ 1366x768 +
flyout hardening @ 3 resolutions), zero page/console errors.

## 5. Collapse-helper cleanup

`collapseFloatingPanel` (shared `cad-profile-18j-helpers.ts`) is documented as
legacy-only: shell mode mounts no floating properties overlay. The 21A shell
spec now asserts the legacy collapse control is absent
(`button[title="Collapse panel body"]` count 0). No legacy spec call sites were
touched.

## 6. Survey tab label casing

`CadRibbonSurveyTab.tsx` Tables group now uses the shared `shortLabelFor`
(Line/Curve/Parcel/Points/Report/Desc/Style) instead of ALL-CAPS
`key.replace('TABLE', '')`, matching the Annotate tab.

## Validation

- `npm run lint` — 0 errors (2 pre-existing warnings).
- `npx tsc --noEmit` — clean.
- Focused unit suites — ribbon controls/wave2/families 23/23; shell panels +
  survey table + shell chrome 43/43.
- `npm run test:agent` — 6541 passed, 1 skipped; only the 3 pre-existing
  study-desktop real-data failures (calibration, calibration_v5, preflight).
- `npm run build` — clean.
- Browser: 21A spec 3/3 (tightened gate, 3 resolutions), 21B spec 4/4.
