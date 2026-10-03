# Phase 20M.1 — Proposed Persisted Transition Object (SPEC ONLY)

Status: **DESIGN PROPOSAL. No `src/` change, no schema bump, no writer.**
This file only specifies the shape a future transition object must have and
the invariants it must satisfy before any production admission. Nothing here
is implemented; `docs/evidence/phase20m/decision.md` §10 defers all of it to
policy. Authorities referenced: `forensics.md` §10–§11.

## 0. Non-goals

- No persistence change now: group definitions remain **schema v2, additive
  only** (`src/engine/cad/grading/gradingGroupPersistence.ts:9`).
- No default transition is ever materialized by absence. A group without a
  transition object is byte-identical to today's group.
- No widening of the 20L.2 route (`forensics.md` §1).

## 1. Object shape (proposed, additive/optional)

Attach an optional `transitions?: CadGradingTransition[]` beside the group
definition. Field names are illustrative; the invariants are the contract.

| Field | Type | Invariant |
|---|---|---|
| `policyVersion` | tag (e.g. `trp1`) | Required. Unknown/absent tag ⇒ object RETAINED as invalid intent: group is FAILED/NOT_CURRENT with a bounded diagnostic (§6), never silently un-transitioned. No schema bump: additive optional key. |
| `jointId` | `joint:${j}` | Stable within the group's ordered traversal; `j` is the group-local joint index (matches `gradingGroupCompute.ts:278` `jointCount = closed ? n : n-1`). |
| `memberIds` | `[courseCriterionKey(prev), courseCriterionKey(next)]` | Stable member identity from `src/engine/cad/grading/gradingGroupCourseCriteria.ts:21` (`courseCriterionKey`) — direction-independent (`:26`/`:27` register both orientations). Not positional-only: reorders of unrelated courses must not retarget. |
| `width` | number, meters, **source-line** measure | Explicit total symmetric width `W`. Finite, `W > 0`. `W/2` measured along the SOURCE line. No implicit default, no derivation from Δ (§5 of 20M decision rejects width-from-Δ). |
| `lawKind` | tag | Transition law family; unknown value ⇒ fail closed (§6). |
| `lawVersion` | tag | Pairs with `lawKind`; both required together. |
| `criterionFamily` | ref to `GradingCriterion` kind set (`src/engine/cad/grading/gradingTypes.ts:26`) | Declares which family the interior emits against, so provenance/Paste/Extract cannot claim a member law. |
| `endpointScalars` | refs + resolved values | See §4. |
| `side` | `GradingSide` | Inherited from the group (`gradingGroupTypes.ts:60`); recorded for provenance, not re-derived. |
| `provenance` | refs | See §5. |

## 2. Width ownership invariants

1. **Single owner.** Exactly one object owns the source interval width at a
   joint. Two objects whose intervals intersect the same source station set
   is an overlap.
2. **Symmetry.** `W` is a total symmetric width; each member gives `W/2`
   from the joint along its own source line. There is no independent
   per-member half-width in the initial proposal (asymmetric half-widths are
   a later policy extension, not v1).
3. **Feasibility.** `W/2 <= memberAvailableLength` for BOTH incident
   members, where available length is the member's source length minus any
   boundary already claimed by another transition or the group end.
4. **Touching vs overlap.** Intervals that share only an endpoint boundary
   are *touching*. Touching is scalar interval OCCUPANCY only — the shared
   station carries two independently legislated endpoint values (right end
   of the left law, left end of the next law) whose equality is unevidenced,
   so station ownership alone cannot show C0. PRODUCTION requires a strict
   positive gap between intervals. Boundary comparison stays exact (`===`
   on the shared station scalar), matching the 20L.2 same-`d` exactness
   precedent (`gradingExactOffsetPolicy.ts:148`) — never a tolerance.
5. **Reject on overlap.** Strictly positive shared interior ⇒ reject the
   object (fail closed, no silent clipping). No priority law exists
   (20M decision §5), so the model cannot pick a winner.
6. **Measure.** `W` is a source-line (chord vs arc-normative) measure. The
   choice is part of `lawKind`/`policyVersion`; it must be stated, not
   inferred from sagitta.

## 3. Law kind/version + criterion family

- `lawKind`/`lawVersion` are REQUIRED and versioned independently from the
  group. A change to the blend/criterion math is a new `lawVersion`; old
  objects with an unsupported version are retained as invalid intent and
  fail closed (§6), never coerced and never silently dropped.
- `criterionFamily` must be one of the families the analytic resolver
  understands (`gradingAnalyticCriterion.ts:154`) or an explicit new family
  registered by the policy — never an overloaded member kind.
- The object does NOT reinterpret member criteria. Member laws remain
  authoritative OUTSIDE the interval; the transition law is authoritative
  INSIDE only.

## 4. Endpoint scalar refs — refs, not snapshots

Preference: store **references to the authoritative member criteria** plus
the **resolved scalar values at the recorded revision**, not a frozen copy
that can silently drift.

