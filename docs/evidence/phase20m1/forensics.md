# Phase 20M.1 — Production Authority Forensics (read-only inventory)

Scope: SPEC/EVIDENCE ONLY. Zero `src/` changes. This file inventories the
authorities a transition policy must reuse, gate on, or extend. Line numbers
were spot-checked on `research/phase20m1-transition-policy-resolution`;
`~` marks drift from the 20M decision anchors, `*` marks a stale anchor.

Source decision context: `docs/evidence/phase20m/decision.md` §§2/8/10
(production forensics, worker/product/provenance, policy verdict).

## 1. Exact-offset route (20L.2) — the bounded shape to mirror, NEVER widen

| Authority | Location | Detail |
|---|---|---|
| Route preflight | `src/engine/cad/grading/gradingExactOffsetPolicy.ts:98` (`preflightExactOffsetRoute`; doc `:94`) | R0 whole-route candidacy |
| Radial-sign rule | `gradingExactOffsetPolicy.ts:77` (`exactRadialSign`) | arc-side sign authority |
| Scope gates | `gradingExactOffsetPolicy.ts:111` (`FALLBACK_NOT_CURVED`), `:114` (`FALLBACK_CLOSED_WITH_ARC`) | line-only and closed-with-arc are excluded |
| Same-`d` gate | `gradingExactOffsetPolicy.ts:148` (`FALLBACK_D_MISMATCH`; comment `:144`) | cross-member EXACT distance |
| Group builder | `src/engine/cad/grading/gradingGroupExactOffset.ts:146` (`tryExactOffsetGroup`) | EXACT or bounded FALLBACK, never partial |
| Joint continuity | `gradingGroupExactOffset.ts:157` | one shared XYZ join (`===`) |
| Strip failures | `gradingGroupExactOffset.ts:334` (`no-triangles`), `:345` (mesh), `:350` (topo) | all `FALLBACK_STRIP_FAIL` |
| Certificate missing | `gradingGroupExactOffset.ts:363` (`GRADING_TOPOLOGY_CERTIFICATE_MISSING`) | fail-closed |

**Stale header note.** `gradingGroupExactOffset.ts:1-20` header text says the
builder is "NOT wired into `computeGradingGroupFromSnapshots` — standalone"
— that is stale; the builder is LIVE, dispatched at
`src/engine/cad/grading/gradingGroupCompute.ts:292` inside the
`!closed && members.length > 1 && members.some(isArc)` block. Cite the
compute site, not the header, as the wiring authority.

## 2. Group compute — termination mode, analytic rejects, dispatch, wiring

| Authority | Location | Detail |
|---|---|---|
| Termination mode | `src/engine/cad/grading/gradingGroupCompute.ts:277` (`groupTerminationMode`); def `src/engine/cad/grading/gradingGroupTermination.ts:122` | surface-only / analytic-only / hybrid |
| Exact-offset dispatch | `gradingGroupCompute.ts:292` (call), guard `:291` | exact returns; fallback falls through |
| Chord-fallback marker | `gradingGroupCompute.ts:518` (`CURVE_CORNER_APPROXIMATED`) | production, unchanged |
| Analytic rejects | `gradingGroupCompute.ts:540` (`_LINE`), `:601` (criterion detail), `:631` (`_DEGENERATE`), `:658` (`_TRIM`), `:690` (`GRADING_BAD_CRITERION`) | all `CORNER_NO_SOLUTION` |
| Topology gate | `gradingGroupCompute.ts:816` (`GROUP_NON_MANIFOLD`) | |
| Certificate wiring | `gradingGroupCompute.ts:862` (scope `group`), `:870` (`GRADING_TOPOLOGY_CERTIFICATE_MISSING`) | |

## 3. Analytic criterion / corners

| Authority | Location | Detail |
|---|---|---|
| Criterion resolver | `src/engine/cad/grading/gradingAnalyticCriterion.ts:154` (`resolveAnalyticCriterionAt`) | distance / elevation / relative-elevation |
| Relative-elevation params | `gradingAnalyticCriterion.ts:45` (`resolveRelativeElevationParams`, ~`:57`) | grade ratio + Δz shaping |
| Constant offset | `gradingAnalyticCriterion.ts:62` (`constantAnalyticOffset`, ~`:72`) | shared UI + engine interpretation |
| Terminal line | `src/engine/cad/grading/gradingGroupAnalyticCorners.ts:76` (`analyticTerminalLine`) | |
| Coincidence check | `gradingGroupAnalyticCorners.ts:139` (`linesCoincide`, zeroDelta + Z) | |
| Corner solve | `gradingGroupAnalyticCorners.ts:154` (`solveAnalyticCorner`) | |
| Criterion family type | `src/engine/cad/grading/gradingTypes.ts:26` (`GradingCriterion`) | `elevation` variant `:30` |
| Chord resolver use | `src/engine/cad/grading/solveAnalyticGradingChord.ts:112` (resolve call), `:146` (`atSource`) | |
| Surface-seam block | `src/engine/cad/grading/gradingChordSeam.ts:478` (`GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`) | |

