// Phase 19C Round 1 — mixed line/arc parcel engine core oracles.
import { describe, expect, it } from 'vitest';
import { buildCadInverseSummary } from '../src/engine/cad/cadCogoMath';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  checkParcelCourseTangency,
  describeParcelArcCourse,
  parcelBulgeFromArcDefinition,
  validateParcelBoundaryTopology,
  validateParcelCourseGeometry,
} from '../src/engine/cad/cadParcelArcGeometry';
import {
  buildParcelCourseIds,
  insertParcelCourseVertex,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import { buildParcelCourseReportSummary } from '../src/engine/cad/cadParcelCourses';
import { buildCadBounds } from '../src/engine/cad/cadProjectState';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import {
  parcelHasCurvedCourses,
  resolveCadParcelCourses as resolveSurveyCourses,
} from '../src/engine/cad/cadSurveyExportTables';
import { buildCadParcelLegalDescription } from '../src/engine/cad/cadParcelLegalDescription';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type {
  CadParcelCourseGeometry,
  CadParcelEntity,
} from '../src/engine/cad/cadTypes';

let parcelSeq = 0;
const makeParcel = (
  vertices: Array<{ x: number; y: number }>,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => {
  const id = `parcel-19c-${(parcelSeq += 1)}`;
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Parcel ${parcelSeq}`,
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

const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

describe('19C legacy parcels resolve byte-identical', () => {
  it('rectangle 100x50: area 5000, perimeter 300, course strings', () => {
    const parcel = makeParcel([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
    const closure = cadBuildParcelClosureSummary(parcel.vertices)!;
    expect(closure.areaSquareMeters).toBe(5000);
    expect(closure.perimeterMeters).toBe(300);
    expect(closure.closureDistanceMeters).toBe(50);
    const courses = resolveCadParcelCourses(parcel);
    expect(courses).toHaveLength(4);
    expect(courses.every((course) => course.kind === 'line')).toBe(true);
    expect(courses.map((course) => (course.kind === 'line' ? course.distanceMeters : -1))).toEqual([
      100, 50, 100, 50,
    ]);
    expect(courses.map((course) => (course.kind === 'line' ? course.bearing : ''))).toEqual([
      'N90-00-00.00E',
      'N00-00-00.00E',
      'S90-00-00.00W',
      'S00-00-00.00E',
    ]);
    expect(courses.map((course) => course.courseId)).toEqual([
      `parcel-course:${parcel.id}:0`,
      `parcel-course:${parcel.id}:1`,
      `parcel-course:${parcel.id}:2`,
      `parcel-course:${parcel.id}:3`,
    ]);
    // Geometry kind never affects identity: same endpoints + line geometry
    // keep the exact same ids and values.
    const withGeometry: CadParcelEntity = {
      ...parcel,
      courseGeometry: [line, line, line, line],
    };
    const lineCourses = resolveCadParcelCourses(withGeometry);
    expect(lineCourses.map((course) => course.courseId)).toEqual(
      courses.map((course) => course.courseId),
    );
    expect(JSON.stringify(lineCourses)).toBe(JSON.stringify(courses));
  });
});

describe('19C semicircle oracle', () => {
  // Diameter (0,0)->(10,0)->(20,0) + R10 arc (20,0)->(0,0), b=+1 (CCW):
  // starts heading north, center-left, northern semicircle.
  const semicircle = () =>
    makeParcel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      [line, line, arc(1)],
    );

  it('area 50pi, perimeter 20+10pi, arc pins', () => {
    const parcel = semicircle();
    const closure = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    })!;
    expect(closure.areaSquareMeters).toBeCloseTo(50 * Math.PI, 9);
    expect(closure.perimeterMeters).toBeCloseTo(20 + 10 * Math.PI, 9);
    const courses = resolveCadParcelCourses(parcel);
    expect(courses).toHaveLength(3);
    const arcCourse = courses[2]!;
    expect(arcCourse.kind).toBe('arc');
    if (arcCourse.kind !== 'arc') throw new Error('expected arc');
    expect(arcCourse.center).toEqual({ x: 10, y: 0 });
    expect(arcCourse.radius).toBeCloseTo(10, 12);
    expect(arcCourse.signedSweepDeg).toBeCloseTo(180, 12);
    expect(arcCourse.deltaDeg).toBeCloseTo(180, 12);
    expect(arcCourse.direction).toBe('left');
    expect(arcCourse.arcLength).toBeCloseTo(10 * Math.PI, 9);
    expect(arcCourse.chordLength).toBe(20);
    expect(arcCourse.chordBearing).toBe(buildCadInverseSummary({ x: 20, y: 0 }, { x: 0, y: 0 }).bearing);
    // TRUE curve midpoint (north of the diameter), never chord (10,0).
    expect(arcCourse.midpoint.x).toBeCloseTo(10, 12);
    expect(arcCourse.midpoint.y).toBeCloseTo(10, 9);
    expect(arcCourse.courseId).toBe(`parcel-course:${parcel.id}:2`);
  });
});

describe('19C quarter-sector and 270-degree major-arc oracles', () => {
  const sectorVertices = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  it('minor 90-degree arc: quarter-circle area, center/radius/delta, bounds', () => {
    const parcel = makeParcel(sectorVertices, [line, arc(Math.tan(Math.PI / 8)), line]);
    const closure = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    })!;
    expect(closure.areaSquareMeters).toBeCloseTo(25 * Math.PI, 9);
    expect(closure.perimeterMeters).toBeCloseTo(20 + 5 * Math.PI, 9);
    const arcCourse = resolveCadParcelCourses(parcel)[1]!;
    expect(arcCourse.kind).toBe('arc');
    if (arcCourse.kind !== 'arc') throw new Error('expected arc');
    expect(arcCourse.center.x).toBeCloseTo(0, 9);
    expect(arcCourse.center.y).toBeCloseTo(0, 9);
    expect(arcCourse.radius).toBeCloseTo(10, 9);
    expect(arcCourse.deltaDeg).toBeCloseTo(90, 9);
    expect(arcCourse.direction).toBe('left');
    expect(arcCourse.midpoint.x).toBeCloseTo(10 / Math.SQRT2, 9);
    expect(arcCourse.midpoint.y).toBeCloseTo(10 / Math.SQRT2, 9);
    const bounds = buildCadBounds([parcel])!;
    expect(bounds.minX).toBeCloseTo(0, 9);
    expect(bounds.minY).toBeCloseTo(0, 9);
    expect(bounds.maxX).toBeCloseTo(10, 9);
    expect(bounds.maxY).toBeCloseTo(10, 9);
  });

  it('major 270-degree arc: no minor collapse, sector area, extrema bounds', () => {
    const parcel = makeParcel(sectorVertices, [line, arc(-Math.tan((3 * Math.PI) / 8)), line]);
    const closure = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    })!;
    // Chord triangle (50) + major segment (75pi + 50 - 100)... exactly 75pi.
    expect(closure.areaSquareMeters).toBeCloseTo(75 * Math.PI, 8);
    expect(closure.perimeterMeters).toBeCloseTo(20 + 15 * Math.PI, 8);
    const arcCourse = resolveCadParcelCourses(parcel)[1]!;
    expect(arcCourse.kind).toBe('arc');
    if (arcCourse.kind !== 'arc') throw new Error('expected arc');
    expect(arcCourse.deltaDeg).toBeCloseTo(270, 9);
    expect(arcCourse.signedSweepDeg).toBeCloseTo(-270, 9);
    expect(arcCourse.direction).toBe('right');
    expect(arcCourse.radius).toBeCloseTo(10, 8);
    expect(arcCourse.midpoint.x).toBeCloseTo(-10 / Math.SQRT2, 8);
    expect(arcCourse.midpoint.y).toBeCloseTo(-10 / Math.SQRT2, 8);
    // Sweep passes 180 and 270: extrema (-10,0) and (0,-10) extend bounds.
    const bounds = buildCadBounds([parcel])!;
    expect(bounds.minX).toBeCloseTo(-10, 8);
    expect(bounds.minY).toBeCloseTo(-10, 8);
    expect(bounds.maxX).toBeCloseTo(10, 8);
    expect(bounds.maxY).toBeCloseTo(10, 8);
    // Spatial query over the western extremum hits the curved parcel.
    const project = { ...createBlankCadProject({ name: 'bounds-19c', units: 'm' as const }), entities: [parcel] };
    expect(
      entityIntersectsBounds(project, parcel, { minX: -11, minY: -1, maxX: -9, maxY: 1 }),
    ).toBe(true);
    expect(
      entityIntersectsBounds(project, parcel, { minX: 50, minY: 50, maxX: 60, maxY: 60 }),
    ).toBe(false);
  });
});

describe('19C mixed line/arc parcels, orientation, and reversal', () => {
  // CCW square with both arcs dipping inside (lens): area < 100, perim > 40.
  const lensVertices = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const lensGeometry: CadParcelCourseGeometry[] = [line, arc(-0.5), line, arc(-0.5)];
  const lens = () => makeParcel(lensVertices, lensGeometry);

  it('mixed courses: positive area, chord truth, arc sign follows traversal', () => {
    const parcel = lens();
    const closure = cadBuildParcelClosureSummary(parcel.vertices, {
      courseGeometry: parcel.courseGeometry,
    })!;
    expect(closure.areaSquareMeters).toBeGreaterThan(0);
    expect(closure.areaSquareMeters).toBeLessThan(100);
    const arcLength = 6.25 * (4 * Math.atan(0.5));
    expect(closure.perimeterMeters).toBeCloseTo(20 + 2 * arcLength, 9);
    const courses = resolveCadParcelCourses(parcel);
    expect(courses.map((course) => course.kind)).toEqual(['line', 'arc', 'line', 'arc']);
    for (const course of courses) {
      if (course.kind !== 'arc') continue;
      expect(course.direction).toBe('right');
      expect(course.signedSweepDeg).toBeLessThan(0);
      expect(course.radius).toBeCloseTo(6.25, 9);
    }
  });

  it('reverse traversal: equal magnitude/perimeter, left-right flip, chord reversed', () => {
    const forward = lens();
    const forwardClosure = cadBuildParcelClosureSummary(forward.vertices, {
      courseGeometry: forward.courseGeometry,
    })!;
    // Reversed ring: courses run backward with negated bulges.
    const reversed = makeParcel(
      [lensVertices[0]!, lensVertices[3]!, lensVertices[2]!, lensVertices[1]!],
      [arc(0.5), line, arc(0.5), line],
    );
    const reversedClosure = cadBuildParcelClosureSummary(reversed.vertices, {
      courseGeometry: reversed.courseGeometry,
    })!;
    expect(reversedClosure.areaSquareMeters).toBeCloseTo(forwardClosure.areaSquareMeters, 9);
    expect(reversedClosure.perimeterMeters).toBeCloseTo(forwardClosure.perimeterMeters, 9);
    const forwardCourses = resolveCadParcelCourses(forward);
    const reversedCourses = resolveCadParcelCourses(reversed);
    const forwardArcs = forwardCourses.filter((course) => course.kind === 'arc');
    const reversedArcs = reversedCourses.filter((course) => course.kind === 'arc');
    expect(reversedArcs.map((course) => (course.kind === 'arc' ? course.direction : ''))).toEqual(
      forwardArcs.map(() => 'left'),
    );
    // Each reversed chord swaps the endpoints of a forward chord and
    // reverses its bearing (+180 mod 360).
    for (const reversedChord of reversedArcs) {
      if (reversedChord.kind !== 'arc') throw new Error('expected arcs');
      const partner = forwardArcs.find(
        (course) =>
          course.kind === 'arc' &&
          course.fromVertex.x === reversedChord.toVertex.x &&
          course.fromVertex.y === reversedChord.toVertex.y &&
          course.toVertex.x === reversedChord.fromVertex.x &&
          course.toVertex.y === reversedChord.fromVertex.y,
      );
      expect(partner?.kind).toBe('arc');
      if (partner?.kind !== 'arc') throw new Error('expected partner arc');
      expect(reversedChord.chordAzimuthDeg).toBeCloseTo((partner.chordAzimuthDeg + 180) % 360, 9);
    }
  });
});

describe('19C large coordinates match translated-local', () => {
  it('quarter-sector at E~2e6/N~7e6 equals local conditioning', () => {
    const local = makeParcel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      [line, arc(Math.tan(Math.PI / 8)), line],
    );
    const shifted = makeParcel(
      [
        { x: 2000000, y: 7000000 },
        { x: 2000010, y: 7000000 },
        { x: 2000000, y: 7000010 },
      ],
      [line, arc(Math.tan(Math.PI / 8)), line],
    );
    const localClosure = cadBuildParcelClosureSummary(local.vertices, {
      courseGeometry: local.courseGeometry,
    })!;
    const shiftedClosure = cadBuildParcelClosureSummary(shifted.vertices, {
      courseGeometry: shifted.courseGeometry,
    })!;
    expect(shiftedClosure.areaSquareMeters).toBeCloseTo(localClosure.areaSquareMeters, 6);
    expect(shiftedClosure.perimeterMeters).toBeCloseTo(localClosure.perimeterMeters, 6);
    const localArc = resolveCadParcelCourses(local)[1]!;
    const shiftedArc = resolveCadParcelCourses(shifted)[1]!;
    if (localArc.kind !== 'arc' || shiftedArc.kind !== 'arc') throw new Error('expected arcs');
    expect(shiftedArc.radius).toBeCloseTo(localArc.radius, 6);
    expect(shiftedArc.arcLength).toBeCloseTo(localArc.arcLength, 6);
    expect(shiftedArc.chordLength).toBeCloseTo(localArc.chordLength, 6);
    expect(shiftedArc.chordBearing).toBe(localArc.chordBearing);
    expect(shiftedArc.center.x).toBeCloseTo(localArc.center.x + 2000000, 6);
    expect(shiftedArc.center.y).toBeCloseTo(localArc.center.y + 7000000, 6);
  });
});

describe('19C tangency oracle', () => {
  // Line (0,0)->(10,0), arc (10,0)->(10,10): b=1 is exactly tangent (east).
  const tangentVertices = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('exact tangent true, perturbed bulge false', () => {
    const tangent = makeParcel(tangentVertices, [line, arc(1), line, line]);
    const reports = checkParcelCourseTangency(tangent.vertices, tangent.courseGeometry);
    expect(reports).toHaveLength(4);
    expect(reports.every((report) => report.status === 'TANGENT' || report.status === 'NON_TANGENT')).toBe(true);
    const atArcStart = reports[1]!;
    expect(atArcStart.status).toBe('TANGENT');
    expect(atArcStart.deviationDeg).toBeCloseTo(0, 9);
    // Square corners stay NON_TANGENT (90-degree kinks, no visual guess).
    expect(reports[0]!.status).toBe('NON_TANGENT');
    expect(reports[0]!.deviationDeg).toBeCloseTo(90, 6);

    const kinked = makeParcel(tangentVertices, [line, arc(0.9), line, line]);
    const kinkedReports = checkParcelCourseTangency(kinked.vertices, kinked.courseGeometry);
    expect(kinkedReports[1]!.status).toBe('NON_TANGENT');
    expect(kinkedReports[1]!.deviationDeg).toBeGreaterThan(1);
  });
});

describe('19C save/reopen round-trip', () => {
  it('mixed parcel: ids, geometry, area, table, description equal', () => {
    const parcel = makeParcel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [line, arc(-0.5), line, arc(-0.5)],
    );
    expect(parcelHasCurvedCourses(parcel)).toBe(true);
    const snapshot = {
      courses: resolveSurveyCourses(parcel).map((course) => [course.courseId, course.bearing, course.distance]),
      report: buildParcelCourseReportSummary(parcel),
      description: buildCadParcelLegalDescription(parcel),
    };
    const document = createBlankCadDrawingDocument({ name: 'roundtrip-19c', units: 'm' });
    document.project.entities.push(structuredClone(parcel));
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project.entities.find(
      (entity): entity is CadParcelEntity => entity.type === 'parcel',
    )!;
    expect(reopened.courseIds).toEqual(parcel.courseIds);
    expect(reopened.courseGeometry).toEqual(parcel.courseGeometry);
    expect(reopened.areaSquareMeters).toBeCloseTo(parcel.areaSquareMeters!, 9);
    expect(reopened.perimeterMeters).toBeCloseTo(parcel.perimeterMeters!, 9);
    expect(
      resolveSurveyCourses(reopened).map((course) => [course.courseId, course.bearing, course.distance]),
    ).toEqual(snapshot.courses);
    expect(buildParcelCourseReportSummary(reopened)?.courseCount).toBe(
      snapshot.report?.courseCount,
    );
    // Phase 19C Round 2C lifted the curved block: description is supported
    // and stable across the round-trip.
    expect(snapshot.description.ok).toBe(true);
    expect(buildCadParcelLegalDescription(reopened)).toEqual(snapshot.description);
  });

  it('malformed curves fail safe: save throws, hand-edited files load-reject', () => {
    const parcel = makeParcel([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    const badGeometries = [
      [line, line, line],
      [line, arc(0), line, line],
      [line, arc(Number.NaN), line, line],
    ] as CadParcelCourseGeometry[][];
    // Save-side: malformed geometry throws instead of writing chord lines.
    for (const badGeometry of badGeometries) {
      const document = createBlankCadDrawingDocument({ name: 'malformed-19c', units: 'm' });
      document.project.entities.push({
        ...structuredClone(parcel),
        courseGeometry: badGeometry,
      });
      expect(() => serializeCadDrawingFile(document)).toThrow();
    }
    // Load-side: a hand-edited file carrying bad geometry load-rejects.
    const validDocument = createBlankCadDrawingDocument({ name: 'malformed-19c', units: 'm' });
    validDocument.project.entities.push(structuredClone(parcel));
    const raw = JSON.parse(serializeCadDrawingFile(validDocument)) as {
      project: { entities: Array<{ type: string; courseGeometry?: unknown }> };
    };
    for (const badGeometry of badGeometries) {
      const mutated = structuredClone(raw);
      mutated.project.entities.find((entity) => entity.type === 'parcel')!.courseGeometry = badGeometry;
      expect(parseCadDrawingFile(JSON.stringify(mutated)).ok).toBe(false);
    }
    // In-memory fail-safe: no courses, null closure (never chord fallback).
    const bad = { ...parcel, courseGeometry: [line, line, line] as CadParcelCourseGeometry[] };
    expect(resolveCadParcelCourses(bad)).toEqual([]);
    expect(cadBuildParcelClosureSummary(bad.vertices, { courseGeometry: bad.courseGeometry })).toBeNull();
  });
});

describe('19C validation corpus', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('rejects each malformed case with its code', () => {
    expect(validateParcelCourseGeometry(square, undefined).ok).toBe(true);
    const cases: Array<{ geometry: CadParcelCourseGeometry[]; code: string }> = [
      { geometry: [line, line, line], code: 'COURSE_GEOMETRY_LENGTH_MISMATCH' },
      { geometry: [line, arc(Number.NaN), line, line], code: 'NON_FINITE_BULGE' },
      { geometry: [line, arc(Number.POSITIVE_INFINITY), line, line], code: 'NON_FINITE_BULGE' },
      { geometry: [line, arc(0), line, line], code: 'ZERO_BULGE_ARC' },
      { geometry: [line, arc(1e9), line, line], code: 'SWEEP_NEAR_FULL_CIRCLE' },
    ];
    for (const { geometry, code } of cases) {
      const result = validateParcelCourseGeometry(square, geometry);
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) => issue.code === code)).toBe(true);
    }
    // Sub-floor nonzero bulge canonicalizes to LINE (valid, no issue).
    expect(validateParcelCourseGeometry(square, [line, arc(1e-15), line, line]).ok).toBe(true);
  });

  it('zero-chord arc blocks the full-circle single course', () => {
    const degenerate = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const result = validateParcelCourseGeometry(degenerate, [arc(1), line, line, line]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.code).toBe('ZERO_CHORD_ARC');
    expect(result.issues[0]!.message).toMatch(/full-circle/i);
  });

  it('self-intersection blocks line-line, line-arc, arc-arc, tangent-touch', () => {
    // Clean lens validates.
    expect(
      validateParcelBoundaryTopology(square, [line, arc(-0.5), line, arc(-0.5)]).ok,
    ).toBe(true);
    // Bowtie: line x line.
    const bowtie = validateParcelBoundaryTopology([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(bowtie.ok).toBe(false);
    expect(bowtie.issues[0]!.code).toBe('SELF_INTERSECTION');
    // Arc B->C (b=-2) passes exactly through A: line x arc.
    const lineArc = validateParcelBoundaryTopology(square, [line, arc(-2), line, line]);
    expect(lineArc.ok).toBe(false);
    expect(lineArc.issues.some((issue) => issue.code === 'SELF_INTERSECTION')).toBe(true);
    expect(
      lineArc.issues.some((issue) => issue.courseIndex === 1 || issue.otherCourseIndex === 1),
    ).toBe(true);
    // Opposed semicircles touch at exactly (5,5): tangent-touch counts.
    const tangentTouch = validateParcelBoundaryTopology(square, [arc(-1), line, arc(-1), line]);
    expect(tangentTouch.ok).toBe(false);
    expect(tangentTouch.issues[0]!.code).toBe('SELF_INTERSECTION');
    // Opposed deep arcs cross twice: arc x arc.
    const arcCross = validateParcelBoundaryTopology(square, [arc(-1.2), line, arc(-1.2), line]);
    expect(arcCross.ok).toBe(false);
    expect(
      arcCross.issues.some(
        (issue) =>
          (issue.courseIndex === 0 && issue.otherCourseIndex === 2) ||
          (issue.courseIndex === 2 && issue.otherCourseIndex === 0),
      ),
    ).toBe(true);
  });

  it('vertex insert on a line course preserves geometry; arc split needs an on-arc point', () => {
    const parcel = makeParcel(square, [line, arc(-0.5), line, arc(-0.5)]);
    const split = insertParcelCourseVertex({
      parcel,
      courseIndex: 0,
      point: { x: 5, y: 0 },
      label: 'E',
    });
    expect(split).not.toBeNull();
    expect(split!.courseGeometry).toHaveLength(5);
    expect(
      validateParcelCourseGeometry(split!.vertices, split!.courseGeometry).ok,
    ).toBe(true);
    // A point off the arc fails closed (never straightened into lines).
    expect(
      insertParcelCourseVertex({ parcel, courseIndex: 1, point: { x: 10, y: 5 } }),
    ).toBeNull();
  });
});

describe('19C converter round-trips', () => {
  it('A/B/bulge -> center/radius/sweep/midpoint -> bulge is exact', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 10, y: 0 };
    for (const bulge of [0.2, Math.tan(Math.PI / 8), 0.5, 1, 2, -0.5, -1, -2.414213562373095]) {
      const metrics = describeParcelArcCourse(from, to, bulge)!;
      expect(metrics).not.toBeNull();
      const roundTripped = parcelBulgeFromArcDefinition({
        from,
        to,
        center: metrics.center,
        radius: metrics.radius,
        signedSweepDeg: metrics.signedSweepDeg,
      });
      expect(roundTripped).toBeCloseTo(bulge, 12);
      // Spot pins: unit semicircle convention (center on chord, south side).
      if (bulge === 1) {
        expect(metrics.center).toEqual({ x: 5, y: 0 });
        expect(metrics.radius).toBeCloseTo(5, 12);
        expect(metrics.signedSweepDeg).toBeCloseTo(180, 12);
        expect(metrics.direction).toBe('left');
        expect(metrics.midpoint.y).toBeCloseTo(-5, 12);
      }
    }
    // Degenerate definitions return null (never guess).
    expect(
      parcelBulgeFromArcDefinition({ from, to: { ...from }, center: { x: 5, y: 0 }, radius: 5, signedSweepDeg: 180 }),
    ).toBeNull();
    expect(
      parcelBulgeFromArcDefinition({ from, to, center: { x: 5, y: 0 }, radius: 5, signedSweepDeg: 360 }),
    ).toBeNull();
  });
});
