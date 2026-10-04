# Phase 20N Candidate A — Multiple Strictly-Separated Collinear Same-Family Transitions

- Scope: Candidate A only (cardinality > 1; collinearity gate untouched).
- Method: study-only. Zero `src/` changes. Production math reused by import
  (admission, law, native resolution, frame, strip mesh, region count,
  gtop2 certify + revalidate, worker validators, revision, provenance);
  no formula copies, no new epsilon.
- Study code: `scripts/phase20nMultiTransitionMesh.ts` (`buildMultiGroup`,
  `tileMultiGroup`, `meshAndCertifyMultiGroup`, `agreeMultiGroup`,
  `revisionFactsMultiGroup`, `candidateAMultiBuildCorpus`). Corpus:
  `corpus.json` (35 A-mesh rows + 81 B rows = 116, regen-pinned by
  `corpus.sha256` via `scripts/phase20nCorpusRegen.ts`, double-regen stable).
- The earlier per-joint-only pass (`candidateA*` in
  `phase20nTransitionExpansionStudy.ts`, constant `candidateAExpectationRegions`)
  is superseded by the mesh evidence below and kept only for compat pins.

## A1 — Fixtures: real shared-member full-group geometry

- 2T group: 3 consecutive collinear members M0/M1/M2, lengths [30,24,30];
  joints `joint:0` (M0|M1, station 30), `joint:1` (M1|M2, station 54).
  M1 (length 24) is ACTUALLY shared — both admissions reference it.
- 3T group: 4 members [30,24,26,30]; joints 0/1/2 at stations 30/54/80;
  M1/M2 shared.
- Member identity via production `courseCriterionKey` (`S0>S1`, …) — never
  the repeated fake `['L','R']` of the first pass.
- Families × alternating per-member scalars (every transition changes value):
  Distance 5/7/5/7 (mid 6), RelEl 1.5/2/1.5/2 (mid 1.75), flat Elevation
  0.5/1/0.5/1 (mid 0.75); jointZ 10 (Elevation Z=0). Unequal widths per group:
  2T [8,6], 3T [8,6,4].
- Strict separation DERIVED from real middle lengths: 2T `4+3=7 < 24`
  (measured native gap 17); 3T `7 < 24`, `5 < 26` (gaps 17, 21).
- Per-joint admission calls use the real member pair + real memberIds with
  `transitionCount: 1` (the production cardinality gate is untouched).

## A2 — Full source/daylight tiling (study adapter, no planTransitionJoint copy)

- Exact collinear member geometry on one station axis; joint stations from
  cumulative member lengths; transition intervals `[js−W/2, js+W/2]`.
- Native spans: authoritative `resolveAnalyticCriterionAt` per owning member
  (plan offset = resolved `horizontalDistance`, Z = `limitElevation`).
  Transition spans: ONLY `TRANSITION_LINEAR_V1` via
  `evaluateTransitionLinearV1` with per-joint live `(vL,vR)`; plan offset
  from the production side normal (`gradingSideNormal`), Z per family.
- Endpoints exactly shared where C0 is required; per-station owner recorded:
  strictly-inside → joint `i`, exactly-on-bound → boundary, else native
  (member index). 2T tiles 12 stations, 3T 17 — all owners unique, no
  duplicate/conflicting ownership, no zero-width cells, no self-crossing.
- Measured C0 residuals at every interval boundary (transition endpoint vs
  adjacent native): plan 0, Z 0 on all 31 valid rows (bit-exact: the law
  meets `vR`/`vL` exactly and natives resolve the same scalars).

## A3 — Actual mesh + gtop2 (mandatory, measured — no constants)

- Triangulated strip via production `buildGradingStripMesh` from the full
  tiled polylines. Measured: 2T → 24 verts / 22 tris, 3T → 34 / 32,
  `skippedZeroWidth: 0` (all rows, all transforms).