## 4. Hybrid-corner transition blocks (the current hard stops)

All `CORNER_NO_SOLUTION` at
`src/engine/cad/grading/gradingGroupHybridCorners.ts`:
`:147` (`_ARC_PAIR_UNSUPPORTED`), `:151`, `:195`, `:209`, `:242`
(`_TRANSITION_REQUIRED`), `:354` (`_ROOT_POLICY`), `:356`
(`_TRANSITION_REQUIRED`).

## 5. Ambiguity / disagreement gates

| Authority | Location | Detail |
|---|---|---|
| Ambiguity | `src/engine/cad/grading/gradingGroupSectors.ts:519` (multi-forward → `CORNER_AMBIGUOUS`), `:524` (path-key overflow → `CORNER_AMBIGUOUS`) | window `:518-524` |
| Agreement ops | `gradingGroupSectors.ts:211` (`AGREEMENT_OPS=32`) | |
| Agreement floor | `gradingGroupSectors.ts:221` (`AGREEMENT_FLOOR=1e-9`) | |
| Anchored elevation tol | `gradingGroupSectors.ts:253` (`anchoredElevationAgreementTol`) | |
| Coordinate tol | `gradingGroupSectors.ts:270` (`coordinateAgreementTol`) | |
| Seam tol | `gradingGroupSectors.ts:287` (`seamParameterAgreementTol`) | |
| Elevation tol | `gradingGroupSectors.ts:304` (`elevationAgreementTol`) | |
| Zero floor | `src/engine/cad/surfaces/volume/zero.ts:17` (`zeroDelta`) | classification floor, never the gate |

## 6. Worker agreement + straight-chord settlement

| Authority | Location | Detail |
|---|---|---|
| Daylight vs target | `src/workers/surfaceGradingCompute.ts:232` (`validateDaylightAgainstTarget`) | |
| Agreement codes | `surfaceGradingCompute.ts:236`/`:242` (`_MALFORMED_DAYLIGHT`), `:245` (`_DAYLIGHT_OFF_TARGET`), `:246` (`_DAYLIGHT_Z` non-finite), `:252` (`_DAYLIGHT_Z` mismatch) | |
| Source boundary | `surfaceGradingCompute.ts:265` (`validateGradingSourceBoundary`), `:270`/`:273` (`_SOURCE_BOUNDARY`) | |
| GO gate | `surfaceGradingCompute.ts:285` (`validateGradingResultAgainstTarget`) | |
| Straight-chord settlement | `src/engine/cad/grading/solveStraightChord.ts:360` (`GRADING_DAYLIGHT_OFF_TARGET`), `:369` (`anchoredElevationAgreementTol` call), `:378` (`GRADING_DAYLIGHT_DISAGREE`) | reuse of shared tol at `:330` (`liftDaylightToWorld`) |

## 7. Worker request/snapshot plumbing

| Authority | Location | Detail |
|---|---|---|
| Request alias | `src/workers/surfaceWorkerHandler.ts:501` (`SurfaceGradingRequest`) | |
| Result compute | `surfaceWorkerHandler.ts:510` (`computeGradingResultFromRequest`) | |
| Group request | `surfaceWorkerHandler.ts:518` (`GradingGroupComputeRequest`), `:520` (`ggrev1:` revision), `:530` (`curveChordTolerance`) | |
| Solve input | `surfaceWorkerHandler.ts:543` (`toGroupSolveInput`), `:557` (`computeGroupGradingResultFromRequest`) | |
| Revision staleness | `src/workers/surfaceGradingService.ts:324`, `:366` (`grev1:`), `:379` (`grev1:`/`ggrev1:`) | |

## 8. Topology expectation + gtop2 certificate

