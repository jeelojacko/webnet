// Phase C2 CONSUMERS — renderer / spatial / snaps / intersections / bounds /
// properties / grips / transforms / blocks / DXF / edit-safety.
import { describe, expect, it } from 'vitest';

import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import {
  appendCadProjectEntities,
  buildCadBounds,
} from '../src/engine/cad/cadProjectState';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import { buildCadSpatialIndex } from '../src/engine/cad/cadSpatialIndex';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { applyCadGripEdit, buildCadGripHandles } from '../src/engine/cad/cadTransactionsEntityTransforms';
import { cadIntersectLineLikeEntities } from '../src/engine/cad/cadCogoEntityIntersections';
import {
  isSameCadTangentPrimitive,
  resolveCadTangentSource,
} from '../src/engine/cad/cadGeometryCircleTangentSolvers';
import {
  cadClosestPointOnArc,
  cadTangentPointsFromExternalPointToArc,
} from '../src/engine/cad/cadGeometry';
import {
  featureLineCourseArcs,
  polylineCourseArcs,
  polylineCourseSegments,
} from '../src/engine/cad/cadSpatialEntityRefs';
import {
  classifyTransform,
  reflectionAboutLine,
  translation,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import { buildTransformedPreviewPrimitives } from '../src/engine/cad/cadTransformPreview';
import {
  blockReferenceScalesDistortPolylineCurve,
  expandBlockReference,
} from '../src/engine/cad/cadBlocks';
import { cloneCadEntity } from '../src/engine/cad/cadPersistence';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';
import {
  buildCadPolylineBandPoints,
  cadPolylineHasArcCourse,
  cadPolylineHasCurveOrWidth,
  cadPolylineHasNonzeroWidth,
  cadPolylineMaxHalfWidth,
  resolveCadPolylineCourses,
} from '../src/engine/cad/cadPolylineCourses';
import { buildBlockReferenceSnapCandidates } from '../src/engine/cad/cadSpatialBlockSnaps';
import { isTrimmableEntity, buildTrimSegments } from '../src/engine/cad/cadTransactionsTrimCommon';
import type {
  CadArcEntity,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadFeatureLineEntity,
  CadParcelEntity,
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
  CadProject,
} from '../src/engine/cad/cadTypes';

let seq = 0;
const polyline = (
  vertices: Array<{ x: number; y: number }>,
  options: {
    closed?: boolean;
    segmentGeometry?: CadPolylineSegmentGeometry[];
    segmentWidths?: CadPolylineSegmentWidth[];
  } = {},
): CadPolylineEntity => {
  seq += 1;
  const id = `c2-pl-${seq}`;
  return {
    id,
    type: 'polyline',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `V${index + 1}`),
    closed: options.closed ?? false,
    ...(options.segmentGeometry ? { segmentGeometry: options.segmentGeometry.map((entry) => ({ ...entry })) } : {}),
    ...(options.segmentWidths ? { segmentWidths: options.segmentWidths.map((entry) => ({ ...entry })) } : {}),
  };
};

const projectWith = (...entities: CadPolylineEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'C2 Consumers', units: 'm' });
  return appendCadProjectEntities(drawing.project, entities);
};

const line = (
  _id?: string,
  _from?: { x: number; y: number },
  _to?: { x: number; y: number },
): CadPolylineSegmentGeometry => ({ kind: 'line' });
const arc = (bulge: number): CadPolylineSegmentGeometry => ({ kind: 'arc', bulge });
const zero = (): CadPolylineSegmentWidth => ({ startWidth: 0, endWidth: 0 });
const SEMI = 1; // |bulge| = 1 → 180°
const QUARTER = Math.tan(Math.PI / 8); // 90° CCW

const lengthRows = (
  state: NonNullable<ReturnType<typeof buildCadPropertiesPanelState>>,
): Map<number, string> => {
  if (state.mode !== 'single') throw new Error('expected single');
  const map = new Map<number, string>();
  for (const property of state.entity.properties) {
    const match = /^Segment (\d+) length$/.exec(property.label);
    if (match) map.set(Number(match[1]), property.value);
  }
  return map;
};

// ---------------------------------------------------------------------------
// A) Renderer + width band
// ---------------------------------------------------------------------------

describe('C2 renderer: true arc primitive, mixed courses, width band', () => {
  it('emits a native arc primitive for an arc course (never a chord)', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const scene = buildCadDisplayScene(projectWith(entity));
    const primitives = scene.primitives.filter((p) => p.sourceEntityId === entity.id);
    expect(primitives).toHaveLength(1);
    const primitive = primitives[0]!;
    expect(primitive.kind).toBe('arc');
    if (primitive.kind !== 'arc') return;
    const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI)!;
    expect(primitive.center.x).toBeCloseTo(metrics.center.x, 9);
    expect(primitive.center.y).toBeCloseTo(metrics.center.y, 9);
    expect(primitive.radius).toBeCloseTo(metrics.radius, 9);
    expect(primitive.sourceSegmentId).toBe(`${entity.id}#0`);
  });

  it('keeps mixed line/arc course order and emits one band primitive for nonzero width', () => {
    const entity = polyline(
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      {
        segmentGeometry: [arc(QUARTER), line(`${''}`, { x: 0, y: 0 }, { x: 0, y: 0 })],
        segmentWidths: [{ startWidth: 2, endWidth: 2 }, { startWidth: 0, endWidth: 0 }],
      },
    );
    const scene = buildCadDisplayScene(projectWith(entity));
    const primitives = scene.primitives.filter((p) => p.sourceEntityId === entity.id);
    const courseKinds = primitives.filter((p) => p.kind !== 'band').map((p) => p.kind);
    expect(courseKinds[0]).toBe('arc');
    expect(courseKinds[1]).toBe('line');
    expect(primitives.map((p) => p.kind)).toContain('band');
    const bands = primitives.filter((p) => p.kind === 'band');
    expect(bands).toHaveLength(1);
  });

  it('zero-width metadata polyline emits no band (centreline path unchanged)', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [line('l', { x: 0, y: 0 }, { x: 0, y: 0 })] });
    const scene = buildCadDisplayScene(projectWith(entity));
    const primitives = scene.primitives.filter((p) => p.sourceEntityId === entity.id);
    expect(primitives.some((p) => p.kind === 'band')).toBe(false);
    expect(primitives.every((p) => p.kind === 'line')).toBe(true);
  });

  it('band builder follows the arc and interpolates width; legacy returns []', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 0, endWidth: 4 }],
    });
    const points = buildCadPolylineBandPoints(entity)!;
    expect(points.length).toBeGreaterThan(3);
    const legacy = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(buildCadPolylineBandPoints(legacy)).toEqual([]);
  });

  it('offsets arc band edges along the radial normal, never the tangent', () => {
    // Constant 5 m width over a semicircle: the band is the annulus between
    // R-2.5 and R+2.5, so every polygon vertex is radial from the centre.
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 5, endWidth: 5 }],
    });
    const points = buildCadPolylineBandPoints(entity)!;
    expect(points.length).toBeGreaterThan(3);
    const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI)!;
    const radialError = points.map((point) => {
      const radius = Math.hypot(point.x - metrics.center.x, point.y - metrics.center.y);
      return Math.min(
        Math.abs(radius - (metrics.radius - 2.5)),
        Math.abs(radius - (metrics.radius + 2.5)),
      );
    });
    expect(Math.max(...radialError)).toBeLessThan(1e-9);
  });

  it('bounds long wide arc bands without slicing the closed outline', () => {
    const vertices = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 },
    ];
    const entity = polyline(vertices, {
      segmentGeometry: [arc(SEMI), arc(-SEMI), arc(SEMI), arc(-SEMI)],
      segmentWidths: Array.from({ length: 4 }, () => ({ startWidth: 4, endWidth: 4 })),
    });
    const natural = buildCadPolylineBandPoints(entity)!;
    const ceiling = 64;
    expect(natural.length).toBeGreaterThan(ceiling);
    const points = buildCadPolylineBandPoints(entity, { maxTotalPoints: ceiling })!;
    expect(points.length).toBeLessThanOrEqual(ceiling);
    expect(points.length % 2).toBe(0);
    // A truncated polygon would end mid-course; a complete one always ends
    // on the opposite offset of the first centreline vertex, so the closing
    // edge spans the start cap (width 4) instead of cutting across a course.
    const firstLeft = points[0]!;
    const last = points[points.length - 1]!;
    expect(Math.hypot(last.x - firstLeft.x, last.y - firstLeft.y)).toBeCloseTo(4, 9);
    for (const point of points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// B/C/D) Spatial refs, snaps, intersections
// ---------------------------------------------------------------------------

describe('C2 spatial: true geometry refs, snaps, intersections', () => {
  it('resolves arc courses as arcs and lines as lines (never chord)', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI), line('l', { x: 0, y: 0 }, { x: 0, y: 0 })],
    });
    const courses = resolveCadPolylineCourses(entity)!;
    expect(courses).toHaveLength(2);
    expect(courses[0]!.kind).toBe('arc');
    expect(courses[1]!.kind).toBe('line');
  });

  it('closed last→first arc course works', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      closed: true,
      segmentGeometry: [line('a', { x: 0, y: 0 }, { x: 0, y: 0 }), line('b', { x: 0, y: 0 }, { x: 0, y: 0 }), arc(SEMI)],
    });
    const courses = resolveCadPolylineCourses(entity)!;
    expect(courses).toHaveLength(3);
    expect(courses[2]!.kind).toBe('arc');
    expect(courses[2]!.from).toEqual({ x: 10, y: 10 });
    expect(courses[2]!.to).toEqual({ x: 0, y: 0 });
  });

  it('arc-midpoint and nearest snap resolve on the true arc', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const index = buildCadSpatialIndex(projectWith(entity));
    const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI)!;
    const mid = index.queryNearestSnap({ x: metrics.midpoint.x, y: metrics.midpoint.y + 0.2 }, 2, ['arc-midpoint']);
    expect(mid?.kind).toBe('arc-midpoint');
    expect(mid?.x).toBeCloseTo(metrics.midpoint.x, 6);
    const near = index.queryNearestSnap({ x: 5, y: metrics.midpoint.y + 0.3 }, 3, ['nearest']);
    expect(near?.kind).toBe('nearest');
    expect(near?.y).toBeCloseTo(metrics.midpoint.y, 3);
  });

  it('intersection snap between a line and a bulged polyline uses the true arc', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const withLine = appendCadProjectEntities(projectWith(entity), [
      {
        id: 'c2-line',
        type: 'line',
        layerId: 'general',
        visible: true,
        locked: false,
        fromX: 5,
        fromY: -10,
        toX: 5,
        toY: 10,
        fromStationId: 'A',
        toStationId: 'B',
        sourceObservationIds: [],
      },
    ]);
    const index = buildCadSpatialIndex(withLine);
    // The semicircle dips to (5,-5); the vertical line x=5 crosses there.
    const hit = index.queryNearestSnap({ x: 5.1, y: -5.1 }, 2, ['intersection']);
    expect(hit?.kind).toBe('intersection');
    expect(hit?.x).toBeCloseTo(5, 3);
    expect(hit?.y).toBeCloseTo(-5, 3);
  });

  it('tangent and perpendicular sources resolve a bulged course as an ARC', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI)!;
    const index = buildCadSpatialIndex(projectWith(entity));
    const basePoint = { x: 5, y: -12 };
    const constructionContext = {
      active: true,
      basePoint,
    } as unknown as Parameters<typeof index.querySnapCandidates>[3];
    const tangent = index.queryNearestSnap({ x: 9.545, y: -2.083 }, 3, ['tangent'], constructionContext);
    expect(tangent?.kind).toBe('tangent');
    const perp = index.queryNearestSnap({ x: 5, y: -5.2 }, 3, ['perpendicular'], constructionContext);
    expect(perp?.kind).toBe('perpendicular');
    // Perpendicular foot must lie on the circle (radius from center).
    const distance = Math.hypot(perp!.x - metrics.center.x, perp!.y - metrics.center.y);
    expect(distance).toBeCloseTo(metrics.radius, 4);
  });

  it('Circle TTR/TTT tangent source resolves a bulged course as an ARC', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const source = resolveCadTangentSource(projectWith(entity), entity.id, { x: 5, y: -4 }, `${entity.id}#0`);
    expect(source).not.toBeNull();
    expect(source!.primitive.kind).toBe('arc');
    if (source!.primitive.kind !== 'arc') return;
    expect(source!.primitive.radius).toBeCloseTo(5, 9);
    expect(source!.primitive.center.x).toBeCloseTo(5, 9);
    expect(source!.primitive.center.y).toBeCloseTo(0, 9);
  });

  it('legacy polyline tangent source still resolves as a line segment', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const source = resolveCadTangentSource(projectWith(entity), entity.id, { x: 5, y: 0.5 }, `${entity.id}#0`);
    expect(source!.primitive.kind).toBe('line');
  });

  it('cadIntersectLineLikeEntities honors arc courses and the closed closing edge', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const visualLine: CadPolylineEntity = {
      id: 'c2-vline',
      type: 'polyline',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: [
        { x: 5, y: -10 },
        { x: 5, y: 10 },
      ],
      vertexLabels: ['A', 'B'],
      closed: false,
    };
    const hit = cadIntersectLineLikeEntities(entity, visualLine);
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBeCloseTo(5, 4);
    expect(hit!.point.y).toBeCloseTo(-5, 4);

    const closed = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], { closed: true });
    const crossing: CadPolylineEntity = {
      id: 'c2-cross',
      type: 'polyline',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: [
        { x: -5, y: 5 },
        { x: 15, y: 5 },
      ],
      vertexLabels: ['C', 'D'],
      closed: false,
    };
    const closedHit = cadIntersectLineLikeEntities(closed, crossing);
    expect(closedHit).not.toBeNull();
    expect(closedHit!.point.x).toBeCloseTo(5, 6);
    expect(closedHit!.point.y).toBeCloseTo(5, 6);
  });
});

