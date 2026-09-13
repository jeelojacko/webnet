# Phase 12F.2 R2B — batched selected-covariance evidence (evidence only)

R0 = TS full-dense oracle; old-R2 = scalar `querySelected`; R2B = one batched `queryBlocks` + block store DIRECTLY into Phase 12D (sparse-only assembly, no dense Qxx mirror). No production routing, no R1 default change, no math/tolerance changes.

## Scorecard

| case | params | obs | uniq-edge-blocks | selected-blocks | R0 (s) | R1 | R2 (s) | R2B (s) | R2B/R0 | R2B/R2 | heap Δ (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| chain@100 | 297 | 300 | 99 | 198 | n/a | analytic (see note) | n/a | 0.03 | n/a | n/a | 13.3 |
| ↳ chain@100 leg r0 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.3987335282229295e-19, tau=5.1559738962283786e-26). | | | | | | | | |
| ↳ chain@100 leg r2 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0004->S0005#5: Qvv block is materially non-PSD (lambda_min=-1.9361364238805905e-20, tau=6.457208338630254e-27). | | | | | | | | |
| ↳ chain@100 R2B stats | blocked | gate=F-BRIDGE (shared-formula statistics) | GNSS statistics for S0004->S0005#5: Qvv block is materially non-PSD (lambda_min=-5.35341474030893e-21, tau=4.927299008954597e-27). | | | | | | | | |
| chain@250 | 747 | 750 | 249 | 498 | n/a | analytic (see note) | n/a | 0.07 | n/a | n/a | 96.9 |
| ↳ chain@250 leg r0 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-2.142524131367796e-21, tau=1.2827071383824776e-26). | | | | | | | | |
| ↳ chain@250 leg r2 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-4.527071670156703e-20, tau=5.3233025028529856e-27). | | | | | | | | |
| ↳ chain@250 R2B stats | blocked | gate=F-BRIDGE (shared-formula statistics) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-4.524596945129708e-20, tau=5.326745025909748e-27). | | | | | | | | |
| chain@500 | 1497 | 1500 | 499 | 998 | n/a | analytic (see note) | n/a | 0.24 | n/a | n/a | 111.3 |
| ↳ chain@500 leg r0 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-4.745834712328991e-18, tau=7.605495903309593e-28). | | | | | | | | |
| ↳ chain@500 leg r2 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.990850780588887e-18, tau=7.664993265502591e-27). | | | | | | | | |
| ↳ chain@500 R2B stats | blocked | gate=F-BRIDGE (shared-formula statistics) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.985415573020835e-18, tau=7.430138266452485e-27). | | | | | | | | |
| chain@750 | 2247 | 2250 | 749 | 1498 | n/a | analytic (see note) | n/a | 0.52 | n/a | n/a | 407.0 |
| ↳ chain@750 leg r0 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.118100374862824e-18, tau=1.306680927108311e-25). | | | | | | | | |
| ↳ chain@750 leg r2 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.306916471620323e-18, tau=9.520033940129928e-27). | | | | | | | | |
| ↳ chain@750 R2B stats | blocked | gate=F-BRIDGE (shared-formula statistics) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.3057089230016863e-18, tau=9.220606712621275e-27). | | | | | | | | |
| chain@1000 | 2997 | 3000 | 999 | 1998 | n/a | analytic (see note) | n/a | 0.97 | n/a | n/a | 258.4 |
| ↳ chain@1000 leg r0 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-2.7405583934737353e-19, tau=4.490179173006807e-26). | | | | | | | | |
| ↳ chain@1000 leg r2 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-1.0188626050115619e-19, tau=2.4494797540714253e-26). | | | | | | | | |
| ↳ chain@1000 R2B stats | blocked | gate=F-BRIDGE (shared-formula statistics) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-1.0153771443726634e-19, tau=2.4535074128034953e-26). | | | | | | | | |
| chain@1500 | 4497 | 4500 | 1499 | 2998 | n/a | analytic (see note) | n/a | 2.43 | n/a | n/a | 1102.0 |
| ↳ chain@1500 leg r0 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-7.094206397488061e-19, tau=7.388025600790705e-26). | | | | | | | | |
| ↳ chain@1500 leg r2 | failed | gate=F-BRIDGE (production statistics PSD gate on ~zero-redundancy bridge; pre-existing, orthogonal to R2B) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.046563401926388e-18, tau=2.171261924231578e-27). | | | | | | | | |
| ↳ chain@1500 R2B stats | blocked | gate=F-BRIDGE (shared-formula statistics) | GNSS statistics for S0000->S0001#1: Qvv block is materially non-PSD (lambda_min=-3.0478403900286983e-18, tau=2.2061346622432938e-27). | | | | | | | | |
| chain@2000 | TIMEOUT-SKIPPED: Command failed: /home/jacko/Code/webnet/node_modules/.bin/tsx scripts/gnss/gnssR | | | | | | | | | | legs=TIMEOUT-SKIPPED |
| sparse-mesh@100 | 297 | 1173 | 380 | 479 | 0.26 | analytic (see note) | 0.12 | 0.14 | 1.88x | 0.87x | 134.0 |
| sparse-mesh@250 | 747 | 2973 | 983 | 1232 | 3.12 | analytic (see note) | 1.30 | 0.87 | 3.57x | 1.49x | 505.2 |
| sparse-mesh@500 | 1497 | 5961 | 1979 | 2478 | 18.09 | analytic (see note) | 4.72 | 4.32 | 4.19x | 1.09x | 1294.2 |
| sparse-mesh@750 | 2247 | 8976 | 2985 | 3734 | 69.20 | analytic (see note) | 13.28 | 12.03 | 5.75x | 1.10x | 2303.6 |
| sparse-mesh@1000 | 2997 | 11976 | 3985 | 4984 | n/a | analytic (see note) | n/a | 30.16 | n/a | n/a | 2230.1 |
| sparse-mesh@1500 | 4497 | 17973 | 5981 | 7480 | n/a | analytic (see note) | n/a | 83.93 | n/a | n/a | 2520.5 |
| sparse-mesh@2000 | ERROR: MEMORY (JS heap OOM in child; TS-side bound) | Command failed: /home/jacko/Code/ | | | | | | | | | | legs=ERROR |
| ring@250 | 747 | 1002 | 331 | 580 | 1.63 | analytic (see note) | 0.10 | 0.14 | 11.44x | 0.73x | 205.7 |
| hub-spoke@250 | 747 | 1212 | 154 | 403 | 2.23 | analytic (see note) | 0.14 | 0.14 | 15.72x | 1.00x | 246.3 |

