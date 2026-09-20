// Phase 18Q HELMERT2D / GRIDGROUND command-path oracles.
//
// Engine commands commit through the same atomic seam as ROTATE/SCALE/
// MIRROR/ALIGN2D (ONE undo entry, preflight fails closed pre-mutation).
// Residual report values are pinned against the solver directly so the
// panel-visible fit can never drift from committed geometry. Agent tier:
// fast, deterministic.
import { describe, expect, it } from 'vitest';

import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { CAD_COMMAND_REGISTRY } from '../src/engine/cad/cadTransactions';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { solveHelmert2D, type HelmertControlPair } from '../src/engine/cad/cadHelmert2D';
import { applyPoint } from '../src/engine/cad/cadTransform2D';
import { applyCadSelectionTransform } from '../src/engine/cad/cadTransformApply';
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
  const project = createBlankCadProject({ name: 'T18Q-HG', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = entities;
  project.blockDefinitions = [
    { id: 'blk', name: 'BLK', basePoint: { x: 0, y: 0 }, entities: [] },
  ];
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

describe('helmert/gridground registration (18Q)', () => {
  it('registers HELMERT2D/GRIDGROUND with a HELMERT alias and no key collision', () => {
    expect(CAD_COMMAND_REGISTRY['HELMERT2D']).toBeDefined();
    expect(CAD_COMMAND_REGISTRY['GRIDGROUND']).toBeDefined();
    expect(resolveShellCommandText('HELMERT2D')?.key).toBe('HELMERT2D');
    expect(resolveShellCommandText('HELMERT')?.key).toBe('HELMERT2D');
    expect(resolveShellCommandText('GRIDGROUND')?.key).toBe('GRIDGROUND');
    expect(CAD_SHELL_COMMANDS.some((def) => def.key === 'HELMERT2D')).toBe(true);
    expect(CAD_SHELL_COMMANDS.some((def) => def.key === 'GRIDGROUND')).toBe(true);
    // No pre-existing HELMERT command key was displaced.
    expect((CAD_COMMAND_REGISTRY as unknown as Record<string, unknown>)['HELMERT']).toBeUndefined();
  });
});

describe('helmert2D command oracles (18Q)', () => {
  it('2-pt similarity exact: commits, geometry matches solver, residuals pin the report', () => {
    const rotDeg = 30;
    const scale = 1.00005;
    const tE = 100;
    const tN = -50;
    const r = (rotDeg * Math.PI) / 180;
    const a = scale * Math.cos(r);
    const b = scale * Math.sin(r);
    const project = (e: number, n: number): [number, number] => [
      tE + a * e - b * n,
      tN + b * e + a * n,
    ];
    const sources: Array<[number, number]> = [[10, 20], [110, -40]];
    const pairs: HelmertControlPair[] = sources.map(([e, n]) => {
      const [te, tn] = project(e, n);
      return { sourceE: e, sourceN: n, targetE: te, targetN: tn };
    });
    const history = createCadHistoryState(projectWith([lineAt('l1', 10, 20, 110, -40)]), ['l1']);
    const committed = runCadCommand(history, { key: 'HELMERT2D', pairs, mode: 'SIMILARITY' });
    expect(committed).not.toBe(history);
    expect(committed.undoStack).toHaveLength(1);
    expect(committed.undoStack[0]?.transaction.commandKey).toBe('HELMERT2D');
    // Report values match the solver on the same pairs.
    const solved = solveHelmert2D(pairs, 'SIMILARITY');
    expect(solved.ok).toBe(true);
    if (!solved.ok) throw new Error('solver failed');
    expect(solved.rmsResidual).toBeLessThan(1e-9);
    expect(solved.maxResidual).toBeLessThan(1e-9);
    expect(solved.residuals).toHaveLength(2);
    expect(Math.abs(solved.rotationDeg - rotDeg)).toBeLessThan(1e-9);
    // Committed geometry equals the solver transform applied to the source.
    const line = entityById(committed.present.project, 'l1');
    if (line.type !== 'line') throw new Error('type');
    const start = applyPoint(solved.transform, { x: 10, y: 20 });
    expect(line.fromX).toBeCloseTo(start.x, 9);
    expect(line.fromY).toBeCloseTo(start.y, 9);
    const end = applyPoint(solved.transform, { x: 110, y: -40 });
    expect(line.toX).toBeCloseTo(end.x, 9);
    expect(line.toY).toBeCloseTo(end.y, 9);
  });

  it('3-pt rigid LS: rotation/translation recovered, residual report matches solver', () => {
    const rotDeg = -17;
    const tE = 33;
    const tN = 44;
    const rad = (rotDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    const sources: Array<[number, number]> = [[0, 0], [50, 10], [-20, 70]];
    const pairs: HelmertControlPair[] = sources.map(([e, n]) => ({
      sourceE: e,
      sourceN: n,
      targetE: tE + c * e - sn * n,
      targetN: tN + sn * e + c * n,
    }));
    const solved = solveHelmert2D(pairs, 'RIGID');
    expect(solved.ok).toBe(true);
    if (!solved.ok) throw new Error('solver failed');
    expect(solved.scale).toBe(1);
    expect(solved.rmsResidual).toBeLessThan(1e-9);
    const history = createCadHistoryState(projectWith([lineAt('l1', 0, 0, 50, 10)]), ['l1']);
    const committed = runCadCommand(history, { key: 'HELMERT2D', pairs, mode: 'RIGID' });
    expect(committed.undoStack).toHaveLength(1);
    const line = entityById(committed.present.project, 'l1');
    if (line.type !== 'line') throw new Error('type');
    const end = applyPoint(solved.transform, { x: 50, y: 10 });
    expect(line.toX).toBeCloseTo(end.x, 9);
    expect(line.toY).toBeCloseTo(end.y, 9);
    const undone = undoCadHistory(committed);
    const restored = entityById(undone.present.project, 'l1');
    if (restored.type !== 'line') throw new Error('type');
    expect(restored.toX).toBe(50);
    const redone = redoCadHistory(undone);
    const again = entityById(redone.present.project, 'l1');
    if (again.type !== 'line') throw new Error('type');
    expect(again.toX).toBeCloseTo(end.x, 9);
  });

  it('degeneracy is blocked pre-mutation with the solver reason', () => {
    const before = projectWith([lineAt('l1', 0, 0, 10, 0)]);
    const history = createCadHistoryState(before, ['l1']);
    const coincident: HelmertControlPair[] = [
      { sourceE: 5, sourceN: 5, targetE: 100, targetN: 200 },
      { sourceE: 5, sourceN: 5, targetE: 110, targetN: 210 },
    ];
    const solved = solveHelmert2D(coincident, 'SIMILARITY');
    expect(solved.ok).toBe(false);
    const next = runCadCommand(history, { key: 'HELMERT2D', pairs: coincident, mode: 'SIMILARITY' });
    expect(next).toBe(history);
    expect(next.present.project.entities).toEqual(before.entities);
    // Single pair fails closed too.
    const single = runCadCommand(history, {
      key: 'HELMERT2D',
      pairs: [{ sourceE: 0, sourceN: 0, targetE: 1, targetN: 1 }],
      mode: 'RIGID',
    });
    expect(single).toBe(history);
  });
});

describe('gridground command oracles (18Q)', () => {
  const CSF = 0.99995;
  const ORIGIN = { e: 500_000, n: 100_000 };

  it('CSF both directions round-trip within FP, Z untouched, metadata identical', () => {
    const metadataBefore = JSON.stringify(projectWith([]).metadata);
    const project = projectWith([
      lineAt('l1', 500_100, 100_050, 500_200, 100_100),
      {
        ...base, id: 'pt1', type: 'survey-point', stationId: 'P1',
        x: 500_100, y: 100_050, z: 12.5, pointClass: 'free', source: 'parsed-input',
      },
    ]);
    const metaJson = JSON.stringify(project.metadata);
    const history = createCadHistoryState(project, ['l1', 'pt1']);
    const fwd = runCadCommand(history, {
      key: 'GRIDGROUND',
      originE: ORIGIN.e,
      originN: ORIGIN.n,
      combinedScaleFactor: CSF,
      direction: 'GRID_TO_GROUND',
    });
    expect(fwd.undoStack[0]?.transaction.commandKey).toBe('GRIDGROUND');
    const f = 1 / CSF;
    const line = entityById(fwd.present.project, 'l1');
    if (line.type !== 'line') throw new Error('type');
    expect(line.fromX).toBeCloseTo(ORIGIN.e + 100 * f, 6);
    expect(line.fromY).toBeCloseTo(ORIGIN.n + 50 * f, 6);
    // 2D only: Z untouched; no metadata/CRS/units change.
    const point = entityById(fwd.present.project, 'pt1');
    if (point.type !== 'survey-point') throw new Error('type');
    expect(point.z).toBe(12.5);
    expect(JSON.stringify(fwd.present.project.metadata)).toBe(metaJson);
    expect(metaJson).toBe(metadataBefore);
    // Round-trip within floating point.
    const backHistory = createCadHistoryState(fwd.present.project, ['l1', 'pt1']);
    const back = runCadCommand(backHistory, {
      key: 'GRIDGROUND',
      originE: ORIGIN.e,
      originN: ORIGIN.n,
      combinedScaleFactor: CSF,
      direction: 'GROUND_TO_GRID',
    });
    const round = entityById(back.present.project, 'l1');
    if (round.type !== 'line') throw new Error('type');
    expect(round.fromX).toBeCloseTo(500_100, 9);
    expect(round.fromY).toBeCloseTo(100_050, 9);
    expect(undoCadHistory(back).present.project.entities).toEqual(fwd.present.project.entities);
    expect(redoCadHistory(undoCadHistory(back)).present.project.entities).toEqual(
      back.present.project.entities,
    );
  });

  it('rejects CSF 0/negative/NaN with no mutation', () => {
    const before = projectWith([lineAt('l1', 0, 0, 10, 0)]);
    const history = createCadHistoryState(before, ['l1']);
    for (const csf of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = runCadCommand(history, {
        key: 'GRIDGROUND',
        originE: 0,
        originN: 0,
        combinedScaleFactor: csf,
        direction: 'GRID_TO_GROUND',
      });
      expect(next).toBe(history);
    }
    expect(history.present.project.entities).toEqual(before.entities);
  });
});

describe('alignment scale dependency (18Q)', () => {
  const alignment = (): CadEntity => ({
    ...base,
    id: 'al1',
    type: 'alignment',
    name: 'AL1',
    elements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
    startStation: 0,
  });

  it('HELMERT SIMILARITY and GRIDGROUND are blocked with the scale reason; RIGID passes', () => {
    const pairs: HelmertControlPair[] = [
      { sourceE: 0, sourceN: 0, targetE: 10, targetN: 10 },
      { sourceE: 100, sourceN: 0, targetE: 112, targetN: 12 },
    ];
    const solved = solveHelmert2D(pairs, 'SIMILARITY');
    if (!solved.ok) throw new Error('solver failed');
    const blocked = applyCadSelectionTransform(
      projectWith([alignment()]),
      ['al1'],
      solved.transform,
      { label: 'probe' },
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('expected block');
    expect(blocked.reason).toContain('CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY');
    const history = createCadHistoryState(projectWith([alignment()]), ['al1']);
    expect(runCadCommand(history, { key: 'HELMERT2D', pairs, mode: 'SIMILARITY' })).toBe(history);
    expect(
      runCadCommand(history, {
        key: 'GRIDGROUND',
        originE: 0,
        originN: 0,
        combinedScaleFactor: 0.99995,
        direction: 'GRID_TO_GROUND',
      }),
    ).toBe(history);
    // Rigid HELMERT on the same alignment commits (radii/stationing preserved).
    const rigid = runCadCommand(history, { key: 'HELMERT2D', pairs, mode: 'RIGID' });
    expect(rigid).not.toBe(history);
    expect(rigid.undoStack[0]?.transaction.commandKey).toBe('HELMERT2D');
  });
});

describe('wncad round-trip after transforms (18Q)', () => {
  it('mirrored block + transformed line/dim/leader/mtext/parcel reopen identical', () => {
    const project = projectWith([
      lineAt('l1', 0, 0, 10, 0),
      {
        ...base, id: 'd1', type: 'dimension', dimensionKind: 'linear',
        anchors: [{ kind: 'fixed', x: 0, y: 0 }, { kind: 'fixed', x: 10, y: 0 }],
        dimLinePoint: { x: 5, y: 5 }, textPoint: { x: 5, y: 7 }, dimensionStyleId: 'ds',
      },
      {
        ...base, id: 'ld1', type: 'leader',
        arrowAnchor: { kind: 'fixed', x: 10, y: 0 },
        vertices: [{ x: 10, y: 0 }, { x: 15, y: 5 }],
        text: 'note', leaderStyleId: 'ls',
      },
      {
        ...base, id: 'mt1', type: 'mtext', x: 3, y: 4, text: 'hi',
        textStyleId: 'ts', rotationDeg: 0, attachment: 'middle-center' as const,
      },
      {
        ...base, id: 'p1', type: 'parcel', parcelName: 'Lot 1',
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        vertexLabels: ['A', 'B', 'C', 'D'],
      },
      {
        ...base, id: 'b1', type: 'block-reference', blockDefinitionId: 'blk',
        x: 10, y: 20, rotationDeg: 30, scaleX: 2, scaleY: 2, mirrored: true,
      },
    ]);
    const ids = project.entities.map((entity) => entity.id);
    let history = createCadHistoryState(project, ids);
    history = runCadCommand(history, { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 90 });
    expect(history.undoStack).toHaveLength(1);
    const document = createBlankCadDrawingDocument({ name: 'T18Q-HG', units: 'm' });
    document.project = { ...history.present.project, name: 'T18Q-HG' };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.entities).toEqual(history.present.project.entities);
    expect(reopened.blockDefinitions).toEqual(history.present.project.blockDefinitions);
    const block = reopened.entities.find((entity) => entity.id === 'b1');
    expect(block).toMatchObject({ type: 'block-reference', mirrored: true, rotationDeg: 120, scaleX: 2, scaleY: 2 });
  });
});
