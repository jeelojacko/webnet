// Phase 19C Round 2A — curved-parcel INTERACTION (render/hit/snaps/grips/inquiry).
//
// Outline authority is exact (native arc primitives), edge interaction rides
// true arc distance + sweep containment (never the hidden chord), grips keep
// sweep constant under the stored bulge, inquiry reports counts + curve
// metrics. Reuses the Round-1 seams only; no display tessellation as
// authority, no parcel-only snap math.
import { describe, expect, it } from 'vitest';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  describeParcelArcCourse,
} from '../src/engine/cad/cadParcelArcGeometry';
import {
  buildParcelCourseIds,
  buildParcelCourseReportSummary,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import { buildCadBounds } from '../src/engine/cad/cadProjectState';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { buildCadSpatialIndex } from '../src/engine/cad/cadSpatialIndex';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import { applyCadGripEdit } from '../src/engine/cad/cadTransactionsEntityTransforms';
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
  const id = `parcel-19c-i${(parcelSeq += 1)}`;
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Parcel I${parcelSeq}`,
    courseIds: buildParcelCourseIds(id, vertices.length),
    ...(courseGeometry != null ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
    parcel.closureDeltaX = metrics.closureDeltaX;
    parcel.closureDeltaY = metrics.closureDeltaY;
    parcel.closureDistanceMeters = metrics.closureDistanceMeters;
  }
  return parcel;
};

const projectWith = (parcel: CadParcelEntity): CadProject =>
  ({ ...createBlankCadProject({ name: 'interact-19c', units: 'm' as const }), entities: [parcel] });

const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

// Square with the east course arcing outward east (b>0 = CCW = center-left
// = west of the northward traversal, so the arc rides east of the x=10
// chord); sagitta ≈ 2.5 m off the chord.
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

describe('19C renderer emits native arc primitives for arc courses', () => {
  it('arc courses render as arc kind with exact center/radius/sweep; lines stay lines', () => {
    const parcel = eastArcSquare();
    const scene = buildCadDisplayScene(projectWith(parcel));
    const prims = scene.primitives.filter((primitive) => primitive.sourceEntityId === parcel.id);
    // 4 outline primitives + 1 parcel label.
    expect(prims.filter((primitive) => primitive.kind === 'line')).toHaveLength(3);
    const arcPrims = prims.filter((primitive) => primitive.kind === 'arc');
    expect(arcPrims).toHaveLength(1);
    const arcPrim = arcPrims[0]!;
    expect(arcPrim.kind).toBe('arc');
    if (arcPrim.kind !== 'arc') throw new Error('expected arc primitive');
    const metrics = describeParcelArcCourse({ x: 10, y: 0 }, { x: 10, y: 10 }, 0.5)!;
    expect(arcPrim.center.x).toBeCloseTo(metrics.center.x, 12);
    expect(arcPrim.center.y).toBeCloseTo(metrics.center.y, 12);
    expect(arcPrim.radius).toBeCloseTo(metrics.radius, 12);
    expect(arcPrim.startAngleDeg).toBeCloseTo(metrics.startAngleDeg, 12);
    expect(arcPrim.endAngleDeg).toBeCloseTo(metrics.endAngleDeg, 12);
    expect(arcPrim.sourceSegmentId).toBe(`${parcel.id}#1`);
  });

  it('legacy and all-line parcels keep the byte-identical chord path (no arc primitives)', () => {
    const legacy = makeParcel([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
    const scene = buildCadDisplayScene(projectWith(legacy));
    const prims = scene.primitives.filter((primitive) => primitive.sourceEntityId === legacy.id);
    expect(prims.every((primitive) => primitive.kind === 'line' || primitive.kind === 'text')).toBe(true);
    expect(prims.filter((primitive) => primitive.kind === 'line')).toHaveLength(4);
    expect(prims.filter((primitive) => primitive.kind === 'arc')).toHaveLength(0);
  });

  it('area/perimeter label uses exact curved metrics', () => {
    const parcel = eastArcSquare();
    const scene = buildCadDisplayScene(projectWith(parcel));
    const label = scene.primitives.find(
      (primitive) => primitive.kind === 'text' && primitive.id.endsWith(':parcel-label'),
    );
    expect(label?.kind).toBe('text');
    if (label?.kind !== 'text') throw new Error('expected parcel label');
    // Curved perimeter (100 + arc − chord correction), never the 40 m chord sum.
    expect(label.text).toContain(parcel.perimeterMeters!.toFixed(3));
    expect(label.text).not.toContain('40.000 m');
  });
});

describe('19C bounds include major-arc extrema', () => {
  it('270-degree arc bounds reach the far extrema', () => {
    const parcel = makeParcel(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      [line, arc(-Math.tan((3 * Math.PI) / 8)), line],
    );
    const bounds = buildCadBounds([parcel])!;
    expect(bounds.minX).toBeCloseTo(-10, 8);
    expect(bounds.minY).toBeCloseTo(-10, 8);
    expect(bounds.maxX).toBeCloseTo(10, 8);
    expect(bounds.maxY).toBeCloseTo(10, 8);
  });

  it('entity box query hits the bulge outside the chords, misses far boxes', () => {
    const parcel = eastArcSquare();
    const project = projectWith(parcel);
    // Bulge box east of the x=10 chord: no chord passes through it.
    expect(
      entityIntersectsBounds(project, parcel, { minX: 11, minY: 4, maxX: 13, maxY: 6 }),
    ).toBe(true);
    expect(
      entityIntersectsBounds(project, parcel, { minX: 50, minY: 50, maxX: 60, maxY: 60 }),
    ).toBe(false);
  });
});

