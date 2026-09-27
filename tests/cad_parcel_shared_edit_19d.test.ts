// Phase 19D Wave 1 (Worker C) — Shared Boundary integrity + PARCELSHAREDEDIT.
//
// Covers the mission §82-§89 matrix: fail-closed guards (grip/course/split/
// vertex topology/partial group transform), the atomic shared edit (endpoint
// move + line<->arc), full-network transforms, delete confirm/unlink, and
// copy-clone independence. Agent tier: pure in-memory, deterministic.
import { describe, expect, it } from 'vitest';

import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildParcelCourseIds,
  deleteParcelCourseVertex,
  insertParcelCourseVertex,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import {
  PARCEL_SHARED_BOUNDARY_LINKED,
  applyParcelSharedEdit,
  attachParcelSharedLinks,
  commitParcelSharedEditResult,
  courseEditBlockReason,
  deleteParcelsWithSharedLinks,
  evaluateParcelDeleteSharedLinks,
  linkedComponentSelectionBlockReason,
  listLinkedCourseIds,
  listParcelSharedLinks,
  parcelGripEditBlockReason,
  parcelSplitBlockReason,
  type CadParcelSharedBoundaryLink,
} from '../src/engine/cad/cadParcelSharedEdit';
import { parcelCourseArcCommand } from '../src/engine/cad/cadTransactionsParcelCourseCommands';
import { parcelSplitBearingCommand } from '../src/engine/cad/cadTransactionsParcelSplitCommands';
import { applyCadProjectCoordinateTransform } from '../src/engine/cad/cadProjectTransform';
import { applyCadProjectTransform } from '../src/engine/cad/cadProjectTransformRequest';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { applyCadSelectionTransform } from '../src/engine/cad/cadTransformApply';
import {
  compose,
  reflectionAboutLine,
  rotationAbout,
  translation,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';
import { resolveCadSurveyTableRow } from '../src/engine/cad/cadSurveyTables';
import type { CadCommandKey } from '../src/engine/cad/cadTransactions.types';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type {
  CadArcEntity,
  CadEntity,
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadProject,
  CadSurveyTableEntity,
} from '../src/engine/cad/cadTypes';

const LINE: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

const SOUTH = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const MID = [
  { x: 0, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];
const NORTH = [
  { x: 0, y: 20 },
  { x: 10, y: 20 },
  { x: 10, y: 30 },
  { x: 0, y: 30 },
];

let parcelSeq = 0;
const makeParcel = (
  name: string,
  vertices: Array<{ x: number; y: number }>,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => {
  const id = `parcel-19d-${(parcelSeq += 1)}`;
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: name,
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

const linkOf = (
  a: CadParcelEntity,
  aCourseIndex: number,
  b: CadParcelEntity,
  bCourseIndex: number,
): CadParcelSharedBoundaryLink => ({
  id: `link:${a.id}:${aCourseIndex}`,
  a: { parcelId: a.id, courseId: a.courseIds![aCourseIndex]! },
  b: { parcelId: b.id, courseId: b.courseIds![bCourseIndex]! },
});

const projectWith = (
  entities: CadEntity[],
  links: readonly CadParcelSharedBoundaryLink[],
): CadProject => {
  const project = createBlankCadProject({ name: '19D-shared', units: 'm' });
  project.entities = entities;
  return attachParcelSharedLinks(project, links);
};

const parcelById = (project: CadProject, id: string): CadParcelEntity => {
  const parcel = project.entities.find(
    (entity): entity is CadParcelEntity => entity.id === id && entity.type === 'parcel',
  );
  if (!parcel) throw new Error(`missing parcel ${id}`);
  return parcel;
};

const courseById = (parcel: CadParcelEntity, courseId: string) => {
  const course = resolveCadParcelCourses(parcel).find((entry) => entry.courseId === courseId);
  if (!course) throw new Error(`missing course ${courseId}`);
  return course;
};

const samePt = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;

const hasVertex = (parcel: CadParcelEntity, x: number, y: number): boolean =>
  parcel.vertices.some((vertex) => samePt(vertex, { x, y }));

const sharedCoincide = (
  a: CadParcelEntity,
  aCourseId: string,
  b: CadParcelEntity,
  bCourseId: string,
): boolean => {
  const ca = courseById(a, aCourseId);
  const cb = courseById(b, bCourseId);
  return (
    (samePt(ca.fromVertex, cb.fromVertex) && samePt(ca.toVertex, cb.toVertex)) ||
    (samePt(ca.fromVertex, cb.toVertex) && samePt(ca.toVertex, cb.fromVertex))
  );
};

const makeCourseTable = (id: string, parcelId: string, courseId: string): CadSurveyTableEntity => ({
  id,
  type: 'survey-table',
  layerId: 'general',
  visible: true,
  locked: false,
  tableKind: 'parcel-course',
  x: 0,
  y: 0,
  rotationDeg: 0,
  tableStyleId: 'style-default',
  rows: [{ id: `${id}-row`, source: { kind: 'parcel-course', parcelId, courseId } }],
});

const sharedLineFixture = () => {
  const south = makeParcel('South', SOUTH);
  const north = makeParcel('North', MID);
  const link = linkOf(south, 2, north, 0);
  return { south, north, link, project: projectWith([south, north], [link]) };
};

const sharedArcFixture = () => {
  const south = makeParcel('South', SOUTH, [LINE, LINE, arc(0.5), LINE]);
  const north = makeParcel('North', MID, [arc(-0.5), LINE, LINE, LINE]);
  const link = linkOf(south, 2, north, 0);
  return { south, north, link, project: projectWith([south, north], [link]) };
};

const sharedChainFixture = () => {
  const a = makeParcel('A', SOUTH);
  const b = makeParcel('B', MID);
  const c = makeParcel('C', NORTH);
  const links = [linkOf(a, 2, b, 0), linkOf(b, 2, c, 0)];
  return { a, b, c, links, project: projectWith([a, b, c], links) };
};

// Shared straight edge (10,10)->(0,10) as an arc of bulge +0.5, center (5,6.25).
const sharedChordArc = (): CadArcEntity => {
  const centerX = 5;
  const centerY = 6.25;
  const radius = 6.25;
  return {
    id: 'arc-shared',
    type: 'arc',
    layerId: 'general',
    visible: true,
    locked: false,
    centerX,
    centerY,
    radius,
    startAngleDeg: (Math.atan2(10 - centerY, 10 - centerX) * 180) / Math.PI,
    endAngleDeg: (Math.atan2(10 - centerY, 0 - centerX) * 180) / Math.PI,
  };
};

describe('19D §82 shared-boundary guards fail closed', () => {
  it('§82 blocks a linked parcel vertex grip with zero mutation/history', () => {
    const { south, project } = sharedLineFixture();
    expect(parcelGripEditBlockReason(project, south, 2)).toContain(PARCEL_SHARED_BOUNDARY_LINKED);
    expect(parcelGripEditBlockReason(project, south, 3)).toContain(PARCEL_SHARED_BOUNDARY_LINKED);
    // Vertex 0 only touches unlinked courses 0/3.
    expect(parcelGripEditBlockReason(project, south, 0)).toBeNull();

    const history = createCadHistoryState(project);
    const next = runCadCommand(history, {
      key: 'GRIP_EDIT',
      entityId: south.id,
      gripKind: 'vertex',
      x: 20,
      y: 10,
      vertexIndex: 2,
    });
    expect(next).toBe(history);
    expect(next.undoStack).toHaveLength(0);
    expect(next.present.project).toBe(project);
  });

  it('§82 blocks PARCELCOURSEARC on a linked course but allows an unlinked parcel', () => {
    const { south, link, project } = sharedLineFixture();
    const courseId = link.a.courseId;
    expect(courseEditBlockReason(project, south.id, courseId)).toContain(PARCEL_SHARED_BOUNDARY_LINKED);
    expect(courseEditBlockReason(project, south.id, south.courseIds![0]!)).toBeNull();

    const arcEntity = sharedChordArc();
    const withArc = { ...project, entities: [...project.entities, arcEntity] };
    const blocked = parcelCourseArcCommand.execute(
      { project: withArc, selection: createCadSelectionState(withArc, []) },
      { key: 'PARCELCOURSEARC', parcelEntityId: south.id, courseId, arcEntityId: arcEntity.id },
    );
    expect(blocked).toBeNull();

    // Same command WITHOUT the link converts the chord to the matching arc.
    const unlinked = attachParcelSharedLinks(withArc, []);
    const allowed = parcelCourseArcCommand.execute(
      { project: unlinked, selection: createCadSelectionState(unlinked, []) },
      { key: 'PARCELCOURSEARC', parcelEntityId: south.id, courseId, arcEntityId: arcEntity.id },
    );
    expect(allowed).not.toBeNull();
  });

  it('§82 blocks split and vertex insert/delete on a linked parcel/course', () => {
    const { south, link, project } = sharedLineFixture();
    expect(parcelSplitBlockReason(project, south.id)).toContain(PARCEL_SHARED_BOUNDARY_LINKED);
    const split = parcelSplitBearingCommand.execute(
      { project, selection: createCadSelectionState(project, []) },
      {
        key: 'PARCEL_SPLIT_BEARING',
        parcelEntityId: south.id,
        throughPointX: 5,
        throughPointY: 5,
        bearing: 'N 0° 0\' 0" E',
      },
    );
    expect(split).toBeNull();

    expect(
      insertParcelCourseVertex({
        parcel: south,
        courseIndex: 2,
        point: { x: 5, y: 10 },
        linkedCourseIds: new Set([link.a.courseId]),
      }),
    ).toBeNull();
    const deleted = deleteParcelCourseVertex({
      parcel: south,
      vertexIndex: 2,
      linkedCourseIds: new Set([link.a.courseId]),
    });
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.reason).toContain(PARCEL_SHARED_BOUNDARY_LINKED);

    // The unwired seams still behave without a linked set.
    expect(
      insertParcelCourseVertex({ parcel: south, courseIndex: 2, point: { x: 5, y: 10 } }),
    ).not.toBeNull();
  });
});

describe('19D §83-§84 atomic shared edit', () => {
  it('§83 moves the shared endpoint once on both parcels + one undo entry', () => {
    const { south, north, link, project } = sharedLineFixture();
    const applied = applyParcelSharedEdit(project, {
      key: 'PARCELSHAREDEDIT',
      linkId: link.id,
      edit: { kind: 'move-endpoint', end: 'from', x: 20, y: 10 },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const nextSouth = parcelById(applied.project, south.id);
    const nextNorth = parcelById(applied.project, north.id);
    expect(hasVertex(nextSouth, 20, 10)).toBe(true);
    expect(hasVertex(nextNorth, 20, 10)).toBe(true);
    expect(hasVertex(nextSouth, 10, 10)).toBe(false);
    expect(hasVertex(nextNorth, 10, 10)).toBe(false);
    // Neighbor vertices untouched.
    expect(hasVertex(nextSouth, 0, 0)).toBe(true);
    expect(hasVertex(nextNorth, 10, 20)).toBe(true);
    expect(sharedCoincide(nextSouth, link.a.courseId, nextNorth, link.b.courseId)).toBe(true);
    expect(listParcelSharedLinks(applied.project)).toEqual(listParcelSharedLinks(project));

    const history = commitParcelSharedEditResult(createCadHistoryState(project), applied);
    expect(history.undoStack).toHaveLength(1);
    const undone = undoCadHistory(history);
    expect(undone.present.project).toBe(project);
  });

  it('§84 shared line->arc updates both parcels and both course tables', () => {
    const { south, north, link, project } = sharedLineFixture();
    const southTable = makeCourseTable('t-south', south.id, link.a.courseId);
    const northTable = makeCourseTable('t-north', north.id, link.b.courseId);
    const withTables: CadProject = { ...project, entities: [...project.entities, southTable, northTable] };

    const applied = applyParcelSharedEdit(withTables, {
      key: 'PARCELSHAREDEDIT',
      linkId: link.id,
      edit: { kind: 'course-geometry', geometry: arc(0.5) },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const nextSouth = parcelById(applied.project, south.id);
    const nextNorth = parcelById(applied.project, north.id);
    const a = courseById(nextSouth, link.a.courseId);
    const b = courseById(nextNorth, link.b.courseId);
    expect(a.kind).toBe('arc');
    expect(b.kind).toBe('arc');
    if (a.kind === 'arc' && b.kind === 'arc') {
      expect(a.radius).toBeCloseTo(b.radius, 9);
      expect(a.center.x).toBeCloseTo(b.center.x, 9);
      expect(a.center.y).toBeCloseTo(b.center.y, 9);
      expect(a.signedSweepDeg).toBeCloseTo(-b.signedSweepDeg, 9);
      expect(a.direction).not.toBe(b.direction);
    }

    const resolvedSouth = resolveCadSurveyTableRow(applied.project, southTable, southTable.rows[0]!, 0);
    const resolvedNorth = resolveCadSurveyTableRow(applied.project, northTable, northTable.rows[0]!, 0);
    expect(resolvedSouth.status).toBe('ok');
    expect(resolvedNorth.status).toBe('ok');
    expect(resolvedSouth.values.find((value) => value.key === 'type')?.value).toBe('ARC');
    expect(resolvedNorth.values.find((value) => value.key === 'type')?.value).toBe('ARC');
    const rSouth = Number(resolvedSouth.values.find((value) => value.key === 'radius')?.value);
    const rNorth = Number(resolvedNorth.values.find((value) => value.key === 'radius')?.value);
    expect(rSouth).toBeCloseTo(rNorth, 3);
  });

  it('§84 rejects a geometry edit on a malformed (non-shared) link', () => {
    const { north, link, project } = sharedLineFixture();
    const broken = attachParcelSharedLinks(project, [
      { ...link, b: { parcelId: north.id, courseId: north.courseIds![2]! } },
    ]);
    const applied = applyParcelSharedEdit(broken, {
      key: 'PARCELSHAREDEDIT',
      linkId: link.id,
      edit: { kind: 'course-geometry', geometry: arc(0.5) },
    });
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.reason).toBe('PARCEL_SHARED_EDIT_NOT_SHARED');
  });
});

describe('19D §85-§87 component + whole-drawing transforms', () => {
  it('§85 blocks a partial A-B-C MOVE and allows the full group', () => {
    const { a, b, c, links, project } = sharedChainFixture();
    expect(linkedComponentSelectionBlockReason(project, [a.id])).toContain(PARCEL_SHARED_BOUNDARY_LINKED);
    expect(linkedComponentSelectionBlockReason(project, [a.id, b.id])).toContain(
      PARCEL_SHARED_BOUNDARY_LINKED,
    );
    expect(linkedComponentSelectionBlockReason(project, [a.id, b.id, c.id])).toBeNull();

    const blocked = runCadCommand(createCadHistoryState(project, [a.id]), {
      key: 'MOVE',
      deltaX: 5,
      deltaY: 7,
    });
    expect(blocked.undoStack).toHaveLength(0);
    expect(blocked.present.project).toBe(project);

    const moved = runCadCommand(createCadHistoryState(project, [a.id, b.id, c.id]), {
      key: 'MOVE',
      deltaX: 5,
      deltaY: 7,
    });
    expect(moved.undoStack).toHaveLength(1);
    const nextA = parcelById(moved.present.project, a.id);
    const nextB = parcelById(moved.present.project, b.id);
    const nextC = parcelById(moved.present.project, c.id);
    expect(hasVertex(nextA, 5, 7)).toBe(true);
    expect(sharedCoincide(nextA, links[0]!.a.courseId, nextB, links[0]!.b.courseId)).toBe(true);
    expect(sharedCoincide(nextB, links[1]!.a.courseId, nextC, links[1]!.b.courseId)).toBe(true);
  });

  it('§86 project rotation/scale/translate preserves links and shared arcs', () => {
    const { south, north, link, project } = sharedArcFixture();
    const beforeA = courseById(south, link.a.courseId);
    const transform = compose(
      translation(4, -2),
      compose(rotationAbout(0, 0, 35), uniformScaleAbout(0, 0, 1.4)),
    );
    const result = applyCadProjectCoordinateTransform(project, transform);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(listParcelSharedLinks(result.project)).toEqual(listParcelSharedLinks(project));
    const nextSouth = parcelById(result.project, south.id);
    const nextNorth = parcelById(result.project, north.id);
    expect(sharedCoincide(nextSouth, link.a.courseId, nextNorth, link.b.courseId)).toBe(true);
    const afterA = courseById(nextSouth, link.a.courseId);
    const afterB = courseById(nextNorth, link.b.courseId);
    expect(afterA.kind).toBe('arc');
    expect(afterB.kind).toBe('arc');
    if (beforeA.kind === 'arc' && afterA.kind === 'arc' && afterB.kind === 'arc') {
      expect(afterA.signedSweepDeg).toBeCloseTo(beforeA.signedSweepDeg, 9);
      expect(afterA.radius).toBeCloseTo(beforeA.radius * 1.4, 6);
      expect(afterA.center.x).toBeCloseTo(afterB.center.x, 6);
      expect(afterA.center.y).toBeCloseTo(afterB.center.y, 6);
    }
  });

  it('§86 GRIDGROUND uniform about origin preserves links and shared arcs', () => {
    const { south, north, link, project } = sharedArcFixture();
    const result = applyCadProjectTransform(project, {
      kind: 'GRID_GROUND',
      originE: 0,
      originN: 0,
      combinedScaleFactor: 1.0002,
      direction: 'GRID_TO_GROUND',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listParcelSharedLinks(result.project)).toEqual(listParcelSharedLinks(project));
    const nextSouth = parcelById(result.project, south.id);
    const nextNorth = parcelById(result.project, north.id);
    expect(sharedCoincide(nextSouth, link.a.courseId, nextNorth, link.b.courseId)).toBe(true);
    expect(courseById(nextSouth, link.a.courseId).kind).toBe('arc');
  });

  it('§87 whole-network MIRROR keeps both shared arcs consistent (single flip)', () => {
    const { south, north, link, project } = sharedArcFixture();
    const beforeA = courseById(south, link.a.courseId);
    const beforeB = courseById(north, link.b.courseId);
    const applied = applyCadSelectionTransform(
      project,
      [south.id, north.id],
      reflectionAboutLine({ x: 50, y: 0 }, { x: 50, y: 1 })!,
      { label: 'MIRROR network' },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const nextSouth = parcelById(applied.project, south.id);
    const nextNorth = parcelById(applied.project, north.id);
    const afterA = courseById(nextSouth, link.a.courseId);
    const afterB = courseById(nextNorth, link.b.courseId);
    if (
      beforeA.kind === 'arc' &&
      beforeB.kind === 'arc' &&
      afterA.kind === 'arc' &&
      afterB.kind === 'arc'
    ) {
      expect(afterA.signedSweepDeg).toBeCloseTo(-beforeA.signedSweepDeg, 9);
      expect(afterB.signedSweepDeg).toBeCloseTo(-beforeB.signedSweepDeg, 9);
      expect(afterA.signedSweepDeg).toBeCloseTo(-afterB.signedSweepDeg, 9);
      expect(afterA.center.x).toBeCloseTo(afterB.center.x, 6);
      expect(afterA.center.y).toBeCloseTo(afterB.center.y, 6);
    }
    expect(sharedCoincide(nextSouth, link.a.courseId, nextNorth, link.b.courseId)).toBe(true);
    expect(listParcelSharedLinks(applied.project)).toEqual(listParcelSharedLinks(project));
  });
});

describe('19D §88-§89 delete confirm + copy independence', () => {
  it('§88 delete requires confirmation, then removes both links atomically + undo', () => {
    const { a, b, c, project } = sharedChainFixture();
    const plan = evaluateParcelDeleteSharedLinks(project, [b.id]);
    expect(plan?.linkCount).toBe(2);

    const blocked = deleteParcelsWithSharedLinks(project, [b.id]);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.plan.linkCount).toBe(2);
      expect(blocked.plan.linkIds).toHaveLength(2);
    }
    // Zero mutation on the blocked path.
    expect(listParcelSharedLinks(project)).toHaveLength(2);

    const applied = deleteParcelsWithSharedLinks(project, [b.id], { confirm: true });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.removedLinkIds).toHaveLength(2);
    expect(applied.project.entities.some((entity) => entity.id === b.id)).toBe(false);
    expect(listParcelSharedLinks(applied.project)).toHaveLength(0);
    expect(parcelById(applied.project, a.id)).toBe(a);
    expect(parcelById(applied.project, c.id)).toBe(c);

    const history = commitParcelSharedEditResult(
      createCadHistoryState(project),
      { project: applied.project, selectionIds: [], transactionLabel: 'ERASE (shared)' },
      'ERASE' as CadCommandKey,
    );
    const undone = undoCadHistory(history);
    expect(undone.present.project).toBe(project);
  });

  it('§89 COPY / MIRROR_COPY clones start with fresh ids and zero links', () => {
    const { south, north, project } = sharedLineFixture();
    const beforeLinks = listParcelSharedLinks(project);

    const copied = runCadCommand(createCadHistoryState(project, [south.id]), {
      key: 'COPY',
      deltaX: 100,
      deltaY: 0,
    });
    expect(copied.undoStack).toHaveLength(1);
    const addedIds = copied.undoStack[0]!.transaction.addedEntityIds;
    const clone = copied.present.project.entities.find(
      (entity): entity is CadParcelEntity =>
        entity.type === 'parcel' && entity.id !== south.id && addedIds.includes(entity.id),
    );
    expect(clone).toBeDefined();
    if (clone) {
      expect(clone.id).not.toBe(south.id);
      expect(clone.courseIds).not.toEqual(south.courseIds);
      expect(listLinkedCourseIds(copied.present.project, clone.id).size).toBe(0);
    }
    expect(listParcelSharedLinks(copied.present.project)).toEqual(beforeLinks);

    const mirror = applyCadSelectionTransform(
      project,
      [south.id],
      reflectionAboutLine({ x: 50, y: 0 }, { x: 50, y: 1 })!,
      { label: 'MIRROR copy', copyMode: 'MIRROR_COPY' },
    );
    expect(mirror.ok).toBe(true);
    if (!mirror.ok) return;
    const mirrorClone = mirror.project.entities.find(
      (entity): entity is CadParcelEntity =>
        entity.type === 'parcel' && entity.id !== south.id && entity.id !== north.id,
    );
    expect(mirrorClone).toBeDefined();
    if (mirrorClone) {
      expect(mirrorClone.courseIds).not.toEqual(south.courseIds);
      expect(listLinkedCourseIds(mirror.project, mirrorClone.id).size).toBe(0);
    }
    expect(listParcelSharedLinks(mirror.project)).toEqual(beforeLinks);
  });
});
