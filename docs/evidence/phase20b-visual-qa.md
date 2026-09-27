# Phase 20B visual QA — grading site plan, 3 resolutions

Spec: `tests-browser/cad-grading-daylight-20b-visual.spec.ts` (3/3 green,
zero page/console errors; ~5 s per sweep). Captures:
`docs/evidence/phase20b/<view>-<1366x768|1920x1080|2560x1440>.png`
(`WRITE_20B_EVIDENCE=1`). Scene (production seams: PARCEL_CREATE,
GRADING_CREATE/GRADINGBAKE, WNCAD loader): flat EG (integer corners, z=0),
pad fill edge above EG, cut edge below EG, cut/fill definition, arc swale
course, void target, parcel context, C-101 sheet with pre-baked strip.
All ties land on integer coordinates (fractional tie nodes fail-closed per
the perf evidence, so the success path is what renders here).

## Views (per-resolution notes)

- **model-site**: plan as opened (12 entities). 2560: parcel rect, EG
  diagonal, pad edges, swale arc, area label all legible. 1366: same content,
  small — the established cramped class (19C §126 note), not a 20B defect.
- **manager-definitions**: 5-row table pre-calc (Name/Source/Side/Target/
  Criterion/Status/Max/Accuracy/Tie/Area/Tri) + create form (source FL,
  course, side, CURRENT target select, Fixed/CutFill, Percent/Down/−2.000%,
  max distance, chord tolerance).
- **fill-current**: Pad fill Current, Exact, tie 20.00–20.00, area 800.0,
  2 tris. **cut-current / cutfill-current**: same shape (cut: +50.000%,
  tie 20; cutfill: Cut +50%/Fill −50.000%, all-FILL on flat EG).
- **curve-state**: Swale curve **Failed** (fractional chord nodes trip the
  agreement gate — consistent with perf finding 1, not a UI defect).
- **void-failed**: Void probe **Failed**, metrics `--` (fail-closed, honest).
- **stale-state**: criteria edit (−50% → −2%, prompt-driven) → Pad fill
  **Needs Recalc (stale)**, retained metrics (Exact, 20.00–20.00, 800.0, 2);
  Toolspace mirrors "Needs Recalc (stale)"; log shows
  `GRADING_EDIT_CRITERIA (Pad fill) committed.`
- **baked-surface**: `GRADINGBAKE (Pad cut - Baked) committed.` — new surface
  in Toolspace (in-session CURRENT).
- **sheet-plan**: C-101 renders (frame, viewport 1:500, title block, draft
  footer). Meshes never persist, so EG + baked strip were rebuilt in-session
  (baked: Current, **800.000 m²**, Min 0 / Max 10 — analytic strip exact);
  sheet viewport content stays faint (gap §4).

## §122 reviewer answers

1. **Side obvious?** Yes — Side column (Left/Right) + create-form select;
   rows read "Pad fill … Right". No on-canvas side arrow (arch §9 ghost
   arrow not observed) — partial gap.
2. **Up/Down + Cut/Fill signs understandable?** Yes — Direction Down with
   resolved −2.000%, table "Fixed −50.000%" / "Cut +50.000% / Fill −50.000%".
3. **H:V unambiguous?** Yes — every criterion cell carries `(0.500H:1V)` /
   `(0.020H:1V)`; unlabeled ratios never appear.
4. **Daylight distinct?** **No — headline gap.** CURRENT daylight + TIN fill
   do not render in the interactive model viewport: `buildGradingDisplayPass`
   has no canvas consumer (only `buildGradingSheetItems` consumes grading
   items, `cadExportScene.ts:634`). Canvas crop proves absence (no line at
   the y=5 tie, no fill quad) while the manager reports Current + metrics.
   Shell work, out of scope for this slice. Correction (Gate-10): CURRENT
   daylight + TIN now reach the model viewport canvas via `cadGradingView.ts`
   (`buildGradingDisplayLayers`) → scene `gradingLayers` →
   `renderGradingLayers` (model viewport canvas consumer), superseding the
   "no canvas consumer" note above.
5. **Stale/failed obvious?** Yes — "Needs Recalc (stale)" with retained
   metrics; "Failed" with `--` metrics; Toolspace mirrors both.
6. **Approximated state visible?** Partial — tolerance input renders
   ("Curve chord tolerance (m)"), but the "Curve Approximated" badge never
   appears: no curve result reaches CURRENT headless (see curve-state).
   Unverifiable here, not claimed.
7. **Viewport dominant?** At 2560 yes; at 1366 no (ribbon + Toolspace +
   Properties + floating manager dominate — same cramped class as 19C).
8. **Manager compact?** Yes — one floating panel: create form + 5-row table
   (status/max/accuracy/tie/area/tri) + per-selected-row actions
   (Calculate/Edit Criteria/Change Target/Extract/Bake/Delete).
9. **No-solution reason understandable?** Partial — Failed badge is obvious;
   the underlying code (NO_SOLUTION) is not shown in the table; failed-row
   inquiry content not captured (gap).
10. **Professional plan look?** Partial — sheet furniture (frame, title
   block, footer, 1:500 viewport) renders; but the sheet viewport is faint
   and live-grading sheet items need a CURRENT result, which cannot exist in
    a fresh file (results never persist) — combo unverifiable headless (gap).

Flows proven green headless: surface Rebuild → Calculate → Current (worker),
criteria edit → Needs Recalc, Bake → independent CURRENT surface
(800.000 m²), void → Failed, save-format round trip (functional spec).
Gaps are explicit above, not claims.
