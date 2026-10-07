import { describe, expect, it } from 'vitest';
import {
  parcelBulgeFromArcDefinition,
  describeParcelArcCourse,
} from '../src/engine/cad/cadParcelArcGeometry';
import { cadDistance } from '../src/engine/cad/cadGeometry';
import { resolveCadPolylineCourses } from '../src/engine/cad/cadPolylineCourses';
import {
  deleteCadPolylineVertex,
  insertCadPolylineVertexOnCourse,
} from '../src/engine/cad/cadPolylineTopology';
import type {
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from '../src/engine/cad/cadTypes';

const P = (x: number, y: number) => ({ x, y });
const A = P(0, 0);
const B = P(10, 0);
const C = P(10, 10);

const makePolyline = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => {
  const vertices = overrides.vertices ?? [P(A.x, A.y), P(B.x, B.y), P(C.x, C.y)];
  const base: CadPolylineEntity = {
    id: 'polyline:c3',
    type: 'polyline',
    layerId: 'observation-lines',
    visible: true,
    locked: false,
    vertices,
    vertexLabels: vertices.map(() => ''),
    closed: false,
  };
  return { ...base, ...overrides };
};

const insert = (entity: CadPolylineEntity, courseIndex: number, x: number, y: number) =>
  insertCadPolylineVertexOnCourse(entity, { courseIndex, x, y });

const deleteVertex = (entity: CadPolylineEntity, vertexIndex: number) =>
  deleteCadPolylineVertex(entity, { vertexIndex });

const ptOnCircle = (center: { x: number; y: number }, radius: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) };
};

// ---------------------------------------------------------------------------
// Insert — line
// ---------------------------------------------------------------------------

