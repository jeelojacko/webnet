# Phase 18F fix-up — multi-group surface build performance

Measurement only. Synthetic deterministic grids (mulberry32, seed `0x18f`;
~10 m spacing + ≤2 m jitter, Z = 100 + 0.5·col + 0.3·row + rand) behind TWO
overlapping point groups (`g-all` matches all, `g-low` matches Z ≤ 103),
so every build exercises the multi-group union path. Source: explicit
two-group `pointGroupIds` surface, no breaklines/boundaries.

Method: `npx tsx scripts/phase18fSurfacePerf.ts` (1 warm-up + 5 measured
runs per scale, median wall-time). `buildMs` = `buildCadSurface` end to end
(source resolution + triangulation + constraints + domain filter);
`edgesMs` = display-edge generation (`surfaceTrianglesPathD` +
`surfaceBoundaryPathD`).

## Results (Node 22, Linux x64, this machine)

| points | buildMs (med) | edgesMs (med) | triangles | vertices |
| --- | --- | --- | --- | --- |
| 100 | 1.3 | 0.2 | 187 | 100 |
| 1,000 | 10.6 | 2.2 | 1,980 | 1,000 |
| 10,000 | 97.0 | 21.1 | 19,978 | 10,000 |
| 50,000 | 552.7 | 179.8 | 99,967 | 50,000 |

All builds `ok`. Growth is ~linear through 50k; 10k rebuilds in ~120 ms
total, well within manual-rebuild tolerance. 50k was tried because 10k is
comfortably fast, and stays sub-second for the engine build.

## Notes

- Node-measured worker-equivalent timing (the worker replays the same pure
  `buildCadSurface`); browser responsiveness at 50k vertices still needs
  manual QA (SVG path generation + render, not the engine build).
- No adjustment-math changes; no production behavior changes from this probe.
