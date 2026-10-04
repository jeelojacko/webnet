# Phase 20N Forensics — Phase 20M.2 Production Authorities (read-only inventory)

- Branch: `research/phase20n-transition-expansion-decision`, baseline `9805da77`.
- Method: read-only. Zero `src/` edits.
- Candidate framing:
  - **Candidate A** = multiple collinear transitions per group (cardinality > 1).
  - **Candidate B** = exact collinearity relaxed / treated as more than a single admission gate.
- Verdict key: **REUSE** = unchanged; **EXTEND** = bounded extension; **NEW** = new semantic authority; **UNWIRED** = defined but not on production path.

Frozen predicate source: `docs/evidence/phase20m1/decision.md` §9 (verdict `PARTIAL_GO_COLLINEAR_SAME_FAMILY_TRANSITION`), restated in `docs/evidence/phase20m2/architecture.md:1-18`.

## 1. Admission predicate — `src/engine/cad/grading/gradingTransitionPolicy.ts`

| Symbol | Lines | Role |
|---|---|---|
| `TRANSITION_POLICY_VERSION/LAW_KIND/LAW_VERSION` | `:17-19` | `trp1` / `TRANSITION_LINEAR_V1` / `v1` |
| `TransitionRejectCode` | `:21-36` | bounded reject vocabulary |
| `hasTransitionIntent` | `:78` | legacy-vs-intent discriminator (**UNWIRED** — only test ref) |
| `admitGradingTransition` | `:119` | single admission authority |
| `evaluateTransitionLinearV1` | `:174` | legislated interior law `v(s)=vL+(vR−vL)·t` |
| `TransitionSelection` / `selectGroupTransition` | `:192` / `:197` | one cardinality gate |
| `transitionRejectGroupCode` | `:236` | policy → `GroupDiagnosticCode` mapping |

Internal gates (exact, fail closed): `transitionCount !== 1` → `CARDINALITY` `:130-131`; `!isOpen` → `CLOSED` `:132`; exact collinearity `cross === 0 && dot > 0` → `NON_COLLINEAR` `:144` (`:141-143`); flat, joint Z, side, family, grade, width bound `:145-161`. Input shape strictly pairwise (`memberIds`/`members` length 2, `:120`) — inherently one-joint, one-pair.

- **Candidate A — EXTEND.** Predicate per-transition reusable; only `:130` and `selectGroupTransition` `:221-227` hard-code singleton. Bounded: admit per joint, iterate per-joint.
- **Candidate B — NEW (at this authority) + downstream.** `cross === 0` (`:144`) is first gate but not only collinear bake-in (see §9/§10).

Authoritative `>1` rejects: policy `selectGroupTransition:221-227` (code `TRANSITION_REJECTED`, detail `GRADING_AGREEMENT_TRANSITION_CARDINALITY`) + redundant `admitGradingTransition:130` `CARDINALITY`.

## 2. Authoring — `src/engine/cad/grading/gradingTransitionAuthoring.ts`

Singleton walls: `transitionJointEligibility` `existing.length > 1` reject `:132-133`, single-joint `:135-137`; `setGroupTransition` `:224-226` fail `only one transition per group (trp1)`, write `transitions: [next]` `:236`; `clearGroupTransition` drops key wholesale `:241-247`.

- **A — EXTEND** (per-joint eligibility, append/replace-by-jointId, per-jointId clear). **B — REUSE** (delegates to admission).

## 3. Persisted model — `src/engine/cad/grading/gradingGroupTypes.ts`

`CadGradingGroup.transitions?: CadGradingTransition[]` `:75` already array; doc `:71-75` says "at most ONE" as policy not schema. `CadGradingTransition` `:138-149`; endpoints/provenance `:118-136`; result leg `:252`; diagnostic codes `:102-105`.

- **A — REUSE. B — REUSE.**

## 4. Resolve — `src/engine/cad/grading/gradingGroupResolve.ts`

`ResolvedGroupInputs.memberKeys: string[]` `:34`, `transitions?` `:39`, carried verbatim `:221,236`; no cardinality check.

- **A — REUSE. B — REUSE.**

## 5. Revision hashing — `src/engine/cad/grading/gradingGroupRevision.ts`

