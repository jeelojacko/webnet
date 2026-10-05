# Phase 20Q — geometry results (evidence grid)

- Branch: `research/phase20q-vertical-profile-transition-law`, baseline
  `4998f70c`. STUDY ONLY; zero `src/` changes.
- Corpus: `docs/evidence/phase20q/corpus.json`, **2622 rows**, sha256
  `26019cb911a2909f78b062fa13c9eeae7bc8e3621fdfea3b5eeec5d4043baa94`
  (double-regen byte-identical: study driver + `phase20qCorpusRegen.ts`;
  persisted-bytes read-back verified, `validation.md` §1).
- Study core: `scripts/phase20qFixtures.ts`, `phase20qLaws.ts`,
  `phase20qEvidence.ts`, `phase20qTransforms.ts`, `phase20qVerticalProfileStudy.ts`.
- Row counts: S1=S2=S3=666, J1=J2=J3=J4=156; matrix sloped 1998 / step 624;
  families distance 874 / relative-elevation 874 / elevation 874; sides
  1311/1311.

## 1. Fixture matrix

- Sloped: gravity constant `g = 0.5`, `LL = 30`, `LR = 50`, `jointZ = 10`,
  plan collinear +X. Patterns × magnitudes (1e-9, 0.01, 0.05, 0.15, 0.5;
  narrower set for STEEPER/SHALLOWER) × widths {2, 10, 60} × 3 families ×
  2 sides = 666 cases. Patterns: EQ_POS, EQ_NEG, FLAT_TO_POS, POS_TO_FLAT,
  STEEPER, SHALLOWER, CREST, SAG, FLAT_FLAT.
- Step: grades 0, step specs = {0, ±1 ULP above 10, ±0.001, ±0.01, ±0.1,
  ±1, ±10} × widths {10, 60} × 3 families × 2 sides = 156 cases.
- Continuous iff `step === 0` exactly (never epsilon): 1-ULP cases
  (`PHASE20Q_ULP_STEP ≈ 1.776e-15`) classify as **step** — 96/96 rows.

## 2. Sloped headline numbers (per law, 666 rows)

| Law | reject/disposition | C0 joint gap | C0 cut gaps | certifies | source preserved |
|---|---|---|---|---|---|
| S1 | none | 0 | 0 | 666/666 | yes |
| S2 | `AUTHORITY_VIOLATING_SMOOTHED_Z` | 0 | 0 | 666/666 | no |
| S3 | `RESULT_Z_SMOOTHED_TENSION_0.5` | 0 | 0 | 666/666 | yes (τ hidden) |

- S1 source tangent deflection at the joint (`c1Source`) spans `0` (flat) to
  `0.927 rad ≈ 53.1°` (CREST/SAG at `|slope| = 0.5`). This is the survey's
  own deflection, inherited by the frame law — not law-injected.
- The stored `c1Daylight` metric saturates for near-degenerate segments and is
  **not** used for any verdict; the trusted C1 evidence is the source
  deflection plus the mid-interval kink (frame law inherits it).
- S2 rewrites source Z by up to `2.1967 m`; S3 deviates daylight from S1 by up
  to `7.5 m`.

## 3. Step headline numbers (nonzero-step, per law, 144 rows each)

| Law | gtop2 | `c0JointGap` | `c0CutR` | reversal | source preserved |
|---|---|---|---|---|---|
| J1 | refused 144/144 | `step` (2× elevation) | 0 | 0 | yes |
| J2 | certifies 156/156 | 0 | 0 | 0 | **no** |
| J3 | refused 144/144 | `step` (2× elevation) | 0 | 0 | yes |
| J4 | refused 144/144 | 0 | `step` (2× elevation) | `|step|` exact (distance/rel-el); 2× (elevation), max 20 m | yes |

- Step magnitudes/signs: `±{1 ULP, 0.001, 0.01, 0.1, 1, 10}`; both signs
  gridded. Max nonzero step = `10 m`.
- The `2×` elevation factor is `step/g` (`g = 0.5`): the same target
  elevation sits at a different horizontal offset from each half's source Z.
- J4 is reversal-asymmetric: for `distance` and `relative-elevation` the
  deviation is exactly `|step|` (ratio 1); for `elevation` absolute targets
  re-resolve on reversal and the deviation is `2×|step|` (ULP step → 2-ULP
  reversal; max `20 m` at `step = 10`). Pin J4 reversal **per family**.
- Total gtop2 refusals = **432** (= J1/J3/J4 × 144); J2's certifications are
  the only ones, and they are bought by falsifying the source.

## 4. Topology / certificate

- `countPositiveWidthRegions` + `buildGradingStripMesh` +
  `deriveTransitionExpectation` (pre-mesh 1/1/1) + gtop2 exact revalidation:
  all 2190 non-refused rows certify with `revalidation === null`. The 432
  refused rows are all nonzero-step J1/J3/J4 (`mesh.error = 'gtop2-refused'`).
