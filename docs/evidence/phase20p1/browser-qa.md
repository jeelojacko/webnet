# Phase 20P.1 — Browser QA: 11/11 flows, 0 errors

Spec: `tests-browser/cad-grading-transition-20p1.spec.ts`, headless Chromium
@1366x768, **0 page/console errors**.

Sparse sets `[0,2]` are staged through the live Transition tab on a
`[30, 24, 26, 30]` member line with uniform 5 m distance offsets (skipped
joints stay native-clean). Seeded-file intents are used ONLY for the
bent-joint control (flow 9) and the malformed-order control (flow 11).

| Flow | What it proves | Screenshot |
|------|---------------|------------|
| 1 | Sparse joints 0+2 solve CURRENT, both rows visible | `p1-sparse-02-current.png` |
| 2 | Width edit at joint 0; joint 2 survives with its width; stale result goes not-current until rebuild | `p2-edit-keeps-neighbor.png` |
| 3 | Consecutive neighbor creates mixed cluster [0,1,2], CURRENT | `p3-mixed-cluster-current.png` |
| 4 | Clear joint 1; joints 0+2 survive staged and still solve | `p4-clear-one-survives.png` |
| 5 | Save/reload retains sparse ids, canonical order, widths | `p5-save-reload-sparse.png` |
| 6 | Extract/bake disabled until CURRENT, then both succeed; both joints stay cited | `p6-products-cite-both-joints.png` |
| 7 | Exact-touch (half-span 50 = station gap 50) refused with touching message | `p7-exact-touch-refused.png` |
| 8 | Too-wide (60 > 2·min) and overlap refused truthfully | `p8-too-wide-overlap-refused.png` |
| 9 | Bent ACTUAL transition joint fails closed; products stay gated | `p9-bent-failed.png` |
| 10 | No transition auto-appears at skipped joint 1 | `p10-no-auto-transition.png` |
| 11 | Malformed stored order warns and fails closed, never auto-repaired | `p11-malformed-fails-closed.png` |

Viewport geometry for all captures: `geometry.json` (same directory).
Zero `src/` changes in this wave (one own-test fix: flow 11 expects the
panel's canonical display + persisting order warning, not verbatim stored
order).

## What this is not

- **20P study**: study evidence was harness geometry, never a live UI;
  flows 1–8 and 10 are live Transition-tab stagings through the production
  panel.
- **Bent skipped joints**: flow 9 pins a bent *transition* joint failing
  closed; deflected skipped-only members stay on the ordinary analytic
  corner path per the unit suite.
