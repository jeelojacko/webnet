# Phase 20Q — vertical-profile transition law forensics

Branch: `research/phase20q-vertical-profile-transition-law`, baseline `4998f70c`
(PR #166 merge). Study-only: `git diff --stat -- src` empty.

Question: for ONE otherwise-collinear, same-family transition at an open
group joint, may production admit (a) a **sloped source** (joint-continuous,
nonzero dZ) and (b) a **joint Z step** (coincident-XY, distinct-Z)? The two
are decided separately (`decision.md`). This file is the authority inventory
a vertical-profile law would touch, with a disposition per site.

Line numbers verified against this checkout. `NON_FLAT`/`JOINT_Z_STEP`/V1 are
quoted from the source; the rest reuse the Phase 20Q scout map.

## 1. Admission authority — `src/engine/cad/grading/gradingTransitionPolicy.ts`

| Site | Line | What it does | Disposition |
|---|---|---|---|
| `TRANSITION_LAW_KIND`/`VERSION` | 20–21 | `TRANSITION_LINEAR_V1` / `v1` | REUSE (S1 needs no new kind; step would need one) |
| `scalarOf` | 177 | endpoint scalar per family (`d` / `Δ` / `E`) | REUSE unchanged |
| `admitGradingTransition` | 183 | the single admission authority | EXTEND predicate |
| `NON_COLLINEAR` (`cross===0 && dot>0`) | 208 | exact plan-collinearity | REUSE unchanged (this is not the slope gate) |
| `NON_FLAT`: `left.startZ===left.endZ && right.startZ===right.endZ` | 209–210 | rejects any sloped member | **EXTEND for sloped** (bounded slope predicate); **must stay for step** |
| `JOINT_Z_STEP`: `left.endZ===right.startZ && left.endZ===jointZ` | 211–212 | rejects joint discontinuity | **KEEP for sloped** (joint must stay continuous); step would need a *different* predicate |
| family/grade/side/width/native checks | 213–232 | all other exact gates | REUSE unchanged |
| `evaluateTransitionLinearV1` | 238 | `v(s)=vL+(vR-vL)·t` — a pure scalar-per-station law, frame-free | REUSE unchanged |

Verified by reading: `NON_FLAT` and `JOINT_Z_STEP` are exact `===` (no
tolerance); V1 is a pure station function carrying no plan direction.

## 2. Native source construction — `solveAnalyticGradingChord.ts`

- `atSource(u)` (:146–149): `z = source.startZ + gs * u`. Sloped sources are
  **already** native geometry; production does not flatten them, it only
  *refuses* them at the transition gate. → REUSE; no new source model.

## 3. Endpoint resolution — `src/engine/cad/grading/gradingAnalyticCriterion.ts`

- `resolveAnalyticCriterionAt` (:154) dispatches `resolveDistance` (:86),
  `resolveElevation` (:101), `resolveRelativeElevation` (:117):
  `d = D`; `d = (E-Zsrc)/g`; `d = Δ/g`, with `limitZ = Zsrc+g·d`, `E`,
  `Zsrc+Δ`. For a sloped source `Zsrc` is the **station's own** source Z, so
  every family resolves per-half. → REUSE unchanged; the value is already
  frame-independent, which is why a vertical-profile law needs no new formula.

## 4. Daylight tiler — `src/engine/cad/grading/gradingGroupTransitionTile.ts`

- `transitionDaylightAt` (:99–111): given the scalar `v`, grade `g`, source
  `Z` at the station, plan `(Px,Py)` and side normal `(nx,ny)`, returns
  `d` and `z` per family (`distance: z=Z+g·d`; `relative-elevation: z=Z+v`;
  `elevation: z=v`). It **already consumes a per-station source Z**, so a
  sloped source is a caller-side input, not a law change. → REUSE unchanged.
- `planTransitionJoint` (:125) tiles natives outside `[-W/2,+W/2]` and the V1
  law inside, C0 by shared vertex refs. **Correction (B1):** it hardcodes
  `const Z = mL.endZ` (:243) and solves the outer natives FLAT
  (`startZ: Z, endZ: Z`, :267–320). `transitionDaylightAt` still consumes the
  per-station Z it is GIVEN; the caller does not. So the S1 delta is upstream
  **admission plus this caller-side per-station-`Z(s)` extension**, not
  admission alone. → `transitionDaylightAt` REUSE; `planTransitionJoint`
  EXTEND.

## 5. Group compute gates — `src/engine/cad/grading/gradingGroupCompute.ts`

- Per-joint `exactXyz` joint-continuity gate (:306–308) already requires
  `members[j].endZ === members[j+1].startZ`. This is the production mirror of
  `JOINT_Z_STEP` and is **independent of slope**: a sloped-but-continuous
  joint passes it; a Z step fails it (surfaces as code `CORNER_INVERTED` with
  detail `GRADING_GROUP_CORNER_MISMATCH`). → REUSE for sloped; it is the
  reason a step is already structurally refused before the transition ever
  tiles.

## 6. Worker validators — `src/workers/surfaceGradingCompute.ts`

| Site | Line | Role | Disposition |
|---|---|---|---|
| `checkGroupTransitionAgreement` | 357 | re-admits via `admitGradingTransition` → sloped/step reject today | EXTEND only through the shared admission predicate |
| `validateTransitionInteriorVertices` | 484 | checks the scalar magnitude only | REUSE unchanged |
| `validateTransitionResultMesh` | 614 | resolves/derives at ONE `jointZ` (cuts :634/636, elevation :653–655, distance :670); passes untampered sloped S1 rel-elev only | REUSE for rel-elev (jointZ-invariant); **EXTEND per-checkpoint source Z for distance/elevation** (study extension PASSes all families) |
| `validateGroupTransitionLegsMesh` | 780 | per-leg checkpoints | REUSE |

Recomputation is genuinely independent: `phase20qIndependentRecompute`
rebuilds each case SOLELY from persisted per-row fields (no fixture reuse),
re-resolves `vL`/`vR` via production `resolveAnalyticCriterionAt`, and matches
the law oracle 2622/2622; the B2 source-Z-aware check confirms S1 666/666 and
J1 156/156. The 5 agreement probe classes are **strict per probe** — each is
102 caught / 2520 inapplicable / 0 missed, caught only on the 102 flat-control
rows the agreement gate admits untampered (the other 2520 reject untampered
`GRADING_AGREEMENT_TRANSITION_GEOMETRY`). The width probe through the REAL
`validateTransitionResultMesh` runs a larger untampered pass set (rel-elevation
sloped + flats): 894 caught / 1728 inapplicable / 0 missed.

## 7. Topology — plan-only, law-agnostic

- `deriveTransitionExpectation` (`gradingTopologyExpectation.ts`:331) declares
  the pre-mesh 1/1/1 merged open strip from structure only.
- `countPositiveWidthRegions` / `buildGradingTopologyCertificateExact` /
  `gradingTopologyCertificateExactError`
  (`gradingTopologyCertificate.ts`:94/525/589) validate **a declared law**,
  never select one. → REUSE unchanged for sloped (certifies 666/666); it is
  the hard refusal for a source step (§ `geometry-results.md` §4).

## 8. Persistence / revision / provenance

- `CadGradingTransition` (`gradingGroupTypes.ts`:138–149) already carries
  `policyVersion / jointId / memberIds / width / lawKind / lawVersion /
  criterionFamily / side` (+ optional endpoints/provenance).
- `ggrev1` already hashes `width` and `law:${lawKind}/${lawVersion}`
  (`gradingGroupRevision.ts`:166–167). Persistence re-attaches verbatim
  (`gradingGroupPersistence.ts`:46/229).
- `buildTransitionProvenance` (:68) / `transitionResultBakeCitation`
  (:135) cite lawKind/lawVersion/width.

→ For S1 (same law, relaxed admission) persistence is **REUSE unchanged**;
no new `verticalLawKind`, no new hash field, no new citation kind. A step law
would need a new kind + a joint-Z pair in the hash — moot under
`NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY` (`topology-worker-provenance.md` §4).

## 9. Prior-art boundaries

- Phase 20L offset-radius study helpers (`docs/evidence/phase20l/*`,
  `scripts/phase20l*`) are **NOT authority** for profile law — they legislate
  arc-offset joins, not a joint-Z/slope law.
- Phase 20M/20N/20O/20P study corpora are not authority either; 20O left the
  joint gap (`JOINT_Z_STEP`) untouched because it studied plan deflection.

## 10. Disposition summary

| Concern | S1 sloped | step |
|---|---|---|
| Admission predicate | EXTEND `NON_FLAT` (bounded slope) | `JOINT_Z_STEP` stays; no surviving law |
| V1 scalar law | REUSE | REUSE (but no law reaches it) |
| `transitionDaylightAt` | REUSE | REUSE |
| tile caller fixed-Z (`:243`) + flat outer (`:267–320`) | **EXTEND to per-station `Z(s)`** | unchanged (fails closed earlier) |
| native `atSource` | REUSE | REUSE |
| criterion resolution | REUSE | REUSE |
| worker interior | REUSE | REUSE |
| worker result-mesh basis | REUSE (collinear) | NEW (vertical face) — not attempted |
| topology/gtop2 | REUSE | **refuses** |
| persistence/ggrev1/citations | REUSE | would be NEW — moot |
