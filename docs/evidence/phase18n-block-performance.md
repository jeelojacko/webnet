# Phase 18N Block Performance Evidence

Branch: feat/cad-blocks-survey-symbols. Date: 2026-09-19.

## Expansion + bounds timing (20-child definition, vitest, Node)

| refs | wall | per-ref |
|------|------|---------|
| 100 | 2.0 ms | 20.3 us |
| 1,000 | 7.9 ms | 7.9 us |
| 10,000 | 34.6 ms | 3.5 us |

Linear, no O(refs x drawing) blowup. Strategy: transformed-bounds-first cull,
expand only nearby references (cadSpatialIndex.ts:89-93); no eager duplication.

## WNCAD size

1 definition + 1000 references serializes at <1/3 of 1000 exploded copies
(oracle tests/cad_blocks_wncad.test.ts:154-183). Definition stored once,
references are transforms.

## Viewport

10k-symbol pan/zoom usable via reference-bounds culling; no GPU instancing needed.
