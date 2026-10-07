/**
 * Phase C3 — grip matrix + Properties row-action surfaces for polyline
 * vertex insert/delete. The pure topology + engine transactions are covered
 * by `cad_polyline_vertex_topology_c3*.test.ts`; this file proves the UI
 * wiring: grip kinds/positions/counts, non-polyline grip compatibility, the
 * insert preview/commit law, and the Properties action rows + dispatch.
 */

import { describe, expect, it } from 'vitest';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import {
  applyCadGripEdit,
  buildCadGripHandles,
} from '../src/engine/cad/cadTransactionsEntityTransforms';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadCircleEntity,
  CadEntity,
  CadLineEntity,
  CadParcelEntity,
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadProject,
} from '../src/engine/cad/cadTypes';
import { runPolylineVertexRowAction } from '../src/hooks/surveyCad/surveyCadPolylineVertexActions';

const P = (x: number, y: number) => ({ x, y });
const LINE: CadPolylineSegmentGeometry = { kind: 'line' };
const arcGeom = (bulge: number): CadPolylineSegmentGeometry => ({ kind: 'arc', bulge });

const polyline = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => {
  const vertices = overrides.vertices ?? [P(0, 0), P(10, 0), P(10, 10), P(20, 10)];
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
  const drawing = createBlankCadDrawingDocument({ name: 'Phase C3 grips', units: 'm' });
  return { ...drawing.project, entities: [...drawing.project.entities, ...entities] };
};

const vertexGrips = (entity: CadEntity) =>
  buildCadGripHandles(entity).filter((grip) => grip.kind === 'vertex');
const insertGrips = (entity: CadEntity) =>
  buildCadGripHandles(entity).filter((grip) => grip.kind === 'polyline-insert');

// ---------------------------------------------------------------------------
// Grip matrix
// ---------------------------------------------------------------------------