// ---------------------------------------------------------------------------
// D2) C2 arc-course identity (multi-arc attribution + locking)
// ---------------------------------------------------------------------------

describe('C2 arc-course identity: multi-arc attribution, locks, and legacy fallback', () => {
  const multiArc = (): CadPolylineEntity =>
    polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], {
      segmentGeometry: [arc(SEMI), arc(SEMI)],
    });
  const metricsFor = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    bulge: number,
  ) => describeParcelArcCourse(from, to, bulge)!;
  const courseRange = (course: { startAngleDeg: number; signedSweepDeg: number }) => ({
    start: course.startAngleDeg,
    end: course.startAngleDeg + course.signedSweepDeg,
  });
  const parcelArc = (): CadParcelEntity => ({
    id: 'c2-parcel-arc-construction',
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    parcelName: 'LOT 1',
    vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    vertexLabels: ['A', 'B', 'C'],
    courseGeometry: [{ kind: 'arc', bulge: SEMI }, { kind: 'line' }, { kind: 'line' }],
  });
  const parcelArcIndex = () => {
    const parcel = parcelArc();
    const index = buildCadSpatialIndex(
      appendCadProjectEntities(projectWith(polyline([{ x: 100, y: 100 }, { x: 101, y: 100 }])), [parcel]),
    );
    return { parcel, index, metrics: metricsFor({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI) };
  };
  // Builds the two derived candidates the LINE seed path creates from a
  // tangent arc seed: the perpendicular-at-seed (label `#1 start perp`) and
  // the tangent-through-seed (label `#1 tangent`). The seed is always the
  // SECOND arc course so an attribution loss can only fall back to arc #0.
  const deriveTangentSeedCandidates = () => {
    const entity = multiArc();
    const index = buildCadSpatialIndex(projectWith(entity));
    const m1 = metricsFor({ x: 10, y: 0 }, { x: 20, y: 0 }, SEMI);
    const range = courseRange(m1);
    const seedPoint = cadClosestPointOnArc(
      { x: m1.midpoint.x, y: m1.midpoint.y + 0.2 },
      m1.center,
      m1.radius,
      range.start,
      range.end,
    );
    const seedSegmentId = `${entity.id}#1`;
    const seedContext = {
      active: true,
      scopeSeedSegmentId: seedSegmentId,
      tangentSeedArcEntityId: entity.id,
      tangentSeedArcSegmentId: seedSegmentId,
      tangentSeedPoint: { x: seedPoint.x, y: seedPoint.y },
    };
    const derivedPerp = index
      .querySnapCandidates(
        { x: seedPoint.x, y: seedPoint.y },
        30,
        ['perpendicular'],
        { ...seedContext, basePoint: { x: seedPoint.x, y: seedPoint.y } },
      )
      .find((candidate) => candidate.sourceEntityId === entity.id && candidate.label.endsWith('start perp'));
    // The base point sits INSIDE arc #1, so no true external tangent point
    // exists: the only `#1 tangent` candidate is the derived one.
    const basePoint = { x: m1.center.x, y: m1.center.y + 2 };
    const derivedTangent = index
      .querySnapCandidates(
        { x: m1.center.x - 2, y: m1.center.y + 2 },
        30,
        ['tangent'],
        { ...seedContext, basePoint },
      )
      .find((candidate) => candidate.sourceEntityId === entity.id && candidate.label.endsWith('#1 tangent'));
    return { entity, index, m1, basePoint, seedSegmentId, derivedPerp, derivedTangent };
  };

  it('addresses each arc course with its own `${id}#i` id (line ids unchanged)', () => {
    const entity = multiArc();
    expect(polylineCourseArcs(entity).map((ref) => ref.segmentId)).toEqual([
      `${entity.id}#0`,
      `${entity.id}#1`,
    ]);
    const mixed = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], {
      segmentGeometry: [line('a'), arc(SEMI)],
    });
    expect(polylineCourseSegments(mixed).map((ref) => ref.segmentId)).toEqual([`${mixed.id}#0`]);
    expect(polylineCourseArcs(mixed).map((ref) => ref.segmentId)).toEqual([`${mixed.id}#1`]);
  });

  it('nearest / arc-midpoint / tangent / perpendicular carry the exact second-course id', () => {
    const entity = multiArc();
    const index = buildCadSpatialIndex(projectWith(entity));
    const m0 = metricsFor({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI);
    const m1 = metricsFor({ x: 10, y: 0 }, { x: 20, y: 0 }, SEMI);
    const n0 = index.queryNearestSnap({ x: m0.midpoint.x, y: m0.midpoint.y + 0.2 }, 2, ['nearest']);
    expect(n0?.sourceSegmentId).toBe(`${entity.id}#0`);
    const n1 = index.queryNearestSnap({ x: m1.midpoint.x, y: m1.midpoint.y + 0.2 }, 2, ['nearest']);
    expect(n1?.sourceSegmentId).toBe(`${entity.id}#1`);
    const mid = index.queryNearestSnap({ x: m1.midpoint.x, y: m1.midpoint.y }, 2, ['arc-midpoint']);
    expect(mid?.sourceSegmentId).toBe(`${entity.id}#1`);

    const basePoint = { x: m1.center.x, y: m1.center.y - 12 };
    const context = { active: true, basePoint } as unknown as Parameters<
      typeof index.querySnapCandidates
    >[3];
    const range = courseRange(m1);
    const perp = index.queryNearestSnap(
      cadClosestPointOnArc(basePoint, m1.center, m1.radius, range.start, range.end),
      3,
      ['perpendicular'],
      context,
    );
    expect(perp?.sourceSegmentId).toBe(`${entity.id}#1`);
    const tangentPoint = cadTangentPointsFromExternalPointToArc(
      basePoint,
      m1.center,
      m1.radius,
      range.start,
      range.end,
    )[0]!;
    const tangent = index.queryNearestSnap(tangentPoint, 3, ['tangent'], context);
    expect(tangent?.sourceSegmentId).toBe(`${entity.id}#1`);
  });

  it('locks tangent/perp on the SECOND arc and never falls back to the first', () => {
    const entity = multiArc();
    const index = buildCadSpatialIndex(projectWith(entity));
    const m0 = metricsFor({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI);
    const m1 = metricsFor({ x: 10, y: 0 }, { x: 20, y: 0 }, SEMI);
    const basePoint = { x: m1.center.x, y: m1.center.y - 12 };
    const range = courseRange(m1);
    const pointAlong = (target: { x: number; y: number }, t: number) => ({
      x: basePoint.x + t * (target.x - basePoint.x),
      y: basePoint.y + t * (target.y - basePoint.y),
    });

    const tangentGuide = cadTangentPointsFromExternalPointToArc(
      basePoint,
      m1.center,
      m1.radius,
      range.start,
      range.end,
    )[0]!;
    const tangentQuery = pointAlong(tangentGuide, 0.5);
    const lockedTangent = index
      .querySnapCandidates(
        tangentQuery,
        3,
        ['tangent', 'perpendicular'],
        {
          active: true,
          basePoint,
          lockedSnap: {
            kind: 'tangent',
            sourceEntityId: entity.id,
            sourceSegmentId: `${entity.id}#1`,
            guidePoint: tangentGuide,
          },
        },
      )
      .find((candidate) => candidate.kind === 'tangent' && candidate.distance <= 1e-6);
    expect(lockedTangent).toBeDefined();
    expect(lockedTangent!.sourceSegmentId).toBe(`${entity.id}#1`);
    // The lock guide uses arc #1's center, never the arc #0 first-match.
    expect(lockedTangent!.guideSegments?.[1]?.[0]).toEqual(m1.center);
    expect(lockedTangent!.guideSegments?.[1]?.[0]).not.toEqual(m0.center);

    const perpendicularGuide = cadClosestPointOnArc(
      basePoint,
      m1.center,
      m1.radius,
      range.start,
      range.end,
    );
    const lockedPerp = index
      .querySnapCandidates(
        pointAlong(perpendicularGuide, 0.5),
        3,
        ['perpendicular'],
        {
          active: true,
          basePoint,
          lockedSnap: {
            kind: 'perpendicular',
            sourceEntityId: entity.id,
            sourceSegmentId: `${entity.id}#1`,
            guidePoint: perpendicularGuide,
          },
        },
      )
      .find((candidate) => candidate.kind === 'perpendicular' && candidate.distance <= 1e-6);
    expect(lockedPerp).toBeDefined();
    expect(lockedPerp!.guideSegments?.[1]?.[0]).toEqual(m1.center);
  });

  it('resolves Circle/L1 tangent sources to the exact course and keeps them distinct', () => {
    const entity = multiArc();
    const project = projectWith(entity);
    const m1 = metricsFor({ x: 10, y: 0 }, { x: 20, y: 0 }, SEMI);
    const range = courseRange(m1);
    const pick = cadClosestPointOnArc(
      { x: m1.midpoint.x, y: m1.midpoint.y + 1 },
      m1.center,
      m1.radius,
      range.start,
      range.end,
    );
    const second = resolveCadTangentSource(project, entity.id, pick, `${entity.id}#1`);
    expect(second?.primitive.kind).toBe('arc');
    if (second?.primitive.kind !== 'arc') return;
    expect(second.primitive.segmentId).toBe(`${entity.id}#1`);
    expect(second.primitive.center.x).toBeCloseTo(m1.center.x, 9);
    expect(second.primitive.center.y).toBeCloseTo(m1.center.y, 9);
    const first = resolveCadTangentSource(project, entity.id, pick, `${entity.id}#0`);
    expect(first?.primitive.kind).toBe('arc');
    if (first?.primitive.kind !== 'arc') return;
    expect(first.primitive.segmentId).toBe(`${entity.id}#0`);
    expect(isSameCadTangentPrimitive(second.primitive, first.primitive)).toBe(false);
    expect(isSameCadTangentPrimitive(second.primitive, second.primitive)).toBe(true);
  });

  it('attaches the same course id to parcel and feature-line arc courses', () => {
    const parcel: CadParcelEntity = {
      id: 'c2-parcel-arc',
      type: 'parcel',
      layerId: 'general',
      visible: true,
      locked: false,
      parcelName: 'LOT 1',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      vertexLabels: ['A', 'B', 'C'],
      courseGeometry: [{ kind: 'arc', bulge: SEMI }, { kind: 'line' }, { kind: 'line' }],
    };
    const index = buildCadSpatialIndex(
      appendCadProjectEntities(projectWith(polyline([{ x: 100, y: 100 }, { x: 101, y: 100 }])), [parcel]),
    );
    const m = metricsFor({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI);
    const snap = index.queryNearestSnap({ x: m.midpoint.x, y: m.midpoint.y + 0.2 }, 2, ['nearest']);
    expect(snap?.sourceSegmentId).toBe(`${parcel.id}#0`);

    const featureLine: CadFeatureLineEntity = {
      id: 'c2-feature-arc',
      type: 'feature-line',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: [
        { id: 'f1', x: 0, y: 0, z: 0 },
        { id: 'f2', x: 10, y: 0, z: 0 },
      ],
      segmentGeometry: [{ kind: 'arc', bulge: SEMI }],
    };
    expect(featureLineCourseArcs(featureLine).map((ref) => ref.segmentId)).toEqual([
      `${featureLine.id}#0`,
    ]);
  });

  it('seeds from a parcel arc snap as an ARC course, never the chord', () => {
    const { parcel, index, metrics } = parcelArcIndex();
    const nearest = index.queryNearestSnap(
      { x: metrics.midpoint.x, y: metrics.midpoint.y + 0.2 },
      2,
      ['nearest'],
    );
    expect(nearest?.sourceSegmentId).toBe(`${parcel.id}#0`);

    // Reproduce the LINE seed context built from that snapped point: the same
    // `${id}#i` identity feeds both the scope seed and the tangent-arc seed.
    const seed = nearest!;
    const context = {
      active: true,
      basePoint: { x: seed.x, y: seed.y },
      scopeSeedSegmentId: seed.sourceSegmentId,
      tangentSeedArcEntityId: seed.sourceEntityId,
      tangentSeedArcSegmentId: seed.sourceSegmentId,
      tangentSeedPoint: { x: seed.x, y: seed.y },
    };
    const candidates = index.querySnapCandidates(
      { x: seed.x, y: seed.y },
      30,
      ['perpendicular'],
      context,
    );
    const startPerp = candidates.find((candidate) => candidate.kind === 'perpendicular');
    expect(startPerp).toBeDefined();
    // The arc seed's guide references the arc CENTER; a chord seed would have
    // referenced the chord endpoints instead.
    expect(startPerp!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(metrics.center.x, 9);
    expect(startPerp!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(metrics.center.y, 9);
  });

  it('carries the seeded SECOND-course id on the derived tangent-seed perpendicular', () => {
    const { entity, m1, seedSegmentId, derivedPerp } = deriveTangentSeedCandidates();
    expect(derivedPerp).toBeDefined();
    expect(derivedPerp!.sourceEntityId).toBe(entity.id);
    expect(derivedPerp!.sourceSegmentId).toBe(seedSegmentId);
    // The guide references arc #1's center, never arc #0's first-match.
    expect(derivedPerp!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(m1.center.x, 9);
    expect(derivedPerp!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(m1.center.y, 9);
  });

  it('carries the seeded SECOND-course id on the derived tangent-through-seed candidate', () => {
    const { entity, basePoint, seedSegmentId, derivedTangent } = deriveTangentSeedCandidates();
    expect(derivedTangent).toBeDefined();
    expect(derivedTangent!.sourceEntityId).toBe(entity.id);
    expect(derivedTangent!.sourceSegmentId).toBe(seedSegmentId);
    // The derived tangent guide's second segment starts at the live base
    // point; the entity tangent candidate would start it at the tangent point.
    expect(derivedTangent!.guideSegments?.[1]?.[1]).toEqual(basePoint);
  });

  it('re-locks each derived candidate on the SECOND course, never falling to arc #0', () => {
    const { index, m1, seedSegmentId, derivedPerp, derivedTangent } = deriveTangentSeedCandidates();
    expect(derivedPerp).toBeDefined();
    expect(derivedTangent).toBeDefined();
    // Reproduce the transientConstructionLock the snapping hook builds from a
    // live construction snap when the pointer moves off it.
    const lockFrom = (candidate: {
      kind: string;
      sourceEntityId: string;
      sourceSegmentId?: string;
      lockGuidePoint?: { x: number; y: number };
      x: number;
      y: number;
    }) => ({
      kind: candidate.kind as 'perpendicular' | 'tangent',
      sourceEntityId: candidate.sourceEntityId.split('|')[0] ?? candidate.sourceEntityId,
      sourceSegmentId: candidate.sourceSegmentId,
      guidePoint: candidate.lockGuidePoint ?? { x: candidate.x, y: candidate.y },
    });

    const perpLock = lockFrom(derivedPerp!);
    expect(perpLock.sourceSegmentId).toBe(seedSegmentId);
    const lockedPerp = index
      .querySnapCandidates({ x: derivedPerp!.x, y: derivedPerp!.y }, 3, [], {
        active: true,
        basePoint: { x: m1.center.x, y: m1.center.y - 12 },
        lockedSnap: perpLock,
      })
      .find((candidate) => candidate.kind === 'perpendicular');
    expect(lockedPerp).toBeDefined();
    expect(lockedPerp!.sourceSegmentId).toBe(seedSegmentId);
    expect(lockedPerp!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(m1.center.x, 9);
    expect(lockedPerp!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(m1.center.y, 9);

    const tangentLock = lockFrom(derivedTangent!);
    expect(tangentLock.sourceSegmentId).toBe(seedSegmentId);
    const lockedTangent = index
      .querySnapCandidates({ x: derivedTangent!.x, y: derivedTangent!.y }, 3, [], {
        active: true,
        basePoint: { x: m1.center.x, y: m1.center.y + 2 },
        lockedSnap: tangentLock,
      })
      .find((candidate) => candidate.kind === 'tangent');
    expect(lockedTangent).toBeDefined();
    expect(lockedTangent!.sourceSegmentId).toBe(seedSegmentId);
    expect(lockedTangent!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(m1.center.x, 9);
    expect(lockedTangent!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(m1.center.y, 9);
  });

  it('propagates the seeded SECOND-course id through a parcel arc course', () => {
    const parcel: CadParcelEntity = {
      id: 'c2-parcel-two-arcs',
      type: 'parcel',
      layerId: 'general',
      visible: true,
      locked: false,
      parcelName: 'LOT 2',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 10 }],
      vertexLabels: ['A', 'B', 'C', 'D'],
      courseGeometry: [
        { kind: 'arc', bulge: SEMI },
        { kind: 'arc', bulge: SEMI },
        { kind: 'line' },
        { kind: 'line' },
      ],
    };
    const index = buildCadSpatialIndex(
      appendCadProjectEntities(projectWith(polyline([{ x: 100, y: 100 }, { x: 101, y: 100 }])), [parcel]),
    );
    const m1 = metricsFor({ x: 10, y: 0 }, { x: 20, y: 0 }, SEMI);
    const range = courseRange(m1);
    const seedPoint = cadClosestPointOnArc(
      { x: m1.midpoint.x, y: m1.midpoint.y + 0.2 },
      m1.center,
      m1.radius,
      range.start,
      range.end,
    );
    const seedSegmentId = `${parcel.id}#1`;
    const derivedPerp = index
      .querySnapCandidates(
        { x: seedPoint.x, y: seedPoint.y },
        30,
        ['perpendicular'],
        {
          active: true,
          basePoint: { x: seedPoint.x, y: seedPoint.y },
          tangentSeedArcEntityId: parcel.id,
          tangentSeedArcSegmentId: seedSegmentId,
          tangentSeedPoint: { x: seedPoint.x, y: seedPoint.y },
        },
      )
      .find((candidate) => candidate.sourceEntityId === parcel.id && candidate.label.endsWith('start perp'));
    expect(derivedPerp).toBeDefined();
    expect(derivedPerp!.sourceSegmentId).toBe(seedSegmentId);
    expect(derivedPerp!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(m1.center.x, 9);
    expect(derivedPerp!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(m1.center.y, 9);
  });

  it('leaves a standalone CadArcEntity tangent-seed candidate legacy (no id, entity-fallback lock)', () => {
    const standalone: CadArcEntity = {
      id: 'c2-standalone-seed-arc',
      type: 'arc',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 100,
      centerY: 0,
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 180,
    };
    const index = buildCadSpatialIndex(
      appendCadProjectEntities(projectWith(polyline([{ x: 0, y: 0 }, { x: 1, y: 0 }])), [standalone]),
    );
    const seedPoint = cadClosestPointOnArc({ x: 100, y: 3 }, { x: 100, y: 0 }, 10, 0, 180);
    const derivedPerp = index
      .querySnapCandidates(
        { x: seedPoint.x, y: seedPoint.y },
        30,
        ['perpendicular'],
        {
          active: true,
          basePoint: { x: seedPoint.x, y: seedPoint.y },
          tangentSeedArcEntityId: standalone.id,
          tangentSeedArcSegmentId: null,
          tangentSeedPoint: { x: seedPoint.x, y: seedPoint.y },
        },
      )
      .find((candidate) => candidate.sourceEntityId === standalone.id && candidate.label.endsWith('start perp'));
    expect(derivedPerp).toBeDefined();
    expect(derivedPerp!.sourceSegmentId).toBeUndefined();
    const locked = index
      .querySnapCandidates({ x: derivedPerp!.x, y: derivedPerp!.y }, 3, [], {
        active: true,
        basePoint: { x: 100, y: 14 },
        lockedSnap: {
          kind: 'perpendicular',
          sourceEntityId: standalone.id,
          guidePoint: derivedPerp!.lockGuidePoint ?? { x: derivedPerp!.x, y: derivedPerp!.y },
        },
      })
      .find((candidate) => candidate.kind === 'perpendicular');
    expect(locked).toBeDefined();
    // Entity fallback still resolves the legacy standalone arc's center.
    expect(locked!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(100, 9);
    expect(locked!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(0, 9);
  });

  it('resolves a locked tangent on a parcel arc course to the arc, never null/chord', () => {
    const { parcel, index, metrics } = parcelArcIndex();
    const basePoint = { x: metrics.center.x, y: metrics.center.y - 12 };
    const tangentGuide = cadTangentPointsFromExternalPointToArc(
      basePoint,
      metrics.center,
      metrics.radius,
      metrics.startAngleDeg,
      metrics.endAngleDeg,
    )[0]!;
    const query = {
      x: (basePoint.x + tangentGuide.x) / 2,
      y: (basePoint.y + tangentGuide.y) / 2,
    };
    // `allowed: []` disables the ordinary entity-candidate pass, so the ONLY
    // candidate that can survive is the locked-construction resolution.
    const locked = index
      .querySnapCandidates(query, 3, [], {
        active: true,
        basePoint,
        lockedSnap: {
          kind: 'tangent',
          sourceEntityId: parcel.id,
          sourceSegmentId: `${parcel.id}#0`,
          guidePoint: tangentGuide,
        },
      })
      .find((candidate) => candidate.kind === 'tangent' && candidate.sourceSegmentId === `${parcel.id}#0`);
    expect(locked).toBeDefined();
    expect(locked!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(metrics.center.x, 9);
    expect(locked!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(metrics.center.y, 9);
  });

  it('uses parcel arc geometry for a locked perpendicular, never the chord', () => {
    const { parcel, index, metrics } = parcelArcIndex();
    const basePoint = { x: metrics.center.x, y: metrics.center.y - 12 };
    const perpGuide = cadClosestPointOnArc(
      basePoint,
      metrics.center,
      metrics.radius,
      metrics.startAngleDeg,
      metrics.endAngleDeg,
    );
    const query = {
      x: (basePoint.x + perpGuide.x) / 2,
      y: (basePoint.y + perpGuide.y) / 2,
    };
    // `allowed: []` isolates the locked construction path: no entity
    // candidate can mask a chord-based lock fallback.
    const locked = index
      .querySnapCandidates(query, 3, [], {
        active: true,
        basePoint,
        lockedSnap: {
          kind: 'perpendicular',
          sourceEntityId: parcel.id,
          sourceSegmentId: `${parcel.id}#0`,
          guidePoint: perpGuide,
        },
      })
      .find((candidate) => candidate.kind === 'perpendicular');
    expect(locked).toBeDefined();
    // Arc resolution puts the arc center in the guide; a chord fallback would
    // have used the chord endpoints.
    expect(locked!.guideSegments?.[1]?.[0]?.x).toBeCloseTo(metrics.center.x, 9);
    expect(locked!.guideSegments?.[1]?.[0]?.y).toBeCloseTo(metrics.center.y, 9);
    expect(locked!.guideSegments?.[1]?.[1]).toEqual(basePoint);
  });

  it('leaves standalone CadArcEntity attribution legacy (no segment id, entity fallback lock)', () => {
    const standalone: CadArcEntity = {
      id: 'c2-standalone-arc',
      type: 'arc',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 100,
      centerY: 0,
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 180,
    };
    const index = buildCadSpatialIndex(appendCadProjectEntities(projectWith(multiArc()), [standalone]));
    const nearest = index.queryNearestSnap({ x: 90, y: 5.2 }, 2, ['nearest']);
    expect(nearest?.sourceEntityId).toBe(standalone.id);
    expect(nearest?.sourceSegmentId).toBeUndefined();
    const basePoint = { x: 100, y: 14 };
    const guidePoint = cadClosestPointOnArc(basePoint, { x: 100, y: 0 }, 10, 0, 180);
    const locked = index.querySnapCandidates(
      guidePoint,
      3,
      ['perpendicular'],
      {
        active: true,
        basePoint,
        lockedSnap: { kind: 'perpendicular', sourceEntityId: standalone.id, guidePoint },
      },
    );
    expect(locked.some((candidate) => candidate.kind === 'perpendicular' && candidate.sourceEntityId === standalone.id)).toBe(true);
  });

  it('keeps coincident shared-endpoint dedupe priority (no multi-owner payloads)', () => {
    const entity = multiArc();
    const index = buildCadSpatialIndex(projectWith(entity));
    const atShared = index
      .querySnapCandidates({ x: 10, y: 0 }, 2, ['endpoint'])
      .filter((candidate) => Math.hypot(candidate.x - 10, candidate.y) < 1e-9);
    expect(atShared).toHaveLength(1);
    expect(atShared[0]!.sourceSegmentId).toBe(`${entity.id}#0`);
  });
});

// ---------------------------------------------------------------------------
// E) Bounds
// ---------------------------------------------------------------------------

describe('C2 bounds: true arc extrema + width envelope', () => {
  const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI)!;

  it('open arc bounds include the in-sweep extremum outside the chord box', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const bounds = buildCadBounds([entity])!;
    expect(bounds.maxX).toBeCloseTo(10, 6);
    expect(bounds.minX).toBeCloseTo(0, 6);
    expect(bounds.minY).toBeCloseTo(metrics.midpoint.y, 6);
    expect(bounds.minY).toBeLessThan(-4);
  });

  it('closed ring arc extrema participate in bounds', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      closed: true,
      segmentGeometry: [line('a', { x: 0, y: 0 }, { x: 0, y: 0 }), line('b', { x: 0, y: 0 }, { x: 0, y: 0 }), arc(SEMI)],
    });
    const bounds = buildCadBounds([entity])!;
    // Closing course 10,10 -> 0,0 with bulge 1 : center (5,5), r ~7.07; the arc
    // sweeps through the region and reaches beyond the vertex box.
    expect(bounds.minY).toBeLessThanOrEqual(0);
    expect(bounds.maxX).toBeGreaterThanOrEqual(10);
  });

  it('nonzero width expands bounds by half the band (arc radial extremes)', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 2, endWidth: 2 }],
    });
    const bounds = buildCadBounds([entity])!;
    expect(bounds.minY).toBeCloseTo(metrics.midpoint.y - 1, 6);
    expect(entityIntersectsBounds(projectWith(entity), entity, {
      minX: 4,
      minY: metrics.midpoint.y - 1.05,
      maxX: 6,
      maxY: metrics.midpoint.y - 0.95,
    })).toBe(true);
    // Just outside the widened band misses.
    expect(entityIntersectsBounds(projectWith(entity), entity, {
      minX: 20,
      minY: 20,
      maxX: 30,
      maxY: 30,
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F) Properties
// ---------------------------------------------------------------------------

describe('C2 properties: line vs arc, true total length, width rows', () => {
  it('mixed total = straights + true arc length; arc row carries R/delta/bulge', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI), line('l', { x: 0, y: 0 }, { x: 0, y: 0 })],
    });
    const state = buildCadPropertiesPanelState(projectWith(entity), [entity])!;
    const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, SEMI)!;
    const expected = metrics.arcLength + 10;
    const totalRow = state.mode === 'single'
      ? state.entity.properties.find((p) => p.label === 'Total length')
      : undefined;
    expect(totalRow?.value).toBe(expected.toFixed(3));
    const arcRow = state.mode === 'single'
      ? state.entity.properties.find((p) => p.label === 'Segment 1 curve')
      : undefined;
    expect(arcRow?.value).toContain('R');
    expect(arcRow?.value).toContain('bulge');
  });

  it('closed ring includes the closing course and width rows', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], {
      closed: true,
      segmentGeometry: [line('a', { x: 0, y: 0 }, { x: 0, y: 0 }), line('b', { x: 0, y: 0 }, { x: 0, y: 0 }), arc(SEMI)],
      segmentWidths: [zero(), { startWidth: 1, endWidth: 2 }, zero()],
    });
    const state = buildCadPropertiesPanelState(projectWith(entity), [entity])!;
    expect(lengthRows(state).size).toBe(3);
    const widthRow = state.mode === 'single'
      ? state.entity.properties.find((p) => p.label === 'Segment 2 width')
      : undefined;
    expect(widthRow?.value).toContain('→');
  });
});

