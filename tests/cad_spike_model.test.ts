import { describe, expect, it } from 'vitest';
import { LSAEngine } from '../src/engine/adjust';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { buildMlightcadSpikeScene } from '../src/engine/cad/cadMlightcadAdapter';
import type { ParseOptions } from '../src/types';

const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C C 60 40 0', 'D A-C 72.1110255 0.005', 'D B-C 56.5685425 0.005'].join('\n');

const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
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

describe('Survey CAD spike model', () => {
  it('builds native CAD entities from parsed WebNet input', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    expect(project.metadata.source).toBe('parsed-input');
    expect(project.entities.some((entity) => entity.type === 'survey-point')).toBe(true);
    expect(project.entities.some((entity) => entity.type === 'line')).toBe(true);
    expect(project.entities.some((entity) => entity.id === 'pt:A')).toBe(true);
    expect(project.bounds).not.toBeNull();
  });

  it('preserves native entity ids through display-scene and mlightcad adapter outputs', () => {
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result,
    });

    const displayScene = buildCadDisplayScene(project);
    const mlightcadScene = buildMlightcadSpikeScene(project);
    const pointEntity = project.entities.find((entity) => entity.type === 'survey-point');

    expect(pointEntity).toBeDefined();
    expect(
      displayScene.primitives.some((primitive) => primitive.sourceEntityId === pointEntity?.id),
    ).toBe(true);
    expect(
      mlightcadScene.entities.some(
        (entity) => entity.metadata.nativeEntityId === pointEntity?.id && entity.objectId === pointEntity?.id,
      ),
    ).toBe(true);
  });
});
