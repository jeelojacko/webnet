import { cadDistance, type CadWorldPoint } from './cadGeometry';
import {
  buildCadInverseSummary,
  formatCadNorthAzimuthDms,
} from './cadCogoMath';
import { normalizeParcelVertexLabel } from './cadCogoParcelGeometryPrimitives';
import {
  describeParcelArcCourse,
  parcelCourseCanonicalKind,
  validateParcelCourseGeometry,
} from './cadParcelArcGeometry';
import type {
  CadParcelClosureSummary,
  CadParcelReportSummary,
} from './cadCogoParcelGeometryTypes';
import type { CadParcelCourseGeometry } from './cadTypes';

const sanitizeAdjacentDuplicateVertices = (
  vertices: readonly CadWorldPoint[],
): CadWorldPoint[] =>
  vertices.filter((vertex, index, list) => {
    const previous = list[index - 1];
    if (!previous) return true;
    return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
  });

const buildParcelRing = (vertices: readonly CadWorldPoint[]): CadWorldPoint[] | null => {
  const sanitizedVertices = sanitizeAdjacentDuplicateVertices(vertices);
  if (sanitizedVertices.length < 3) return null;

  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const isExplicitlyClosed =
    Math.abs(firstVertex.x - lastVertex.x) <= 1e-9 &&
    Math.abs(firstVertex.y - lastVertex.y) <= 1e-9;
  const ring = isExplicitlyClosed ? sanitizedVertices.slice(0, -1) : sanitizedVertices;
  return ring.length >= 3 ? ring : null;
};

const calculateParcelCentroid = (
  ring: readonly CadWorldPoint[],
  signedDoubleArea: number,
  centroidXAccumulator: number,
  centroidYAccumulator: number,
): CadWorldPoint => {
  if (Math.abs(signedDoubleArea) <= 1e-9) {
    const average = ring.reduce(
      (accumulator, vertex) => ({
        x: accumulator.x + vertex.x,
        y: accumulator.y + vertex.y,
      }),
      { x: 0, y: 0 },
    );
    return {
      x: average.x / ring.length,
      y: average.y / ring.length,
    };
  }

  return {
    x: centroidXAccumulator / (3 * signedDoubleArea),
    y: centroidYAccumulator / (3 * signedDoubleArea),
  };
};

/**
 * Neumaier-compensated accumulator (same pattern as the volume/elevation
 * integrators): keeps shoelace + segment sums exact at large coordinates
 * when combined with local conditioning below.
 */
const createCompensatedSum = (): { add: (_amount: number) => void; total: () => number } => {
  let sum = 0;
  let compensation = 0;
  return {
    add: (value: number) => {
      const next = sum + value;
      compensation +=
        Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
      sum = next;
    },
    total: () => sum + compensation,
  };
};

interface CurvedRingCourse {
  from: CadWorldPoint;
  to: CadWorldPoint;
  rawIndex: number;
}

/** Ring with raw vertex indices (geometry entries address raw indices). */
const buildIndexedParcelRing = (vertices: readonly CadWorldPoint[]): CurvedRingCourse[] | null => {
  const ring: CadWorldPoint[] = [];
  const rawIndex: number[] = [];
  vertices.forEach((vertex, index) => {
    const previous = ring[ring.length - 1];
    if (previous && Math.abs(vertex.x - previous.x) <= 1e-9 && Math.abs(vertex.y - previous.y) <= 1e-9) {
      return;
    }
    ring.push(vertex);
    rawIndex.push(index);
  });
  if (ring.length < 3) return null;
  let length = ring.length;
  if (length > 3) {
    const first = ring[0]!;
    const last = ring[length - 1]!;
    if (Math.abs(first.x - last.x) <= 1e-9 && Math.abs(first.y - last.y) <= 1e-9) {
      length -= 1;
    }
  }
  if (length < 3) return null;
  const courses: CurvedRingCourse[] = [];
  for (let position = 0; position < length; position += 1) {
    courses.push({
      from: ring[position]!,
      to: ring[(position + 1) % length]!,
      rawIndex: rawIndex[position]!,
    });
  }
  return courses;
};

/**
 * Exact curved closure, or 'legacy' when the geometry carries no true arc
 * (caller runs the bit-identical straight path), or null when invalid.
 */
