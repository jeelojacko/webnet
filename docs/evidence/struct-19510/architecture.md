# STRUCT-195.10 Architecture — surface-revision source + profile-sample type leaves

## Goal

Sever the two remaining refactorable 2-node TYPE SCCs with ZERO runtime changes:

- PAIR A: `src/engine/cad/cadSurfaceRevision.ts` <-> `cadSurfaces.ts`
- PAIR B: `src/engine/cad/profiles/profileExtraction.ts` <-> `profileSampling.ts`

## Design (type-only leaves, hub re-exports)

PAIR A — NEW `src/engine/cad/cadSurfaceSourceTypes.ts` (33 lines):
type-only module with a single `import type` (the `CadEntityId` alias
from `cadCorePrimitiveTypes`) and no runtime values. Owns the full
11-member `CadSurfaceReasonCode` union copied EXACTLY in original order:

```
SURFACE_TOO_FEW_POINTS, SURFACE_COLLINEAR_POINTS,
SURFACE_POINT_MISSING_Z, SURFACE_DUPLICATE_XY_CONFLICT,
SURFACE_BREAKLINE_INVALID, SURFACE_BREAKLINE_MISSING_Z,
SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX, SURFACE_BOUNDARY_INVALID,
SURFACE_VOID_INVALID, SURFACE_REFERENCE_MISSING,
SURFACE_TRIANGULATION_FAILED
```

plus the `CadSurfaceSourcePoint` interface verbatim
(`entityId: CadEntityId; x/y/z: number`). `cadSurfaces.ts` drops both
inline declarations, adds `import type` (local annotations on
`CadSurfaceBuildResult`, `isCollinearWorld`, `meshBounds`,
`replaySurfaceEdits`, `buildCadSurface`) + `export type ... from`
(legacy path for every existing caller). `cadSurfaceRevision.ts`
changes ONLY its one type-import line (`CollectedSources`,
`collectSources`, `computeCadSurfaceSourceRevision` untouched).

PAIR B — NEW `src/engine/cad/profiles/profileSampleTypes.ts` (41 lines):
two `import type` statements (`CadSurfaceGrid` from `../cadSurfaces`,
`TinAdjacency`/`TinEdgeKinds` from `../tin/tinTypes`), no runtime
values. Owns verbatim:

```ts
export type ProfileSampleEventKind =
  | 'edge-crossing' | 'vertex' | 'boundary-entry' | 'boundary-exit'
  | 'void-entry' | 'void-exit' | 'plane-break';
export interface ProfileSample {
  rawChainage: number; displayStation: number | null;
  x: number; y: number; elevation: number;
  alignmentElementIndex?: number; surfaceTriangleIndex?: number;
  eventKind?: ProfileSampleEventKind;
}
export interface ProfileExtractionMesh {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
  grid: CadSurfaceGrid;
  adjacency?: TinAdjacency[];
  edgeKinds?: TinEdgeKinds[];
}
```

`profileExtraction.ts` drops all three declarations, adds `import type`
+ `export type` re-export lines; `ProfileSegment`,
`CadSurfaceProfileResult`, `ExtractSurfaceProfileInput` and all runtime
code untouched. `profileSampling.ts` changes ONLY its one type-import
line; walkers, `Walker`, all elevation logic untouched.

## Why this breaks the cycles

Each SCC was closed by a TYPE-only backedge (consumer -> hub for a
shared shape while the hub holds VALUE imports of the consumer). Moving
the shared shape to a leaf repoints the consumer edge to the leaf; the
leaf's only out-edges are type-only references to modules that cannot
reach back (primitive aliases, tin shapes, the surface grid), so no
cycle can reform. Hubs keep re-exporting, so every legacy import path
compiles unchanged.

## Remaining TYPE SCCs (1 pair, untouched)

- `cadProjectTransform.ts` <-> `cadProjectTransformRequest.ts`

Refs #195 (issue stays OPEN).
