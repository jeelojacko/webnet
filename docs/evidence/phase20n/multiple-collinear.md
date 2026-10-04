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
- Positive-width regions via production `countPositiveWidthRegions`: **1**
  on every valid row (measured, not declared).
- Pre-mesh expectation declared from the MEASURED count via the
  count-agnostic `deriveGradingTopologyExpectation` (group/open/1).
  `deriveTransitionExpectation` is NOT used for N>1: it REJECTS
  `transitionCount!==1` by design (pinned in tests) — the study declares the
  same 1-region shape by hand and documents why.
- Production `buildGradingTopologyCertificateExact` on the ACTUAL study mesh:
  cert issued on all 31 valid rows; components 1, boundaryCycles 1
  (== declared); exact revalidation
  `gradingTopologyCertificateExactError(...) === null` with both boundaries
  supplied, all rows.
- Transforms rebuild full geometry every time (mirror = y-flip + right
  side; reversal = reversed member order + (−1,0) dirs, stations from the far
  end, consistent `joint:<n>` ids, per-joint endpoint scalars following the
  reversed member order so each boundary meets its true layout neighbor; translate E/N 1e6 + 1e8): same admission,
  same local-station ownership, same 1/1/1 counts, gtop2 revalidates
  independently, residuals inside EXISTING agreement authorities (no new
  tolerance, no byte-identical digest claim).
- Negatives stop before any cert: touching (`==`) and overlap (`<`) at the
  group-layout stage (`TOUCHING_NOT_AUTHORIZED` / `OVERLAP_REJECTED`);
  W=70 infeasible at per-joint admission (`WIDTH_INFEASIBLE`); W=0 at
  admission (`WIDTH_INVALID`); NaN/Inf/negative widths fail closed at the
  helper. No mesh, no cert, no validators on any negative row.

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
- Docs precision: per-transition worker math measured/reused as above;
  plural REQUEST wiring (arrayified plan/handler/service) is still future
  work — no "worker agreement proven" claim beyond the validators that ran.

## A5 — Revision / persistence / provenance (proven vs proposed)

- PROVEN (measured per valid row): `buildGroupRevision` over real courses +
  canonical intents hashes `ggrev1:…`; joint-order swap moves the hash
  (`revisionOrderSensitive: true`); rebuild stable (`revisionStable: true`).
  Sanitizer order retention, revision order-sensitivity, and singular
  assumptions are production behavior reused as-is.
- PROVEN (inspected): `transitionResultBakeCitation` returns an ARRAY but
  length-1 today (`bakeCitationLength: 1` pinned per row) — plural citations
  are NOT proven.
- PROPOSED (docs only, Phase 20N.1): canonical joint-index order at
  authoring, duplicate/out-of-order reject (study helper
  `assertCanonicalJointOrder` demonstrates the rule: strictly-increasing
  required, never silently sorted), whole-group fail-closed, plural
  provenance envelope. No schema change claimed.

## Verdict recommendation for A

**PARTIAL_GO_MULTIPLE_COLLINEAR_TRANSITIONS (evidence now real).** All
keep-GO conditions met: real 2T+3T shared-member geometry; actual strip
meshes (24/22 and 34/32); gtop2 1/1 + null revalidation in all 3 families;
per-transition production validators green; strict separation from real
middle lengths (gaps 17 / 17+21, tiny 1e-4 positive still one region);
full-geometry mirror/reversal/1e6/1e8; no new law/default/tolerance.
Remaining implementation risks (unchanged): multi-interval re-tiling order
inside `planTransitionJoint` and the merged-strip expectation wiring feeding
gtop2 — both EXTEND, neither NEW authority. Touching stays unauthorized
(shared boundary station needs a single-owner tie-break that does not exist).
