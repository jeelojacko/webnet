# Phase 19B — Sheet/Layout Performance Evidence

Branch: `feat/cad-professional-sheet-layouts` (Round 3F).
Date: 2026-09-26.
Method: `tests/evidence/phase19b_sheet_layout_performance.test.ts` (evidence tier,
manual-only) on Node v26.8.1, AMD Ryzen 7 5800X3D, 16 threads.
Numbers are a single representative run; wall-clock is indicative, not a gate.
No absolute-time assertions exist in the test — only output sanity checks.

Purpose: confirm Round 3F mission §§102-103/128 — the canonical sheet pipeline
scales linearly and no culling is required at the stated scales.

## 1. Scene pipeline — one viewport

Synthetic project of N straight-line entities (1 display primitive each),
1 sheet, 1 viewport at 1:500, 0 deg. Warm-up derive excluded from phases.

| entities | primitives | scene items | display (ms) | visibility filter (ms) | paper mapping (ms) | derive scene (ms) | SVG (ms) | PDF (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 | 10,000 | 10,003 | 8.3 | 5.8 | 0.7 | 27.4 | 12.2 | 8.1 |
| 50,000 | 50,000 | 50,003 | 22.5 | 8.6 | 0.6 | 92.8 | 39.2 | 31.4 |
| 100,000 | 100,000 | 100,003 | 41.5 | 18.1 | 2.0 | 119.2 | 123.5 | 74.3 |

Payload sizes: SVG 1.6 MB / 8.2 MB / 16.5 MB; PDF 0.54 MB / 2.8 MB / 5.6 MB.

## 2. Scene pipeline — four viewports

Same project, 1 sheet, 4 independently transformed viewports (rotations
0/10/20/30 deg). Every viewport re-projects the full sorted scene; clip
rects and layer-override sets are per viewport.

| entities | primitives | scene items | display (ms) | visibility filter (ms) | paper mapping (ms) | derive scene (ms) | SVG (ms) | PDF (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 | 10,000 | 40,003 | 3.6 | 1.9 | 0.3 | 22.0 | 28.5 | 29.5 |
| 50,000 | 50,000 | 200,003 | 15.1 | 7.6 | 2.1 | 107.0 | 204.4 | 165.9 |
| 100,000 | 100,000 | 400,003 | 31.5 | 18.2 | 2.7 | 192.4 | 331.3 | 406.4 |

Payload sizes: SVG 7.0 MB / 35.4 MB / 71.3 MB; PDF 2.3 MB / 11.9 MB / 24.1 MB.

Derivation cost grows roughly linearly with `viewports x primitives`; SVG/PDF
serialization grows with the item count and, at 400k items, dominates the
pipeline. That is output volume, not an algorithmic problem — culling would
only matter if a target device could not afford the bytes either.

## 3. Sheet scale — metadata, all-sheet scene generation, all-sheet PDF

Project of 1,000 entities. `switchMs` = derive the last sheet of an
N-sheet draft (tab-switch work). `allScenesMs` = derive every sheet.
`allPdfMs` = serialize every derived scene into one PDF.

| sheets | switch (ms) | all scenes (ms) | all-sheet PDF (ms) | PDF bytes |
|---:|---:|---:|---:|---:|
| 10 | 1.2 | 9.1 | 5.8 | 529,234 |
| 50 | 0.8 | 37.4 | 26.0 | 2,645,014 |
| 100 | 0.7 | 70.1 | 51.5 | 5,289,916 |

Sheet metadata lookup is O(sheets) via `findIndex` on the active sheet and is
sub-millisecond even at 100 sheets; per-sheet derivation dominates and stays
linear.

## 4. Paper-only derivation

One sheet, 0 viewports, title block assigned + one plan note; derive repeated
1,000 times: **10.6 ms total, ~11 us/derive**. Paper-space work (title block
tokens, note objects, fragment tables, color backfill) is negligible beside
model projection.

## 5. Token resolution

`buildSheetTokenContext` did not register measurable time (<0.05 ms).
`expandSheetTokens` over a 10-token template, 10,000 iterations:
**15.4 ms total, ~1.54 us/call**.

## 6. Breakdown verdict

- **Derivation** (`buildCadDisplayScene`): linear in entities; 41.5 ms at 100k.
- **Visibility filtering** (`filterCadDisplaySceneForViewport`): linear;
  18.1 ms at 100k, ~15% of the display pass.
- **Mapping** (`modelToPaperPoint` per primitive): 2.0 ms per 100k calls;
  not a bottleneck.
- **Canonical sheet-scene derivation** (`deriveSheetScene`): one viewport
  119 ms at 100k; four viewports 192 ms at 100k. Reuses one display scene,
  so it is not 4x the one-viewport pass.
- **Paper derivation**: ~11 us/sheet; negligible.
- **Serialization** (SVG/PDF): grows with output volume; 331/406 ms for
  400k items. The only phase worth watching, and only at extreme output size.

Mission §§102-103/128 fall out as: no culling, no caching, no premature
optimization. The pipeline is linear at every measured scale; the cost that
grows fastest is the serialized output itself.
