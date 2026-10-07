import { describe, expect, it } from 'vitest';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const P = (x: number, y: number) => ({ x, y });
const A = P(0, 0);
const B = P(10, 0);
const C = P(0, 10);

const polylineEntity = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => {
  const vertices = overrides.vertices ?? [P(A.x, A.y), P(B.x, B.y), P(C.x, C.y)];
  const base: CadPolylineEntity = {
    id: 'poly-c3',
    type: 'polyline',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices,
    vertexLabels: vertices.map(() => ''),
    closed: false,
  };
  return { ...base, ...overrides };
};

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Phase C3', units: 'm' });
  return { ...drawing.project, entities: [...drawing.project.entities, ...entities] };
};

const polylineOf = (state: CadHistoryState, id = 'poly-c3'): CadPolylineEntity => {
  const entity = state.present.project.entities.find((candidate) => candidate.id === id);
  if (!entity || entity.type !== 'polyline') throw new Error('polyline missing');
  return entity;
};

const insertCommand = (
  entityId: string,
  courseIndex: number,
  x: number,
  y: number,
): CadCommand => ({ key: 'POLYLINE_INSERT_VERTEX', entityId, courseIndex, x, y });

const deleteCommand = (entityId: string, vertexIndex: number): CadCommand => ({
  key: 'POLYLINE_DELETE_VERTEX',
  entityId,
  vertexIndex,
});

// ---------------------------------------------------------------------------
// Insert transaction
// ---------------------------------------------------------------------------

