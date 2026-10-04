# Phase 20N.1 — Performance (Wave K): linear scaling

Measurement only, zero `src/` changes. Script
`scripts/phase20n1TransitionPerf.ts` times the real production entry points
(group policy, full group solve, plural worker validators) on admitted
straight flat groups; fixtures built once, medians over batched samples,
determinism asserted every run. Raw output: `perf-output.txt` (same dir).

| T | transitions | members | policyMs | solveMs | workerMs | totalMs | verts | tris |
|---|-------------|---------|----------|---------|----------|---------|-------|------|
| T0 | 0 | 1 | 0.000 | 0.121 | 0.000 | 0.122 | 4 | 2 |
| T1 | 1 | 2 | 0.000 | 0.152 | 0.012 | 0.164 | 10 | 8 |
| T2 | 2 | 3 | 0.001 | 0.198 | 0.008 | 0.208 | 16 | 14 |
| T3 | 3 | 4 | 0.002 | 0.232 | 0.011 | 0.244 | 22 | 20 |
| T8 | 8 | 9 | 0.003 | 0.541 | 0.031 | 0.574 | 52 | 50 |

Per added transition: solve +0.03–0.06 ms, +6 verts / +6 tris.
**Verdict: linear scaling** — cost grows with transition count at a constant
per-transition rate; policy + worker-validator overhead stays negligible
(≤ 0.034 ms combined at T8).

## What this is not

- **20N study**: study perf was harness-side; this times the production
  kernel end to end.
- **Candidate B**: no non-collinear shapes measured (none admitted).
- **Narrowing**: none — consecutive collinear groups tile one member per
  transition, hence the flat per-transition rate.
