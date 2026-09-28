# Phase 21A Wave 3 — compact ribbon + viewport browser QA

Branch: `feat/cad-compact-icon-ribbon-viewport-cleanup` (uncommitted; do NOT rebase/commit).
Spec: `tests-browser/cad-shell-compact-ribbon-21a.spec.ts` (3 tests, one per
resolution). Camera: `scripts/phase21aCaptureEvidence.mjs` (36 PNGs).
Screenshots: `docs/evidence/phase21a/` (`<state>-<WxH>.png`).

## 1. Method + environment honesty

- Headless Chromium per repo convention, **but**: in this container the
  Playwright launch pipeline never produces compositor frames
  (`requestAnimationFrame` stalls even on `about:blank`, across both bundled
  builds), so in-test `.screenshot()` cannot settle and stability-gated ops
  (`mouse.wheel`, unforced clicks) hang. The spec therefore uses forced /
  dispatched clicks and DOM/state assertions only; it passes 3/3 with zero
  page/console errors.
- Visual evidence comes from the sidecar script driving the **same
  Playwright-bundled Chromium binary** (`chromium-1234`, `headless=new`) over
  CDP (`Page.captureScreenshot`, ~35 ms/frame). Every PNG is a real render,
  and the spec attaches each PNG into its report (fails loudly if missing).
- Viewport is pinned exactly via `Emulation.setDeviceMetricsOverride`
  (`--window-size` alone yields 1366x625, not 1366x768).

## 2. Measurements (one compact band at every resolution)

Heights in px: quick-access / menu / ribbon-tabs / groups / ribbon-total /
drawing-tabs / layout-tabs / viewport / dock / statusbar; share = viewport ÷ window.

| Resolution | qa | menu | tabs | groups | ribbon | drawtabs | layouttabs | viewport | dock | status | share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1366x768 | 41 | 25 | 26 | 93 | 120 | 29 | 29 | 345 | 148 | 31 | 44.9% |
| 1920x1080 | 41 | 25 | 26 | 93 | 120 | 29 | 29 | 657 | 148 | 31 | 60.8% |
| 2560x1440 | 41 | 25 | 26 | 93 | 120 | 29 | 29 | 1017 | 148 | 31 | 70.6% |

Identical with a polyline selected + Properties open (selection never moves
chrome). Ribbon total is a constant 120 px (tabs 26 + groups 93 + borders);
the groups row asserts `scrollHeight <= clientHeight + 2` (no vertical wrap;
excess width scrolls horizontally) at all three widths. Chrome is a fixed
423 px; only the viewport grows with the window.

## 3. §83 flow verdicts (all PASS, zero page/console errors x3)

| Flow | Verdict |
| --- | --- |
| A — single band, no wrap, compact height | PASS (table above + band assertion per tab) |
| B — Arc default face is 3-Point | PASS (`aria-label "Arc: 3-Point"`, key `ARC_3PT`) |
| C — caret → Start/Center/End starts command, face goes sticky, primary repeats | PASS (prompt `Arc…`, face `ARC_SCE`, primary re-runs) |
| D — New resets sticky faces | PASS (quick-access New → face back to `Arc: 3-Point`) |
| E — Line flyout: 1 runnable row, rest planned/grey, Polyline absent | PASS (18 rows, 17 `aria-disabled`, no polyline variant; shot 03) |
| F — Curves separate family, truthful mappings | PASS (`Curve Calculator → CURVE_SOLVER`, separator before WebNet rows; shot 04) |
| G — Circle/BestFit/Ellipse/Shapes/Hatch open with all rows disabled | PASS (0 runnable rows each; shot 05) |
| H — Move/Trim/Fillet start from the ribbon | PASS (prompt non-empty each) |
| I/J/K/L — Annotate/Survey/Surface/Output keep one band, tools reachable | PASS (`MTEXT`, `LINETABLE`, `Bake Copy`, `SHELL_EXPORT_CENTER`; band re-asserted per tab) |
| M — PLINE commits (Enter), select-all → palette values, legacy panel absent | PASS (`PL1 … Vertices 3 … Total length 15.611`; `[data-survey-cad-properties-panel]` count 0; shot 10) |
| N — staged shared boundary: Edit Shared + Unlink enabled, Unlink applies | PASS (linked lot-1 row → both buttons enabled; Unlink removes the link; report-summary block not gating) |
| O — exactly one shell input, legacy input/status absent, `LINE` typing starts the command | PASS (suggestions → `LINE active`; shot 11) |
| P — uniform `#020617` background at 5/25/50/75/95% width | PASS (all samples `rgb(2, 6, 23)`, single distinct value) |
| Q — far-left (2%) / far-right (98%) canvas picks | PASS (safe, no errors) |
| R — uniform scale, 45° line, zoom-about-cursor, round trip | PASS (see §5) |
| S — collapse/restore keeps the sticky Arc face | PASS (aria-label identical) |
| T — zero page/console errors | PASS (all 3 resolutions) |

