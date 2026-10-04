# Phase 20N.1 Production Delta — Bounded File-by-File (prose only, no src edits)

Scope: Candidate A ONLY (multiple strictly-separated collinear same-family
transitions, Phase 20N.1 predicate in `decision.md` §3). Candidate B is
blocked (§10) and has no production delta. Sizes are estimates for planning;
risk assumes per-joint math stays byte-identical to `trp1`.

## Candidate A production delta

### 1. `src/engine/cad/grading/gradingTransitionPolicy.ts` — policy loop
Admit per joint (loop `admitGradingTransition` with `transitionCount: 1`
per joint) + group-level strict-separation check
`Wi/2+Wi+1/2 < gap` + canonical joint-index order check.
`selectGroupTransition`: replace the `length > 1 → CARDINALITY` gate with
per-joint admission aggregation (whole-group fail-closed).
Size ~30 lines changed. Risk LOW — predicate stays exact-only, no epsilon.

### 2. `src/engine/cad/grading/gradingTransitionAuthoring.ts` — per-joint authoring
`transitionJointEligibility`: per-`jointId` (replace-by-`jointId`, duplicates
reject); `setGroupTransition`: append/replace one joint instead of wholesale
`transitions: [next]`; `clearGroupTransition`: per-`jointId` clear with
whole-key drop only when empty.
Size ~40 lines. Risk LOW — fail-closed defaults preserved.

### 3. `src/engine/cad/grading/gradingTopologyExpectation.ts` — merged-strip expectation
`deriveTransitionExpectation`: accept a joint list, verify disjointness via
the strict predicate, declare the single merged strip `{group, closed:false,
positiveWidthRegions:1}`. The merged-strip argument (surviving natives + C0
shared boundaries ⇒ one maximal non-tied run, i.e. the production 1/1/1 pin
covers N joints) is stated as a code comment citing this phase.
Size ~20 lines + note. Risk LOW — no new region-count claim; gtop2 validates as today.

### 4. `src/engine/cad/grading/gradingGroupCompute.ts` — engine tiling loop
`GroupSolveInput.transition?` → per-joint plan array; `planTransitionJoint`
looped per joint in joint-index order; native runs between intervals keep
their existing sub-solve (no re-tiling of natives); merge order of adjacent
native runs is the open implementation risk (20M.1 §5 gap carried).
`transitionCount: 1` hard-code → N; transitioned joints recorded `TANGENT`
per joint (collinearity makes the single-tangent frame exact per joint).
Size ~80 lines. Risk MEDIUM — tiling/merge order is the largest unknown.

### 5. `src/workers/surfaceGradingCompute.ts` — worker plan array
`GroupTransitionPlan` singular → array; `checkGroupTransitionAgreement`
looped per joint (re-admit + pinned-evidence compare unchanged per joint);
`validateTransitionInteriorVertices` looped; `validateTransitionResultMesh`
checkpoints become per-joint triples (normal from `pCutR−pCutL` stays valid
per joint under collinearity).
Size ~70 lines. Risk LOW-MEDIUM — math unchanged, wiring arrayified.

### 6. `src/workers/surfaceGradingService.ts` + `src/workers/surfaceWorkerHandler.ts` — service array
`GroupTransitionRequestPlan` singular → array; `planGroupTransitionRequest`
loops admission per joint with per-joint `jointStation`; handler request
fields and `toGroupSolveInput` forward the array.
Size ~50 lines. Risk LOW — delegates to the looped authorities above.

### 7. `src/engine/cad/grading/gradingTransitionProvenance.ts` + commands — plural provenance
Singular envelope → per-joint legs array; `transitionResultBakeCitation`
length-1 → length-N with the leg↔intent match refusal applied per joint.
`GROUPBAKE`/`GROUPEXTRACTDAYLIGHT` cert checks looped per joint.
(Unwired `applyTransitionProductGate` stays unwired — not this phase.)
Size ~40 lines. Risk LOW.

### 8. `src/cad-app/shell/CadGradingGroupTransitionPanel.tsx` — UI loop
`current = existing[0]` first-only read → per-joint list render; joint select
already enumerates all joints (reuse); add-form per selected joint.
Size ~40 lines. Risk LOW — display-only.

### 9. `src/engine/cad/grading/gradingGroupRevision.ts` — canonical joint-index order
`transitionText` already maps the array; change is authoring-side
canonicalization (joint-index order, duplicates/out-of-order fail closed) so
the positional hash stays deterministic. `exactTransitionWidth`
full-precision untouched.
Size ~10 lines + tests. Risk LOW — order defined once, hashed as today.

### Untouched (REUSE, no delta)
Persistence/sanitation, resolve inputs, gtop2 certificate machinery, hybrid/
seam `TRANSITION_REQUIRED` stops, product-capability derivation, Extract/Bake
command shapes beyond the per-joint loop.

Total estimate: ~360 lines touched across 9 sites, no new files required.
Biggest risk: engine tiling/merge order (§4) — EXTEND, not NEW authority.
Topology (§3) is now REUSE of the production 1-region pin (corrected from the
earlier N-region statement: the corridor is one merged strip).

## 10. Candidate B blocked (no delta authorized)

B needs a NEW plan/frame bridge law: two tangents exist, frame/blend/normal
semantics must be legislated, persisted, versioned, and wired through worker
agreement and topology handling. No file-level delta is meaningful until the
policy decision names the bridge law (`decision.md` §4). Any B-shaped diff
that merely deletes the `cross === 0` gate without legislating the bridge is
a hidden default, not an implementation.