| Authority | Location | Detail |
|---|---|---|
| Policy version | `src/engine/cad/grading/gradingTopologyExpectation.ts:22` (`'20k3.1'`) | |
| Run counter | `gradingTopologyExpectation.ts:31` (`countPositiveWidthStationRuns`) | |
| Derive expectation | `gradingTopologyExpectation.ts:78` (`deriveGradingTopologyExpectation`) | returns carry policyVersion at `:85`/`:100`/`:114`/`:128` |
| Note | `gradingTopologyExpectation.ts:21` is blank (import) | anchor drift from the 20M `:21` citation | |
| Certificate versions | `src/engine/cad/grading/gradingTopologyCertificate.ts:21` (`gtop1`), `:24` (`gtop2`) | |
| Positive-width regions | `gradingTopologyCertificate.ts:94` (`countPositiveWidthRegions`) | |
| Builders | `gradingTopologyCertificate.ts:178` (cert), `:525` (exact cert) | |
| Exact gate | `gradingTopologyCertificate.ts:529` / `:601` (`GTOP2_POLICY` guard) | |
| Missing | `gradingTopologyCertificate.ts:258`, `:597` (`GRADING_TOPOLOGY_CERTIFICATE_MISSING`) | |
| Production/product errors | `gradingTopologyCertificate.ts:343`, `:353`; constants `:315` | |

## 9. Products / provenance

| Authority | Location | Detail |
|---|---|---|
| Product codes | `src/engine/cad/grading/gradingProductCapabilities.ts:32-42` | EXTRACT/BAKE/DESIGN_PATCH reasons |
| Design Patch closed-annulus rule | `gradingProductCapabilities.ts:169` (message), `:191` (`unavailable`) | open shell → no single interior |
| Capability derive | `gradingProductCapabilities.ts:220` (`deriveGradingProductCapabilities`) | |
| Capacity helpers | `gradingProductCapabilities.ts:126`, `:139`, `:152` | |

## 10. Persistence + schema

| Authority | Location | Detail |
|---|---|---|
| Group definition | `src/engine/cad/grading/gradingGroupTypes.ts:47` (`CadGradingGroup`), overrides `:41`/`:66`, result `:145` | |
| Group sanitizers | `src/engine/cad/grading/gradingGroupPersistence.ts:15`/`:43`/`:51`/`:63`/`:78` | definitions persist; derived never does; **still schema v2, no bump** (`:9`) |
| Grading sanitizer | `src/engine/cad/grading/gradingPersistence.ts:55` (`sanitizeCadGradings`) | |
| Project schema | `src/hooks/projectFilePayloadBuilders.ts:56`/`:93` (`schemaVersion: 5`) | |
| CAD source schema | `src/cad-app/cadSourceBridge.ts:20` (`CAD_SOURCE_SCHEMA_VERSION = 1`) | |

## 11. Revisions

| Authority | Location | Detail |
|---|---|---|
| Group revision | `src/engine/cad/grading/gradingGroupRevision.ts:105` (canonical), `:133` (doc), `:153` (`ggrev1:<fnv1a-hex>`) | |
| Grading revision | `src/engine/cad/grading/gradingRevision.ts:88` (doc), `:100` (`grev1:<fnv1a-hex>`) | |

## 12. UI custody (current)

| Authority | Location | Detail |
|---|---|---|
| Criteria panel | `src/cad-app/shell/CadGradingGroupCriteriaPanel.tsx:91` (component) | |
| Course criterion utils | `src/cad-app/shell/cadGradingGroupCourseCriteria.ts:43` (`effectiveCourseCriterion`), `:53` (source text), `:92` (member length text), `:134` (`buildCourseMemberRows`) | |
| Group manager | `src/cad-app/shell/CadGradingGroupManager.tsx:42` (import), `:628` (panel mount) | |
| Criterion fields | `src/cad-app/shell/CadGradingCriterionFields.tsx:109` (component) | |
| Workspace tab state | `src/components/SurveyCadWorkspace.tsx:476` (`groupManagerTab`) | |

## 13. Dead gate (do NOT cite as live)

`src/engine/cad/grading/gradingGroupTermination.ts:36`
(`validateGroupTerminationDomainCriteria`) unconditionally returns `null`
since 20J Wave C1. Mixed-domain failures move to compute
(`gradingGroupCompute.ts:277` mode + analytic reject sites §2). Function
signature params at `:48`, notes `:108`/`:121`; the live mode helper is
`:122` (`groupTerminationMode`).

## 14. Consequences for Phase 20M.1 spec

- The one admissible production shape is the bounded 20L.2 route (§1); a
  transition route MUST NOT widen it or reuse its admissibility for the
  complementary input set.
- Worker settlement (§6) currently rejects any interior against either
  member law. A transition requires a NEW agreement basis — spec in
  `worker-topology-product.md`.
- Certification (§8) validates a derivable pre-mesh expectation; it cannot
  legislate a transition. Any transition expectation must be declared
  first.
- Persistence is additive-only at schema v2 (§10). A production transition
  object is a schema/policy decision, not a present capability.
