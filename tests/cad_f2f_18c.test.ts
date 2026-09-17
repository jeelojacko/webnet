// Phase 18C F2F wave: generated layers use the real model, entities stay
// ByLayer (appearance intent absent), and reruns preserve user-edited
// layer-table properties.
import { describe, expect, it } from 'vitest';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildFieldToFinishPayload,
  buildFieldToFinishProject,
  applyFieldToFinishPayload,
  type FieldToFinishCadArgs,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';

const catalog: FeatureCodeCatalog = {
  id: 'test-18c',
  name: 'Test 18C',
  version: '1',
  definitions: [
    {
      id: 'ep', code: 'EP', description: 'Edge', layer: 'RD-EP',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
  ],
  aliases: [],
};

const points = (): FieldToFinishCadPoint[] => [
  {
    stationId: 'P1', x: 0, y: 0, sourceOrder: 1, codes: [{ code: 'EP' }],
    rawCodeText: 'EP', description: 'd1', sourceImportId: 'import-1',
  },
  {
    stationId: 'P2', x: 10, y: 0, sourceOrder: 2, codes: [{ code: 'EP' }],
    rawCodeText: 'EP', description: 'd2', sourceImportId: 'import-1',
  },
];

const argsOf = (runId: string): FieldToFinishCadArgs => ({ points: points(), catalog, generationRunId: runId });

describe('18C F2F layer compatibility', () => {
  it('creates real-model layers and keeps generated entities ByLayer', () => {
    const result = buildFieldToFinishProject(createBlankCadProject({ name: 'F2F', units: 'm' }), argsOf('run-1'));
    const layer = result.project.layers.find((entry) => entry.name === 'RD-EP');
    expect(layer).toMatchObject({ visible: true, locked: false, printable: true, role: 'points' });
    expect(typeof layer?.color).toBe('string');
    const generated = result.project.entities.filter((entity) => entity.id.startsWith('pt:'));
    expect(generated.length).toBe(2);
    // Appearance intent stays absent (= ByLayer); only legacy style linkage applies.
    for (const entity of generated) {
      expect(entity.appearance).toBeUndefined();
    }
  });

  it('reruns preserve user-edited layer-table properties', () => {
    const first = buildFieldToFinishProject(createBlankCadProject({ name: 'F2F', units: 'm' }), argsOf('run-1'));
    const edited = {
      ...first.project,
      layers: first.project.layers.map((layer) =>
        layer.name === 'RD-EP'
          ? {
              ...layer,
              color: '#111111',
              lineTypeId: 'dashed' as const,
              lineweightMm: 0.7,
              transparency: 0.3,
              frozen: true,
              printable: false,
              description: 'user note',
            }
          : layer,
      ),
    };
    const rerun = buildFieldToFinishPayload(edited, argsOf('run-2'));
    // Rerun adds no duplicate layer and carries no layer reset.
    expect(rerun.payload.layersToAdd.filter((layer) => layer.name === 'RD-EP')).toHaveLength(0);
    const next = applyFieldToFinishPayload(edited, rerun.payload);
    expect(next.layers.find((layer) => layer.name === 'RD-EP')).toMatchObject({
      color: '#111111',
      lineTypeId: 'dashed',
      lineweightMm: 0.7,
      transparency: 0.3,
      frozen: true,
      printable: false,
      description: 'user note',
    });
    // Generation still upserts its entities on the edited layer.
    const layerId = next.layers.find((layer) => layer.name === 'RD-EP')?.id;
    expect(next.entities.filter((entity) => entity.layerId === layerId).length).toBeGreaterThan(0);
  });
});
