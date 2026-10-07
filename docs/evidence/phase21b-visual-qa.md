# Phase 21B §§18–19 — browser visual QA evidence

Branch: `feat/cad-shell-closeout-civil-icons` (base `origin/main` 0407a4d).
Scope: real-Chromium visual review of the 21A/21B shell (compact icon ribbon,
tool-family flyouts, viewport, Properties palette, parcel report, new Civil
icons). Presentation-only; no engine, geometry, solver, or registry behavior
touched.

## Method

- Camera: `scripts/phase21bCaptureEvidence.mjs` (dependency-free CDP driver,
  Playwright-bundled Chromium 1234 `--headless=new`). This is the same
  convention as `scripts/phase21aCaptureEvidence.mjs`: in this container the
  Playwright launch pipeline produces no compositor frames, so in-test
  `.screenshot()` cannot settle, but the same binary captures a real frame via
  `Page.captureScreenshot` in ~35 ms.
- 15 states × 3 canonical resolutions (1366×768, 1920×1080, 2560×1440) =
  45 PNGs in `docs/evidence/phase21b/`, plus 1 auxiliary short-viewport probe
  (`aux-line-flyout-boundary-1366x430.png`) = 46 files.
- Every PNG was inspected as an image (three resolution-scoped passes plus a
  post-fix re-check). Findings below are from those inspections, backed by
  DOM geometry measured during capture.

### States captured

| # | Name | What it evidences |
|---|------|-------------------|
| 01 | home-empty | compact Home ribbon, viewport, both side panels |
| 02 | arc-flyout | Arc split flyout (default 3-Point face) |
| 03 | line-flyout | Line flyout, planned rows greyed, no Polyline |
| 04 | curves-flyout | separate Curves family + calculator row |
| 05 | circle-flyout | Circle family, planned-only rows |
| 06 | annotate | Annotate tab density |
| 07 | survey | Survey tab density, new Points/Point-Groups icons |
| 08 | surface-new-icons | Surface tab with the new Civil icon set |
| 09 | output | Output tab (LandXML icon) |
| 10 | home-selected-properties | polyline selected, Properties palette |
| 11 | active-line | active LINE command (prompt + highlighted face) |
| 12 | home-featureline-grading-icons | Home scrolled right: Feature Line + Grading + Grading Groups icons, horizontal overflow |
| 13 | line-flyout-long | long Line flyout (17 rows), fully on-screen, scrolls internally |
| 13b | flyout-containment | alternate-family flyout, fully contained |
| 14 | parcel-report | selected parcel + full Parcel Report block |
| aux | line-flyout-boundary @1366x430 | long flyout capped to the viewport |

## Measurements (DOM geometry at capture time)

Ribbon height is constant; the drawing viewport keeps the 21A baseline at
every resolution (the compact band steals no viewport height).

| Resolution | ribbon | groups | viewport | viewport share | strip overflow-x |
|------------|-------:|-------:|---------:|---------------:|-----------------:|
| 1366×768   | 120    | 93     | 345      | 44.9 %         | 1162 px |
| 1920×1080  | 120    | 93     | 657      | 60.8 %         | 608 px  |
| 2560×1440  | 120    | 93     | 1017     | 70.6 %         | 0 px    |

Flyout boxes (fixed-position anchor, shared constants 352×260 / margin 8):

| State | box | box vs viewport | internal scroll |
|-------|-----|-----------------|-----------------|
| Line (long) | 352×260 @ (95,167) | right 447, bottom 427 — inside all resolutions | 414 > 258 (scrolls) |
| Hatch | 240×80 @ (660,167) | inside all resolutions | none (78 = 78) |
| Line @1366×430 (aux) | 352×**255** @ (95,167) | bottom 422 ≤ 430 | 414 > 253; `max-height` capped to available space |

> **Superseded — post-L1, 2026-10-07** (branch
> `fix/cad-ribbon-flyout-overflow-interaction`). The `352×260` box and the
> "Line scrolls" column above are the historical pre-L1 capture and the PNGs
> are left untouched. The fixed **260px product cap was retired**: the anchor
> (`cadRibbonFlyout.anchor.ts`) now sets an inline `max-height` equal to the
> live viewport room on the chosen side, so on a desktop viewport every
> family shows its **natural full height** with no vertical overflow and no
> product cap. On a **short viewport** the internal-scroll **fallback**
> remains (menu capped to room, `overscroll-behavior: contain`), and internal
> scroll is explicitly **exempt** from the external-scroll close. Current
> contract is asserted by `tests-browser/cad-shell-ribbon-hardening-21b.spec.ts`
> (desktop natural-height/no-overflow law + 1366×360 internal-scroll fallback)
> and `tests/cad_ribbon_controls.test.tsx`.
>
> **Focus reveal law (same branch).** On open, and during Arrow/Home/End
> navigation, the focused row is revealed by writing only the flyout's own
> `scrollTop` (`ensureCadRibbonFlyoutRowVisible` in
> `cadRibbonFlyout.scroll.ts`). Focus always passes `preventScroll: true` and
> `element.scrollIntoView()` is never called, so the reveal can never pan the
> ribbon strip — a strip scroll is an external scroll that would self-close
> the menu. Regression fixed: reopening the height-capped Line menu after
> picking `line-perpendicular-from-point` had left focus on an off-screen row
> while the menu sat at `scrollTop 0`; keyboard nav had used a scrolling
> `focus()` that could pan the strip. Covered by
> `tests/cad_ribbon_controls.test.tsx` (L1-K helper + L1-L reopen/nav) and the
> 1366×360 fallback case in `cad-shell-ribbon-hardening-21b.spec.ts`.