R1 note: full-Qxx native is not run at scale (prohibitive by design); at these query densities unique queried columns ~= parameter count, so R1 cost ≈ old-R2 cost (same solves, all-entry packing). R2B wins on bytes shipped and postprocess, not on solve count.

## Parity R2B vs R0 (§12, max diffs)

| case | coord abs | resid abs | vTPv rel | SEUW rel | stnCov abs | stnCov rel | Qvv rel | Cvv rel | std abs | redTr abs | blockT rel | whatif | identity R2B | gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| chain@100 | PARTIAL (r2b:ok/r0:failed/r2:failed stats:BLOCKED) | | | | | | | | | | | | n/a | n/a |
| chain@250 | PARTIAL (r2b:ok/r0:failed/r2:failed stats:BLOCKED) | | | | | | | | | | | | n/a | n/a |
| chain@500 | PARTIAL (r2b:ok/r0:failed/r2:failed stats:BLOCKED) | | | | | | | | | | | | n/a | n/a |
| chain@750 | PARTIAL (r2b:ok/r0:failed/r2:failed stats:BLOCKED) | | | | | | | | | | | | n/a | n/a |
| chain@1000 | PARTIAL (r2b:ok/r0:failed/r2:failed stats:BLOCKED) | | | | | | | | | | | | n/a | n/a |
| chain@1500 | PARTIAL (r2b:ok/r0:failed/r2:failed stats:BLOCKED) | | | | | | | | | | | | n/a | n/a |
| chain@2000 | TIMEOUT-SKIPPED (Command failed: /home/jacko/Code/webnet/node_modules/.bin/ts) | | | | | | | | | | | | n/a | n/a |
| sparse-mesh@100 | 0 | 0 | 4.26e-16 | 2.32e-16 | 5.08e-20 | 1.48e-12 | 8.05e-14 | 8.02e-14 | 3.11e-15 | 3.11e-15 | 1.13e-14 | top1=TOP5=match | 4.55e-13 | PASS |
| sparse-mesh@250 | 0 | 0 | 2.57e-15 | 1.25e-15 | 3.29e-19 | 3.78e-11 | 1.03e-11 | 1.03e-11 | 1.09e-14 | 1.04e-14 | 1.69e-14 | top1=TOP5=match | 9.09e-13 | PASS |
| sparse-mesh@500 | 0 | 0 | 2.24e-15 | 1.11e-15 | 3.35e-19 | 7.03e-11 | 2.08e-13 | 2.06e-13 | 1.27e-14 | 3.46e-14 | 5.34e-14 | top1=TOP5=match | 8.19e-12 | PASS |
| sparse-mesh@750 | 0 | 0 | 8.09e-15 | 4.18e-15 | 1.82e-18 | 2.97e-9 | 1.40e-12 | 1.40e-12 | 8.76e-14 | 1.60e-13 | 1.03e-13 | top1=TOP5=match | 7.28e-12 | PASS |
| sparse-mesh@1000 | PARTIAL (r2b:ok/r0:skipped/r2:skipped) | | | | | | | | | | | | 5.46e-12 | PASS |
| sparse-mesh@1500 | PARTIAL (r2b:ok/r0:skipped/r2:skipped) | | | | | | | | | | | | 4.00e-11 | PASS |
| sparse-mesh@2000 | ERROR (MEMORY (JS heap OOM in child; TS-side bound) | Command faile) | | | | | | | | | | | | n/a | n/a |
| ring@250 | 0 | 0 | 1.74e-15 | 8.27e-16 | 9.07e-16 | 5.91e-9 | 4.30e-10 | 4.30e-10 | 1.10e-10 | 1.75e-12 | 2.40e-10 | top1=TOP5=match | 2.79e-12 | PASS |
| hub-spoke@250 | 0 | 0 | 2.97e-15 | 1.50e-15 | 8.13e-20 | 1.94e-13 | 6.99e-14 | 7.28e-14 | 8.22e-15 | 5.00e-15 | 1.85e-13 | top1=TOP5=match | 5.68e-14 | PASS |