// ---------------------------------------------------------------------------
// G) Grips
// ---------------------------------------------------------------------------

describe('C2 grips: metadata rides verbatim, degenerates fail closed', () => {
  it('moves one vertex and keeps bulge/width exactly', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI), line('l', { x: 0, y: 0 }, { x: 0, y: 0 })],
      segmentWidths: [{ startWidth: 0.5, endWidth: 1 }, zero()],
    });
    const project = projectWith(entity);
    const next = applyCadGripEdit(project, {
      key: 'GRIP_EDIT',
      entityId: entity.id,
      gripKind: 'vertex',
      vertexIndex: 1,
      x: 12,
      y: 0,
    })!;
    const moved = next.entities.find((e) => e.id === entity.id) as CadPolylineEntity;
    expect(moved.vertices[1]).toEqual({ x: 12, y: 0 });
    expect(moved.segmentGeometry).toEqual(entity.segmentGeometry);
    expect(moved.segmentWidths).toEqual(entity.segmentWidths);
    expect(buildCadGripHandles(moved).filter((grip) => grip.kind === 'vertex')).toHaveLength(3);
  });

  it('collapsing an arc chord fails closed (no metadata shift)', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const next = applyCadGripEdit(projectWith(entity), {
      key: 'GRIP_EDIT',
      entityId: entity.id,
      gripKind: 'vertex',
      vertexIndex: 1,
      x: 0,
      y: 0,
    });
    expect(next).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// J) Transforms
// ---------------------------------------------------------------------------

describe('C2 transforms: uniform scales widths, reflection flips bulges, affine refuses', () => {
  const entity = (): CadPolylineEntity =>
    polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI), line('l', { x: 0, y: 0 }, { x: 0, y: 0 })],
      segmentWidths: [{ startWidth: 1, endWidth: 2 }, zero()],
    });

  it('uniform scale keeps bulges and scales widths by |scale|', () => {
    const t = uniformScaleAbout(0, 0, 2);
    const result = transformCadEntityGeometry(entity(), t, classifyTransform(t)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.entity as CadPolylineEntity;
    expect(out.segmentGeometry![0]).toEqual({ kind: 'arc', bulge: SEMI });
    expect(out.segmentWidths![0]).toEqual({ startWidth: 2, endWidth: 4 });
  });

  it('reflection flips every bulge sign and keeps widths positive', () => {
    const t = reflectionAboutLine({ x: 0, y: 0 }, { x: 0, y: 1 })!;
    const result = transformCadEntityGeometry(entity(), t, classifyTransform(t)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.entity as CadPolylineEntity;
    expect(out.segmentGeometry![0]).toEqual({ kind: 'arc', bulge: -SEMI });
    expect(out.segmentWidths![0]).toEqual({ startWidth: 1, endWidth: 2 });
  });

  it('translation keeps bulges and widths unchanged', () => {
    const t = translation(3, 4);
    const result = transformCadEntityGeometry(entity(), t, classifyTransform(t)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.entity as CadPolylineEntity;
    expect(out.segmentGeometry).toEqual(entity().segmentGeometry);
    expect(out.segmentWidths).toEqual(entity().segmentWidths);
  });

  it('nonuniform/shear fails closed with a named error', () => {
    const t = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const result = transformCadEntityGeometry(entity(), t, classifyTransform(t)!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('CAD_TRANSFORM_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED');
  });

  it('nonuniform is allowed for a straight zero-width polyline', () => {
    const straight = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const t = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const result = transformCadEntityGeometry(straight, t, classifyTransform(t)!);
    expect(result.ok).toBe(true);
  });

  it('preview arc endpoints agree with the committed reflection', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const project = projectWith(entity);
    const primitives = buildCadDisplayScene(project).primitives.filter((p) => p.sourceEntityId === entity.id);
    const t = reflectionAboutLine({ x: 0, y: 0 }, { x: 0, y: 1 })!;
    const preview = buildTransformedPreviewPrimitives(primitives, [entity.id], t);
    const previewArc = preview.find((p) => p.kind === 'arc');
    expect(previewArc).toBeDefined();
    if (!previewArc || previewArc.kind !== 'arc') return;
    const committed = transformCadEntityGeometry(entity, t, classifyTransform(t)!);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const course = resolveCadPolylineCourses(committed.entity as CadPolylineEntity)![0]!;
    const metrics = course.metrics!;
    const committedStart = {
      x: metrics.center.x + metrics.radius * Math.cos((metrics.startAngleDeg * Math.PI) / 180),
      y: metrics.center.y + metrics.radius * Math.sin((metrics.startAngleDeg * Math.PI) / 180),
    };
    const committedEnd = {
      x: metrics.center.x + metrics.radius * Math.cos(((metrics.startAngleDeg + metrics.signedSweepDeg) * Math.PI) / 180),
      y: metrics.center.y + metrics.radius * Math.sin(((metrics.startAngleDeg + metrics.signedSweepDeg) * Math.PI) / 180),
    };
    const previewStart = {
      x: previewArc.center.x + previewArc.radius * Math.cos((previewArc.startAngleDeg * Math.PI) / 180),
      y: previewArc.center.y + previewArc.radius * Math.sin((previewArc.startAngleDeg * Math.PI) / 180),
    };
    const previewEnd = {
      x: previewArc.center.x + previewArc.radius * Math.cos((previewArc.endAngleDeg * Math.PI) / 180),
      y: previewArc.center.y + previewArc.radius * Math.sin((previewArc.endAngleDeg * Math.PI) / 180),
    };
    // Reflection reverses traversal, so the preview draws the same curve from
    // the reflected far end back: endpoint SETS must agree exactly.
    expect(previewStart.x).toBeCloseTo(committedEnd.x, 6);
    expect(previewStart.y).toBeCloseTo(committedEnd.y, 6);
    expect(previewEnd.x).toBeCloseTo(committedStart.x, 6);
    expect(previewEnd.y).toBeCloseTo(committedStart.y, 6);
  });
});

// ---------------------------------------------------------------------------
// I) Blocks
// ---------------------------------------------------------------------------

describe('C2 blocks: uniform exact, nonuniform curved polyline refuses', () => {
  const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
    segmentGeometry: [arc(SEMI)],
    segmentWidths: [{ startWidth: 1, endWidth: 1 }],
  });
  const definition: CadBlockDefinition = {
    id: 'block:c2',
    name: 'C2 Block',
    basePoint: { x: 0, y: 0 },
    entities: [child],
  };

  it('uniform scale keeps bulge and scales width exactly', () => {
    const expanded = expandBlockReference(definition, {
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 2,
      scaleY: 2,
    });
    const out = expanded[0] as CadPolylineEntity;
    expect(out.segmentGeometry![0]).toEqual({ kind: 'arc', bulge: SEMI });
    expect(out.segmentWidths![0]).toEqual({ startWidth: 2, endWidth: 2 });
  });

  it('reflection flips the bulge and keeps width positive', () => {
    const expanded = expandBlockReference(definition, {
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
      mirrored: true,
    });
    const out = expanded[0] as CadPolylineEntity;
    expect(out.segmentGeometry![0]).toEqual({ kind: 'arc', bulge: -SEMI });
    expect(out.segmentWidths![0]).toEqual({ startWidth: 1, endWidth: 1 });
  });

  it('nonuniform scale over a bulged/wide polyline child fails closed', () => {
    expect(blockReferenceScalesDistortPolylineCurve(definition, 2, 1)).toBe(true);
    expect(() =>
      expandBlockReference(definition, { x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1 }),
    ).toThrow(/CAD_BLOCK_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED/);
  });

  it('nonuniform scale over a straight zero-width polyline child is allowed', () => {
    const straightDef: CadBlockDefinition = {
      ...definition,
      entities: [polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }])],
    };
    expect(blockReferenceScalesDistortPolylineCurve(straightDef, 2, 1)).toBe(false);
    expect(() =>
      expandBlockReference(straightDef, { x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1 }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// I2) Malformed metadata entries fail closed in the distortion guards
// ---------------------------------------------------------------------------

describe('C2 distortion guards: malformed metadata entries fail closed', () => {
  const insertDefinition = (child: CadPolylineEntity): CadBlockDefinition => ({
    id: 'block:c2-malformed-entry',
    name: 'C2 Malformed Entry',
    basePoint: { x: 0, y: 0 },
    entities: [child],
  });

  it('null width entry ⇒ nonzero-width guard true (no entry deref throw)', () => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentWidths: [zero()] });
    (child.segmentWidths as unknown[])[0] = null;
    expect(() => cadPolylineHasNonzeroWidth(child)).not.toThrow();
    expect(cadPolylineHasNonzeroWidth(child)).toBe(true);
    const definition = insertDefinition(child);
    expect(blockReferenceScalesDistortPolylineCurve(definition, 2, 1)).toBe(true);
    expect(() =>
      expandBlockReference(definition, { x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1 }),
    ).toThrow(/CAD_BLOCK_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED/);
  });

  it('null geometry entry ⇒ arc guard true (no entry deref throw)', () => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [line()] });
    (child.segmentGeometry as unknown[])[0] = null;
    expect(() => cadPolylineHasArcCourse(child)).not.toThrow();
    expect(cadPolylineHasArcCourse(child)).toBe(true);
    expect(blockReferenceScalesDistortPolylineCurve(insertDefinition(child), 2, 1)).toBe(true);
  });

  it('unknown-kind geometry entry fails closed as an arc', () => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    (child as unknown as { segmentGeometry: unknown[] }).segmentGeometry = [{ kind: 'spline' }];
    expect(cadPolylineHasArcCourse(child)).toBe(true);
  });

  it('malformed width entry ⇒ MaxHalfWidth NaN (non-finite safe-side value)', () => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentWidths: [zero()] });
    (child.segmentWidths as unknown[])[0] = null;
    expect(Number.isNaN(cadPolylineMaxHalfWidth(child))).toBe(true);
  });

  it('valid entries keep the guards and MaxHalfWidth unchanged', () => {
    const curvedWide = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 1, endWidth: 2 }],
    });
    expect(cadPolylineHasArcCourse(curvedWide)).toBe(true);
    expect(cadPolylineHasNonzeroWidth(curvedWide)).toBe(true);
    expect(cadPolylineMaxHalfWidth(curvedWide)).toBe(1);
    const straightHairline = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [zero()],
    });
    expect(cadPolylineHasArcCourse(straightHairline)).toBe(false);
    expect(cadPolylineHasNonzeroWidth(straightHairline)).toBe(false);
    expect(cadPolylineMaxHalfWidth(straightHairline)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H) Persistence / clipboard deep copy
