# Phase C3 — Insert law

`insertCadPolylineVertexOnCourse(entity, { courseIndex, x, y })` is the one
insert authority. It always rides the ORIGINAL resolved course; a vertex can
never be inserted off-course.

## Line courses

- The pick projects/clamps onto the finite segment
  (`cadClosestPointOnSegment`); the stored vertex is that exact projection, so
  the path shape is unchanged.
- A projection within the 1e-9 canonical dedupe floor of either endpoint is
  rejected (`ENDPOINT_NEAR`) — no zero-length course.
- The split width fraction is the true length fraction
  (distance from the course start ÷ course length).

## Arc courses

- The pick angle must fall inside the true swept arc
  (`cadIsAngleOnArcSweep`); otherwise the insert is rejected (`OFF_COURSE`)
  and nothing changes. The pick is never silently chord-inserted.
- The pick projects radially onto the arc (`cadClosestPointOnArc`); the stored
  vertex rides the same circle at radius `metrics.radius`.
- The split reuses `splitParcelArcCourse` (same circle, same traversal,
  `b = tan(sweep/4)`), producing two same-circle sub-arcs whose signed sweeps
  sum to the parent. No chord geometry is ever fabricated.
- The split width fraction is the signed-sweep fraction
  (`signedSweepBeforeDeg ÷ signedSweepDeg`), so tapered widths split on the
  true curve length.
- Endpoint-near projections are rejected (`ENDPOINT_NEAR`).

## Storage + metadata

- Open polyline: the new vertex lands at stored index `courseIndex + 1`.
- Closed polyline: the final course appends last→new→first; a closed ring is
  stored WITHOUT a duplicate closure vertex.
- `vertexLabels`: the inserted vertex ALWAYS stores the empty string `''` —
  an inserted vertex is non-survey, so it never fabricates a station id, a
  survey point, a `metadata.sourcePointIds` entry, or a breakline ref.
  Existing explicit labels shift positionally with their vertices and are
  never renumbered or rewritten. Display falls back to `V{i+1}` for a blank
  slot (see Properties); that token is display-only and is never persisted.
- `segmentGeometry` / `segmentWidths`: the single course entry is replaced by
  two entries (first start→split, second split→end), so the arrays stay
  course-aligned. Absent metadata stays absent (legacy byte-shape preserved).
- Every result re-runs the canonical path normalizer, so all-line
  geometry / all-zero widths canonicalize back to absent.

## Surfaces

- Grip: `polyline-insert` at the course midpoint; drag-release hands the
  cursor to this helper, so release always lands on the original course.
- Properties: `Insert Vertex` per course; the line immediate point is the
  midpoint, the arc immediate point is the true signed-sweep midpoint.
- Command `PLINEINSERTVERTEX`: pick the polyline then the on-course point, or
  type `x,y` / `C<n>` (course midpoint).