## Findings

### F1 — flyout rows grew a horizontal scrollbar (FIXED)

Measured on the Line flyout at 1366×768: `flyout.scrollWidth 458 >
clientWidth 350`. `.cad-ribbon-flyout` sets `overflow-y: auto`, which makes
`overflow-x` compute to `auto`, so long secondary hint text widened the row
past the 22rem box and produced a hidden horizontal scrollbar; the hint was
hard-clipped (no ellipsis). Fix is presentation-only in
`src/cad-app/shell/cadShell.css`:

- `.cad-ribbon-flyout { overflow-x: hidden; }` — a vertical menu never
  scrolls sideways.
- `.cad-ribbon-flyout__hint { flex: 0 1 auto; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }` — the dim hint shrinks and
  ellipsizes inside the box; the primary command label stays fully readable.

Re-measured: `flyoutScrollW 350 == clientWidth 350`, `overflowX: hidden`,
`hintTextOverflow: ellipsis`. Post-fix visual re-check of all flyout frames
(02/03/04/05/13/13b, both remaining resolutions) reported no horizontal
scrollbar and no spill outside the menu border.

### F2 — horizontal ribbon overflow at 1366 (accepted, by design)

The Home and Surface ribbons are wider than 1366: 1162 px of strip overflow,
rightmost groups clipped (`Blocks`/`Layers`, `Volume`). This is the intended
21A access path — `.cad-shell-ribbon-groups` is `overflow-x: auto` with one
nowrap band, and the 21B spec asserts `scrollLeft` moves whenever
`scrollWidth > clientWidth`. Evidence frames pass `--hide-scrollbars` (as do
all prior phase cameras), so the thin scrollbar is absent from the PNGs; on a
real browser it renders, and trackpad/wheel scroll reaches the clipped groups.
A chevron affordance is not implemented; the CSS carries the reserved
`.cad-ribbon-tool--overflow` hook for future use. No code change made.

### F3 — flyout boundary clamp (partly synthetic)

Every draw-family caret sits in the left ~660 px at these widths (the Home
draw grid ends at the hatch caret; the wider groups to its right carry no
family carets), so a caret can never be parked against the right viewport edge
at 1366/1920/2560. The strict right-edge clamp is therefore proven by the 21B
browser spec's box assertions (`hatch` flyout `x ≥ 0`,
`x + width ≤ viewport`), not by a naturally framed screenshot; `13b` is kept
only as a containment frame. The **bottom**-boundary cap is demonstrated
visually by the auxiliary probe: on a 430 px-tall viewport the long Line
flyout shrinks to `max-height 255px`, ends at `bottom 422 ≤ 430`, and scrolls
internally instead of overflowing.

### F4 — sparse tabs (accepted)

Annotate, Survey, and Output are left-aligned with an empty right half at all
resolutions. This reflects fewer shipped controls, not clipping or a layout
defect; the groups stay in the same compact band.

### F5 — parcel report uses the full palette height (accepted)

At 1366×768 the Parcel Report block (area/perimeter/closure/course table)
occupies the palette to the viewport bottom; the palette scrolls internally
when the block plus entity rows exceed it. Parcel geometry may extend beyond
the drawing viewport depending on zoom; that is view state, not a clip.

### F6 — capture-harness file-input artifact (FIXED in the camera)

The first parcel-report capture un-hid the app's file input to drive the real
Open seam and left the native `Choose file / No file chosen` chrome visible
over the drawing header. This was a camera bug, not product chrome; the camera
now restores the input's `hidden` class after `DOM.setFileInputFiles`, and the
re-captured 14-parcel-report frames at all three resolutions show no file
chrome.

### No-defect checks

- No grey/brown background seams or banding across the viewport at any
  resolution.
- No vertical or document-level scrollbar at any resolution
  (`document.documentElement.scrollHeight - innerHeight ≤ 1`).
- New Civil icons (Surface create/boundary/breakline/contours/paste/volume/
  swap-edge/line-add/point-add/style; Feature Line create/elevation/
  elev-from-surface/raise-lower/insert-vertex; Grading create/group-create;
  Parcel props-edit/segments-edit/renumber-tags; Survey point-group;
  Profile/Section view; LandXML import) render as distinct, sharp, plausible
  glyphs — none blank, broken, or mismatched. This closes the icon-wave
  limitation recorded in `TODO.md` ("authoring model has no image support").
- Caption alignment, disabled-button readability, and the ~290 px Properties
  palette width are clean at 1366; Properties stays readable at 1920/2560.

## Screenshot index

`docs/evidence/phase21b/`:

- `01-home-empty-{1366x768,1920x1080,2560x1440}.png`
- `02-arc-flyout-…`, `03-line-flyout-…`, `04-curves-flyout-…`,
  `05-circle-flyout-…`
- `06-annotate-…`, `07-survey-…`, `08-surface-new-icons-…`, `09-output-…`
- `10-home-selected-properties-…`, `11-active-line-…`
- `12-home-featureline-grading-icons-…`
- `13-line-flyout-long-…`, `13b-flyout-containment-…`
- `14-parcel-report-…`
- `aux-line-flyout-boundary-1366x430.png`

## Reproduction

```bash
npm run dev -- --host 127.0.0.1 --port 4174   # dev server
node scripts/phase21bCaptureEvidence.mjs       # 45 frames, 3 resolutions
node scripts/phase21bCaptureEvidence.mjs --boundary  # 1 aux frame
npm run test:map-browser -- cad-shell-compact-ribbon-21a cad-shell-ribbon-hardening-21b
```
