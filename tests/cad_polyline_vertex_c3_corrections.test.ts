/**
 * Phase C3 corrections (review findings P1 + P2 + P2):
 *
 * - P1: count-changing vertex edits on a breakline-backed polyline fail
 *   closed with zero mutation/history (the boundary-only preflight missed
 *   entity-backed breaklines, whose chains consume vertex labels as refs).
 * - P2: a rejected PIV/PDV commit keeps the session alive with the typed
 *   failure reason instead of silently closing.
 * - P2 (Properties): lock/boundary/breakline refusals disable the action
 *   buttons with a reason, and row-action dispatch reports the ACTUAL
 *   transaction failure cause instead of a generic merge/midpoint guess.
 */

import { describe, expect, it } from 'vitest';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, type CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type {
  CadEntity,
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  handlePlineVertexPointPick,
  handlePlineVertexTypedSubmit,
} from '../src/hooks/surveyCad/useSurveyCadPolylineVertexSession';
import type { CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { runPolylineVertexRowAction } from '../src/hooks/surveyCad/surveyCadPolylineVertexActions';

const P = (x: number, y: number) => ({ x, y });
const LINE: CadPolylineSegmentGeometry = { kind: 'line' };
const arcGeom = (bulge: number): CadPolylineSegmentGeometry => ({ kind: 'arc', bulge });

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
  z: 10,
  pointClass: 'free',
  source: 'parsed-input',
});

const polyline = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => {
  const vertices = overrides.vertices ?? [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
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
  const drawing = createBlankCadDrawingDocument({ name: 'Phase C3 corrections', units: 'm' });
  return { ...drawing.project, entities: [...drawing.project.entities, ...entities] };
};

/** Surface whose entity-backed breakline consumes `polyId` vertex labels. */
const breaklineHistory = (polyId: string, polyLabels: string[]): CadHistoryState => {
  const poly = polyline({
    id: polyId,
    vertices: [P(0, 0), P(10, 0), P(10, 10), P(0, 10)],
    vertexLabels: polyLabels,
  });
  let history = createCadHistoryState(
    projectWith([
      surveyPoint('pt-a', 'A', 0, 0),
      surveyPoint('pt-b', 'B', 10, 0),
      surveyPoint('pt-c', 'C', 10, 10),
      surveyPoint('pt-d', 'D', 0, 10),
      poly,
    ]),
  );
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Site',
    pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d'] },
  });
  const created = history.present.project.surfaces![0]!;
  const withBreakline: CadProject = {
    ...history.present.project,
    surfaces: [
      {
        ...created,
        definition: {
          ...created.definition,
          breaklines: [{ id: 'bl-1', source: { kind: 'entity', entityId: polyId }, type: 'standard' }],
        },
      },
    ],
  };
  return createCadHistoryState(withBreakline);
};

const polylineOf = (state: CadHistoryState, id: string): CadPolylineEntity => {
  const entity = state.present.project.entities.find((candidate) => candidate.id === id);
  if (!entity || entity.type !== 'polyline') throw new Error('polyline missing');
  return entity;
};

// ---------------------------------------------------------------------------
// P1 — breakline-source preflight on the commit path
// ---------------------------------------------------------------------------

