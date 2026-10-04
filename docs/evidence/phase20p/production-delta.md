# Phase 20P — production delta for sparse collinear transition sets

- Branch: `research/phase20p-sparse-collinear-transition-set-decision`, baseline `797026215364da1ea90ffa2063b7cc3d0a4be38d`.
- **STATUS: PROPOSED-NOT-IMPLEMENTED. STUDY ONLY. Zero `src/` changes.**
  Nothing below is authorized, scheduled, or applied. It is the bounded,
  file-by-file design a future production phase would need to lift the
  consecutive-joint restriction while preserving the 20N.1 law.
- Evidence that motivates the delta: `topology-worker-provenance.md` §1–§5
  (measured 1/1/1 declaration + certificate for `[0,2]`, `[0,2,4]`,
  `[0,1,3]`, `[0,2,3,5]`; production still rejects all sparse sets).
- Recovered 20P evidence: the sparse predicate is **non-binding** for gaps
  >= 2 members under per-joint feasibility (`topology-worker-provenance.md`
  §7.1). The delta therefore changes correctness of the *authority*, not its
  rejection power for gaps separated by whole members.

## 1. Admission / order authority — `gradingTransitionPolicy.ts`

- `selectGroupTransitions`: replace the `index !== prev + 1` consecutive gate
  with strict increase `index > prev` (no gaps allowed to break order, gaps in
  index space allowed). Duplicates, out-of-order, malformed ids still reject
  `TRANSITION_REJECTED`/`TRANSITION_MALFORMED` fail-closed; never sort.
- `deriveGroupTransitionExpectation`: delegate order/separation to the
  generalized plural authority below; keep the bounded policy vocabulary.
- Per-joint `admitGradingTransition` (`trp1`): **REUSE unchanged** (exact-zero
  collinearity, width bounds, family/grade/side/flat/joint-Z). No widening.

## 2. Pre-mesh expectation authority — `gradingTopologyExpectation.ts`

- `deriveTransitionSetExpectation`: replace "canonical increasing AND
  consecutive" with strictly increasing-with-gaps. Replace the adjacent
  `left.memberLengths[1] === right.memberLengths[0]` + shared-length gap rule
  with an ordered **station/gap** input: for consecutive ordered intents the
  gap is `station(next) - station(prev)` (the full member run between joints,
  not the immediate shared member). Keep the EXACT strict `<` rule:
  `Wi/2 + Wj/2 < gap` rejects touch (`==`) and overlap (`>`).
- Shape declaration UNCHANGED: an all-positive strictly-separated open chain
  still declares the merged open strip **1 component / 1 cycle / 1 positive-
  width region** (`deriveGradingTopologyExpectation` with
  `positiveWidthRegions: 1`), never from a measured count.
- Policy caveat (same class as 20O §5): if a skipped native joint can produce a
  zero-width native run (tied/split), the 1/1/1 declaration no longer holds and
  the expectation must bound or exclude that domain — a policy input, not a
  code default.

## 3. Group tiler — `gradingGroupTransitionPlural.ts`

- `planTransitionGroup`: replace `gaps = admitted.slice(0,-1).map(a =>
  members[a.joint + 1].length)` with the generalized station difference
  (`station(next) - station(prev)`). The rest of the two-phase stitch is
  **REUSE**: the claim table is per-joint, untouched members are skipped, and
  singly-claimed ends already take the legacy outer-native branch, so sparse
  sets stitch correctly once order + gap are generalized.
- `transitionEvidenceMatchesIntent` / endpoint-evidence checks: REUSE.

## 4. Worker — `surfaceGradingService.ts` / `surfaceGradingCompute.ts`

- `planGroupTransitionRequest` (`surfaceGradingService.ts`): inherits the
  `selectGroupTransitions` gate; per-joint `planSingleTransitionIntent` is
  **REUSE**.
- `checkGroupTransitionPlansAgreement` (`surfaceGradingCompute.ts`): replace
  the consecutive-joint gate with strict increase; replace the gap computed
  from the immediate shared member (`left.length`) with the station difference
  from the request's own member sources. Keep whole-set fail-closed.
- `checkGroupTransitionAgreement`, `validateTransitionResultMesh`,
  `validateGroupTransitionLegsMesh`: **REUSE unchanged** — already
  positional (`legs[i] ↔ plans[i]`), per-leg checkpointed, and gap-agnostic
  (measured green for sparse sets in `topology-worker-provenance.md` §4).
- `transitionPlansOf` / `resolveGroupTransitionMemberViews`
  (`surfaceWorkerHandler.ts`): **REUSE** — already per-plan and gap-agnostic.

## 5. Authoring / UI

- `gradingTransitionAuthoring.ts`:
  - `canonicalJointOrderError`: consecutive → strictly increasing (gaps
    allowed); still reject duplicates/out-of-order/malformed, never sort a
    malformed persisted array.
  - `geometryError`: the separation gap must come from real station positions,
    not `lengths[i][1]` (immediate member). If the caller can only supply
    per-joint incident lengths (no station positions), drop the separation
    check there and let the compute fail closed rather than invent a gap.
  - `setGroupTransition` replace-by-jointId + canonical re-append
    (`merged.sort` over already-valid intents) is **REUSE**; the operator may
    add a transition at any open joint.
- `CadGradingGroupTransitionPanel.tsx` / `cadGradingGroupShell.ts`: allow
  sparse add/edit (a new transition need not be adjacent to an existing one)
  and preserve canonical order; do not silently reorder malformed state. The
  plan-law selector surface stays blocked on the 20O law decision.

## 6. Explicitly REUSE (no change)

- **Persistence / revision**: `buildGroupRevision` already hashes the
  `transitions` array in order (order-sensitive, no sort) with full-precision
  widths; sparse ids roundtrip byte-exactly. No change.
- **Law**: `TRANSITION_LINEAR_V1` / `evaluateTransitionLinearV1` unchanged.
- **gtop2**: `buildGradingTopologyCertificateExact` +
  exact/production revalidation unchanged (validates the declared 1/1/1).
- **Singular path**: `planTransitionJoint` / `transitionLegOf` / singular
  worker path unchanged.
- **Provenance / Extract / Bake**: `transitionResultBakeCitations`,
  `buildTransitionProvenance`, `transitionLegsMatchIntents`, and
  `applyTransitionProductGate` already cite/refuse per-leg positionally; they
  accept sparse sets as-is.
- **`trp1` admission and the `NON_COLLINEAR` gate**: untouched.

## 7. Proposed validation for the implementing phase

- Reuse `tests/cad_grading_transition_sparse_20p.test.ts` as the behavioral
  contract: `[0,2]`, `[0,2,4]`, `[0,1,3]`, `[0,2,3,5]` declare 1/1/1 pre-mesh,
  measure 1, certify 1/1, and pass the worker legs gate; touch/overlap reject
  before cert; one bad transition/leg fails the whole set.
- Keep the 20N.1 consecutive fixtures green (reduction identity).
- No tolerance, epsilon, `NON_COLLINEAR`, or `trp1` change accompanies the
  delta.
