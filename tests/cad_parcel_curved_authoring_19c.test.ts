// Phase 19C Round 2B — parcel course authoring oracles.
import { describe, expect, it } from 'vitest';
import { CAD_COMMAND_REGISTRY } from '../src/engine/cad/cadTransactions';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { parcelPointsMatch } from '../src/engine/cad/cadCogoParcelGeometryPrimitives';
import type { CadArcEntity, CadParcelCourseGeometry, CadParcelEntity } from '../src/engine/cad/cadTypes';

const courseIds = (id: string, count: number): string[] => buildParcelCourseIds(id, count);

const makeParcel = (
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => {
  const parcel: CadParcelEntity = {
    id: 'parcel-author-1',
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    vertexLabels: ['A', 'B', 'C', 'D'],
    parcelName: 'Author Parcel',
    courseIds: courseIds('parcel-author-1', 4),
    ...(courseGeometry ? { courseGeometry } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

const projectWith = (entities: Array<CadParcelEntity | CadArcEntity>) => {
  let project = createBlankCadProject({ name: 'authoring', units: 'm' });
  project = appendCadProjectEntities(project, entities);
  return project;
};

const getParcel = (state: ReturnType<typeof runCadCommand>): CadParcelEntity =>
  state.present.project.entities.find(
    (entity): entity is CadParcelEntity => entity.type === 'parcel',
  )!;

const southArc: CadArcEntity = {
  id: 'src-arc',
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

describe('19C PARCELCOURSEARC authoring', () => {
  it('adopts an arc with same courseId, exact bulge, and untouched source', () => {
    const parcel = makeParcel();
    const project = projectWith([parcel, southArc]);
    const initial = createCadHistoryState(project, [parcel.id]);
    const next = runCadCommand(initial, {
      key: 'PARCELCOURSEARC',
      parcelEntityId: parcel.id,
      courseId: parcel.courseIds![0]!,
      arcEntityId: southArc.id,
    });
    const updated = getParcel(next);
    expect(updated.courseIds).toEqual(parcel.courseIds);
    expect(updated.courseGeometry?.[0]?.kind).toBe('arc');
    expect((updated.courseGeometry?.[0] as { bulge: number }).bulge).toBeCloseTo(1, 12);
    const sourceArc = next.present.project.entities.find((entity) => entity.id === southArc.id);
    expect(sourceArc).toEqual(southArc);
    // Area = 100 + semicircle.
    expect(updated.areaSquareMeters).toBeCloseTo(100 + 0.5 * Math.PI * 25, 6);

    // One undo restores the pre-adoption parcel exactly.
    const undone = undoCadHistory(next);
    expect(getParcel(undone).courseGeometry).toBeUndefined();
  });

  it('adopts a reversed arc (endpoints swapped) with a negated sweep', () => {
    const parcel = makeParcel();
    const reversedArc: CadArcEntity = {
      ...southArc,
      id: 'src-arc-reversed',
      startAngleDeg: 0,
      endAngleDeg: 180,
    };
    const project = projectWith([parcel, reversedArc]);
    const next = runCadCommand(createCadHistoryState(project, [parcel.id]), {
      key: 'PARCELCOURSEARC',
      parcelEntityId: parcel.id,
      courseId: parcel.courseIds![0]!,
      arcEntityId: reversedArc.id,
    });
    const updated = getParcel(next);
    expect(updated.courseGeometry?.[0]?.kind).toBe('arc');
    expect((updated.courseGeometry?.[0] as { bulge: number }).bulge).toBeCloseTo(-1, 12);
  });

  it('blocks on endpoint mismatch without mutating anything', () => {
    const parcel = makeParcel();
    const mismatched: CadArcEntity = {
      ...southArc,
      id: 'src-arc-mismatch',
      centerX: 5,
      centerY: 5,
      startAngleDeg: 90,
      endAngleDeg: 270,
    };
    const project = projectWith([parcel, mismatched]);
    const result = runCadCommand(createCadHistoryState(project, [parcel.id]), {
      key: 'PARCELCOURSEARC',
      parcelEntityId: parcel.id,
      courseId: parcel.courseIds![0]!,
      arcEntityId: mismatched.id,
    });
    // runCadCommand returns the same state on rejection (no transaction).
    expect(getParcel(result).courseGeometry).toBeUndefined();
    expect(result.undoStack).toHaveLength(0);
  });
});

describe('19C PARCELCOURSELINE authoring', () => {
  it('retires an arc course to its chord, preserving endpoints and courseId, with a warning', () => {
    const parcel = makeParcel([{ kind: 'arc', bulge: 1 }, { kind: 'line' }, { kind: 'line' }, { kind: 'line' }]);
    const project = projectWith([parcel]);    const next = runCadCommand(createCadHistoryState(project, [parcel.id]), {
      key: 'PARCELCOURSELINE',
      parcelEntityId: parcel.id,
      courseId: parcel.courseIds![0]!,
    });
    const updated = getParcel(next);
    expect(updated.courseGeometry?.[0]).toEqual({ kind: 'line' });
    expect(updated.courseIds).toEqual(parcel.courseIds);
    expect(parcelPointsMatch(updated.vertices[0]!, parcel.vertices[0]!)).toBe(true);
    expect(parcelPointsMatch(updated.vertices[1]!, parcel.vertices[1]!)).toBe(true);
    expect(updated.areaSquareMeters).toBeCloseTo(100, 6);
    expect(next.commandState.prompt).toContain('WARNING');
    // One undo restores the arc.
    const undone = undoCadHistory(next);
    expect(getParcel(undone).courseGeometry?.[0]?.kind).toBe('arc');
    expect((getParcel(undone).courseGeometry?.[0] as { bulge: number }).bulge).toBeCloseTo(1, 12);
  });
});

describe('19C authoring registration', () => {
  it('registers both engine commands and defers PARCELCOURSE3P', () => {
    expect(CAD_COMMAND_REGISTRY.PARCELCOURSEARC).toBeDefined();
    expect(CAD_COMMAND_REGISTRY.PARCELCOURSELINE).toBeDefined();
    expect('PARCELCOURSE3P' in CAD_COMMAND_REGISTRY).toBe(false);
  });
});
