// Phase 19C Round 2B — curved parcel splits, containment, creation oracles.
import { describe, expect, it } from 'vitest';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { cadPointInPolygon } from '../src/engine/cad/cadCogoParcelGeometryPrimitives';
import {
  cadBuildParcelSplitByAreaDraft,
  cadBuildParcelSplitByBearingDraft,
  cadBuildParcelSplitByLineDraft,
  cadBuildParcelSplitByLineDraftDetailed,
} from '../src/engine/cad/cadCogoParcelSplit';
import { cadBuildParcelSplitBySlideDraft } from '../src/engine/cad/cadCogoParcelLayoutSlide';
import { cadBuildParcelSplitBySwingDraft } from '../src/engine/cad/cadCogoParcelLayoutSwing';
import { cadClassifyParcelBoundaryPoint, cadPointInCurvedParcel } from '../src/engine/cad/cadParcelContainment';
import {
  buildParcelCourseIds,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import {
  buildParcelCourseTopology,
  validateParcelBoundaryTopology,
  validateParcelCourseGeometry,
} from '../src/engine/cad/cadParcelArcGeometry';
import { cadBuildParcelSourceDraft } from '../src/engine/cad/cadCogoParcelGeometrySourceDraft';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { resolveParcelSplitFrontageSource } from '../src/engine/cad/cadTransactionsParcelLayoutFrontage';
import type {
  CadArcEntity,
  CadLineEntity,
  CadParcelCourseGeometry,
  CadParcelEntity,
} from '../src/engine/cad/cadTypes';

let parcelSeq = 0;
interface Vertex {
  x: number;
  y: number;
}

const makeParcel = (
  vertices: Vertex[],
  courseGeometry?: CadParcelCourseGeometry[],
  id?: string,
): CadParcelEntity => {
  const parcelId = id ?? `parcel-split-19c-${(parcelSeq += 1)}`;
  const parcel: CadParcelEntity = {
    id: parcelId,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Parcel ${parcelSeq}`,
    courseIds: buildParcelCourseIds(parcelId, vertices.length),
    ...(courseGeometry ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

const lineGeometry: CadParcelCourseGeometry = { kind: 'line' };

/** D-shape: rectangle 10x10 with a semicircular arc on the v0→v1 course. */
const makeDShape = (bulge = 1): CadParcelEntity =>
  makeParcel(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    [{ kind: 'arc', bulge }, lineGeometry, lineGeometry, lineGeometry],
  );

const childMetrics = (draft: { firstVertices: Vertex[]; secondVertices: Vertex[]; firstCourseGeometry?: CadParcelCourseGeometry[]; secondCourseGeometry?: CadParcelCourseGeometry[] }): {
  first: ReturnType<typeof cadBuildParcelClosureSummary>;
  second: ReturnType<typeof cadBuildParcelClosureSummary>;
} => ({
  first: cadBuildParcelClosureSummary(
    draft.firstVertices,
    draft.firstCourseGeometry ? { courseGeometry: draft.firstCourseGeometry } : undefined,
  ),
  second: cadBuildParcelClosureSummary(
    draft.secondVertices,
    draft.secondCourseGeometry ? { courseGeometry: draft.secondCourseGeometry } : undefined,
  ),
});

const splitLine = (from: Vertex, to: Vertex): CadLineEntity => ({
  id: `split-${from.x}-${from.y}`,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'S1',
  toStationId: 'S2',
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
  sourceObservationIds: [],
});

const frontageLine = (from: Vertex, to: Vertex): CadLineEntity => ({
  ...splitLine(from, to),
  id: 'frontage-line',
  fromStationId: 'F1',
  toStationId: 'F2',
});

const arcSweepSum = (parcel: CadParcelEntity): number =>
  resolveCadParcelCourses(parcel)
    .filter((course) => course.kind === 'arc')
    .reduce((total, course) => total + (course.kind === 'arc' ? course.signedSweepDeg : 0), 0);

const arcLengthSum = (parcel: CadParcelEntity): number =>
  resolveCadParcelCourses(parcel)
    .filter((course) => course.kind === 'arc')
    .reduce((total, course) => total + (course.kind === 'arc' ? course.arcLength : 0), 0);

const parcelFromDraftChild = (
  vertices: Vertex[],
  geometry: CadParcelCourseGeometry[] | undefined,
): CadParcelEntity => makeParcel(vertices, geometry);

describe('19C containment (analytic line/arc winding)', () => {
  it('classifies straight parcels identically to cadPointInPolygon (differential)', () => {
    const concave: Vertex[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const parcel = makeParcel(concave);
    for (let x = -2; x <= 22; x += 1) {
      for (let y = -2; y <= 22; y += 1) {
        const point = { x, y };
        expect(cadPointInCurvedParcel(parcel, point)).toBe(cadPointInPolygon(point, concave));
      }
    }
  });

  it('classifies inside / boundary / outside on a curved parcel exactly', () => {
    const parcel = makeDShape(1); // south semicircle
    expect(cadClassifyParcelBoundaryPoint({ vertices: parcel.vertices, courseGeometry: parcel.courseGeometry, point: { x: 5, y: 5 } })).toBe('inside');
    expect(cadClassifyParcelBoundaryPoint({ vertices: parcel.vertices, courseGeometry: parcel.courseGeometry, point: { x: 5, y: -5 } })).toBe('boundary');
    expect(cadClassifyParcelBoundaryPoint({ vertices: parcel.vertices, courseGeometry: parcel.courseGeometry, point: { x: 5, y: -9 } })).toBe('outside');
    // Concave arc (north semicircle): notch interior is OUTSIDE the region.
    const concave = makeDShape(-1);
    expect(cadPointInCurvedParcel(concave, { x: 5, y: 2 })).toBe(false);
    expect(cadPointInCurvedParcel(concave, { x: 5, y: 8 })).toBe(true);
  });
});

describe('19C split by line with an arc boundary', () => {
  it('splits through a semicircular course with exact sub-arcs and area/perimeter conservation', () => {
    const parcel = makeDShape(1);
    const draft = cadBuildParcelSplitByLineDraft(
      parcel,
      splitLine({ x: 5, y: -20 }, { x: 5, y: 20 }),
    );
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.firstCourseGeometry).toBeDefined();
    expect(draft.secondCourseGeometry).toBeDefined();
    expect(validateParcelCourseGeometry(draft.firstVertices, draft.firstCourseGeometry).ok).toBe(true);
    expect(validateParcelCourseGeometry(draft.secondVertices, draft.secondCourseGeometry).ok).toBe(true);

    const parentBefore = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry })!;
    const { first, second } = childMetrics(draft);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // Area conservation.
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(parentBefore.areaSquareMeters, 6);
    // Sweep + arc-length sums conserved.
    const firstParcel = parcelFromDraftChild(draft.firstVertices, draft.firstCourseGeometry);
    const secondParcel = parcelFromDraftChild(draft.secondVertices, draft.secondCourseGeometry);
    expect(arcSweepSum(firstParcel) + arcSweepSum(secondParcel)).toBeCloseTo(arcSweepSum(parcel), 6);
    expect(arcLengthSum(firstParcel) + arcLengthSum(secondParcel)).toBeCloseTo(arcLengthSum(parcel), 6);
    // Perimeter identity P1 + P2 = P + 2S.
    const cutLength = Math.hypot(draft.splitEnd.x - draft.splitStart.x, draft.splitEnd.y - draft.splitStart.y);
    expect(first!.perimeterMeters + second!.perimeterMeters).toBeCloseTo(
      parentBefore.perimeterMeters + 2 * cutLength,
      6,
    );
  });

  it('rejects >2 crossings, same-course twice, tangent-only, and boundary overlap explicitly', () => {
    const convex = makeDShape(1);
    const concave = makeDShape(-1);
    expect(
      cadBuildParcelSplitByLineDraftDetailed(concave, splitLine({ x: -5, y: 2 }, { x: 15, y: 2 })).reason,
    ).toBe('TOO_MANY_CROSSINGS');
    expect(
      cadBuildParcelSplitByLineDraftDetailed(convex, splitLine({ x: -5, y: -2 }, { x: 25, y: -2 })).reason,
    ).toBe('SAME_COURSE_TWICE');
    expect(
      cadBuildParcelSplitByLineDraftDetailed(convex, splitLine({ x: -5, y: -5 }, { x: 25, y: -5 })).reason,
    ).toBe('TANGENT_ONLY');
    expect(
      cadBuildParcelSplitByLineDraftDetailed(convex, splitLine({ x: 2, y: 10 }, { x: 8, y: 10 })).reason,
    ).toBe('BOUNDARY_OVERLAP');
  });

  it('bearing split through a semicircular frontage preserves curves', () => {
    const draft = cadBuildParcelSplitByBearingDraft(makeDShape(1), { x: 5, y: 5 }, 'N 0° E');
    expect(draft).not.toBeNull();
    expect(draft?.firstCourseGeometry).toBeDefined();
    const { first, second } = childMetrics(draft!);
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(139.269908, 5);
  });

  it('bearing split through a concave arc boundary stays exact', () => {
    const parcel = makeDShape(-1);
    const draft = cadBuildParcelSplitByBearingDraft(parcel, { x: 5, y: 8 }, 'N 0° E');
    expect(draft).not.toBeNull();
    const { first, second } = childMetrics(draft!);
    const parent = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry })!;
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(parent.areaSquareMeters, 6);
  });
});

describe('19C split by target area on a curved parcel', () => {
  it.each([10, 50, 90])('hits %i%% of the parent area analytically', (percent) => {
    const parcel = makeDShape(1);
    const parent = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry })!;
    const target = (parent.areaSquareMeters * percent) / 100;
    const draft = cadBuildParcelSplitByAreaDraft(parcel, { x: 5, y: 9 }, target);
    expect(draft).not.toBeNull();
    if (!draft) return;
    const { first, second } = childMetrics(draft);
    const achievedError = Math.min(
      Math.abs(first!.areaSquareMeters - target),
      Math.abs(second!.areaSquareMeters - target),
    );
    expect(achievedError).toBeLessThanOrEqual(Math.max(parent.areaSquareMeters * 1e-6, 1e-3));
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(parent.areaSquareMeters, 6);
  });
});

describe('19C slide and swing curved-parent support', () => {
  const straight = makeParcel([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ]);

  it('slide on a straight parcel is numerically unchanged (no geometry attached)', () => {
    const target = 2000;
    const draft = cadBuildParcelSplitBySlideDraft(
      straight,
      frontageLine({ x: 0, y: 0 }, { x: 100, y: 0 }),
      target,
      1,
      'start',
    );
    expect(draft).not.toBeNull();
    expect(draft?.split.firstCourseGeometry).toBeUndefined();
    expect(draft?.childAreaSquareMeters).toBeCloseTo(target, 0);
  });

  it('slide on a curved parent conserves arcs and hits the target', () => {
    const parcel = makeDShape(1);
    const target = 60;
    const draft = cadBuildParcelSplitBySlideDraft(
      parcel,
      frontageLine({ x: 10, y: 0 }, { x: 10, y: 10 }),
      target,
      1,
      'start',
    );
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.split.firstCourseGeometry ?? draft.split.secondCourseGeometry).toBeDefined();
    expect(draft.childAreaSquareMeters).toBeCloseTo(target, 0);
    const { first, second } = childMetrics(draft.split);
    const parent = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry })!;
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(parent.areaSquareMeters, 6);
  });

  it('swing on a straight parcel is numerically unchanged', () => {
    const target = 2000;
    const draft = cadBuildParcelSplitBySwingDraft(
      straight,
      frontageLine({ x: 0, y: 0 }, { x: 100, y: 0 }),
      target,
      1,
      'start',
    );
    expect(draft).not.toBeNull();
    expect(draft?.split.firstCourseGeometry).toBeUndefined();
    expect(draft?.childAreaSquareMeters).toBeCloseTo(target, 0);
  });

  it('swing on a curved parent walks the boundary by arc length and keeps arcs', () => {
    const parcel = makeDShape(1);
    const target = 45;
    const draft = cadBuildParcelSplitBySwingDraft(
      parcel,
      frontageLine({ x: 10, y: 0 }, { x: 10, y: 10 }),
      target,
      1,
      'start',
    );
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.split.firstCourseGeometry ?? draft.split.secondCourseGeometry).toBeDefined();
    const { first, second } = childMetrics(draft.split);
    const parent = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry: parcel.courseGeometry })!;
    expect(first!.areaSquareMeters + second!.areaSquareMeters).toBeCloseTo(parent.areaSquareMeters, 6);
  });
});

describe('19C curved frontage policy', () => {
  it('fails closed with CURVED_FRONTAGE_UNSUPPORTED for an arc frontage source', () => {
    const arc: CadArcEntity = {
      id: 'arc-frontage',
      type: 'arc',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 5,
      centerY: 0,
      radius: 5,
      startAngleDeg: 180,
      endAngleDeg: 360,
    };
    const parcel = makeDShape(1);
    let project = createBlankCadProject({ name: 'frontage-policy', units: 'm' });
    project = appendCadProjectEntities(project, [arc, parcel]);
    const snapshot = { project, selection: createCadSelectionState(project, [parcel.id]) };
    const resolution = resolveParcelSplitFrontageSource(snapshot, parcel, arc.id, null);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.code).toBe('CURVED_FRONTAGE_UNSUPPORTED');
    }
  });
});

describe('19C mixed-chain creation', () => {
  it('accepts a closed Line+Arc chain deterministically and leaves sources untouched', () => {
    const arc: CadArcEntity = {
      id: 'create-arc',
      type: 'arc',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 5,
      centerY: 0,
      radius: 5,
      startAngleDeg: 180,
      endAngleDeg: 360,
    };
    const lines: CadLineEntity[] = [
      { id: 'create-line-1', type: 'line', layerId: 'general', visible: true, locked: false, fromStationId: 'B', toStationId: 'C', fromX: 10, fromY: 0, toX: 10, toY: 10, sourceObservationIds: [] },
      { id: 'create-line-2', type: 'line', layerId: 'general', visible: true, locked: false, fromStationId: 'C', toStationId: 'D', fromX: 10, fromY: 10, toX: 0, toY: 10, sourceObservationIds: [] },
      { id: 'create-line-3', type: 'line', layerId: 'general', visible: true, locked: false, fromStationId: 'D', toStationId: 'A', fromX: 0, fromY: 10, toX: 0, toY: 0, sourceObservationIds: [] },
    ];
    const snapshot = JSON.stringify([arc, ...lines]);
    const forward = cadBuildParcelSourceDraft([arc, ...lines]);
    const shuffled = cadBuildParcelSourceDraft([lines[2]!, arc, lines[0]!, lines[1]!]);
    expect(forward).not.toBeNull();
    expect(shuffled).not.toBeNull();
    expect(forward!.vertices.map((v) => [v.x, v.y])).toEqual(shuffled!.vertices.map((v) => [v.x, v.y]));
    expect(forward!.courseGeometry).toBeDefined();
    expect(forward!.courseGeometry!.some((entry) => entry.kind === 'arc')).toBe(true);
    expect(validateParcelBoundaryTopology(forward!.vertices, forward!.courseGeometry).ok).toBe(true);
    // Sources untouched.
    expect(JSON.stringify([arc, ...lines])).toBe(snapshot);
    // Fresh parcel ids minted for the source draft's ring (caller-side).
    expect(forward!.vertices).toHaveLength(4);
  });

  it('rejects a self-crossing chain (arc crossing a non-adjacent line)', () => {
    // Semicircle that bulges above the chord, crossing the top line.
    const arc: CadArcEntity = {
      id: 'cross-arc',
      type: 'arc',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 5,
      centerY: 0,
      radius: 5,
      startAngleDeg: 0,
      endAngleDeg: 180,
    };
    const lines: CadLineEntity[] = [
      { id: 'cl1', type: 'line', layerId: 'general', visible: true, locked: false, fromStationId: 'B', toStationId: 'C', fromX: 10, fromY: 0, toX: 10, toY: 2, sourceObservationIds: [] },
      { id: 'cl2', type: 'line', layerId: 'general', visible: true, locked: false, fromStationId: 'C', toStationId: 'D', fromX: 10, fromY: 2, toX: 0, toY: 2, sourceObservationIds: [] },
      { id: 'cl3', type: 'line', layerId: 'general', visible: true, locked: false, fromStationId: 'D', toStationId: 'A', fromX: 0, fromY: 2, toX: 0, toY: 0, sourceObservationIds: [] },
    ];
    expect(cadBuildParcelSourceDraft([arc, ...lines])).toBeNull();
  });
});

describe('19C self-intersection / topology corpus', () => {
  const square: Vertex[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const line: CadParcelCourseGeometry = { kind: 'line' };
  const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

  it('flags line × non-adjacent arc and arc × arc, allows adjacent endpoints', () => {
    expect(validateParcelBoundaryTopology(square, [line, arc(-2), line, line]).ok).toBe(false);
    expect(validateParcelBoundaryTopology(square, [arc(-1.2), line, arc(-1.2), line]).ok).toBe(false);
    expect(validateParcelBoundaryTopology(square, [line, arc(-0.5), line, arc(-0.5)]).ok).toBe(true);
  });

  it('pins the tangent-touch policy (tangent counts as self-intersection)', () => {
    const report = validateParcelBoundaryTopology(square, [arc(-1), line, arc(-1), line]);
    expect(report.ok).toBe(false);
    expect(report.issues[0]!.code).toBe('SELF_INTERSECTION');
  });

  it('buildParcelCourseTopology is the single ring seam (sanitizes + resolves)', () => {
    const parcel = makeDShape(1);
    const topology = buildParcelCourseTopology(parcel.vertices, parcel.courseGeometry);
    expect(topology).not.toBeNull();
    expect(topology!.map((course) => course.geometry.kind)).toEqual(['arc', 'line', 'line', 'line']);
    expect(topology![0]!.arc?.signedSweepDeg).toBeCloseTo(180, 6);
  });
});