const buildCurvedParcelClosureSummary = ({
  vertices,
  courseGeometry,
  firstVertex,
  lastVertex,
}: {
  vertices: readonly CadWorldPoint[];
  courseGeometry: readonly CadParcelCourseGeometry[];
  firstVertex: CadWorldPoint;
  lastVertex: CadWorldPoint;
}): CadParcelClosureSummary | 'legacy' | null => {
  if (!validateParcelCourseGeometry(vertices, courseGeometry).ok) return null;
  const courses = buildIndexedParcelRing(vertices);
  if (!courses) return null;
  const arcMetrics = courses.map((course) => {
    const entry = courseGeometry[course.rawIndex];
    if (parcelCourseCanonicalKind(entry) !== 'arc' || entry?.kind !== 'arc') return null;
    return describeParcelArcCourse(course.from, course.to, entry.bulge);
  });
  if (arcMetrics.every((metrics) => metrics == null)) return 'legacy';
  if (arcMetrics.some((metrics, position) => {
    const entry = courseGeometry[courses[position]!.rawIndex];
    return parcelCourseCanonicalKind(entry) === 'arc' && metrics == null;
  })) {
    return null;
  }
  // Local conditioning: shoelace crosses on ring-local coordinates so
  // large-coordinate parcels match translated-local results.
  const originX = courses[0]!.from.x;
  const originY = courses[0]!.from.y;
  const doubleArea = createCompensatedSum();
  let perimeterMeters = 0;
  let chordDoubleArea = 0;
  let centroidXAccumulator = 0;
  let centroidYAccumulator = 0;
  courses.forEach((course, position) => {
    const metrics = arcMetrics[position];
    const ax = course.from.x - originX;
    const ay = course.from.y - originY;
    const bx = course.to.x - originX;
    const by = course.to.y - originY;
    const cross = course.from.x * course.to.y - course.to.x * course.from.y;
    chordDoubleArea += cross;
    centroidXAccumulator += (course.from.x + course.to.x) * cross;
    centroidYAccumulator += (course.from.y + course.to.y) * cross;
    doubleArea.add(ax * by - bx * ay);
    if (!metrics) {
      perimeterMeters += cadDistance(course.from, course.to);
      return;
    }
    const sweepRad = (metrics.signedSweepDeg * Math.PI) / 180;
    // Traversal-signed circular segment; 2x (double-area units).
    doubleArea.add(metrics.radius * metrics.radius * (sweepRad - Math.sin(sweepRad)));
    perimeterMeters += metrics.arcLength;
  });
  const signedDoubleArea = doubleArea.total();
  const areaSquareMeters = Math.abs(signedDoubleArea) / 2;
  const closureDeltaX = firstVertex.x - lastVertex.x;
  const closureDeltaY = firstVertex.y - lastVertex.y;
  const closureDistanceMeters = Math.hypot(closureDeltaX, closureDeltaY);
  // Centroid stays the chord-polygon centroid (display anchor, documented
  // approximation for curved parcels — not the exact area centroid). A
  // zero-area chord polygon (e.g. collinear diameter + arc) falls back
  // to the vertex average instead of dividing noise by segment area.
  const ringPoints = courses.map((course) => course.from);
  const centroid =
    Math.abs(chordDoubleArea) <= 1e-9
      ? {
          x: ringPoints.reduce((sum, point) => sum + point.x, 0) / ringPoints.length,
          y: ringPoints.reduce((sum, point) => sum + point.y, 0) / ringPoints.length,
        }
      : calculateParcelCentroid(ringPoints, chordDoubleArea, centroidXAccumulator, centroidYAccumulator);
  return {
    areaSquareMeters,
    perimeterMeters,
    closureDeltaX,
    closureDeltaY,
    closureDistanceMeters,
    centroid,
  };
};