describe('C3 grip matrix: polyline exposes vertex + per-course insert grips', () => {
  it('open N=4 exposes N vertex grips + N-1 insert grips at line midpoints', () => {
    const entity = polyline();
    expect(vertexGrips(entity)).toHaveLength(4);
    const inserts = insertGrips(entity);
    expect(inserts).toHaveLength(3);
    expect(inserts.map((grip) => grip.courseIndex)).toEqual([0, 1, 2]);
    expect(inserts.map((grip) => [grip.x, grip.y])).toEqual([
      [5, 0],
      [10, 5],
      [15, 10],
    ]);
  });

  it('closed N=4 exposes N insert grips with no duplicate closure grip', () => {
    const entity = polyline({
      closed: true,
      vertices: [P(0, 0), P(10, 0), P(10, 10), P(0, 10)],
    });
    const inserts = insertGrips(entity);
    expect(inserts).toHaveLength(4);
    expect(inserts.map((grip) => grip.courseIndex)).toEqual([0, 1, 2, 3]);
    // Final course wraps last→first: midpoint of (0,10)-(0,0).
    expect([inserts[3]!.x, inserts[3]!.y]).toEqual([0, 5]);
    // No duplicate closure grip id.
    expect(new Set(inserts.map((grip) => grip.id)).size).toBe(4);
  });

  it('arc course insert grip rides the signed-sweep arc midpoint, never the chord midpoint', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0)],
      segmentGeometry: [arcGeom(1)],
    });
    const inserts = insertGrips(entity);
    expect(inserts).toHaveLength(1);
    const metrics = describeParcelArcCourse(P(0, 0), P(10, 0), 1)!;
    expect(inserts[0]!.x).toBeCloseTo(metrics.midpoint.x, 9);
    expect(inserts[0]!.y).toBeCloseTo(metrics.midpoint.y, 9);
    // Off the chord midpoint (5, 0) — a true curve midpoint.
    expect(Math.hypot(inserts[0]!.x - 5, inserts[0]!.y - 0)).toBeGreaterThan(1);
  });

  it('mixed line+arc exposes one insert grip per course with per-course midpoints', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [LINE, arcGeom(1)],
    });
    const inserts = insertGrips(entity);
    expect(inserts.map((grip) => grip.courseIndex)).toEqual([0, 1]);
    expect([inserts[0]!.x, inserts[0]!.y]).toEqual([5, 0]);
    const metrics = describeParcelArcCourse(P(10, 0), P(20, 0), 1)!;
    expect(inserts[1]!.x).toBeCloseTo(metrics.midpoint.x, 9);
    expect(inserts[1]!.y).toBeCloseTo(metrics.midpoint.y, 9);
  });

  it('non-polyline grips are unchanged (line, circle, parcel have no insert grips)', () => {
    const line: CadLineEntity = {
      id: 'line-1',
      type: 'line',
      layerId: 'general',
      visible: true,
      locked: false,
      fromX: 0,
      fromY: 0,
      toX: 1,
      toY: 1,
      fromStationId: 'A',
      toStationId: 'B',
      sourceObservationIds: [],
    };
    const circle: CadCircleEntity = {
      id: 'circle-1',
      type: 'circle',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 0,
      centerY: 0,
      radius: 5,
    };
    const parcel: CadParcelEntity = {
      id: 'parcel-1',
      type: 'parcel',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: [P(0, 0), P(1, 0), P(1, 1)],
      vertexLabels: ['', '', ''],
      parcelName: 'LOT 1',
    };
    expect(buildCadGripHandles(line).map((grip) => grip.kind)).toEqual(['line-start', 'line-end']);
    expect(buildCadGripHandles(circle).map((grip) => grip.kind)).toEqual([
      'circle-center',
      'circle-radius',
    ]);
    expect(insertGrips(parcel)).toHaveLength(0);
    expect(vertexGrips(parcel)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Insert law through the preview/commit seam
// ---------------------------------------------------------------------------

describe('C3 insert law: grip insert splits the course, projection preserves the path', () => {
  it('line insert projects the cursor onto the original course (no off-course vertex)', () => {
    const entity = polyline({ vertices: [P(0, 0), P(10, 10)] });
    const project = projectWith([entity]);
    const history = createCadHistoryState(project);
    // Cursor off the course: (2.5, 5). Projection onto (0,0)-(10,10) = (3.75,3.75).
    const next = runCadCommand(history, {
      key: 'POLYLINE_INSERT_VERTEX',
      entityId: entity.id,
      courseIndex: 0,
      x: 2.5,
      y: 5,
    });
    const updated = next.present.project.entities.find(
      (candidate) => candidate.id === entity.id,
    ) as CadPolylineEntity;
    expect(updated.vertices).toEqual([P(0, 0), P(3.75, 3.75), P(10, 10)]);
    // The projected vertex lies exactly on the original line (y = x).
    expect(updated.vertices[1]!.y).toBeCloseTo(updated.vertices[1]!.x, 9);
  });

  it('arc insert splits into two same-circle sub-arcs at the projected on-sweep point', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0)],
      segmentGeometry: [arcGeom(1)],
    });
    const project = projectWith([entity]);
    const history = createCadHistoryState(project);
    const metrics = describeParcelArcCourse(P(0, 0), P(10, 0), 1)!;
    // Insert at the true arc midpoint.
    const next = runCadCommand(history, {
      key: 'POLYLINE_INSERT_VERTEX',
      entityId: entity.id,
      courseIndex: 0,
      x: metrics.midpoint.x,
      y: metrics.midpoint.y,
    });
    const updated = next.present.project.entities.find(
      (candidate) => candidate.id === entity.id,
    ) as CadPolylineEntity;
    expect(updated.vertices).toHaveLength(3);
    expect(updated.vertices[1]!.x).toBeCloseTo(metrics.midpoint.x, 6);
    expect(updated.vertices[1]!.y).toBeCloseTo(metrics.midpoint.y, 6);
    expect(updated.segmentGeometry).toHaveLength(2);
    expect(updated.segmentGeometry!.every((entry) => entry.kind === 'arc')).toBe(true);
    // The inserted point rides the original circle (not the chord).
    const radiusFromCenter = Math.hypot(
      updated.vertices[1]!.x - metrics.center.x,
      updated.vertices[1]!.y - metrics.center.y,
    );
    expect(radiusFromCenter).toBeCloseTo(metrics.radius, 6);
  });

  it('vertex move (GRIP_EDIT) stays a pure move with no count change', () => {
    const entity = polyline({ vertices: [P(0, 0), P(10, 0), P(10, 10)] });
    const project = projectWith([entity]);
    const next = applyCadGripEdit(project, {
      key: 'GRIP_EDIT',
      entityId: entity.id,
      gripKind: 'vertex',
      vertexIndex: 1,
      x: 12,
      y: 0,
    })!;
    const updated = next.entities.find((candidate) => candidate.id === entity.id) as CadPolylineEntity;
    expect(updated.vertices).toHaveLength(3);
    expect(updated.vertices[1]).toEqual(P(12, 0));
  });
});