`exactTransitionWidth` `:148` full-precision (1e-9 skip for W only, `:139-147`); `transitionText` `:158` maps `transitions.map(...).join('#')` over `trp/joint/members/width/law/family/side`; empty when absent (legacy byte-identical). `buildGroupRevision` `:175` splices one `#`-joined part (~`:189`), `fnv1a(parts.join('#'))`.

**Order sensitivity:** positional `map().join('#')` — different orderings hash differently. Candidate A must define canonical order (e.g. joint index). Endpoint/provenance/revision excluded (`:125-137`), no circularity.

- **A — EXTEND + canonical order. B — REUSE.**

## 6. Persistence / sanitation — `src/engine/cad/grading/gradingGroupPersistence.ts`

`cloneTransitions` `:46` verbatim copy; `malformedTransitionMarker` `:69`; `sanitizeTransitions` `:87` non-array → `[marker]` `:89`, keeps every object entry in order `:90-134`, re-attached `:216-218`. Cardinality intentionally not enforced ("retained, never validated").

- **A — REUSE. B — REUSE.**

## 7. Pre-mesh topology expectation — `src/engine/cad/grading/gradingTopologyExpectation.ts`

`deriveGradingTopologyExpectation` `:78` legacy untouched. `deriveTransitionExpectation` `:171`: `transitionCount !== 1` → `OVERLAP` `:181-183`; `!isOpen`, width checks `:184-198`; success declares hard-coded `{group, closed:false, positiveWidthRegions:1}` → 1/1/1 `:201-207`.

- **A — EXTEND** (accept list, verify disjointness, declare the single merged strip: 1 region for N joints). **B — mostly independent** (budget assumes contiguous interval).

## 8. Topology certificate — `src/engine/cad/grading/gradingTopologyCertificate.ts`

`buildGradingTopologyCertificate` `:178` (gtop1), error `:245`; `buildGradingTopologyCertificateExact` `:525` (gtop2, explicit expectation, F64+u32 digests, SHA-256, `GTOP2_POLICY`); revalidation `:589`; production error `:343`. Header encodes scope/policy/components/cycles/regions — already count-parameterized.

- **A — REUSE machinery** (coupling only at §7 expectation). **B — REUSE.** gtop2 validates, never admits.

## 9. Engine solve — `src/engine/cad/grading/gradingGroupCompute.ts`

`GroupSolveInput.transition?` `:108`, `transitionMemberKeys?` `:114` singular. `PlannedTransition` `:280` single joint/law/interval. `planTransitionJoint` `:331`: joint regex `:339-343`, closed reject `:348`, refs `:356`, admission `:372`, provenance `:414`, endpoint evidence `:421-441`, **tangent/normal from `frameL.tOut`/`frameL.nOut` alone** `:443-448` (outgoing right == left assumed — collinear precondition), `jointStation` `:449`, re-tile + linear law `:456-460`, checkpoints `:498+`. Single `transitionPlan`/`transitionExpectation` `:838-865` (`transitionCount: 1` hard-coded `:848-859`); joint recorded `TANGENT` never re-patched `:902-913`; expectation fallback `:1199`; singular result leg `:1306-1330`.

- **A — EXTEND** (loop per joint; tiling/merge multi-interval interaction unproven — 20M.1 §5 gap). **B — NEW semantic authority** (two tangents exist; frame/blend/normal semantics needed, not one-line change).

## 10. Worker plan + agreement — `src/workers/surfaceGradingCompute.ts`

`GroupTransitionPlan extends CadGradingTransition` `:307` + `groupSide/isOpen/transitionCount/jointZ/endpointEvidence/jointStation/recordedRevision` singular. `checkGroupTransitionAgreement` `:355`: `transitionCount !== 1` → `OVERLAP` `:377-379`, re-admit `:383+`, pinned-evidence compare `:446-449`. `validateTransitionInteriorVertices` `:482` independent re-eval. `validateTransitionResultMesh` `:612` three checkpoints, **plan normal from source mates `pCutR−pCutL`** — collinearity-dependent.

- **A — EXTEND** (arrayify plan/evidence/checkpoints). **B — NEW** (per-segment frames needed).

## 11. Worker handler gate — `src/workers/surfaceWorkerHandler.ts`

