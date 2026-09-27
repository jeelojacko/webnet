# Phase 20C visual QA — grading-group site plan, 3 resolutions

Spec: `tests-browser/cad-grading-groups-20c-visual.spec.ts` (3/3 green,
zero page/console errors; ~40 s per sweep at 1920/2560, ~2 min at 1366
with overlap fallbacks). Captures:
`docs/evidence/phase20c/<view>-<1366x768|1920x1080|2560x1440>.png`
(`WRITE_20C_EVIDENCE=1`). Scene (production seams: PARCEL_CREATE,
GROUP_CREATE / GROUPBAKE commands, WNCAD loader): flat EG (integer
corners, z=0), closed notched building pad (flat z=10 — closed groups with
non-flat sources fail closed at the corner, so the success path renders
here), open cut bank below EG, cut/fill transition swale (integer zero
crossing), line + 90° arc entrance (graded inside so the corner solves),
unbuilt Future surface (target-stale view), parcel context, C-101 sheet
with pre-baked pad. All ties land on integer coordinates (20/12/16 m) so
the worker daylight/target agreement gate passes deterministically —
all four groups reach CURRENT headless, Entrance with the
Curve-Approximated corner badge.

## Views (per-resolution notes)

- **source-pad**: plan as opened (17 entities). All resolutions: parcel
  rect, EG diagonal, pad, bank, swale, drive arc, area label legible.
  Opening auto-selects EG1 (Properties panel opens right) — honest
  as-opened state, not cleaned. Ribbon collapsed by the spec at boot:
  at 1366 the expanded ribbon (490 px) squeezes the flex viewport to 0 px,
  so every 1366 view depends on the collapse (gap §4).
- **manager**: 4-row definition table pre-calc (Name/Courses/Side/Target/
  Criterion/Status/Max/Accuracy/Tie/Area/Tri, all Unbuilt) + create form
  (source FL, first/last course, closed-span Shortest/Long/All, side,
  CURRENT target select, Fixed/CutFill, Percent/Down, max distance, chord
  tolerance). 2560 crisp; 1366 legible but the floating manager already
  touches the dock tab bars.
- **span-selection**: Source = Building pad, First #1, Last #6, Closed
  span = All → `Span: 6 courses · 4 side-preview arrows · miter corners
  fixed` (asserted; the preview line sits at the manager top edge).