describe('C3 P1: breakline-backed polylines refuse count-changing edits', () => {
  it('labelled-vertex delete is refused with zero mutation/history', () => {
    const state = breaklineHistory('poly-bl', ['A', 'B', 'C', 'D']);
    const before = state.present.project;
    const next = runCadCommand(state, {
      key: 'POLYLINE_DELETE_VERTEX',
      entityId: 'poly-bl',
      vertexIndex: 1,
    });
    expect(next).toBe(state);
    expect(next.undoStack).toHaveLength(0);
    expect(next.present.project).toBe(before);
    expect(polylineOf(next, 'poly-bl').vertices).toHaveLength(4);
    expect(polylineOf(next, 'poly-bl').vertexLabels).toEqual(['A', 'B', 'C', 'D']);
  });

  it('labelled insert is refused with zero mutation/history', () => {
    const state = breaklineHistory('poly-bl', ['A', 'B', 'C', 'D']);
    const before = state.present.project;
    const next = runCadCommand(state, {
      key: 'POLYLINE_INSERT_VERTEX',
      entityId: 'poly-bl',
      courseIndex: 0,
      x: 5,
      y: 0,
    });
    expect(next).toBe(state);
    expect(next.undoStack).toHaveLength(0);
    expect(next.present.project).toBe(before);
    expect(polylineOf(next, 'poly-bl').vertices).toHaveLength(4);
  });

  it('an unlabeled breakline-backed polyline stays editable (no label refs)', () => {
    const state = breaklineHistory('poly-plain', ['', '', '', '']);
    const next = runCadCommand(state, {
      key: 'POLYLINE_INSERT_VERTEX',
      entityId: 'poly-plain',
      courseIndex: 0,
      x: 5,
      y: 0,
    });
    expect(next).not.toBe(state);
    expect(polylineOf(next, 'poly-plain').vertices).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// P2 — rejected session edits keep the session alive with the typed reason
// ---------------------------------------------------------------------------

describe('C3 P2: rejected PIV/PDV commits keep the session alive', () => {
  it('typed delete on an unmergeable vertex stays open with the merge reason', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [LINE, arcGeom(1)],
    });
    let history = createCadHistoryState(projectWith([entity]));
    let replaced: CommandSession | null | undefined;
    const handled = handlePlineVertexTypedSubmit({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      history,
      replaceSession: (next) => {
        replaced = next;
      },
      session: { key: 'PLINEDELETEVERTEX', inputValue: 'V2', polylineId: entity.id },
    });
    expect(handled).toBe(true);
    expect(history.undoStack).toHaveLength(0);
    expect(polylineOf(history, entity.id).vertices).toHaveLength(3);
    expect(replaced).not.toBeNull();
    expect(replaced?.key).toBe('PLINEDELETEVERTEX');
    expect((replaced as { polylineId: string | null }).polylineId).toBe(entity.id);
    expect(replaced?.resultText).toMatch(/merge/i);
  });

  it('point-pick delete on a breakline-backed polyline stays open with the breakline reason', () => {
    let history = breaklineHistory('poly-bl', ['A', 'B', 'C', 'D']);
    const undoDepth = history.undoStack.length;
    let replaced: CommandSession | null | undefined;
    const handled = handlePlineVertexPointPick({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      current: { key: 'PLINEDELETEVERTEX', inputValue: '', polylineId: 'poly-bl' },
      history,
      point: { x: 10, y: 0, label: '10,0' },
      replaceSession: (next) => {
        replaced = next;
      },
    });
    expect(handled).toBe(true);
    expect(history.undoStack).toHaveLength(undoDepth);
    expect(polylineOf(history, 'poly-bl').vertices).toHaveLength(4);
    expect(replaced).not.toBeNull();
    expect(replaced?.resultText).toMatch(/breakline/i);
  });

  it('point-pick insert on a breakline-backed polyline stays open with the breakline reason', () => {
    let history = breaklineHistory('poly-bl', ['A', 'B', 'C', 'D']);
    const undoDepth = history.undoStack.length;
    let replaced: CommandSession | null | undefined;
    const handled = handlePlineVertexPointPick({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      current: { key: 'PLINEINSERTVERTEX', inputValue: '', polylineId: 'poly-bl' },
      history,
      point: { x: 5, y: 0, label: '5,0' },
      replaceSession: (next) => {
        replaced = next;
      },
    });
    expect(handled).toBe(true);
    expect(history.undoStack).toHaveLength(undoDepth);
    expect(polylineOf(history, 'poly-bl').vertices).toHaveLength(4);
    expect(replaced).not.toBeNull();
    expect(replaced?.resultText).toMatch(/breakline/i);
  });
});

// ---------------------------------------------------------------------------
// Correction — commit applies atomically against the latest history
// ---------------------------------------------------------------------------

describe('C3 correction: vertex commit runs against the latest history', () => {
  it('a concurrent update between render and commit is preserved', () => {
    const entity = polyline();
    const renderHistory = createCadHistoryState(projectWith([entity]));
    // A concurrent workspace update lands after the session captured its
    // render-time snapshot, before the vertex pick commits.
    let latest = runCadCommand(renderHistory, { key: 'POINT', x: 100, y: 100 });
    expect(latest).not.toBe(renderHistory);
    const concurrentUndoDepth = latest.undoStack.length;

    let replaced: CommandSession | null | undefined;
    const handled = handlePlineVertexPointPick({
      applyHistoryUpdate: (updater) => {
        latest = updater(latest);
      },
      current: { key: 'PLINEDELETEVERTEX', inputValue: '', polylineId: entity.id },
      history: renderHistory,
      point: { x: 10, y: 0, label: '10,0' },
      replaceSession: (next) => {
        replaced = next;
      },
    });

    expect(handled).toBe(true);
    expect(replaced).toBeNull();
    // The concurrent POINT survives and the vertex delete stacks on top.
    expect(latest.undoStack).toHaveLength(concurrentUndoDepth + 1);
    expect(
      latest.present.project.entities.filter((candidate) => candidate.type === 'survey-point'),
    ).toHaveLength(1);
    expect(polylineOf(latest, entity.id).vertices).toEqual([P(0, 0), P(10, 10), P(0, 10)]);
  });
});

// ---------------------------------------------------------------------------
// P2 (Properties) — disable reasons cover locked + boundary + breakline
// ---------------------------------------------------------------------------

const panelActions = (project: CadProject, entity: CadEntity) => {
  const state = buildCadPropertiesPanelState(project, [entity]);
  if (!state || state.mode !== 'single') throw new Error('properties missing');
  return state.entity.properties.flatMap((row) => row.actions ?? []);
};

describe('C3 P2 Properties: action buttons state the real refusal', () => {
  it('a locked polyline disables every vertex action with a lock reason', () => {
    const entity = polyline({ locked: true });
    const project = projectWith([entity]);
    const deletes = panelActions(project, entity).filter(
      (action) => action.kind === 'polyline-delete-vertex',
    );
    const inserts = panelActions(project, entity).filter(
      (action) => action.kind === 'polyline-insert-vertex',
    );
    expect(deletes.length).toBeGreaterThan(0);
    expect(inserts.length).toBeGreaterThan(0);
    for (const action of [...deletes, ...inserts]) {
      expect(action.disabledReason).toMatch(/lock/i);
    }
  });

  it('a breakline-backed labelled polyline disables every vertex action with a breakline reason', () => {
    const history = breaklineHistory('poly-bl', ['A', 'B', 'C', 'D']);
    const entity = polylineOf(history, 'poly-bl');
    const actions = panelActions(history.present.project, entity);
    const deletes = actions.filter((action) => action.kind === 'polyline-delete-vertex');
    const inserts = actions.filter((action) => action.kind === 'polyline-insert-vertex');
    expect(deletes).toHaveLength(4);
    expect(inserts).toHaveLength(3);
    for (const action of [...deletes, ...inserts]) {
      expect(action.disabledReason).toMatch(/breakline/i);
    }
  });

  it('row-action dispatch reports the actual cause, not a generic guess', () => {
    const locked = polyline({ id: 'locked', locked: true });
    const lockedProject = projectWith([locked]);
    const lockedOutcome = runPolylineVertexRowAction(
      { kind: 'polyline-delete-vertex', linkId: 'x', label: 'Delete Vertex', entityId: 'locked', vertexIndex: 1 },
      lockedProject,
      () => false,
    );
    expect(lockedOutcome?.applied).toBe(false);
    expect(lockedOutcome?.reason).toMatch(/not editable/i);
    expect(lockedOutcome?.reason).not.toMatch(/merged safely/);

    const merged = polyline({
      id: 'merged',
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [LINE, arcGeom(1)],
    });
    const mergedOutcome = runPolylineVertexRowAction(
      { kind: 'polyline-delete-vertex', linkId: 'x', label: 'Delete Vertex', entityId: 'merged', vertexIndex: 1 },
      projectWith([merged]),
      () => false,
    );
    expect(mergedOutcome?.applied).toBe(false);
    expect(mergedOutcome?.reason).toMatch(/merge/i);

    const history = breaklineHistory('poly-bl', ['A', 'B', 'C', 'D']);
    const breaklineOutcome = runPolylineVertexRowAction(
      { kind: 'polyline-insert-vertex', linkId: 'x', label: 'Insert Vertex', entityId: 'poly-bl', courseIndex: 0 },
      history.present.project,
      () => false,
    );
    expect(breaklineOutcome?.applied).toBe(false);
    expect(breaklineOutcome?.reason).toMatch(/breakline/i);
    expect(breaklineOutcome?.reason).not.toMatch(/midpoint is not insertable/);
  });
});
