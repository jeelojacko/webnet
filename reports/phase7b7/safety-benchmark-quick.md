# Phase 7B.7 safety-strategy benchmark

Generated: 2026-09-05T20:32:29.231Z · Node v26.8.1 · linux-x64 · AMD Ryzen 7 5800X3D 8-Core Processor
Commit: a8b7ec57eb660af947c4bf7685f1299328ff9cd4 · warmups: 1 · quick: true
Module init (WASM factory + sparse bundle, measured separately): 4.51/1.33/13.83/13.83 ms (median/min/p95/max, n=3).
End-to-end is outer sparse-candidate solve() time; oracle is the dense rebuild + condition estimate over the strategy's required correction systems (S0: none, S1: first, S2: first two, S3: every iteration). Memory is post-case RSS/heap.

| Case | Unknowns | Strategy | Accepted | End-to-end med/min/p95/max ms | Oracle med/min/p95/max ms | Oracle systems | Worst system | Max oracle diff | Coord diff m | Fallbacks | RSS MiB | Heap MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chain-2d-08 | 8 | S0 | true | 3.68/3.42/4.15/4.15 | - | 0 | - | - | 5.68e-14 | 0 | 163.0 | 27.3 |
| chain-2d-08 | 8 | S1 | true | 2.97/2.87/3.19/3.19 | 0.05/0.04/0.06/0.06 | 1 | 0 | 3.89e-16 | 5.68e-14 | 0 | 157.4 | 21.5 |
| chain-2d-08 | 8 | S2 | true | 2.64/2.34/2.78/2.78 | 0.09/0.07/0.09/0.09 | 2 | 0 | 3.89e-16 | 5.68e-14 | 0 | 159.2 | 24.4 |
| chain-2d-08 | 8 | S3 | true | 2.54/2.22/2.58/2.58 | 0.16/0.14/0.17/0.17 | 4 | 0 | 3.89e-16 | 5.68e-14 | 0 | 160.3 | 26.6 |
| chain-2d-16 | 16 | S0 | true | 3.74/3.53/3.79/3.79 | - | 0 | - | - | 2.22e-16 | 0 | 175.0 | 28.8 |
| chain-2d-16 | 16 | S1 | true | 3.57/3.44/3.62/3.62 | 0.08/0.08/0.11/0.11 | 1 | 0 | 5.55e-16 | 2.22e-16 | 0 | 175.5 | 30.4 |
| chain-2d-16 | 16 | S2 | true | 3.24/3.22/3.68/3.68 | 0.14/0.14/0.15/0.15 | 2 | 0 | 5.55e-16 | 2.22e-16 | 0 | 175.8 | 32.6 |
| chain-2d-16 | 16 | S3 | true | 3.16/3.16/3.50/3.50 | 0.28/0.28/0.29/0.29 | 4 | 0 | 5.55e-16 | 2.22e-16 | 0 | 175.8 | 36.1 |
## Actual-worker end-to-end (one timed run per case)

| Case | Unknowns | Worker ms | Note |
| --- | --- | --- | --- |
| chain-2d-08 | 8 | 215.65 | actual-worker sparse run |
| chain-2d-16 | 16 | 218.85 | actual-worker sparse run |
