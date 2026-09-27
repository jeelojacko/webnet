# Phase 19D Manual Visual QA (§116/§117)

**Branch:** `feat/cad-parcel-network-production` · **Baseline:** `b553161e` ·
**Harness:** `scripts/phase19dVisualQa.ts` + `scripts/phase19dVisualFixtures.ts`
(`npx tsx scripts/phase19dVisualQa.ts [--quick]`) ·
**Captures:** `docs/evidence/phase19d/` (24 PNGs + the exported PDF) ·
**Status:** evidence only, **no `src/` change**. Zero page/console errors across
all three sweeps.

The harness is a standalone Playwright capture (deliberately not under
`tests-browser/`, which the parallel functional-QA worker owns). It builds every
drawing through the production document seams (`createBlankCadDrawingDocument` +
`serializeCadDrawingFile`), opens it through the real Open Drawing input, and
drives the real `/cad` shell.

## Plan under test

A realistic subdivision: parent **Remainder**, **5 numbered Lots** (24×36 m),
a **Road (R/W 1)** sharing a line with the Remainder, and an **Easement E-1**
overlay inside Lot 1. Boundaries are **mixed straight/curved**: Lot 1↔Lot 2 and
Lot 3↔Lot 4 and Lot 4↔Lot 5 share **line** courses; Lot 2↔Lot 3 share a
**curved (arc) course** (chord 36 m, bulge ±5/18, arc length 37.824 m);
Road↔Remainder share a line. Five explicit shared-boundary links. Carries a
**Parcel Course Table** (Lot 1), a **Parcel Summary (schedule) Table**, a
**Point Table**, and an **ISO A2 landscape sheet C-101** with a 1:750 viewport,
North Arrow, Scale Bar and a title block.

A second fixture (`buildFindingsProject`) deliberately corrupts the plan for the
validation view: Lot 4 shifted 6 m west (Lot 3/Lot 4 positive-area overlap), and
the Lot 2 arc bulge altered on one side only (linked arc no longer coincident).

## Captures (8 views × 3 resolutions)

| # | View | File stem | What it shows |
|---|---|---|---|
| 1 | Model plan | `model-plan-<WxH>.png` | plan as opened, designation labels, tables |
| 2 | Network Manager | `network-manager-<WxH>.png` | Toolspace Survey → Parcel Network |
| 3 | Linked boundary selected | `linked-boundary-selected-<WxH>.png` | Lot 1 selected + Properties shared rows |
| 4 | Overlap / easement validation | `overlap-easement-validation-<WxH>.png` | corrupted plan: mismatch + overlap + easement |
| 5 | Schedule | `schedule-<WxH>.png` | Toolspace Parcel Schedules node |
| 6 | Shared-edit workflow | `shared-edit-workflow-<WxH>.png` | link row + Edit Shared control |
| 7 | Sheet plan | `sheet-plan-<WxH>.png` | C-101 sheet, viewport 1:750 |
| 8 | PDF result | `pdf-result-<WxH>.png` (+ `sheet-plan-c101.pdf`) | real Export Center PDF, rasterized page 1 |

Resolutions: 1366×768, 1920×1080, 2560×1440. PDF PNGs are letterboxed to the
exact capture size.

### Method note (honesty)

This harness has no vision model available, so the review below is built from
the captured PNGs plus **rendered-DOM and display-scene probes**: viewport /
dock bounding boxes (`scripts/phase19dVisualQa.ts` layout probe), SVG text
contents, `buildCadDisplayScene` primitive strokes, and the live Toolspace /
Properties text. Where a question is a pure aesthetic judgement the answer says
so and cites the measurable proxy instead.

## Rendered-content probes (ground truth behind the captures)

- Model labels (display scene): `Lot 1 / 864.000 m² / 120.000 m`,
  `R/W 1 (ROAD) / 1120.000 m² / 188.000 m`,
  `Remainder / 3680.000 m² / 252.000 m`,
  `Easement E-1 (EASEMENT) / 168.000 m² / 52.000 m` — **the role appears in the
  label only for road/easement**, lots/remainder carry designation + area +
  perimeter.
- Primitive stroke colours: lots `#f59e0b` (amber), road `#94a3b8`
  (slate, dashed), remainder `#a78bfa` (violet), easement `#22d3ee`
  (cyan, dashed, 30 % transparent). Parcels are **stroked boundaries, not
  filled**.
