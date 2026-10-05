# Phase 20Q decision — vertical-profile transition law (sloped decided per family)

- Branch: `research/phase20q-vertical-profile-transition-law`, baseline
  `4998f70c` (PR #166 merge). Method: STUDY ONLY. Zero `src/` changes.
- Inputs: `forensics.md`, `sloped-source-laws.md`, `joint-step-laws.md`,
  `geometry-results.md`, `topology-worker-provenance.md`, study scripts
  `scripts/phase20q*.ts`, corpus `docs/evidence/phase20q/corpus.json`
  (2622 rows, sha256 `26019cb9…`; 20Q tests **70/70 green** across 3 files,
  including review-fix round-2 pins 20Q.17–19).
- Prior context: Phase 20O `POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW` (plan
  deflection, frozen); Phase 20P/20P.1 sparse collinear sets (plan gaps).
  Vertical profile was untouched by both.

## Verdicts (sloped is FAMILY-SCOPED; step unchanged)

- **Sloped source — relative-elevation:**
  **`GO_SLOPED_SOURCE_VERTICAL_PROFILE_S1`.**
- **Sloped source — distance & elevation:**
  **`POLICY_REQUIRED_SLOPED_SOURCE_Z_LAW`** — the S1 law is sound, but the
  current production validator does not accept it for these families; the
  named per-checkpoint-source-Z validator extension is required (a `src/`
  change, out of study scope).
- **Joint Z step (coincident-XY, distinct-Z):**
  **`NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`.**

No unified sloped GO is declared. On untampered sloped S1 the CURRENT
production `validateTransitionResultMesh` passes only relative-elevation
(**216/216** non-flat rows); distance passes **12/216** (near-flat
`1e-9` W2 rows only) and elevation **0/216** — every other non-flat reject is
exactly `GRADING_AGREEMENT_TRANSITION_OFF_LAW` (flat controls 6/6 per family
pass). The obstruction is **not** the law: the study-side per-checkpoint-source
Z extension (`phase20qRecheck.ts` → `phase20qPerCheckpointSourceZExtension`)
PASSes all 666 S1 + 156 J1 rows per family, and the extended study tile
(`phase20qExtendedStudyTile`) reproduces S1 exactly (`outerOk 666/666`,
`outerDev=0`, `extensionDev=0`, 8 checkpoints). Distance/elevation are
therefore `POLICY_REQUIRED` on the named extension, not `NO_GO`.

## 1. Sloped GO gate — per family

All 12 criteria are met by S1 for **relative-elevation** under the current
validator. For distance/elevation, criteria 9 and 12 are scope-split: the law
side is met, the validator side waits on the per-checkpoint-source-Z extension.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Unique law selection by geometric authority, not taste | PASS all families | S2 falsifies the source (≤2.1967 m); S3 hides τ=0.5 (≤7.5 m daylight dev); S1 is the only source-exact law (`sloped-source-laws.md` §2) |
| 2 | Source geometry preserved exactly (no mutation of surveyed Z) | PASS all families | S1 source-Z mutation 0 on all 666 rows |
| 3 | Endpoint scalar single authority, frame-independent | PASS all families | `resolveAnalyticCriterionAt` + `scalarOf`; no second formula |
| 4 | Interior scalar law unchanged | PASS all families | production `evaluateTransitionLinearV1` called directly |
| 5 | C0 exact at joint and both cuts; C1 break not law-injected | PASS all families | `c0JointGap=0`, `c0CutL=c0CutR=0` incl. CREST/SAG; joint tangent break is the survey's own `c1Source` (≤0.927 rad) |
| 6 | Zero-slope reduction to the flat production path bitwise | PASS all families | 102/102 flat controls `flatReductionExact === true` |
| 7 | Determinism + transform stability | PASS all families | translate-1e6 ≤5.78e-11, 1e8 ≤6.56e-9, mirror 0, reversal 0 |
| 8 | Pre-mesh expectation == measured; gtop2 certify + revalidate | PASS all families | M4: 1/1/1 declared before measure/build, `preMeshGate=null` 2622/2622; non-refused 2190/2190 certify, revalidation `null`; B2 source-Z-aware S1 666/666 (jointZ-fixed control diverges on slope only) |
| 9 | Worker independent recompute + reusable validators | rel-elev PASS; distance/elevation extension-gated | persisted-field recompute 2622/2622; 5 agreement tampers strict per probe (each 102 caught / 2520 inapplicable / 0 missed; 510/12600/0 total); width probe via the real validator 894 caught / 1728 inapplicable / 0 missed. Two different gate baselines: the agreement gate (`checkGroupTransitionAgreement`) admits only the 102 flat controls untampered, so each agreement class catches 102 and marks 2520 inapplicable; the mesh validator (`validateTransitionResultMesh`) passes the larger rel-elevation-sloped + flat set, so its width probe catches 894. `validateTransitionResultMesh` accepts untampered rel-elev (reusable) but rejects untampered distance/elevation `OFF_LAW`; the study extension PASSes all families |
| 10 | No new epsilon / hidden default / smoothing parameter | PASS all families | exact `===` throughout; S1 introduces none |
| 11 | No new law kind / persistence schema / revision field / citation | PASS all families | stays `TRANSITION_LINEAR_V1`/`v1`; `ggrev1` already hashes width+law; citations reuse |
| 12 | Bounded production delta nameable without inventing geometry | PASS (delta extended by the validator change) | three bounded changes: relax `NON_FLAT` (:209–210); per-station-`Z(s)` tiler extension (`gradingGroupTransitionTile.ts`:243 + :267–320, `extensionDev=0`); for distance/elevation only, per-checkpoint source Z in `validateTransitionResultMesh` (`surfaceGradingCompute.ts`:634/636 + :653–655 + :670) — see `production-delta.md`. Rel-elev needs no validator change |

Per-family scope: S1 is source-exact and certifies for **all** three families
(666/666); the family split is entirely in the current validator
(`validateTransitionResultMesh`), which resolves every cut at the single
`jointZ`. Relative-elevation is source-Z-difference-invariant, so it cancels
and passes; distance/elevation expose the fixed-Z assumption. The GO/extension
is therefore honest only per family.

## 2. Step gate: the 12 criteria do not clear, plus step extras

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 2 | Source preserved | J2 only — and J2 mutates the source | fails by definition |
| 5 | C0 | J1/J3 gap = step; J4 fakes joint-C0 but `c0CutR`=step | fail |
| 7 | Reversal stability | J4 reversal = `|step|` (distance/rel-el) / `2×|step|` (elevation), max 20 m | fail |
| 8 | Topology certify | J1/J3/J4 refused (432/432); J2 certifies only by mutation | fail |
| 10 | No hidden default | J2/J3 invent bridging; J4 pins `jointZL` | fail |

Step extras:

- **E1 — representability**: a coincident-XY, distinct-Z joint is a vertical
  face, not a planar joint. No source-preserving law supports it. FAIL.
- **E2 — source preservation without losing C0**: impossible here — J1/J3 lose
  C0, J4 loses right-cut continuity and reversal. FAIL.
- **E3 — gtop2 on a source-preserving step**: refused 432/432. FAIL.
- **E4 — reversal/mirror coherent**: J4 asymmetric by exactly the step. FAIL.
- **E5 — no source mutation**: the only certifying law (J2) mutates the
  source; categorically forbidden. FAIL.

Decisive observation: **every source-preserving step law (J1/J3/J4) is
gtop2-refused, and the only certifying law (J2) does so by destroying the
surveyed source.** The obstruction is the source discontinuity itself, not a
missing parameter — hence `NO_GO`, not `POLICY_REQUIRED`.

## 3. What each verdict does and does not authorize

- The relative-elevation GO authorizes a future bounded production delta
  (relax `NON_FLAT` **and** add the per-station-Z tiler extension, keep
  `JOINT_Z_STEP`), **not** any implementation in this study phase.
- The distance/elevation `POLICY_REQUIRED` authorizes the same delta **plus**
  the named per-checkpoint-source-Z validator extension; until that extension
  is specified/landed, those families stay fail-closed at `NON_FLAT` and
  `GRADING_AGREEMENT_TRANSITION_OFF_LAW`. No non-collinear (20O) change, no
  step support, no new tolerance/schema/law.
- Step NO_GO means production should continue to fail closed at
  `JOINT_Z_STEP` (and `exactXyz`), and no step law should be pursued under the
  current planar-strip group topology. A future vertical-face topology would
  be a new study, not a relaxation of this one.
