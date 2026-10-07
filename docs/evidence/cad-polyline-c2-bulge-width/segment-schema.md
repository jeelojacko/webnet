# Phase C2 — additive polyline segment schema

## 1. Additive trailing optional fields (no version bump)

Two optional trailing fields are added to the existing `CadPolylineEntity`
and the `PLINE` command payload. No existing field changes; absent arrays are
the legacy C1 shape.

`src/engine/cad/cadTypes.ts:302`:

```ts
export type CadPolylineSegmentGeometry =
  | { kind: 'line' }
  | { kind: 'arc'; bulge: number };

export interface CadPolylineSegmentWidth {
  startWidth: number; // full centred band width (m) at the course start
  endWidth: number;   // full centred band width (m) at the course end
}

export interface CadPolylineEntity extends CadBaseEntity {
  // ...existing fields unchanged...
  segmentGeometry?: CadPolylineSegmentGeometry[];
  segmentWidths?: CadPolylineSegmentWidth[];
}
```

`src/engine/cad/cadTransactions.types.ts:431` carries the identical optional
fields on the `PLINE` payload:

```ts
{
  key: 'PLINE';
  vertices: { x: number; y: number; label: string }[];
  closed?: boolean;
  segmentGeometry?: CadPolylineSegmentGeometry[];
  segmentWidths?: CadPolylineSegmentWidth[];
}
```

The bulge value is the shared signed convention
(`b = tan(sweepRad/4)`, positive CCW/center-left, `|b| > 1` major); the width
is a full centred band in metres, tapered linearly from `startWidth` to
`endWidth` — not a lineweight and never a resolved display value.

## 2. Course-count law

`cadPolylineCourseCount(vertexCount, closed)` (`cadPolylineGeometry.ts:139`):

- open: `n - 1` courses
- closed: `n` courses (the final entry is the last→first course)

Entry `[index]` always describes the course **starting at `vertices[index]`**.
The stored closed ring never repeats its first vertex, so the closing course
is entry `n-1` on the last stored vertex. Present arrays must match the course
count exactly or the path/command fails closed.

## 3. Canonicalization rules

`sanitizeCadPolylinePath` (`cadPolylineGeometry.ts:334`) is the single
normalizer (`polylineCommand` and `commitPlineSession` both route through it).
The all-line / all-zero canonical form keeps legacy files byte-clean:

| Input | Canonical output |
|---|---|
| geometry all `{kind:'line'}` | `segmentGeometry` **omitted** |
| widths all `{startWidth:0,endWidth:0}` | `segmentWidths` **omitted** |
| any arc / any nonzero width | preserved exactly (never straightened, never sign-flipped) |
| legacy path (no metadata at all) | C1 law: adjacent 1e-9 dedupe + closed redundant-final strip + label alignment |

Fail-closed cases (no mutation, draft kept active / command returns null):

- `segmentGeometry`/`segmentWidths` present but not an array, or length ≠ course count
- an entry not an object, or an unknown geometry `kind`
- non-finite bulge; explicit `bulge === 0` on a declared arc; sub-floor bulge
  (`|b| < CAD_PARCEL_BULGE_LINE_FLOOR`); zero-chord arc; sweep ≥ full-circle;
  an arc that derives no valid circle
- non-finite or negative width
- an interior adjacent duplicate (cannot dedupe without shifting ownership)
- a closed redundant-final vertex whose outgoing entry carries an arc or a
  nonzero width (ambiguous ownership)
- open <2 retained, closed <3 retained distinct vertices

Persistence load is also fail-closed: `clonePolylineSegmentMetadata`
(`cadPersistence.ts:103`) runs the same validator and throws on malformed
metadata, so both load sanitizers reject the file instead of silently
straightening a curve or dropping a band.

## 4. Legacy byte-compatibility and precedent

- A legacy polyline with neither field present commits/clones/exports exactly
  as before (C1 behavior, no new keys) — verified by the core suite's
  "byte-clean (no new keys)" pins and the consumer DXF legacy pin.
- **No version bump and no migration**: the fields are trailing optionals on
  an already-tolerated open entity shape. This follows the same precedent as
  the C1 additive `closed?: boolean` payload/entity field and the feature-line
  optional `segmentGeometry`, both of which were added without a `.wncad`
  version bump. Absent = default; present = explicit. The doc comments on each
  field state the "trailing optional field (no version bump)" contract, and
  the `Mlightcad` spike geometry is `Record<string, unknown>`, so
  consumers carry the metadata without a type-version change.
