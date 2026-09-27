// Phase 19C Round 2A — curved-parcel TRANSFORMS/COPY/EDIT/TRAVERSE.
//
// Rigid/uniform transforms carry courseGeometry unchanged (sweep preserved,
// radius derived); MIRROR flips signed bulge; GENERAL_AFFINE on a curved
// parcel blocks; COPY mints fresh identity with equivalent geometry; vertex
// insert splits exact sub-arcs; delete merges only compatible curves;
// reverse/rotate generalize to mixed order with ids unchanged.
import { describe, expect, it } from 'vitest';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';
import {
  buildParcelCourseIds,
  deleteParcelCourseVertex,
  insertParcelCourseVertex,
  resolveCadParcelCourses,
  reverseCadParcelCourses,
  rotateParcelCoursesToStart,
} from '../src/engine/cad/cadParcelCourses';
import {
  applyCadSelectionTransform,
} from '../src/engine/cad/cadTransformApply';
import {
  classifyTransform,
  reflectionAboutLine,
  rotationAbout,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import { buildCopiedEntities } from '../src/engine/cad/cadTransactionsClipboardCommands';
import type {
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

let parcelSeq = 0;
const makeParcel = (
  vertices: Array<{ x: number; y: number }>,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => {
  const id = `parcel-19c-t${(parcelSeq += 1)}`;
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Parcel T${parcelSeq}`,
    courseIds: buildParcelCourseIds(id, vertices.length),
    ...(courseGeometry != null ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

const projectWith = (parcel: CadParcelEntity): CadProject =>
  ({ ...createBlankCadProject({ name: 'transform-19c', units: 'm' as const }), entities: [parcel] });

const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

const eastArcSquare = () =>
  makeParcel(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    [line, arc(0.5), line, line],
  );

const arcOf = (parcel: CadParcelEntity, courseIndex: number) => {
  const course = resolveCadParcelCourses(parcel)[courseIndex]!;
  expect(course.kind).toBe('arc');
  if (course.kind !== 'arc') throw new Error('expected arc');
  return course;
};

describe('19C rigid + uniform transforms carry bulge (sweep preserved, radius derived)', () => {
  it('ROTATE 90°: sweep preserved, center rotated, area exact', () => {
    const parcel = eastArcSquare();
    const before = arcOf(parcel, 1);
    const transform = rotationAbout(0, 0, 90);
    const result = transformCadEntityGeometry(parcel, transform, classifyTransform(transform)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.entity;
    expect(moved.type).toBe('parcel');
    if (moved.type !== 'parcel') return;
    expect(moved.courseGeometry).toEqual(parcel.courseGeometry);
    const after = arcOf(moved, 1);
    expect(after.signedSweepDeg).toBeCloseTo(before.signedSweepDeg, 9);
    expect(after.radius).toBeCloseTo(before.radius, 9);
    expect(after.arcLength).toBeCloseTo(before.arcLength, 9);
    // (x,y) -> (−y,x): old center maps exactly.
    expect(after.center.x).toBeCloseTo(-before.center.y, 9);
    expect(after.center.y).toBeCloseTo(before.center.x, 9);
    expect(moved.areaSquareMeters).toBeCloseTo(parcel.areaSquareMeters!, 9);
  });

  it('uniform SCALE ×2: sweep preserved, radius and length scale exactly', () => {
    const parcel = eastArcSquare();
    const before = arcOf(parcel, 1);
    const transform = uniformScaleAbout(0, 0, 2);
    const result = transformCadEntityGeometry(parcel, transform, classifyTransform(transform)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.entity;
    if (moved.type !== 'parcel') return;
    const after = arcOf(moved, 1);
    expect(after.signedSweepDeg).toBeCloseTo(before.signedSweepDeg, 9);
    expect(after.radius).toBeCloseTo(2 * before.radius, 9);
    expect(after.arcLength).toBeCloseTo(2 * before.arcLength, 9);
    expect(moved.areaSquareMeters).toBeCloseTo(4 * parcel.areaSquareMeters!, 9);
  });

  it('MOVE carries courseGeometry by reference-equality of values (translateEntity path)', () => {
    const parcel = eastArcSquare();
    const before = arcOf(parcel, 1);
    const transform = { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: -50 };
    const result = transformCadEntityGeometry(parcel, transform, classifyTransform(transform)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.entity;
    if (moved.type !== 'parcel') return;
    const after = arcOf(moved, 1);
    expect(after.radius).toBeCloseTo(before.radius, 12);
    expect(after.signedSweepDeg).toBeCloseTo(before.signedSweepDeg, 12);
    expect(after.center.x).toBeCloseTo(before.center.x + 100, 9);
    expect(after.center.y).toBeCloseTo(before.center.y - 50, 9);
  });
});

describe('19C MIRROR flips signed bulge, GENERAL_AFFINE blocks on curved parcels', () => {
  it('mirror flips bulge sign (magnitude kept), sweep sign flips, area kept', () => {
    const parcel = eastArcSquare();
    const before = arcOf(parcel, 1);
    const transform = reflectionAboutLine({ x: 0, y: 0 }, { x: 0, y: 1 })!;
    const result = transformCadEntityGeometry(parcel, transform, classifyTransform(transform)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.entity;
    if (moved.type !== 'parcel') return;
    expect(moved.courseGeometry?.[1]).toEqual({ kind: 'arc', bulge: -0.5 });
    const after = arcOf(moved, 1);
    expect(after.signedSweepDeg).toBeCloseTo(-before.signedSweepDeg, 9);
    expect(after.direction).toBe(before.direction === 'left' ? 'right' : 'left');
    expect(after.radius).toBeCloseTo(before.radius, 9);
    expect(moved.areaSquareMeters).toBeCloseTo(parcel.areaSquareMeters!, 9);
  });

  it('non-uniform scale on a curved parcel BLOCKS with an explicit diagnostic', () => {
    const parcel = eastArcSquare();
    const nonUniform = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    expect(classifyTransform(nonUniform)?.kind).toBe('GENERAL_AFFINE');
    const direct = transformCadEntityGeometry(parcel, nonUniform, classifyTransform(nonUniform)!);
    expect(direct.ok).toBe(false);
    if (direct.ok) throw new Error('expected block');
    expect(direct.reason).toMatch(/NON_UNIFORM_CURVED/);
    // The selection-level preflight path (the command route) blocks too.
    const applied = applyCadSelectionTransform(projectWith(parcel), [parcel.id], nonUniform, {
      label: 'STRETCH',
    });
    expect(applied.ok).toBe(false);
  });

  it('non-uniform scale on a straight parcel still applies (no new block)', () => {
    const parcel = makeParcel([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    const nonUniform = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const result = transformCadEntityGeometry(parcel, nonUniform, classifyTransform(nonUniform)!);
    expect(result.ok).toBe(true);
  });
});

describe('19C COPY mints fresh identity with equivalent geometry', () => {
  it('new parcel id + fresh course ids, geometry equivalent, no shared array', () => {
    const parcel = eastArcSquare();
    const project = projectWith(parcel);
    const copies = buildCopiedEntities(project, [parcel], 100, 0);
    expect(copies).toHaveLength(1);
    const copy = copies[0]!;
    expect(copy.type).toBe('parcel');
    if (copy.type !== 'parcel') return;
    expect(copy.id).not.toBe(parcel.id);
    expect(copy.courseIds).toHaveLength(4);
    expect(copy.courseIds!.every((id) => id.startsWith(`parcel-course:${copy.id}:`))).toBe(true);
    expect(copy.courseIds!.some((id) => parcel.courseIds!.includes(id))).toBe(false);
    expect(copy.courseGeometry).toEqual(parcel.courseGeometry);
    expect(copy.courseGeometry).not.toBe(parcel.courseGeometry);
    // Geometry equivalent under translation: same radius/sweep, shifted center.
    const before = arcOf(parcel, 1);
    const after = arcOf(copy, 1);
    expect(after.radius).toBeCloseTo(before.radius, 12);
    expect(after.signedSweepDeg).toBeCloseTo(before.signedSweepDeg, 12);
    expect(after.center.x).toBeCloseTo(before.center.x + 100, 9);
    expect(copy.vertices[0]).toEqual({ x: 100, y: 0 });
  });
});

describe('19C vertex insert splits exact sub-arcs; delete merges compatibly', () => {
  it('insert on-arc: two sub-arcs, sweep/length sums preserved, old id retires', () => {
    const parcel = eastArcSquare();
    const parent = arcOf(parcel, 1);
    const oldId = parent.courseId;
    const split = insertParcelCourseVertex({
      parcel,
      courseIndex: 1,
      point: { ...parent.midpoint },
      label: 'Q',
    });
    expect(split).not.toBeNull();
    const sub0 = arcOf(split!, 1);
    const sub1 = arcOf(split!, 2);
    expect(split!.courseGeometry).toHaveLength(5);
    expect(sub0.signedSweepDeg + sub1.signedSweepDeg).toBeCloseTo(parent.signedSweepDeg, 9);
    expect(sub0.arcLength + sub1.arcLength).toBeCloseTo(parent.arcLength, 9);
    expect(sub0.radius).toBeCloseTo(parent.radius, 9);
    expect(sub1.radius).toBeCloseTo(parent.radius, 9);
    expect(sub0.direction).toBe(parent.direction);
    expect(sub1.direction).toBe(parent.direction);
    expect(split!.courseIds).not.toContain(oldId);
    expect(split!.courseIds).toHaveLength(5);
  });

  it('insert off-arc (chord midpoint) fails closed — never straightened', () => {
    const parcel = eastArcSquare();
    expect(
      insertParcelCourseVertex({ parcel, courseIndex: 1, point: { x: 10, y: 5 } }),
    ).toBeNull();
  });

  it('delete line+line merges to a line with a fresh id', () => {
    const parcel = makeParcel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [line, line, line, line],
    );
    const retired = [parcel.courseIds![0], parcel.courseIds![1]];
    const result = deleteParcelCourseVertex({ parcel, vertexIndex: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parcel.vertices).toHaveLength(3);
    expect(result.parcel.courseIds).toHaveLength(3);
    expect(result.parcel.courseIds!.some((id) => retired.includes(id))).toBe(false);
    expect(result.parcel.courseGeometry).toEqual([line, line, line]);
    expect(resolveCadParcelCourses(result.parcel).every((course) => course.kind === 'line')).toBe(true);
  });

  it('delete arc+arc on one circle merges to the summed sweep', () => {
    // Diamond on the circle center (0,0) r=√50: four CCW 90° arcs.
    const b90 = Math.tan(Math.PI / 8);
    const parcel = makeParcel(
      [
        { x: 5, y: 5 },
        { x: -5, y: 5 },
        { x: -5, y: -5 },
        { x: 5, y: -5 },
      ],
      [arc(b90), arc(b90), arc(b90), arc(b90)],
    );
    const lengths = [0, 1].map((index) => arcOf(parcel, index).arcLength);
    const result = deleteParcelCourseVertex({ parcel, vertexIndex: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parcel.vertices).toHaveLength(3);
    const merged = arcOf(result.parcel, 0);
    expect(merged.signedSweepDeg).toBeCloseTo(180, 9);
    expect(merged.direction).toBe('left');
    expect(merged.arcLength).toBeCloseTo(lengths[0]! + lengths[1]!, 9);
    expect((result.parcel.courseGeometry?.[0] as { bulge: number }).bulge).toBeCloseTo(1, 9);
  });

  it('delete line+arc BLOCKS; mismatched arc+arc BLOCKS; triangle delete BLOCKS', () => {
    const mixed = eastArcSquare();
    const lineArc = deleteParcelCourseVertex({ parcel: mixed, vertexIndex: 1 });
    expect(lineArc.ok).toBe(false);
    if (lineArc.ok) throw new Error('expected block');
    expect(lineArc.reason).toMatch(/MIXED_CURVATURE/);
    // Same square, arcs on different circles (lens pair is elsewhere; here
    // course 1 arcs east while a second arc would arc elsewhere): deleting
    // vertex 2 joins arc course 1 with line course 2 — also mixed.
    const lineArc2 = deleteParcelCourseVertex({ parcel: mixed, vertexIndex: 2 });
    expect(lineArc2.ok).toBe(false);
    // Two arcs, different circles: east-bulge vs north-bulge square.
    const twoArcs = makeParcel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [line, arc(0.5), arc(0.5), line],
    );
    const mismatch = deleteParcelCourseVertex({ parcel: twoArcs, vertexIndex: 2 });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) throw new Error('expected block');
    expect(mismatch.reason).toMatch(/ARC_MISMATCH/);
    const triangle = makeParcel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      [line, line, line],
    );
    const minVerts = deleteParcelCourseVertex({ parcel: triangle, vertexIndex: 1 });
    expect(minVerts.ok).toBe(false);
    if (minVerts.ok) throw new Error('expected block');
    expect(minVerts.reason).toMatch(/MIN_VERTICES/);
  });
});

describe('19C reverse + start-course rotation generalize to mixed order', () => {
  it('reverse swaps endpoints, flips sweep/left-right, chord +180°, ids ride along', () => {
    const parcel = eastArcSquare();
    const forward = resolveCadParcelCourses(parcel);
    const reversed = reverseCadParcelCourses(forward)!;
    expect(reversed).toHaveLength(4);
    expect(reversed.map((course) => course.courseId).sort()).toEqual(
      forward.map((course) => course.courseId).sort(),
    );
    const forwardArc = forward[1]!;
    const reversedArc = reversed.find((course) => course.courseId === forwardArc.courseId)!;
    expect(reversedArc.kind).toBe('arc');
    if (reversedArc.kind !== 'arc' || forwardArc.kind !== 'arc') throw new Error('expected arcs');
    expect(reversedArc.fromVertex).toEqual(forwardArc.toVertex);
    expect(reversedArc.toVertex).toEqual(forwardArc.fromVertex);
    expect(reversedArc.signedSweepDeg).toBeCloseTo(-forwardArc.signedSweepDeg, 9);
    expect(reversedArc.direction).toBe(forwardArc.direction === 'left' ? 'right' : 'left');
    expect(reversedArc.arcLength).toBeCloseTo(forwardArc.arcLength, 12);
    expect(reversedArc.radius).toBeCloseTo(forwardArc.radius, 12);
    const expectedChord = (forwardArc.chordAzimuthDeg + 180) % 360;
    expect(reversedArc.chordAzimuthDeg).toBeCloseTo(expectedChord, 9);
    // Double reverse is the identity (values round-trip).
    const twice = reverseCadParcelCourses(reversed)!;
    const twiceArc = twice.find((course) => course.courseId === forwardArc.courseId)!;
    if (twiceArc.kind !== 'arc') throw new Error('expected arc');
    expect(twiceArc.signedSweepDeg).toBeCloseTo(forwardArc.signedSweepDeg, 9);
    expect(twiceArc.fromVertex).toEqual(forwardArc.fromVertex);
  });

  it('rotation reseats the named course first, ids unchanged, unknown id null', () => {
    const parcel = eastArcSquare();
    const forward = resolveCadParcelCourses(parcel);
    const startId = forward[2]!.courseId;
    const rotated = rotateParcelCoursesToStart(forward, startId)!;
    expect(rotated[0]!.courseId).toBe(startId);
    expect(rotated.map((course) => course.courseId)).toEqual([
      forward[2]!.courseId,
      forward[3]!.courseId,
      forward[0]!.courseId,
      forward[1]!.courseId,
    ]);
    expect(rotateParcelCoursesToStart(forward, 'parcel-course:nope:9')).toBeNull();
  });
});

// Sanity: the single arc authority still derives the semicircle convention
// used across both 19C test files (center on chord, deterministic side).
describe('19C arc authority spot pin', () => {
  it('unit semicircle: center (5,0), radius 5, sweep +180', () => {
    const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)!;
    expect(metrics.center).toEqual({ x: 5, y: 0 });
    expect(metrics.radius).toBeCloseTo(5, 12);
    expect(metrics.signedSweepDeg).toBeCloseTo(180, 12);
  });
});
