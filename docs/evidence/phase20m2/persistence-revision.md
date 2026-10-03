# Phase 20M.2 persistence + revision

Schema (additive, optional): group definitions gain an optional `transitions` intent list.
Each intent records the joint index and the explicit user width W
(`courseCriterionKey`-stable refs), and may carry an optional recorded revision
stamp plus endpoint evidence (absent on freshly authored intents). No existing key changes shape; schema version unchanged (v2).

Cardinality: `trp1` — at most ONE transition per group. Authoring refuses to stage a second while one
is present (browser flow G: add absent); compute rejects `>1` fail-closed.

Sanitation retains invalid intent: `sanitizeCadGradingGroupsDetailed` keeps a malformed intent in the
persisted record instead of silently dropping it; the reject reason is surfaced
as a resolve/compute diagnostic (not stored on the record itself), and the
group fails closed at resolve/compute. Stale intents (recorded revision ≠ live revision after edits)
FAIL CLOSED — never fallback to legacy solve, never a default width.

`ggrev1` participation without circularity: the canonical `ggrev1:` digest covers the persisted
intent canonical fields only (policyVersion/jointId/memberIds/width/lawKind/lawVersion/family/side).
Recorded revision + endpoint evidence values are solve outputs and deliberately never hash — hashing
the revision would be circular (the revision is derived from the digest). Edits that touch the intent
move the revision (which in turn invalidates the pinned intent — fail closed, never self-validating).
Pre-20M.2 homogeneous files hash byte-identical (old files legacy-identical).

Covered by `tests/cad_grading_transition_persist_20m2.test.ts` 8/8 + browser flow H
(save/reopen round-trips joint:0 / 8 m; recalc CURRENT) and flow I (edits invalidate → FAILED).
