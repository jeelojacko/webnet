# Phase 20L.2 offset-radius production — performance

Method: `scripts/phase20l2ExactOffsetPerf.ts` (measurement only, 5-rep
medians; fixtures built once outside timed regions). Raw run:
`docs/evidence/phase20l2/perf-output.txt`. No thresholds, no hard claims —
per-engine-stage splits are internal to the production calls, so the
whole-call solve is reported; tessellation cost is represented by the
shared-helper subdivision budget plus emitted points/tris.

Chains (all P0-admitted open, no arc×arc; DIST d=5, ms=100):
A1 2-member, B 3-member, C5 alternating 5-member (B + 90°-rotated study
corner), PAIR line→arc→arc chord-fallback reference.

| chain | tol | route | exact ms | dispatch ms | arcSubdiv | pts | tris |
|---|---|---|---|---|---|---|---|
| A1 | 0.1 | exact | 1.197 | 1.083 | 13 | 30 | 28 |
| A1 | 0.01 | exact | 1.351 | 1.319 | 40 | 84 | 82 |
| A1 | 0.001 | exact | 3.228 | 3.134 | 125 | 254 | 252 |
| B | 0.1 | exact | 0.370 | 0.392 | 13 | 32 | 30 |
| B | 0.01 | exact | 0.851 | 0.877 | 40 | 86 | 84 |
| B | 0.001 | exact | 3.062 | 3.056 | 125 | 256 | 254 |
| C5 | 0.1 | exact | 0.940 | 0.911 | 13+13 | 60 | 58 |
| C5 | 0.01 | exact | 3.208 | 2.004 | 40+40 | 168 | 166 |
| C5 | 0.001 | exact | 9.566 | 8.145 | 125+125 | 508 | 506 |
| PAIR | 0.1 | fallback | 0.049 | 2.336 | 13+12 | 86 | 87 |
| PAIR | 0.01 | fallback | 0.041 | 6.705 | 40+36 | 247 | 267 |
| PAIR | 0.001 | fallback | 0.037 | 20.131 | 125+112 | 764 | 832 |

Read as measured (this machine, production TS via tsx):

- Dispatcher cost ≈ exact-route cost: the preflight is negligible next
  to the solve (dispatch − exact within noise on admitted routes).
- Exact-route preflight itself is sub-0.1 ms on the fallback reference
  (bounded reject, no mesh built).
- Tessellation dominates at fine tol on both paths: points/tris scale
  with the subdivision budget (~3× per 10× tol), whole-call ms follows.
- The chord fallback emits a heavier mesh than the exact route on the
  same budget (PAIR 267 vs A1 82 tris at tol 0.01) and costs more
  whole-call at fine tol — measured, not claimed as a general rule.
