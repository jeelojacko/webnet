# Phase 18P — Annotation Browser QA + Performance Evidence

Branch: `perf/cad-annotation-production-hardening`
Baseline: `fef23556b16cd0fdfc87353bef2a98126ddb753d` (18O merge, PR #105)
Prior evidence: `docs/evidence/phase18o-annotation-performance.md`
Hardening map: `docs/evidence/phase18p-annotation-hardening-map.md`
Generated: 2026-09-20. No `src/` behavior changes in this slice —
measurement + docs only.

This document closes the 18P hardening items **R2 (manual visual QA)** and
the QA half of **R3 (O(n²) lookup/export)**. It records:

1. the FINAL 18P performance numbers against the 18O evidence doc and a fresh
   same-machine baseline probe;
2. the associative-creation browser results (Playwright A–G through production
   commands);
3. three-resolution screenshots of a plan fixture carrying every required
   annotation kind;
4. print-scale number behavior at 1:250 / 1:500 / 1:1000;
5. large-annotation (≈1000) load + cursor-move/OSNAP responsiveness;
6. restrictions and known flags.

## 1. Performance — before / after

Probe (unchanged method, same warm-up + median-of-3 / single-run-at-10k):
`npx vitest run src/engine/cad/annotation/__tests__/cadAnnotationPerf.test.ts`.
No absolute-time assertions; the file asserts only structural invariants.

Columns measured: `buildCadDisplayScene` (derived), one
`entityIntersectsBounds` per entity (bounds scan, now threaded with a shared
`buildCadProjectLookup`), one `buildCadSpatialIndex(project).queryNearestSnap`
call, `primitiveBounds` over every primitive (hit-test prep),
`buildExportSheetSceneWithResult` (export scene) and
`serializeExportSceneToSvg` (SVG). 18O's per-entity mix (40 % mtext, 20 %
leaders, 25 % dimensions, 15 % bearing labels) is byte-for-byte the same, and
the primitive count is **identical** between baseline and 18P
(370 / 3,700 / 37,000), so the comparison is like-for-like. (The 18O evidence
doc quoted 510 / 5,100 / 51,000 primitives; re-running its own probe at
`fef23556` on this machine yields 370 / 3,700 / 37,000 and the same ratio
shape, so the doc's absolute columns are from an earlier test iteration. The
fresh same-machine baseline below is the rigorous comparison and reproduces
the doc's documented export-scene blow-up: 14.3× then 74.1× per decade.)

### 1.1 Mixed annotation scaling

| entities | primitives | run | derivedMs | boundsScanMs | snapQueryMs | hitTestMs | exportSceneMs | svgMs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 125 (100 ann) | 370 | 18O doc | 0.42 | 0.12 | 0.19 | 0.15 | 1.34 | 0.34 |
| 125 (100 ann) | 370 | baseline (fef23556, this machine) | 0.559 | 0.265 | 0.404 | 0.2 | 1.437 | 0.246 |
| 125 (100 ann) | 370 | **18P run 1** | 0.638 | 0.285 | 0.067 | 0.224 | 0.749 | 0.261 |
| 125 (100 ann) | 370 | 18P run 2 | 0.752 | 0.419 | 0.07 | 0.215 | 1.289 | 0.248 |
| 1,250 (1,000 ann) | 3,700 | 18O doc | 4.09 | 1.14 | 3.66 | 0.38 | 42.7 | 3.41 |
| 1,250 (1,000 ann) | 3,700 | baseline (fef23556, this machine) | 5.835 | 3.772 | 2.747 | 0.346 | 20.491 | 2.677 |
| 1,250 (1,000 ann) | 3,700 | **18P run 1** | 6.136 | 1.164 | 0.33 | 0.334 | 7.225 | 2.593 |
| 1,250 (1,000 ann) | 3,700 | 18P run 2 | 6.992 | 1.382 | 0.191 | 0.331 | 7.101 | 3.059 |
| 12,500 (10,000 ann) | 37,000 | 18O doc | 56.5 | 20.5 | 64.4 | 3.00 | 2,414.6 | 62.3 |
| 12,500 (10,000 ann) | 37,000 | baseline (fef23556, this machine) | 37.706 | 19.088 | 63.211 | 2.996 | 1,519.103 | 56.108 |
| 12,500 (10,000 ann) | 37,000 | **18P run 1** | 32.074 | 12.778 | 2.254 | 2.465 | 54.13 | 34.987 |
| 12,500 (10,000 ann) | 37,000 | 18P run 2 | 33.554 | 12.069 | 2.037 | 2.376 | 54.579 | 30.831 |

Absolute values vary per machine/run (sub-ms cells especially). The two 18P
runs agree on the shape; run 1 is quoted as the FINAL number below.

### 1.2 Scaling ratio per decade (×10 entities each step; linear = 10×)

| decade | source | derived | bounds | snap-query | export-scene | svg |
| --- | --- | --- | --- | --- | --- | --- |
| 125 → 1,250 | 18O doc | 9.9× | 9.6× | 19.8× | 31.8× | 10.2× |
| 125 → 1,250 | baseline (this machine) | 10.4× | 14.2× | 6.8× | 14.3× | 10.9× |
| 125 → 1,250 | **18P run 1** | 9.6× | 4.1× | 4.9× | 9.6× | 9.9× |
| 1,250 → 12,500 | 18O doc | 13.8× | 18.0× | 17.6× | 56.5× | 18.2× |
| 1,250 → 12,500 | baseline (this machine) | 6.5× | 5.1× | 23.0× | 74.1× | 21.0× |
| 1,250 → 12,500 | **18P run 1** | 5.2× | 11.0× | 6.8× | 7.5× | 13.5× |

**Result.** The second-decade export-scene blow-up is gone: 56.5× (18O doc) /
74.1× (fresh baseline) → **7.5×** (18P), i.e. 54.13 ms at 10,000 annotations
instead of 1,519 ms on the same machine (**28× faster**). Snap-query at
12,500 dropped 63.2 ms → 2.25 ms (**28× faster**) and is now linear-ish
(4.9× / 6.8× per decade). Bounds scan at 12,500 dropped 19.1 ms → 12.8 ms
with a 4.1× first decade. Derived geometry improved 37.7 ms → 32.1 ms and the
10,000 tail is no longer superlinear. SVG stays allocation-bound (13.5×),
unchanged by design.

### 1.3 Per-entity / per-primitive cost (18P run 1, µs)

| entities | derived µs/entity | bounds µs/entity | hit-test µs/primitive | svg µs/entity |
| --- | --- | --- | --- | --- |
| 125 | 5.104 | 2.28 | 0.605 | 2.088 |
| 1,250 | 4.909 | 0.931 | 0.09 | 2.074 |
| 12,500 | 2.566 | 1.022 | 0.067 | 2.799 |

### 1.4 Associative update (one edited source line, 1,000 lines + 1,000 labels)

| measurement | 18O doc | baseline (this machine) | **18P** |
| --- | --- | --- | --- |
| affected label re-derivation (1 of 1000) | 0.001 | 0.001 | 0.001 |
| all labels derived standalone (1000) | 0.69 | 0.653 | 0.72 |
| full scene rebuild (1000 lines + 1000 labels) | 6.51 | 6.65 | **2.243** |
| scene rebuild, lines only | 0.53 | 0.523 | 0.546 |
| label share of full rebuild | 5.98 | 6.127 | **1.697** |
| full rebuild ÷ affected | ~5,045× | 5,236× | 1,687× |
| label share ÷ all-labels | 8.7× | 9.4× | **2.36×** |

The O(n) source lookup inside the label builders is fixed (label share ÷
all-labels 8.7× → 2.36×). The whole-scene re-derive per edit remains
(1,687× the affected-label cost): the entity-keyed derivation cache /
source→dependent index named in R3 is still **not** implemented — this is a
remaining optimization, not a regression.

## 2. Associative creation browser QA (Playwright A–G)

Spec: `tests-browser/cad-annotation-18p.spec.ts` — 9/9 green (7 new A–G plus
the 18O 2/2), every test driving real production commands (ribbon, canvas
picks with OSNAP, Properties edits, MOVE/ERASE/UNDO/REDO, WNCAD save/reopen)
with zero page/console errors asserted per test. No engine injection.
Persistence assertions read the saved `.wncad` JSON and assert the anchor
**object kind**, not just the on-screen position.

| test | creation path | persisted anchor kind(s) | follow-up proof |
| --- | --- | --- | --- |
| A. leader → survey point | LEADER, OSNAP survey-point pick | `arrowAnchor.kind: 'survey-point'`, `entityId` = point id | source MOVE moves the point; shaft start stays <4 px from the marker |
| B. aligned dimension | DIMALIGNED, two endpoint snaps | two `anchors`, both `'line-endpoint'` on the same entity, `endpoint: 'start'` then `'end'` | source Length +10 → Measured tracks (+10) |
| C. radius dimension | DIMRADIUS, arc endpoint snap (nearest disabled) | one `anchors[0].kind: 'arc-point'`, `entityId` = arc id | source Radius +5 → Measured +5 |
| D. block-insertion leader | LEADER on a block insertion pick | `arrowAnchor.kind: 'block-insertion'`, `entityId` = reference id | Properties Insertion E +8 → shaft-to-grip distance stays <6 px (MOVE is not used for blocks, see §6) |
| E. free pick leader | LEADER on empty canvas | `arrowAnchor.kind: 'fixed'` with numeric x/y | persisted vertices numeric |
| F. midpoint snap leader | LEADER on a line midpoint | `arrowAnchor.kind: 'fixed'` | source MOVE → leader-to-midpoint distance grows >30 px (does **not** follow) |
| G. broken-ref flow | LEADER on a line endpoint (`'line-endpoint'`) | `'line-endpoint'` persisted | see below |

### 2.1 Broken-reference flow (test G)

1. source line ERASEd → viewport shows `BROKEN`, Properties leader-status
   reads `broken`;
2. UNDO restores the source → `BROKEN` disappears (CURRENT);
3. REDO breaks it again;
4. WNCAD save/reopen preserves the still-broken `line-endpoint` reference and
   the `broken` status + `BROKEN` marker survive the reopen.

The anchor is never silently repaired or rebound by station name.

## 3. Screenshots (1366×768 / 1920×1080 / 2560×1440)

Captured by `scripts/phase18pBrowserQa.ts` against the shipped `/cad` app
(dev server), loading a real `.wncad` fixture through the production
Open-drawing input. Full-page, PNG:

- `docs/evidence/phase18p/plan-1366x768.png`
- `docs/evidence/phase18p/plan-1920x1080.png`
- `docs/evidence/phase18p/plan-2560x1440.png`
- `docs/evidence/phase18p/large-1000-annotations.png` (1920×1080, ≈1000 annotations)

Plan fixture (17 entities, all rendered 17/17 with **no BROKEN markers**):
MText (2 lines), Leader (associative survey-point anchor), Linear + Aligned +
Angular + Radius + Diameter dimensions (linear carries a manual `textPoint`),
Bearing label, Curve label, a native block reference (`qa-monument`), 2
control/free survey points and 2 field-to-finish coded survey points
(`featureCode` `TREE `/`F2F`). Rendered viewport text observed at 1920×1080:

```
120°00'00"R 8.000 mL 16.755 m        (arc geometry label)
PHASE 18P QA PLAN / 1:500           (MText)
BOUNDARY PIN                        (Leader)
40.000 | 30.000 | 90.000° | 8.000 | 16.000   (linear/aligned/angular/radius/diameter)
N90-00-00.00E40.000                 (bearing-distance label)
R 8.000Δ 120°00'00"L 16.755         (curve label)
```

The fixture is generated by the capture script itself (no committed binary
fixture needed); the arc uses a 120° minor sweep so the curve label derives
(a 180° arc is correctly rejected by the curve-metrics guard).

## 4. Print-scale QA — 1:250 / 1:500 / 1:1000

Full headless paper QA is not exercised here (blank drawings expose no
sheet-creation UI; SVG/PDF are sheet deliverables — see §6). Instead the
annotation **scale contract** is verified numerically through the exact
engine metrics the renderer uses (`resolveCadAnnotationTextMetrics`,
`paperHeightMmToModelMeters`), for a 2.5 mm paper text style, a 2.5 m model
text style and a legacy-screen style:

| scale | paper text model height | paper text on paper | model text model height | model text on paper | legacy text model height | legacy text on paper |
| --- | --- | --- | --- | --- | --- | --- |
| 1:250 | 0.625 m | **2.50 mm** | 2.500 m | 10.00 mm | 11.000 m | 44.00 mm |
| 1:500 | 1.250 m | **2.50 mm** | 2.500 m | 5.00 mm | 11.000 m | 22.00 mm |
| 1:1000 | 2.500 m | **2.50 mm** | 2.500 m | 2.50 mm | 11.000 m | 11.00 mm |

- **Paper-height text** keeps a constant 2.50 mm on paper at every scale (its
  model height grows with the denominator).
- **Model-height text** keeps a constant 2.5 m in model space, so its paper
  height scales with the plot scale (5 mm → 10 mm as the scale grows).
- **Legacy labels** are model-height (screen units) and behave like model text.
- **Arrowheads**: paper-mode 2.5 mm → 0.625 m / 1.250 m / 2.500 m model
  (2.5 mm constant on paper); model-mode arrows stay 2.5 m at every scale.

Exact procedure: run `npx tsx scripts/phase18pBrowserQa.ts` (§7); the
print-scale table above is printed by the script. What is **not** verified
headless: the sheet SVG/PDF text-height rounding path
(`heightMm: max(0.5, fontSize * 0.35)` in `cadExportScene.ts`). That factor is
independent of the viewport plot scale and predates 18P; the annotation-scale
behavior above is the model-side contract that feeds it. Full paper
verification remains a manual sheet-export task.

## 5. Large-annotation responsiveness (≈1000 annotations, OSNAP on)

Fixture: 1,250 entities (≈1000 annotations + 250 source lines), the same mix
as the perf probe. Open-drawing input → first render polled via the entity
count.

| measurement | value |
| --- | --- |
| entities | 1,250 (rendered 1,250) |
| SVG nodes in viewport | 15,255 |
| open → rendered | **779 ms** |
| blank-page cursor sweep (120 real Playwright moves) | 1,975 ms (~16.5 ms/move), 0 long tasks |
| 1,000-annotation cursor sweep (240 real moves, OSNAP on) | **27,588 ms (~115 ms/move)**, 239 long tasks totalling **26,173 ms blocked** |
| page/console errors | none |

Observation (no ms gate): loading and first render of a 1,250-entity
annotation drawing is sub-second and clean. Interactive cursor movement with
OSNAP on is **not** responsive at this size — essentially every move is a
main-thread long task. The snapping math itself is cheap: the probe's
`queryNearestSnap` is 0.33 ms at 1,250 and 2.25 ms at 12,500 (§1), so the
per-move cost is consistent with a **whole-viewport React re-render** of the
15 k SVG nodes (plus overlay/badge updates), not with the spatial index. This
is recorded as a restriction and a follow-up target; it is not addressed in
18P (rendering/React virtualization is outside the hardening map's R1–R4).

## 6. Restrictions and known flags

- **MOVE duplicates block references (out of scope — 18Q owns transforms).**
  The production MOVE command re-inserts block references, so moving a block
  reference via MOVE duplicates it. Test D therefore proves block-insertion
  association through a Properties Insertion edit, not MOVE. Recorded as a
  restriction; do not fix here.
- **Sheet SVG/PDF text rotation forwarded (18P closed).** `cadExportScene.ts:primitiveToPaper` forwards `rotationDeg` into paper text, so curve/bearing/dimension rotation renders in SVG (`transform=rotate`) and PDF (`Tm`) as well as viewport + DXF. Non-rotated rows serialize byte-identically.
- **DXF alignment APPROXIMATED.** Derived DXF TEXT rows are left/baseline
  aligned (no group 72/73 pair), so a rotated row turns about its left
  baseline rather than the display primitive's start/middle/end anchor.
  Unrotated rows are exact.
- **Whole-scene re-derive per edit remains.** After any edit the renderer
  reconstructs every annotation (1,687× the affected-label cost); the
  entity-keyed derivation cache / source→dependent index is not implemented
  (§1.4).
- **Large-drawing hover re-render.** §5: ~115 ms/move with OSNAP at 1,250
  entities, dominated by SVG re-render, not snapping.
- No absolute-time gate is asserted anywhere in this evidence.

## 7. Reproduction

```
# terminal 1
npm run dev -- --host 127.0.0.1 --port 4174
# terminal 2
npx tsx scripts/phase18pBrowserQa.ts            # screenshots + print-scale + responsiveness
npx tsx scripts/phase18pBrowserQa.ts --no-sweep # screenshots + print-scale only (~10 s)
npx vitest run src/engine/cad/annotation/__tests__/cadAnnotationPerf.test.ts --reporter=verbose
npx playwright test tests-browser/cad-annotation-18p.spec.ts
```

The capture script builds both `.wncad` fixtures in the OS temp dir, drives
the production Open-drawing input, writes the PNGs under
`docs/evidence/phase18p/`, and prints the tables above. It never asserts a
time budget.
