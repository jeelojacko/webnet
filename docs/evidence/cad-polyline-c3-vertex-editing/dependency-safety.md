# Phase C3 — Dependency safety

## Why insert/delete deliberately skips `syncEditedEntityDependencies`

`syncEditedEntityDependencies` is an INDEX-ALIGNED seam: it assumes the vertex
count is unchanged and maps each vertex label back to its linked survey point.
On an insert/delete the indices shift, so running it would map a label to a
DIFFERENT vertex and move the linked point to the wrong place.

The C3 transactions therefore do not call it:

- Insert/delete never move an existing vertex, so no linked survey point needs
  to move.
- The inserted vertex is never associated with a survey point, so there is
  nothing to sync.

`commitPolylineVertexEdit` documents this in code. Normal vertex moves still
route through `applyCadGripEdit` → `syncEditedEntityDependencies` exactly as
before.

## Boundary / breakline preflight

Both transactions run `validateBoundaryEntityVertexEdit` on the candidate
vertices BEFORE any project mutation, through the same choke point as the
Phase 18W boundary/breakline source edits. A boundary source (and any surface
breakline crossing it) that would become invalid blocks the edit with zero
mutation and no history entry.

## Array alignment

`segmentGeometry` and `segmentWidths` are split/merged alongside the vertices
in the same pure helper, so `length === course count` is an invariant of every
result (verified by the topology tests and browser flow I). Properties resolves
the live courses through `resolveCadPolylineCourses`, so arc rows stay correct
after a count change and straight-only numeric segment edits fail closed on
arc courses (arc rows are non-editable).

## History

Each insert/delete is exactly one history entry. Invalid input (endpoint-near,
off-course, unrepresentable merge, min-count) returns before the history push,
so undo/redo can never observe a partial edit.