export const cadBuildParcelClosureSummary = (
  vertices: readonly CadWorldPoint[],
  options?: { courseGeometry?: readonly CadParcelCourseGeometry[] },
): CadParcelClosureSummary | null => {
  const sanitizedVertices = sanitizeAdjacentDuplicateVertices(vertices);
  if (sanitizedVertices.length < 3) return null;

  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const ring = buildParcelRing(sanitizedVertices);
  if (!ring) return null;

  // Phase 19C: curved path (only when a valid geometry carries ≥1 true
  // arc). Exact area = shoelace chord-polygon term + traversal-signed
  // circular-segment contributions (0.5·R²·(sweep−sin sweep) per arc);
  // perimeter = chord lengths + |arc lengths|. Ring vertices condition
  // the shoelace sum to a local origin so E~2e6/N~7e6 parcels match
  // translated-local results; invalid geometry fails closed (null).
  const courseGeometry = options?.courseGeometry;
  if (courseGeometry != null) {
    const curved = buildCurvedParcelClosureSummary({
      vertices,
      courseGeometry,
      firstVertex,
      lastVertex,
    });
    // 'legacy' = valid geometry, no true arcs: fall through to the
    // bit-identical straight path below. null = invalid: fail closed.
    if (curved == null) return null;
    if (curved !== 'legacy') return curved;
  }

  let signedDoubleArea = 0;
  let centroidXAccumulator = 0;
  let centroidYAccumulator = 0;
  let perimeterMeters = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    const cross = current.x * next.y - next.x * current.y;
    signedDoubleArea += cross;
    centroidXAccumulator += (current.x + next.x) * cross;
    centroidYAccumulator += (current.y + next.y) * cross;
    perimeterMeters += cadDistance(current, next);
  }

  const areaSquareMeters = Math.abs(signedDoubleArea) / 2;
  const closureDeltaX = firstVertex.x - lastVertex.x;
  const closureDeltaY = firstVertex.y - lastVertex.y;
  const closureDistanceMeters = Math.hypot(closureDeltaX, closureDeltaY);
  const centroid = calculateParcelCentroid(
    ring,
    signedDoubleArea,
    centroidXAccumulator,
    centroidYAccumulator,
  );

  return {
    areaSquareMeters,
    perimeterMeters,
    closureDeltaX,
    closureDeltaY,
    closureDistanceMeters,
    centroid,
  };
};

const buildParcelReportRingLabels = ({
  isExplicitlyClosed,
  vertexLabels,
  vertices,
}: {
  isExplicitlyClosed: boolean;
  vertexLabels: readonly string[];
  vertices: readonly CadWorldPoint[];
}): string[] => {
  const sanitizedLabels = vertexLabels.filter((label, index, list) => {
    const previous = list[index - 1];
    if (previous == null) return true;
    const previousVertex = vertices[index - 1];
    const currentVertex = vertices[index];
    if (!previousVertex || !currentVertex) return true;
    return (
      Math.abs(previousVertex.x - currentVertex.x) > 1e-9 ||
      Math.abs(previousVertex.y - currentVertex.y) > 1e-9
    );
  });

  return isExplicitlyClosed &&
    sanitizedLabels.length > 1 &&
    sanitizedLabels[0] === sanitizedLabels[sanitizedLabels.length - 1]
    ? sanitizedLabels.slice(0, -1)
    : sanitizedLabels;
};

export const cadBuildParcelReportSummary = ({
  parcelName,
  vertices,
  vertexLabels,
  courseGeometry,
}: {
  parcelName: string;
  vertices: readonly CadWorldPoint[];
  vertexLabels: readonly string[];
  courseGeometry?: readonly CadParcelCourseGeometry[];
}): CadParcelReportSummary | null => {
  const closureSummary = cadBuildParcelClosureSummary(vertices, { courseGeometry });
  if (!closureSummary) return null;

  const sanitizedVertices = sanitizeAdjacentDuplicateVertices(vertices);
  const firstVertex = sanitizedVertices[0]!;
  const lastVertex = sanitizedVertices[sanitizedVertices.length - 1]!;
  const isExplicitlyClosed =
    Math.abs(firstVertex.x - lastVertex.x) <= 1e-9 &&
    Math.abs(firstVertex.y - lastVertex.y) <= 1e-9;
  const ring = isExplicitlyClosed ? sanitizedVertices.slice(0, -1) : sanitizedVertices;
  if (ring.length < 3) return null;

  const ringLabels = buildParcelReportRingLabels({
    isExplicitlyClosed,
    vertexLabels,
    vertices,
  });

  const courses = ring.map((vertex, index) => {
    const nextVertex = ring[(index + 1) % ring.length]!;
    const inverse = buildCadInverseSummary(vertex, nextVertex);
    const fromLabel = normalizeParcelVertexLabel(ringLabels[index], index);
    const toLabel = normalizeParcelVertexLabel(
      ringLabels[(index + 1) % ring.length],
      (index + 1) % ring.length,
    );
    return {
      fromLabel,
      toLabel,
      azimuthDeg: inverse.azimuthDeg,
      azimuthText: formatCadNorthAzimuthDms(inverse.azimuthDeg),
      bearing: inverse.bearing,
      distanceMeters: inverse.distance,
    };
  });

  return {
    parcelName,
    ...closureSummary,
    courseCount: courses.length,
    courses,
  };
};
