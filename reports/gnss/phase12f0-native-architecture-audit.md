# Phase 12F.0 — Static GNSS Native/WASM Architecture & Performance Audit

Evidence-only audit (no production routing/math/tolerance/GVX/UI changes;
TS oracle stays authoritative; no RINEX). Branch
`feat/gnss-native-architecture-audit`, baseline `origin/main f2defd41`
(PR #40 merge). Vendor intake read-only, never committed.

R0 = TS-dense oracle (`runGnssBaselineAdjustment`) with separated stage
timings via a fidelity-gated replica (`runTimedGnssLoop`, coord diff 0 vs
production on every leg). R1 = native sparse correction solve (WASM
`sparseCorrectionSolver` injected into `solveAdjustmentIteration` — the
existing API seam) + native full Qxx (all-entry `querySelected`) + TS
residual/statistics reconstruction. R2 = native solve + selected per-edge
station blocks (Q_AA/Q_AB/Q_BB) + TS statistics from the block-sparse Qxx.
Setup augmentation stays TS in all legs (effective 3x3 to native).

| Suite | Location | Result |
| --- | --- | --- |
| Fast oracle correctness (agent) | `tests/gnssBaseline/gnssNativeArchitectureAudit.test.ts` | 13/13 |
| Real-WASM campaign (evidence, manual) | `tests/evidence/phase12f0_native_architecture_audit.test.ts` | 4/4 (111 s) |
| Shared harness (evidence-only) | `scripts/gnss/gnssNativeArchitectureAudit.ts` + `gnssNativeAuditCorpus.ts` | — |
| Machine artifacts | `artifacts/evidence/phase12f0/{small-net,dataset-a,dataset-b,corpus}.json` | gitignored |

Validation: `tsc` clean, `eslint` clean on all touched files. No
`src/engine` production diffs (see §28). Real-WASM runs are manual
evidence, never CI.

## §1 — Native component inventory (traced, not inferred)

| Component | Location | Scope | GNSS verdict |
| --- | --- | --- | --- |
| Dense correction solve | `cpp/` dense solver → `_webnet_dense_solve{,_opts}` → `WasmDenseNormalEquationSolver` | dimension-agnostic (N×N) | usable, but sparse path dominates; not used by R1/R2 |
| Sparse correction solve | `cpp/` sparse core → `_webnet_sparse_equation_solve` → `WasmSparseNormalEquationSolver.solveFromEquations` | dimension-agnostic packed rows | **R1/R2 solve** via existing `solveAdjustmentIteration` seam |
| Full Qxx | `_webnet_sparse_selected_covariance` with all-entry queries (10I route pattern) | dimension-agnostic | **R1 Qxx** |
| Selected covariance | same entry point, per-query (row, col) into N⁻¹ | dimension-agnostic | **R2 blocks**; returns exactly the Q_AA/Q_AB/Q_BB entries statistics needs |
| Quadratic/cross row products | `_webnet_sparse_row_products` → `WasmSparseRowProducts` | dimension-agnostic | not needed: vTPv uses block-diagonal P in TS |
| Structured weights | `sparseWeightRepresentation.ts` → `structuredWeightsToPackedUpper` | dimension-agnostic (upper-triangle incl. off-diagonals) | correlated 3x3 blocks transfer exactly; evidence used dense→packed (equivalent) |
| 3D support | native core is equation-indexed; 3D gating is TS policy (`adjustmentNativeFullQxxAutoRoute`, cap 768) | 3D-capable, policy-gated | no new native math needed for GNSS triplets |
| Sparse normals | assembled natively from packed design+weights (`assemblyMs` in metadata) | dimension-agnostic | exercised in every R1/R2 call |
| Station/block maps | TS-side (`buildSolveParameterIndex`); native sees only integer columns | TS-owned | harness reuses the production index verbatim |
| Worker bridge | `adjustmentNativeFullQxxAutoRoute` (eligibility + C1/C2/C3 verify + clean-TS fallback), `adjustmentSparseAutoRoute` | 10I route: 3D single-solve ≤768 params; **both reject GNSS today** (`isGnssBaselineObservation` tripwires) | bridge design A target (§21) |
| Memory ownership | WASM wrappers `malloc` per call, copy buffers, `free` in `finally` | copy-per-call | bridge-copy cost measured (§20); no shared-handle API exists (10O finding stands) |
| Legacy-Observation-tied | `deriveNativeFullQxxEligibility` (RunSessionRequest shape), terrestrial preanalysis sentinels | terrestrial-only | GNSS needs its own eligibility (§22); numerics reused only |

Nothing in the native core is 2D-only or legacy-Observation-tied at the
numerics level: all limits are TS policy gates. The [-I +I] triplet
structure is preserved end-to-end (design rows have ≤2 nonzeros;
P is block-diagonal with 3x3 correlated blocks).

## §3 — TS-side setup augmentation boundary

Keeping setup in TS (effective 3x3 to native, raw on `rawCovariance`)
has no blocker: R1/R2 legs on setup-augmented Dataset-A (§13) and the
fast-test augmented-vs-manual-effective parity (`maxCoordAbs < 1e-12`,
`qxxMaxRel < 1e-9`) prove the native path never sees raw-vs-effective
ambiguity. **Recommend TS-side setup for the first cohort unless proven
otherwise** — no evidence of a native-side need.

## Correctness (§4, §8, §9, §10, §12)

- Realistic ±6e6 m ECEF fixtures: generator places stations on the GRS80
  ellipsoid over a ~40 km patch; correction parity vs the independent
  Gauss-Jordan golden is < 1e-9 m with negative correlations present.
- Translated-origin equivalence: shift +(1000,-2000,3000) m preserves
  corrections/vTPv to 1e-9 rel; adjusted coords shift exactly.
- Full correlated 3x3 weights incl. negative off-diagonals: golden parity
  on coords/residuals/vTPv (DOF 3 triangle).
- Fixed-endpoint Qvv: single fixed→free baseline gives Qvv = 0,
  redundancy trace 0, `no-scale` status (dof 0); triangle B→C block
  matches an in-test hand `A Qxx Aᵀ` computation to 1e-18.
- Repeated/reversed edges solve with trace identity < 1e-9.
- Multi-component: two disjoint meshes solve as one packed system with
  trace identity < 1e-9 and defined suspect ranking — **semantics stay in
  TS; no single-component restriction is needed for native** (packed rows
  are component-agnostic). State a single-component restriction only if a
  future worker route requires it; evidence shows it does not.
- Blunder what-if: +5 cm blunder top-1 suspect agrees R0 vs R2 (same
  baseline id). Loop QC (`computeGnssLoopClosures`) is adjusted-geometry
  input-identical across routes (NO-QXX, §16).

### Finding F-BRIDGE (oracle scope limit, not native)

A bridge (cut-edge) carries ~zero redundancy, so once dof > 0 its Qvv
block sits at roundoff scale (~1e-19 vs variances ~1e-5) and production's
eigen PSD gate (`symmetricRank3`, tau ~ 1e-26) verdict is a coin flip.
Pinned: chain-8+tie (dof 3) deterministically throws `/non-PSD/`.
Consequence: chain/tree/ray/spoke survey graphs are not reliably
supportable on the **current TS-dense statistics path** (shared by all
routes — native neither causes nor fixes it). Solve legs therefore use
bridgeless topologies only (ring, ring-backed sparse-mesh,
repeated-edge); Dataset A/B are naturally biconnected.

### Finding F-PSD (gate-scale inconsistency, pinned)

`symmetricRank3(symmetricEigen3(diag(1e-20,1e-20,-1.9e-21)))` throws while
the diagonal roundoff floor (1e-9 of input variance) would pass the same
block. The eigen gate is ~12 orders stricter than the diagonal floor on
~zero-redundancy blocks. Pinned, not fixed (audit scope).

## §13 — Stochastic cases (native-vs-TS, NOT vs TBC)

Real Dataset-A network (91 vectors, 45 params, dof 228), 12E.3 production
API (`setupUncertainty` + session `ellipsoid: 'WGS84'`):

| Setup | TS SEUW (oracle pin) | Expected | R1 coords | R1 Qxx rel | R2 coords | R2 blockT rel |
| --- | --- | --- | --- | --- | --- | --- |
| A0 | 2.100053 | 2.100053 | 0 | 4.5e-15 | 0 | 4.4e-15 |
| AC | 1.297104 | 1.297104 | 0 | 8.0e-14 | 0 | 2.1e-15 |
| AH | 1.988831 | 1.988831 | 0 | 7.4e-15 | 0 | 2.1e-15 |
| A | 1.102511 | 1.102511 | 0 | 1.8e-12 | 0 | 9.8e-16 |

TS reproduces all four 12E.3 pins to 6 decimals; native-vs-TS parity is
bitwise on coords and ≤ 1.8e-12 on Qxx — orders tighter than TBC display
precision, as required.

## §14 — Dataset-B manual case (50v/8 stations)

R0 SEUW 1.965038 / vTPv 498.1172 (matches 12E.2 §B0). R1 maxima:
coords 0, Qxx abs 6.6e-21 / rel 6.9e-15, Qvv rel 7.1e-15, trace 2.8e-14,
blockT 9.5e-16. R2 maxima: coords 0, Qvv rel 2.1e-14, trace 2.8e-14,
blockT 8.8e-16. Native timings 0.08 ms query wall (21 params).

## §15/§16 — Synthetic corpus parity (§16 contract)

Deterministic generators (chain/tree/ring/sparse-mesh/survey/hub-spoke/
repeated-edge; solve legs bridgeless-only per F-BRIDGE) × sizes
10/25/50/100/250 (+500/1000 R2-only), realistic ECEF, SPD correlated 3x3
blocks, setup combos 0/0 + A-style on small nets. Contract metrics:
coords/corrections/vTPv/SEUW/Qxx-or-blocks/residuals/Qvv/Cvv/
redundancy-trace/standardized/blockT. Existing tolerances unchanged; the
audit asserts solve items ≤ 1e-9 (abs/rel) and covariance items ≤ 1e-6
rel — all pass with 2–5 orders of margin:

| Case | p | R1 coords | R1 Qxx rel | R2 Qvv rel | R2 blockT rel | full-vs-selected |
| --- | --- | --- | --- | --- | --- | --- |
| mesh-10 | 27 | 0 | 6.2e-14 | 1.3e-11 | 2.4e-11 | 3.4e-21 |
| ring-10 | 27 | 0 | 1.7e-13 | — | — | 5.1e-21 |
| repeated-12 | 33 | 0 | 6.2e-12 | — | — | 4.1e-20 |
| mesh-25 | 72 | 0 | 5.0e-12 | — | — | 3.4e-21 |
| ring-50 | 147 | 0 | 1.3e-09 | — | — | 0 |
| mesh-100 | 297 | 0 | 6.4e-11 | 1.0e-11 | 1.4e-14 | 2.2e-20 |
| mesh-250 | 747 | 0 | 2.4e-10 | — | — | 1.7e-20 |
| Dataset A/B | 45/21 | 0 | ≤1.8e-12 | ≤2.1e-14 | ≤4.4e-15 | — |

Small-net R1/R2 maxima over 5 nets: coords 0, vTPv/SEUW rel 0,
residuals 0, Qxx rel ≤ 1.3e-9, Qvv/Cvv rel ≤ 1.4e-11, standardized abs ≤
1.2e-12. (R2 Qxx columns are 0 by construction — only queried blocks are
compared; statistics agreement is the R2 contract.)

## §17 — Redundancy-trace identity (every case)

`Σ trace(Rᵢ) − dof`: ≤ 2.7e-13 (small nets), 5.7e-13 (mesh-100),
1.4e-12 (mesh-250), 2.8e-14 (Dataset B), **exactly 0.0 at mesh-500 and
mesh-1000 R2** (selected-blocks-only reconstruction).

## §18 — Full-vs-selected cross-check

R2 queried entries vs R1 full-Qxx entries: ≤ 2.2e-20 (mesh-100),
1.7e-20 (mesh-250), 0 (ring-50). R2 statistics reproduce R1 statistics
(Qvv/Cvv/standardized/blockT) to the §16 margins above.

## §19 — Memory

- Dense-Qxx materialization cost (analytic + measured): p²·8 B —
  0.7 MB (297) → 4.5 MB (747) → **17.9 MB avoided at 500, 71.9 MB at
  1000** by R2 (block-sparse Qxx carries only queried entries).
- Native factor fill: factorNnz 333 (p=27) → 16k (297) → 83k (747) →
  306k (1497, 2.4 MB) → 1.17M (2997, 9.3 MB). normalNnz 80k at 1000.
- TS dense assembly is the limiter, not native: dense P is eqs²·8 B =
  286 MB (500) → 1.15 GB (1000) → 4.6 GB (2000); boxed dense A adds
  ~same order. Measured worker heap deltas: +43 MB R0 at 100, +86 MB R2
  at 500, +3.2 GB R2 at 1000.
- **Ceiling: mesh-1000 R2 completes (trace exact); mesh-2000 OOMs the
  worker in TS dense assembly before any native call.** A hard crash
  cannot be caught in-suite, so 2000 is documented here, not in the
  suite (suite covers ≤ 1000).

## §20 — Performance (warm medians; ms)

R0 stages `pre/loop/finalAssembly/normalAccum/qxxInvert/statistics`:

| Case (p) | R0 total | R0 split | R1 total | R2 total | R1 native (bridge/factor/covsolve/wall) |
| --- | --- | --- | --- | --- | --- |
| mesh-10 (27) | 1.55 | .1/.6/.1/.0/.1/.4 | 1.71 | 1.56 | .07/.01/.04/.19 |
| mesh-25 (72) | 5.70 | .1/3.1/.3/.2/.7/1.0 | 6.63 | 6.50 | .43/.03/.15/.36 |
| ring-50 (147) | 9.48 | .1/3.3/.2/.1/4.6/.4 | 4.64 | 4.47 | .32/.01/.26/.66 |
| mesh-100 (297) | 130.7 | .7/58/6/2/48/4.5 | 108.2 | 109.7 | 8.6/.46/5.1/7.2 |
| mesh-250 (747) | 1183 | 2/407/40/15/639/12 | 873 | 885 | 101/5.1/64/79 |
| mesh-500 R2 (1497) | — | — | — | 4333 | 409/37/471/513 |
| mesh-1000 R2 (2997) | — | — | — | 27720 | 2949/278/3610/3898 |

- R0 profile: dense Qxx inversion dominates (37% at 100, 54% at 250);
  solve loop second. Matches Phase 10F structure.
- **Crossover: native ≈ TS at p ≤ 72 (sub-ms noise), R1 2× faster at
  p = 147, clearly faster ≥ 297.** Crossover band ≈ 100–150 params
  (~35–50 mesh stations).
- At scale the bridge copy (TS pack of dense A/P) dominates the native
  path (80% of R2 wall at 1000) while native factor+solve is only ~14%.
  A structured-weights assembly path (existing
  `buildSparseSolveInputFromStructured`, no dense P) would remove both
  the copy cost and the §19 memory ceiling — recommended follow-up,
  not this audit.
- R1 vs R2 walls are within noise of each other ≤ 250 (same
  factorization; query count differs). R2's win is memory + scaling,
  not wall time at small sizes.

## §21/§22/§24/§25 — Recommendations

**Bridge design: A.** Worker-route injection mirroring
`adjustmentNativeFullQxxAutoRoute` (fail-closed eligibility + inline
verification + clean-TS rerun fallback). B (bare engine-options
injection) lacks verification/fallback orchestration; C (standalone
native GNSS service) duplicates orchestration for no measured gain.
Reuse the 10I shape; add a selected-query planner for R2.

**Narrow native I/O scope.** IN: packed design rows, packed upper
weights, misclosures, (row,col) queries. OUT: corrections, selected
covariances, factor metadata + phase timings. Everything else —
setup, preflight, assembly, residuals, statistics, loops, reports —
stays TS (this audit proves the boundary has no blocker).

**Eligibility cohort (evidence-derived).** Admit: GNSS-only ECEF
sessions, single fixed-datum component or multi-component (both proven),
bridgeless graphs only (F-BRIDGE until the TS eigen gate is addressed),
params ≤ 750 for R1 (mesh-250 proven + margin under the 768 native cap),
stations ≤ 1000 for R2 (trace-exact). No lower param bound for
correctness (bitwise ≤ 72); perf crossover ~100–150 params is an
observation, not a gate. Setup-augmented sessions admitted (TS-side).

**Fallback (designed, NOT enabled).** Any native failure (init, throw,
non-finite, verification reject, non-convergence) reruns clean TS —
the 10I pattern. This audit ships no routing change, so no fallback is
wired.

**Legacy GPS/G route kept distinct.** Reuse numerics only (packers,
WASM solvers); no routing, eligibility, or tolerance changes to the
`gps`/terrestrial paths. The GNSS tripwires in both auto-routes stay
until a production certification PR removes them.

## §27 — Deliverables

Report (this file) + harness + fast tests + evidence campaign +
artifacts + tier wiring (`scripts/testTiers.ts`, `runEvidence.mjs`
`phase12f0` suite). `TODO.md` 12F.0 entry updated on completion.

## §28 — Acceptance (task requirements)

- A (inventory, no inference): §1 table traces files/APIs; dimension
  scope per component verified against code.
- B (setup boundary): §3 + A-case legs; TS-side recommended.
- C (R0/R1/R2 harness, no production routes): new files only under
  `scripts/gnss/` + `tests/`; `git status` shows zero `src/` diffs
  (verified before push).
- D (correctness incl. fixed-endpoint/repeated/multi-component): fast
  13/13 + §16 table.
- E (stochastic A0/AC/AH/A): §13 table; TS pins + native margins.
- F (Dataset B): §14; coords bitwise, stats ≤ 2.2e-14.
- G (corpus × topologies × sizes): §15/§16; bridgeless-only with
  F-BRIDGE documented, not hidden.
- H (full-vs-selected + trace identity): §17/§18.
- I (memory + perf + crossover + Qxx cost): §19/§20.
- J (recommendations A/B/C, I/O scope, cohort, fallback, GPS/G): §21
  block above.
- K (report + GO/NO-GO + TODO + commit/push, no PR): this file + §29;
  push only.

## §29 — Decision: GO-R1-THEN-R2

- **R1: GO** for a bounded production-route certification (bridgeless,
  p ≤ 750 cohort): bitwise solve parity, Qxx rel ≤ 1.3e-9 (margin ~1000×
  under 1e-6), faster than TS above ~100–150 params, reuses the proven
  10I route shape.
- **R2: GO after R1** (not instead): selected blocks reproduce every
  Phase-12D output (trace exact to 0.0 at 500/1000) and remove dense-Qxx
  materialization, but production wiring must certify block-sparse Qxx
  consumption — a second bounded step, not assumed.
- **NO-GO items:** enabling any route in this audit (none wired);
  bridge-containing graphs (F-BRIDGE); mesh-2000+ scale without a
  structured-weights assembly path; changing tolerances (none changed).

First cohort keeps setup in TS; legacy GPS/G routes untouched.
