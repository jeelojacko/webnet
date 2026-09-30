# Phase 20J — hybrid grading visual QA

Status: 12/12 PASS (every PNG inspected). Branch HEAD `71eae6dd`,
bundle `CadApp-DIj_MNGP.js`, Chromium 151.0.7922.34 / Playwright 1.60.0.
Coverage per frame: Hybrid label, Methods, target, CURRENT/FAILED state,
diagnostic, Extract/Bake state, metrics, containment, no clipping.

| PNG | verdict | what the frame evidences |
|---|---|---|
| `1366-hybrid-target-gate.png` | PASS | Rejection notice `Override rejected — surface grading needs a CURRENT target; pick one first.` with the Distance group unchanged; no clipping, no overflow |
| `1366-hybrid-editor.png` | PASS | Row `HybridPad · Hybrid · 4 (closed) · Right · Flat`, enabled Calculate, `Extract Grading Boundary`, redo commit `GROUP_SET_COURSE_CRITERIA(HybridPad)` |
| `1920-hybrid-editor.png` | PASS | Toolspace `HybridPad / Unbuilt / Method Hybrid` + row `Hybrid … Flat` + redo commit line; ribbon one band, no clipping |
| `2560-hybrid-editor.png` | PASS | Attach notice `1 course overridden — recalculate. Target attached (same Undo step).`, Hybrid row + Flat, Toolspace `Method Hybrid (Hybrid) … Target: Flat … Overrides:1`, redo commit line |
| `1366-hybrid-current.png` | PASS | Row `Overrides:3 · Current · Exact · 20.00–20.00 m · 9600.0`, `Extract Grading Boundary`, Flat target; Hybrid label via in-frame Toolspace tree (`HybridPad / Current / Method Hybrid (Hybrid)`, scrolled into view — the status scroll clips the row's Method cell, see framing notes) |
| `1920-hybrid-current.png` | PASS | Toolspace `HybridPad / Current / Method Hybrid` + CURRENT row with Exact/20.00–20.00/9600.0; full ribbon visible, no clipping |
| `2560-hybrid-current.png` | PASS | `Calculated — HybridPad is CURRENT.`, Toolspace `Method Hybrid (Hybrid)` with 4 GAP 28.284 m corners, CURRENT row, Extract Grading Boundary |
| `1366-hybrid-inquiry.png` | PASS | `Areas: plan 9600.000 / 3D 18733.126`, `Grading Boundary` vertices/count, 4× `GAP · miter 28.284 m` ties at the exact corners, per-course Effective rows (header `Termination: Hybrid` assertion-covered + CSV-covered, above the fold) |
| `1366-hybrid-products.png` | PASS | Row `HybridPad · Hybrid … Flat`, `GROUPBAKE (HybridPad - Baked) committed`, Toolspace `HybridPad - Baked / Unbuilt` node, `Extract Grading Boundary` action |
| `1366-hybrid-failed.png` | PASS | Row status `CORNER_NO_SOLUTION` with Flat target, dimmed Extract/Bake; method Hybrid assertion-pinned + 2560-frame Toolspace `Method Hybrid` |
| `1920-hybrid-failed.png` | PASS | Toolspace `HybridPad / Failed / Method Hybrid`, row `CORNER_NO_SOLUTION`, dimmed Extract/Bake, commit line; the row's Method cell is scrolled out with the status scroll — Hybrid label via the in-frame tree + method assertion pin |
| `2560-hybrid-failed.png` | PASS | Manager notice `Calculate failed — CORNER_NO_SOLUTION (corner 0): GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED.`, Toolspace `HybridPad / Failed / Method Hybrid (Hybrid) … Target: Flat`, dimmed products |

Framing notes (accepted, qualified per review): the manager table is wider than
the dialog at every width, so no single scroll position shows the row's Method
cell and the Tie/Area metrics together — per-width method shots scroll left
(Hybrid label) while status shots scroll right (CURRENT/FAILED + metrics), the
same split the 20H record uses. The CURRENT/FAILED status frames additionally
scroll the Toolspace tree's `Method Hybrid` row into view, so each flagged frame
carries the Hybrid label and its metrics together; the label is also pinned by
in-run `data-cad-grading-group-row-method` assertions on every flow. The inquiry
header line sits above the fold; its text is pinned by in-run assertions plus the
downloaded CSV.

## Addendum — 2026-09-30 (Phase 20J merge + Phase 20J.1)

- Original 12/12 PASS recorded above at HEAD `71eae6dd`; screenshots unchanged.
- Final PR #139 head: `74629c40c7b017b2abb664bb7dbc152cc48d1ab1`; merge
  `ffa89282c8e15e41ab959726b9ab3bc4415422aa` (base
  `6842723c935ffdbe1461225f0ef97b7ccbceee52`). Final-head CI run 36749390984,
  merge-push CI run 36750134664.
- Phase 20J.1 (persistence + tie-tolerance, baseline `ffa89282`) is not
  browser/visual in scope; no screenshots were recaptured or changed. Visual
  regression result: 12/12 green (existing 11 + new Flow F reopen regression),
  0 page / 0 console / 0 unhandled errors on head `397203c2`; no screenshots
  recaptured or changed.
- Phase 20J.1 correction PR: #140 (head `397203c2`), open, DO NOT MERGE.
