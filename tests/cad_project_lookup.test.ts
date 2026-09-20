// Phase 18P: derived project lookup maps — index correctness + the renderer's
// "pass a prebuilt lookup" seam must produce byte-identical primitives to the
// internal build (same ordering, colors, and hidden primitives).
import { describe, expect, it } from 'vitest';
import { buildCadProjectLookup } from '../src/engine/cad/cadProjectLookup';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const projectWithEntities = (): CadProject => {
  const project = createBlankCadDrawingDocument({ name: 'lookup', units: 'm' }).project;
  const layerId = project.layers[0]!.id;
  const entities: CadEntity[] = [
    {
      type: 'line',
      id: 'src-line',
      layerId,
      visible: true,
      locked: false,
      fromStationId: 'A',
      toStationId: 'B',
      fromX: 0,
      fromY: 0,
      toX: 20,
      toY: 10,
      sourceObservationIds: [],
    },
    {
      type: 'bearing-label',
      id: 'bearing-1',
      layerId,
      visible: true,
      locked: false,
      sourceEntityId: 'src-line',
      labelStyleId: 'missing-style',
      offset: { x: 0, y: 2 },
    },
    {
      type: 'mtext',
      id: 'mtext-1',
      layerId,
      visible: true,
      locked: false,
      x: 5,
      y: 5,
      text: 'HELLO\nWORLD',
      textStyleId: project.styleLibrary.textStyles[0]?.id ?? 'missing-text-style',
      rotationDeg: 0,
      attachment: 'middle-center',
    },
    {
      type: 'block-reference',
      id: 'block-1',
      layerId,
      visible: true,
      locked: false,
      blockDefinitionId: project.blockDefinitions?.[0]?.id ?? 'missing-block',
      x: 1,
      y: 1,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    },
  ];
  return { ...project, entities };
};

describe('buildCadProjectLookup', () => {
  it('indexes entities, layers, text styles, and block definitions by id', () => {
    const project = projectWithEntities();
    const lookup = buildCadProjectLookup(project);
    expect(lookup.entityById.get('src-line')?.id).toBe('src-line');
    expect(lookup.entityById.get('nope')).toBeUndefined();
    expect(lookup.layerById.get(project.layers[0]!.id)?.id).toBe(project.layers[0]!.id);
    for (const textStyle of project.styleLibrary.textStyles) {
      expect(lookup.textStyleById.get(textStyle.id)).toBe(textStyle);
    }
    for (const definition of project.blockDefinitions ?? []) {
      expect(lookup.blockDefinitionById.get(definition.id)).toBe(definition);
    }
  });

  it('passing a prebuilt lookup renders identical primitives', () => {
    const project = projectWithEntities();
    const lookup = buildCadProjectLookup(project);
    const implicit = buildCadDisplayScene(project);
    const explicit = buildCadDisplayScene(project, { lookup });
    expect(explicit).toEqual(implicit);
    expect(explicit.primitives.length).toBeGreaterThan(0);
  });

  it('threaded bounds lookup matches the per-call default', () => {
    const project = projectWithEntities();
    const lookup = buildCadProjectLookup(project);
    const boundsList = [
      { minX: -5, minY: -5, maxX: 25, maxY: 15 },
      { minX: 100, minY: 100, maxX: 110, maxY: 110 },
      { minX: 4, minY: 4, maxX: 6, maxY: 6 },
    ];
    for (const entity of project.entities) {
      for (const bounds of boundsList) {
        expect(entityIntersectsBounds(project, entity, bounds, lookup)).toBe(
          entityIntersectsBounds(project, entity, bounds),
        );
      }
    }
  });
});
