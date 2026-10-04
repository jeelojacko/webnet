# Phase 20N.1 — Product provenance: per-joint gates

- **Per-joint provenance**: `buildTransitionProvenance` records side + joint
  per transition; citations bake in canonical joint order
  (`transitionResultBakeCitations`).
- **Citation length == N**: the baked citation array length must equal the
  admitted transition count; mismatch refuses.
- **Leg↔intent bijection gates**: `GROUPBAKE` / `GROUPEXTRACTDAYLIGHT`
  enforce a one-to-one leg↔intent match — a single mismatch refuses the
  product (no partial bake/extract).
- **Design Patch still unavailable**: the open-transition route keeps Design
  Patch off; it was never widened for N > 1 (Flow I pins products truthful
  with patch off). Extract/Bake otherwise behave as in 20M.2.
- FAILED/stale transitions block Extract/Bake as before.

## What this is not

- **20N study**: study provenance wording was scoped as proposed; 20N.1
  ships the gates above (Wave G + Flow I).
- **Candidate B**: no provenance exists for non-collinear transitions
  because none are admitted.
- **Narrowing**: none discovered here — per-joint provenance follows
  directly from the consecutive-joint predicate.
