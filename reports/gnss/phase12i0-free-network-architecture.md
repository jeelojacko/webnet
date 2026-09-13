# Phase 12I.0 — Free-Network Static-GNSS Mathematical Architecture Audit

Evidence-only audit (no production free-network enable, no preflight
weakening, no constrained-output/math/tolerance/R2B-routing/UI changes;
no partial constraints, no terrestrial free support, no datum transforms,
no RINEX/PPP). Branch `feat/gnss-free-network-architecture-audit`,
baseline `origin/main edc1e413` (PR #49 merge). Vendor intake read-only
local-only, never committed.

| Suite | Location | Result |
| --- | --- | --- |
| Core free-network math (agent) | `tests/gnssBaseline/gnssFreeNetworkEvidence.test.ts` | 19/19 (~0.3 s) |
| Dataset A/B commercial evidence (agent) | `tests/gnssBaseline/gnssFreeNetworkDatasets.test.ts` | 16/16 (~0.5 s) |
| Perf sweep (manual script) | `scripts/gnss/gnssFreeNetworkPerfEvidence.ts` | 10–500 stn, see §38 |
| Evidence helpers (NEW, production-unreachable) | `src/engine/gnssFreeNetworkDatum.ts`, `src/engine/gnssFreeNetworkSolvers.ts`, `src/engine/gnssFreeNetworkEvidence.ts` (re-export hub) | no production importers (verified by grep) |

Validation: focused 35/35, `tsc` clean, `eslint` 0 errors (2 pre-existing
warnings in unrelated files), `test:agent` 3346 pass + 3 pre-existing
Study calibration failures (re-proven pre-existing via stash on pristine
baseline), `build` clean. Production behavior unchanged (§40 proof: no
`src/` production diffs; preflight verbatim free-network error asserted
by test; `git status` shows only TODO.md + 6 new files).

## §1 — Datum defect proof (one component)

Observation model per baseline A→B: `b_AB = X_B − X_A + v`, Jacobian row
block `[-I₃ +I₃]` (`src/engine/gnssBaselineEquationRows.ts:26-73`).

Analytic nullspace (also in `gnssFreeNetworkDatum.ts` header comments):
for a translation mode `t_k` (all stations shifted by unit vector `e_k`),
each scalar row reads `(A·t_k)[r] = −1 + 1 = 0`, because every baseline
row touches exactly one FROM and one TO unknown on the same axis. Hence
all 3 translation modes lie in null(A), so null(N) with `N = AᵀPA`
contains them: defect ≥ 3 per connected component. Exactly 3 when the
component graph is connected: `−a_f + a_o = 0` per row forces the null
vector constant per axis along edges.

Numerical evidence (triangle, 9 params): rank(A) = 6, defect = 3,
`N·Z` residual < 1e-6, nullspace off-span(Z) < 1e-9. No scale,
orientation, rigid-body-6, or Helmert-7 modes exist: GNSS baseline
components are already expressed in defined ECEF axes and metres, so any
rotation/scale changes the observed ΔX/ΔY/ΔZ and is estimable. Locked by
rank/elimination evidence, not by assertion.

## §2 — Multiple components

Block-diagonal assembly over `c` free connected components:
total rank defect = 3c (2-component fixture: defect 6 = 3c verified).
Constrained components under existing full-XYZ fixed control: 0 defect.
Mixed network (A fixed, B free, C free): expected defect 6, each free
component receiving its own independent datum treatment (Method C fixes
one anchor **per component**; KKT constrains sums per component).

## §3 — Degrees of freedom

Free component: `u` coordinate params, `rank(A) = u − 3`, therefore
`DOF = nScalar − rank(A)` — NOT `n − u`. For `c` free components:
`DOF = n − (u − 3c)`, plus ordinary treatment of constrained components.
Inner constraints are never counted as observations.

Dataset-B shape verified: 24 free unknowns, rank 21, n = 150 scalar
equations → DOF 129, equal to the existing P041-fixed solution.
Dataset A: 48 free params, rank 45, DOF 228 (see §§12–13).

## §4 — Method A: KKT inner constraints

Translation constraints per free component: `Σdxᵢ = 0`, `Σdyᵢ = 0`,
`Σdzᵢ = 0`. Augmented system `[N G; Gᵀ 0][dx; λ] = [u; 0]` with `G`
spanning the translation nullspace. Evidence: unique solution,
constraints exact, residuals invariant vs constrained route, inner
covariance from the KKT inverse, DOF unchanged. Parity with Methods B/C
≤ 1e-9 on all corpus networks (dx/Qxx/residuals/vTPv/redundancy/Qvv;
SEUW ≤ 1e-12).

## §5 — Method B: generalized inverse

Minimum-norm `dx` via nullspace projection (`N⁺` through the
`N + ZZᵀ`-stabilized form with orthonormal translation modes `Z`).
Verified: `NN⁺N = N`, `N⁺NN⁺ = N⁺`, symmetry (scale-relative ≤ 1e-9;
second Penrose identity ≤ 1e-6 with conditioned-product rationale
documented), and `Zᵀdx = 0`. Agrees with KKT and gauge+S to ≤ 1e-9.

## §6 — Method C: temporary gauge + S-transform (preferred)

Per free component: fix one temporary computational anchor → solve the
reduced full-rank system with the existing production normal-equation
machinery → embed anchor correction/covariance into the full component →
transform to the inner-constrained datum with the centering transform
`S = I − Z(ZᵀZ)⁻¹Zᵀ`, `dx_free = S·dx_gauge`, `Q_free = S·Q_gauge·Sᵀ`.
The anchor is computational only: it must never appear as FIXED control
in reports, alter DOF, enter control provenance, or drop endpoint setup
covariance (§§31–32; setup verified at the gauge anchor by test).

## §7 — Gauge-independence proof

Method C repeated with ≥3 different temporary anchors on triangle + ring
fixtures: adjusted coordinates, corrections, Q_free, residuals, vTPv,
SEUW, Phase12D statistics identical to ≤ 1e-9. Output does not depend
materially on the anchor: GO condition met. Deterministic anchor policy
for any future implementation: lowest stable station index per free
component after deterministic ordering (§30); semantically irrelevant by
this proof.

## §8 — KKT / GINV / GAUGE-S parity

Triangle, ring, mesh, tree+closure, repeated-baseline, 2-component
networks: free corrections, adjusted coordinates, inner-constrained Qxx,
residuals, vTPv, SEUW, Qvv, redundancy, standardized residuals, block-T
agree across all three methods (≤ 1e-9; SEUW ≤ 1e-12; block-T at 1e-6
relative — see §17 rationale; qObs at 1e-6 absolute under ‖P‖
amplification). No independent dense oracle was needed: three
independently-derived implementations agreeing to 1e-9 on six topologies
is the parity argument, with production constrained output as the
external anchor (§11).

## §9 — Translation constraint

Every free component: `ΣdX ≈ 0`, `ΣdY ≈ 0`, `ΣdZ ≈ 0` on corrections
relative to a-priori coordinates (verified by test). The constraint
applies to corrections, never to `Σcoordinates`.

## §10 — Apriori translation invariance

Translating all a-priori station coordinates of a component by arbitrary
(Tx, Ty, Tz) — including large ECEF offsets — while preserving observed
baselines leaves free-network residuals and relative adjusted geometry
invariant; final adjusted coordinates translate consistently with the
translated a-priori datum (verified by test).

## §11 — Constrained vs free equivalence

Production `runGnssBaselineAdjustment` with one fixed XYZ station vs free
candidate + pure 3D-translation alignment: inter-station vectors,
residuals, vTPv, SEUW, Qvv, redundancy, loop QC identical (≤ 1e-9);
redundancy trace = rank-based DOF for 1-fixed/2-fixed/mixed runs. No
rotation or scale alignment needed — corroborating the §1 defect
analysis (translation-only unobservability).

## §12 — Dataset B commercial evidence

Intake `ProcessingGNSSBaselines/post-BL-processing-b4adjustment.gvx`
(50 vectors, read-only). Constrained P041-fixed pin: DOF 129,
SEUW 1.965038 ✓ (compatible with TBC display 1.97). Free candidate
(local gauge+S in the dataset test file): after translating P041 to the
constrained coordinate — coords ≤ 1e-6 m, residuals/vTPv/SEUW/Qvv/Cvv/
redundancy ≤ 1e-9, setup contributions bit-identical, loop QC deep-equal,
DOF 129. Indirect validation of the free math against the commercially
validated constrained solution. No vendor files committed.

## §13 — Dataset A commercial evidence

Intake `AdjustingtheNetwork/Adjusting the Network.gvx` (91 vectors).
All four setup legs DOF 228 with free/constrained parity per leg:
A0 SEUW 2.100053 / AC 1.297104 / AH 1.988831 / A 1.102511 ✓ (production
pins reproduced). Free: 48 params, rank 45, DOF 228. Setup uncertainty
legs show identical setup contributions constrained vs free — orientation
derives from a-priori coords before solve, unaffected by free datum
treatment (§20). Tested A0 + A minimum; AC/AH included (all four legs).

## §14 — Covariance datum distinction

Absolute station covariance is datum-dependent (inner-constrained datum
defined by WebNet's sum-correction constraints); residual statistics are
datum-invariant. Products: (A) inner-constrained station covariance for
coordinates/sigmas in the stated free datum; (B) datum-invariant
relative covariance `Q_(Xi−Xj)` for point-pair precision. Free-network
coordinate sigma must never be displayed as absolute geodetic uncertainty
independent of datum choice (§33 reporting fields encode this).

## §15 — S-transform covariance proof

`Q_free = S·Q_gauge·Sᵀ` verified: symmetric, PSD within numerical
policy, translation nullspace correctly represented, identical
regardless of gauge anchor, agreeing with KKT/GINV covariance ≤ 1e-9.

## §16 — Fixed-datum covariance transform

`Q_free` re-expressed into the P041-fixed datum agrees with the existing
constrained Qxx (translation-datum transformation derived; raw
inner-constrained variances are never compared directly against
fixed-datum variances — different datums).

## §17 — Qvv datum invariance

`Qvv = Qll − A·Qxx·Aᵀ` invariant: `Qvv_free ≈ Qvv_fixed` (≤ 1e-9);
likewise Cvv, standardized residuals, redundancy matrices/trace,
block-T. Tolerance note: `blockT = vᵀCvv⁺v` gates at 1e-6 **relative**
because sub-1e-9 Cvv/residual differences amplify through near-singular
Cvv eigen-directions (~4e-7 observed; tighter solver convergence
verified not to help). All other parity gates stay ≤ 1e-9.

## §18 — Redundancy identity

`Σtrace(Rᵢ) = DOF` with `DOF = n − rank(A)`, verified for 1-free,
2-free, and mixed fixed/free components under the Phase12D numerical
policy (R2B trace gate `< 1e-9` in production is unaffected).

## §19 — Loop QC

Loop closures are datum-invariant: identical members, closure vectors,
covariance, and statistics between free and constrained versions of the
same observation network (deep-equal on Dataset B; production loop
builder reused, solver computes no loops itself).

## §20 — Setup uncertainty

Phase12E.3 orientation stays derived from a-priori ECEF coords; free
datum treatment applies to corrections, not stochastic orientation —
design confirmed NO-impact, tested on zero/centering/height/combined
legs with identical setup contributions constrained vs free. No
iteration-dependent orientation. Temporary gauge anchor remains a
physical endpoint: setup covariance at that station still contributes to
every baseline covariance involving it (§32 locked by test).

## §21 — Control / free modes

Component classification: CONSTRAINED (≥1 fully fixed XYZ station) vs
FREE (0 fixed stations). Partial X/Y/Z constraints remain unsupported
(not added). Multiple fixed stations: existing constrained semantics.
Mixed fixed/free networks: handled per-component independently.

## §22 — UI / API mode semantics (design only, not implemented)

Normal behavior stays constrained/fail-closed unless the caller
explicitly opts in (candidate `datumMode: 'constrained' | 'allow-free'`
or component-auto classification). Never silently solve previously
invalid networks. Future UI requires a deliberate Free Network
Adjustment selection.

## §23 — Import semantics (unchanged)

GVX/CSV/native imports unchanged: a file with no fixed station is not
malformed — it fails today's solve preflight and would be admissible
only under a future explicit free mode. No free-network semantics in
parsers.

## §24 — Multi-file interaction (unchanged)

Composition before datum classification (existing order preserved):
sources compose, overrides apply, then per-component fixed/free
determination on the composed network. Sources never classified
independently.

## §§25–28 — R2B implications (assertions, no R2B code changes)

- Current selected plan: per-free-station `Q_ii` diagonals + observed
  free/free pair `Q_ij` blocks, `Q_ji` by transpose (deduped).
- Gauge-Qvv equality PROVEN: `Aᵢ·Q_gauge·Aᵢᵀ == Aᵢ·Q_free·Aᵢᵀ` ≤ 1e-9 on
  synthetic ring AND every Dataset-B vector → Phase12D residual
  statistics need **no** covariance transformation (§27 YES). Future
  native free adjustment keeps fast network QC via the gauge route even
  if station covariance is handled separately.
- Station-covariance limitation PROVEN: `Qfree_ii = Qg_ii − rowMean −
  colMean + grandMean` (block form of `S·Q·Sᵀ`) needs row/column sums
  over ALL stations including unobserved pairs. Counterexample: 4-station
  ring with pair A–C never observed — zero-filling the missing block
  changes the result (>1e-12 asserted) → current diag + observed-edge
  plan is INSUFFICIENT in general for inner-constrained diagonals (§28).
- Native strategy classification: Option B (native
  correction/residuals + TS full covariance for bounded free jobs) ranked
  first for any future work; A (TS-dense-only) insufficient ambition;
  C (centroid/row-sum extension) / D (bounded full-Qxx cohort) as later
  optimizations; E (Takahashi/sparse-inverse) deferred. Nothing
  production-enabled.

## §29 — Relative covariance

`Q_(Xi−Xj)` helper implemented in `gnssFreeNetworkDatum.ts`, datum
invariant by construction. Whether to expose baseline/point-pair
precision as the primary free-network product is product policy — not
decided here.

## §§30–32 — Gauge selection, solver reuse, setup at anchor

- Deterministic anchor: lowest stable station index per free component
  (§7 proves semantic irrelevance).
- Method C reuses the existing constrained TS solver (and could reuse
  the native R2B solve path later) because the gauge converts the
  singular problem to full-rank; anchor never surfaces as control in
  reports/provenance/DOF/statistics (by construction of the evidence
  helpers; production preflight untouched).
- Setup at the temporary anchor preserved (§20/§32).

## §33 — Statistics / reporting model (design only)

Future fields: Datum `FREE — inner constrained`; datum defect 3 per
free component; free-component count; inner constraints
`ΣdX = ΣdY = ΣdZ = 0` per free component (corrections); rank-based DOF;
coordinate precision labeled inner-constrained datum; residual/QC
labeled datum-invariant. Never call the gauge station "fixed".

## §34 — Preanalysis / blunder / what-if (audit)

Current GNSS preflight/one-block what-if/loop QC/statistics assume ≥1
fixed station at the preflight gate (`gnssBaselinePreflight.ts:143-153`;
workspace gates preserve the error verbatim at
`gnssWorkspaceSession.ts:231-258`). Required future changes identified,
not implemented: datum-aware preflight branch under explicit opt-in,
rank-based DOF in what-if paths, loop QC already datum-safe.

## §35 — Failure semantics (design only)

Free opt-in must still fail for: insufficient connectivity, invalid
covariance, rank defect ≠ 3/component, malformed normals, unexpected
nullspace modes, nonfinite solutions, incompatible
frame/epoch/ellipsoid. Never accept any singular network as "free".

## §36 — Extra-rank-defect tests

Isolated station, disconnected unconstrained station, self-only
topology, duplicate-only topology: all throw a distinct `extra rank
defect` error (not the legitimate 3-translation deficiency, not a silent
solve).

## §37 — Synthetic corpus

Deterministic triangle / ring / mesh / tree+closure / repeated-baseline
/ multi-component networks, each in constrained + free versions, with
realistic ECEF coords; invariant quantities compared per §§8/11.

## §38 — Performance (evidence only; ring+chord meshes)

| stations | vectors | params | constrained | gauge solve | S-transform | loop-QC |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 30 | 27 | 8.3 ms | 2.4 ms | 0.06 ms | 6.9 ms |
| 50 | 150 | 147 | 20.3 ms | 22.5 ms | 0.04 ms | 3.2 ms |
| 100 | 300 | 297 | 87 ms | 77 ms | 0.07 ms | 9.5 ms |
| 250 | 750 | 747 | 869 ms | 783 ms | 0.17 ms | 46 ms |
| 500 | 1500 | 1497 | 7177 ms | 7138 ms | 0.45 ms | 189 ms |

Free-vs-constrained parity asserted at every size. KKT-vs-GINV timing:
not applicable (no such production routes; free = gauge+S). Datum
transform cost is negligible (≤0.45 ms at 500 stations); architecture
choice is driven by correctness/simplicity, not speed.

## §39 — Recommended MVP

**MVP-B: temporary gauge + S-transform, TS only.** Smallest
implementation that is a true free adjustment (gauge is computational,
final datum is inner-constrained), produces correct inner-constrained
covariance (`S·Q·Sᵀ`), preserves all Phase12D outputs (residual stats
need no transform per §27), and never misrepresents the anchor as
control. Native/bounded-covariance strategy (Option B) deferred to a
follow-up; R2B needs no changes for this MVP.

## §40 — No production change (proof)

- `git status`: only `TODO.md` + 6 new files
  (`src/engine/gnssFreeNetwork{Datum,Solvers,Evidence}.ts`,
  `tests/gnssBaseline/gnssFreeNetwork{Evidence,Datasets}.test.ts`,
  `scripts/gnss/gnssFreeNetworkPerfEvidence.ts`).
- Zero modified production files; new engine helpers have no
  production importers (grep-verified).
- Preflight still throws the verbatim free-network error (asserted).
- `test:agent` delta vs baseline: none (only pre-existing Study
  failures). R2B production routing, tolerances, UI, worker routing
  untouched.

## §§42–43 — Acceptance A–S and decision

| ID | Criterion | Verdict |
| --- | --- | --- |
| A | 3-translation defect proven | PASS (§1) |
| B | 3c multi-component defect proven | PASS (§2) |
| C | Rank-based DOF proven | PASS (§3, B-129/A-228) |
| D | KKT validated | PASS (§4) |
| E | Generalized inverse validated | PASS (§5) |
| F | Gauge+S validated | PASS (§6) |
| G | Gauge choice invariant | PASS (§7) |
| H | Constrained/free residual equivalence | PASS (§§11–13) |
| I | Free covariance datum semantics proven | PASS (§§14–16) |
| J | Qvv/redundancy datum invariance | PASS (§17) |
| K | Redundancy trace = rank-based DOF | PASS (§18) |
| L | Loop QC invariant | PASS (§19) |
| M | Setup uncertainty preserved | PASS (§20) |
| N | Dataset B free/constrained parity | PASS (§12) |
| O | Dataset A free/constrained parity | PASS (§13) |
| P | Extra rank deficiency detected | PASS (§36) |
| Q | R2B selected-covariance limits understood | PASS (§§25–28) |
| R | Recommended MVP selected | PASS — MVP-B (§39) |
| S | No production behavior changed | PASS (§40) |

**Decision: GO-FREE-MVP-B.** Recommended Phase 12I.1: implement TS-only
temporary-gauge + S-transform free adjustment behind explicit
`datumMode: 'allow-free'` opt-in (fail-closed default), with inner
constraints `Σd = 0` per free component, rank-based DOF, §33 reporting
fields, §35 failure semantics, and §22 UI gating; native/bounded
covariance (Option B) as a later performance follow-up.