## Redundancy identity (§13, hard gate): worst |sum trace(R) − DOF| = 4.002e-11 (gate 1e-6)

## Fault matrix (§21)

| fault | caught by | detail |
| --- | --- | --- |
| clean-store (control) | UNCAUGHT | no mutation; expect no checks to fire |
| wrong-block-order | psd-spot-6x6, redundancy-identity | swap first two off-diagonal chunks, index unchanged |
| missing-block | dims/cardinality, redundancy-identity | drop last off-diagonal slot + index entry |
| duplicate-misaligned | redundancy-identity | copy slot 0 over slot 1 |
| nan-injection | finite, positive-variance, psd-spot-6x6, redundancy-identity | NaN in first diagonal variance |
| asymmetric-diagonal | symmetry, redundancy-identity | +1e-3 on Q_ii[0,1] only |
| negative-variance | positive-variance, psd-spot-6x6, redundancy-identity | negate first diagonal variance; oracle-parity backstop: Qvv max rel 8.14e-1 vs R0 |
| corrupted-off-diagonal | psd-spot-6x6, redundancy-identity | +1.0 on first Q_AB entry; oracle-parity backstop: Qvv max rel 1.00e+0 vs R0 |
| transposed-wrong-block | UNCAUGHT | store Q_AB transposed in place; oracle-parity: numerically identical on this net (Qvv max rel ≤ 1e-9) — structurally invisible to store-internal checks |
| random-finite-perturbation | redundancy-identity | ×1.001 on every stored entry; oracle-parity backstop: Qvv max rel 1.01e-2 vs R0 |
| zeroed-block | positive-variance, psd-spot-6x6, redundancy-identity | first diagonal block zeroed; oracle-parity backstop: Qvv max rel 8.33e-1 vs R0 |

Safety checks: dims/cardinality, finite, symmetry, positive variance, transpose consistency, 6×6 PSD spot, redundancy identity, vTPv/SEUW finite, ordering.

## Bridge/copy benchmark (§23)

`{"case":"chain@12","scalarQueries":222,"scalarUniqueColumns":33,"blockRequests":21,"blockUniqueColumns":33,"scalarBridgeCalls":1,"blockBridgeCalls":1,"scalarResultBytes":1776,"blockResultBytes":1512,"scalarQueryWallMs":2.397,"blockQueryWallMs":0.752,"scalarSolveMs":0.12524,"blockSolveMs":0.07712,"note":"one bridge call each; blocks dedup repeated edges and ship 6+9 scalars per edge instead of 21 raw queries"}`

## Storage note (§24)

Typed-buffer store (flat `diag` + `offDiag` Float64Array, pair-key → slot) is the only R2B representation — no dense mirror is ever allocated. R2B result bytes = `diag.byteLength + offDiag.byteLength` per scorecard row above; old-R2 ships the same scalars plus a full `numParams²×8` dense mirror (see `r2ResultBytes`). GC/heap contrast at scale comes from the §1 profile (JS heap Δ 2.9 GB @mesh1000, TS dense assembly OOM @mesh1500/2000); this run records per-case heap Δ in the scorecard.

## Datasets

| dataset-b | setup-case | status | detail |
| --- | --- | --- | --- |
| (none) | A0 | NOT-RUN | no --dataset-b directory supplied |

## Decision recommendation: GO-R2B-PRODUCTION-PROOF WITH-BOUNDS (mesh 100-750 + ring/hub-spoke pass parity + identity; R2B query succeeds everywhere 100-1000; chain statistics blocked by the pre-existing F-BRIDGE production PSD gate — R0 itself throws, orthogonal to R2B; 1500/2000 outcomes documented as bounds; next research: F-BRIDGE gate policy + sparse-assembly scaling for the OOM bound)

