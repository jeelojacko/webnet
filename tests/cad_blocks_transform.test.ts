// Phase 18N transform oracles: world = insert + R(rotation CCW) * S * (local - base).
// Plus the REDEFINE oracle (geometry swap, transforms untouched, undo restores)
// and the instance-independence check.
import { describe, expect, it } from 'vitest';

import {
  blockReferenceBounds,
  expandBlockReference,
} from '../src/engine/cad/cadBlocks';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type {
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

const LAYER = 'test-layer';
const baseEntity = { layerId: LAYER, visible: true, locked: false } as const;

const oracleDefinition = (): CadBlockDefinition => ({
  id: 'blk-oracle',
  name: 'Oracle',
  basePoint: { x: 10, y: 20 },
  entities: [
    { ...baseEntity, id: 'o-line', type: 'line', fromStationId: 'A', toStationId: 'B', fromX: 10, fromY: 20, toX: 30, toY: 20, sourceObservationIds: [] },
    { ...baseEntity, id: 'o-arc', type: 'arc', centerX: 10, centerY: 20, radius: 5, startAngleDeg: 0, endAngleDeg: 90 },
    { ...baseEntity, id: 'o-text', type: 'text', x: 10, y: 30, text: 'T' },
  ],
});

const ref = (overrides: Partial<CadBlockReferenceEntity> & { id: string }): CadBlockReferenceEntity => ({
  ...baseEntity,
  type: 'block-reference',
  blockDefinitionId: 'blk-oracle',
  x: 10,
  y: 20,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
  ...overrides,
});

const lineOf = (children: ReturnType<typeof expandBlockReference>) => {
  const child = children.find((entry) => entry.id === 'o-line');
  expect(child?.type).toBe('line');
  if (child?.type !== 'line') throw new Error('missing o-line');
  return child;
};

const arcOf = (children: ReturnType<typeof expandBlockReference>) => {
  const child = children.find((entry) => entry.id === 'o-arc');
  expect(child?.type).toBe('arc');
  if (child?.type !== 'arc') throw new Error('missing o-arc');
  return child;
};

const closeToPoint = (actual: { x: number; y: number }, x: number, y: number): void => {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
};

describe('cad block transform oracles (18N)', () => {
  it('identity insert reproduces local geometry', () => {
    const definition = oracleDefinition();
    const children = expandBlockReference(definition, ref({ id: 'r' }));
    const line = lineOf(children);
    expect([line.fromX, line.fromY, line.toX, line.toY]).toEqual([10, 20, 30, 20]);
    const arc = arcOf(children);
    expect([arc.centerX, arc.centerY, arc.radius]).toEqual([10, 20, 5]);
    expect([arc.startAngleDeg, arc.endAngleDeg]).toEqual([0, 90]);
  });

  it('pure translation shifts every child', () => {
    const definition = oracleDefinition();
    const children = expandBlockReference(definition, ref({ id: 'r', x: 100, y: 200 }));
    const line = lineOf(children);
    expect([line.fromX, line.fromY, line.toX, line.toY]).toEqual([100, 200, 120, 200]);
    const arc = arcOf(children);
    closeToPoint({ x: arc.centerX, y: arc.centerY }, 100, 200);
  });

  it('90-degree rotation turns offsets CCW and adds to arc sweep', () => {
    const definition = oracleDefinition();
    // Local offset (20,0) -> R90 -> (0,20); insert at origin.
    const children = expandBlockReference(definition, ref({ id: 'r', x: 0, y: 0, rotationDeg: 90 }));
    const line = lineOf(children);
    closeToPoint({ x: line.fromX, y: line.fromY }, 0, 0);
    closeToPoint({ x: line.toX, y: line.toY }, 0, 20);
    const arc = arcOf(children);
    expect([arc.startAngleDeg, arc.endAngleDeg]).toEqual([90, 180]);
  });

  it('uniform scale multiplies offsets and arc radius about the base point', () => {
    const definition = oracleDefinition();
    const children = expandBlockReference(definition, ref({ id: 'r', scaleX: 2, scaleY: 2 }));
    const line = lineOf(children);
    // (local - base) = (0,0)-(20,0), scaled (0,0)-(40,0), + insert (10,20).
    expect([line.fromX, line.fromY, line.toX, line.toY]).toEqual([10, 20, 50, 20]);
    expect(arcOf(children).radius).toBeCloseTo(10, 9);
  });

  it('combined rotation + uniform scale + translation matches the normative order', () => {
    const definition = oracleDefinition();
    const rotationDeg = 30;
    const radians = (rotationDeg * Math.PI) / 180;
    // Local (30,20): offset (20,0), scaled (40,0), rotated, + insert (5,7).
    const expected = {
      x: 5 + 40 * Math.cos(radians),
      y: 7 + 40 * Math.sin(radians),
    };
    const children = expandBlockReference(
      definition,
      ref({ id: 'r', x: 5, y: 7, rotationDeg, scaleX: 2, scaleY: 2 }),
    );
    const line = lineOf(children);
    closeToPoint({ x: line.toX, y: line.toY }, expected.x, expected.y);
    expect(arcOf(children).radius).toBeCloseTo(10, 9);
  });

  it('non-uniform scale uses the mean for arc radius (documented approximation)', () => {
    const definition = oracleDefinition();
    const children = expandBlockReference(definition, ref({ id: 'r', scaleX: 2, scaleY: 4 }));
    expect(arcOf(children).radius).toBeCloseTo(15, 9);
  });

  it('reference bounds equal the union of transformed children', () => {
    const definition = oracleDefinition();
    const bounds = blockReferenceBounds(definition, ref({ id: 'r', x: 100, y: 200, rotationDeg: 90 }));
    expect(bounds).not.toBeNull();
    // Children about insert (100,200): line (100,200)-(100,220), text (90,200).
    expect(bounds?.minX).toBeCloseTo(90, 9);
    expect(bounds?.maxY).toBeCloseTo(220, 9);
  });
});

const crossProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'Redefine oracle', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  const definition: CadBlockDefinition = {
    id: 'blk-cross',
    name: 'Cross',
    basePoint: { x: 0, y: 0 },
    entities: [
      { ...baseEntity, id: 'h', type: 'line', fromStationId: 'A', toStationId: 'B', fromX: -5, fromY: 0, toX: 5, toY: 0, sourceObservationIds: [] },
      { ...baseEntity, id: 'v', type: 'line', fromStationId: 'C', toStationId: 'D', fromX: 0, fromY: -5, toX: 0, toY: 5, sourceObservationIds: [] },
    ],
  };
  project.blockDefinitions = [definition];
  const at = (id: string, x: number, y: number, rotationDeg: number, scale: number): CadBlockReferenceEntity => ({
    ...baseEntity, id, type: 'block-reference', blockDefinitionId: 'blk-cross', x, y, rotationDeg, scaleX: scale, scaleY: scale,
  });
  project.entities = [at('r1', 0, 0, 0, 1), at('r2', 100, 50, 45, 2), at('r3', -30, 80, 90, 0.5)];
  return project;
};

