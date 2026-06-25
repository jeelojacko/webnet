import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { getCadEntityDisplayLabel, getCadEntitySubpartDisplayLabel } from '../src/engine/cad/cadEntityNames';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import type { ParseOptions } from '../src/types';

const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C C 60 40 5'].join('\n');

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

const buildBaseProject = () =>
  buildSurveyCadSpikeProject({
    input,
    instrumentLibrary: {},
    parseOptions,
    units: 'm',
    result: null,
  });

describe('Survey CAD entity naming helpers', () => {
  it('returns readable fallback for opaque generated arc ids', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'cad-arc-generated-123',
        type: 'arc',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: 10,
        centerY: 10,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 90,
      },
    ]);
    const arc = project.entities.find((entity) => entity.id === 'cad-arc-generated-123');
    if (!arc || arc.type !== 'arc') throw new Error('Opaque arc not found');

    expect(getCadEntityDisplayLabel(arc)).toBe('Arc');
  });

  it('treats prefixed implementation ids as opaque for unlabeled arc and polyline fallbacks', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'arc:hover-test',
        type: 'arc',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: 10,
        centerY: 10,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 90,
      },
      {
        id: 'polyline:hover-test',
        type: 'polyline',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        vertexLabels: ['', '', ''],
        closed: false,
      },
    ]);
    const arc = project.entities.find((entity) => entity.id === 'arc:hover-test');
    const polyline = project.entities.find((entity) => entity.id === 'polyline:hover-test');
    if (!arc || arc.type !== 'arc') throw new Error('Prefixed arc not found');
    if (!polyline || polyline.type !== 'polyline') throw new Error('Prefixed polyline not found');

    expect(getCadEntityDisplayLabel(arc)).toBe('Arc');
    expect(getCadEntityDisplayLabel(polyline)).toBe('Polyline');
  });

  it('returns curve support-point labels for arc start/end/radius subparts when available', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'cad-arc-generated-123',
        type: 'arc',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: 50,
        centerY: 20,
        radius: 12,
        startAngleDeg: 0,
        endAngleDeg: 180,
        metadata: {
          entityName: 'CURVE1',
        },
      },
      {
        id: 'pt:BC1',
        type: 'survey-point',
        layerId: 'points',
        styleId: 'style-point',
        visible: true,
        locked: false,
        stationId: 'BC1',
        x: 62,
        y: 20,
        pointClass: 'free',
        source: 'parsed-input',
        metadata: {
          anchorCurveEntityId: 'cad-arc-generated-123',
          curvePointRole: 'begin',
        },
      },
      {
        id: 'pt:R1',
        type: 'survey-point',
        layerId: 'points',
        styleId: 'style-point',
        visible: true,
        locked: false,
        stationId: 'R1',
        x: 50,
        y: 20,
        pointClass: 'free',
        source: 'parsed-input',
        metadata: {
          anchorCurveEntityId: 'cad-arc-generated-123',
          curvePointRole: 'radius',
        },
      },
    ]);

    expect(getCadEntitySubpartDisplayLabel(project, 'cad-arc-generated-123', 'arc-start')).toBe('BC1');
    expect(getCadEntitySubpartDisplayLabel(project, 'cad-arc-generated-123', 'arc-radius')).toBe('R1');
    expect(getCadEntitySubpartDisplayLabel(project, 'cad-arc-generated-123', 'arc-end')).toBe('CURVE1 end');
  });

  it('returns vertex labels when present and entity fallback names otherwise', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'cad-polyline-generated-123',
        type: 'polyline',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        vertexLabels: ['A', '', ''],
        closed: false,
        metadata: {
          entityName: 'PL1',
        },
      },
    ]);

    expect(getCadEntitySubpartDisplayLabel(project, 'cad-polyline-generated-123', 'vertex', { vertexIndex: 0 })).toBe('A');
    expect(getCadEntitySubpartDisplayLabel(project, 'cad-polyline-generated-123', 'vertex', { vertexIndex: 1 })).toBe('PL1 V2');
  });

  it('returns line endpoint station names before generic start/end fallbacks', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'line:A|C',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'C',
        fromX: 0,
        fromY: 0,
        toX: 60,
        toY: 40,
        sourceObservationIds: [],
      },
    ]);

    expect(getCadEntitySubpartDisplayLabel(project, 'line:A|C', 'line-start')).toBe('A');
    expect(getCadEntitySubpartDisplayLabel(project, 'line:A|C', 'line-end')).toBe('C');
  });
});