- Network Manager (plan): 8 nodes; links all `CURRENT` — `Lot 1 · P2-P3 ·
  CURRENT · 36.000 m`, `Lot 3 · P4-P1 · CURRENT · 37.824 m` (arc, arc length
  not chord), `R/W 1 · P2-P3 · CURRENT · 80.000 m`. Neighbors:
  `Easement E-1 · Overlap · overlap 168.000 m²`, `Lot 2 · Linked`, …,
  `R/W 1 · Point touch`.
- Validation view: three `GEOMETRY_MISMATCH` link rows with `—` length (arc
  link + two from the Lot 4 shift); `Lot 4 · Overlap · overlap 216.000 m²`;
  `Easement E-1 · Overlap · overlap 168.000 m²`.
- Schedule: `8 parcels · 9235.641 m² · 0.9236 ha`; rows Designation / Role /
  Area / n crs (`Easement E-1 · Easement · 168.000 m²`, `Lot 2 · Lot ·
  933.473 m²`, `R/W 1 · Road · 1120.000 m²`, …).
- Properties (Lot 1 selected): `Plan Designation Lot 1`, `Plan Role Lot`,
  `Description Corner lot with drainage easement`, `Linked Boundaries 1`,
  `Shared With Lot 2 · P4-P1`, `Shared Status CURRENT`, `Shared Length 36.000`.
- Sheet scene C-101: 124 texts incl. all lot labels, `PARCEL SCHEDULE`,
  `N (grid)`, `10 m @ 1:750`, `C-101`, `594x420mm`; status bar
  `Layout1 | Viewport: 1:750`.
- Layout: canvas **814×165** @1366 (ribbon 310 px + command dock 148 px),
  **1368×528** @1920, **2008×914** @2560; sheet SVG fixed **849×600** at all
  three; toolspace dock 247 px; properties dock 271 px.

## §117 quality answers

1. **Numbered lot clarity — PASS.** Every lot renders a centre label with
   designation, exact area and perimeter (`Lot 1 … Lot 5`), both in the model
   and on the sheet; the course table is titled `LOT 1 — COURSE TABLE`.
2. **Lot/remainder/easement/ROW distinction without legal implication —
   PASS with a presentation note.** The product distinguishes by designation
   and by a role suffix in the label for overlay roles (`R/W 1 (ROAD)`,
   `Easement E-1 (EASEMENT)`), plus `Plan Role` in Properties/Toolspace. Colour
   distinction is **not automatic**: the product deliberately leaves role
   appearance to layer/style, so the fixture assigned per-entity appearance
   (amber lot, slate dashed road, violet remainder, cyan dashed easement). No
   wording implies ownership/legal status.
3. **Shared-boundary comprehensibility — PASS.** Each link is shown
   bidirectionally as `Neighbour designation · own course pair · status ·
   shared length` with Unlink/Edit Shared controls, and Properties repeats
   `Shared With / Shared Status / Shared Length`. The curved link reports the
   **arc length 37.824 m**, never the chord.
4. **Broken/mismatch obviousness — PARTIAL.** `GEOMETRY_MISMATCH` is printed in
   the link row with a `—` length, the neighbour relation degrades
   (`Point touch`/`Overlap`), and overlap prints `overlap N m²`. There is **no
   severity colour, banner or viewport overlay** (§71 overlay is explicitly
   deferred), so a mismatch is text-obvious only after reading the manager.
5. **Parcel Schedule professionalism — PARTIAL.** The live Toolspace schedule
   is legible and compact (Designation / Role / Area / course count, arithmetic
   totals with the "not a union" note), but the node omits the perimeter column
   the engine row carries, has no CSV/print path, and there is **no persisted
   `parcel-schedule` survey-table kind** (deferred per the architecture audit).
   It is a QA list, not yet a printable schedule table.
6. **Easement overlay distinctness — PASS with a note.** The easement is a
   cyan, dashed, 30 %-transparent outline labelled `(EASEMENT)` nested inside
   Lot 1, clearly readable. It is an outline, not a fill/hatch, and distinctness
   depends on the operator assigning the appearance.
7. **Compact Network Manager — PASS.** 247 px dock; one-line parcel summaries
   (designation / area / linked count), links and neighbours in expandable
   detail; 8 parcels + 10 link rows fit without horizontal scroll.