- Refs: `[courseCriterionKey(prev), courseCriterionKey(next)]` resolve
  through the group's effective criteria
  (`src/engine/cad/grading/gradingGroupCourseCriteria.ts:39`,
  `canonicalCourseCriteria` at `:95`), the same path the revision uses
  (`gradingGroupRevision.ts:105`).
- Resolved values (e.g. terminal daylight XYZ, tie scalars) are recorded as
  *evidence at `ggrev1:`*, not as input authority. The revision string
  (`gradingGroupRevision.ts:153`) already pins canonical group content;
  a transition object must participate in that canonical content so any
  edit changes `ggrev1:` (proposed participation — unevidenced in 20M.1,
  no writer exists).
- **Grade gate.** The endpoint refs must carry exactly equal gradeRatios
  (`gL===gR`); a mismatch invalidates the object. No grade interpolation
  exists — phase 20M.1 evidences the obstruction (nonzero mid-interval
  plan/Z grade gaps) and answers NO-GO for differing grades.
- **Revision consequence.** If a member criterion or source geometry
  changes, `ggrev1:` changes, the recorded resolved values are stale, and
  the transition must be re-derived/recomputed — it must NOT keep serving a
  cached result against a stale revision (mirrors the `grev1:`/`ggrev1:`
  staleness contract, `src/workers/surfaceGradingService.ts:324`,`:379`).
  No circularity: hash inputs are law/width/refs plus canonical member
  criteria and source geometry; the recorded revision string and pinned
  evidence are outputs, never inputs.
- **Snapshot consequence.** A pure snapshot would let a transition outlive
  the authority it was derived from. Therefore snapshot is allowed only as
  *display/evidence*, never as the input that re-derives geometry. The
  worker cross-check (`worker-topology-product.md` §1.2) re-resolves native
  values from these refs and compares against this evidence.

## 5. Grading side + provenance refs

- `side` is inherited verbatim from the group (`gradingGroupTypes.ts:60`)
  so Extract/Bake cannot flip the transition against the members.
- `provenance` records, at minimum: the owning joint id, both member
  identities, the source interval (start/end station refs), `width` +
  its measure, `lawKind`/`lawVersion`, `criterionFamily`, and the residual
  metadata the producing build computed. Missing provenance ⇒ product ops
  that require it fail closed (§7 of `worker-topology-product.md`).

## 6. Sanitation contract (fail-closed, no silent default)

| Input | Behavior |
|---|---|
| Old file, no `transitions` key | Backfill absent; group behaves exactly as today (`gradingGroupPersistence.ts:9` precedent). |
| Unknown/absent `policyVersion` | Object retained as invalid transition intent; group is FAILED/NOT_CURRENT with a bounded diagnostic (`GRADING_AGREEMENT_TRANSITION_LAW_UNKNOWN` family). It must NOT fall back to un-transitioned CURRENT — a present-but-unreadable transition is not the absence of one. (Only files with NO `transitions` key at all stay legacy: behave exactly as today.) |
| Malformed fields (non-finite width, bad refs, unknown `lawKind`) | Object retained as invalid intent; group is FAILED/NOT_CURRENT with a bounded diagnostic (`GRADING_AGREEMENT_TRANSITION_MALFORMED` family), never silently degraded to un-transitioned CURRENT. Justified contract: a malformed transition must never brick the whole drawing, and must never silently become a default — or silently vanish. |
| Stale refs (member id no longer resolves, revision mismatch) | Fail closed for the transition: mark not-current / invalidate; do not fabricate a replacement. Retain the invalid intent with its diagnostic (`GRADING_AGREEMENT_TRANSITION_STALE` family) so status reads FAILED/NOT_CURRENT, never CURRENT-via-fallback. (Proposed exact invalidation — unevidenced in 20M.1, no implementation.) |
| Width infeasible (`W/2 > available`) or interval overlap | Reject object; surface a bounded diagnostic (code list in `worker-topology-product.md` §2). |
| Grade-ratio mismatch (`gL!==gR`) | Reject object; scalar interpolation cannot preserve plan/Z (corpus `grade-*` rows). |
| Member/source edit | `ggrev1:` changes ⇒ transition invalidated and recomputed. Derived results never persist (`gradingGroupPersistence.ts:8`). |

**No silent default creation, ever.** The absence of a transition is the
absence of a transition — it does not mean "width = 0", "width = member/8",
or any probe value from the 20M study.

## 7. Minimum editor control (sketch only, no implementation)

The future UI needs exactly two user-owned inputs and one inherited display:

1. **Explicit width** — numeric input in source-line meters, validated
   `finite && > 0` and against §2.3 feasibility before commit.
2. **Law pick** — a single selector over the registered `lawKind` values
   (no free-text, no per-member law sub-form).
3. **Inherited/read-only** — side, joint id, member identities, source
   interval bounds.

No auto width, no "fit" button, no per-joint default. If a future phase
wants a suggested width it must be an explicit user action that writes the
same explicit field, never a hidden derivation.