## 4. Wave-3 findings close-out

No A–F tracker exists in-repo, so these are the six discrepancies this wave
actually surfaced, each closed:

| # | Finding | Verdict |
| --- | --- | --- |
| F1 | **Open flyouts painted zero pixels.** `.cad-shell-ribbon-groups` is a scroll container (`overflow-x/y: auto`), which clips in-place `absolute` menus. Open flyouts were DOM-present and clickable but invisible (screenshots proved it). **Real shell bug — fixed minimally**: flyout paints `position:fixed` at a caret-computed viewport anchor (`CadRibbonSplitButton.openMenu` + `.cad-ribbon-flyout--fixed`), closes on scroll/resize, outside-click handler exempts menu rows. DOM position unchanged, so `tests/cad_ribbon_controls.test.tsx` stays green. | Fixed + verified (shots 02–05 show full menus) |
| F2 | PLINE does not commit on Escape (it cancels); commit is Enter-on-empty-input. | Spec/sidecar corrected; shot 10 shows the committed PL1 |
| F3 | The large split face shows the family short-label ("Arc"), not the variant; variant rides `aria-label` + `data-cad-command`. | Assertions corrected |
| F4 | The viewport `viewBox` is fixed `0 0 900 520`; zoom/pan apply in view coordinates, so "viewBox changes" is the wrong zoom observable. | Zoom asserted on rendered view coords instead (x1 66.90 → 43.89 etc.) |
| F5 | Guessed tab keys (`COGO_POINT`/`SURFCREATE`/`PLOT`) are not on those tabs; real faces are `LINETABLE` / `Bake Copy` / `SHELL_EXPORT_CENTER`. | Corrected against the tab builders |
| F6 | Parcel action kinds are `parcel-shared-edit` / `parcel-unlink` (not `parcel-edit-shared`). | Corrected; N passes end to end |

## 5. Responsive-geometry oracle results

| Resolution | sx vs sy | 45° slope deviation | zoom (line x1) | round trip (getScreenCTM vs viewBox math) |
| --- | --- | --- | --- | --- |
| 1366x768 | identical | 0.0000 | 66.90 → 43.89 | 0.0000 px |
| 1920x1080 | identical | 0.0000 | 66.90 → 43.81 | 0.0000 px |
| 2560x1440 | identical | 0.0000 | 66.90 → 43.75 | 0.0000 px |

Uniform meet scale (sx == sy to 1e-9) is what keeps circles circular; the
45° world line renders at exactly 45° on screen at every resolution; the
wheel zoom moves rendered geometry; the browser's own screen matrix agrees
with viewBox arithmetic to the pixel. The projector itself was deliberately
NOT changed (see the architecture note).

## 6. Civil3D comparison checklist (reconstructed from the family manifests §§17–25 + observed UI)

| Civil tool | WebNet face | Honest status |
| --- | --- | --- |
| Arc 3-Point / SCE / SCA / SCL / SEA / SED / SER / CSE / CSA / CSL / Continue | Arc split, 11 runnable rows | Full parity, all with real starters |
| Create Line | Line split primary | Truthful; the 17 Civil line-by-* rows are visible but planned/grey (they create points, not lines, or have no starter) |
| Curve between/on/through, multiple, from-end, reverse-or-compound | Curves split, Civil rows planned | Honest split: `Curve Calculator → CURVE_SOLVER` + 9 WebNet-native rows (Tangent/PI/Chord/Reverse/Compound/…) below the separator |
| Circle (all constructions) | Circle split, all planned | No general Circle command exists — all rows grey, none fake-runnable |
| Best-fit line/arc/parabola | BestFit split, all planned | No solver surface — all rows grey |
| Ellipse / Rectangle / Polygon / Hatch / Gradient / Boundary | Ellipse/Shapes/Hatch splits, all planned | No interactive sessions — all rows grey |
| Ribbon text faces (Traverse, circle/ellipse/shapes/hatch primaries, managers) | Short text, never placeholder glyphs | Documented manifest-fallback policy (no truthful curated asset) |

## 7. Screenshots (36 real PNGs in `docs/evidence/phase21a/`)

Per resolution (`1366x768`, `1920x1080`, `2560x1440`): `01-home-empty`,
`02-arc-flyout`, `03-line-flyout`, `04-curves-flyout`, `05-circle-flyout`,
`06-annotate`, `07-survey`, `08-surface`, `09-output`,
`10-home-selected-properties`, `11-active-line`, `12-wide-geometry`.

## 8. Honest gaps

- Screenshots are sidecar-captured (same binary) rather than in-test: the
  container's Playwright launch pipeline produces no compositor frames (see
  §1). On a healthy runner the spec's attach step works unchanged.
- N stages its fixture through the engine seam (19D pattern) rather than
  hand-drawing two parcels; the row-action click path itself is fully live.
- The deferred parcel report-summary block (Wave-1C) is confirmed NOT to gate
  Edit Shared / Unlink row actions.