// ---------------------------------------------------------------------------

describe('C2 persistence: deep-copy exact', () => {
  it('clone owns bulge/width arrays (no shared mutation)', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 1, endWidth: 1 }],
    });
    const clone = cloneCadEntity(entity) as CadPolylineEntity;
    expect(clone.segmentGeometry).toEqual(entity.segmentGeometry);
    expect(clone.segmentWidths).toEqual(entity.segmentWidths);
    expect(clone.segmentGeometry).not.toBe(entity.segmentGeometry);
    clone.segmentGeometry![0] = { kind: 'line' };
    expect(entity.segmentGeometry![0]).toEqual({ kind: 'arc', bulge: SEMI });
  });
});

// ---------------------------------------------------------------------------
// K) DXF
// ---------------------------------------------------------------------------

describe('C2 DXF: 42/40/41 on the START vertex, legacy stays 10/20 only', () => {
  it('arc emits 42 and nonzero width emits 40/41 on the course start vertex', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI), line('l', { x: 0, y: 0 }, { x: 0, y: 0 })],
      segmentWidths: [{ startWidth: 1, endWidth: 2 }, zero()],
    });
    const result = buildDxfExportModelWithResult({ project: projectWith(entity) });
    const model = result.output!;
    const poly = model.polylines.find((p) => p.vertices.length === 3);
    expect(poly).toBeDefined();
    expect(poly!.vertices[0]!.bulge).toBeCloseTo(SEMI, 9);
    expect(poly!.vertices[0]!.startWidth).toBe(1);
    expect(poly!.vertices[0]!.endWidth).toBe(2);
    // Final open vertex carries no metadata.
    expect(poly!.vertices[2]!.bulge).toBeUndefined();
    expect(poly!.vertices[2]!.startWidth).toBeUndefined();

    const dxf = serializeDxfModel(model);
    const lwpoly = dxf.split('LWPOLYLINE')[1] ?? '';
    expect(lwpoly).toContain('\n42\n');
    expect(lwpoly).toContain('\n40\n');
    expect(lwpoly).toContain('\n41\n');
  });

  it('legacy straight zero-width polyline emits byte-equivalent 10/20 only', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    const model = buildDxfExportModelWithResult({ project: projectWith(entity) }).output!;
    const poly = model.polylines.find((p) => p.vertices.length === 3)!;
    expect(poly.vertices.some((v) => v.bulge != null || v.startWidth != null || v.endWidth != null)).toBe(false);
    const dxf = serializeDxfModel(model);
    const lwpoly = dxf.split('LWPOLYLINE')[1] ?? '';
    expect(lwpoly).not.toContain('\n42\n');
    expect(lwpoly).not.toContain('\n40\n');
    expect(lwpoly).not.toContain('\n41\n');
  });

  it('block-table LWPOLYLINE children carry 42/40/41 metadata', () => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 1, endWidth: 1 }],
    });
    const project = projectWith();
    project.blockDefinitions = [
      { id: 'block:c2-dxf', name: 'C2 DXF Block', basePoint: { x: 0, y: 0 }, entities: [child] },
    ];
    project.entities.push({
      id: 'ref:c2-dxf',
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: 'block:c2-dxf',
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    });
    const dxf = serializeDxfModel(buildDxfExportModelWithResult({ project }).output!);
    const blocksSection = dxf.split('BLOCKS')[1] ?? '';
    expect(blocksSection).toContain('LWPOLYLINE');
    expect(blocksSection).toContain('\n42\n');
    expect(blocksSection).toContain('\n40\n');
    expect(blocksSection).toContain('\n41\n');
  });

  it('non-uniform INSERT over a bulged/wide polyline child is omitted with a warning', () => {
    const project = projectWith();
    project.blockDefinitions = [
      {
        id: 'block:c2-pl-insert',
        name: 'C2 PL Block',
        basePoint: { x: 0, y: 0 },
        entities: [
          polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
            segmentGeometry: [arc(SEMI)],
            segmentWidths: [{ startWidth: 1, endWidth: 1 }],
          }),
        ],
      },
    ];
    project.entities.push({
      id: 'ref:c2-pl-insert',
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: 'block:c2-pl-insert',
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 2,
      scaleY: 1,
    });
    const result = buildDxfExportModelWithResult({ project });
    expect(result.output.inserts ?? []).toHaveLength(0);
    expect(result.omittedEntityIds).toContain('ref:c2-pl-insert');
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/non-uniform scale over a bulged\/wide polyline child/);
  });

  it('uniform scale over the same bulged/wide polyline child stays exportable', () => {
    const project = projectWith();
    project.blockDefinitions = [
      {
        id: 'block:c2-pl-insert-u',
        name: 'C2 PL Block U',
        basePoint: { x: 0, y: 0 },
        entities: [
          polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
            segmentGeometry: [arc(SEMI)],
            segmentWidths: [{ startWidth: 1, endWidth: 1 }],
          }),
        ],
      },
    ];
    project.entities.push({
      id: 'ref:c2-pl-insert-u',
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: 'block:c2-pl-insert-u',
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 2,
      scaleY: 2,
    });
    const result = buildDxfExportModelWithResult({ project });
    expect(result.output.inserts ?? []).toHaveLength(1);
    expect(result.omittedEntityIds).not.toContain('ref:c2-pl-insert-u');
  });

  it('closed final stored vertex carries the last→first metadata and the closed bit is unchanged', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      closed: true,
      segmentGeometry: [line(), line(), arc(SEMI)],
      segmentWidths: [zero(), zero(), { startWidth: 1, endWidth: 1 }],
    });
    const model = buildDxfExportModelWithResult({ project: projectWith(entity) }).output!;
    const poly = model.polylines.find((p) => p.vertices.length === 3)!;
    expect(poly.closed).toBe(true);
    expect(poly.vertices[2]!.bulge).toBeCloseTo(SEMI, 9);
    expect(poly.vertices[2]!.startWidth).toBe(1);
  });

  it('omits malformed metadata polylines (mismatched geometry/width) instead of straightening them', () => {
    const badGeometry = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI)], // a 3-vertex open ring needs 2 course entries
    });
    const badWidths = polyline([{ x: 20, y: 0 }, { x: 30, y: 0 }], {
      segmentWidths: [zero(), zero()], // a 2-vertex open ring needs 1 width entry
    });
    const good = polyline([{ x: 40, y: 0 }, { x: 50, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 1, endWidth: 1 }],
    });
    const result = buildDxfExportModelWithResult({ project: projectWith(badGeometry, badWidths, good) });
    const model = result.output!;
    expect(result.omittedEntityIds).toContain(badGeometry.id);
    expect(result.omittedEntityIds).toContain(badWidths.id);
    expect(result.omittedEntityIds).not.toContain(good.id);
    // No straightened (valid-looking, zero-width) surrogate for either.
    expect(model.polylines.some((p) => p.sourceId === badGeometry.id)).toBe(false);
    expect(model.polylines.some((p) => p.sourceId === badWidths.id)).toBe(false);
    const goodPoly = model.polylines.find((p) => p.sourceId === good.id)!;
    expect(goodPoly.vertices[0]!.bulge).toBeCloseTo(SEMI, 9);
    expect(goodPoly.vertices[0]!.startWidth).toBe(1);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });

  it('omits a malformed block-child polyline instead of straightening it', () => {
    const malformedChild = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI)],
    });
    const project = projectWith();
    project.blockDefinitions = [
      { id: 'block:c2-malformed', name: 'C2 Malformed', basePoint: { x: 0, y: 0 }, entities: [malformedChild] },
    ];
    project.entities.push({
      id: 'ref:c2-malformed',
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: 'block:c2-malformed',
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    });
    const result = buildDxfExportModelWithResult({ project });
    const block = (result.output.blocks ?? []).find((entry) => entry.definitionId === 'block:c2-malformed')!;
    expect(block).toBeDefined();
    expect(block.polylines).toHaveLength(0);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });

  it('resolver fails closed on NaN/Infinity/negative widths and keeps the 0 boundary valid', () => {
    expect(
      resolveCadPolylineCourses(
        polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
          segmentWidths: [{ startWidth: NaN, endWidth: 0 }],
        }),
      ),
    ).toBeNull();
    expect(
      resolveCadPolylineCourses(
        polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
          segmentWidths: [{ startWidth: 0, endWidth: Infinity }],
        }),
      ),
    ).toBeNull();
    expect(
      resolveCadPolylineCourses(
        polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
          segmentWidths: [{ startWidth: -1, endWidth: 0 }],
        }),
      ),
    ).toBeNull();
    const boundary = resolveCadPolylineCourses(
      polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
        segmentWidths: [{ startWidth: 0, endWidth: 0 }],
      }),
    );
    expect(boundary).not.toBeNull();
    expect(boundary![0]!.width).toEqual({ startWidth: 0, endWidth: 0 });
  });

  it('omits entity polylines with malformed numeric widths instead of writing them as 0', () => {
    const nanWidth = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: NaN, endWidth: 0 }],
    });
    const infWidth = polyline([{ x: 20, y: 0 }, { x: 30, y: 0 }], {
      segmentWidths: [{ startWidth: 0, endWidth: Infinity }],
    });
    const negativeWidth = polyline([{ x: 40, y: 0 }, { x: 50, y: 0 }], {
      segmentWidths: [{ startWidth: -1, endWidth: 1 }],
    });
    const boundary = polyline([{ x: 60, y: 0 }, { x: 70, y: 0 }], {
      segmentWidths: [zero()],
    });
    const result = buildDxfExportModelWithResult({
      project: projectWith(nanWidth, infWidth, negativeWidth, boundary),
    });
    const model = result.output!;
    for (const bad of [nanWidth, infWidth, negativeWidth]) {
      expect(result.omittedEntityIds).toContain(bad.id);
      expect(model.polylines.some((p) => p.sourceId === bad.id)).toBe(false);
    }
    expect(result.omittedEntityIds).not.toContain(boundary.id);
    expect(model.polylines.some((p) => p.sourceId === boundary.id)).toBe(true);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });

  it('omits block-child polylines with malformed numeric widths instead of writing them as 0', () => {
    const nanChild = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: NaN, endWidth: 0 }],
    });
    const infChild = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: 0, endWidth: Infinity }],
    });
    const negativeChild = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: -1, endWidth: 0 }],
    });
    const validChild = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: 1, endWidth: 1 }],
    });
    const project = projectWith();
    project.blockDefinitions = [
      { id: 'block:c2-width-nan', name: 'C2 Width NaN', basePoint: { x: 0, y: 0 }, entities: [nanChild] },
      { id: 'block:c2-width-inf', name: 'C2 Width Inf', basePoint: { x: 0, y: 0 }, entities: [infChild] },
      { id: 'block:c2-width-neg', name: 'C2 Width Neg', basePoint: { x: 0, y: 0 }, entities: [negativeChild] },
      { id: 'block:c2-width-valid', name: 'C2 Width Valid', basePoint: { x: 0, y: 0 }, entities: [validChild] },
    ];
    for (const id of ['block:c2-width-nan', 'block:c2-width-inf', 'block:c2-width-neg', 'block:c2-width-valid']) {
      project.entities.push({
        id: `ref:${id}`,
        type: 'block-reference',
        layerId: 'general',
        visible: true,
        locked: false,
        blockDefinitionId: id,
        x: 0,
        y: 0,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1,
      });
    }
    const result = buildDxfExportModelWithResult({ project });
    const blocks = result.output.blocks ?? [];
    for (const id of ['block:c2-width-nan', 'block:c2-width-inf', 'block:c2-width-neg']) {
      const block = blocks.find((entry) => entry.definitionId === id)!;
      expect(block).toBeDefined();
      expect(block.polylines).toHaveLength(0);
    }
    const validBlock = blocks.find((entry) => entry.definitionId === 'block:c2-width-valid')!;
    expect(validBlock.polylines).toHaveLength(1);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });
});

