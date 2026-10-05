# Phase 20Q — topology, worker, and provenance (plus persistence answers)

Study-only. Zero `src/` changes. This records (a) what production topology
and the worker do with sloped/stepped intents today, and (b) the exact
persistence delta a future phase would need. Nothing here is implemented.

## 1. Topology: expectation declared before mesh, gtop2 validates only

Per corpus row the study declares the pre-mesh expectation first
(`deriveTransitionExpectation`, `gradingTopologyExpectation.ts`:331 — 1/1/1
merged open strip from structure), then measures
(`countPositiveWidthRegions`, `gradingTopologyCertificate.ts`:94), then
certifies (`buildGradingTopologyCertificateExact`:525) and revalidates
(`gradingTopologyCertificateExactError`:589).

**M4 (now implemented):** `phase20qMeshFacts` calls
`deriveTransitionExpectation` from W + member lengths only **before** it
measures or builds; the measured count gates the build
(`measured === expected`) and is never fed back into the expectation. On all
**2622/2622** rows `expectedRegions === 1` and `preMeshGate === null`.

| Group | Rows | measured == declared | gtop2 | revalidation |
|---|---|---|---|---|
| sloped S1/S2/S3 | 1998 | 1/1/1 | certify 1998/1998 | `null` |
| step continuous (step = 0) | 48 | 1/1/1 | certify 48/48 | `null` |
| step nonzero J2 | 144 | 1/1/1 | certify 144/144 | `null` |
| step nonzero J1/J3/J4 | 432 | — | **`gtop2-refused`** | — |

Expectation is never derived from measured geometry (no circularity): the
1/1/1 budget is a function of ordered joints + transition count + open scope,
computed before the strip is built. The certificate is law-agnostic — it
certified S2 (which falsifies the source) and J2 (which falsifies the source)
too, proving it cannot be used to *select* a law. It refuses the 432
source-step rows because a vertical source discontinuity is non-manifold in
the strip mesh.

## 2. Worker: source-Z-aware check, independent recomputation, tamper

- **B2 source-Z-aware check**: `phase20qSourceZAwareCheck` validates every
  station's daylight against production `transitionDaylightAt` at the row's
  OWN physical source Z(s) (`===`), and additionally validates the cut/end
  stations against production `resolveAnalyticCriterionAt` **per family**
  (distance horizontal distance, elevation/relative-elevation limit Z). This
  replaces the old production mesh validator's single-jointZ not-applicable
  mark with a real per-family PASS/FAIL. S1 **666/666 PASS**, J1 **156/156
  PASS**; on their rewriting rows S2/J2 fail `study-sourceZ-divergent`
  (bridged source) and S3/J3/J4 fail `study-daylight-divergent` (daylight
  bridge / fixed-Z daylight). Negative control `phase20qJointZControl` PASSes
  flat rows and FAILs sloped rows — the check is genuinely source-Z-aware,
  never vacuous.
- **Current production validator, per family (M1)**: `validateTransitionResultMesh`
  on untampered sloped S1 accepts relative-elevation **216/216** non-flat rows,
  but distance **12/216** (near-flat `1e-9` W2 only) and elevation **0/216** —
  all other rejects at `GRADING_AGREEMENT_TRANSITION_OFF_LAW`, because it
  resolves/derives at the single `input.jointZ` (`surfaceGradingCompute.ts`
  :634/636 + :653–655 + :670). The study-side per-checkpoint-source-Z extension
  (`phase20qPerCheckpointSourceZExtension`) PASSes all **666 S1 + 156 J1** rows
  per family, and the extended study tile reproduces S1 exactly
  (`outerOk 666/666`, `outerDev=0`, `extensionDev=0`, 8 checkpoints). So the
  only missing piece for distance/elevation is that `src/` validator extension.
- **Persisted independent recompute (B3)**: `assemblePhase20qRow` persists
  the sufficient inputs per row (`Phase20qPersistedInputs`);
  `phase20qIndependentRecompute` rebuilds the case SOLELY from those fields
  (never the in-memory fixture), re-resolves `vL`/`vR` via production
  `resolveAnalyticCriterionAt`, re-runs the law oracle, and re-checks worker
  agreement. `matchVsRow === true` on **2622/2622** rows, 0 errors.
