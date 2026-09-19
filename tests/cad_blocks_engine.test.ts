// Phase 18N engine slice: block definition / reference core contracts.
import { describe, expect, it } from 'vitest';
import {
  MAX_BLOCK_EXPANSION_DEPTH,
  blockDefinitionBounds,
  blockReferenceBounds,
  detectBlockCycle,
  expandBlockReference,
  normalizeBlockScales,
  resolveBlockChildAppearance,
  transformBlockChildToWorld,
  transformBlockPointToWorld,
  validateBlockDefinition,
  visitCadBlockGeometry,
} from '../src/engine/cad/cadBlocks';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import {
  buildCadGripHandles,
  translateEntity,
} from '../src/engine/cad/cadTransactionsEntityTransforms';
import type {
  CadArcEntity,
  CadBlockChild,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadLineEntity,
  CadTextEntity,
} from '../src/engine/cad/cadTypes';

const lineChild = (
  id: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
});

/** Asymmetric L: horizontal limb (0,0)-(2,0), vertical limb (0,0)-(0,1). */
const lShapeChildren = (): CadBlockChild[] => [lineChild('blk:h', 0, 0, 2, 0), lineChild('blk:v', 0, 0, 0, 1)];

const lShapeDefinition = (overrides?: Partial<CadBlockDefinition>): CadBlockDefinition => ({
  id: 'blk-l',
  name: 'L-shape',
  basePoint: { x: 0, y: 0 },
  entities: lShapeChildren(),
  ...overrides,
});

const reference = (overrides?: Partial<CadBlockReferenceEntity>): CadBlockReferenceEntity => ({
  id: 'ref-1',
  type: 'block-reference',
  layerId: 'general',
  visible: true,
  locked: false,
  blockDefinitionId: 'blk-l',
  x: 0,
  y: 0,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
  ...overrides,
});

const lineEndpoints = (child: CadBlockChild): [number, number, number, number] => {
  if (child.type !== 'line') throw new Error('expected line child');
  return [child.fromX, child.fromY, child.toX, child.toY];
};

/** Snap float dust (cos90, negative zero) so rotation oracles read exactly. */
const snapEndpoints = (child: CadBlockChild): [number, number, number, number] =>
  lineEndpoints(child).map((value) => {
    const rounded = Math.round(value * 1e9) / 1e9;
    return Object.is(rounded, -0) ? 0 : rounded;
  }) as [number, number, number, number];

