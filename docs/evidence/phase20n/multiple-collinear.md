# Phase 20N Candidate A — Multiple Strictly-Separated Collinear Same-Family Transitions

- Scope: Candidate A only (cardinality > 1; collinearity gate untouched).
- Method: study-only. Zero `src/` changes. Production 20M.2 math reused by
  import (`admitGradingTransition`, `evaluateTransitionLinearV1`,
  `selectGroupTransition`); no formula copies, no new epsilon.
- Study code: `scripts/phase20nTransitionExpansionStudy.ts` (CANDIDATE A
  section, `candidateA*` exports). Corpus: `corpus.json` (11 synthetic rows).

## B1 — Interval ownership width law

Per-joint law is unchanged production math: `sL = −W/2, sR = +W/2`,
`W ≤ 2·min(LL,LR)` strict-feasible (`gradingTransitionPolicy.ts:119-161`).
Multi adds one study-side layout rule over joint-local intervals placed on
one source line: `Wi/2 + Wi+1/2 < gap` **strict** (`candidateALayoutOk`).

Measured (`corpus.json`):

- Strict-gap layouts (gap 20, widths 8/6[/4]): `layoutOk: true`.
- Touching (`Wi/2+Wi+1/2 == gap`): `layoutOk: false` — touching is NOT
  auto-authorized; a shared boundary station would need single-owner
  legislation that does not exist today.
- Overlap / malformed (negative gap): `layoutOk: false`.
- Per-joint infeasible (W=44 > 2·20): production `WIDTH_INFEASIBLE` on that
  joint (`admitCodes: WIDTH_INFEASIBLE,ok`), layout also fails.
- Per-joint admission is independent: touching/overlap pairs still admit
  `ok,ok` individually — separation is a *group-layout* predicate, not a
  per-joint property. Whole-group fail-closed default stands.

## B2 — Geometry composition

2- and 3-transition groups × Distance / RelativeElevation / flat Elevation,
all angle 0, via production admission + legislated law:

- Every joint admits individually (`allAdmitted: true`, 6/6 family×count rows).
- Interior midpoint scalar == `(vL+vR)/2` exactly in all families
  (Distance 6.0, RelEl 1.75, Elevation per law) — `evaluateTransitionLinearV1`.
- Endpoint==native law: `evaluateTransitionLinearV1` at `sL`/`sR` returns
  `vL`/`vR` exactly (machine-checked per joint via `candidateAEndpointGap`,
  gap 0 on all 6 family×count rows plus the reversal row) — shared-ref C0
  construction, same as single-joint `planTransitionJoint` tiling; natives outside intervals untouched
  (production `solveGradingChord` sub-solves own that region; the study
  throws outside intervals rather than duplicating the solver).
- Native runs preserved: between intervals the classifier returns `native`
  (B4), so the existing member solve covers them with no re-tiling — and it
  is exactly those surviving native runs that merge the corridor into ONE
  positive-width region (see B3).
- No cross-talk: intervals are disjoint by the strict law, each joint's law
  reads only its own `(vL,vR,sL,sR)`; the reversal row confirms the law is
  symmetric under traversal reversal (`reversalConsistent: true` at the
  midpoint, `reversalEndpointsOk: true` — swapped law meets `vR` at `sL`
  and `vL` at `sR` via `candidateAReversalEndpoints`).

Unproven (needs implementation, not study): multi-interval re-tiling order
inside `planTransitionJoint` and merge of adjacent native runs (20M.1 §5 gap).

## B3 — Topology / mesh

- Pre-mesh expectation for N strictly-separated collinear transitions: ONE
  merged positive-width region, i.e. `{group, closed:false,
  positiveWidthRegions:1}` (`candidateAExpectationRegions` returns 1 for any
  N; production hard-codes 1 at `gradingTopologyExpectation.ts:201-207` and
  rejects `count !== 1` at `:181`). The corridor is one continuous strip:
  natives survive between intervals and C0 shared boundaries merge, so the
  production 1/1/1 pin (components/cycles/regions per
  `gradingGroupCompute.ts` tiling, `gradingTopologyExpectation.ts:120-134`,
  certificate maximal non-tied runs) already covers the multi-interval
  layout. The earlier N-regions statement was wrong and is corrected here.
- gtop2 (`buildGradingTopologyCertificateExact`) is count-parameterized in
  its header and validates-but-never-admits: REUSE unchanged. The §7
  expectation derivation is EXTENDed only to accept a joint list (verify
  disjointness via the strict predicate, declare the merged single region);
  the merged-strip argument (surviving natives + C0 ⇒ one maximal non-tied
  run) is stated as a code comment citing this phase.
- Worker mesh check `validateTransitionResultMesh` (3 checkpoints, normal
  from `pCutR−pCutL`) loops per joint unchanged under collinearity; per-joint
  checkpoint arrays replace the singular triple.

## B4 — Worker ownership function design (no worker changes)

`candidateAClassifyStation(s, intervals)` — deterministic per-station
classifier over the sorted disjoint interval list:

- `s` strictly inside interval `i` → `transition:i`; `s` exactly on a bound
  → `boundary` (endpoint==native, either owner agrees); else → `native`.
- Design: worker loops joints, builds one interval list per group, classifies
  each interior vertex once; agreement math per joint is byte-identical to
  today (`checkGroupTransitionAgreement` re-admit + pinned-evidence compare,
  looped). `transitionCount` becomes informational per-plan, not a gate.
- Touching intervals would make a boundary station double-owned — the reason
  touching stays rejected until a tie-break owner is legislated.

## B5 — Persistence / revision / provenance decision points

- Ordering: `transitionText` (`gradingGroupRevision.ts:158`) is
  order-sensitive positional `join('#')`. Decision: canonical order by joint
  index at authoring; out-of-order intents fail closed (stale) rather than
  re-sorted silently.
- Duplicates (same `jointId` twice): fail closed `TRANSITION_REJECTED` —
  duplicates are never merged; authoring replaces by jointId.
- Stale (memberIds/endpoint evidence vs re-resolved natives, recorded
  revision vs `ggrev1:`): fail closed per joint; one stale joint fails the
  whole group (whole-group fail-closed default — no partial-transition solve).
- Provenance: singular envelope → per-joint legs array; bake citation
  already array-typed (length-1 today) extends to length-N with the same
  leg↔intent match refusal per joint.
- Sanitize/resolve/persisted array: REUSE unchanged (forensics §§3,4,6).

## Verdict recommendation for A

**GO, bounded**: per-joint admission/tiling/agreement looped, strict
separation predicate `Wi/2+Wi+1/2 < gap`, canonical joint-index order,
whole-group fail-closed on any joint reject. No new epsilon, no touching
authorization, no production tolerance changes. Open implementation risks:
multi-interval tiling order in `planTransitionJoint` and the merged-strip
expectation wiring feeding gtop2 — both EXTEND, neither NEW authority.
