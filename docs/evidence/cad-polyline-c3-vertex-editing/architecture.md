# Phase C3 — Polyline vertex insert/delete architecture

Branch: `feat/cad-polyline-vertex-editing-c3`. This document maps the
surfaces added on top of the Worker A topology/transaction core.

## Layers

```
Properties row action / grip drag / typed command
        │
        ├── Properties: cadProperties.ts rows → CadEntityPropertyRowAction
        │        → runPolylineVertexRowAction (surveyCadPolylineVertexActions.ts)
        │
        ├── Grips: buildCadGripHandles (cadTransactionsEntityTransforms.ts)
        │        → activeGripHandle drag → surveyCadWorkspaceActions.finishGripEdit
        │
        └── Commands: PLINEINSERTVERTEX / PLINEDELETEVERTEX sessions
                 (useSurveyCadPolylineVertexSession.ts)
        │
        ▼
Engine transactions (cadTransactionsEditCommands.ts)
  POLYLINE_INSERT_VERTEX { entityId, courseIndex, x, y }
  POLYLINE_DELETE_VERTEX { entityId, vertexIndex }
        │  editable gate + boundary/breakline preflight BEFORE mutation
        ▼
Pure topology (cadPolylineTopology.ts)
  insertCadPolylineVertexOnCourse / deleteCadPolylineVertex
        │
        ▼
C2 course authority (cadPolylineGeometry.ts, cadPolylineCourses.ts,
cadParcelArcGeometry.ts)
```

## One pure topology core, three UI surfaces

The topology helpers are the single geometry authority. Every surface routes
to them; no surface re-derives arc math or re-implements the split/merge:

- **Grip insert** builds a `polyline-insert` handle at each resolved course
  midpoint (`cadArcMidpoint` for arcs, finite midpoint for lines) and commits
  `POLYLINE_INSERT_VERTEX` on release. The drag preview calls the topology
  helper directly (no project mutation) so the previewed split path is the
  committed split path.
- **Properties** emits one `Delete Vertex` action per vertex (preflighted
  with `describeCadPolylineVertexDeleteBlock`, no mutation) and one
  `Insert Vertex` action per course. Insert recomputes the true course
  midpoint from the LIVE entity at dispatch time.
- **Typed commands** (`PLINEINSERTVERTEX` / `PLINEDELETEVERTEX`) are
  pick-gated sessions that select the polyline (or use the sole selected
  editable polyline), then commit one transaction per pick.

## Additive contract changes

- `CadGripHandleKind` gains `'polyline-insert'`; `CadGripHandle` gains an
  optional `courseIndex`.
- `CadEntityPropertyRowAction.kind` gains `'polyline-delete-vertex'` and
  `'polyline-insert-vertex'` with optional `vertexIndex` / `courseIndex` /
  `entityId`.
- `CadCommandKey` gains `POLYLINE_INSERT_VERTEX` / `POLYLINE_DELETE_VERTEX`
  (one history entry each; invalid input = zero mutation).
- `CadPolylineEntity` schema is UNCHANGED (no version bump).

## Rendering

`GripHandleLayer` renders `polyline-insert` grips as secondary hollow
diamonds (`data-survey-cad-grip-handle="polyline-insert"`) and keeps vertex
grips as solid circles, so the two affordances never read as the same thing.
`gripPreviewPrimitives` highlights the projected insertion + split path in
the existing cyan preview vocabulary.

## Non-goals / untouched

Polygon, parcel, and feature-line grips are byte-for-byte unchanged (vertex
grips only). The global `Delete` → `ERASE` keybinding is untouched. No second
`PEDIT` dialog was added.