// ---------------------------------------------------------------------------
// L) Fail-closed malformed geometry entries
// ---------------------------------------------------------------------------

describe('C2 fail closed: malformed geometry entries never resolve as a line', () => {
  const rawPolyline = (segmentGeometry: unknown): CadPolylineEntity => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    (entity as { segmentGeometry?: unknown }).segmentGeometry = segmentGeometry;
    return entity;
  };

  it('resolver returns null for undefined, unknown-kind, sub-floor, NaN, zero and zero-chord arc entries', () => {
    expect(resolveCadPolylineCourses(rawPolyline([undefined, { kind: 'line' }]))).toBeNull();
    expect(resolveCadPolylineCourses(rawPolyline([{ kind: 'bogus' }, { kind: 'line' }]))).toBeNull();
    expect(
      resolveCadPolylineCourses(rawPolyline([{ kind: 'arc', bulge: 1e-15 }, { kind: 'line' }])),
    ).toBeNull();
    expect(
      resolveCadPolylineCourses(rawPolyline([{ kind: 'arc', bulge: Number.NaN }, { kind: 'line' }])),
    ).toBeNull();
    expect(
      resolveCadPolylineCourses(rawPolyline([{ kind: 'arc', bulge: 0 }, { kind: 'line' }])),
    ).toBeNull();
    // Declared arc on a zero-length chord is constructible, so must fail closed.
    const zeroChord = polyline([{ x: 0, y: 0 }, { x: 0, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    expect(resolveCadPolylineCourses(zeroChord)).toBeNull();
  });

  it('still resolves valid line and arc entries', () => {
    const entity = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
      segmentGeometry: [arc(SEMI), line()],
    });
    const courses = resolveCadPolylineCourses(entity)!;
    expect(courses.map((course) => course.kind)).toEqual(['arc', 'line']);
  });

  it('entity DXF path omits and warns on an unknown-kind geometry entry', () => {
    const bad = rawPolyline([{ kind: 'bogus' }, { kind: 'line' }]);
    const good = polyline([{ x: 40, y: 0 }, { x: 50, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    const result = buildDxfExportModelWithResult({ project: projectWith(bad, good) });
    expect(result.omittedEntityIds).toContain(bad.id);
    expect(result.output!.polylines.some((p) => p.sourceId === bad.id)).toBe(false);
    expect(result.omittedEntityIds).not.toContain(good.id);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });

  it('block DXF path omits and warns on an unknown-kind geometry entry', () => {
    const malformedChild = rawPolyline([{ kind: 'bogus' }, { kind: 'line' }]);
    const project = projectWith();
    project.blockDefinitions = [
      { id: 'block:c2-unknown-kind', name: 'C2 Unknown Kind', basePoint: { x: 0, y: 0 }, entities: [malformedChild] },
    ];
    project.entities.push({
      id: 'ref:c2-unknown-kind',
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: 'block:c2-unknown-kind',
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    });
    const result = buildDxfExportModelWithResult({ project });
    const block = (result.output.blocks ?? []).find((entry) => entry.definitionId === 'block:c2-unknown-kind')!;
    expect(block).toBeDefined();
    expect(block.polylines).toHaveLength(0);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });
});

// ---------------------------------------------------------------------------
// L2) Sparse / non-array metadata fails closed everywhere
// ---------------------------------------------------------------------------

describe('C2 fail closed: sparse and non-array metadata never resolve or export', () => {
  const rawGeometry = (entity: CadPolylineEntity, value: unknown): CadPolylineEntity => {
    (entity as { segmentGeometry?: unknown }).segmentGeometry = value;
    return entity;
  };
  const rawWidths = (entity: CadPolylineEntity, value: unknown): CadPolylineEntity => {
    (entity as { segmentWidths?: unknown }).segmentWidths = value;
    return entity;
  };
  const twoVertex = (): CadPolylineEntity => polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const threeVertex = (): CadPolylineEntity =>
    polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);

  it('resolver returns null for a course-count-length sparse geometry array', () => {
    const sparseGeometry = new Array<CadPolylineSegmentGeometry>(2);
    sparseGeometry[1] = line();
    expect(resolveCadPolylineCourses(rawGeometry(threeVertex(), sparseGeometry))).toBeNull();
  });

  it('resolver returns null for a course-count-length sparse widths array (no zero substitute)', () => {
    const sparseWidths = new Array<CadPolylineSegmentWidth>(2);
    sparseWidths[0] = zero();
    expect(resolveCadPolylineCourses(rawWidths(threeVertex(), sparseWidths))).toBeNull();
  });

  it('resolver returns null (no throw) for non-array geometry and widths values', () => {
    const nonArrayGeometry = rawGeometry(twoVertex(), { length: 1, 0: { kind: 'line' } });
    expect(() => resolveCadPolylineCourses(nonArrayGeometry)).not.toThrow();
    expect(resolveCadPolylineCourses(nonArrayGeometry)).toBeNull();

    const nonArrayWidths = rawWidths(twoVertex(), { length: 1 });
    expect(() => resolveCadPolylineCourses(nonArrayWidths)).not.toThrow();
    expect(resolveCadPolylineCourses(nonArrayWidths)).toBeNull();
  });

  it('entity DXF path omits and warns on sparse geometry / non-array widths', () => {
    const sparseGeometry = new Array<CadPolylineSegmentGeometry>(2);
    sparseGeometry[1] = line();
    const sparseEntity = rawGeometry(threeVertex(), sparseGeometry);
    const nonArrayWidths = rawWidths(twoVertex(), { length: 1 });
    const good = polyline([{ x: 40, y: 0 }, { x: 50, y: 0 }], { segmentGeometry: [arc(SEMI)] });

    const result = buildDxfExportModelWithResult({ project: projectWith(sparseEntity, nonArrayWidths, good) });
    expect(result.omittedEntityIds).toContain(sparseEntity.id);
    expect(result.omittedEntityIds).toContain(nonArrayWidths.id);
    expect(result.output!.polylines.some((p) => p.sourceId === sparseEntity.id)).toBe(false);
    expect(result.output!.polylines.some((p) => p.sourceId === nonArrayWidths.id)).toBe(false);
    expect(result.omittedEntityIds).not.toContain(good.id);
    expect(result.output!.polylines.some((p) => p.sourceId === good.id)).toBe(true);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });

  it('block DXF path omits and warns on sparse geometry / non-array widths', () => {
    const sparseGeometry = new Array<CadPolylineSegmentGeometry>(2);
    sparseGeometry[1] = line();
    const sparseChild = rawGeometry(threeVertex(), sparseGeometry);
    const nonArrayWidthsChild = rawWidths(twoVertex(), { length: 1 });
    const validChild = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: 1, endWidth: 1 }],
    });
    const project = projectWith();
    project.blockDefinitions = [
      { id: 'block:c2-sparse-geom', name: 'C2 Sparse Geom', basePoint: { x: 0, y: 0 }, entities: [sparseChild] },
      { id: 'block:c2-nonarray-width', name: 'C2 Non-array Width', basePoint: { x: 0, y: 0 }, entities: [nonArrayWidthsChild] },
      { id: 'block:c2-sparse-valid', name: 'C2 Sparse Valid', basePoint: { x: 0, y: 0 }, entities: [validChild] },
    ];
    for (const id of ['block:c2-sparse-geom', 'block:c2-nonarray-width', 'block:c2-sparse-valid']) {
      project.entities.push({
        id: `ref:${id}`,
        type: 'block-reference',
        layerId: 'general',
        visible: true,
        locked: false,
        blockDefinitionId: id,
        x: 0,
        y: 0,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1,
      });
    }
    const result = buildDxfExportModelWithResult({ project });
    const blocks = result.output.blocks ?? [];
    for (const id of ['block:c2-sparse-geom', 'block:c2-nonarray-width']) {
      const block = blocks.find((entry) => entry.definitionId === id)!;
      expect(block).toBeDefined();
      expect(block.polylines).toHaveLength(0);
    }
    const validBlock = blocks.find((entry) => entry.definitionId === 'block:c2-sparse-valid')!;
    expect(validBlock.polylines).toHaveLength(1);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/malformed segment metadata/);
  });
});