- **side-preview**: selected uncalculated pad renders ghost arrows + seam
  previews in the viewport (ghost note: "4 side-preview arrows + 5 seam
  previews until calculated"). Arrows are subtle at fit — visible, not
  prominent (gap §1).
- **convex-closeup**: cursor-anchored 4.4× zoom on pad SE corner (90,20):
  green fill ring, daylight boundary, GAP miter seams converging at the
  corner crosshair; snap reads NEAREST V2-V3. Exact miter confirmed
  visually at all resolutions.
- **concave-closeup**: 4.4× zoom on the notch (60,40): OVERLAP trim lines,
  no fan-out, manifold mesh; snap reads NEAREST V5-V6. The trim reads
  clearly at 1920/2560, adequately at 1366.
- **curved-corner**: 4.4× zoom on the drive arc (chord mid 130,40): arc
  course renders true; snap reads NEAREST ENTRANCE DRIVE#1. The
  approximation disclosure lives in the manager row (Current, Curve
  Approximated (corner), 16.00–16.00, 997.7, 50) + canvas
  CURVE CORNER APPROXIMATED label — the viewport alone does not badge it
  (gap §6).
- **target-stale**: Pad retargeted to unbuilt Future →
  `GROUP_REASSIGN_TARGET (Pad grade) committed`, row reads Source Not
  Current (stale) with retained metrics (Exact, 20.00–20.00, 5600.0, 24).
  Toolspace mirrors Future Unbuilt. Honest, obvious.
- **baked-surface**: `GROUPBAKE (Pad grade - Baked) committed.` — new
  surface in Toolspace; sheet-flow rebuild proves it CURRENT (25 verts,
  24 tris, Min 0.000 / Max 10.000, **5600.000 m²**, Contours style).
  Contour lines do not visibly render in the captures despite the style
  assignment (gap §5).
- **final-sheet**: C-101 layout (frame, VP-1 1:500, north arrow, scale
  bar, title block). Viewport shows plan linework (pad outline, bank,
  swale, drive arc); grading fill + contours do not render in the layout
  viewport — same faint-viewport class as 20B §4 (gap §5). Builder-level
  export is proven separately (spec letters Q/Q2: daylight + fill reach
  the SVG/PDF sheet scene and DXF model).

Volume note: the group UI reports area metrics only (no Cut/Fill m³
panel — gap §6). Analytic pad fill = ring 5600.0 m² × mean depth 5 m
(10→0 linear) ≈ **28,000 m³** fill, 0 cut.

## §122 reviewer answers

1. **Side arrows visible?** Partial — ghost arrows + seam previews render
   for the selected unbuilt group (counted in the ghost note), but subtle
   at fit; post-calc direction reads from geometry + close-up seams.
2. **Span obvious?** Yes — First/Last course + Closed span mode + the
   `Span: N courses · M side-preview arrows · miter corners fixed` line.
3. **Miter understandable?** Partial — corner mode is fixed miter, seam
   previews counted pre-calc, ties visible in close-ups; no per-corner
   angle readout.
4. **Failed corner identifiable?** Partial — rows read Failed with `--`
   metrics and the engine diagnostic names the corner index, but the
   manager row does not surface which corner failed.
5. **Convex/concave correct?** Yes — GAP miters at convex corners,
   OVERLAP trim at the notch (close-ups + letters C/D).
6. **Curve approximation disclosed?** Yes — accuracy cell Curve
   Approximated (corner) + canvas label + 50-chord mesh (997.7 m²);
   the zoomed viewport alone carries no badge.
7. **Closed pad feels like one operation?** Yes — one GROUP_CREATE, one
   6-course closed row, one Calculate, one Bake.
8. **Stale states clear?** Yes — Source Not Current (stale) with retained
   metrics; Unbuilt/Failed distinct; Toolspace mirrors all three.
9. **Bake clearly snapshot?** Yes — committed log line, independent
   explicit-TIN surface, definitions-only persistence (letter O).
10. **Viewport dominant at 1366×768?** Conditional — yes with the ribbon
    collapsed (spec boot pattern, 450 px viewport, sheet dominates);
    no with it open (0 px — the app needs a small-viewport layout pass).
11. **Professional CAD look?** Partial — dark CAD chrome, title block,
    north arrow, scale bar, 1:500 footer; but layout linework is faint,
    fills/contours never reach the sheet viewport, and the parcel area
    label overlaps the pad center in close-ups.

## UI quality gate (mission §153)

1. Manager discoverability: pass — Grading Groups subgroup on Home
   (Grade Group / Calculate / Inquiry / Extract / Bake / Manager).
2. Create-form guidance: pass — CURRENT-only target select, resolved
   ratio readout, span preview; rejects honestly without a target.
3. Calculate explicitness: pass — explicit per-row button, never
   auto-started; BUILDING state exists in the status machine.
4. Status honesty: pass — CURRENT / Unbuilt / Source Not Current
   (stale) / Failed, Toolspace mirrors, metrics retained only when valid.
5. Inquiry honesty: pass — non-CURRENT answers "No CURRENT result —
   calculate first" (browser letter); CSV blocked until CURRENT.
6. Curve disclosure: pass with gap — badge + canvas label + chord mesh,
   but no on-canvas badge in the zoomed viewport.
7. Closed-span UX: pass — Shortest/Long/All modes; All required for the
   full-pad span (Shortest default surprised once in authoring).
8. Small-viewport usability: FAIL — at 1366 the manager Close/Calculate/
   row clicks sit under dock tab bars (spec uses logged dispatched-click
   fallbacks: CLOSE-FALLBACK, MANAGER-CLICK-FALLBACK, ROW-CLICK-FALLBACK);
   a real user must drag/juggle panels. Also the open ribbon zeroes the
   viewport at 1366 (spec collapses at boot).
9. Label legibility: partial — table/metrics crisp at 1920/2560,
   adequate at 1366; parcel area label overlaps pad center; snap
   tooltips (NEAREST V2-V3) photobomb close-ups.
10. Sheet professionalism: partial — furniture complete, linework faint,
    no fills/contours in the layout viewport (20B §4 class).
11. Volume reporting: gap — area metrics only, no Cut/Fill m³ panel for
    groups (analytic ≈ 28,000 m³ fill cited above, not a UI readout).
12. Failure identification: gap — failed-corner index stays in engine
    diagnostics, not the row; non-flat closed sources and outside-curve
    grading fail closed with no canvas hint where.
13. Workflow completeness: pass — define → Calculate → Inquiry/Extract/
    Bake → sheet renders entirely through shipped seams with zero
    page/console errors at all three resolutions.

## Known engine limits (fail-closed, out of UI scope)

- Closed groups need flat source elevations: any bump (even 10→9 on one
  vertex of six) fails CORNER_NO_SOLUTION at the corner — hence the flat
  z=10 pad. Verified by prototype, not committed.
- Closed-loop cut/fill with mid-member zero crossings fails
  MEMBER/CORNER_NO_SOLUTION; cut+fill is shown via the open swale
  (0.00–16.00 ties, all-honest regions) instead.
- Line/arc corners solve only on the curve inside (Entrance: left);
  outside grading fails GRADING_CORNER_SECTOR.
- 20B at 1366 also fails its own gotoCad viewport gate on this build
  (pre-existing: ribbon growth since the 20B captures, not a 20C change).

Flows proven green headless: EG Rebuild → 4× Calculate → Current
(worker; Entrance Curve-Approximated), Bake → independent CURRENT
surface (5600.000 m²), retarget → Source Not Current (stale), C-101
sheet with baked surface + contours style, save-format round trip
(letter O). Gaps are explicit above, not claims.
