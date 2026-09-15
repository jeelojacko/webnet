import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import { adjustedStationsToFieldToFinishPoints } from '../src/engine/fieldToFinish/regeneration';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import type { ParseOptions } from '../src/types';

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

describe('cad f2f adjustment plan', () => {
  it('decorates adjusted coords with feature metadata and matches the adjustment golden exactly', () => {
    const result = new LSAEngine({ input, parseOptions, maxIterations: 8 }).solve();
    expect(result.stations['C']).toBeDefined();

    // Coordinate-only field points with feature coding (F2F never solves).
    const base: FieldToFinishCadPoint[] = [
      { stationId: 'A', x: 0, y: 0, sourceOrder: 1, rawCodeText: 'CONTROL', codes: [{ code: 'CONTROL' }], description: 'Control station', sourceImportId: 'plan-1' },
      { stationId: 'B', x: 100, y: 0, sourceOrder: 2, rawCodeText: 'CONTROL', codes: [{ code: 'CONTROL' }], description: 'Control station', sourceImportId: 'plan-1' },
      { stationId: 'C', x: 60, y: 40, sourceOrder: 3, rawCodeText: 'EDGE', codes: [{ code: 'EDGE' }], description: 'Edge of pavement', sourceImportId: 'plan-1' },
    ];
    const adjusted = new Map(
      Object.entries(result.stations).map(([id, station]) => [id, { x: station.x, y: station.y }]),
    );
    const decorated = adjustedStationsToFieldToFinishPoints(base, adjusted);

    const project = buildFieldToFinishProject(createBlankCadProject({ name: 'F2F plan', units: 'm' }), {
      points: decorated,
      catalog: SAMPLE_CATALOG,
      generationRunId: 'plan-1',
    }).project;

    const byId = new Map(
      project.entities
        .filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point')
        .map((entity) => [entity.stationId, entity]),
    );
    // Adjusted coords equal the adjustment golden exactly — no drift.
    for (const [id, station] of Object.entries(result.stations)) {
      expect(byId.get(id)?.x).toBe(station.x);
      expect(byId.get(id)?.y).toBe(station.y);
    }
    // Feature metadata survives decoration.
    expect(byId.get('C')?.featureCode).toBe('EDGE');
    expect(byId.get('C')?.description).toBe('Edge of pavement');
    expect(byId.get('C')?.metadata?.['featureCodes']).toEqual(['EDGE']);
    const provenance = byId.get('C')?.metadata?.['provenance'] as Record<string, unknown>;
    expect(provenance?.['generatedBy']).toBe('FIELD_TO_FINISH');
    expect(provenance?.['catalogId']).toBe(SAMPLE_CATALOG.id);
  });
});
