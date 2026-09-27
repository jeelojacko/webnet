# Phase 19C Visual QA (§101) — curved parcel plan, 3 resolutions

Plan: LOT 1 (40×30 m with an R50 road-frontage arc on the south course,
47°09'23" / 41.152 m / chord 40 m, traversal CW) + straight LOT 2 + three
road arcs/monuments + UI Parcel Course Table + store-seeded PARCELDESC
(DRAFT) table. Captured from `tests-browser/cad-curved-parcels-19c-visual.spec.ts`
(all three sweeps green, zero page/console errors). Pre-fix, the C-101 sheet
rendered the reversed-traversal frontage course as a full-circle ghost
(`arcToPolyline` normalized CW sweeps to the complementary major arc);
fixed in `src/engine/cad/cadExportScene.ts` with test proof in the 19C
browser spec (letter P). All captures below are post-fix.

## model-parcel (plan as opened, no selection)

- 1366×768: both lots, PC tags, area labels, and the on-plan course table
  render; the frontage arc is a smooth minor arc. No geometry defect. Layout
  note: the command-dock bar overlays the canvas center and Toolspace +
  Properties squeeze the viewport, so the plan reads small — same cramped
  class as the 19B §126 note, not a 19C defect. Fresh open leaves one entity
  (line:east) selected with its Properties shown; no click precedes it.
- 1920×1080: identical content with comfortable margins; curve call
  "47°09'23" R 50.000 m L 41.152 m" legible under LOT 1, PC1–PC4 at course
  midpoints. No defect.
- 2560×1440: identical, text and arc stay crisp. No defect.

## selected-curved-course (Select All highlight)

- 1366×768: all 15 entities highlight amber, Toolspace lists every source
  (lines, arc, lots, monuments); the curved frontage keeps its shape under
  highlight. No defect.
- 1920×1080: same, highlight outlines follow the arc exactly. No defect.
- 2560×1440: same. No defect.

## course-properties (Properties surface for the selection)

- 1366×768: the shell Properties toggle lives in a closed menu and is not
  script-reachable, so this view shows the entity Properties panel for the
  selection (Lines group, per-line layer/appearance/azimuth/bearing rows).
  Per-course arc metrics (radius/delta/arc length) are covered by the course
  table view instead. No rendering defect in what is shown.
- 1920×1080: same panel, fully legible. No defect.
- 2560×1440: same. No defect.

## course-table (UI Parcel Course Table + row manager)

- 1366×768: manager lists PC1–PC4 with ARC 50.000 / 47°09'23" / 41.152 /
  40.000 / S90-00-00.00W / right on the PC4 row; line rows keep truthful
  bearings/distances. Minor nit (product, reported not fixed): the
  UI-created table defaults its Title/Name to "Line Table" although Kind is
  Parcel Course.
- 1920×1080: same rows, no truncation. Same title nit, no other defect.
- 2560×1440: same. No further defect.

## split-preview (cutting line overlaid on the parent)

- 1366×768: the x=20 m cutting line renders vertically through LOT 1 (and
  LOT 2) with the parent intact; the pick-loop session preview itself is
  pointer-driven and not scriptable, so this is the exact cutting geometry
  the PARCEL_SPLIT commit consumes. No defect.
- 1920×1080: cutter clearly bisects the arc course. No defect.
- 2560×1440: same. No defect.

## split-result (committed children)

- 1366×768: two children with fresh boundaries, the arc course split into
  exact sub-arcs on the west child; cutter retained. The pre-split
  store-seeded course table honestly reports "parcel-course missing" rows
  (19A exact-id semantics, no lineage invention). No defect.
- 1920×1080: sub-arc curvature continuous across the cut. No defect.
- 2560×1440: same. No defect.

## sheet-plan (C-101, A3 landscape, 1:500 viewport)

- 1366×768: viewport projects both lots with PC tags, area/curve labels,
  course + description tables, north arrow, scale bar, and title block;
  status reads Layout1 | Viewport: 1:500. No clipping, no ghost geometry.
- 1920×1080: same composition, all labels legible. No defect.
- 2560×1440: same; title-block footer ("Draft plan — not a legal or
  certified survey document") legible. No defect. This closes the 19B
  third-resolution restriction.

## description-preview (PARCELDESC DRAFT table on plan)

- 1366×768: DRAFT description table renders at its insertion with PC1–PC4
  rows; the DRAFT header/footer wording is visible in the sheet view. The
  floating Properties panel overlaps the table at this width (layout, not
  data). No geometry defect.
- 1920×1080: table fully clear of panels, call text matches the course
  table numbers. No defect.
- 2560×1440: same. No defect.

## Defects summary

Found + fixed: sheet/sheet-export full-circle ghost on CW (reversed-traversal)
arc courses (`arcToPolyline` CCW-only sweep normalization) —
`src/engine/cad/cadExportScene.ts`, proven by the 19C spec letter P
(parcel polyline ≤ 10 points on the minor arc). Found + reported (not in
scope): UI Parcel Course Table default title "Line Table"; fresh drawing open
pre-selects one entity. No other rendering defects at any resolution.