8. **Plausible sheet output — PASS with notes.** ISO A2 landscape, 1:750,
   North Arrow, Scale Bar (`10 m @ 1:750`), viewport status, lot labels,
   Parcel Schedule + Course table; title-block frame carries `C-101 /
   594x420mm` (the fixture's template has no authored fields). The sheet renders
   at a fixed 849×600 px and does not grow at 2560.
9. **Viewport dominance — FAIL @1366, PARTIAL @1920, PASS @2560.** The model
   canvas is 814×165 px (**20 %** of 768) at 1366 because the ribbon wraps to
   310 px and the command dock is 148 px; 1368×528 (49 %) at 1920; 2008×914
   (63 %) at 2560. Same dock/ribbon cramping class recorded for 18B/18T/18V.
10. **No invented legal facts — PASS.** No owner / PID / deed / plan-number /
    tenement field exists in the schedule, properties or labels; the only
    role/description text is explicit drawing data; the sheet/UI carries the
    "Draft plan — not a legal or certified survey document" note. The
    `(EASEMENT)`/`(ROAD)` label suffix and `Plan Role` are display metadata.

## Product findings (repro only — no fix applied)

**F1 — FIXED in the fix wave (was: all seven Phase 19D network commands unreachable from the UI).** The registry declares `PARCELDESIGNATE`, `PARCELNUMBER`, `PARCELLINK`, `PARCELUNLINK`, `PARCELCHECK`, `PARCELSCHEDULE`, `PARCELSHAREDEDIT`; the fix wave added all seven to `ActiveCommandKey` (`src/hooks/surveyCad/useSurveyCadCommandTypes.ts:121-127`), seven `shellStarters` entries (`useSurveyCadCommandStarters.ts:124`), and one compact submit file (`useSurveyCadParcelNetworkSubmit.ts`) committing through the registered engine commands. Ribbon/Toolspace enablement is type-enforced (`Record<ActiveCommandKey,…>` completeness fails tsc until every entry exists) and both surfaces gate on `availableCommands`. Only **Unlink** worked before; all seven starters are live after. The UI-wave snapshot tests hand-populated `availableCommands`, which is why they passed while the live wiring was missing.

**F2 — FIXED in the fix wave (was: shared-edit workflow engine-only).** `applyParcelSharedEdit` existed at the engine tier; the fix wave added a `PARCELSHAREDEDIT` input session (`from x,y` / `to x,y` / `line` / `bulge <n>`, `useSurveyCadParcelNetworkSubmit.ts:handleSharedEdit`), shell wiring (`SurveyCadWorkspace.tsx:1443-1449,1954-1955`), and a per-link Toolspace "Edit Shared" path via optional `startParcelSharedEdit(linkId)` (`CadParcelToolspace.tsx:72-98`, falls back to `startCommand`); the Properties row action routes to it and the engine "session required" disabled-reason is removed. Captured `shared-edit-workflow-*.png` predates the fix; the workflow is now startable from the manager.

**F3 — partial shared edge is classified `POINT_TOUCH`.** Lot 5 (east course
x=120, y 0–36) and R/W 1 (west course x=120, y 0–80) share a **segment** but not
a whole course; the network reports `R/W 1 · Point touch` / `Lot 5 · Point
touch` (see `network-manager-*.png`). Mission §"Partial-course link deferred"
means no link is created, and the fix wave confirmed decision (a): the
`POINT_TOUCH` fallback stands (no new adjacency class for sub-course segment
sharing), documented in a code comment at `relationFor` and pinned by test.
The neighbour row honestly reports the classifier's whole-course knowledge.
Repro: the QA plan is fixed; the Toolspace neighbour row reads
"Point touch".

**F4 — 1366 viewport dominance** (see §117.9) — dock/ribbon cramping, not a 19D
regression but it is the QA plan's worst presentation at the smallest size.

**F5 — performance: FIXED in the fix wave, cross-reference refreshed.** `docs/evidence/phase19d-parcel-network-performance.md` now records the post-fix probe (verified 2026-09-27): 1,000 parcels 24.6 ms (dense) / 4.25 ms (sparse, exponent 1.29), 10,000 dense 389 ms. Residual restriction: the candidate scan is still an all-pairs bbox-compare (no grid index). Not a visual defect.

No other rendering defects were observed in the captured views; the curved Lot
2/Lot 3 boundary tessellates as the minor arc (no full-circle ghost) and the
sheet viewport shows the same geometry.
