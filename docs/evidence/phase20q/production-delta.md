# Phase 20Q — production delta (future phase requirements, no implementation)

- Branch: `research/phase20q-vertical-profile-transition-law`, baseline
  `4998f70c`. STUDY ONLY; zero `src/` changes. Nothing below is implemented,
  authorized, or scheduled. Verdicts from `decision.md`: unified sloped
  `GO_SLOPED_SOURCE_VERTICAL_PROFILE_S1` (all families, with a
  family-specific implementation delta); step
  `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`.

## 1. Sloped delta (required for the unified GO, future phase only)

The law is unchanged; admission, the tile's vertical input, and (for
distance/elevation) the worker validator move.

1. **Admission predicate** (`gradingTransitionPolicy.ts`): replace the
   `NON_FLAT` conjunct (:209–210) with a bounded slope predicate that admits
   a sloped member iff the joint stays exactly continuous
   (`left.endZ === right.startZ === jointZ`, unchanged `JOINT_Z_STEP`
   :211–212). Keep `NON_COLLINEAR` (:208), family/grade/side/width/native
   gates unchanged. No angle bound: plan collinearity is already exact, and
   slope is unbounded in the native source model.
2. **Worker admission mirror**: `checkGroupTransitionAgreement` (:357)
   re-admits through the same predicate, so it inherits the relaxation with no
   separate code path.
3. **Tiler vertical extension — REQUIRED, and NOT covered by relaxing
   `NON_FLAT`.** Production hardcodes `const Z = mL.endZ`
   (`gradingGroupTransitionTile.ts`:243) and solves the outer natives FLAT
   (`startZ: Z, endZ: Z`, :267–320). Relaxing admission alone still fails
   closed on sloped rows (B1: 2520/2520 non-flat rows reject
   `TRANSITION_REJECTED`), and any hypothetical admit would flatten the
   surveyed slope to the joint Z — it does **not** reproduce S1 daylight.
   Explicit minimal extension: parameterize Z per station,
   `Z(s) := physical per-station source Z` (native per half, exact at joint),
   passing the true member `startZ`/`endZ` into the outer sub-solves;
   `evaluateTransitionLinearV1` and `transitionDaylightAt` stay untouched.
   Study proof (`phase20qTiling.ts` B1): `extensionDev === 0` on every sloped
   row (reproduces S1 daylight exactly, incl. CREST/SAG), while the unextended
   fixed-Z tile diverges (`fixedZDev > 0`). No new law, epsilon, or parameter.
4. **Validator vertical extension — REQUIRED for distance/elevation only.**
   The current `validateTransitionResultMesh` accepts untampered sloped S1 for
   relative-elevation (216/216 non-flat) but rejects distance (204/216) and
   elevation (216/216) at `GRADING_AGREEMENT_TRANSITION_OFF_LAW`, because it
   resolves and derives at the single `input.jointZ`. Per-checkpoint
   parameterization replaces every jointZ-fixed reference with the
   checkpoint's own source Z (`source.z`, already parsed at :624–631):
   - native boundary cuts (`surfaceGradingCompute.ts`:634/636): pass the
     checkpoint's own source Z into `checkNativeBoundary`
     (`checkNativeBoundary`'s `jointZ` parameter :558/566 → per-station Z,
     used both to `resolveAnalyticCriterionAt` and as the relative-elevation
     `limitElevation - jointZ` reference);
   - elevation plan derivation (:653–655): `(expectedV - input.jointZ) / g` →
     `(expectedV - source.z) / g`;
   - distance Z derivation (:670): `input.jointZ + g * expectedV` →
     `source.z + g * expectedV`.
   The geometry/tolerance loop itself is unchanged (no new epsilon). Study
   proof (`phase20qRecheck.ts` → `phase20qPerCheckpointSourceZExtension`):
   PASS all **666 S1 + 156 J1**, per family; the extended study tile
   (`phase20qExtendedStudyTile`) reproduces S1 exactly (`outerOk 666/666`,
   `outerDev=0`, `extensionDev=0`, 8 checkpoints). So the only missing piece
   for distance/elevation is this `src/` extension.
5. **No worker/topology change beyond (1)+(4)**: `validateTransitionInteriorVertices`
   is scalar-only; the collinear result-mesh basis is correct because the
   chord stays +X; gtop2 is law-agnostic.
6. **No persistence change**: `CadGradingTransition`, `ggrev1`
   (`gradingGroupRevision.ts`:166–167), and provenance citations already cover
   the case.
7. **Tests (future phase)**: gates for sloped-admit / step-reject, CREST/SAG
   C0, zero-slope reduction, transforms, the worker agreement path, the
   per-station-Z tiler extension, and the per-checkpoint-Z validator on
   distance/elevation.

Today the real production tiling path admits the 102 flat controls and
rejects the 2520 non-flat rows; `checkFlatReductionFullSolve` matches the FULL
production flat solve bitwise on **102/102**.

Explicitly out of scope: any new epsilon, any smoothing, any new law kind,
any non-collinear plan change, any step support.

## 2. Step delta: NONE-REQUIRED

No production change is proposed. The step stays fail-closed at
`JOINT_Z_STEP` (`gradingTransitionPolicy.ts`:211–212) and the group
`exactXyz` joint gate (`gradingGroupCompute.ts`:306–308). The evidence
(`joint-step-laws.md`, `geometry-results.md`) shows no source-preserving law
the current topology can certify, so there is no bounded delta to name. A
future vertical-face topology would be a new model/study — it must not be
smuggled in as a relaxation here.

## 3. Gates that would otherwise need change (for the record)

| Gate | Sloped | Step |
|---|---|---|
| `NON_FLAT` :209–210 | EXTEND (bounded slope) | unchanged (still refuses non-flat for any step attempt) |
| `JOINT_Z_STEP` :211–212 | unchanged (joint continuous) | unchanged (this is the permanent refusal) |
| tiler fixed-Z :243 + flat outer :267–320 | EXTEND (per-station `Z(s)`, true member Zs) | unchanged (never reached; fails closed earlier) |
| validator jointZ cuts/derivation :634/636 + :653–655 + :670 | EXTEND per-checkpoint source Z (distance/elevation only) | unchanged (fails closed at admission first) |
| `exactXyz` group gate :306–308 | unchanged (passes) | unchanged (refuses) |
| worker result-mesh basis :644 | unchanged (collinear) | would need a vertical-face basis — not attempted |
| `ggrev1` hash | unchanged | would need joint-Z pair — moot |

## 4. Phase 20O status

Phase 20O stays **`POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW`**, frozen and
untouched. This phase neither resolves nor weakens the non-collinear plan
blocker; the sloped GO is orthogonal (plan collinearity is still exact).
Phase 20P.1 production (sparse collinear sets) is unchanged.
