# Circle v1 Persistence + DXF (baseline main 6c7380a9)

- No schema version bump: circle is additive inside project/drawing
  version 2. Old v1/v2 files read exactly as before (no migration, no
  canonicalization of existing 0/360 test arcs).
- Circle-bearing files save/reopen exactly (pinned: center/radius/layer
  round-trip).
- Clone/sanitize/copy/revision/undo preserve Circle identity and fields;
  copy remaps layer; undo/redo symmetric.
- Invalid persisted geometry follows existing fail-closed conventions
  (SKIPPED_ENTITY on non-finite/non-positive export inputs; creation
  enforces the floor, same as arcs).
- Native model-space DXF CIRCLE: `model.circles` (+ block `circles`),
  groups 0/8/10/20/30/40, no 50/51 angle groups, no ARC fallback, no
  polygon approximation. Optional model fields keep existing literals
  compiling.
- No external/general DXF import work (globally absent / NOT_APPLICABLE).
- MlightCAD: truthful `AcDbCircle` (center + radius).
- Block child persistence preserves Circle; expansion keeps identity.