describe('18N block transform order', () => {
  it('translates local geometry by the insertion point', () => {
    const world = transformBlockChildToWorld(lineChild('c', 1, 2, 3, 4), lShapeDefinition(), reference({ x: 10, y: 20 }));
    expect(lineEndpoints(world)).toEqual([11, 22, 13, 24]);
  });

  it('scales about the base point before translation', () => {
    const world = transformBlockChildToWorld(lineChild('c', 1, 1, 3, 2), lShapeDefinition(), reference({ scaleX: 2, scaleY: 3 }));
    expect(lineEndpoints(world)).toEqual([2, 3, 6, 6]);
  });

  it('rotation oracle 0deg keeps the L limbs on +X/+Y', () => {
    const expanded = expandBlockReference(lShapeDefinition(), reference());
    expect(expanded.map(lineEndpoints)).toEqual([
      [0, 0, 2, 0],
      [0, 0, 0, 1],
    ]);
  });

  it('rotation oracle 90deg maps +X to +Y and +Y to -X', () => {
    const expanded = expandBlockReference(lShapeDefinition(), reference({ rotationDeg: 90 }));
    expect(expanded.map(snapEndpoints)).toEqual([
      [0, 0, 0, 2],
      [0, 0, -1, 0],
    ]);
  });

  it('rotation oracle 180deg negates both limbs', () => {
    const expanded = expandBlockReference(lShapeDefinition(), reference({ rotationDeg: 180 }));
    expect(expanded.map(snapEndpoints)).toEqual([
      [0, 0, -2, 0],
      [0, 0, 0, -1],
    ]);
  });

  it('rotation oracle 270deg maps +X to -Y and +Y to +X', () => {
    const expanded = expandBlockReference(lShapeDefinition(), reference({ rotationDeg: 270 }));
    expect(expanded.map(snapEndpoints)).toEqual([
      [0, 0, 0, -2],
      [0, 0, 1, 0],
    ]);
  });

  it('combined base/scale/rotation/translation matches the analytic result', () => {
    const definition = lShapeDefinition({ basePoint: { x: 1, y: 1 } });
    const ref = reference({ x: 10, y: 20, rotationDeg: 30, scaleX: 2, scaleY: 3 });
    const world = transformBlockPointToWorld({ x: 3, y: 2 }, definition, ref);
    expect(world.x).toBeCloseTo(11.9641016151, 6);
    expect(world.y).toBeCloseTo(24.5980762114, 6);
  });

  it('basePoint offset shifts local geometry before insert', () => {
    const definition = lShapeDefinition({
      basePoint: { x: 1, y: 1 },
      entities: [lineChild('c', 1, 1, 2, 1)],
    });
    const world = transformBlockChildToWorld(definition.entities[0], definition, reference());
    expect(lineEndpoints(world)).toEqual([0, 0, 1, 0]);
  });

  it('arc rotation adds the delta and normalizes past 360', () => {
    const arc: CadArcEntity = {
      id: 'blk:arc', type: 'arc', layerId: 'general', visible: true, locked: false,
      centerX: 5, centerY: 5, radius: 2, startAngleDeg: 10, endAngleDeg: 80,
    };
    const rotated = transformBlockChildToWorld(arc, lShapeDefinition(), reference({ rotationDeg: 90 }));
    if (rotated.type !== 'arc') throw new Error('expected arc');
    expect([rotated.startAngleDeg, rotated.endAngleDeg]).toEqual([100, 170]);
    const wrapped = transformBlockChildToWorld(arc, lShapeDefinition(), reference({ rotationDeg: 290 }));
    if (wrapped.type !== 'arc') throw new Error('expected arc');
    expect([wrapped.startAngleDeg, wrapped.endAngleDeg]).toEqual([300, 10]);
  });
});

