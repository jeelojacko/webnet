# Phase 18Q — Transform preview performance

Measurement only (`npx tsx scripts/phase18qTransformPerf.ts`, median-of-5,
Node, synthetic line drawings). No CI gate. No renderer rewrite.

## Preview-derivation cost (HELMERT-like rotate+translate ghost)

| Selected entities | Transform ghost | MOVE-baseline ghost | Per entity |
| --- | --- | --- | --- |
| 100 | 0.09 ms | 0.05 ms | ~0.9 µs |
| 1,000 | 0.53 ms | 0.11 ms | ~0.5 µs |
| 5,000 | 1.42 ms | 1.27 ms | ~0.3 µs |

The ghost pipeline (`buildTransformedPreviewPrimitives`, the single
derivation behind ROTATE / SCALE / MIRROR / ALIGN2D / HELMERT2D /
GRIDGROUND previews) is linear in the selection and stays under 2 ms at
5,000 entities — indistinguishable from the MOVE-baseline path at scale.
Per-entity cost falls with size (fixed Set-build overhead amortizes).

## Interaction note

Preview derivation is NOT the interaction budget. Each pointer move still
re-renders the full-scene SVG around the ghost; Phase 18P measured ~115
ms/move hover re-render with OSNAP at 1,250 entities
(`docs/evidence/phase18p-browser-qa.md`). Transform previews inherit that
same full-scene cost unchanged — this batch adds no new render path, so no
renderer rewrite was needed or attempted.

## Verdict

Ghost derivation is negligible at all measured sizes. If transform
interaction ever feels slow on large drawings, the lever is the shared
full-scene SVG rerender (18P context), not the transform preview itself.
