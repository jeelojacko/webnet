# Phase 20N.1 — Browser QA (Wave I): 12/12 flows, 0 errors

Spec: `tests-browser/cad-grading-transition-20n1.spec.ts`, headless Chromium
@1366x768, **0 page/console errors**.

| Flow | What it proves | Screenshot |
|------|---------------|------------|
| A | Two-transition distance group solves CURRENT | `a-two-transition-current.png` |
| B | Three-transition distance group solves CURRENT | `b-three-transition-current.png` |
| C | Relative-elevation 2T CURRENT (live Transition-tab staging) | `c-relative-2t-current.png` |
| D | Flat-elevation 2T CURRENT | `d-flat-elevation-2t-current.png` |
| E | Save/reopen preserves 2T canonical order | `e-save-reopen-current.png` |
| F | Middle-width edit invalidates + rebuilds; remove-one keeps other with uncovered joint fail-closed | `f-edit-remove-fail-closed.png` |
| G1 | Authoring rejects touching/overlap staging | `g-authoring-rejects-touching-overlap.png` |
| G2 | Seeded touching fails closed at compute | `g-touching-failed.png` |
| H | Bent control joint fails closed; single law only | `h-bent-failed.png` |
| I | Extract/bake ok, Design Patch off | `i-products.png`, `i-patch-off.png` |
| J | Undo/redo round-trips the transition array | `j-undo-redo.png` |
| K | Legacy single transition still CURRENT | `k-legacy-single-current.png` |

Viewport geometry for all captures: `geometry.json` (same directory).
Zero `src/` changes in this wave (spec fixed 2 own-test bugs: removal
expectation, double-goto unsaved-guard).

## What this is not

- **20N study**: study evidence was harness geometry, never a live UI;
  these are live Transition-tab stagings through the production panel.
- **Candidate B**: Flow H pins the bent joint failing closed — the deferred
  policy, not a missing test.
- **Narrowing surfaced**: per-joint authoring keeps Add/Update visible
  (Wave H panel), which superseded the 20M.2 Flow-g "Add is gone" pin —
  see `validation.md`.