const definitionOf = (project: CadProject): CadBlockDefinition => {
  const definition = (project.blockDefinitions ?? []).find((entry) => entry.id === 'blk-cross');
  if (!definition) throw new Error('missing blk-cross');
  return definition;
};

describe('cad block redefine oracle (18N)', () => {
  it('cross -> cross+circle updates 3 refs, transforms unchanged, undo restores', () => {
    let history = createCadHistoryState(crossProject());
    const before = (history.present.project.entities as CadBlockReferenceEntity[]).map((entity) => ({
      id: entity.id, x: entity.x, y: entity.y, rotationDeg: entity.rotationDeg, scaleX: entity.scaleX, scaleY: entity.scaleY,
    }));
    // New geometry: cross + full-sweep circle.
    const circle: CadEntity = { ...baseEntity, id: 'src-circle', type: 'arc', centerX: 0, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 360 };
    const arm: CadEntity = { ...baseEntity, id: 'src-arm', type: 'line', fromStationId: 'A', toStationId: 'B', fromX: -5, fromY: 0, toX: 5, toY: 0, sourceObservationIds: [] };
    const withSources = {
      ...history.present.project,
      entities: [...history.present.project.entities, circle, arm],
    };
    history = { ...history, present: { ...history.present, project: withSources } };
    const redefined = runCadCommand(history, { key: 'BLOCK_REDEFINE', definitionId: 'blk-cross', sourceEntityIds: ['src-circle', 'src-arm'] });
    expect(redefined).not.toBe(history);
    expect(definitionOf(redefined.present.project).entities.map((entity) => entity.type).sort()).toEqual(['arc', 'line']);
    // All 3 refs expand with the new geometry; transforms byte-identical.
    const after = (redefined.present.project.entities as CadBlockReferenceEntity[]).filter(
      (entity) => entity.type === 'block-reference',
    );
    expect(after).toHaveLength(3);
    expect(after.map((entity) => ({
      id: entity.id, x: entity.x, y: entity.y, rotationDeg: entity.rotationDeg, scaleX: entity.scaleX, scaleY: entity.scaleY,
    }))).toEqual(before);
    const definition = definitionOf(redefined.present.project);
    for (const reference of after) {
      const children = expandBlockReference(definition, reference);
      expect(children).toHaveLength(2);
      expect(children.some((child) => child.type === 'arc')).toBe(true);
    }
    // Undo restores the cross.
    const undone = undoCadHistory(redefined);
    expect(definitionOf(undone.present.project).entities).toHaveLength(2);
    expect(definitionOf(undone.present.project).entities.every((entity) => entity.type === 'line')).toBe(true);
  });

  it('instances stay independent: editing one transform never moves another', () => {
    let history = createCadHistoryState(crossProject());
    const edited = runCadCommand(history, {
      key: 'BLOCK_EDIT', referenceId: 'r2', x: 1000, y: 2000, rotationDeg: 180, scaleX: 3, scaleY: 3,
    });
    expect(edited).not.toBe(history);
    const entities = edited.present.project.entities as CadBlockReferenceEntity[];
    const r1 = entities.find((entity) => entity.id === 'r1');
    const r2 = entities.find((entity) => entity.id === 'r2');
    expect(r1).toMatchObject({ x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 });
    expect(r2).toMatchObject({ x: 1000, y: 2000, rotationDeg: 180, scaleX: 3, scaleY: 3 });
    const definition = definitionOf(edited.present.project);
    const before = expandBlockReference(definition, r1 as CadBlockReferenceEntity);
    // Exploding r1 leaves r2 (and the definition) intact.
    const exploded = runCadCommand(edited, { key: 'BLOCK_EXPLODE', referenceId: 'r1' });
    expect(exploded).not.toBe(edited);
    const remaining = exploded.present.project.entities.filter((entity) => entity.id === 'r2');
    expect(remaining).toHaveLength(1);
    expect(expandBlockReference(definitionOf(exploded.present.project), remaining[0] as CadBlockReferenceEntity)).toHaveLength(2);
    expect(blockReferenceBounds(definitionOf(exploded.present.project), remaining[0] as CadBlockReferenceEntity)).not.toBeNull();
    expect(before).toHaveLength(2);
  });
});
