# Phase 20Q — sloped-source vertical-profile laws (S1 / S2 / S3)

Study-only. Zero `src/` changes. Corpus `docs/evidence/phase20q/corpus.json`
(2622 rows, sha256 `26019cb9…`); sloped matrix = 666 cases × 3 laws = 1998
rows. Shared setup for all three laws: same fixtures, same legislated scalar
`v(s)` via production `evaluateTransitionLinearV1`, same endpoints, same
stations, same `transitionDaylightAt`. Only the *source/daylight Z* treatment
differs.

## 1. The three laws

| Law | Source Z | Daylight Z | Source mutation? |
|---|---|---|---|
| **S1** piecewise-physical | native per half (`jointZL + srcSlopeL·(s-LL)`), exact | V1 scalar → `transitionDaylightAt(v, g, Zsrc(s))` | none |
| **S2** smoothed-bridge (control) | cosine blend `(1-w)·zl + w·zr`, `w=(1-cos πt)/2` across `[sL,sR]` | from the smoothed source | **yes — rewrites surveyed Z** |
| **S3** daylight-only smoothing | native per half (like S1) | `(1-τ)·daylight_S1 + τ·bridge`, fixed `τ = 0.5` | none, but hides τ |

`PHASE20Q_S3_TAU = 0.5` is fixed and never defaulted: calling S3 without an
explicit τ throws. The corpus records `RESULT_Z_SMOOTHED_TENSION_0.5`.

## 2. Truthfulness

- **S1** is the only candidate that is faithful to the survey: the source Z
  is the native per-half elevation at every station, so a sloped source is
  represented exactly as surveyed. It adds no invented Z.
  - `maxResidual` (law daylight vs native criterion at the station's own
    source Z) is the legislated blend, not an error: distance ≤1.0 m,
    relative-elevation ≤0.5 m, elevation ≤0.5 m — the endpoint spread
    (`|vR-vL|` halved), identical in kind to production's flat transition.
    The flat-reduction criterion is **bitwise V1 + `transitionDaylightAt`
    equality**, never residual 0.
  - `c0JointGap = 0` and `c0CutL = c0CutR = 0` on **all** 666 sloped rows,
    including CREST/SAG (the worst tangent-deflection patterns).
- **S2** falsifies the source for a benefit that is entirely cosmetic: it
  rewrites surveyed Z by up to **2.1967 m** (`q20-slope-CREST-m0p5-W60-distance-left`)
  inside the interval. Production `NON_FLAT` exists to stop exactly this.
  S2 still tiles and still certifies (planar geometry), which is precisely
  why gtop2 cannot be used to *select* a law (`topology-worker-provenance.md`).
- **S3** does not mutate the source, but it smooths the *daylight* with a
  constant τ that has no authority. Its daylight deviates from S1 by up to
  **7.5 m** — a hidden parameter presented as a law. Rejected as written;
  any τ-based law is POLICY_REQUIRED on the τ rule alone.

## 3. Worker recomputation (independent, not study-truth reuse)

The worker evidence rebuilds each case SOLELY from persisted per-row fields
(`phase20qIndependentRecompute`, never the in-memory fixture), re-resolves
`vL`/`vR` from `resolveAnalyticCriterionAt` plus the family scalar rule, and
compares against the law oracle: `matchVsRow === true` on **2622/2622** rows
(all laws, sloped and step), 0 errors. Five agreement probe classes
(`tampered-sourceZ`, `-slope`, `-scalar`, `-family`, `-side`) are **strict per
probe**: each is **102 caught / 2520 inapplicable / 0 missed** — caught only on
the 102 flat-control rows the agreement gate admits untampered, the other 2520
reject untampered `GRADING_AGREEMENT_TRANSITION_GEOMETRY` and are inapplicable.
The sixth, `width`, goes through the REAL production
`validateTransitionResultMesh` with an asymmetric `sL` (a larger untampered
pass set: rel-elevation sloped + flats) —
**894 caught / 1728 inapplicable (untampered already rejects) / 0 missed**. The B2 source-Z-aware check (`phase20qSourceZAwareCheck`) validates
each station's
daylight against production `transitionDaylightAt` at its OWN source `Z(s)`,
per family at cut/end stations: **S1 666/666 PASS**, with a jointZ-fixed
negative control that diverges on slope only. This is independent
recomputation, not a re-read of the oracle output.

Live worker agreement on a sloped intent still rejects
`GRADING_AGREEMENT_TRANSITION_GEOMETRY`: `checkGroupTransitionAgreement`
re-admits through `admitGradingTransition`, which is blocked at `NON_FLAT`.
That rejection is expected and is an *admission* gate, not a validator
defect — the interior scalar check (`validateTransitionInteriorVertices`) and
the collinear result-mesh basis are reusable unchanged for S1. It does **not**
mean the current tile can render S1: the real tiling path (`phase20qRealTilingProbe`)
admits only the 102 flat controls and rejects the other 2520 rows, because the
tiler hardcodes `Z = mL.endZ` and flat outer sub-solves (`production-delta.md` §1.3).

## 4. Headline comparison

| Metric | S1 | S2 | S3 |
|---|---|---|---|
| reject/disposition | none (GO candidate) | `AUTHORITY_VIOLATING_SMOOTHED_Z` | `RESULT_Z_SMOOTHED_TENSION_0.5` |
| source Z mutation vs native | 0 | ≤2.1967 m | 0 |
| max daylight dev vs S1 | 0 | (source-driven) | ≤7.5 m |
| C0 joint/cut gaps | 0 / 0 | 0 / 0 | 0 / 0 |
| gtop2 certify | 666/666 | 666/666 | 666/666 |
| zero-slope reduction exact | yes | yes (degenerate) | yes |
| hidden parameter | none | none (but mutates source) | **τ = 0.5** |

All three pass determinism/stability and zero-reduction; the discriminator is
truthfulness, and S1 is the only law that keeps the surveyed source intact
without inventing a smoothing constant.

## 5. Verdict input

S2 rejects on authority (it moves/falsifies the source). S3 rejects on the
hidden τ. S1 is source-exact, certifies, stabilises and reduces to the flat
production path bitwise for **all** families — but the current production
validator only accepts untampered sloped S1 for **relative-elevation**
(216/216 non-flat passes). Distance (12/216) and elevation (0/216) are
rejected `GRADING_AGREEMENT_TRANSITION_OFF_LAW` by the jointZ-fixed validator.
The study-side per-checkpoint-source-Z extension PASSes all 666 S1 rows per
family and the extended tile reproduces S1 exactly (`extensionDev=0`), so the
honest verdict is unified: `GO_SLOPED_SOURCE_VERTICAL_PROFILE_S1` for
all three families (the validator extension for distance/elevation is bounded
implementation work, `decision.md`, `production-delta.md` §1.4). All rest on the bounded delta: relax `NON_FLAT`
+ per-station-`Z(s)` tiler extension (+ the validator extension for
distance/elevation); relaxing admission alone is not enough.