- **Tamper**: the 5 agreement probe classes (`tampered-sourceZ`, `-slope`,
  `-scalar`, `-family`, `-side`) are **strict per probe** — each **102 caught /
  2520 inapplicable / 0 missed**, caught only on the 102 flat-control rows the
  agreement gate admits untampered (the other 2520 reject untampered
  `GRADING_AGREEMENT_TRANSITION_GEOMETRY`), none held. The 6th, `width`, goes
  through the REAL production `validateTransitionResultMesh` with an
  **asymmetric** `sL` (left half doubled, joint pinned; its untampered pass set
  is the larger rel-elevation-sloped + flat set): **894 caught / 1728
  inapplicable / 0 missed**; untampered-reject rows are never counted as
  caught.
- **Live agreement**: `checkGroupTransitionAgreement`
  (`surfaceGradingCompute.ts`:357) re-admits through `admitGradingTransition`;
  sloped intents reject at `NON_FLAT` and stepped intents at `JOINT_Z_STEP`,
  surfacing as `GRADING_AGREEMENT_TRANSITION_GEOMETRY` (648 sloped non-flat
  + 576 step rows; the 18 sloped FLAT_FLAT + 48 step-m0 controls admit).
- **Reusable validators**: `validateTransitionInteriorVertices` (:484) is
  scalar-magnitude only → REUSE. `validateTransitionResultMesh` (:614)
  derives one normal from `pCutR-pCutL` (:644); for a collinear-sloped source
  the chord is still +X, so the basis is correct → REUSE for S1 (and it is the
  real-validator basis for the width tamper). It is correct only for a single
  plan direction, so it is not reusable for a step (which is why no step law
  survives).

## 3. Persistence delta (not implemented)

| Concern | S1 sloped | step |
|---|---|---|
| `CadGradingTransition` object (`gradingGroupTypes.ts`:138–149) | **unchanged** (already carries lawKind/lawVersion/width/side/family) | would need a joint-Z pair + new kind |
| new `verticalLawKind` | **not needed** — S1 stays `TRANSITION_LINEAR_V1`/`v1` | would need a new kind (moot) |
| `ggrev1` hash (`gradingGroupRevision.ts`:166–167) | **already covers** width + `law:lawKind/lawVersion`; nothing new to hash | would need the Z-pair in the canonical hash (moot) |
| provenance / citations (`gradingTransitionProvenance.ts`:68/135) | **already cites** lawKind/lawVersion/width; REUSE | would need a new citation basis (moot) |
| clone/sanitize/re-attach (`gradingGroupPersistence.ts`:46/229) | REUSE verbatim | — |

## 4. Persistence questions, answered explicitly

1. **Is the transition object unchanged?** Yes for S1. `CadGradingTransition`
   already holds `lawKind`, `lawVersion`, `width`, `criterionFamily`, `side`;
   a sloped source changes *admission*, not the persisted shape.
2. **Is a new `verticalLawKind` needed?** No for S1. The law is literally
   `TRANSITION_LINEAR_V1` with the `NON_FLAT` admission predicate relaxed to a
   bounded slope rule; the joint stays continuous (`JOINT_Z_STEP` unchanged).
   A step law would need a new kind — moot under
   `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`.
3. **Does `ggrev1` cover it?** Yes. It already hashes width and
   `law:lawKind/lawVersion`; S1 introduces no new persisted parameter, so no
   hash input changes. (A step's joint-Z pair would have to join the hash, but
   there is no step law.)
4. **Are provenance citations sufficient?** Yes for S1:
   `transitionResultBakeCitation` already cites lawKind/lawVersion/width, and
   the source geometry rides the existing member/leg evidence. No new
   citation kind is required.

## 5. Provenance of this study

- Corpus built by the study driver and regenerated by
  `phase20qCorpusRegen.ts` (re-imports fixtures + laws, never reads
  `corpus.json`) — byte-identical, sha `26019cb9…`; the separate persisted-bytes
  read-back (`phase20qCorpusRegen.ts verify-persisted-bytes`; test 20Q.18)
  re-reads the written corpus from disk and confirms 2622/2622 scalar +
  2622/2622 agreement. **Disclosure:** both
  entry points share `assemblePhase20qRow`/`serializePhase20qCorpus`, so
  byte-identity proves determinism of the shared assembler, NOT an independent
  oracle. Independence lives in the persisted-field recompute + real
  validators above.
- No `src/` file read at study time is mutated; all production calls are
  wrapped and recorded, never thrown.