describe('C3 insert line', () => {
  it('inserts at the exact projection on an open first course', () => {
    const entity = makePolyline({ vertices: [A, C] });
    const result = insert(entity, 0, 2.5, 2.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toEqual([A, P(2.5, 2.5), C]);
    expect(result.entity.vertexLabels).toEqual(['', '', '']);
    expect('segmentGeometry' in result.entity).toBe(false);
    expect(resolveCadPolylineCourses(result.entity)).toHaveLength(2);
  });

  it('clamps a beyond-end pick to the segment endpoint and rejects it', () => {
    const entity = makePolyline({ vertices: [A, C] });
    const result = insert(entity, 0, 999, 999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ENDPOINT_NEAR');
  });

  it('rejects a projection within 1e-9 of either endpoint', () => {
    const entity = makePolyline({ vertices: [A, C] });
    const nearStart = insert(entity, 0, 1e-12, 1e-12);
    expect(nearStart.ok).toBe(false);
    if (!nearStart.ok) expect(nearStart.code).toBe('ENDPOINT_NEAR');
    const clampedEnd = insert(entity, 0, 999, 999);
    expect(clampedEnd.ok).toBe(false);
    if (!clampedEnd.ok) expect(clampedEnd.code).toBe('ENDPOINT_NEAR');
  });

  it('inserts into a middle course and keeps the other courses', () => {
    const entity = makePolyline({
      vertices: [A, B, C],
      vertexLabels: ['A', 'B', 'C'],
    });
    const result = insert(entity, 1, 10, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toEqual([A, B, P(10, 4), C]);
    expect(result.entity.vertexLabels).toEqual(['A', 'B', 'V3', 'C']);
    expect(resolveCadPolylineCourses(result.entity)).toHaveLength(3);
  });

  it('splits the closed final (closing) course by appending the new vertex', () => {
    const entity = makePolyline({
      closed: true,
      vertices: [A, B, P(0, 10)],
      vertexLabels: ['A', 'B', 'C'],
    });
    const result = insert(entity, 2, 0, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.closed).toBe(true);
    expect(result.entity.vertices).toEqual([A, B, P(0, 10), P(0, 5)]);
    // Closed stored ring has no duplicate closure vertex.
    expect(result.entity.vertices[0]).not.toEqual(result.entity.vertices.at(-1));
    expect(resolveCadPolylineCourses(result.entity)).toHaveLength(4);
  });

  it('rejects a non-integer / out-of-range course', () => {
    const entity = makePolyline({ vertices: [A, C] });
    expect(insert(entity, 1.5, 1, 1).ok).toBe(false);
    expect(insert(entity, 4, 1, 1).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Insert — arc
// ---------------------------------------------------------------------------

describe('C3 insert arc', () => {
  it('splits a CCW semicircle into same-circle sub-arcs at the true arc point', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentGeometry: [{ kind: 'arc', bulge: 1 }],
    });
    const metrics = describeParcelArcCourse(A, B, 1)!;
    const result = insert(entity, 0, metrics.midpoint.x, metrics.midpoint.y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toHaveLength(3);
    expect(result.entity.vertices[1]!.y).toBeCloseTo(-5, 9);
    expect(cadDistance(result.entity.vertices[1]!, metrics.center)).toBeCloseTo(metrics.radius, 9);
    const courses = resolveCadPolylineCourses(result.entity)!;
    expect(courses.map((course) => course.kind)).toEqual(['arc', 'arc']);
    for (const course of courses) {
      expect(cadDistance(course.metrics!.center, metrics.center)).toBeLessThan(1e-9);
      expect(course.metrics!.radius).toBeCloseTo(metrics.radius, 9);
    }
    expect(
      courses[0]!.metrics!.signedSweepDeg + courses[1]!.metrics!.signedSweepDeg,
    ).toBeCloseTo(180, 9);
  });

  it('splits a CW arc preserving direction', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentGeometry: [{ kind: 'arc', bulge: -1 }],
    });
    const metrics = describeParcelArcCourse(A, B, -1)!;
    const result = insert(entity, 0, metrics.midpoint.x, metrics.midpoint.y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const courses = resolveCadPolylineCourses(result.entity)!;
    expect(courses.map((course) => course.kind)).toEqual(['arc', 'arc']);
    expect(courses[0]!.metrics!.signedSweepDeg).toBeLessThan(0);
    expect(courses[1]!.metrics!.signedSweepDeg).toBeLessThan(0);
    expect(
      courses[0]!.metrics!.signedSweepDeg + courses[1]!.metrics!.signedSweepDeg,
    ).toBeCloseTo(-180, 9);
  });

  it('splits a major arc asymmetrically with sweeps summing to the parent', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentGeometry: [{ kind: 'arc', bulge: 2 }],
    });
    const metrics = describeParcelArcCourse(A, B, 2)!;
    expect(metrics.deltaDeg).toBeGreaterThan(180);
    const pickAngle = metrics.startAngleDeg + metrics.signedSweepDeg * 0.3;
    const pick = ptOnCircle(metrics.center, metrics.radius, pickAngle);
    const result = insert(entity, 0, pick.x, pick.y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const courses = resolveCadPolylineCourses(result.entity)!;
    expect(courses[0]!.metrics!.signedSweepDeg).toBeCloseTo(metrics.signedSweepDeg * 0.3, 6);
    expect(
      courses[0]!.metrics!.signedSweepDeg + courses[1]!.metrics!.signedSweepDeg,
    ).toBeCloseTo(metrics.signedSweepDeg, 6);
  });

  it('rejects an endpoint pick and an off-sweep pick', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentGeometry: [{ kind: 'arc', bulge: 1 }],
    });
    const nearStart = insert(entity, 0, A.x, A.y);
    expect(nearStart.ok).toBe(false);
    if (!nearStart.ok) expect(nearStart.code).toBe('ENDPOINT_NEAR');
    // (5, 5) is on the opposite (CW) half of the circle, outside the CCW sweep.
    const off = insert(entity, 0, 5, 5);
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.code).toBe('OFF_COURSE');
  });
});

