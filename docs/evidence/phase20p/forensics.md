# Phase 20P forensics — sparse-transition inventory (study only, no `src/` changes)

Question: what must change to admit sparse collinear transition sets
(strictly-increasing joints with gaps), and what already handles them?
Method: read-only trace of the 20N.1 production path. Verdict per site:
REUSE (sparse-capable as-is), EXTEND (works but assumes contiguity), NEW
(must be written). Line numbers against branch
`research/phase20p-sparse-collinear-transition-set-decision @ 7970262`.

## 1. `src/engine/cad/grading/gradingTransitionPolicy.ts` — `parseCanonicalJointIndex` L88-95 — REUSE

Strict `joint:<n>` parse, no coerce/sort. Sparse ids are still canonical;
nothing gap-specific here.

## 2. Same file — `selectGroupTransitions` L247-286 — NEW (for sparse)

No-gap gate `index !== prev + 1` (L281) rejects every sparse set
fail-closed today. Sparse needs a strictly-increasing (gaps allowed)
selection alongside it; the consecutive form stays byte-identical for 20N.1
groups.

## 3. Same file — `checkGroupTransitionSeparation` L103-118 — EXTEND

Exact `<` half-sum check is gap-agnostic, but the length-1 coupling
(`sharedLengths.length !== widths.length - 1`, L106) assumes consecutive
joints. Sparse callers must pass set-gap lengths (S(k)-S(j)) instead of
`members[a.joint+1].length`.

## 4. Same file — `deriveGroupTransitionExpectation` L345-395 — NEW (for sparse)

Delegates order/separation to `deriveTransitionExpectation`, which rejects
non-consecutive sets. Sparse needs a set-form delegate taking the same
global-station gaps.

## 5. `src/engine/cad/grading/gradingTopologyExpectation.ts` — `deriveTransitionSetExpectation` L241-297 — NEW (for sparse)

Consecutive gate L269-271 and shared-member exactness L275-278
(`gap !== right.memberLengths[0]`) both assume j/j+1 adjacency. Sparse
needs: strictly-increasing ids, gap = station difference, same strict `<`.

## 6. Same file — `deriveTransitionExpectation` L299-309 — REUSE

Thin dispatcher (null → legacy, array → set, object → singular). A sparse
set form plugs in without touching this dispatch.

## 7. `src/engine/cad/grading/gradingGroupTransitionPlural.ts` — admission loop L305-410 — REUSE

Per-joint `admitGradingTransition` with `transitionCount: 1`, live member
pair, `keys[L]/keys[R]` staleness check. Joint-indexed, never assumes the
next transitioned joint is j+1. Sparse reuses it per set member unchanged.

## 8. Same file — set-gap calc L427 — EXTEND

`members[a.joint + 1].length` assumes contiguity. Sparse passes
S(next)-S(cur) over the skipped span; the `<` comparison itself is
unchanged.

## 9. Same file — `byJoint` L496 + rebuild L499-510 + `stitchGroupMember` L73 — REUSE

Absolute member indexing: `byJoint.get(m-1)/get(m)` cuts only claimed
members; unclaimed (skipped) members are never rebuilt, hence native.
Proves the tiler is already sparse-capable — skipped joints flow through
as ordinary native stations.

## 10. `src/engine/cad/grading/gradingGroupCompute.ts` — group gate L573-584 / legs L591-592 + `transitions[]` L1054-1064 — REUSE

Pre-mesh measured-vs-declared region check and per-joint leg emission are
joint-indexed; sparse sets satisfy both once admitted (study measures
1/1/1 on every positive row).

## 11. `src/workers/surfaceGradingService.ts` — `planGroupTransitionRequest` L295-315 — REUSE (inherits site 2 gate only)

Routes single vs group selection into per-intent plans. Only its
`selectGroupTransitions` call rejects sparse; the plan loop itself is
set-agnostic.

## 12. `src/workers/surfaceGradingCompute.ts` — `checkGroupTransitionPlansAgreement` L707-757 — EXTEND

Order gate plus views pairing (`views[i][1]` vs `views[i+1][0]` length
equality) assume consecutive plans. Sparse needs set-pair pairing with
the same exact-equality rule.

## 13. Same file — `validateGroupTransitionLegsMesh` L778-849 — REUSE

Positional legs[i]↔plans[i] validation, per-leg agreement + mesh gate.
Order-preserving, never re-matches by jointId; sparse arrays validate
unchanged.

## 14. Persist / prove / author chain — REUSE except the authoring gate (NEW)

- `gradingGroupPersistence.ts` `sanitizeTransitions` L87-160 — REUSE:
  retains every entry verbatim, never sorts/merges; sparse order persists.
- `gradingGroupRevision.ts` L158-198 — REUSE: `transitionText` joins in
  stored order; sparse sets hash order-sensitively (study pins this).
- `gradingTransitionProvenance.ts` — REUSE: per-joint provenance, no
  adjacency assumption.
- `CadGradingGroupTransitionPanel.tsx` L54-63 +
  `gradingTransitionAuthoring.ts` L75-113 (`canonicalJointOrderError`) —
  NEW: UI hard-rejects sparse staging ("sparse or out of order … fail
  closed"). Any sparse decision must rewrite this gate first, or staging
  stays impossible regardless of engine work.

## Bottom line

Tiling, admission, agreement, persistence, and provenance are already
sparse-capable (sites 1, 6–11, 13, 14-partial). The decision is confined
to the order/separation gates (sites 2–5, 8, 12) plus the authoring
hard-reject (site 14): 5 NEW/EXTEND predicates, all fail-closed today.
`corpus.json` (73 rows) measures the study-side sparse predicate against
production helpers; `sparse-set-geometry.md` states the rule the gates
would legislate.
