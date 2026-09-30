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
| `1366-hybrid-current.png` | PASS | Row `Overrides:3 · Current · Exact · 20.00–20.00 m · 9600.0`, `Extract Grading Boundary`, Flat target |
| `1920-hybrid-current.png` | PASS | Toolspace `HybridPad / Current / Method Hybrid` + CURRENT row with Exact/20.00–20.00/9600.0; full ribbon visible, no clipping |
| `2560-hybrid-current.png` | PASS | `Calculated — HybridPad is CURRENT.`, Toolspace `Method Hybrid (Hybrid)` with 4 GAP 28.284 m corners, CURRENT row, Extract Grading Boundary |
| `1366-hybrid-inquiry.png` | PASS | `Areas: plan 9600.000 / 3D 18733.126`, `Grading Boundary` vertices/count, 4× `GAP · miter 28.284 m` ties at the exact corners, per-course Effective rows (header `Termination: Hybrid` assertion-covered + CSV-covered, above the fold) |
| `1366-hybrid-products.png` | PASS | Row `HybridPad · Hybrid … Flat`, `GROUPBAKE (HybridPad - Baked) committed`, Toolspace `HybridPad - Baked / Unbuilt` node, `Extract Grading Boundary` action |
| `1366-hybrid-failed.png` | PASS | Row status `CORNER_NO_SOLUTION` with Flat target, dimmed Extract/Bake; method Hybrid assertion-pinned + 2560-frame Toolspace `Method Hybrid` |
| `1920-hybrid-failed.png` | PASS | Toolspace `HybridPad / Failed / Method Hybrid`, row `CORNER_NO_SOLUTION`, dimmed Extract/Bake, commit line |
| `2560-hybrid-failed.png` | PASS | Manager notice `Calculate failed — CORNER_NO_SOLUTION (corner 0): GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED.`, Toolspace `HybridPad / Failed / Method Hybrid (Hybrid) … Target: Flat`, dimmed products |

Framing notes (accepted, no recapture): the manager table is wider than
the 1366 dialog, so per-width method shots scroll left (Hybrid label)
while status shots scroll right (CURRENT/FAILED + metrics) — the same
split the 20H record uses. The inquiry header line sits above the fold;
its text is pinned by in-run assertions plus the downloaded CSV.