- Pre-mesh expectation authority
  (`deriveCandidateAPreMeshExpectation`, study-side): for the authorized
  ordinary open strict-separated all-positive-width line strip the study
  DECLARES `expectedPositiveWidthRegions: 1` (components 1, cycles 1) from
  the candidate predicate + fixture structure BEFORE any mesh — open by
  construction, finite positive member lengths, every per-joint transition
  admitted, strict separation on every shared middle member, positive finite
  native/transition daylight widths under the analytic family, no
  touching/overlap. It NEVER inspects source/daylight arrays,
  `countPositiveWidthRegions`, triangle output, or topology results. Any
  prerequisite failure yields no expectation and no certificate.
  **1/1/1 is declared by the bounded candidate predicate before mesh, then
  independently measured/certified; it is no longer derived from observed
  count.** `deriveTransitionExpectation` is NOT used for N>1: it REJECTS
  `transitionCount!==1` by design (pinned in tests).
- Positive-width regions via production `countPositiveWidthRegions` AFTER
  tiling: **1** on every valid row (measured, not declared) and asserted
  EQUAL to the pre-mesh expectation inside `meshAndCertifyMultiGroup`
  BEFORE certifying (mismatch throws — the expectation never adapts).
- Production `buildGradingTopologyCertificateExact` on the ACTUAL study mesh
  AGAINST THE INDEPENDENT EXPECTATION: cert issued on all 31 valid rows;
  components 1 / boundaryCycles 1 == expected; exact revalidation
  `gradingTopologyCertificateExactError(...) === null` with both boundaries
  supplied, all rows. Corpus records `expectedPositiveWidthRegions` (pre-mesh
  policy value) AND `measuredPositiveWidthRegions` (post-tiling production
  count) plus expected vs cert components/cycles, and requires equality.
- Wrong-budget negative proof (pinned in tests): a deliberately wrong
  expected region count 2 does NOT certify a known one-strip mesh
  (`buildGradingTopologyCertificateExact` returns null), and a tied split
  forcing measured 2 against expected 1 is rejected by the pre-mesh-vs-
  measured gate before cert. The expectation detects wrong topology rather
  than adapting to it.
- Transforms rebuild full geometry every time. Mirror (y-flip + right side)
  and translate E/N 1e6 + 1e8 are geometric probes: same admission, same
  local-station ownership, same 1/1/1 counts, gtop2 revalidates
  independently, residuals inside EXISTING agreement authorities (no new
  tolerance, no byte-identical digest claim). Reversal is the TRUE
  production-like traversal reversal (PATH B1, §A3R) — not a geometric
  probe.
- Negatives stop before any cert: touching (`==`) and overlap (`<`) at the
  group-layout stage (`TOUCHING_NOT_AUTHORIZED` / `OVERLAP_REJECTED`);
  W=70 infeasible at per-joint admission (`WIDTH_INFEASIBLE`); W=0 at
  admission (`WIDTH_INVALID`); NaN/Inf/negative widths fail closed at the
  helper. No mesh, no cert, no validators on any negative row.

## A3R — True traversal reversal (PATH B1, production-like)

- For a base source path S0->S1->S2->S3 the reversed source traversal is
  S3->S2->S1->S0: the member array is REBUILT in reversed traversal order
  with production `courseCriterionKey` reversed endpoint pairs
  (`multiMemberIdReversed`), criteria following their physical members,
  directions restarted at +x, stations recomputed from 0, joints REINDEXED
  `joint:0`, `joint:1`, … in reversed traversal order, transition widths
  mapped to their physical joints in reverse order (2T [8,6] → [6,8];
  3T [8,6,4] → [4,6,8]), and persisted-like intents canonical increasing by
  the NEW joint indices. Build/tile/mesh/certify/validate then run exactly
  as identity from the reversed fixture.
- Comparison normalizes reversed world geometry back into the base
  orientation (`normalizeReversedWorldToBase`: x → total − x) and compares
  source/daylight as continuous polylines under the EXISTING production
  coordinate/elevation agreement authorities — same topology counts and
  validator results required; same ggrev1 NOT required (traversal/member
  IDs legitimately change, so reversed rows rehash by design).
