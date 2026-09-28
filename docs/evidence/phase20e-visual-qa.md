# Phase 20E visual QA — per-course criteria + planar/design pads, 3 resolutions

Spec: `tests-browser/cad-grading-per-course-20e-visual.spec.ts` (**3/3 green**,
zero page/console errors; 49 s at 1366×768, ~12 s each at 1920/2560). Captures:
`docs/evidence/phase20e/<view>-<1366x768|1920x1080|2560x1440>.png`
(36 PNGs; written with `WRITE_20E_EVIDENCE=1`). The Wave-2A subject — the
`CadGradingGroupCriteriaPanel` per-course editor and the Design Workflow
interior badge (`cadDesignPatchInterior.ts`) — is exercised through the shipped
`/cad` shell, never by staging DOM.

## Scene (production seams only)

- Explicit-TIN **EG** target (flat step-20 grid, every locus line on a target
  edge) + a coarse 2-triangle **EG Coarse** twin (the design-copy source — the
  18Y compose exact predicates self-hit on a same-surface diagonal; same class
  as the 20D oracle note). The twin carries the real `Contours` style so
  contour geometry is derived, not faked.
- Closed level **Pad** feature line 120×80 m at z=10 (a real building pad).
- Single-course **Ramp** feature line z 12→6 (a genuinely sloped feature line;
  a single course has no corner). A *closed* sloped pad fails closed
  (`CORNER_NO_SOLUTION GRADING_CORNER_SECTOR`), verified by probe — recorded
  below as an engine limit, not hidden.
- Parcel context + a **CL-Pad** alignment crossing the pad (for the section).
- Group **Pad** default `Fixed -50.000% (0.500H:1V)`; group **Ramp**.

The override is applied through the **live** editor: tick `Select Course 2` →
`Override fixed percent = -100` → `Apply to Selected` (one
`GROUP_SET_COURSE_CRITERIA` transaction), then the explicit row Calculate.
The final sheet is a separate Node-staged drawing (engine apply + C-101).

## §103 items 1–11 — capture map and status

| # | Item | View / assertion | Status |
|---|------|------------------|--------|
| 1 | EG surface | `01-eg-surface` (EG + EG Coarse; 2 surface layers, 1 contour layer, 25 contour labels) | **REAL** |
| 2 | Sloped pad feature line | `02-pad-feature-line` (plan zoom) | **REAL** |
| 3 | Group with per-course overrides | `03-criteria-default`, `04-criteria-override`, `05-group-current` | **REAL** |
| 4 | Unequal-slope corner | `06-unequal-corner` (zoom @ pad SE; group layer rendered, `groupLayers=1 groupFills=1`) | **REAL** |
| 5 | Planar patch | `07-design-patch` — interior badge renders live; **Planar/Undefined branches not live-capturable** | **PARTIAL** |
| 6 | Design surface | `08-design-surface` (4 surface layers after apply) | **REAL** |
| 7 | Contours | `09-contours` (2 contour layers, 59 contour labels) | **REAL** |
| 8 | Volume | `10-volume` (`FILL 136000.000 / CUT 0.000 / Net 136000.000`) | **REAL** |
| 9 | Section / profile | `11-section` (CL-Pad Design CURRENT with stats) | **REAL** |
| 10 | Sheet | `12-sheet` (C-101; `sheetGeometryCount > 5`) | **REAL** |
| 11 | 1366 width usability | DOM assertion (no PNG) — manager width guard | **REAL (assertion)** |

### Per-resolution DOM facts (console + test annotations)

| Fact | 1366×768 | 1920×1080 | 2560×1440 |
|------|----------|-----------|-----------|
| Manager guard | x=586 w=480 right=1066 docScroll=1366 | x=1140 right=1620 docScroll=1920 | x=1780 right=2260 docScroll=2560 |
| Criteria rows | 4 (1 Override / 3 Default) | same | same |
| Group row | `Pad 4 (closed) Right EG … Overrides:1 Current 50.00 Exact 10.00–20.00 8400.0 18` | same | same |
| Interior badge | `Flat (z = 10.000 m)` | same | same |
| Contours rendered | true (2 layers / 59 labels) | true | true |
| Volume | FILL 136000.000 / CUT 0.000 | same | same |
| Viewport height | 450/768 (collapsed ribbon); 166 with the surface manager open | 762/1080; 529 | 1122/1440; 966 |

The manager width guard passes at every resolution: the floating manager is
480 px, positioned `right-3`, and `document.scrollWidth == viewport width`
(no horizontal page overflow). The criteria table's own horizontal scroll stays
inside the panel.

## §104 quality-gate questions (honest answers)

1. **Default-vs-Override obvious?** **Yes.** The table has explicit `Type`,
   `Effective Criterion`, `Source` columns; Course 2 reads `Override` with a
   `Reset to Default` action while the other three read `Default` with an
   `Override` action; the header line reads `Group default: … · Overrides: 1`.
   DOM-verified identically at all three resolutions.
2. **Override course identifiable?** **Yes.** The row is labelled `Course 2`
   (1-based, human) with `From v1 / To v2` short vertex tags; no raw UUID ever
   reaches the table (assertion: the panel contains neither `fl-pad` nor
   `vertexAId`). The `Reset to Default` button is the unambiguous override
   marker.
3. **Effective criterion readable without IDs?** **Yes.** Course 2 shows
   `Fixed -100.000% (1.000H:1V)` next to the default courses'
   `Fixed -50.000% (0.500H:1V)` — signed percent *and* H:V ratio, no ids.
