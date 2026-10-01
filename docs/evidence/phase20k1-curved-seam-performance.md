# Phase 20K.1 curved-seam performance (Wave D1, measured 2026-10-01)

Harness: `scripts/phase20k1CurvedSeamPerf.ts` (measurement only, no
thresholds; fixtures built once outside timed regions; 5 reps, median).
Raw output: `docs/evidence/phase20k1-curved-seam-perf-output.txt`.
Machine: local dev (times are relative, not gates).

Fixtures: standalone analytic arc (`DIST(−0.5,20)`, no target), standalone
Surface arc (`FIXED(−0.5)`, flat Z=0 TIN), closed all-Distance rounded
square, closed mixed-analytic square, one-arc hybrid (1 arc + 3 straights),
fully-tied Surface arc (source Z=0 on Z=0 target), arc×arc hybrid
(blocked), large-coord squares (+2M/+7M). Chord sweep via
`curveChordTolerance` 25 → 0.0001 (per-arc chords 1/3/8/23/71/224;
per-square 4/12/32/92/284/896 — honest linearizer counts, not round targets).

## Results (median ms)

| fixture | chords | totalMs | verts/tris | ms/chord |
|---|---|---|---|---|
| standalone analytic tol-25/10/1/0.1 | 1/1/3/8 | 0.17/0.11/0.16/0.23 | 4/2 … 32/30 | 0.17 … 0.03 |
| standalone analytic tol-0.01/0.001/0.0001 | 23/71/224 | 0.86/1.79/2.49 | 92/90 … 896/894 | 0.04/0.03/0.01 |
| standalone Surface tol-25/10/1/0.1 | 1/1/3/8 | 0.29/0.18/0.67/1.13 | 4/2 … 39/37 | 0.29 … 0.14 |
| standalone Surface tol-0.01/0.001/0.0001 | 23/71/224 | 2.18/5.70/14.65 | 115/113 … 1119/1117 | 0.09/0.08/0.07 |
| square all-Distance tol-25/10/1/0.1 | 4/4/12/32 | 0.50/0.17/0.49/1.95 | 16/16 … 128/128 | 0.12 … 0.06 |
| square all-Distance tol-0.01 | 92 | 11.8 | 368/368 | 0.13 |
| square mixed-analytic tol-25/10/1/0.1/0.01 | 4 … 92 | 0.26/0.21/0.64/1.79/11.95 | 16/16 … 368/368 | 0.06 … 0.13 |
| one-arc hybrid tol-0.1 | 11 | 1.06 | 51/51 | 0.10 |
| tied Surface flat | 8 | 0.36 | 0/0 (ALREADY_TIED) | — |
| arc×arc blocked tol-0.1 | 32 | 1.15 fail `CORNER_NO_SOLUTION/ARC_PAIR_UNSUPPORTED` | 0/0 | — |
| large all-Distance / large-Surface tol-0.1 | 32 | 1.80 / 3.70 | 128/128 | 0.06/0.12 |

## Findings

- **Dominant stage: whole-call production solve.** Linearization alone
  (`chordMs`) is 1–60 µs — negligible at every scale. Seam / merge /
  topology stages are internal to the call and not separately instrumented.
- Surface costs ~3–6× analytic per chord (per-chord TIN queries).
- tol-0.001/0.0001 closed squares (284/896 chords) fail
  `GROUP_SELF_INTERSECTION/GRADING_GROUP_DAYLIGHT_RING` (~95 ms / ~5 ms):
  fine subdivision trips the daylight-ring guard. Recorded, not fixed —
  production tolerance stays 0.1.
- Large-coord squares match local timing and geometry (translation
  invariance holds; see validation doc).
- Memory: heapUsed 45.3 MB, rss 192.0 MB.
