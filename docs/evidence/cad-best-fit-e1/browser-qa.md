# CAD Best Fit E1 — browser QA (flows A–G)

Spec: `tests-browser/cad-draw-best-fit-e1.spec.ts`. Production build
(`npm run build`), headless Chromium, blank disposable drawings, one
viewport (1366×768). **7/7 pass, zero page errors, zero console errors,
zero unhandled rejections.** Screenshots + `geometry.json` live in
`docs/evidence/cad-best-fit-e1/`.

| Flow | What it proves | Shots |
|---|---|---|
| A: flyout | 3 live rows, 0 disabled, 3 distinct curated icons; selecting arc then parabola moves the sticky face with the right icon | `A-bestfit-flyout.png` |
| B: line | `BESTFITLINE` prompt shows minimum 2; count updates per sample; preview renders at 2 samples; empty Enter commits; COGO panel shows `Best Fit Line` + `Sample count`; saved file has one open 2-vertex polyline (no `segmentGeometry`), one `BEST_FIT_LINE` computation with 4 residual rows; undo→0, redo→1 | `B-line-preview.png`, `B-line-report.png` |
| C: arc | `BFA` alias starts `BESTFITARC`; empty Enter at 2 samples refuses (`at least 3 samples`) with 0 entities; 4th sample + Enter commits a native arc (center ≈ origin, r ≈ 10); 4 residual rows; undo/redo | `C-arc-committed.png` |
| D: parabola | Ribbon flyout row starts `BESTFITPARABOLA` (minimum 5); 6 rotated-parabola samples (37° axis fixture) preview then commit; saved parabola has focal ≈ 2 and `tEnd > tStart`; 6 residual rows; Properties shows the `Parabola` type rows | `D-parabola-preview.png`, `D-parabola-properties.png` |
| E: aliases/sticky | Ribbon selection sets the sticky face to `BESTFITARC`; typed `BFL` starts the line session without moving the face; `U` on empty reports nothing-to-undo; Escape cancels with 0 entities; typed `BFP` likewise keeps the face | — |
| F: failure | Collinear arc samples refuse (`could not fit`), stay active, 0 entities, 0 computations; Escape cancels cleanly | — |
| G: autocomplete | Idle `BF` suggests `BESTFITLINE` (typed entry still discovers the keys) | — |

## Visual review notes

- `B-line-report.png` (regenerated post-fix): committed `BFL1` polyline selected; `LATEST COGO
  RESULT` shows Method / Sample count / RMS / Max / Azimuth / Bearing /
  Span with NO `Source points` row — the four samples are free picks
  (labels `P1..P4` appear only in the residual table). Properties shows
  `Created by BEST_FIT_LINE`, 2 vertices, open.
- `D-parabola-properties.png`: committed `BFP1`; report shows the rotated
  geometric method with vertex (100.001, 50.000), focal ≈ 2.0 (the 37°
  fixture value, asserted in flow D), axis azimuth 52°59'53";
  Properties `Type: Parabola` with vertex/axis rows.
- Ribbon faces in every shot carry the new best-fit glyphs (line / arc /
  parabola through points), distinct from the neighboring Arc/Circle faces.
