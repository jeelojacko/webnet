# Phase 20Q.1 — Persistence & provenance: no schema change (one revision-identity fix)

## No schema change

Phase 20Q.1 does **not** touch any persistence, sanitation, or
schema file (`git diff --name-only` contains zero such paths), and adds no
field, default, or toggle. One revision file changed as a review fix:
`gradingGroupRevision.ts` hashes transitioned-group source `startZ`/`endZ` at
full precision (`exactZ`); no-transition groups keep the legacy quantizer
byte-identical (see `## Revision identity (review-fixed)` below). The persisted
transition intent stays the canonical `CadGradingTransition`
(`gradingGroupTypes.ts`): `policyVersion`, `jointId`, `memberIds`, `width`,
`lawKind`, `lawVersion`, `criterionFamily`, `side`, optional
`provenance`/`endpoints`. No field, no default, no toggle was added; a sloped
intent is persisted exactly like a flat one and admitted after reload.

## Revision identity (review-fixed)

`buildGroupRevision` (`gradingGroupRevision.ts`) still derives
`ggrev1:<fnv1a-hex>` over the canonical group content. `transitionText`
hashes only the persisted canonical fields (policyVersion, jointId,
memberIds, full-precision width, lawKind/lawVersion, family, side). Endpoint
evidence values and the recorded revision remain **outputs** and are never
hashed.

Source Z is now encoded per group: `hasTransitionIntent` selects `exactZ`,
so a **transitioned** group hashes source `startZ`/`endZ` at full precision.
A sub-nanometre flat→sloped edit therefore moves `ggrev1:` → the group turns
stale and recalculates; it is never served a cached CURRENT. Groups with **no**
transition intent keep the legacy 1 nm `canonicalGradingNum` quantizer, so
their hashes stay byte-identical. Pinned by
`tests/cad_grading_transition_reviewfix_20q1.test.ts` (review-fix BLOCKER).

## Citations

`transitionResultBakeCitation` (singular) and `transitionResultBakeCitations`
(canonical joint order) carry the full provenance envelope verbatim —
interval `[sL,sR]`, joint station, endpoint scalars, recorded revision,
agreement code — never re-derived. A citation is emitted only when the result
actually solved with an admitted leg; a citation-less transitioned bake
refuses. The singular sloped route emits exactly one citation.

## Stale blocks everything

- `transitionEvidenceMatchesIntent` requires persisted provenance (if
  present) to match its intent (joint/member ids, width, law, family, side)
  and the live `ggrev1:` revision.
- `checkGroupTransitionAgreement` rejects a revision mismatch or a pinned
  scalar mismatch at `GRADING_AGREEMENT_TRANSITION_STALE`.
- `applyTransitionProductGate` blocks Extract / Bake / Design Patch when the
  result is FAILED or stale; the open transition route keeps Design Patch
  unavailable (not widened). Load sanitation is unchanged: malformed optional
  provenance is never repaired, and a stale intent rejects the whole solve.

## Evidence

- `src/engine/cad/grading/gradingTransitionProvenance.ts` (unchanged) — the
  envelope and product gate.
- `src/engine/cad/grading/gradingGroupRevision.ts` (unchanged) — `ggrev1`
  canonical text over persisted fields only.
- `tests/cad_grading_transition_persist_20m2.test.ts`,
  `tests/cad_grading_transition_product_20m2.test.ts` — carried regression,
  green in the transition suite (30 files / 660).

## What this is not

- **A new persisted law/tolerance/default**: none introduced.
- **A schema change**: `ggrev1`'s input field set and `fnv1a` algorithm are
  untouched; only the transitioned-group source-Z encoding moved from the
  1 nm quantizer to exact (see above).
- **Slope provenance**: slope is a geometry fact, not persisted separately;
  continuity is re-derived from the member Z endpoints on reload.
