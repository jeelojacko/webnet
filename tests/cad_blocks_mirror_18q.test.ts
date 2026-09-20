// Phase 18Q mirror oracles: additive `mirrored` flag on block references.
// Normative: p_w = insert + R(rot) * S * M * (p - base), M = diag(-1,1).
// Asymmetric L-block so a mirror is observable; legacy (absent flag)
// behavior is pinned unchanged.
import { describe, expect, it } from 'vitest';

import {
  blockReferenceBounds,
  expandBlockReference,
} from '../src/engine/cad/cadBlocks';
import { sanitizeCadBlockReferences } from '../src/engine/cad/cadBlockPersistence';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadEntity } from '../src/engine/cad/cadPersistence';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { buildDxfExportModel } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import type {
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

const LAYER = 'test-layer';
const baseEntity = { layerId: LAYER, visible: true, locked: false } as const;

// Asymmetric L: diagonal line + quarter arc + text, base at origin.
const lDefinition = (): CadBlockDefinition => ({
  id: 'blk-l',
  name: 'L',
  basePoint: { x: 0, y: 0 },
  entities: [
    { ...baseEntity, id: 'l-line', type: 'line', fromStationId: 'A', toStationId: 'B', fromX: 1, fromY: 2, toX: 4, toY: 6, sourceObservationIds: [] },
    { ...baseEntity, id: 'l-arc', type: 'arc', centerX: 2, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 90 },
    { ...baseEntity, id: 'l-text', type: 'text', x: 3, y: 7, text: 'L' },
  ],
});

const ref = (overrides: Partial<CadBlockReferenceEntity> & { id: string }): CadBlockReferenceEntity => ({
  ...baseEntity,
  type: 'block-reference',
  blockDefinitionId: 'blk-l',
  x: 10,
  y: 20,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
  ...overrides,
});

const testProject = (entities: CadProject['entities'] = []): CadProject => {
  const project = createBlankCadProject({ name: 'Mirror', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.blockDefinitions = [lDefinition()];
  project.entities = entities;
  return project;
};

const childById = (children: ReturnType<typeof expandBlockReference>, id: string) => {
  const child = children.find((entry) => entry.id === id);
  if (!child) throw new Error(`missing ${id}`);
  return child;
};

const closeToPoint = (actual: { x: number; y: number }, x: number, y: number): void => {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
};

describe('cad blocks mirrored references (18Q)', () => {
  it('mirrors line children across the block-local Y axis before rotation', () => {
    const children = expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true }));
    const line = childById(children, 'l-line');
    expect(line.type).toBe('line');
    if (line.type !== 'line') throw new Error('type');
    // M(1,2) = (-1,2) -> (9,22); M(4,6) = (-4,6) -> (6,26).
    closeToPoint({ x: line.fromX, y: line.fromY }, 9, 22);
    closeToPoint({ x: line.toX, y: line.toY }, 6, 26);
  });

  it('applies reflection before rotation (mirror + 90°)', () => {
    const children = expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true, rotationDeg: 90 }));
    const line = childById(children, 'l-line');
    if (line.type !== 'line') throw new Error('type');
    // R90 * M(1,2) = R90(-1,2) = (-2,-1) -> (8,19); R90(-4,6) = (-6,-4) -> (4,16).
    closeToPoint({ x: line.fromX, y: line.fromY }, 8, 19);
    closeToPoint({ x: line.toX, y: line.toY }, 4, 16);
  });

  it('scales the mirrored local point (uniform + non-uniform ratio preserved)', () => {
    const uniform = childById(
      expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true, scaleX: 2, scaleY: 2 })),
      'l-line',
    );
    if (uniform.type !== 'line') throw new Error('type');
    closeToPoint({ x: uniform.fromX, y: uniform.fromY }, 8, 24);
    const nonUniform = childById(
      expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true, scaleX: 2, scaleY: 4 })),
      'l-line',
    );
    if (nonUniform.type !== 'line') throw new Error('type');
    closeToPoint({ x: nonUniform.fromX, y: nonUniform.fromY }, 8, 28);
  });

  it('swaps the arc sweep under mirror and scales radius by the mean scale', () => {
    const arc = childById(expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true })), 'l-arc');
    if (arc.type !== 'arc') throw new Error('type');
    // Center M(2,0) = (-2,0) -> (8,20); sweep 0..90 -> 90..180.
    closeToPoint({ x: arc.centerX, y: arc.centerY }, 8, 20);
    expect(arc.startAngleDeg).toBeCloseTo(90, 9);
    expect(arc.endAngleDeg).toBeCloseTo(180, 9);
    expect(arc.radius).toBeCloseTo(5, 9);
    const rotated = childById(
      expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true, rotationDeg: 30 })),
      'l-arc',
    );
    if (rotated.type !== 'arc') throw new Error('type');
    expect(rotated.startAngleDeg).toBeCloseTo(120, 9);
    expect(rotated.endAngleDeg).toBeCloseTo(210, 9);
    const scaled = childById(
      expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true, scaleX: 2, scaleY: 4 })),
      'l-arc',
    );
    if (scaled.type !== 'arc') throw new Error('type');
    expect(scaled.radius).toBeCloseTo(15, 9);
  });

  it('keeps text anchors mirrored but glyphs readable (unrotated primitive)', () => {
    const children = expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true }));
    const text = childById(children, 'l-text');
    if (text.type !== 'text') throw new Error('type');
    closeToPoint({ x: text.x, y: text.y }, 7, 27);
    expect(text.text).toBe('L');
    const project = testProject([ref({ id: 'r1', mirrored: true })]);
    const scene = buildCadDisplayScene(project);
    const primitive = scene.primitives.find((entry) => entry.kind === 'text' && entry.sourceEntityId === 'r1' && entry.text === 'L');
    expect(primitive?.kind).toBe('text');
    if (primitive?.kind !== 'text') throw new Error('missing text primitive');
    closeToPoint(primitive.point, 7, 27);
    expect(primitive.rotationDeg).toBeUndefined();
  });

  it('leaves legacy references (absent flag) exactly unchanged', () => {
    const children = expandBlockReference(lDefinition(), ref({ id: 'r1' }));
    const line = childById(children, 'l-line');
    if (line.type !== 'line') throw new Error('type');
    closeToPoint({ x: line.fromX, y: line.fromY }, 11, 22);
    closeToPoint({ x: line.toX, y: line.toY }, 14, 26);
    const arc = childById(children, 'l-arc');
    if (arc.type !== 'arc') throw new Error('type');
    expect(arc.startAngleDeg).toBeCloseTo(0, 9);
    expect(arc.endAngleDeg).toBeCloseTo(90, 9);
  });

  it('still rejects nonpositive scales even when mirrored (never signed-scale reflection)', () => {
    expect(() => expandBlockReference(lDefinition(), ref({ id: 'r1', mirrored: true, scaleX: -1, scaleY: 1 }))).toThrow(
      'CAD_BLOCK_INVALID_SCALE',
    );
  });

  it('bounds follow the mirrored expansion', () => {
    const bounds = blockReferenceBounds(lDefinition(), ref({ id: 'r1', mirrored: true }));
    expect(bounds).not.toBeNull();
    // Mirrored x-range spans the flipped line (6..9) and arc cardinals; unmirrored spans 11..15.
    expect(bounds!.minX).toBeLessThan(10);
    expect(bounds!.maxX).toBeLessThanOrEqual(10);
    const legacy = blockReferenceBounds(lDefinition(), ref({ id: 'r1' }));
    expect(legacy!.minX).toBeGreaterThanOrEqual(10);
  });

  it('BLOCK_INSERT/BLOCK_EDIT round-trip the flag with stable ref and definition counts', () => {
    const project = testProject();
    const history = createCadHistoryState(project, []);
    const inserted = runCadCommand(history, {
      key: 'BLOCK_INSERT', definitionId: 'blk-l', x: 10, y: 20, mirrored: true, layerId: LAYER,
    });
    expect(inserted.present.project.entities).toHaveLength(1);
    expect(inserted.present.project.blockDefinitions).toHaveLength(1);
    const created = inserted.present.project.entities[0];
    if (created?.type !== 'block-reference') throw new Error('type');
    expect(created.mirrored).toBe(true);
    // In-place edit: counts stable, flag cleared explicitly.
    const edited = runCadCommand(inserted, { key: 'BLOCK_EDIT', referenceId: created.id, mirrored: false });
    expect(edited.present.project.entities).toHaveLength(1);
    expect(edited.present.project.blockDefinitions).toHaveLength(1);
    const updated = edited.present.project.entities[0];
    if (updated?.type !== 'block-reference') throw new Error('type');
    expect('mirrored' in updated).toBe(false);
  });

  it('clone + sanitize preserve the flag; junk mirror values canonicalize to absent', () => {
    const cloned = cloneCadEntity(ref({ id: 'r1', mirrored: true }));
    expect(cloned.type).toBe('block-reference');
    if (cloned.type !== 'block-reference') throw new Error('type');
    expect(cloned.mirrored).toBe(true);
    const project = testProject([
      ref({ id: 'r-true', mirrored: true }),
      ref({ id: 'r-absent' }),
      { ...ref({ id: 'r-junk' }), mirrored: 1 as unknown as boolean },
    ]);
    const { project: sanitized } = sanitizeCadBlockReferences(project);
    expect(sanitized.entities).toHaveLength(3);
    const byId = new Map(sanitized.entities.map((entity) => [entity.id, entity]));
    expect((byId.get('r-true') as CadBlockReferenceEntity).mirrored).toBe(true);
    expect('mirrored' in (byId.get('r-absent') as CadBlockReferenceEntity)).toBe(false);
    expect('mirrored' in (byId.get('r-junk') as CadBlockReferenceEntity)).toBe(false);
  });

  it('WNCAD round-trips mirrored:true/false/absent with schema v2', () => {
    const project = testProject([
      ref({ id: 'r-true', mirrored: true }),
      ref({ id: 'r-absent' }),
    ]);
    const document = { ...createBlankCadDrawingDocument({ name: 'Mirror', units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.drawing.schemaVersion).toBe(2);
    const byId = new Map(parsed.drawing.project.entities.map((entity) => [entity.id, entity]));
    expect((byId.get('r-true') as CadBlockReferenceEntity).mirrored).toBe(true);
    expect('mirrored' in (byId.get('r-absent') as CadBlockReferenceEntity)).toBe(false);
  });

  it('DXF exports mirrored INSERTs with signed group 41 plus world-space TEXT', () => {
    const project = testProject([ref({ id: 'r1', mirrored: true })]);
    const dxf = serializeDxfModel(buildDxfExportModel({ project }));
    const insertBlock = dxf.split('INSERT')[1] ?? '';
    expect(insertBlock).toContain('-1');
    expect(dxf).toContain('L');
    const legacy = serializeDxfModel(buildDxfExportModel({ project: testProject([ref({ id: 'r1' })]) }));
    const legacyInsert = legacy.split('INSERT')[1] ?? '';
    expect(legacyInsert).not.toMatch(/41\s*\n\s*-/);
  });

  it('SVG/PDF scene flows through the mirrored expansion seam', () => {
    const project = testProject([ref({ id: 'r1', mirrored: true })]);
    const scene = buildCadDisplayScene(project);
    const lines = scene.primitives.filter(
      (entry) => entry.kind === 'line' && entry.sourceEntityId === 'r1',
    );
    expect(lines.length).toBeGreaterThan(0);
    const mirroredLine = lines.find(
      (entry) => entry.kind === 'line' && entry.points.some((point) => Math.abs(point.x - 9) < 1e-6),
    );
    expect(mirroredLine).toBeDefined();
  });
});
