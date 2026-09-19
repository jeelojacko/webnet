// Phase 18N persist slice: blockDefinitions + block-reference entities +
// block-backed point styles round-trip through .wncad (schema stays 2,
// additive trailing). Legacy opens with an empty library; unknown refs are
// dropped with diagnostics, never left dangling.
import { describe, expect, it } from 'vitest';

import {
  expandBlockReference,
  findBlockDefinition,
} from '../src/engine/cad/cadBlocks';
import { sanitizeCadBlockReferences } from '../src/engine/cad/cadBlockPersistence';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { surveyPointMarker } from '../src/engine/cad/cadRendererStyle';
import type {
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

const LAYER = 'test-layer';

const baseEntity = { layerId: LAYER, visible: true, locked: false } as const;

const testProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'Block persist', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  return project;
};

const crossDefinition = (): CadBlockDefinition => ({
  id: 'blk-cross',
  name: 'Cross',
  basePoint: { x: 10, y: 20 },
  entities: [
    { ...baseEntity, id: 'child-h', type: 'line', fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 20, toX: 20, toY: 20, sourceObservationIds: [] },
    { ...baseEntity, id: 'child-v', type: 'line', fromStationId: 'C', toStationId: 'D', fromX: 10, fromY: 10, toX: 10, toY: 30, sourceObservationIds: [] },
  ],
});

const refAt = (id: string, x: number, y: number, rotationDeg = 0, scale = 1): CadBlockReferenceEntity => ({
  ...baseEntity,
  id,
  type: 'block-reference',
  blockDefinitionId: 'blk-cross',
  x,
  y,
  rotationDeg,
  scaleX: scale,
  scaleY: scale,
});