// ---------------------------------------------------------------------------
// L3) Malformed entry + non-uniform INSERT omits before the definition path
// ---------------------------------------------------------------------------

describe('C2 fail closed: malformed entry + non-uniform INSERT omits and warns', () => {
  const nullWidthChild = (): CadPolylineEntity => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentWidths: [zero()] });
    (child.segmentWidths as unknown[])[0] = null;
    return child;
  };
  const nullGeometryChild = (): CadPolylineEntity => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [line()] });
    (child.segmentGeometry as unknown[])[0] = null;
    return child;
  };
  const projectWithInsert = (definitionId: string, child: CadPolylineEntity): CadProject => {
    const project = projectWith();
    project.blockDefinitions = [
      { id: definitionId, name: definitionId, basePoint: { x: 0, y: 0 }, entities: [child] },
    ];
    project.entities.push({
      id: `ref:${definitionId}`,
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: definitionId,
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 2,
      scaleY: 1,
    });
    return project;
  };

  it('null width entry + non-uniform INSERT ⇒ omitted + warned, no throw', () => {
    const project = projectWithInsert('block:c2-null-width-insert', nullWidthChild());
    let result!: ReturnType<typeof buildDxfExportModelWithResult>;
    expect(() => {
      result = buildDxfExportModelWithResult({ project });
    }).not.toThrow();
    expect(result.omittedEntityIds).toContain('ref:block:c2-null-width-insert');
    expect(result.output!.inserts ?? []).toHaveLength(0);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(
      /non-uniform scale over a bulged\/wide polyline child/,
    );
  });

  it('null geometry entry + non-uniform INSERT ⇒ omitted + warned, no throw', () => {
    const project = projectWithInsert('block:c2-null-geom-insert', nullGeometryChild());
    let result!: ReturnType<typeof buildDxfExportModelWithResult>;
    expect(() => {
      result = buildDxfExportModelWithResult({ project });
    }).not.toThrow();
    expect(result.omittedEntityIds).toContain('ref:block:c2-null-geom-insert');
    expect(result.output!.inserts ?? []).toHaveLength(0);
    expect(JSON.stringify(result.warnings ?? [])).toMatch(
      /non-uniform scale over a bulged\/wide polyline child/,
    );
  });

  it('valid bulged/wide child + non-uniform INSERT still omits (unchanged)', () => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
      segmentWidths: [{ startWidth: 1, endWidth: 1 }],
    });
    const result = buildDxfExportModelWithResult({
      project: projectWithInsert('block:c2-valid-insert', child),
    });
    expect(result.omittedEntityIds).toContain('ref:block:c2-valid-insert');
    expect(result.output!.inserts ?? []).toHaveLength(0);
  });

  it('valid straight zero-width child + non-uniform INSERT still exports (unchanged)', () => {
    const child = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = buildDxfExportModelWithResult({
      project: projectWithInsert('block:c2-straight-insert', child),
    });
    expect(result.omittedEntityIds).not.toContain('ref:block:c2-straight-insert');
    expect(result.output!.inserts ?? []).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// M) Edit safety
// ---------------------------------------------------------------------------

describe('C2 edit safety: chord-based kernels refuse bulged/wide polylines', () => {
  it('isTrimmableEntity and buildTrimSegments fail closed on arc/width metadata', () => {
    const curved = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], { segmentGeometry: [arc(SEMI)] });
    expect(isTrimmableEntity(curved)).toBe(false);
    expect(buildTrimSegments(curved)).toEqual([]);

    const wide = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: 1, endWidth: 1 }],
    });
    expect(isTrimmableEntity(wide)).toBe(false);

    const straight = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(isTrimmableEntity(straight)).toBe(true);
    expect(buildTrimSegments(straight)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// N) Round-7 correction: sparse metadata is malformed on the safe side, and
//    present-but-unresolvable metadata never renders/snaps as chords.
// ---------------------------------------------------------------------------

describe('C2 round-7: sparse metadata is malformed on the safe side everywhere', () => {
  const withSparseGeometry = (
    entity: CadPolylineEntity,
    length: number,
  ): CadPolylineEntity => {
    (entity as { segmentGeometry?: unknown }).segmentGeometry =
      new Array<CadPolylineSegmentGeometry>(length);
    return entity;
  };
  const withSparseWidths = (
    entity: CadPolylineEntity,
    length: number,
  ): CadPolylineEntity => {
    (entity as { segmentWidths?: unknown }).segmentWidths =
      new Array<CadPolylineSegmentWidth>(length);
    return entity;
  };
  const sparseGeometryEntity = (): CadPolylineEntity =>
    withSparseGeometry(polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 1);
  const sparseWidthEntity = (): CadPolylineEntity =>
    withSparseWidths(polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 1);

  it('sparse geometry array ⇒ HasArcCourse true (hole treated as malformed)', () => {
    const entity = sparseGeometryEntity();
    expect(cadPolylineHasArcCourse(entity)).toBe(true);
    expect(cadPolylineHasCurveOrWidth(entity)).toBe(true);
    expect(resolveCadPolylineCourses(entity)).toBeNull();
  });

  it('sparse widths array ⇒ HasNonzeroWidth true (hole treated as malformed)', () => {
    const entity = sparseWidthEntity();
    expect(cadPolylineHasNonzeroWidth(entity)).toBe(true);
    expect(cadPolylineHasCurveOrWidth(entity)).toBe(true);
    expect(resolveCadPolylineCourses(entity)).toBeNull();
  });

  it('trim guard refuses a sparse-metadata polyline', () => {
    for (const entity of [sparseGeometryEntity(), sparseWidthEntity()]) {
      expect(isTrimmableEntity(entity)).toBe(false);
      expect(buildTrimSegments(entity)).toEqual([]);
    }
  });

  it('block non-uniform guard triggers on sparse metadata', () => {
    for (const child of [sparseGeometryEntity(), sparseWidthEntity()]) {
      const definition: CadBlockDefinition = {
        id: `block:c2-sparse-${child.id}`,
        name: 'C2 Sparse',
        basePoint: { x: 0, y: 0 },
        entities: [child],
      };
      expect(blockReferenceScalesDistortPolylineCurve(definition, 2, 1)).toBe(true);
      expect(() =>
        expandBlockReference(definition, { x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1 }),
      ).toThrow(/CAD_BLOCK_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED/);
    }
  });

  it('renderer emits zero primitives for present-but-malformed metadata; legacy still renders', () => {
    const malformedSparse = sparseGeometryEntity();
    expect(
      buildCadDisplayScene(projectWith(malformedSparse)).primitives.filter(
        (primitive) => primitive.sourceEntityId === malformedSparse.id,
      ),
    ).toHaveLength(0);

    // Present geometry whose length does not match the course count.
    const mismatched = polyline([{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }], {
      segmentGeometry: [arc(SEMI)],
    });
    expect(
      buildCadDisplayScene(projectWith(mismatched)).primitives.filter(
        (primitive) => primitive.sourceEntityId === mismatched.id,
      ),
    ).toHaveLength(0);

    // Legacy (metadata absent) still draws its straight vertex path.
    const legacy = polyline([{ x: 40, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 10 }]);
    const legacyPrimitives = buildCadDisplayScene(projectWith(legacy)).primitives.filter(
      (primitive) => primitive.sourceEntityId === legacy.id,
    );
    expect(legacyPrimitives).toHaveLength(2);
    expect(legacyPrimitives.every((primitive) => primitive.kind === 'line')).toBe(true);
  });

  it('block snaps emit zero child candidates for malformed; legacy unchanged', () => {
    const insert = (definitionId: string): CadBlockReferenceEntity => ({
      id: `ref:${definitionId}`,
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: definitionId,
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    });
    const candidatesFor = (
      definition: CadBlockDefinition,
    ): ReturnType<typeof buildBlockReferenceSnapCandidates> => {
      const project = projectWith();
      project.blockDefinitions = [definition];
      const context = {
        project,
        allowed: new Set(['endpoint', 'midpoint', 'center', 'nearest']),
        worldPoint: { x: 5, y: 0 },
      } as unknown as Parameters<typeof buildBlockReferenceSnapCandidates>[0];
      return buildBlockReferenceSnapCandidates(context, insert(definition.id));
    };

    const malformedDefinition: CadBlockDefinition = {
      id: 'block:c2-snap-malformed',
      name: 'C2 Snap Malformed',
      basePoint: { x: 0, y: 0 },
      entities: [sparseGeometryEntity()],
    };
    // Only the reference insertion-point endpoint remains; the malformed
    // child contributes no vertex/midpoint/center candidates.
    expect(
      candidatesFor(malformedDefinition).filter((candidate) => candidate.sourceSegmentId != null),
    ).toHaveLength(0);

    const legacyDefinition: CadBlockDefinition = {
      id: 'block:c2-snap-legacy',
      name: 'C2 Snap Legacy',
      basePoint: { x: 0, y: 0 },
      entities: [polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }])],
    };
    expect(
      candidatesFor(legacyDefinition).filter((candidate) => candidate.sourceSegmentId != null).length,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// O) Round-8 correction: presence-aware guards. Any PRESENT metadata array that
//    does not exactly match the resolved course count is malformed and fails
//    closed (TRUE) in EVERY guard consumer — trim, blocks, and the affine
//    transform — instead of the guards answering false for unreadable shapes.
// ---------------------------------------------------------------------------

describe('C2 round-8: present-but-unresolvable metadata fails closed in every guard', () => {
  const rawGeometry = (entity: CadPolylineEntity, value: unknown): CadPolylineEntity => {
    (entity as { segmentGeometry?: unknown }).segmentGeometry = value;
    return entity;
  };
  const rawWidths = (entity: CadPolylineEntity, value: unknown): CadPolylineEntity => {
    (entity as { segmentWidths?: unknown }).segmentWidths = value;
    return entity;
  };
  const twoVertex = (): CadPolylineEntity => polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const threeVertex = (): CadPolylineEntity =>
    polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  const affine = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

  const nonArrayGeometry = (): CadPolylineEntity =>
    rawGeometry(twoVertex(), { length: 1, 0: { kind: 'line' } });
  const nonArrayWidths = (): CadPolylineEntity => rawWidths(twoVertex(), { length: 1 });
  // Two-course ring (three vertices) carrying a ONE-entry metadata array.
  const wrongCountGeometry = (): CadPolylineEntity => rawGeometry(threeVertex(), [line()]);
  const wrongCountWidths = (): CadPolylineEntity => rawWidths(threeVertex(), [zero()]);

  it('non-array geometry ⇒ HasArcCourse true; wrong-count geometry ⇒ true', () => {
    expect(cadPolylineHasArcCourse(nonArrayGeometry())).toBe(true);
    expect(cadPolylineHasArcCourse(wrongCountGeometry())).toBe(true);
    expect(cadPolylineHasCurveOrWidth(nonArrayGeometry())).toBe(true);
    expect(cadPolylineHasCurveOrWidth(wrongCountGeometry())).toBe(true);
    expect(resolveCadPolylineCourses(nonArrayGeometry())).toBeNull();
    expect(resolveCadPolylineCourses(wrongCountGeometry())).toBeNull();
  });

  it('non-array widths ⇒ HasNonzeroWidth true; wrong-count widths ⇒ true', () => {
    expect(cadPolylineHasNonzeroWidth(nonArrayWidths())).toBe(true);
    expect(cadPolylineHasNonzeroWidth(wrongCountWidths())).toBe(true);
    expect(cadPolylineHasCurveOrWidth(nonArrayWidths())).toBe(true);
    expect(cadPolylineHasCurveOrWidth(wrongCountWidths())).toBe(true);
    expect(resolveCadPolylineCourses(nonArrayWidths())).toBeNull();
    expect(resolveCadPolylineCourses(wrongCountWidths())).toBeNull();
  });

  it('GENERAL_AFFINE refuses sparse, wrong-count, and non-array metadata', () => {
    const sparseGeometry = new Array<CadPolylineSegmentGeometry>(2);
    sparseGeometry[1] = line();
    const sparseWidths = new Array<CadPolylineSegmentWidth>(2);
    sparseWidths[0] = zero();
    const cases = [
      rawGeometry(threeVertex(), sparseGeometry),
      rawWidths(threeVertex(), sparseWidths),
      nonArrayGeometry(),
      nonArrayWidths(),
      wrongCountGeometry(),
      wrongCountWidths(),
    ];
    for (const entity of cases) {
      const result = transformCadEntityGeometry(entity, affine, classifyTransform(affine)!);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('CAD_TRANSFORM_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED');
    }
  });

  it('trim refuses wrong-count and non-array metadata', () => {
    for (const entity of [
      nonArrayGeometry(),
      nonArrayWidths(),
      wrongCountGeometry(),
      wrongCountWidths(),
    ]) {
      expect(isTrimmableEntity(entity)).toBe(false);
      expect(buildTrimSegments(entity)).toEqual([]);
    }
  });

  it('block non-uniform guard triggers on wrong-count and non-array metadata', () => {
    for (const child of [
      nonArrayGeometry(),
      nonArrayWidths(),
      wrongCountGeometry(),
      wrongCountWidths(),
    ]) {
      const definition: CadBlockDefinition = {
        id: `block:c2-round8-${child.id}`,
        name: 'C2 Round 8',
        basePoint: { x: 0, y: 0 },
        entities: [child],
      };
      expect(blockReferenceScalesDistortPolylineCurve(definition, 2, 1)).toBe(true);
      expect(() =>
        expandBlockReference(definition, { x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1 }),
      ).toThrow(/CAD_BLOCK_POLYLINE_NON_UNIFORM_ARC_WIDTH_UNSUPPORTED/);
    }
  });

  it('valid and legacy inputs keep exact guard/trim/transform behavior', () => {
    const legacy = twoVertex();
    expect(cadPolylineHasArcCourse(legacy)).toBe(false);
    expect(cadPolylineHasNonzeroWidth(legacy)).toBe(false);
    expect(isTrimmableEntity(legacy)).toBe(true);
    expect(transformCadEntityGeometry(legacy, affine, classifyTransform(affine)!).ok).toBe(true);

    const validLine = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [line()],
      segmentWidths: [zero()],
    });
    expect(cadPolylineHasArcCourse(validLine)).toBe(false);
    expect(cadPolylineHasNonzeroWidth(validLine)).toBe(false);
    expect(isTrimmableEntity(validLine)).toBe(true);

    const validArc = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentGeometry: [arc(SEMI)],
    });
    expect(cadPolylineHasArcCourse(validArc)).toBe(true);
    expect(cadPolylineHasNonzeroWidth(validArc)).toBe(false);
    expect(isTrimmableEntity(validArc)).toBe(false);

    const validWide = polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], {
      segmentWidths: [{ startWidth: 1, endWidth: 2 }],
    });
    expect(cadPolylineHasArcCourse(validWide)).toBe(false);
    expect(cadPolylineHasNonzeroWidth(validWide)).toBe(true);
    expect(isTrimmableEntity(validWide)).toBe(false);
  });
});
