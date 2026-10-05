import type { CadWorldPoint } from './cadGeometry';

// Degenerate XY floor reused from the neighboring geometry authority:
// cadGeometry.ts / cadGeometryArcBuilders.ts treat lengths <= 1e-12 as
// degenerate and fail closed (return null). (The zeroDelta helper in
// surfaces/volume/zero.ts is a delta-Z earthwork policy, wrong domain here.)
const CAD_XY_DEGENERATE_FLOOR = 1e-12;

// No existing repo vertex cap was found; 1024 is a local cap for this
// builder so a single polygon drag cannot allocate an unbounded ring.
export const MAX_SHAPE_POLYGON_SIDES = 1024;
export const MIN_SHAPE_POLYGON_SIDES = 3;

export type RegularPolygonMode = 'inscribed' | 'circumscribed';

const isFinitePoint = (point: CadWorldPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

export const buildRectangleVertices = (
  first: CadWorldPoint,
  opposite: CadWorldPoint,
): CadWorldPoint[] | null => {
  if (!isFinitePoint(first) || !isFinitePoint(opposite)) return null;
  const minX = Math.min(first.x, opposite.x);
  const maxX = Math.max(first.x, opposite.x);
  const minY = Math.min(first.y, opposite.y);
  const maxY = Math.max(first.y, opposite.y);
  if (maxX - minX <= CAD_XY_DEGENERATE_FLOOR) return null;
  if (maxY - minY <= CAD_XY_DEGENERATE_FLOOR) return null;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
};

export const buildRegularPolygonVertices = (
  center: CadWorldPoint,
  through: CadWorldPoint,
  sides: number,
  mode: RegularPolygonMode,
): CadWorldPoint[] | null => {
  if (!isFinitePoint(center) || !isFinitePoint(through)) return null;
  if (!Number.isInteger(sides) || sides < MIN_SHAPE_POLYGON_SIDES || sides > MAX_SHAPE_POLYGON_SIDES) {
    return null;
  }
  const dx = through.x - center.x;
  const dy = through.y - center.y;
  const apothemOrRadius = Math.hypot(dx, dy);
  if (!Number.isFinite(apothemOrRadius) || apothemOrRadius <= CAD_XY_DEGENERATE_FLOOR) return null;
  const theta = Math.atan2(dy, dx);
  const step = (2 * Math.PI) / sides;
  const radius =
    mode === 'inscribed' ? apothemOrRadius : apothemOrRadius / Math.cos(Math.PI / sides);
  if (!Number.isFinite(radius) || radius <= CAD_XY_DEGENERATE_FLOOR) return null;
  const startAngle = mode === 'inscribed' ? theta : theta - Math.PI / sides;
  const vertices: CadWorldPoint[] = [];
  for (let k = 0; k < sides; k += 1) {
    const angle = startAngle + k * step;
    vertices.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  // Fail closed on precision-collapsed rings: far-from-origin centers
  // (e.g. 1e12 with a 0.001 radius) round adjacent vertices to the same
  // double, yielding zero-length edges the radius check cannot see.
  // Single O(N) pass over consecutive edges INCLUDING the closing edge.
  let previous = vertices[sides - 1]!;
  for (const vertex of vertices) {
    if (!isFinitePoint(vertex)) return null;
    if (Math.hypot(vertex.x - previous.x, vertex.y - previous.y) <= CAD_XY_DEGENERATE_FLOOR) return null;
    previous = vertex;
  }
  return vertices;
};
