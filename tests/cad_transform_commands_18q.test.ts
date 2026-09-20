// Phase 18Q transform commands: ROTATE / SCALE / MIRROR / ALIGN2D command
// registration, commit oracles, mirror Yes/No selection behavior, atomic
// preflight via the command path, undo/redo, MOVE preview ghost dimming,
// and the background pick-loop routing fix. Agent tier: fast, deterministic.
import { describe, expect, it } from 'vitest';

import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { CAD_COMMAND_REGISTRY } from '../src/engine/cad/cadTransactions';
import { resolveBackgroundClickTarget } from '../src/components/surveyCad/SurveyCadPreviewCanvas.types';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { commitCadSelectionTransform } from '../src/engine/cad/cadTransformApply';
import { applyCadSelectionTransform } from '../src/engine/cad/cadTransformApply';
import { rotationAbout } from '../src/engine/cad/cadTransform2D';
import {
  buildTransformedPreviewPrimitives,
  transformPreviewDimmedEntityIds,
} from '../src/engine/cad/cadTransformPreview';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type {
  CadDisplayPrimitive,
  CadEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

const LAYER = 'L';
const base = { layerId: LAYER, visible: true, locked: false } as const;

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'T18Q-CMD', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = entities;
  project.blockDefinitions = [
    { id: 'blk', name: 'BLK', basePoint: { x: 0, y: 0 }, entities: [] },
  ];
  return project;
};

// Small mixed drawing: line + arc + block-ref + mtext + dimension.
const drawing = (): CadEntity[] => [
  { ...base, id: 'l1', type: 'line', fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 10, toY: 0, sourceObservationIds: [] },
  { ...base, id: 'a1', type: 'arc', centerX: 10, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 90 },
  { ...base, id: 'b1', type: 'block-reference', blockDefinitionId: 'blk', x: 10, y: 20, rotationDeg: 0, scaleX: 1, scaleY: 1 },
  { ...base, id: 'mt1', type: 'mtext', x: 3, y: 4, text: 'hi', textStyleId: 'ts', rotationDeg: 0, attachment: 'middle-center' as const },
  {
    ...base, id: 'd1', type: 'dimension', dimensionKind: 'linear', dimensionStyleId: 'ds',
    anchors: [{ kind: 'fixed', x: 0, y: 0 }, { kind: 'fixed', x: 10, y: 0 }],
    dimLinePoint: { x: 5, y: 5 }, textPoint: { x: 5, y: 7 },
  },
];
const ALL_IDS = ['l1', 'a1', 'b1', 'mt1', 'd1'];

const closePt = (actual: { x: number; y: number }, x: number, y: number) => {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
};

const entityById = (project: CadProject, id: string): CadEntity => {
  const entity = project.entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`missing entity ${id}`);
  return entity;
};

describe('cad transform command registration (18Q)', () => {
  it('registers ROTATE/SCALE/MIRROR/ALIGN2D with RO/SC/MI aliases', () => {
    for (const key of ['ROTATE', 'SCALE', 'MIRROR', 'ALIGN2D'] as const) {
      expect(CAD_COMMAND_REGISTRY[key]).toBeDefined();
    }
    expect(resolveShellCommandText('RO')?.key).toBe('ROTATE');
    expect(resolveShellCommandText('SC')?.key).toBe('SCALE');
    expect(resolveShellCommandText('MI')?.key).toBe('MIRROR');
    expect(resolveShellCommandText('ROTATE')?.key).toBe('ROTATE');
    expect(resolveShellCommandText('ALIGN2D')?.key).toBe('ALIGN2D');
  });

  it('leaves ALIGN untouched (still no ALIGN command key)', () => {
    expect(resolveShellCommandText('ALIGN')).toBeNull();
    expect(CAD_SHELL_COMMANDS.some((def) => def.key === 'ALIGN')).toBe(false);
    expect((CAD_COMMAND_REGISTRY as unknown as Record<string, unknown>)['ALIGN']).toBeUndefined();
  });
});

