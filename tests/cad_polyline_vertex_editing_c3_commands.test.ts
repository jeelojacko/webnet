/**
 * Phase C3 — command-surface tests for PLINEINSERTVERTEX / PLINEDELETEVERTEX:
 * registry resolution + collision-free aliases, prompt/point-pick behavior,
 * and the typed submit path. The engine transactions themselves are covered
 * by `cad_polyline_vertex_topology_c3_commands.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, type CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';
import type { CadEntity, CadPolylineEntity, CadProject } from '../src/engine/cad/cadTypes';
import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import {
  handlePlineVertexPointPick,
  handlePlineVertexTypedSubmit,
  resolveSoleSelectedEditablePolyline,
} from '../src/hooks/surveyCad/useSurveyCadPolylineVertexSession';
import { sessionExpectsPointPick } from '../src/hooks/surveyCad/useSurveyCadCommandSession';
import { promptForSession } from '../src/hooks/surveyCad/useSurveyCadCommandText';
import type { CommandPoint, CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';

const P = (x: number, y: number) => ({ x, y });
const point = (x: number, y: number): CommandPoint => ({ x, y, label: `${x},${y}` });

const polyline = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => {
  const vertices = overrides.vertices ?? [P(0, 0), P(10, 0), P(10, 10)];
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
  const drawing = createBlankCadDrawingDocument({ name: 'Phase C3 commands', units: 'm' });
  return { ...drawing.project, entities: [...drawing.project.entities, ...entities] };
};

const polylineOf = (state: CadHistoryState, id = 'poly-c3'): CadPolylineEntity => {
  const entity = state.present.project.entities.find((candidate) => candidate.id === id);
  if (!entity || entity.type !== 'polyline') throw new Error('polyline missing');
  return entity;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('C3 command registry: PLINEINSERTVERTEX / PLINEDELETEVERTEX', () => {
  it('resolves both keys as sessions', () => {
    expect(resolveShellCommandText('PLINEINSERTVERTEX')?.key).toBe('PLINEINSERTVERTEX');
    expect(resolveShellCommandText('PLINEDELETEVERTEX')?.key).toBe('PLINEDELETEVERTEX');
    expect(resolveShellCommandText('PLINEINSERTVERTEX')?.kind).toBe('session');
    expect(resolveShellCommandText('PLINEDELETEVERTEX')?.kind).toBe('session');
  });

  it('aliases PIV / PDV are collision-free and case-insensitive', () => {
    expect(resolveShellCommandText('PIV')?.key).toBe('PLINEINSERTVERTEX');
    expect(resolveShellCommandText('pdv')?.key).toBe('PLINEDELETEVERTEX');
    // No other definition claims these aliases.
    for (const alias of ['PIV', 'PDV']) {
      const claimants = CAD_SHELL_COMMANDS.filter((def) =>
        def.aliases.some((entry) => entry.toUpperCase() === alias),
      );
      expect(claimants).toHaveLength(1);
    }
  });

  it('does not introduce a PEDIT command', () => {
    expect(resolveShellCommandText('PEDIT')).toBeNull();
    expect(CAD_SHELL_COMMANDS.some((def) => def.key === 'PEDIT')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

describe('C3 session metadata: point pick + prompt', () => {
  it('both sessions expect a point pick and prompt for target/vertex', () => {
    const insert: CommandSession = {
      key: 'PLINEINSERTVERTEX',
      inputValue: '',
      polylineId: null,
    };
    const remove: CommandSession = {
      key: 'PLINEDELETEVERTEX',
      inputValue: '',
      polylineId: 'poly-c3',
    };
    expect(sessionExpectsPointPick(insert)).toBe(true);
    expect(sessionExpectsPointPick(remove)).toBe(true);
    expect(promptForSession(insert, '')).toContain('PLINEINSERTVERTEX');
    expect(promptForSession(remove, '')).toContain('PLINEDELETEVERTEX');
  });
});

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

describe('C3 session target resolution', () => {
  it('accepts a sole selected editable polyline and rejects ambiguity/locks', () => {
    const entity = polyline();
    const project = projectWith([entity]);
    expect(resolveSoleSelectedEditablePolyline(project, [entity.id])?.id).toBe(entity.id);
    expect(resolveSoleSelectedEditablePolyline(project, [])).toBeNull();
    expect(resolveSoleSelectedEditablePolyline(project, [entity.id, 'other'])).toBeNull();
    const locked = polyline({ id: 'locked', locked: true });
    const lockedProject = projectWith([locked]);
    expect(resolveSoleSelectedEditablePolyline(lockedProject, ['locked'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Point pick
// ---------------------------------------------------------------------------

describe('C3 session point pick', () => {
  it('first pick selects the polyline, second pick deletes the nearest vertex', () => {
    const entity = polyline();
    let history = createCadHistoryState(projectWith([entity]));
    let replaced: CommandSession | null | undefined;
    const options = () => ({
      applyHistoryUpdate: (updater: (_history: CadHistoryState) => CadHistoryState) => {
        history = updater(history);
      },
      current: {
        key: 'PLINEDELETEVERTEX' as const,
        inputValue: '',
        polylineId: null as string | null,
      },
      history,
      point: point(10, 0),
      replaceSession: (next: CommandSession | null) => {
        replaced = next;
      },
    });
    expect(handlePlineVertexPointPick(options())).toBe(true);
    expect(replaced?.key).toBe('PLINEDELETEVERTEX');
    expect((replaced as { polylineId: string | null }).polylineId).toBe(entity.id);

    const second = handlePlineVertexPointPick({
      ...options(),
      current: replaced as Extract<CommandSession, { key: 'PLINEDELETEVERTEX' }>,
    });
    expect(second).toBe(true);
    expect(history.undoStack).toHaveLength(1);
    expect(polylineOf(history).vertices).toEqual([P(0, 0), P(10, 10)]);
  });

  it('insert point pick projects onto the selected course', () => {
    const entity = polyline({ vertices: [P(0, 0), P(10, 10)] });
    let history = createCadHistoryState(projectWith([entity]));
    let replaced: CommandSession | null | undefined;
    handlePlineVertexPointPick({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      current: { key: 'PLINEINSERTVERTEX', inputValue: '', polylineId: entity.id },
      history,
      point: point(2.5, 5),
      replaceSession: (next) => {
        replaced = next;
      },
    });
    expect(replaced).toBeNull();
    expect(polylineOf(history).vertices).toEqual([P(0, 0), P(3.75, 3.75), P(10, 10)]);
  });
});

// ---------------------------------------------------------------------------
// Typed submit
// ---------------------------------------------------------------------------

const runTyped = (
  key: 'PLINEINSERTVERTEX' | 'PLINEDELETEVERTEX',
  inputValue: string,
  entity: CadPolylineEntity,
): { history: CadHistoryState; replaced: CommandSession | null | undefined } => {
  let history = createCadHistoryState(projectWith([entity]));
  let replaced: CommandSession | null | undefined;
  handlePlineVertexTypedSubmit({
    applyHistoryUpdate: (updater) => {
      history = updater(history);
    },
    history,
    replaceSession: (next) => {
      replaced = next;
    },
    session: { key, inputValue, polylineId: entity.id },
  });
  return { history, replaced };
};

describe('C3 typed submit', () => {
  it('V<n> deletes the 1-based vertex', () => {
    const entity = polyline();
    const { history, replaced } = runTyped('PLINEDELETEVERTEX', 'V2', entity);
    expect(replaced).toBeNull();
    expect(polylineOf(history).vertices).toEqual([P(0, 0), P(10, 10)]);
  });

  it('C<n> inserts at the true course midpoint', () => {
    const entity = polyline({
      vertices: [P(0, 0), P(10, 0), P(20, 0)],
      segmentGeometry: [{ kind: 'line' }, { kind: 'arc', bulge: 1 }],
    });
    const { history, replaced } = runTyped('PLINEINSERTVERTEX', 'C2', entity);
    expect(replaced).toBeNull();
    const updated = polylineOf(history);
    const metrics = describeParcelArcCourse(P(10, 0), P(20, 0), 1)!;
    expect(updated.vertices[2]!.x).toBeCloseTo(metrics.midpoint.x, 6);
    expect(updated.vertices[2]!.y).toBeCloseTo(metrics.midpoint.y, 6);
  });

  it('x,y inserts at that on-course point', () => {
    const entity = polyline({ vertices: [P(0, 0), P(10, 10)] });
    const { history } = runTyped('PLINEINSERTVERTEX', '2.5,5', entity);
    expect(polylineOf(history).vertices).toEqual([P(0, 0), P(3.75, 3.75), P(10, 10)]);
  });

  it('invalid typed input keeps the session alive with a result message', () => {
    const entity = polyline();
    const { history, replaced } = runTyped('PLINEDELETEVERTEX', 'nonsense', entity);
    expect(history.undoStack).toHaveLength(0);
    expect(replaced?.resultText).toMatch(/V1/);
  });
});
