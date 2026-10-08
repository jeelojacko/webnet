/**
 * Phase C3 correction — inserted-vertex label association.
 *
 * The old insert helper synthesized a `V{i+1}` label once a polyline had any
 * explicit labels. Vertex labels are survey-point stationId references
 * (`syncEditedEntityDependencies` binds label + XY, `breaklineEntityRefs`
 * consumes vertexLabels), so a stored `V2` could fabricate a real survey for
 * an unrelated point named V2 at the same XY.
 *
 * C3 law: an inserted vertex is non-survey. Every insert stores `''`; the
 * `V{n}` ordinal is a DISPLAY-ONLY fallback (Properties), never persisted and
 * never routed into a source/breakline reference.
 */

import { describe, expect, it } from 'vitest';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { breaklineEntityRefs } from '../src/engine/cad/cadSurfaceRevision';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';
import {
  insertCadPolylineVertexOnCourse,
} from '../src/engine/cad/cadPolylineTopology';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../src/engine/cad/cadUndoRedo';
import type {
  CadEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const P = (x: number, y: number) => ({ x, y });
const A = P(0, 0);
const B = P(10, 0);
const C = P(10, 10);

const polyline = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => {
  const vertices = overrides.vertices ?? [A, B, C];
  const base: CadPolylineEntity = {
    id: 'poly-c3-labels',
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

const surveyPoint = (
  id: string,
  stationId: string,
  x: number,
  y: number,
): CadSurveyPointEntity => ({
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

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Phase C3 label association', units: 'm' });
  return { ...drawing.project, entities: [...drawing.project.entities, ...entities] };
};

const polylineOf = (state: CadHistoryState, id: string): CadPolylineEntity => {
  const entity = state.present.project.entities.find((candidate) => candidate.id === id);
  if (!entity || entity.type !== 'polyline') throw new Error('polyline missing');
  return entity;
};

const surveyPointOf = (state: CadHistoryState, stationId: string): CadSurveyPointEntity => {
  const entity = state.present.project.entities.find(
    (candidate): candidate is CadSurveyPointEntity =>
      candidate.type === 'survey-point' && candidate.stationId === stationId,
  );
  if (!entity) throw new Error(`survey point ${stationId} missing`);
  return entity;
};

const rowLabel = (project: CadProject, entity: CadEntity, key: string): string | undefined => {
  const state = buildCadPropertiesPanelState(project, [entity]);
  if (!state || state.mode !== 'single') throw new Error('properties missing');
  return state.entity.properties.find((row) => row.key === key)?.label;
};

// ---------------------------------------------------------------------------
// (a)-(c) storage law: one blank inserted vertex, originals untouched
// ---------------------------------------------------------------------------

describe('C3 label law: insert stores a blank, non-survey label', () => {
  it('stores exactly "" at the inserted index even when neighbors are labelled', () => {
    const entity = polyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] });
    // Old algorithm's pick: insertIndex 1 -> synthetic "V2".
    const result = insertCadPolylineVertexOnCourse(entity, { courseIndex: 0, x: 5, y: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (a) one extra vertex.
    expect(result.entity.vertices).toHaveLength(4);
    expect(result.entity.vertices).toEqual([A, P(5, 0), B, C]);
    // (b) stored label exactly ''.
    expect(result.entity.vertexLabels).toEqual(['A', '', 'B', 'C']);
    expect(result.entity.vertexLabels[1]).toBe('');
    // (c) A/B/C still on their original vertices (positional shift only).
    expect(result.entity.vertexLabels[0]).toBe('A');
    expect(result.entity.vertexLabels[2]).toBe('B');
    expect(result.entity.vertexLabels[3]).toBe('C');
    // No persisted synthetic id anywhere.
    expect(result.entity.vertexLabels).not.toContain('V2');
    expect((result.entity.metadata as Record<string, unknown> | undefined)?.['sourcePointIds']).toBeUndefined();
  });

  it('arc-course insert also stores the blank label', () => {
    const entity = polyline({
      vertices: [A, B, C],
      vertexLabels: ['A', 'B', 'C'],
      segmentGeometry: [{ kind: 'line' }, { kind: 'arc', bulge: 1 }],
    });
    const midpoint = describeParcelArcCourse(B, C, 1)!.midpoint;
    const result = insertCadPolylineVertexOnCourse(entity, {
      courseIndex: 1,
      x: midpoint.x,
      y: midpoint.y,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertexLabels[2]).toBe('');
    expect(result.entity.vertexLabels).toEqual(['A', 'B', '', 'C']);
  });

  it('closed final-course insert stores the blank at the appended vertex', () => {
    const entity = polyline({
      closed: true,
      vertices: [A, B, P(0, 10)],
      vertexLabels: ['A', 'B', 'C'],
    });
    const result = insertCadPolylineVertexOnCourse(entity, { courseIndex: 2, x: 0, y: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.closed).toBe(true);
    expect(result.entity.vertices).toEqual([A, B, P(0, 10), P(0, 5)]);
    expect(result.entity.vertexLabels).toEqual(['A', 'B', 'C', '']);
  });
});

// ---------------------------------------------------------------------------
// (d) display-only fallback
// ---------------------------------------------------------------------------

describe('C3 label law: Properties renders a blank slot as V<n> (display only)', () => {
  it('renders V{n} for the blank inserted slot and the real labels for the rest', () => {
    const inserted = insertCadPolylineVertexOnCourse(
      polyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] }),
      { courseIndex: 0, x: 5, y: 0 },
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const entity = inserted.entity;
    const project = projectWith([entity]);
    expect(rowLabel(project, entity, 'vertex:0:x')).toBe('A Easting');
    expect(rowLabel(project, entity, 'vertex:1:x')).toBe('V2 Easting');
    expect(rowLabel(project, entity, 'vertex:2:x')).toBe('B Easting');
    expect(rowLabel(project, entity, 'vertex:3:x')).toBe('C Easting');
    // Display fallback never leaks back into storage.
    expect(entity.vertexLabels).toEqual(['A', '', 'B', 'C']);
  });
});

// ---------------------------------------------------------------------------
// (e) breakline refs: real labels + blank slot, never a fabricated id
// ---------------------------------------------------------------------------

describe('C3 label law: breakline refs never fabricate a synthetic vertex id', () => {
  it('emits original real labels plus the blank slot, no V<n>', () => {
    const inserted = insertCadPolylineVertexOnCourse(
      polyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] }),
      { courseIndex: 0, x: 5, y: 0 },
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const refs = breaklineEntityRefs(inserted.entity);
    expect(refs).toEqual(['A', '', 'B', 'C']);
    expect(refs.some((ref) => /^V\d+$/.test(ref))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (f)-(g) production sync paths: blank never binds, real label still binds
// ---------------------------------------------------------------------------

describe('C3 label law: inserted blank vertex never binds a survey point', () => {
  const insertThenMove = (
    state: CadHistoryState,
    entityId: string,
    move: { x: number; y: number },
  ): CadHistoryState => {
    const inserted = runCadCommand(state, {
      key: 'POLYLINE_INSERT_VERTEX',
      entityId,
      courseIndex: 0,
      x: 5,
      y: 0,
    });
    expect(polylineOf(inserted, entityId).vertexLabels[1]).toBe('');
    return runCadCommand(inserted, {
      key: 'GRIP_EDIT',
      entityId,
      gripKind: 'vertex',
      vertexIndex: 1,
      x: move.x,
      y: move.y,
    });
  };

  it('GRIP_EDIT move of the inserted vertex leaves survey point V2 at the same XY', () => {
    const entity = polyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] });
    const history = createCadHistoryState(
      projectWith([entity, surveyPoint('pt-v2', 'V2', 5, 0)]),
    );
    const moved = insertThenMove(history, entity.id, { x: 50, y: 50 });
    const updated = polylineOf(moved, entity.id);
    expect(updated.vertices[1]).toEqual(P(50, 50));
    const v2 = surveyPointOf(moved, 'V2');
    expect(v2.x).toBe(5);
    expect(v2.y).toBe(0);
  });

  it('EDIT_ENTITY polyline-vertex move of the inserted vertex leaves survey point V2 at the same XY', () => {
    const entity = polyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] });
    const history = createCadHistoryState(
      projectWith([entity, surveyPoint('pt-v2', 'V2', 5, 0)]),
    );
    const inserted = runCadCommand(history, {
      key: 'POLYLINE_INSERT_VERTEX',
      entityId: entity.id,
      courseIndex: 0,
      x: 5,
      y: 0,
    });
    const moved = runCadCommand(inserted, {
      key: 'EDIT_ENTITY',
      entityId: entity.id,
      edit: { kind: 'polyline-vertex', vertexIndex: 1, x: 50, y: 50 },
    });
    const updated = polylineOf(moved, entity.id);
    expect(updated.vertices[1]).toEqual(P(50, 50));
    const v2 = surveyPointOf(moved, 'V2');
    expect(v2.x).toBe(5);
    expect(v2.y).toBe(0);
  });

  it('moving an ORIGINAL bound labelled vertex still syncs its survey point', () => {
    const entity = polyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] });
    const history = createCadHistoryState(projectWith([entity, surveyPoint('pt-b', 'B', 10, 0)]));
    const moved = runCadCommand(history, {
      key: 'GRIP_EDIT',
      entityId: entity.id,
      gripKind: 'vertex',
      vertexIndex: 1,
      x: 20,
      y: 0,
    });
    const updated = polylineOf(moved, entity.id);
    expect(updated.vertexLabels[1]).toBe('B');
    expect(updated.vertices[1]).toEqual(P(20, 0));
    const b = surveyPointOf(moved, 'B');
    expect(b.x).toBe(20);
    expect(b.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (h) undo/redo keeps blank-vs-real labels exact
// ---------------------------------------------------------------------------

describe('C3 label law: undo/redo preserves blank vs real labels exactly', () => {
  it('insert then delete round-trips through history with exact labels', () => {
    const entity = polyline({ vertices: [A, B, C], vertexLabels: ['A', 'B', 'C'] });
    const history = createCadHistoryState(projectWith([entity]));
    const before = history.present.project;

    const inserted = runCadCommand(history, {
      key: 'POLYLINE_INSERT_VERTEX',
      entityId: entity.id,
      courseIndex: 1,
      x: 10,
      y: 5,
    });
    expect(polylineOf(inserted, entity.id).vertexLabels).toEqual(['A', 'B', '', 'C']);
    const afterInsert = inserted.present.project;

    const undoneInsert = undoCadHistory(inserted);
    expect(undoneInsert.present.project).toBe(before);
    expect(redoCadHistory(undoneInsert).present.project).toBe(afterInsert);

    const deleted = runCadCommand(inserted, {
      key: 'POLYLINE_DELETE_VERTEX',
      entityId: entity.id,
      vertexIndex: 2,
    });
    expect(polylineOf(deleted, entity.id).vertexLabels).toEqual(['A', 'B', 'C']);
    const afterDelete = deleted.present.project;
    const undoneDelete = undoCadHistory(deleted);
    expect(polylineOf(undoneDelete, entity.id).vertexLabels).toEqual(['A', 'B', '', 'C']);
    expect(redoCadHistory(undoneDelete).present.project).toBe(afterDelete);
  });
});