describe('18N block validation', () => {
  it('rejects non-positive and non-finite scales with CAD_BLOCK_INVALID_SCALE', () => {
    for (const [scaleX, scaleY] of [[0, 1], [-1, 1], [1, 0], [1, -2], [Number.NaN, 1], [1, Number.NaN], [Number.POSITIVE_INFINITY, 1]] as Array<[number, number]>) {
      expect(normalizeBlockScales(scaleX, scaleY)?.code).toBe('CAD_BLOCK_INVALID_SCALE');
    }
    expect(normalizeBlockScales(2, 0.5)).toBeNull();
  });

  it('transform and expand throw on invalid scales', () => {
    const definition = lShapeDefinition();
    expect(() => transformBlockChildToWorld(definition.entities[0], definition, reference({ scaleX: 0 }))).toThrow(/CAD_BLOCK_INVALID_SCALE/);
    expect(() => expandBlockReference(definition, reference({ scaleY: Number.NaN }))).toThrow(/CAD_BLOCK_INVALID_SCALE/);
  });

  it('rejects nested block references', () => {
    const nested = reference({ id: 'blk:nested', blockDefinitionId: 'other' });
    const issues = validateBlockDefinition(
      lShapeDefinition({ entities: [nested as unknown as CadBlockChild] }),
    );
    expect(issues.map((issue) => issue.code)).toContain('CAD_BLOCK_NESTED_UNSUPPORTED');
  });

  it('rejects survey-point and alignment children', () => {
    const point = { id: 'blk:pt', type: 'survey-point' } as unknown as CadBlockChild;
    const alignment = { id: 'blk:al', type: 'alignment' } as unknown as CadBlockChild;
    const issues = validateBlockDefinition(lShapeDefinition({ entities: [point, alignment] }));
    expect(issues.filter((issue) => issue.code === 'CAD_BLOCK_NESTED_UNSUPPORTED')).toHaveLength(2);
  });

  it('rejects text children bound to a point label', () => {
    const label: CadTextEntity = {
      id: 'blk:t', type: 'text', layerId: 'general', visible: true, locked: false,
      x: 0, y: 0, text: 'P1',
      pointLabel: { pointEntityId: 'pt:1', labelStyleId: 'ls', content: { mode: 'derived' } },
    };
    const issues = validateBlockDefinition(lShapeDefinition({ entities: [label] }));
    expect(issues.map((issue) => issue.code)).toContain('CAD_BLOCK_POINT_LABEL_UNSUPPORTED');
    const free: CadTextEntity = { ...label, id: 'blk:free', pointLabel: undefined };
    expect(validateBlockDefinition(lShapeDefinition({ entities: [free] }))).toHaveLength(0);
  });

  it('rejects duplicate block-local child ids', () => {
    const issues = validateBlockDefinition(
      lShapeDefinition({ entities: [lineChild('dup', 0, 0, 1, 0), lineChild('dup', 0, 0, 0, 1)] }),
    );
    expect(issues.map((issue) => issue.code)).toContain('CAD_BLOCK_DUPLICATE_CHILD_ID');
  });

  it('rejects empty names, duplicate names, and empty entity lists', () => {
    expect(validateBlockDefinition(lShapeDefinition({ name: '   ' })).map((issue) => issue.code)).toContain('CAD_BLOCK_EMPTY_NAME');
    expect(validateBlockDefinition(lShapeDefinition({ name: 'L-SHAPE' }), ['l-shape']).map((issue) => issue.code)).toContain('CAD_BLOCK_DUPLICATE_NAME');
    expect(validateBlockDefinition(lShapeDefinition({ entities: [] })).map((issue) => issue.code)).toContain('CAD_BLOCK_EMPTY_ENTITIES');
    expect(validateBlockDefinition(lShapeDefinition(), ['other'])).toHaveLength(0);
  });

  it('cycle guard trips on visited ids and excessive depth', () => {
    expect(detectBlockCycle('a', new Set(['a']), 0)?.code).toBe('CAD_BLOCK_REFERENCE_CYCLE');
    expect(detectBlockCycle('a', new Set(), MAX_BLOCK_EXPANSION_DEPTH + 1)?.code).toBe('CAD_BLOCK_REFERENCE_CYCLE');
    expect(detectBlockCycle('a', new Set(), 0)).toBeNull();
    expect(() => expandBlockReference(lShapeDefinition(), reference(), new Set(['blk-l']), 0)).toThrow(/CAD_BLOCK_REFERENCE_CYCLE/);
  });
});

describe('18N block bounds', () => {
  it('computes local definition bounds without any reference', () => {
    expect(blockDefinitionBounds(lShapeDefinition())).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 1 });
  });

  it('reference bounds are tight under 90deg rotation', () => {
    const bounds = blockReferenceBounds(lShapeDefinition(), reference({ rotationDeg: 90 }));
    if (!bounds) throw new Error('expected bounds');
    expect(bounds.minX).toBeCloseTo(-1, 9);
    expect(bounds.minY).toBeCloseTo(0, 9);
    expect(bounds.maxX).toBeCloseTo(0, 9);
    expect(bounds.maxY).toBeCloseTo(2, 9);
  });

  it('reference bounds contain every expanded child point', () => {
    const definition = lShapeDefinition();
    const ref = reference({ x: 5, y: -3, rotationDeg: 37, scaleX: 2, scaleY: 1.5 });
    const bounds = blockReferenceBounds(definition, ref);
    if (!bounds) throw new Error('expected bounds');
    for (const child of expandBlockReference(definition, ref)) {
      if (child.type !== 'line') throw new Error('expected line');
      for (const [x, y] of [[child.fromX, child.fromY], [child.toX, child.toY]] as Array<[number, number]>) {
        expect(x).toBeGreaterThanOrEqual(bounds.minX - 1e-9);
        expect(x).toBeLessThanOrEqual(bounds.maxX + 1e-9);
        expect(y).toBeGreaterThanOrEqual(bounds.minY - 1e-9);
        expect(y).toBeLessThanOrEqual(bounds.maxY + 1e-9);
      }
    }
  });

  it('stays stable at large coordinates', () => {
    const definition = lShapeDefinition({ basePoint: { x: 0, y: 0 }, entities: [lineChild('c', 3, 4, 3, 4)] });
    const world = transformBlockPointToWorld({ x: 3, y: 4 }, definition, reference({ x: 2e6, y: 7e6, rotationDeg: 90, scaleX: 2, scaleY: 2 }));
    expect(world.x).toBeCloseTo(1999992, 3);
    expect(world.y).toBeCloseTo(7000006, 3);
  });
});