describe('cad transform commit oracles (18Q)', () => {
  it('ROTATE commits one undo entry, undoes, and redoes deterministically', () => {
    const history = createCadHistoryState(projectWith(drawing()), ALL_IDS);
    const committed = runCadCommand(history, { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 90 });
    expect(committed).not.toBe(history);
    expect(committed.undoStack).toHaveLength(1);
    expect(committed.undoStack[0]?.transaction.commandKey).toBe('ROTATE');
    const line = entityById(committed.present.project, 'l1');
    if (line.type !== 'line') throw new Error('type');
    closePt({ x: line.fromX, y: line.fromY }, 0, 0);
    closePt({ x: line.toX, y: line.toY }, 0, 10);
    const block = entityById(committed.present.project, 'b1');
    if (block.type !== 'block-reference') throw new Error('type');
    closePt(block, -20, 10);
    const mtext = entityById(committed.present.project, 'mt1');
    if (mtext.type !== 'mtext') throw new Error('type');
    closePt(mtext, -4, 3);
    const undone = undoCadHistory(committed);
    const restored = entityById(undone.present.project, 'l1');
    if (restored.type !== 'line') throw new Error('type');
    expect(restored.toX).toBe(10);
    expect(restored.toY).toBe(0);
    const redone = redoCadHistory(undone);
    const again = entityById(redone.present.project, 'l1');
    if (again.type !== 'line') throw new Error('type');
    closePt({ x: again.toX, y: again.toY }, 0, 10);
    expect(redone.present.project.entities.map((entity) => entity.id)).toEqual(
      committed.present.project.entities.map((entity) => entity.id),
    );
  });

  it('SCALE doubles about the base and rejects 0/negative/non-finite factors', () => {
    const history = createCadHistoryState(projectWith(drawing()), ALL_IDS);
    const committed = runCadCommand(history, { key: 'SCALE', baseX: 0, baseY: 0, factor: 2 });
    expect(committed.undoStack[0]?.transaction.commandKey).toBe('SCALE');
    const line = entityById(committed.present.project, 'l1');
    if (line.type !== 'line') throw new Error('type');
    closePt({ x: line.toX, y: line.toY }, 20, 0);
    const arc = entityById(committed.present.project, 'a1');
    if (arc.type !== 'arc') throw new Error('type');
    expect(arc.radius).toBe(10);
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rejected = executeCadCommand(history.present, { key: 'SCALE', baseX: 0, baseY: 0, factor });
      expect(rejected).toBeNull();
    }
    const undone = undoCadHistory(committed);
    expect(entityById(undone.present.project, 'a1')).toMatchObject({ type: 'arc' });
  });

  it('MIRROR-No keeps originals and selects copies; MIRROR-Yes mirrors in place', () => {
    const history = createCadHistoryState(projectWith(drawing()), ALL_IDS);
    const copied = runCadCommand(history, {
      key: 'MIRROR', p1: { x: 0, y: 0 }, p2: { x: 0, y: 1 }, eraseSource: false,
    });
    expect(copied.undoStack[0]?.transaction.commandKey).toBe('MIRROR');
    // Originals intact under their ids.
    const original = entityById(copied.present.project, 'l1');
    if (original.type !== 'line') throw new Error('type');
    expect(original.toX).toBe(10);
    // New ids selected, count grew.
    expect(copied.present.project.entities.length).toBeGreaterThan(ALL_IDS.length);
    expect(copied.present.selection.selectedEntityIds).not.toContain('l1');
    expect(copied.present.selection.selectedEntityIds.length).toBeGreaterThan(0);
    const inPlace = runCadCommand(history, {
      key: 'MIRROR', p1: { x: 0, y: 0 }, p2: { x: 0, y: 1 }, eraseSource: true,
    });
    expect(inPlace.present.project.entities.length).toBe(ALL_IDS.length);
    expect(inPlace.present.selection.selectedEntityIds).toEqual(expect.arrayContaining(ALL_IDS));
    const mirrored = entityById(inPlace.present.project, 'l1');
    if (mirrored.type !== 'line') throw new Error('type');
    closePt({ x: mirrored.toX, y: mirrored.toY }, -10, 0);
    expect(undoCadHistory(inPlace).present.project.entities.length).toBe(ALL_IDS.length);
  });

  it('ALIGN2D rigid rotates without scale; scale-to-fit scales', () => {
    const rigid = runCadCommand(createCadHistoryState(projectWith(drawing()), ['l1']), {
      key: 'ALIGN2D',
      source1: { x: 0, y: 0 }, source2: { x: 10, y: 0 },
      target1: { x: 0, y: 0 }, target2: { x: 0, y: 10 },
      scaleToFit: false,
    });
    expect(rigid.undoStack[0]?.transaction.commandKey).toBe('ALIGN2D');
    const rigidLine = entityById(rigid.present.project, 'l1');
    if (rigidLine.type !== 'line') throw new Error('type');
    closePt({ x: rigidLine.toX, y: rigidLine.toY }, 0, 10);
    const scaled = runCadCommand(createCadHistoryState(projectWith(drawing()), ['l1']), {
      key: 'ALIGN2D',
      source1: { x: 0, y: 0 }, source2: { x: 10, y: 0 },
      target1: { x: 0, y: 0 }, target2: { x: 20, y: 0 },
      scaleToFit: true,
    });
    const scaledLine = entityById(scaled.present.project, 'l1');
    if (scaledLine.type !== 'line') throw new Error('type');
    closePt({ x: scaledLine.toX, y: scaledLine.toY }, 20, 0);
    expect(undoCadHistory(scaled).present.project.entities).toHaveLength(ALL_IDS.length);
  });

  it('blocks the whole command atomically when a locked entity is selected', () => {
    const entities = drawing();
    const locked = entities.map((entity) => (entity.id === 'a1' ? { ...entity, locked: true } : entity));
    const history = createCadHistoryState(projectWith(locked), ALL_IDS);
    for (const command of [
      { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 90 },
      { key: 'SCALE', baseX: 0, baseY: 0, factor: 2 },
      { key: 'MIRROR', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, eraseSource: true },
      {
        key: 'ALIGN2D',
        source1: { x: 0, y: 0 }, source2: { x: 1, y: 0 },
        target1: { x: 5, y: 5 }, target2: { x: 6, y: 5 },
        scaleToFit: false,
      },
    ] as const) {
      const next = runCadCommand(history, command);
      expect(next).toBe(history);
      expect(next.present.project.entities).toHaveLength(ALL_IDS.length);
    }
  });

  it('commitCadSelectionTransform carries the dedicated command key', () => {
    const project = projectWith(drawing());
    const history = createCadHistoryState(project, ALL_IDS);
    const applied = applyCadSelectionTransform(project, ALL_IDS, rotationAbout(0, 0, 90), { label: 'ROTATE (5)' });
    if (!applied.ok) throw new Error('expected ok');
    const committed = commitCadSelectionTransform(history, applied, 'ROTATE');
    expect(committed.undoStack[0]?.transaction.commandKey).toBe('ROTATE');
    expect(committed.commandState.key).toBe('ROTATE');
  });
});