`GradingGroupComputeRequest.transition?/transitionMembers?/transitionMemberKeys?` `:547-554` singular. `resolveTransitionMemberViews` `:570` exactly 2 views. `validateTransitionResultMeshAgainst` `:612`, `canonicalTransitionFromPlan` `:661`, `toGroupSolveInput` `:693-698` single forward. Pre-solve `:1514-1522`, post-solve `:1537-1542`.

- **A — EXTEND. B — REUSE** (delegates to §10).

## 12. Service carry — `src/workers/surfaceGradingService.ts`

`GroupTransitionRequestPlan` `:120` singular union. `planGroupTransitionRequest` `:137`: `selectGroupTransition` `:138`, joint regex `:143`, adjacent-key check `:146-156`, admission `:175+`, reject map `:203`, `jointStation` accumulation `:216-218`, one transition return `:220+`.

- **A — EXTEND** (arrayify; per-joint `jointStation`). **B — REUSE.**

## 13. Product / provenance — `src/engine/cad/grading/gradingTransitionProvenance.ts` + commands

`TransitionPersistedIntent` `:25`; `GroupTransitionProvenance` `:28` singular envelope; `buildTransitionProvenance` `:50` singular; `transitionResultBakeCitation` `:82` returns array but always length-1 (`:93-115`); `TransitionProductStatus` `:116` / `applyTransitionProductGate` `:139` **UNWIRED** (test-only refs; production uses `deriveGradingProductCapabilities` via `cadGradingGroupSnapshot.ts:304`); open-route Design-Patch refusal from base rule (`gradingProductCapabilities.ts:169,191`). `GROUPBAKE` citation `cadTransactionsGradingGroupCommands.ts:99,640` with leg↔intent match refusal; `GROUPEXTRACTDAYLIGHT` `:466`, `GROUPBAKE` `:521` singular-layer cert checks.

- **A — EXTEND** (+ unwired-gate note; plural envelope decision needed). **B — REUSE.**

## 14. Authoring UI — `src/cad-app/shell/CadGradingGroupTransitionPanel.tsx` + commands

`current = existing[0]` `:59` reads first intent only; single vs add-form render `:104-116`; joint select enumerates all `:68-83`. Commands `cadGradingGroupShell.ts:55-56`, impls `cadTransactionsGradingGroupCommands.ts:395-431,650-651`; mounted `CadGradingGroupManager.tsx:641-644`.

- **A — EXTEND** (per-joint loop; select already enumerates). **B — REUSE.**

## 15. Non-collinear hard stops outside transition path

`gradingGroupHybridCorners.ts:242,356,125` and root-policy `:354`, `gradingChordSeam.ts:478` → `_TRANSITION_REQUIRED` fail-closed stops bent joints never cross today.

- **B relevant boundary**; relaxing collinearity routes bent joints into transition machinery first time.

## Critical-question answers

1. Array structurally supported but policy-blocked; hidden singleton assumptions in tiling (`§9`), expectation 1/1/1 (`§7`), worker checkpoints (`§10`), UI first-only read (`§14`) — no serialization/revision hidden blockers beyond order-sensitivity.
2. `ggrev1` order-sensitive positional join; order meaningful today only as hash input (single element); Candidate A must canonicalize (joint index).
3. Singular: result leg, provenance envelope, bake citation length-1. Plural-ready: persisted array, bake key type. Candidate A must pluralize leg + envelope.
4. Smallest multi representation: `GroupTransitionPlan[]` + per-joint `transitionMemberKeys[]` + per-joint `jointStation`; per-transition agreement math unchanged, looped.
5. Topology expectation 1/1/1 hard-code is the cardinality-dependent claim; certificate generic.
6. `>1` rejects: policy `:221`, admission `:130`, authoring `:132,135,224`, pre-mesh `:181`, worker `:377`.
7. Non-collinear rejects: admission `:144`; dependence (not reject): engine `:443-448,902-913`, worker `:612+`; pre-existing stops: hybrid `:242,356`, seam `:478`.

## Notable observations

- `hasTransitionIntent` (`:78`) dead in production (test-only).
- `applyTransitionProductGate` unwired (test-only); live path is `deriveGradingProductCapabilities`.
- Two independent cardinality gates (policy + admission) plus authoring/pre-mesh/worker gates.
- `exactTransitionWidth` full-precision must be preserved in any Candidate A hash.