// ---------------------------------------------------------------------------
// Properties rows + action dispatch
// ---------------------------------------------------------------------------

const panelRows = (entity: CadEntity) => {
  const state = buildCadPropertiesPanelState(projectWith([entity]), [entity]);
  if (!state || state.mode !== 'single') throw new Error('properties missing');
  return state.entity.properties;
};

describe('C3 Properties: per-vertex Delete and per-course Insert actions', () => {
  it('a 2-vertex open polyline disables every Delete Vertex with a min-count reason', () => {
    const entity = polyline({ vertices: [P(0, 0), P(10, 0)] });
    const deleteActions = panelRows(entity)
      .flatMap((row) => row.actions ?? [])
      .filter((action) => action.kind === 'polyline-delete-vertex');
    expect(deleteActions).toHaveLength(2);
    for (const action of deleteActions) {
      expect(action.disabledReason).toBeTruthy();
      expect(action.vertexIndex).not.toBeUndefined();
    }
  });

  it('a legal 3-vertex open polyline enables Delete Vertex on every vertex', () => {
    const entity = polyline({ vertices: [P(0, 0), P(10, 0), P(10, 10)] });
    const deleteActions = panelRows(entity)
      .flatMap((row) => row.actions ?? [])
      .filter((action) => action.kind === 'polyline-delete-vertex');
    expect(deleteActions.map((action) => action.vertexIndex)).toEqual([0, 1, 2]);
    expect(deleteActions.every((action) => action.disabledReason == null)).toBe(true);
  });

  it('a mixed line+arc interior vertex is disabled as an unrepresentable merge', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [LINE, arcGeom(1)],
    });
    const actions = panelRows(entity).flatMap((row) => row.actions ?? []);
    const interior = actions.find(
      (action) => action.kind === 'polyline-delete-vertex' && action.vertexIndex === 1,
    );
    expect(interior?.disabledReason).toMatch(/merge/i);
    // Endpoints simply drop a course and stay enabled.
    const endpoint = actions.find(
      (action) => action.kind === 'polyline-delete-vertex' && action.vertexIndex === 0,
    );
    expect(endpoint?.disabledReason).toBeUndefined();
  });

  it('emits one Insert Vertex action per course', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [LINE, arcGeom(1)],
    });
    const insertActions = panelRows(entity)
      .flatMap((row) => row.actions ?? [])
      .filter((action) => action.kind === 'polyline-insert-vertex');
    expect(insertActions.map((action) => action.courseIndex)).toEqual([0, 1]);
    expect(insertActions.every((action) => action.disabledReason == null)).toBe(true);
  });

  it('row-action dispatch sends the true course midpoint and the exact vertex index', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [LINE, arcGeom(1)],
    });
    const project = projectWith([entity]);
    const commands: CadCommand[] = [];
    const run = (command: CadCommand) => {
      commands.push(command);
      return true;
    };
    const insertOutcome = runPolylineVertexRowAction(
      {
        kind: 'polyline-insert-vertex',
        linkId: 'x',
        label: 'Insert Vertex',
        entityId: entity.id,
        courseIndex: 1,
      },
      project,
      run,
    );
    expect(insertOutcome).toEqual({ applied: true });
    const metrics = describeParcelArcCourse(P(10, 0), P(20, 0), 1)!;
    expect(commands[0]).toEqual({
      key: 'POLYLINE_INSERT_VERTEX',
      entityId: entity.id,
      courseIndex: 1,
      x: metrics.midpoint.x,
      y: metrics.midpoint.y,
    });
    const deleteOutcome = runPolylineVertexRowAction(
      {
        kind: 'polyline-delete-vertex',
        linkId: 'x',
        label: 'Delete Vertex',
        entityId: entity.id,
        vertexIndex: 2,
      },
      project,
      run,
    );
    expect(deleteOutcome).toEqual({ applied: true });
    expect(commands[1]).toEqual({
      key: 'POLYLINE_DELETE_VERTEX',
      entityId: entity.id,
      vertexIndex: 2,
    });
  });

  it('non-polyline row actions are left to the caller (null)', () => {
    const outcome = runPolylineVertexRowAction(
      { kind: 'parcel-unlink', linkId: 'l', label: 'Unlink' },
      projectWith([]),
      () => true,
    );
    expect(outcome).toBeNull();
  });
});
