/**
 * Phase C1 — shared closed/open polyline vertex law.
 *
 * One canonical sanitizer for PLINE creation and the interactive session
 * gate: adjacent 1e-9 dedupe, then (closed only) strip a redundant final
 * vertex that repeats the first. A closed ring is persisted WITHOUT the
 * duplicate closure vertex; consumers wrap last→first through this law.
 * The tolerance mirrors the legacy PLINE/TRAVERSE adjacent-dedupe floor.
 */

export const CAD_POLYLINE_DEDUPE_EPSILON = 1e-9;

export const cadPolylinePointsMatch = (
  first: { x: number; y: number },
  second: { x: number; y: number },
): boolean =>
  Math.abs(first.x - second.x) <= CAD_POLYLINE_DEDUPE_EPSILON &&
  Math.abs(first.y - second.y) <= CAD_POLYLINE_DEDUPE_EPSILON;

/**
 * True when a closed ring's stored vertices still need the last→first edge
 * synthesized. False for a legacy closed ring that already repeats its first
 * vertex (e.g. TRAVERSE), so its stored N-1 edges are never doubled.
 */
export const cadPolylineVerticesWrapToFirst = (
  vertices: readonly { x: number; y: number }[],
  closed: boolean,
): boolean =>
  closed &&
  vertices.length >= 2 &&
  !cadPolylinePointsMatch(vertices[0]!, vertices[vertices.length - 1]!);

/**
 * Canonical retained vertices. Generic in the vertex type so labels ride
 * along unchanged (no schema change, no reordering). Open rings keep every
 * distinct adjacent vertex; closed rings also drop a redundant repeated
 * final vertex.
 */
/**
 * Distinct positions under the 1e-9 equality law (closed-only gate).
 * Counts unique positions by first-seen representative; nonadjacent
 * repeats do not inflate the count. Open polylines never use this gate.
 */
export const countDistinctPlinePositions = (
  vertices: readonly { x: number; y: number }[],
): number => {
  const representatives: { x: number; y: number }[] = [];
  for (const vertex of vertices) {
    if (!representatives.some((seen) => cadPolylinePointsMatch(vertex, seen))) {
      representatives.push(vertex);
    }
  }
  return representatives.length;
};

export const sanitizeCadPolylineVertices = <Vertex extends { x: number; y: number }>(
  vertices: readonly Vertex[],
  closed: boolean,
): Vertex[] => {
  const deduped = vertices.filter((vertex, index) => {
    const previous = vertices[index - 1];
    if (!previous) return true;
    return !cadPolylinePointsMatch(vertex, previous);
  });
  if (
    closed &&
    deduped.length >= 2 &&
    cadPolylinePointsMatch(deduped[0]!, deduped[deduped.length - 1]!)
  ) {
    return deduped.slice(0, -1);
  }
  return deduped;
};
