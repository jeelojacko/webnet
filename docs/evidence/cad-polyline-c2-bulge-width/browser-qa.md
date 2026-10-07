# Phase C2 — browser QA

Spec: `tests-browser/cad-draw-polyline-c2.spec.ts` (flows A–H). Production
build, headless Chromium, blank disposable drawings:

```
npx playwright test cad-draw-polyline-c2 --config=playwright.prod.config.ts
```

Result: **8/8 green**, zero page errors, zero console errors, zero unhandled
rejections across all flows (each flow asserts `assertClean`). Screenshots and
`geometry.json` were written by the spec.

## Flows — what was proven

- **A — straight C1 regression.** PLINE open-finishes on empty Enter with 3
  vertices; the dock advertises the C2 option set (`Line … A Arc … W Width`);
  the saved WNCAD polyline is `closed:false`, 3 vertices, and carries **no**
  metadata keys. Edit ▸ Undo/Redo round-trips the entity count.
- **B — mixed line + arc.** `A` switches the dock to arc mode and prompts for
  the through-point, then the arc end; the committed polyline has
  `segmentGeometry` kinds `['line','arc']`. The saved arc bulge is a
  semicircle (`|bulge| ≈ 1`, CW so negative) whose `describeParcelArcCourse`
  midpoint rides 10 m off the chord. The **rendered** SVG arc path is also
  asserted: it uses an arc command and its screen-space midpoint rides about
  half the chord length off the chord, proving the displayed curve is a true
  arc, not a chord. The arc course is a hittable node
  (`data-survey-cad-segment-id="<id>#1"`) and clicking the screen-transformed
  crown of the displayed path reselects the polyline (same refs that feed
  snaps).
- **C — arc close.** `C` without a pending through-point refuses with
  `PLINE Arc Close: pick an arc-through point first, or switch to Line then
  Close.` (0 entities). After capturing a through-point, `C` commits a closed
  ring with 3 stored vertices, no duplicate first/last, and all three
  `segmentGeometry` entries `arc`; the closing course `#2` resolves a valid
  bulged arc and is a hittable segment.
- **D — constant + tapered width.** `W` `6` sets a constant default; `W` `2,8`
  sets a taper. After Enter the saved `segmentWidths` are exactly
  `[{6,6},{2,8}]`. The committed viewport renders one aggregated filled band
  polygon; its screen-space shoelace area matches the committed model band
  area × viewport scale² (ratio ≈ 1.0) at two zoom levels, so the displayed
  fill is metrically tied to the stored width (`geometry.json`
  `flowD.firstZoom/secondZoom`).
- **E — backstep alignment.** Mixed arc/line/arc drafting then `U`: the first
  `U` clears the pending through-point only (prompt returns to the
  through-point state, no vertex lost), the second `U` removes the newest
  completed line course with its metadata (prompt `2 vertices captured`).
  The committed polyline has 2 vertices and 1 course whose stored geometry is
  the original **arc** — metadata stayed course-aligned through the mixed
  backstep sequence, and the zero width canonicalized to absent.
- **F — persistence + DXF seams.** WNCAD round-trips the bulge and width
  arrays verbatim; the existing DXF export model exports the polyline (id
  present in `output.polylines`, absent from `omittedEntityIds`) — the C2 shape
  survives both seams. Recorded in `geometry.json` (no PNG).
- **G — guards, strict-modal width.** An invalid width (`-3`) shows
  `PLINE width invalid…`, stays in the draft, and creates no entity. While the
  width phase is open, point-looking text (`A=10,20`, `@0,10`,
  `N45-00-00E,100`, `LABEL=1,2`), plain text (`nope`), and option tokens
  (`A`/`L`/`C`/`W`) all stay width errors with zero entities, and a raw pair
  (`10,20`) is accepted as a taper (`future segments`) — never a coordinate or
  an option escape. Escape cancels. A second draft with a collinear arc triple
  shows `PLINE arc rejected…`, creates no entity, and Escape leaves zero
  entities.
- **H — multi-arc course identity.** A PLINE draft with two arc courses
  commits one 3-vertex polyline whose `segmentGeometry` is `['arc','arc']`
  with distinct bulges; both `${id}#0` and `${id}#1` render as independently
  hittable course nodes, and clicking each rendered arc selects the polyline
  (`geometry.json` `flowH`). This proves course identity reaches the display/
  hit layer that feeds snaps (exact snap/lock attribution is covered by the
  Node consumer suite).

## Screenshots (existing PNGs, referenced not moved)

These were written by the spec under **`docs/evidence/cad-polyline-c2/`**
(9 PNGs + `geometry.json`):

| Flow | Files |
|---|---|
| A | `A-open-committed.png` |
| B | `B-mixed-draft.png`, `B-committed-mixed.png` |
| C | `C-curved-close.png` |
| D | `D-width-draft.png`, `D-width-zoomed.png`, `D-width-committed.png` |
| E | `E-backstep-aligned.png` |
| F | (none — `geometry.json` only) |
| G | `G-guards.png` |
| H | (none — `geometry.json` only) |

**Directory-name variance (intentional):** the evidence prose lives in
`docs/evidence/cad-polyline-c2-bulge-width/` while the PNGs/`geometry.json`
were produced under `docs/evidence/cad-polyline-c2/`. The images are left in
place and only referenced here; nothing was moved or renamed.

## Two-zoom rendered-band proof

Flow D commits the widths, resolves the committed band polygon in Node
(`buildCadPolylineBandPoints`), then asserts the **rendered** `polygon`
element's screen-space area equals the model band area scaled by the viewport
factor squared (derived from the known 30 m centreline course) at the initial
fit and after a wheel zoom — both ratios ≈ 1.0, recorded in `geometry.json`
(`flowD.firstZoom`/`flowD.secondZoom`), with `D-width-committed.png` and
`D-width-zoomed.png` capturing the two scales. This replaces the earlier
Node-only band certification: the browser now proves the committed band fill
directly. Hit testing stays centreline-authoritative (the band is
`pointer-events:none`), and flow B proves the displayed arc is curved (arc
command plus off-chord midpoint) rather than a straight chord.

## Zero-errors statement

All eight flows assert zero page errors, zero console errors, and zero
unhandled promise rejections. Status: executed and green — production build,
headless Chromium, `tests-browser/cad-draw-polyline-c2.spec.ts` 8/8 flows A–H.