4. **Default-edit communication?** **Yes.** A live preview reads
   `New default affects 3 courses; 1 override remain.` before `Set Group
   Default`, and `Apply to All as Default` raises an explicit confirm naming
   both Undo steps ("set the group default … AND clear N overrides … two Undo
   steps"). The per-apply notice says "Undo reverts (one step)."
5. **Unequal corners plausible?** **Partial — engine-supported, human review
   pending.** The live pad computes `Current … 8400.0` with a −50% course
   meeting a −100% course; letters E/F pin the analytic miter tie on *both*
   corner planes and the closed unequal-criteria manifold. The close-up
   (`06-unequal-corner-*.png`) renders the pad's grading-group layer
   (`groupLayers=1`, `groupFills=1`). Aesthetic
   "does the tie look right" is left to human review of the PNGs — this harness
   asserts structure, not pixels.
6. **Flat / planar / undefined obvious?** **Partial.** The live interior badge
   is unmistakable: `Flat (z = 10.000 m)`. `Planar (slope …% · …° · aspect
   …°)` and `Undefined — blocked (CODE)` are implemented and unit-tested
   (`tests/cad_grading_group_course_ui_20e.test.tsx`) but are **not
   live-capturable**: a closed *sloped* (planar) pad fails closed in the solver
   (`CORNER_NO_SOLUTION GRADING_CORNER_SECTOR`), so no live group ever reaches a
   planar interior. The planar `DESIGNPATCH` path is pinned at the engine seam
   (20E letters J/K). No fabricated capture was substituted.
7. **No "close enough" implication?** **Yes.** Copy audit of the new +
   adjacent surfaces: `Override rejected — check the criterion values.`,
   `Apply-to-all rejected … no overrides touched.`, `Nothing to reset — selected
   courses already ride the group default.`, design patch
   `blocked — closed groups with flat or planar interiors only (…)`, preflight
   `EXACT — base … seam … max mismatch …` / `BLOCKED — <reason>`, and
   `— (Calculate the group first)`. No hedge words; failures name a cause.
8. **Snapshot feel?** **Yes.** Bake (`GROUPBAKE` → independent explicit TIN),
   design copy (`DESIGNSURFACE` → explicit TIN snapshot with revision), apply
   (`DESIGNAPPLY` keeps id/name/layer/style/role), and the sheet (pre-staged
   drawing) are all explicit, revision-guarded operations; WNCAD persists no
   results (letters G/Q).
9. **1366 usable?** **Partial (width guard pass; interaction overlap carried).**
   The requested width guard holds — 480 px manager, no horizontal overflow,
   full flow completes at 1366 with zero errors. But interaction at 1366 is
   degraded: the criteria tab, the Course 2 checkbox, and Calculate are
   intercepted by dock tab bars, so the spec falls back to dispatched clicks
   (logged at 1366: `MANAGER-CLICK-FALLBACK` ×4 — criteria tab, Apply to
   Selected, Calculate, Close — plus a `CLICK-FALLBACK` for the Course 2
   checkbox; 1920/2560 need no fallbacks). The
   expanded ribbon also squeezes the viewport (boot collapses it), and the
   surface manager shrinks the viewport to 166 px at 1366. This is the carried
   20C/20D small-viewport layout gap, unchanged by 20E.
10. **Professional CAD read?** **Partial — human review pending.** Dark CAD
    chrome, ribbon, toolspace, a C-101 title block / North Arrow / Scale Bar /
    1:500 footer, and (new this phase) real contour *lines + labels* rendering
    live in the viewport (`contourLayers=2, contourLabels=59`). Final aesthetic
    judgement is for human review of the 36 PNGs; this harness asserts DOM
    structure and counts, not appearance.

## Which captures are real vs unavailable

- **Real (live UI):** 01, 02, 03, 04, 05, 06, 08, 09, 10, 11, plus the 1366
  width-guard assertion. These drive the shipped shell (`GRADINGGROUP` →
  criteria tab → apply/calculate → Surface manager → Design Workflow →
  Profile manager) with the real engine commands.
- **Real (Node-staged sheet):** 12 — the 20C/20D/20E sheet pattern; the sheet
  interior is rendered by the app, the model is staged through engine seams.
- **Partial:** 07 — the live patch + `Flat` badge render; the `Planar` and
  `Undefined` badge branches are unavailable live (closed sloped pads fail
  closed) and are covered only by the unit test + engine letters.
- **Not attempted:** a greenfield "manual pixel eyeball" pass — the harness
  captures PNGs for human review but the automated assertions are DOM/engine
  facts.

## Carried gaps / REQUEST-CHANGES detail

No 20E-scope UI defect requires a change; no fix was needed (all §104 answers
are Yes or Partial-by-design). The following are **carried** review items,
pre-existing and outside this phase's new UI:

1. **1366 interaction overlap** (carried 20C §8 / 20D §8): the manager's
   criteria tab / checkbox / Calculate sit under dock tab bars at 1366 and need
   dispatched-click fallbacks. A real small-viewport layout pass (panel
   docking/stacking) is the fix; it is larger than 20 lines and out of scope.
2. **Closed sloped (planar) pad fails closed** in the corner solver
   (`CORNER_NO_SOLUTION GRADING_CORNER_SECTOR`) — so the Planar interior badge
   cannot be reached live. Engine limitation; the planar `DESIGNPATCH` seam is
   proven separately (20E letter J/K, `tests/cad_design_patch_planar_20e.test.ts`).
3. **Viewport crowding at 1366** — with the Surface manager open the viewport is
   166 px (07 capture); carried from 20D.

## Validation

- `npx eslint tests-browser/cad-grading-per-course-20e-visual.spec.ts` → clean.
- `npm run typecheck` → clean.
- `npx playwright test tests-browser/cad-grading-per-course-20e-visual.spec.ts`
  → 3/3 passed, zero page/console errors, all three resolutions.

Left uncommitted per the worker instruction.