describe('18N block identity and appearance', () => {
  it('preserves block-local child ids verbatim through expansion', () => {
    const expanded = expandBlockReference(lShapeDefinition(), reference({ x: 9, y: 9 }));
    expect(expanded.map((child) => child.id)).toEqual(['blk:h', 'blk:v']);
  });

  it('resolves child explicit over reference over absent', () => {
    expect(resolveBlockChildAppearance({ color: '#ff0000' }, { color: '#00ff00', lineweightMm: 0.5 })).toEqual({
      color: '#ff0000',
      lineweightMm: 0.5,
    });
    expect(resolveBlockChildAppearance(undefined, { color: '#00ff00' })).toEqual({ color: '#00ff00' });
  });

  it('returns explicit fields only, never defaults', () => {
    expect(resolveBlockChildAppearance(undefined, undefined)).toEqual({});
    expect(resolveBlockChildAppearance({ transparency: 0.25 }, {})).toEqual({ transparency: 0.25 });
  });
});

describe('18N block entity wiring', () => {
  it('translateEntity moves the insertion point only', () => {
    const moved = translateEntity(reference({ x: 1, y: 2, rotationDeg: 45, scaleX: 2, scaleY: 3 }), 5, -7);
    if (moved.type !== 'block-reference') throw new Error('expected block-reference');
    expect(moved).toMatchObject({ x: 6, y: -5, rotationDeg: 45, scaleX: 2, scaleY: 3, blockDefinitionId: 'blk-l' });
  });

  it('COPY clones the reference with a new id and the same definition', () => {
    const ref = reference({ x: 1, y: 1 });
    const project = {
      ...createBlankCadProject({ name: 'Blocks', units: 'm' }),
      blockDefinitions: [lShapeDefinition()],
      entities: [ref],
    };
    const copied = runCadCommand(createCadHistoryState(project, [ref.id]), { key: 'COPY', deltaX: 10, deltaY: 20 });
    const clones = copied.present.project.entities.filter((entity) => entity.type === 'block-reference' && entity.id !== ref.id);
    expect(clones).toHaveLength(1);
    const clone = clones[0];
    if (clone.type !== 'block-reference') throw new Error('expected block-reference');
    expect(clone).toMatchObject({ blockDefinitionId: 'blk-l', x: 11, y: 21, rotationDeg: 0, scaleX: 1, scaleY: 1 });
  });

  it('grip handles expose only the insertion grip', () => {
    expect(buildCadGripHandles(reference({ x: 4, y: 5 }))).toEqual([
      { id: 'ref-1:insertion', entityId: 'ref-1', kind: 'insertion', x: 4, y: 5 },
    ]);
  });

  it('visitCadBlockGeometry walks world children in definition order', () => {
    const seen: Array<{ id: string; fromX: number }> = [];
    visitCadBlockGeometry(lShapeDefinition(), reference({ x: 1, y: 0 }), (child, index) => {
      if (child.type !== 'line') throw new Error('expected line');
      expect(index).toBe(seen.length);
      seen.push({ id: child.id, fromX: child.fromX });
    });
    expect(seen).toEqual([
      { id: 'blk:h', fromX: 1 },
      { id: 'blk:v', fromX: 1 },
    ]);
  });

  it('cloneCadProject deep-clones definitions trailing for key-order signatures', () => {
    const project = { ...createBlankCadProject({ name: 'Blocks', units: 'm' }), blockDefinitions: [lShapeDefinition()] };
    const cloned = cloneCadProject(project);
    expect(Object.keys(cloned).at(-1)).toBe('blockDefinitions');
    expect(cloned.blockDefinitions?.[0]).not.toBe(project.blockDefinitions?.[0]);
    expect(cloned.blockDefinitions?.[0].entities[0]).not.toBe(project.blockDefinitions?.[0].entities[0]);
    expect(cloned.blockDefinitions).toEqual(project.blockDefinitions);
  });
});