- Strict separation is checked against the reversed shared-member lengths
  with the reversed width pairing (3T: 2+3<26 and 3+4<24).
- The old axis-flip reversal (stations from the far end, original member
  order kept) is GONE — no ambiguous reversal claim remains. Docs/tests/
  corpus distinguish: geometric mirror, coordinate translations, and true
  traversal reversal.

## A4 — Worker agreement (validators actually ran)

- Per transition in every valid fixture: production
  `validateTransitionResultMesh` over that transition's ACTUAL result-owned
  checkpoints (qCutL/q0/qCutR + pCutL/V/pCutR pulled from the tiled
  polylines, full result-owned boundary arrays attached) → null (green) on
  all 31×N transitions, all 3 families, all transforms.
- Production `checkGroupTransitionAgreement` per joint against the live
  `ggrev1:` (re-admit + pinned-evidence compare, actually exercised) → ok
  on every transition.
- Station ownership unique for non-boundary stations (pinned per row);
  exact boundaries recorded boundary-owned with transition endpoint XYZ ==
  adjacent native result (C0 residuals 0, §A2).
- Evidence precision: production `validateTransitionResultMesh` is
  exercised per transition against actual full-mesh-owned checkpoints, and
  production `checkGroupTransitionAgreement` is exercised per transition —
  both green as measured above. Plural worker request/handler wiring
  (arrayified plan/handler/service) is NOT implemented/proven in production
  and remains Phase 20N.1 work; no "worker pipeline proven" claim is made.

## A5 — Revision / persistence / provenance (proven vs proposed)

- MEASURED CURRENT FACTS (per valid row): `buildGroupRevision` over real
  courses (actual traversal endpoint pairs, reversed when reversed;
  alternating per-course criteria as sparse `courseCriteria` overrides) +
  canonical intents hashes `ggrev1:…`; joint-order swap moves the
  hash (`revisionOrderSensitive: true` — current ggrev1 order sensitivity is
  measured fact); rebuild stable (`revisionStable: true`). Sanitizer order
  retention and singular assumptions are production behavior reused as-is.
- MEASURED CURRENT FACT: `transitionResultBakeCitation` returns an ARRAY
  but length-1 today (`bakeCitationLength: 1` pinned per row) — current
  citation length-1 is measured current fact, plural citations NOT proven.
- PROPOSED FUTURE POLICY (docs only, Phase 20N.1): canonical joint-index
  ordering at authoring is PROPOSED future policy; plural Extract/Bake
  provenance is PROPOSED future implementation. Study helper
  `assertCanonicalJointOrder` demonstrates the rule: strictly-increasing
  required, never silently sorted, whole-group fail-closed, plural
  provenance envelope. No schema change claimed.

## Verdict recommendation for A

**PARTIAL_GO_MULTIPLE_COLLINEAR_TRANSITIONS (evidence now real).** All
keep-GO conditions met: real 2T+3T shared-member geometry; independent
pre-mesh 1-region expectation (declared before mesh, wrong-budget/tied-split
rejection pinned); actual strip meshes (24/22 and 34/32); measured 1 ==
expected 1; gtop2 1/1 against the independent expectation + null revalidation
in all 3 families; per-transition production validators green; strict
separation from real middle lengths (gaps 17 / 17+21, tiny 1e-4 positive
still one region); full-geometry mirror/1e6/1e8 probes + TRUE traversal
reversal (B1, normalized geometry matches under production tolerances);
no new law/default/tolerance.
Remaining implementation risks (unchanged): multi-interval re-tiling order
inside `planTransitionJoint` and the merged-strip expectation wiring feeding
gtop2 — both EXTEND, neither NEW authority. Touching stays unauthorized
(shared boundary station needs a single-owner tie-break that does not exist).
