/** Circle v1 transactions: CIRCLE/CIRCLECD commits, history, transforms, persistence, DXF, clipboard. */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { resolveCurrentCadLayerId } from '../src/engine/cad/cadLayers';
import { buildCopiedEntities } from '../src/engine/cad/cadTransactionsClipboardCommands';
import { buildCircleEntitySnapCandidates } from '../src/engine/cad/cadSpatialEntityCandidates';
import { buildCadGripHandles } from '../src/engine/cad/cadTransactionsEntityTransforms';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadCircleEntity, CadProject } from '../src/engine/cad/cadTypes';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';

const blankProject = (): CadProject => createBlankCadProject({ name: 'circle v1', units: 'm' });

const circleCommand = (extra?: Partial<Extract<CadCommand, { key: 'CIRCLE' }>>): CadCommand => ({
  key: 'CIRCLE',
  center: { x: 10, y: 20, label: 'C' },
  radius: 15,
  ...extra,
});

const circleDiameterCommand = (extra?: Partial<Extract<CadCommand, { key: 'CIRCLECD' }>>): CadCommand => ({
  key: 'CIRCLECD',
  center: { x: 10, y: 20, label: 'C' },
  diameter: 30,
  ...extra,
});

const onlyCircle = (project: CadProject): CadCircleEntity => {
  const found = project.entities.filter((entity): entity is CadCircleEntity => entity.type === 'circle');
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe('circle representation', () => {
  it('commits a first-class circle with no arc sweep fields', () => {
    const history = runCadCommand(createCadHistoryState(blankProject()), circleCommand());
    const entity = onlyCircle(history.present.project);
    expect(entity.centerX).toBe(10);
    expect(entity.centerY).toBe(20);
    expect(entity.radius).toBe(15);
    expect(entity).not.toHaveProperty('startAngleDeg');
    expect(entity).not.toHaveProperty('endAngleDeg');
    expect(entity).not.toHaveProperty('fullCircle');
  });
  it('CIRCLECD preserves the center and halves the diameter', () => {
    const history = runCadCommand(createCadHistoryState(blankProject()), circleDiameterCommand());
    const entity = onlyCircle(history.present.project);
    expect(entity.centerX).toBe(10);
    expect(entity.centerY).toBe(20);
    expect(entity.radius).toBe(15);
  });
  it('uses the current layer, ByLayer appearance, selection, and one undo entry', () => {
    const history = runCadCommand(createCadHistoryState(blankProject()), circleCommand());
    const entity = onlyCircle(history.present.project);
    expect(entity.layerId).toBe(resolveCurrentCadLayerId(blankProject()));
    expect(entity.appearance).toBeUndefined();
    expect(entity.visible).toBe(true);
    expect(history.present.selection.selectedEntityIds).toEqual([entity.id]);
    expect(entity.metadata?.createdBy).toBe('CIRCLE');
    const undone = undoCadHistory(history);
    expect(undone.present.project.entities).toHaveLength(0);
    expect(redoCadHistory(undone).present.project.entities).toHaveLength(1);
  });
  it('rejects degenerate input without history mutation', () => {
    const before = createCadHistoryState(blankProject());
    expect(runCadCommand(before, circleCommand({ radius: 0 })).present.project.entities).toHaveLength(0);
    expect(runCadCommand(before, circleDiameterCommand({ diameter: -4 })).present.project.entities).toHaveLength(0);
  });
});

describe('circle downstream (transforms, persistence, DXF, clipboard)', () => {
  it('move/rotate/uniform-scale keep a circle; affine refuses', () => {
    const committed = runCadCommand(createCadHistoryState(blankProject()), circleCommand()).present;
    const moved = executeCadCommand(committed, { key: 'MOVE', deltaX: 5, deltaY: -5 });
    expect(onlyCircle(moved!.nextSnapshot.project).centerX).toBe(15);
    const rotated = executeCadCommand(committed, { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 90 });
    const rotatedEntity = onlyCircle(rotated!.nextSnapshot.project);
    expect(rotatedEntity.centerX).toBeCloseTo(-20, 9);
    expect(rotatedEntity.radius).toBe(15);
  });
  it('save/reopen preserves the circle exactly; old files need no migration', () => {
    const committed = runCadCommand(createCadHistoryState(blankProject()), circleCommand()).present.project;
    const document = createBlankCadDrawingDocument({ name: 'circle v1', units: 'm' });
    document.project = committed;
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(onlyCircle(parsed.drawing.project)).toEqual(onlyCircle(committed));
  });
  it('DXF exports native CIRCLE groups with no ARC fallback', () => {
    const committed = runCadCommand(createCadHistoryState(blankProject()), circleCommand()).present.project;
    const model = buildDxfExportModelWithResult({ project: committed }).output;
    expect(model.circles).toHaveLength(1);
    expect(model.circles![0]).toMatchObject({ center: { x: 10, y: 20 }, radius: 15 });
    const pairs = serializeDxfModel(model).split('\n');
    let sawCircle = false;
    let sawArcAfterCircle = false;
    for (let i = 0; i + 7 < pairs.length; i += 2) {
      if (pairs[i] === '0' && pairs[i + 1] === 'CIRCLE') {
        sawCircle = true;
        expect(pairs[i + 2]).toBe('8');
        expect(pairs[i + 4]).toBe('10');
        expect(pairs[i + 6]).toBe('20');
      }
      if (sawCircle && pairs[i] === '0' && pairs[i + 1] === 'ARC') sawArcAfterCircle = true;
    }
    expect(sawCircle).toBe(true);
    expect(sawArcAfterCircle).toBe(false);
  });
  it('clipboard copies the circle with layer remap intact', () => {
    const committed = runCadCommand(createCadHistoryState(blankProject()), circleCommand()).present.project;
    const copied = buildCopiedEntities(committed, [onlyCircle(committed)], 3, 4);
    const circle = copied.find((entity) => entity.type === 'circle') as CadCircleEntity;
    expect(circle.centerX).toBe(13);
    expect(circle.centerY).toBe(24);
    expect(circle.radius).toBe(15);
    expect(circle.layerId).toBe(onlyCircle(committed).layerId);
  });
  it('snaps expose center/quadrant/nearest and zero endpoint/midpoint/arc-midpoint', () => {
    const committed = runCadCommand(createCadHistoryState(blankProject()), circleCommand()).present.project;
    const entity = onlyCircle(committed);
    const candidates = buildCircleEntitySnapCandidates(
      {
        project: committed,
        worldPoint: { x: 0, y: 0 },
        allowed: new Set(['center', 'quadrant', 'nearest', 'tangent', 'perpendicular', 'intersection', 'endpoint', 'midpoint', 'arc-midpoint']),
        constructionContext: { active: false, basePoint: null },
        visibleEntities: [entity],
      } as never,
      entity,
    );
    const kinds = candidates.map((candidate) => candidate.kind);
    expect(kinds).toContain('center');
    expect(kinds.filter((kind) => kind === 'quadrant')).toHaveLength(4);
    expect(kinds).toContain('nearest');
    expect(kinds).not.toContain('endpoint');
    expect(kinds).not.toContain('midpoint');
    expect(kinds).not.toContain('arc-midpoint');
  });
  it('grips are exactly center + radius', () => {
    const committed = runCadCommand(createCadHistoryState(blankProject()), circleCommand()).present.project;
    const grips = buildCadGripHandles(onlyCircle(committed));
    expect(grips.map((grip) => grip.kind).sort()).toEqual(['circle-center', 'circle-radius']);
  });
});