- No expectation was derived from measured geometry: the 1/1/1 declaration is
  pre-mesh structure only (`topology-worker-provenance.md` §1).

## 5. Reduction, determinism, transforms

- **Zero-slope reduction**: 102 flat-control rows (18 sloped FLAT_FLAT cases
  × 3 laws = 54, plus 12 step-m0 cases × 4 laws = 48). Each has
  `flatReductionExact === true` on **102/102** — i.e. the law reproduces the
  production flat path (`jointZ` + V1 + `transitionDaylightAt`) bitwise on
  `===`.
- **Real production tiling path (B1)**: driven with source-exact member
  endpoints, it **admits the 102 flat controls and rejects the other 2520
  rows** (`TRANSITION_REJECTED`); `checkFlatReductionFullSolve` matches the
  FULL production flat solve (`runFlat`/`srcFlat`/`law`) bitwise on
  **102/102**. The minimal per-station-Z extension reproduces S1 daylight
  exactly (`extensionDev === 0`); the unextended fixed-Z tile diverges on
  every sloped row (`fixedZDev > 0`) — relaxing `NON_FLAT` alone is not
  sufficient.
- **Transforms** (study-wide maxima, hybrid law points): translate-1e6
  ≤ `5.78e-11 m`; translate-1e8 ≤ `6.56e-9 m` (S1/S3; S2 ≤ `7.15e-9`,
  J2 ≤ `6.44e-9`, J1/J3/J4 ≤ `4.17e-9`); Z-shift ≤ `2.49e-14 m`. These are
  **not** exactly 0; only **mirror (0 everywhere)** and **reversal** are exact
  for S1/S3/J1/J2/J3 (S2 = `7.1e-15`). J4 reversal is per-family (see §3).
- **Flat-control residuals** are nonzero by design: `maxResidual` is the
  blend-vs-native gap, not an error — S1 distance ≤ `1.0`, relative-elevation
  ≤ `0.5`, elevation ≤ `0.5` (the endpoint spread halved; identical in kind
  to production's flat transition). The zero-slope reduction criterion is
  **bitwise `===` equality of V1 + `transitionDaylightAt`**, not residual 0
  (`flatReductionExact`).
- **Tamper**: the 5 agreement probe classes (`sourceZ`, `slope`, `scalar`,
  `family`, `side`) are **strict per probe** — each **102 caught / 2520
  inapplicable / 0 missed**. Caught only on the 102 flat-control rows the
  agreement gate admits untampered; the other 2520 reject untampered
  `GRADING_AGREEMENT_TRANSITION_GEOMETRY` and are inapplicable. The 6th class,
  `width`, goes through the REAL `validateTransitionResultMesh` with an
  asymmetric `sL` (its untampered pass set is the larger rel-elevation-sloped +
  flat set): **894 caught / 1728 inapplicable / 0 missed**. Untampered-reject
  rows are counted inapplicable, never as caught.
- **Worker recomputation**: persisted-field-only `matchVsRow === true` on
  2622/2622 rows (rebuild from row fields, no fixture reuse) + B2
  source-Z-aware per-family check (S1 666/666, J1 156/156).
- **Current real validator on untampered sloped S1 (M1, per family over the
  216 non-flat rows)**: relative-elevation **216/216** pass; distance
  **12/216** pass (near-flat `1e-9` W2 only); elevation **0/216**. Every
  failure is exactly `GRADING_AGREEMENT_TRANSITION_OFF_LAW` (a jointZ-fixed
  gate, not a new code). Flat controls 6/6 per family pass.
- **Per-checkpoint-source-Z validator extension** (`phase20qRecheck.ts`):
  PASS all **666 S1 + 156 J1** rows, per family. **Extended study tile**
  (`phase20qExtendedStudyTile`): `outerOk 666/666`, `outerDev=0`,
  `extensionDev=0`, 8 checkpoints — the extension reproduces S1 end-to-end;
  production needs the per-station-Z parameterization.

## 6. Decisive reading

- **Sloped (unified GO)**: S1 is source-exact, C0, certifies, reduces
  bitwise, and stabilises under every transform for **all** families, so the
  verdict is `GO_SLOPED_SOURCE_VERTICAL_PROFILE_S1` for Distance,
  RelativeElevation, and Elevation. The current production validator accepts
  it only for **relative-elevation**; distance/elevation are rejected
  `OFF_LAW` by the jointZ-fixed validator pending the proven per-checkpoint-
  source-Z extension (implementation work, not policy). S2 falsifies the source; S3 hides τ.
- **Step**: every source-preserving law is topologically refused; the one
  certifying law mutates the source; J4 is reversal-asymmetric. A step is a
  source discontinuity with no lawful planar-strip representation.
  → `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`.
