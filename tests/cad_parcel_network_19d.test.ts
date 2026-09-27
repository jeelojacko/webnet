// Phase 19D Wave 1 — parcel network + role-aware overlap + schedule oracles.
import { describe, expect, it } from 'vitest';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { buildParcelCourseIds, resolveCadParcelCourses } from '../src/engine/cad/cadParcelCourses';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildParcelNetwork,
  classifyCadParcelNetworkPair,
  matchParcelCourses,
  matchResolvedParcelCourses,
  type LinkedPair,
} from '../src/engine/cad/cadParcelNetwork';
import {
  buildCadParcelNetworkReport,
  exportCadParcelNetworkAdjacencyCsv,
} from '../src/engine/cad/cadParcelNetworkReport';
import {
  buildCadParcelSchedule,
  buildCadParcelScheduleRow,
  groupCadParcelScheduleRowsByRole,
  moveCadParcelScheduleRowDown,
  moveCadParcelScheduleRowUp,
  setCadParcelScheduleRowOrder,
} from '../src/engine/cad/cadParcelSchedule';
import type { CadParcelPlanInfo } from '../src/engine/cad/cadParcelPlanInfo';
import type {
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

type TestParcel = CadParcelEntity & { planInfo?: CadParcelPlanInfo };

const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

const makeParcel = ({
  id,
  vertices,
  courseGeometry,
  planInfo,
}: {
  id: string;
  vertices: Array<{ x: number; y: number }>;
  courseGeometry?: CadParcelCourseGeometry[];
  planInfo?: CadParcelPlanInfo;
}): TestParcel => {
  const parcel: TestParcel = {
    id,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: planInfo?.designation ?? id,
    courseIds: buildParcelCourseIds(id, vertices.length),
    ...(courseGeometry != null
      ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) }
      : {}),
    ...(planInfo != null ? { planInfo } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

const makeProject = (parcels: TestParcel[]): CadProject => {
  const project = createBlankCadProject({ name: 'parcel-network-19d', units: 'm' });
  project.entities.push(...parcels);
  return project;
};

const rectangle = (
  id: string,
  minX: number,
  minY: number,
  width: number,
  height: number,
  planInfo?: CadParcelPlanInfo,
): TestParcel =>
  makeParcel({
    id,
    vertices: [
      { x: minX, y: minY },
      { x: minX + width, y: minY },
      { x: minX + width, y: minY + height },
      { x: minX, y: minY + height },
    ],
    ...(planInfo != null ? { planInfo } : {}),
  });

const findFinding = (
  network: ReturnType<typeof buildParcelNetwork>,
  code: string,
): ReturnType<typeof buildParcelNetwork>['findings'][number] | undefined =>
  network.findings.find((finding) => finding.code === code);

describe('19D §97 shared edge: unlinked exact course to explicit link', () => {
  const first = rectangle('net-a', 0, 0, 10, 10, { designation: 'Lot 1', role: 'lot' });
  const second = rectangle('net-b', 10, 0, 10, 10, { designation: 'Lot 2', role: 'lot' });
  const project = makeProject([first, second]);
  // A course 1 = (10,0)->(10,10); B course 3 = (10,10)->(10,0) (reversed).
  const link: LinkedPair = {
    first: { parcelId: 'net-a', courseId: 'parcel-course:net-a:1' },
    second: { parcelId: 'net-b', courseId: 'parcel-course:net-b:3' },
  };

  it('unlinked exact shared course is WARNING + GEOMETRIC_SHARED_COURSE', () => {
    const network = buildParcelNetwork(project);
    expect(network.pairs).toHaveLength(1);
    const pair = network.pairs[0]!;
    expect(pair.relation).toBe('GEOMETRIC_SHARED_COURSE');
    expect(pair.linked).toBe(false);
    expect(pair.sharedLengthMeters).toBe(10);
    expect(pair.sharedGeometryKinds).toEqual(['line']);
    expect(pair.pointTouch).toBe(false);
    const finding = findFinding(network, 'UNLINKED_SHARED_COURSE');
    expect(finding?.severity).toBe('WARNING');
    expect(network.components).toHaveLength(1);
  });

  it('passing the link transitions the same pair to LINKED_ADJACENCY', () => {
    const network = buildParcelNetwork(project, [link]);
    const pair = network.pairs[0]!;
    expect(pair.relation).toBe('LINKED_ADJACENCY');
    expect(pair.linked).toBe(true);
    expect(pair.sharedLengthMeters).toBe(10);
    expect(findFinding(network, 'UNLINKED_SHARED_COURSE')).toBeUndefined();
    expect(network.findings.filter((finding) => finding.severity === 'ERROR')).toHaveLength(0);
  });

  it('classify helper reports DISJOINT for unconnected far parcels', () => {
    const third = rectangle('net-c', 100, 100, 5, 5);
    const wide = makeProject([first, third]);
    expect(classifyCadParcelNetworkPair(wide, [], 'net-a', 'net-c')).toBe('DISJOINT');
    expect(classifyCadParcelNetworkPair(project, [], 'net-a', 'net-b')).toBe(
      'GEOMETRIC_SHARED_COURSE',
    );
  });
});

describe('19D §98 point touch is corner-only INFO', () => {
  const first = rectangle('corner-a', 0, 0, 10, 10, { designation: 'A', role: 'lot' });
  const second = rectangle('corner-b', 10, 10, 10, 10, { designation: 'B', role: 'lot' });
  const project = makeProject([first, second]);

  it('single shared vertex: POINT_TOUCH, shared length 0, INFO', () => {
    const network = buildParcelNetwork(project);
    const pair = network.pairs[0]!;
    expect(pair.relation).toBe('POINT_TOUCH');
    expect(pair.sharedLengthMeters).toBe(0);
    expect(pair.pointTouch).toBe(true);
    expect(pair.overlapAreaSquareMeters).toBe(0);
    expect(findFinding(network, 'POINT_TOUCH')?.severity).toBe('INFO');
    expect(network.components).toEqual([['corner-a'], ['corner-b']]);
  });
});

describe('19D §93 positive-area overlap', () => {
  const first = rectangle('ovl-a', 0, 0, 10, 20, { designation: 'Lot A', role: 'lot' });
  const second = rectangle('ovl-b', 5, 0, 10, 20, { designation: 'Lot B', role: 'lot' });
  const project = makeProject([first, second]);

  it('10x20 rectangles overlapping 5x20 -> AREA_OVERLAP / PRIMARY_OVERLAP ERROR', () => {
    const network = buildParcelNetwork(project);
    const pair = network.pairs[0]!;
    expect(pair.relation).toBe('AREA_OVERLAP');
    expect(pair.overlapAreaSquareMeters).toBeCloseTo(100, 6);
    const finding = findFinding(network, 'PRIMARY_OVERLAP');
    expect(finding?.severity).toBe('ERROR');
    expect(finding?.overlapAreaSquareMeters).toBeCloseTo(100, 6);
  });

  it('same footprint is COINCIDENT_PARCELS (prominent, no auto-delete)', () => {
    const clone = rectangle('ovl-c', 0, 0, 10, 20, { designation: 'Lot C', role: 'lot' });
    const coincident = makeProject([first, clone]);
    const network = buildParcelNetwork(coincident);
    const finding = findFinding(network, 'COINCIDENT_PARCELS');
    expect(finding?.severity).toBe('ERROR');
    // No auto-delete: both coincident parcels remain in the project.
    expect([...coincident.entities].filter((entity) => entity.type === 'parcel')).toHaveLength(2);
  });
});

describe('19D role-aware overlap: contained easement is INFO overlay', () => {
  const lot = rectangle('role-lot', 0, 0, 100, 100, { designation: 'Lot 7', role: 'lot' });
  const easement = rectangle('role-ease', 10, 10, 30, 30, {
    designation: 'Drainage Easement',
    role: 'easement',
  });
  const project = makeProject([lot, easement]);

  it('easement inside lot: OVERLAY_INTERSECTION INFO, never PRIMARY_OVERLAP', () => {
    const network = buildParcelNetwork(project);
    const pair = network.pairs[0]!;
    expect(pair.relation).toBe('AREA_OVERLAP');
    expect(pair.overlapAreaSquareMeters).toBeCloseTo(900, 6);
    expect(findFinding(network, 'PRIMARY_OVERLAP')).toBeUndefined();
    expect(findFinding(network, 'COINCIDENT_PARCELS')).toBeUndefined();
    const overlay = findFinding(network, 'OVERLAY_INTERSECTION');
    expect(overlay?.severity).toBe('INFO');
    expect(overlay?.parcelIds).toEqual(['role-ease', 'role-lot']);
  });

  it('strict mode raises the overlay to ERROR', () => {
    const network = buildParcelNetwork(project, [], { strictRoles: true });
    expect(findFinding(network, 'OVERLAY_INTERSECTION')?.severity).toBe('ERROR');
  });

  it('road defaults to INFO pending audit', () => {
    const road = rectangle('role-road', 0, 0, 50, 50, { designation: 'Road', role: 'road' });
    const roadProject = makeProject([lot, road]);
    const network = buildParcelNetwork(roadProject);
    expect(findFinding(network, 'OVERLAY_INTERSECTION')?.severity).toBe('INFO');
    expect(findFinding(network, 'PRIMARY_OVERLAP')).toBeUndefined();
  });
});

describe('19D link integrity findings', () => {
  const first = rectangle('int-a', 0, 0, 10, 10);
  const second = rectangle('int-b', 10, 0, 10, 10);
  const project = makeProject([first, second]);

  it('missing parcel / missing course -> BROKEN_LINK_REFERENCE ERROR', () => {
    const missingParcel = buildParcelNetwork(project, [
      { first: { parcelId: 'ghost', courseId: 'parcel-course:ghost:0' }, second: { parcelId: 'int-a', courseId: 'parcel-course:int-a:0' } },
    ]);
    expect(findFinding(missingParcel, 'BROKEN_LINK_REFERENCE')?.severity).toBe('ERROR');
    const missingCourse = buildParcelNetwork(project, [
      { first: { parcelId: 'int-a', courseId: 'parcel-course:int-a:99' }, second: { parcelId: 'int-b', courseId: 'parcel-course:int-b:3' } },
    ]);
    expect(findFinding(missingCourse, 'BROKEN_LINK_REFERENCE')?.severity).toBe('ERROR');
  });

  it('linked courses that do not coincide -> LINK_GEOMETRY_MISMATCH ERROR', () => {
    const mismatch = buildParcelNetwork(project, [
      { first: { parcelId: 'int-a', courseId: 'parcel-course:int-a:0' }, second: { parcelId: 'int-b', courseId: 'parcel-course:int-b:0' } },
    ]);
    expect(findFinding(mismatch, 'LINK_GEOMETRY_MISMATCH')?.severity).toBe('ERROR');
    expect(mismatch.pairs[0]!.linked).toBe(false);
  });
});

describe('19D exact whole-course match uses arc length, never chord', () => {
  const semicircle = (id: string): TestParcel =>
    makeParcel({
      id,
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      courseGeometry: [line, line, arc(1)],
    });

  it('identical semicircles match the arc course at arc length', () => {
    const matches = matchParcelCourses(semicircle('arc-p'), semicircle('arc-q'));
    const arcMatch = matches.find((match) => match.geometryKind === 'arc');
    expect(arcMatch).toBeDefined();
    expect(arcMatch!.lengthMeters).toBeCloseTo(10 * Math.PI, 9);
    expect(arcMatch!.lengthMeters).not.toBeCloseTo(20, 3);
  });
});

describe('19D §92 parcel schedule oracle', () => {
  const p1 = rectangle('sch-1', 0, 0, 100, 50, { designation: 'Lot 1', role: 'lot' });
  const p2 = rectangle('sch-2', 200, 0, 10, 10, { designation: 'Lot 2', role: 'lot' });
  const p3 = makeParcel({
    id: 'sch-3',
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ],
    courseGeometry: [line, arc(Math.tan(Math.PI / 8)), line],
    planInfo: { designation: 'Lot 3', role: 'lot' },
  });
  const p4 = rectangle('sch-4', 300, 0, 20, 30, {
    designation: 'Remainder A',
    role: 'remainder',
  });
  const p5 = makeParcel({
    id: 'sch-5',
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
    courseGeometry: [line, line, arc(1)],
    planInfo: { designation: 'Lot 5', role: 'lot' },
  });
  const project = makeProject([p1, p2, p3, p4, p5]);
  const order = ['sch-3', 'sch-1', 'sch-5', 'sch-2', 'sch-4'];

  it('rows follow the given parcelId order with exact curve-aware areas', () => {
    const schedule = buildCadParcelSchedule(project, order);
    expect(schedule.parcelIds).toEqual(order);
    expect(schedule.rows.map((row) => row.parcelId)).toEqual(order);
    expect(schedule.rows[0]!.areaSquareMeters).toBeCloseTo(25 * Math.PI, 9);
    expect(schedule.rows[0]!.lineCount).toBe(2);
    expect(schedule.rows[0]!.arcCount).toBe(1);
    expect(schedule.rows[1]!.areaSquareMeters).toBe(5000);
    expect(schedule.rows[2]!.areaSquareMeters).toBeCloseTo(50 * Math.PI, 9);
    expect(schedule.rows[2]!.arcCount).toBe(1);
    expect(schedule.rows[3]!.areaSquareMeters).toBe(100);
    expect(schedule.rows[4]!.areaSquareMeters).toBe(600);
    expect(schedule.rows[4]!.role).toBe('remainder');
  });

  it('totals are the arithmetic row sum with hectares/acres', () => {
    const schedule = buildCadParcelSchedule(project, order);
    const expected = 5000 + 100 + 25 * Math.PI + 600 + 50 * Math.PI;
    expect(schedule.totals.areaSquareMeters).toBeCloseTo(expected, 9);
    expect(schedule.totals.areaHectares).toBeCloseTo(expected / 10_000, 12);
    expect(schedule.totals.areaAcres).toBeCloseTo(expected / 4046.8564224, 9);
    expect(schedule.totals.perimeterMeters).toBeCloseTo(300 + 40 + (20 + 5 * Math.PI) + 100 + (20 + 10 * Math.PI), 9);
    expect(schedule.totals.arithmetic).toBe(true);
    expect(schedule.totals.parcelCount).toBe(5);
  });

  it('derives fresh from the project (no cached values)', () => {
    const resized = makeProject([rectangle('sch-1', 0, 0, 200, 50)]);
    const row = buildCadParcelScheduleRow(resized, 'sch-1');
    expect(row.areaSquareMeters).toBe(10000);
    expect(buildCadParcelScheduleRow(project, 'sch-1').areaSquareMeters).toBe(5000);
  });

  it('stale parcelId rows stay as MISSING, not dropped', () => {
    const schedule = buildCadParcelSchedule(project, ['ghost', 'sch-1']);
    expect(schedule.rows[0]!.status).toBe('MISSING');
    expect(schedule.rows[1]!.status).toBe('OK');
  });
});

describe('19D schedule order helpers + role grouping', () => {
  it('moveUp/moveDown/setOrder are pure and clamped', () => {
    const base = ['a', 'b', 'c'];
    expect(moveCadParcelScheduleRowUp(base, 'c')).toEqual(['a', 'c', 'b']);
    expect(moveCadParcelScheduleRowDown(base, 'a')).toEqual(['b', 'a', 'c']);
    expect(moveCadParcelScheduleRowUp(base, 'a')).toEqual(['a', 'b', 'c']);
    expect(setCadParcelScheduleRowOrder(base, 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(setCadParcelScheduleRowOrder(base, 'a', 99)).toEqual(['b', 'c', 'a']);
    expect(setCadParcelScheduleRowOrder(base, 'ghost', 0)).toEqual(base);
    expect(base).toEqual(['a', 'b', 'c']);
  });

  it('groupByRole preserves row order and sums per role', () => {
    const lot = rectangle('grp-lot', 0, 0, 10, 10, { role: 'lot' });
    const easement = rectangle('grp-ease', 0, 0, 20, 20, { role: 'easement' });
    const project = makeProject([lot, easement]);
    const schedule = buildCadParcelSchedule(project, ['grp-ease', 'grp-lot']);
    const groups = groupCadParcelScheduleRowsByRole(schedule.rows);
    expect(groups.map((group) => group.role)).toEqual(['lot', 'easement']);
    expect(groups[0]!.parcelIds).toEqual(['grp-lot']);
    expect(groups[0]!.areaSquareMeters).toBe(100);
    expect(groups[1]!.areaSquareMeters).toBe(400);
  });
});

describe('19D PARCELCHECK report + adjacency CSV', () => {
  const first = rectangle('rep-a', 0, 0, 10, 10, { designation: 'Lot 1', role: 'lot' });
  const second = rectangle('rep-b', 10, 0, 10, 10, { designation: 'Lot 2', role: 'lot' });
  const project = makeProject([first, second]);
  const link: LinkedPair = {
    first: { parcelId: 'rep-a', courseId: 'parcel-course:rep-a:1' },
    second: { parcelId: 'rep-b', courseId: 'parcel-course:rep-b:3' },
  };

  it('summary counts links/shared/overlap deterministically', () => {
    const network = buildParcelNetwork(project, [link]);
    const report = buildCadParcelNetworkReport(project, network);
    expect(report.summary.parcelCount).toBe(2);
    expect(report.summary.pairCount).toBe(1);
    expect(report.summary.linkedPairCount).toBe(1);
    expect(report.summary.unlinkedSharedPairCount).toBe(0);
    expect(report.summary.totalSharedLengthMeters).toBe(10);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]!.linkStatus).toBe('LINKED');
    expect(report.rows[0]!.designation).toBe('Lot 1');
    expect(report.rows[0]!.neighborDesignation).toBe('Lot 2');
    expect(report.rows[0]!.geometryType).toBe('line');
  });

  it('CSV has no owner/title columns and carries plan-only fields', () => {
    const network = buildParcelNetwork(project, [link]);
    const csv = exportCadParcelNetworkAdjacencyCsv(project, network);
    const [header, firstRow] = csv.trim().split('\n');
    expect(header).not.toMatch(/owner|title/i);
    expect(header).toContain('Shared Length (m)');
    expect(header).toContain('Link Status');
    expect(firstRow).toContain('rep-a');
    expect(firstRow).toContain('LINKED');
  });
});

describe('19D fix wave F5/F3: cached precompute parity + partial-segment class', () => {
  it('matchResolvedParcelCourses agrees with matchParcelCourses', () => {
    const first = rectangle('pre-a', 0, 0, 10, 10, { designation: 'Lot 1', role: 'lot' });
    const second = rectangle('pre-b', 10, 0, 10, 10, { designation: 'Lot 2', role: 'lot' });
    expect(
      matchResolvedParcelCourses(resolveCadParcelCourses(first), resolveCadParcelCourses(second)),
    ).toEqual(matchParcelCourses(first, second));
  });

  it('partial-course shared edge stays POINT_TOUCH; disjoint parcels emit no pair', () => {
    const short = rectangle('part-short', 0, 0, 10, 10, { designation: 'Lot 5', role: 'lot' });
    // Tall neighbor: west course spans y 0–20, so only a segment coincides.
    const tall = rectangle('part-tall', 10, 0, 10, 20, { designation: 'R/W 1', role: 'road' });
    const far = rectangle('part-far', 100, 100, 10, 10, { designation: 'Lot 9', role: 'lot' });
    const network = buildParcelNetwork(makeProject([short, tall, far]));
    const partial = network.pairs.find(
      (pair) =>
        (pair.firstParcelId === 'part-short' && pair.secondParcelId === 'part-tall') ||
        (pair.firstParcelId === 'part-tall' && pair.secondParcelId === 'part-short'),
    );
    // F3 decision: partial-course links are out of scope (§19) — the shared
    // segment is reported as a point touch, never as a shared course.
    expect(partial?.relation).toBe('POINT_TOUCH');
    expect(partial?.sharedLengthMeters).toBe(0);
    expect(network.pairs.some((pair) => pair.firstParcelId === 'part-far' || pair.secondParcelId === 'part-far')).toBe(false);
  });
});
