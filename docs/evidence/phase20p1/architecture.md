# Phase 20P.1 — Architecture: sparse collinear transition sets (production)

- Branch: `feat/phase20p1-sparse-collinear-transitions`, baseline main
  `f786f76ba21818d863dc39a6c35f70697968c70e` (PR #165 merge).
- Scope: implement the Phase 20P `GO_SPARSE_COLLINEAR_TRANSITION_SETS` decision,
  nothing wider. Relaxes the 20N.1 implementation narrowing "consecutive joints
  only for N > 1" to strictly-increasing joint ids with a global station-gap
  separation rule. No new law, tolerance, epsilon, or persistence schema.

## 1. Bounded predicate (the 10 clauses, as shipped)

For an OPEN group with persisted transition intents in array order:

1. Every transition independently passes current full `trp1` with
   `transitionCount: 1`: line source, flat adjacent members, exact joint-Z
   continuity, same side, same target-free analytic family
   (Distance / RelativeElevation / flat Elevation), exact same grade, exact
   collinearity+forward direction at the ACTUAL transition joint, finite
   `W > 0`, `W <= 2*min(adjacent lengths)`, `TRANSITION_LINEAR_V1/v1`, native
   criteria resolve, current evidence/revision valid.
2. jointIds are already canonical and STRICTLY INCREASING. Gaps allowed.
   Duplicate/out-of-order/malformed reject. Never sort invalid persisted input
   into validity.
3. Define source joint station `S(j) = sum(memberLengths[0..j])` in current
   open traversal.
4. Transition interval is `[S-W/2, S+W/2]`.
5. Neighboring transitions in intent order require exact
   `Wi/2 + Wnext/2 < Snext - Si`. Equality/touching rejects. Overlap rejects.
   No epsilon.
6. For consecutive joints this reduces exactly to the Phase 20N.1
   shared-middle-member rule.
7. One bad/stale/malformed/touching/overlapping transition fails the WHOLE
   set. No partial solve.
8. Skipped joints are never auto-transitioned; they retain existing
   native/corner authority and existing failures remain failures.
9. Result transition legs stay in canonical persisted intent order.
10. Phase 20O non-collinear remains
    `POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW`.

Clauses 2, 3, 4, 5 are the only newly implemented gates; clause 1 is the
unchanged `trp1` authority; clauses 6–10 are invariants preserved from 20N.1.

## 2. Central station / gap authority

One pure runtime authority in `gradingTransitionPolicy.ts` — never duplicated
across engine/topology/worker/authoring:

- `computeJointStations(memberLengths)` — one left-to-right cumulative pass,
  `stations[i] = sum(lengths[0..i])`. The single deterministic addition order;
  previously re-derived by hand in `planTransitionGroup`
  (`members.slice(0, a.joint+1).reduce(...)`) and in
  `planSingleTransitionIntent` (manual `for` prefix sum).
- `transitionSetStationGaps(stations, orderedJoints)` — for consecutive SET
  members only: `gaps[k] = stations[j_{k+1}] - stations[j_k]`. Never j vs
  j+1 members, never a repeated prefix sum, never derived from mesh output.

Cost: `O(members + transitions)` total (one stations pass, one gaps pass).
`checkGroupTransitionSeparation` stays the generic exact numeric `<` predicate
consumed by every caller.

## 3. Per-file change list

### A. `src/engine/cad/grading/gradingTransitionPolicy.ts` (policy authority)
- ADD `computeJointStations`, `transitionSetStationGaps`.
- `selectGroupTransitions`: consecutive gate `index !== prev + 1` →
  strictly-increasing gate `index <= prev` rejects. Malformed/duplicate/
  out-of-order still fail closed; never sorted.
- `deriveGroupTransitionExpectation(joints, stationGaps?)`: optional gaps
  forwarded to the one plural authority.
- UNCHANGED: `admitGradingTransition`, `parseCanonicalJointIndex`,
  `checkGroupTransitionSeparation`, singular `selectGroupTransition` (N ≤ 1 cap).

### B. `src/engine/cad/grading/gradingTopologyExpectation.ts` (pre-mesh declaration)
- `deriveTransitionSetExpectation(base, intents, stationGaps?)`: when
  `stationGaps` is supplied, require `stationGaps.length === intents.length-1`,
  strictly-increasing parsed indices, each gap finite `> 0`, and exact
  `Wi/2 + Wj/2 < gap` with `==` → `GRADING_AGREEMENT_TRANSITION_OVERLAP`
  (touching) and `>` → overlap. Legacy mode (no `stationGaps`) keeps the
  consecutive + bit-identical shared-member check.
- `deriveTransitionExpectation(intent, stationGaps?)`: passes gaps through to
  the set form; singular and no-transition forms untouched.

### C. `src/engine/cad/grading/gradingGroupTransitionPlural.ts` (group tiler)
- `planTransitionGroup`: `gaps = computeJointStations(members.lengths)` +
  `transitionSetStationGaps(stations, admitted.joints)` replaces the
  immediate-member `members[a.joint + 1].length` gap; `tile.jointStation` is
  `stations[a.joint]`; the declared expectation receives `gaps`.
- UNCHANGED: the per-joint admission loop, the absolute `byJoint` map, the
  two-phase rebuild (each affected member rebuilt exactly once),
  `stitchGroupMember` / claim table, singly- and doubly-claimed branches,
  immutable per-joint tiles, checkpoint extraction and publish order.

### D. `src/engine/cad/grading/gradingTransitionAuthoring.ts` (authoring)
- `canonicalJointOrderError`: `!== prev + 1` → `<= prev`.
- `TransitionAuthoringGeometry` gains optional `memberStations`.
- NEW `stationGap(stations, left, right)`; `geometryError` uses the true
  station gap when `memberStations` is present (sparse pairs checked across all
  skipped joints), falls back to the immediate shared-member check only for
  consecutive pairs, and skips gapped pairs when stations are absent (compute
  fails closed — no invented gap).
- UNCHANGED: existing array validated before any append; replace-by-joint;
  `setGroupTransition` canonical re-append; full-precision width; no auto-width.

### E. `src/workers/surfaceGradingService.ts` (request planning)
- `planSingleTransitionIntent`: `jointStation =
  computeJointStations(inputs.memberSources.map(s => s.length))[joint]` — the
  same central authority/addition order, replacing the manual prefix loop.
- UNCHANGED: inherits `selectGroupTransitions` strict-increasing selection;
  per-joint request planning; never sorts requests.

### F. `src/workers/surfaceGradingCompute.ts` (worker pre/post solve)
- `checkGroupTransitionPlansAgreement`: consecutive gate `index !== prev + 1` →
  `index <= prev`; gaps computed from the authoritative request stations
  (`plans[i+1].jointStation - plans[i].jointStation`) with a finite `> 0`
  guard, then the same `checkGroupTransitionSeparation`; whole set fail-closed.
- UNCHANGED: `checkGroupTransitionAgreement`, `validateTransitionResultMesh`,
  `validateGroupTransitionLegsMesh`.

### G. `src/workers/surfaceWorkerHandler.ts` (handler)
- UNCHANGED: `transitionPlansOf` and `resolveGroupTransitionMemberViews` were
  already one view-pair per plan and gap-agnostic; ordered plan arrays and
  positional `legs[i] ↔ plans[i]` preserved; stale/session guards unchanged.

### H. `src/cad-app/shell/CadGradingGroupTransitionPanel.tsx` (UI)
- `storedOrderWarning`: consecutive → strictly increasing (only malformed /
  duplicate / out-of-order stored ids warn).
- `separationError(merged, memberSources)`: computes stations/gaps through the
  central authority from real member sources, so sparse pairs are checked
  across skipped joints; drops the local per-joint `jointLengths` map.
- UNCHANGED: sparse add/edit allowed, rows in canonical traversal order, fixed
  `TRANSITION_LINEAR_V1` selector, malformed loaded state not silently
  repaired, no auto-insert at skipped joints.

## 4. REUSED unchanged

- `admitGradingTransition` (`trp1`) and the `NON_COLLINEAR` / width / family /
  grade / side / flat / joint-Z gates.
- `TRANSITION_LINEAR_V1` / `evaluateTransitionLinearV1` (per-joint law).
- Group tiler claim table, `stitchGroupMember`, two-phase rebuild, tiles.
- Handler views (`transitionPlansOf`, `resolveGroupTransitionMemberViews`) and
  the per-leg worker validators.
- Persistence / revision / provenance (`buildGroupRevision` order-sensitive
  `ggrev1`, `transitionResultBakeCitations`, `buildTransitionProvenance`,
  `transitionEvidenceMatchesIntent`).
- gtop2 certificate + exact/production revalidation.

## 5. Consecutive-reduction identity

When `j_{k+1} = j_k + 1`, `S(j+1) - S(j)` is exactly the shared
middle-member length `memberLengths[j+1]`, so `transitionSetStationGaps`
collapses to the 20N.1 shared-member rule bit-for-bit. Consecutive behavior is
additionally preserved by keeping the legacy no-`stationGaps` branch in
`deriveTransitionSetExpectation` and the immediate-member branch in
`geometryError`, so existing 20N.1 fixtures/tests stay green.

## 6. What this is not

- **Phase 20O non-collinear** remains
  `POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW`: `deriveSingularTransitionExpectation`
  and `admitGradingTransition` are untouched, so a bent ACTUAL transition joint
  still fails `NON_COLLINEAR`. No non-collinear plan/frame law is authorized or
  implemented.
- **No new schema / station field / tolerance / epsilon / law version.** Joint
  stations remain derived at runtime from authoritative member lengths.