describe('cad blocks wncad persistence (18N)', () => {
  it('opens legacy drawings with an empty block library', () => {
    const document = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const raw = JSON.parse(serializeCadDrawingFile(document)) as Record<string, unknown>;
    delete (raw.project as Record<string, unknown>).blockDefinitions;
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.blockDefinitions).toEqual([]);
  });

  it('drops dangling references with diagnostics, never failing the open', () => {
    const project = testProject();
    project.blockDefinitions = [crossDefinition()];
    const dangling: CadBlockReferenceEntity = { ...refAt('ref-ghost', 0, 0), blockDefinitionId: 'blk-missing' };
    project.entities = [dangling, refAt('ref-ok', 10, 20)];
    const { project: sanitized, diagnostics } = sanitizeCadBlockReferences(project);
    expect(sanitized.entities.map((entity) => entity.id)).toEqual(['ref-ok']);
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'CAD_BLOCK_DANGLING_REFERENCE_DROPPED')).toBe(true);
    // Same through the file path: the drawing opens, the ghost is gone.
    const document = createBlankCadDrawingDocument({ name: 'Dangling', units: 'm' });
    document.project = { ...project, name: 'Dangling' };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.entities.map((entity) => entity.id)).toEqual(['ref-ok']);
    expect(parsed.drawing.project.blockDefinitions?.map((definition) => definition.id)).toEqual(['blk-cross']);
  });

  it('clears unknown point-style block markers back to the legacy symbol', () => {
    const project = testProject();
    project.blockDefinitions = [];
    project.pointStyles = [
      ...(project.pointStyles ?? []),
      { id: 'style-blocked', name: 'Blocked', markerSymbolId: 'point-free', markerBlockDefinitionId: 'blk-missing', displayMarker: true },
    ];
    const { project: sanitized, diagnostics } = sanitizeCadBlockReferences(project);
    const style = sanitized.pointStyles?.find((entry) => entry.id === 'style-blocked');
    expect(style?.markerBlockDefinitionId).toBeUndefined();
    expect(style?.markerSymbolId).toBe('point-free');
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'CAD_BLOCK_UNKNOWN_STYLE_MARKER_DROPPED')).toBe(true);
  });

  it('round-trips a custom block + 3 inserts + block-backed style + F2F point exactly', () => {
    const project = testProject();
    const definition = crossDefinition();
    project.blockDefinitions = [definition];
    const entities: CadEntity[] = [refAt('ref-1', 10, 20), refAt('ref-2', 100, 200, 90), refAt('ref-3', -50, 75, 30, 2)];
    // Block-backed point style + a survey point bound to it (F2F writes the
    // BASE pointStyleId only; the display resolver picks the block path —
    // the point itself stays CadSurveyPointEntity, never converted).
    project.pointStyles = [
      ...(project.pointStyles ?? []),
      { id: 'style-cross-marker', name: 'Cross Marker', markerSymbolId: 'point-free', markerBlockDefinitionId: 'blk-cross', displayMarker: true },
    ];
    entities.push({
      ...baseEntity,
      id: 'pt-f2f',
      type: 'survey-point',
      stationId: 'F2F1',
      x: 500,
      y: 600,
      pointClass: 'free',
      source: 'parsed-input',
      featureCode: 'TREE',
      pointStyleId: 'style-cross-marker',
    });
    project.entities = entities;
    const document = createBlankCadDrawingDocument({ name: 'Round trip', units: 'm' });
    document.project = { ...project, name: 'Round trip' };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.blockDefinitions).toEqual([definition]);
    expect(reopened.entities).toEqual(entities);
    expect(reopened.pointStyles?.find((entry) => entry.id === 'style-cross-marker')).toEqual(
      { id: 'style-cross-marker', name: 'Cross Marker', markerSymbolId: 'point-free', markerBlockDefinitionId: 'blk-cross', displayMarker: true },
    );
    // Live behavior after reopen: marker resolves + expands, refs expand.
    const point = reopened.entities.find((entity) => entity.id === 'pt-f2f');
    expect(point?.type).toBe('survey-point');
    if (point?.type !== 'survey-point') return;
    expect(surveyPointMarker(reopened, point).blockDefinitionId).toBe('blk-cross');
    const scene = buildCadDisplayScene(reopened);
    for (const refId of ['ref-1', 'ref-2', 'ref-3', 'pt-f2f']) {
      expect(scene.primitives.some((primitive) => primitive.sourceEntityId === refId), refId).toBe(true);
    }
    const def = findBlockDefinition(reopened.blockDefinitions, 'blk-cross');
    expect(def).toBeDefined();
    if (!def) return;
    const world = expandBlockReference(def, refAt('ref-x', 10, 20));
    expect(world.filter((child) => child.type === 'line')).toHaveLength(2);
  });

  it('stores 1 definition + 1000 references far smaller than 1000 exploded copies', () => {
    const project = testProject();
    const definition: CadBlockDefinition = {
      id: 'blk-sym',
      name: 'Symbol',
      basePoint: { x: 0, y: 0 },
      entities: [
        { ...baseEntity, id: 'c1', type: 'line', fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 1, toY: 0, sourceObservationIds: [] },
        { ...baseEntity, id: 'c2', type: 'line', fromStationId: 'B', toStationId: 'C', fromX: 1, fromY: 0, toX: 1, toY: 1, sourceObservationIds: [] },
        { ...baseEntity, id: 'c3', type: 'arc', centerX: 0.5, centerY: 0.5, radius: 0.5, startAngleDeg: 0, endAngleDeg: 360 },
        { ...baseEntity, id: 'c4', type: 'text', x: 0.5, y: -0.5, text: 'S' },
      ],
    };
    project.blockDefinitions = [definition];
    project.entities = Array.from({ length: 1000 }, (_, index) => refAt(`ref-${index}`, index, index * 2));
    // Same definition id so the refs resolve identically in both projects.
    project.entities.forEach((entity) => {
      if (entity.type === 'block-reference') entity.blockDefinitionId = 'blk-sym';
    });
    const instancedBytes = JSON.stringify(project).length;
    const exploded: CadEntity[] = [];
    project.entities.forEach((entity) => {
      if (entity.type !== 'block-reference') return;
      expandBlockReference(definition, entity).forEach((child, childIndex) => {
        exploded.push({ ...(child as CadEntity), id: `${entity.id}::${childIndex}` });
      });
    });
    const explodedBytes = JSON.stringify({ ...project, blockDefinitions: [], entities: exploded }).length;
    expect(instancedBytes).toBeLessThan(explodedBytes / 3);
  });
});
