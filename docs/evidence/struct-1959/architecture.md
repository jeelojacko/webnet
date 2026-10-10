# STRUCT-195.9 Architecture — surface-edit reason + DXF point type leaves

## Goal

Sever two independent 2-node TYPE SCCs with ZERO runtime changes:

- PAIR A: `src/engine/cad/cadSurfaceEditMesh.ts` <-> `cadSurfaceEdits.ts`
- PAIR B: `src/engine/cad/dxf/dxfBlockExport.ts` <-> `dxf/dxfExportModel.ts`

## Design (type-only leaves, hub re-exports)

PAIR A — NEW `src/engine/cad/cadSurfaceEditReasonTypes.ts` (26 lines):
zero imports, no runtime values. Owns the full 17-member
`CadSurfaceEditReason` union copied EXACTLY in original order:

```
SURFACE_EDIT_VERTEX_MISSING, EDGE_MISSING, NOT_APPLICABLE,
BLOCKED_CONSTRAINT, SYNTHETIC_VERTEX, INTERMEDIATE_VERTEX,
POINT_OUTSIDE_DOMAIN, POINT_ON_BOUNDARY, POINT_ALREADY_EXISTS,
DELETE_POINT_CONSTRAINED, DELETE_POINT_BOUNDARY,
DELETE_POINT_CAVITY_INVALID, MOVE_POINT_CONSTRAINED,
MOVE_POINT_BOUNDARY, MOVE_POINT_INVALID_STAR, MOVE_POINT_INTERSECTION,
ELEVATION_INVALID
```

(each with the original `SURFACE_EDIT_` prefix). `cadSurfaceEdits.ts`
drops the inline alias, adds `import type` (local annotations) + 
`export type ... from` (legacy path for every existing caller).
`cadSurfaceEditMesh.ts` changes ONLY its one type-import line; the
runtime `EditHalt` class is byte-identical.

PAIR B — NEW `src/engine/cad/dxf/dxfPointTypes.ts` (18 lines): zero
imports, no runtime values. Owns verbatim:

```ts
export interface DxfPoint { x: number; y: number; }
export interface DxfPolylineVertex extends DxfPoint {
  bulge?: number; startWidth?: number; endWidth?: number;
}
```

including the Phase C2 doc comment on the vertex (bulge group 42,
width groups 40/41). `dxfExportModel.ts` drops both declarations, adds
`import type` + `export type` re-export lines; `DxfPoint3D`,
`DxfBlockEntry`, `DxfExportModel` fields and all runtime code untouched.
`dxfBlockExport.ts` changes ONLY its one type-import line; all builders,
serialization, ACI mapping, entities/layers untouched.

## Why this breaks the cycles

Each SCC was closed by a TYPE-only backedge (consumer -> hub for a
shared shape while the hub holds VALUE imports of the consumer). Moving
the shared shape to an import-free leaf repoints the consumer edge to
the leaf; the leaf has zero out-edges, so no cycle can reform. Hubs keep
re-exporting, so every legacy import path compiles unchanged.

## Remaining TYPE SCCs (3 pairs, untouched)

- `cadProjectTransform.ts` <-> `cadProjectTransformRequest.ts`
- `cadSurfaceRevision.ts` <-> `cadSurfaces.ts`
- `profileExtraction.ts` <-> `profileSampling.ts`

Refs #195 (issue stays OPEN).
