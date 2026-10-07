# Phase C2 — DXF export mapping (spec §13)

A PLINE with bulge/width metadata exports as **one LWPOLYLINE** in both the
R12 and R2000/R2000-layout serializers. It is never split into standalone
ARC entities and never degraded to a chord. There is **no DXF import** work
in this pass.

## 1. `DxfPolylineVertex` shape

`src/engine/cad/dxf/dxfExportModel.ts:71`:

```ts
export interface DxfPolylineVertex extends DxfPoint {
  bulge?: number;      // group 42
  startWidth?: number; // group 40
  endWidth?: number;   // group 41
}
```

The type comment (`:66`) records the mapping: group 42 (bulge) and groups
40/41 (start/end band width) ride on the **START vertex of each course**.
Absent = legacy straight zero-width vertex (10/20 only).

## 2. Metadata → vertex mapping

`polylineDxfVertices` (`dxfExportModel.ts:209`) resolves courses through
`resolveCadPolylineCourses` and, for each course, writes:

- arc course → `vertex.bulge = bulge` on `vertices[course.index]`
- nonzero `startWidth` → group 40 on the same start vertex
- nonzero `endWidth` → group 41 on the same start vertex

`polylineCommand`/`sanitizeCadPolylinePath` already canonicalized all-line and
all-zero metadata to absent, so a zero-width straight vertex attaches nothing
even when the entity has other meta-bearing courses.

Serialization order is fixed for deterministic bytes
(`dxfSerializer.ts:34`, `polylineVertexPairs`): `10, 20, 40, 41, 42`.
Groups 40/41 are emitted only when the value is present; group 42 only when a
bulge is present.

## 3. Open-final / closed-final rules

- **Open**: courses are `n-1`; each attaches to `vertices[course.index]`. The
  **open final vertex carries nothing** (no outgoing course).
- **Closed**: courses are `n`; the final course is the last stored vertex →
  first vertex and attaches to `vertices[n-1]` (the **closed final stored
  vertex**). A C2 closed ring stores no duplicate closure vertex, so the
  closing metadata is exactly one entry on the last stored vertex.
- The closed bit is unchanged: `closed: entity.closed`
  (`dxfExportModel.ts:380`) serializes as group 70 `polyline.closed ? '1' : '0'`
  (`dxfSerializer.ts:205`). No duplicate closure vertex is emitted.

## 4. Legacy byte-equivalence

`polylineDxfVertices` early-returns plain `{x,y}` vertices when both
`segmentGeometry` and `segmentWidths` are absent, and the serializer then
emits only 10/20 per vertex — byte-identical to the pre-C2 output. This is
pinned by the consumers suite ("legacy straight zero-width polyline emits
byte-equivalent 10/20 only").

## 5. Block-table parity

Block-local LWPOLYLINE children carry the same metadata.
`blockPolylineVertices` (`dxfBlockExport.ts:128`) base-shifts the ring (bulge
is translation-invariant) and attaches 42/40/41 per course; the block
`polylines` entry keeps `closed: child.closed` (`:187`) and serializes
through the same `polylineVertexPairs` (`dxfSerializer.ts:155`). The R2000
layout serializer mirrors this (`dxfLayoutExport.ts:465`, groups
`10,20,40,41,42`).

## 6. No ARC-entity substitution, no import

`dxfExportModel.ts` has an `arcs` collection for native `CadArcEntity`
entities only. A bulged PLINE course is **never** moved into that collection
or emitted as a separate ARC record; it stays an LWPOLYLINE bulge (group 42),
which is the exact DXF representation. `cadCogoEntityIntersections` and COGO
tools may treat the course as an arc internally, but the DXF seam does not
rewrite entity type. No new `.dxf` reader/import path is added; file import
behavior is unchanged.