// ---------------------------------------------------------------------------
// Insert — width
// ---------------------------------------------------------------------------

describe('C3 insert width', () => {
  it('splits a constant width into two constant courses', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentWidths: [{ startWidth: 0.5, endWidth: 0.5 }],
    });
    const result = insert(entity, 0, 5, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.segmentWidths).toEqual([
      { startWidth: 0.5, endWidth: 0.5 },
      { startWidth: 0.5, endWidth: 0.5 },
    ]);
  });

  it('interpolates a taper by true length fraction on a line', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentWidths: [{ startWidth: 0, endWidth: 1 }],
    });
    const result = insert(entity, 0, 2, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.segmentWidths).toEqual([
      { startWidth: 0, endWidth: 0.2 },
      { startWidth: 0.2, endWidth: 1 },
    ]);
  });

  it('interpolates a taper by signed sweep fraction on an arc', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentGeometry: [{ kind: 'arc', bulge: 1 }],
      segmentWidths: [{ startWidth: 0, endWidth: 1 }],
    });
    const metrics = describeParcelArcCourse(A, B, 1)!;
    const pick = ptOnCircle(metrics.center, metrics.radius, metrics.startAngleDeg + 45);
    const result = insert(entity, 0, pick.x, pick.y);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.segmentWidths![0]!.endWidth).toBeCloseTo(0.25, 9);
    expect(result.entity.segmentWidths![1]!.startWidth).toBeCloseTo(0.25, 9);
  });

  it('canonicalizes an all-zero split back to absent widths', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentWidths: [{ startWidth: 0, endWidth: 0 }],
    });
    const result = insert(entity, 0, 5, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('segmentWidths' in result.entity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Delete — open
// ---------------------------------------------------------------------------

describe('C3 delete open', () => {
  it('drops the first outgoing and last incoming courses', () => {
    const first = deleteVertex(makePolyline({ vertices: [A, B, C] }), 0);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.entity.vertices).toEqual([B, C]);
    const last = deleteVertex(makePolyline({ vertices: [A, B, C] }), 2);
    expect(last.ok).toBe(true);
    if (last.ok) expect(last.entity.vertices).toEqual([A, B]);
  });

  it('merges an interior line+line join into one straight leg', () => {
    const entity = makePolyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] });
    const result = deleteVertex(entity, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toEqual([A, C]);
    expect(result.entity.vertexLabels).toEqual(['A', 'C']);
    expect('segmentGeometry' in result.entity).toBe(false);
    expect(resolveCadPolylineCourses(result.entity)).toHaveLength(1);
  });

  it('blocks a delete that would drop below 2 open vertices', () => {
    const result = deleteVertex(makePolyline({ vertices: [A, B] }), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MIN_COUNT');
  });

  it('keeps arrays aligned after a delete', () => {
    const entity = makePolyline({
      vertices: [A, B, C],
      segmentGeometry: [{ kind: 'line' }, { kind: 'arc', bulge: 1 }],
      segmentWidths: [{ startWidth: 0.1, endWidth: 0.2 }, { startWidth: 0.3, endWidth: 0.4 }],
    });
    // Dropping the first (line) course leaves the arc course and its width.
    const result = deleteVertex(entity, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toHaveLength(2);
    expect(result.entity.vertexLabels).toHaveLength(2);
    expect(result.entity.segmentWidths).toHaveLength(1);
    expect(result.entity.segmentGeometry).toEqual([{ kind: 'arc', bulge: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Delete — closed
// ---------------------------------------------------------------------------

describe('C3 delete closed', () => {
  const square = () =>
    makePolyline({
      closed: true,
      vertices: [A, B, P(10, 10), P(0, 10)],
      vertexLabels: ['A', 'B', 'C', 'D'],
      segmentWidths: [
        { startWidth: 1, endWidth: 1 },
        { startWidth: 2, endWidth: 2 },
        { startWidth: 3, endWidth: 3 },
        { startWidth: 4, endWidth: 4 },
      ],
    });

  it('merges an interior pair and rotates course ownership', () => {
    const result = deleteVertex(square(), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toEqual([A, P(10, 10), P(0, 10)]);
    expect(result.entity.vertices[0]).not.toEqual(result.entity.vertices.at(-1));
    expect(resolveCadPolylineCourses(result.entity)).toHaveLength(3);
    expect(result.entity.segmentWidths).toEqual([
      { startWidth: 1, endWidth: 2 },
      { startWidth: 3, endWidth: 3 },
      { startWidth: 4, endWidth: 4 },
    ]);
  });

  it('deletes vertex 0 by rotating/reindexing with no duplicate closure vertex', () => {
    const result = deleteVertex(square(), 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toEqual([B, P(10, 10), P(0, 10)]);
    expect(result.entity.vertices[0]).not.toEqual(result.entity.vertices.at(-1));
    // Closing course D -> B owns the incoming width 4 at D and outgoing 1 at B.
    expect(result.entity.segmentWidths).toEqual([
      { startWidth: 2, endWidth: 2 },
      { startWidth: 3, endWidth: 3 },
      { startWidth: 4, endWidth: 1 },
    ]);
    const courses = resolveCadPolylineCourses(result.entity)!;
    expect(courses[2]!.from).toEqual(P(0, 10));
    expect(courses[2]!.to).toEqual(B);
  });

  it('blocks a delete below 3 closed vertices', () => {
    const triangle = makePolyline({
      closed: true,
      vertices: [A, B, P(0, 10)],
      vertexLabels: ['A', 'B', 'C'],
    });
    const result = deleteVertex(triangle, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MIN_COUNT');
  });
});

// ---------------------------------------------------------------------------
// Delete — arc merge policy
// ---------------------------------------------------------------------------

describe('C3 delete arc merge', () => {
  const circlePoint = (deg: number) => ptOnCircle(P(0, 0), 10, deg);
  const quarterBulge = parcelBulgeFromArcDefinition({
    from: circlePoint(0),
    to: circlePoint(90),
    center: P(0, 0),
    radius: 10,
    signedSweepDeg: 90,
  })!;

  it('merges same-circle same-direction arcs into one summed bulge', () => {
    const entity = makePolyline({
      vertices: [circlePoint(0), circlePoint(90), circlePoint(180)],
      segmentGeometry: [
        { kind: 'arc', bulge: quarterBulge },
        { kind: 'arc', bulge: quarterBulge },
      ],
    });
    const result = deleteVertex(entity, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toEqual([circlePoint(0), circlePoint(180)]);
    expect(result.entity.segmentGeometry).toHaveLength(1);
    expect(result.entity.segmentGeometry![0]!.kind).toBe('arc');
    if (result.entity.segmentGeometry![0]!.kind === 'arc') {
      expect(result.entity.segmentGeometry![0]!.bulge).toBeCloseTo(1, 9);
    }
  });

  it('blocks opposite-direction same-circle arcs', () => {
    const entity = makePolyline({
      vertices: [circlePoint(0), circlePoint(90), circlePoint(0)],
      segmentGeometry: [
        { kind: 'arc', bulge: quarterBulge },
        { kind: 'arc', bulge: -quarterBulge },
      ],
    });
    const result = deleteVertex(entity, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INCOMPATIBLE_MERGE');
  });

  it('blocks different-circle arcs', () => {
    const entity = makePolyline({
      vertices: [circlePoint(0), circlePoint(90), circlePoint(270)],
      segmentGeometry: [
        { kind: 'arc', bulge: quarterBulge },
        { kind: 'arc', bulge: quarterBulge },
      ],
    });
    const result = deleteVertex(entity, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INCOMPATIBLE_MERGE');
  });

  it('blocks line+arc and arc+line joins (never straightens)', () => {
    const lineArc = makePolyline({
      vertices: [A, B, C],
      segmentGeometry: [{ kind: 'line' }, { kind: 'arc', bulge: 1 }],
    });
    const lineFirst = deleteVertex(lineArc, 1);
    expect(lineFirst.ok).toBe(false);
    if (!lineFirst.ok) expect(lineFirst.code).toBe('INCOMPATIBLE_MERGE');
    const arcLine = makePolyline({
      vertices: [A, B, C],
      segmentGeometry: [{ kind: 'arc', bulge: 1 }, { kind: 'line' }],
    });
    const arcFirst = deleteVertex(arcLine, 1);
    expect(arcFirst.ok).toBe(false);
    if (!arcFirst.ok) expect(arcFirst.code).toBe('INCOMPATIBLE_MERGE');
  });

  it('blocks a merge whose summed sweep reaches the full-circle cap', () => {
    const A0 = circlePoint(0);
    const M = circlePoint(200);
    const B0 = circlePoint(40);
    const major200 = (from: { x: number; y: number }, to: { x: number; y: number }) =>
      parcelBulgeFromArcDefinition({
        from,
        to,
        center: P(0, 0),
        radius: 10,
        signedSweepDeg: 200,
      })!;
    const entity = makePolyline({
      vertices: [A0, M, B0],
      segmentGeometry: [
        { kind: 'arc', bulge: major200(A0, M) },
        { kind: 'arc', bulge: major200(M, B0) },
      ],
    });
    const result = deleteVertex(entity, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INCOMPATIBLE_MERGE');
  });
});

// ---------------------------------------------------------------------------
// Delete — width
// ---------------------------------------------------------------------------

describe('C3 delete width', () => {
  const widths: CadPolylineSegmentWidth[] = [
    { startWidth: 0.1, endWidth: 0.2 },
    { startWidth: 0.3, endWidth: 0.4 },
  ];

  it('takes the incoming start and outgoing end across a merge', () => {
    const result = deleteVertex(makePolyline({ vertices: [A, B, C], segmentWidths: widths }), 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entity.segmentWidths).toEqual([{ startWidth: 0.1, endWidth: 0.4 }]);
  });

  it('drops the adjacent course on an endpoint delete', () => {
    const result = deleteVertex(makePolyline({ vertices: [A, B, C], segmentWidths: widths }), 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entity.segmentWidths).toEqual([{ startWidth: 0.3, endWidth: 0.4 }]);
  });

  it('canonicalizes an all-zero merge back to absent widths', () => {
    const result = deleteVertex(
      makePolyline({
        vertices: [A, B, C],
        segmentWidths: [
          { startWidth: 0, endWidth: 0 },
          { startWidth: 0, endWidth: 0 },
        ],
      }),
      1,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect('segmentWidths' in result.entity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Atomicity / malformed input
// ---------------------------------------------------------------------------

describe('C3 pure atomicity', () => {
  it('fails closed on malformed metadata without mutating the input', () => {
    const geometry: CadPolylineSegmentGeometry[] = [{ kind: 'arc', bulge: 1 }];
    const entity = makePolyline({ vertices: [A, B, C], segmentGeometry: geometry });
    const snapshot = JSON.stringify(entity);
    const result = insert(entity, 0, 5, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_ENTITY');
    expect(JSON.stringify(entity)).toBe(snapshot);
  });

  it('fails closed on a sub-floor arc bulge', () => {
    const entity = makePolyline({
      vertices: [A, B],
      segmentGeometry: [{ kind: 'arc', bulge: 1e-15 }],
    });
    const result = insert(entity, 0, 5, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_ENTITY');
  });

  it('does not mutate the input entity on a valid edit', () => {
    const entity = makePolyline({ vertices: [A, C] });
    const snapshot = JSON.stringify(entity);
    expect(insert(entity, 0, 2.5, 2.5).ok).toBe(true);
    expect(JSON.stringify(entity)).toBe(snapshot);
  });
});