describe('cad transform preview + pick routing (18Q)', () => {
  const previewScene = (): CadDisplayPrimitive[] => [
    { kind: 'line', id: 'p-l1', layerId: LAYER, sourceEntityId: 'l1', stroke: '#fff', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], strokeWidth: 1 },
    { kind: 'point', id: 'p-b1', layerId: LAYER, sourceEntityId: 'b1', stroke: '#fff', fill: '#fff', point: { x: 10, y: 20 }, radius: 2 },
  ];

  it('MOVE preview ghosts sources while the store keeps one block ref and its definition', () => {
    const project = projectWith(drawing());
    const before = project.entities.length;
    const preview = buildTransformedPreviewPrimitives(
      previewScene(),
      ['l1', 'b1'],
      { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 5 },
    );
    expect(preview).toHaveLength(2);
    expect(preview.every((primitive) => primitive.sourceEntityId.startsWith('preview:'))).toBe(true);
    // Pure derivation: authoritative store untouched.
    expect(project.entities.length).toBe(before);
    expect(project.entities.filter((entity) => entity.type === 'block-reference')).toHaveLength(1);
    expect(project.blockDefinitions).toHaveLength(1);
    const dimmed = transformPreviewDimmedEntityIds({ kind: 'translate-selection' }, 'MOVE', ['l1', 'b1']);
    expect(dimmed).toEqual(['l1', 'b1']);
    // COPY/PASTE previews never dim.
    expect(transformPreviewDimmedEntityIds({ kind: 'translate-selection' }, 'COPY', ['l1'])).toEqual([]);
    // In-place transform previews dim; mirror-copy previews do not.
    expect(transformPreviewDimmedEntityIds({ kind: 'transform-selection' }, 'ROTATE', ['l1'])).toEqual(['l1']);
    expect(transformPreviewDimmedEntityIds({ kind: 'transform-selection', copyMode: true }, 'MIRROR', ['l1'])).toEqual([]);
    // MOVE commit keeps one block ref and the definition count.
    const history = createCadHistoryState(project, ['l1', 'b1']);
    const committed = runCadCommand(history, { key: 'MOVE', deltaX: 5, deltaY: 5 });
    expect(committed.present.project.entities.filter((entity) => entity.type === 'block-reference')).toHaveLength(1);
    expect(committed.present.project.blockDefinitions).toHaveLength(1);
    expect(undoCadHistory(committed).present.project.blockDefinitions).toHaveLength(1);
  });

  it('routes background clicks to the command ahead of the block-insert repeat loop', () => {
    expect(resolveBackgroundClickTarget({ commandPointInputActive: true, surfacePickActive: true })).toBe('command');
    expect(resolveBackgroundClickTarget({ commandPointInputActive: true, surfacePickActive: false })).toBe('command');
    expect(resolveBackgroundClickTarget({ commandPointInputActive: false, surfacePickActive: true })).toBe('surface');
    expect(resolveBackgroundClickTarget({ commandPointInputActive: false, surfacePickActive: false })).toBe('none');
  });
});