describe('C3 POLYLINE_INSERT_VERTEX', () => {
  it('commits one entity + one history entry with planar projection', () => {
    const state = createCadHistoryState(projectWith([polylineEntity({ vertices: [A, P(10, 10)] })]));
    const next = runCadCommand(state, insertCommand('poly-c3', 0, 2.5, 2.5));
    expect(next).not.toBe(state);
    expect(next.undoStack).toHaveLength(1);
    const entity = polylineOf(next);
    expect(entity.vertices).toEqual([P(0, 0), P(2.5, 2.5), P(10, 10)]);
    expect(next.present.selection.selectedEntityIds).toEqual(['poly-c3']);
    expect(next.undoStack[0]!.transaction.commandKey).toBe('POLYLINE_INSERT_VERTEX');
  });

  it('splits widths through the command', () => {
    const state = createCadHistoryState(
      projectWith([
        polylineEntity({
          vertices: [A, B],
          segmentWidths: [{ startWidth: 0, endWidth: 1 }],
        }),
      ]),
    );
    const next = runCadCommand(state, insertCommand('poly-c3', 0, 2, 0));
    expect(polylineOf(next).segmentWidths).toEqual([
      { startWidth: 0, endWidth: 0.2 },
      { startWidth: 0.2, endWidth: 1 },
    ]);
  });

  it('appends on a closed final course with no duplicate closure vertex', () => {
    const state = createCadHistoryState(
      projectWith([polylineEntity({ closed: true, vertices: [A, B, C] })]),
    );
    const next = runCadCommand(state, insertCommand('poly-c3', 2, 0, 5));
    const entity = polylineOf(next);
    expect(entity.closed).toBe(true);
    expect(entity.vertices).toEqual([A, B, C, P(0, 5)]);
    expect(entity.vertices[0]).not.toEqual(entity.vertices.at(-1));
  });

  it('undo/redo restores the exact before/after project', () => {
    const state = createCadHistoryState(projectWith([polylineEntity({ vertices: [A, P(10, 10)] })]));
    const before = state.present.project;
    const next = runCadCommand(state, insertCommand('poly-c3', 0, 2.5, 2.5));
    const after = next.present.project;
    const undone = undoCadHistory(next);
    expect(undone.present.project).toBe(before);
    const redone = redoCadHistory(undone);
    expect(redone.present.project).toBe(after);
  });

  it('rejects an endpoint-near insert with zero mutation/history', () => {
    const state = createCadHistoryState(projectWith([polylineEntity({ vertices: [A, B] })]));
    const next = runCadCommand(state, insertCommand('poly-c3', 0, 0, 0));
    expect(next).toBe(state);
    expect(next.undoStack).toHaveLength(0);
    expect(state.present.project.surfaces ?? []).toHaveLength(0);
  });

  it('rejects an out-of-range course, malformed metadata, and a locked source', () => {
    const state = createCadHistoryState(projectWith([polylineEntity({ vertices: [A, B] })]));
    expect(runCadCommand(state, insertCommand('poly-c3', 9, 5, 0))).toBe(state);

    const malformed = createCadHistoryState(
      projectWith([
        polylineEntity({
          vertices: [A, B, C],
          segmentGeometry: [{ kind: 'arc', bulge: 1 }],
        }),
      ]),
    );
    expect(runCadCommand(malformed, insertCommand('poly-c3', 0, 5, 0))).toBe(malformed);

    const locked = createCadHistoryState(
      projectWith([polylineEntity({ vertices: [A, B], locked: true })]),
    );
    expect(runCadCommand(locked, insertCommand('poly-c3', 0, 5, 0))).toBe(locked);
    expect(locked.undoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Delete transaction
// ---------------------------------------------------------------------------

describe('C3 POLYLINE_DELETE_VERTEX', () => {
  it('merges an interior line join into one straight leg', () => {
    const state = createCadHistoryState(
      projectWith([polylineEntity({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] })]),
    );
    const next = runCadCommand(state, deleteCommand('poly-c3', 1));
    expect(next.undoStack).toHaveLength(1);
    const entity = polylineOf(next);
    expect(entity.vertices).toEqual([A, C]);
    expect(entity.vertexLabels).toEqual(['A', 'C']);
    expect('segmentGeometry' in entity).toBe(false);
  });

  it('undo/redo restores the exact before/after project', () => {
    const state = createCadHistoryState(projectWith([polylineEntity({ vertices: [A, B, C] })]));
    const before = state.present.project;
    const next = runCadCommand(state, deleteCommand('poly-c3', 1));
    const after = next.present.project;
    const undone = undoCadHistory(next);
    expect(undone.present.project).toBe(before);
    expect(undoCadHistory(redoCadHistory(undone)).present.project).toBe(before);
    expect(redoCadHistory(undone).present.project).toBe(after);
  });

  it('blocks a min-count delete and an incompatible arc merge with zero mutation', () => {
    const minState = createCadHistoryState(projectWith([polylineEntity({ vertices: [A, B] })]));
    expect(runCadCommand(minState, deleteCommand('poly-c3', 0))).toBe(minState);

    const arcState = createCadHistoryState(
      projectWith([
        polylineEntity({
          vertices: [A, B, C],
          segmentGeometry: [{ kind: 'arc', bulge: 1 }, { kind: 'line' }],
        }),
      ]),
    );
    expect(runCadCommand(arcState, deleteCommand('poly-c3', 1))).toBe(arcState);
    expect(arcState.undoStack).toHaveLength(0);
  });

  it('rejects an out-of-range vertex index and a locked source', () => {
    const state = createCadHistoryState(projectWith([polylineEntity({ vertices: [A, B, C] })]));
    expect(runCadCommand(state, deleteCommand('poly-c3', 9))).toBe(state);

    const locked = createCadHistoryState(
      projectWith([polylineEntity({ vertices: [A, B, C], locked: true })]),
    );
    expect(runCadCommand(locked, deleteCommand('poly-c3', 1))).toBe(locked);
  });
});

// ---------------------------------------------------------------------------
// Boundary dependency preflight
// ---------------------------------------------------------------------------

const surveyPoint = (id: string, stationId: string, x: number, y: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z: 0,
  pointClass: 'free',
  source: 'parsed-input',
});

const boundaryHistory = (): CadHistoryState => {
  const drawing = createBlankCadDrawingDocument({ name: 'C3 boundary', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [
      ...drawing.project.entities,
      surveyPoint('pt-1', 'A', 0, 0),
      surveyPoint('pt-2', 'B', 10, 0),
      surveyPoint('pt-3', 'C', 10, 10),
      surveyPoint('pt-4', 'D', 0, 10),
      polylineEntity({ id: 'poly-boundary', vertices: [A, B, C], vertexLabels: ['', '', ''] }),
    ],
  };
  const created = runCadCommand(createCadHistoryState(project), {
    key: 'SURFACE_CREATE',
    name: 'Site',
    pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
  });
  const surfaceId = created.present.project.surfaces![0]!.id;
  const attached = runCadCommand(created, {
    key: 'SURFACE_ADD_BOUNDARY',
    surfaceId,
    kind: 'outer',
    sourceEntityId: 'poly-boundary',
  });
  if (attached === created) throw new Error('boundary attach failed');
  return attached;
};

describe('C3 boundary-source preflight', () => {
  it('rejects a count-changing delete that would invalidate the boundary ring', () => {
    const state = boundaryHistory();
    const before = state.present.project;
    const next = runCadCommand(state, deleteCommand('poly-boundary', 1));
    expect(next).toBe(state);
    expect(next.undoStack).toHaveLength(state.undoStack.length);
    expect(next.present.project).toBe(before);
    expect(polylineOf(next, 'poly-boundary').vertices).toEqual([A, B, C]);
  });

  it('allows an area-equivalent collinear insert on a boundary source', () => {
    const state = boundaryHistory();
    const next = runCadCommand(state, insertCommand('poly-boundary', 0, 5, 0));
    expect(next).not.toBe(state);
    expect(polylineOf(next, 'poly-boundary').vertices).toEqual([A, P(5, 0), B, C]);
    expect(next.undoStack).toHaveLength(state.undoStack.length + 1);
  });
});
