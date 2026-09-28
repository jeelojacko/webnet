# Phase 20D visual QA — design surface workflow, 3 resolutions

Spec: `tests-browser/cad-design-surface-workflow-20d-visual.spec.ts` (3/3
green, zero page/console errors; ~8–15 s per sweep headless). Captures:
`docs/evidence/phase20d/<view>-<1366x768|1920x1080|2560x1440>.png`
(`WRITE_20D_EVIDENCE=1`). Scene (production seams: PARCEL_CREATE /
GROUP_CREATE commands, WNCAD loader): explicit-TIN EG target (the 20C
compute-test flat grid verbatim, z=0), a coarse 2-triangle EG twin (the
design-copy source — the 18Y compose exact predicates self-hit on a
same-surface diagonal, per the Wave-1C oracle header), a closed flat
100×100 pad feature line (z=10), parcel context, and a pre-built CL-Pad
alignment crossing the pad. The live sweep drives the shipped UI
throughout (Surface manager → Design Workflow panel → grading manager →
profile manager); the final sheet is a separate Node-staged drawing (full
engine apply + C-101 with viewport, title block, North Arrow, Scale Bar).
Engine letters A–Q are pinned in
`tests-browser/cad-design-surface-workflow-20d.spec.ts` (19/19 green,
headless Chromium, zero page/console errors).

## Views (per-resolution notes)

- **eg-before**: plan as opened (pad + parcel + CL-Pad). All resolutions:
  surfaces render nothing until rebuilt (UNBUILT on open — honest
  as-opened state). Center labels stack (CL-Pad / parcel area / station
  readouts overlap at fit) — legibility gap §3.
- **purpose-manager**: Surface manager + Design Workflow panel; EG marked
  Existing Ground via Set Surface Purpose (row reads `EG [EG]`).
  2560 crisp; 1366 legible, panel already crowds the viewport.
- **design-copy**: `Site Design [DESIGN]` snapshotted from the coarse twin
  (explicit copy-name input). Source select honestly reads the twin, not EG.
- **grading-group**: grading manager, Pad row Current (worker calculate,
  plan 9600.000 m² · 3D 10733.126 m², Exact). Pass at all resolutions.
- **design-patch**: `Pad - Design Patch [PATCH]` built from the CURRENT
  group; viewport shows the green pad+shell mesh. Pass.
- **apply-preflight**: Design + Patch selects → `Preflight EXACT` line with
  base/patch/overlap areas, seam length, max mismatch. Pass. (A first pass
  copying the grid EG instead of the twin answered BLOCKED — the exact
  18Y self-hit the oracle header warns about; the sweep copies the twin.)
- **final-design**: `SURFCOMPOSEPASTE (Site Design) committed`; viewport
  shows the pad plateau over EG. The design row then reads Needs Rebuild
  (stale mesh) — apply invalidates honestly; the sweep rebuilds before
  volume. Pass.
- **volume**: Volume 1 [VOLUME] Current — FILL 145333.333 / CUT 0.000 /
  Net 145333.333 (= 436000/3, the engine fixture value). Pass at all
  resolutions.
- **section-profile**: CL-Pad Design [PROFILE] Current — Covered/gap
  200.000/0.000, Min/max Z 0.000/10.000, 1/12 segments/samples; inquiry
  panel present. Pass (row-select before Rebuild required — the detail
  Rebuild renders for selection only).
- **final-sheet**: C-101 layout tab (sheet geometry count > 5, viewport
  1:500, title-block strip, scale bar). BUT the viewport interior renders
  almost blank — the CURRENT Contours-style design surface shows no
  TIN/contours/fills on the sheet (gap §4). EG Coarse + patch read
  Unbuilt in the staged drawing (only EG + Site Design rebuilt) — honest
  staged state, not cleaned.

## §108 UI quality-gate questions (honest answers)

1. **Viewport dominant at 1366×768?** Conditional — only with the ribbon
   collapsed (the spec collapses at boot; expanded ribbon + floating
   panels cover the viewport, same class as the 20C gap).
2. **Workflow completable without console errors?** Pass — full
   purpose→copy→calculate→patch→preflight→apply→volume→profile path at
   all 3 resolutions, errors `[]`.
3. **Preflight honest before commit?** Pass — EXACT stats line pre-apply;
   BLOCKED + reason post-apply (stale) and for raw shells (guidance).
4. **Failure identification?** Pass with gap — BLOCKED reasons name the
   cause; the pre-apply stale state reads in the row, not as a banner.
5. **Volume reporting?** Pass — tracked relationship + explicit Calculate
   + FILL/CUT/Net in the panel (145333.333/0/Net).
6. **Profile/section integration visible?** Pass — CURRENT profile with
   covered/gap + min/max stats over the final design.
7. **Sheet deliverable?** Gap — C-101 frame/title/scale render, but the
   design surface itself is near-invisible in the viewport (§4).
8. **Small-viewport usability?** FAIL (carried) — floating panels overlap
   the viewport at 1366; witnessed in volume/final captures (§1).

## 20C gap status (§107)

- **1366 usability**: still open — same overlap class as 20C §4; the
  20D sweep works around it (ribbon collapse, dispatched-click
  fallbacks all logged) but the layout is unchanged.
- **Sheet grading fills**: still open — the 20D final sheet shows the
  same faint-viewport class as 20B §4 / 20C §5: sheet frame renders,
  model fills do not.
