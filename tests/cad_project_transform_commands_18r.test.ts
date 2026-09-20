// Phase 18R PROJECTTRANSFORM command/UI-path oracles.
//
// Whole-drawing scope: the command must transform every entity regardless of
// the current selection, commit exactly ONE undo entry, and append one
// PROJECT_COORDINATE_TRANSFORM computation. Registration pins the
// SURVEYTRANSFORM / PROJECTTRANS aliases and confirms no collision with the
// 18Q selection commands (HELMERT2D / GRIDGROUND). Agent tier: fast.
import { describe, expect, it } from 'vitest';

import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { CAD_COMMAND_REGISTRY } from '../src/engine/cad/cadTransactions';
import { applyCadProjectTransform, PROJECT_COORDINATE_TRANSFORM_TOOL_KEY } from '../src/engine/cad/cadProjectTransform';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { HelmertControlPair } from '../src/engine/cad/cadHelmert2D';
import { applyPoint } from '../src/engine/cad/cadTransform2D';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const LAYER = 'L';
const base = { layerId: LAYER, visible: true, locked: false } as const;

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'T18R', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = entities;
  return project;
};

const lineAt = (id: string, fromX: number, fromY: number, toX: number, toY: number): CadEntity => ({
  ...base, id, type: 'line', fromStationId: 'A', toStationId: 'B',
  fromX, fromY, toX, toY, sourceObservationIds: [],
});

const entityById = (project: CadProject, id: string): CadEntity => {
  const entity = project.entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`missing entity ${id}`);
  return entity;
};

describe('PROJECTTRANSFORM registration (18R)', () => {
  it('registers the key plus SURVEYTRANSFORM/PROJECTTRANS aliases without displacing 18Q', () => {
    expect(CAD_COMMAND_REGISTRY['PROJECTTRANSFORM']).toBeDefined();
    expect(resolveShellCommandText('PROJECTTRANSFORM')?.key).toBe('PROJECTTRANSFORM');
    expect(resolveShellCommandText('SURVEYTRANSFORM')?.key).toBe('PROJECTTRANSFORM');
    expect(resolveShellCommandText('PROJECTTRANS')?.key).toBe('PROJECTTRANSFORM');
    expect(CAD_SHELL_COMMANDS.some((def) => def.key === 'PROJECTTRANSFORM')).toBe(true);
    // 18Q selection commands untouched.
    expect(CAD_COMMAND_REGISTRY['HELMERT2D']).toBeDefined();
    expect(CAD_COMMAND_REGISTRY['GRIDGROUND']).toBeDefined();
    expect(resolveShellCommandText('HELMERT')?.key).toBe('HELMERT2D');
    expect(resolveShellCommandText('GRIDGROUND')?.key).toBe('GRIDGROUND');
  });
});

describe('PROJECTTRANSFORM whole-drawing command (18R)', () => {
  it('Helmert transforms EVERY entity regardless of selection, one undo entry', () => {
    const rotDeg = 30;
    const scale = 1.00005;
    const tE = 100;
    const tN = -50;
    const r = (rotDeg * Math.PI) / 180;
    const a = scale * Math.cos(r);
    const b = scale * Math.sin(r);
    const forward = (e: number, n: number): [number, number] => [tE + a * e - b * n, tN + b * e + a * n];
    const sources: Array<[number, number]> = [[10, 20], [110, -40]];
    const pairs: HelmertControlPair[] = sources.map(([e, n]) => {
      const [te, tn] = forward(e, n);
      return { sourceE: e, sourceN: n, targetE: te, targetN: tn };
    });
    // Selection only names 'l1'; 'l2' must still move (whole drawing).
    const project = projectWith([lineAt('l1', 10, 20, 110, -40), lineAt('l2', 0, 0, 5, 5)]);
    const history = createCadHistoryState(project, ['l1']);
    const committed = runCadCommand(history, { key: 'PROJECTTRANSFORM', request: { kind: 'HELMERT_2D', mode: 'SIMILARITY', pairs } });
    expect(committed).not.toBe(history);
    expect(committed.undoStack).toHaveLength(1);
    expect(committed.undoStack[0]?.transaction.commandKey).toBe('PROJECTTRANSFORM');

    const solved = applyCadProjectTransform(project, { kind: 'HELMERT_2D', mode: 'SIMILARITY', pairs });
    expect(solved.ok).toBe(true);
    if (!solved.ok) throw new Error('solve failed');
    const solvedLine = entityById(solved.project, 'l1');
    const committedLine = entityById(committed.present.project, 'l1');
    expect(committedLine).toEqual(solvedLine);
    const movedUnselected = entityById(committed.present.project, 'l2');
    if (movedUnselected.type !== 'line') throw new Error('type');
    const expected = applyPoint({ a, b, c: -b, d: a, tx: tE, ty: tN }, { x: 0, y: 0 });
    expect(movedUnselected.fromX).toBeCloseTo(expected.x, 9);
    expect(movedUnselected.fromY).toBeCloseTo(expected.y, 9);

    // Report computation appended exactly once, one-step undo restores all.
    expect(
      committed.present.project.cogoComputations.filter(
        (entry) => entry.toolKey === PROJECT_COORDINATE_TRANSFORM_TOOL_KEY,
      ),
    ).toHaveLength(1);
    const undone = undoCadHistory(committed);
    expect(entityById(undone.present.project, 'l1')).toEqual(entityById(project, 'l1'));
    const redone = redoCadHistory(undone);
    expect(entityById(redone.present.project, 'l2')).toEqual(movedUnselected);
  });

  it('Grid/Ground whole-drawing scale commits and detaches provenance audit', () => {
    const project = projectWith([lineAt('l1', 500_100, 100_050, 500_200, 100_100)]);
    const history = createCadHistoryState(project, []);
    const committed = runCadCommand(history, {
      key: 'PROJECTTRANSFORM',
      request: { kind: 'GRID_GROUND', originE: 500_000, originN: 100_000, combinedScaleFactor: 0.99995, direction: 'GRID_TO_GROUND' },
    });
    expect(committed.undoStack[0]?.transaction.commandKey).toBe('PROJECTTRANSFORM');
    const line = entityById(committed.present.project, 'l1');
    if (line.type !== 'line') throw new Error('type');
    expect(line.fromX).toBeCloseTo(500_000 + 100 * (1 / 0.99995), 6);
  });

  it('degenerate Helmert request fails closed with zero mutation', () => {
    const project = projectWith([lineAt('l1', 0, 0, 10, 0)]);
    const history = createCadHistoryState(project, []);
    const coincident: HelmertControlPair[] = [
      { sourceE: 5, sourceN: 5, targetE: 100, targetN: 200 },
      { sourceE: 5, sourceN: 5, targetE: 110, targetN: 210 },
    ];
    const next = runCadCommand(history, { key: 'PROJECTTRANSFORM', request: { kind: 'HELMERT_2D', mode: 'SIMILARITY', pairs: coincident } });
    expect(next).toBe(history);
    expect(next.present.project.entities).toEqual(project.entities);
  });
});