describe('19C snaps ride true arc distance, never the hidden chord', () => {
  it('on-arc: nearest + arc-midpoint snaps resolve to the parcel arc', () => {
    const parcel = eastArcSquare();
    const project = projectWith(parcel);
    const index = buildCadSpatialIndex(project);
    const metrics = describeParcelArcCourse({ x: 10, y: 0 }, { x: 10, y: 10 }, 0.5)!;
    const hit = index.queryNearestSnap(metrics.midpoint, 1, ['nearest']);
    expect(hit?.sourceEntityId).toBe(parcel.id);
    expect(hit?.kind).toBe('nearest');
    expect(hit!.distance).toBeCloseTo(0, 9);
    const mid = index.queryNearestSnap(metrics.midpoint, 1, ['arc-midpoint']);
    expect(mid?.sourceEntityId).toBe(parcel.id);
    expect(mid?.kind).toBe('arc-midpoint');
  });

  it('on-chord-negative: no chord midpoint snap on the arc course', () => {
    const parcel = eastArcSquare();
    const project = projectWith(parcel);
    const index = buildCadSpatialIndex(project);
    // Chord midpoint of the arc course (10,5): the arc rides ~2.5 m east.
    // A midpoint-kind query must NOT invent a chord midpoint there.
    const mid = index.queryNearestSnap({ x: 10, y: 5 }, 5, ['midpoint']);
    const parcelMid =
      mid?.sourceEntityId === parcel.id && mid.kind === 'midpoint' ? mid : null;
    expect(parcelMid).toBeNull();
    // Endpoint snaps still resolve (shared vertices are exact).
    const end = index.queryNearestSnap({ x: 10, y: 0 }, 1, ['endpoint']);
    expect(end?.sourceEntityId).toBe(parcel.id);
    expect(end?.kind).toBe('endpoint');
  });
});

describe('19C grip move keeps sweep constant (bulge stored, radius derived)', () => {
  it('dragging a shared vertex preserves sweep, re-derives radius, keeps bulge entry', () => {
    const parcel = eastArcSquare();
    const before = resolveCadParcelCourses(parcel)[1]!;
    expect(before.kind).toBe('arc');
    if (before.kind !== 'arc') throw new Error('expected arc');
    // Drag P3 (10,10) east: the arc course re-curves through it.
    const next = applyCadGripEdit(projectWith(parcel), {
      key: 'GRIP_EDIT',
      entityId: parcel.id,
      gripKind: 'vertex',
      vertexIndex: 2,
      x: 12,
      y: 10,
    });
    expect(next).not.toBeNull();
    const moved = next!.entities.find((entity) => entity.id === parcel.id)!;
    expect(moved.type).toBe('parcel');
    if (moved.type !== 'parcel') throw new Error('expected parcel');
    // Stored bulge untouched: sweep constant is structural, not numeric luck.
    expect(moved.courseGeometry?.[1]).toEqual({ kind: 'arc', bulge: 0.5 });
    const after = resolveCadParcelCourses(moved)[1]!;
    expect(after.kind).toBe('arc');
    if (after.kind !== 'arc') throw new Error('expected arc');
    expect(after.signedSweepDeg).toBeCloseTo(before.signedSweepDeg, 9);
    expect(after.direction).toBe(before.direction);
    // Radius/center derived from the moved endpoints — visibly re-curved.
    expect(after.radius).not.toBeCloseTo(before.radius, 3);
    expect(after.center.x).not.toBeCloseTo(before.center.x, 3);
    // Metrics recomputed through the exact curved closure.
    const closure = cadBuildParcelClosureSummary(moved.vertices, {
      courseGeometry: moved.courseGeometry,
    })!;
    expect(moved.perimeterMeters).toBeCloseTo(closure.perimeterMeters, 9);
    expect(moved.areaSquareMeters).toBeCloseTo(closure.areaSquareMeters, 9);
  });
});

describe('19C inquiry: counts + per-course curve metrics', () => {
  it('report carries line/arc counts and arc curve details', () => {
    const report = buildParcelCourseReportSummary(eastArcSquare())!;
    expect(report.courseCount).toBe(4);
    expect(report.lineCount).toBe(3);
    expect(report.arcCount).toBe(1);
    const arcs = report.curveDetails!.filter((detail) => detail.kind === 'arc');
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.radius).toBeCloseTo(6.25, 9);
    expect(arcs[0]!.direction).toBe('left');
    // Arc length = curved perimeter minus the three 10 m chord courses.
    expect(arcs[0]!.arcLength).toBeCloseTo(report.perimeterMeters - 30, 6);
  });

  it('properties panel shows counts and the curve row (no raw dumps)', () => {
    const parcel = eastArcSquare();
    const state = buildCadPropertiesPanelState(projectWith(parcel), [parcel]);
    expect(state?.mode).toBe('single');
    if (state?.mode !== 'single') throw new Error('expected single view');
    const byKey = new Map(state.entity.properties.map((row) => [row.key, row.value]));
    expect(byKey.get('course-count')).toBe('4');
    expect(byKey.get('line-count')).toBe('3');
    expect(byKey.get('arc-count')).toBe('1');
    const curveRows = state.entity.properties.filter((row) => row.key.startsWith('curve:'));
    expect(curveRows).toHaveLength(1);
    expect(curveRows[0]!.value).toMatch(/R .*· Δ .*· L .*· chord/);
    expect(curveRows[0]!.value).not.toMatch(/bulge|[{}]/);
  });

  it('straight parcels report zero arcs (additive, byte-compatible shape)', () => {
    const report = buildParcelCourseReportSummary(
      makeParcel([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    )!;
    expect(report.arcCount).toBe(0);
    expect(report.lineCount).toBe(4);
    expect(report.courses).toHaveLength(4);
  });
});
