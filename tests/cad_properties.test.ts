import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
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

describe('Survey CAD properties builder', () => {
  it('returns null when nothing is selected', () => {
    expect(buildCadPropertiesPanelState(buildBaseProject(), [])).toBeNull();
  });

  it('builds single-point properties', () => {
    const project = buildBaseProject();
    const point = project.entities.find((entity) => entity.type === 'survey-point' && entity.stationId === 'A');
    if (!point || point.type !== 'survey-point') throw new Error('Point A not found');

    const state = buildCadPropertiesPanelState(project, [point]);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') throw new Error('Single point properties missing');

    expect(state.entity.entityLabel).toBe('A');
    expect(state.entity.properties.find((row) => row.label === 'Type')?.value).toBe('Point');
    expect(state.entity.properties.find((row) => row.label === 'Easting')?.value).toBe('0.000');
    expect(state.entity.properties.find((row) => row.label === 'Northing')?.value).toBe('0.000');
    expect(state.entity.properties.find((row) => row.label === 'Name')?.editableField).toEqual({
      kind: 'entity-name',
    });
    expect(state.entity.properties.find((row) => row.label === 'Easting')?.editableField).toEqual({
      kind: 'point-x',
    });
  });

  it('builds single-line properties with forward/reverse azimuths, bearings, and deltas', () => {
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
    const line = project.entities.find((entity) => entity.type === 'line' && entity.id === 'line:A|C');
    if (!line || line.type !== 'line') throw new Error('Line A|C not found');

    const state = buildCadPropertiesPanelState(project, [line]);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') throw new Error('Single line properties missing');

    expect(state.entity.entityLabel).toBe('A-C');
    expect(state.entity.properties.find((row) => row.label === 'Azimuth forward')?.value).toBe(`56°18'36"`);
    expect(state.entity.properties.find((row) => row.label === 'Azimuth reverse')?.value).toBe(`236°18'36"`);
    expect(state.entity.properties.find((row) => row.label === 'Bearing forward')?.value).toBe('N56-18-35.76E');
    expect(state.entity.properties.find((row) => row.label === 'Bearing reverse')?.value).toBe('S56-18-35.76W');
    expect(state.entity.properties.find((row) => row.label === 'Delta E')?.value).toBe('60.000');
    expect(state.entity.properties.find((row) => row.label === 'Delta N')?.value).toBe('40.000');
    expect(state.entity.properties.find((row) => row.label === 'Delta elev')?.value).toBe('0.000');
    expect(state.entity.properties.find((row) => row.label === 'Length')?.editableField).toEqual({
      kind: 'line-length',
    });
    expect(state.entity.properties.find((row) => row.label === 'Azimuth forward')?.editableField).toEqual({
      kind: 'line-azimuth',
    });
  });

  it('builds polyline segment and vertex edit rows', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'polyline:test',
        type: 'polyline',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
        closed: false,
        metadata: {
          entityName: 'PL1',
        },
      },
    ]);
    const polyline = project.entities.find((entity) => entity.id === 'polyline:test');
    if (!polyline || polyline.type !== 'polyline') throw new Error('Polyline not found');

    const state = buildCadPropertiesPanelState(project, [polyline]);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') throw new Error('Polyline properties missing');

    expect(state.entity.properties.find((row) => row.label === 'Segment 1 length')?.editableField).toEqual({
      kind: 'polyline-segment-length',
      segmentIndex: 0,
    });
    expect(state.entity.properties.find((row) => row.label === 'Segment 2 azimuth')?.editableField).toEqual({
      kind: 'polyline-segment-azimuth',
      segmentIndex: 1,
    });
    expect(state.entity.properties.find((row) => row.label === 'P1 Easting')?.editableField).toEqual({
      kind: 'polyline-vertex-x',
      vertexIndex: 1,
    });
    expect(state.entity.properties.find((row) => row.label === 'P2 Northing')?.editableField).toEqual({
      kind: 'polyline-vertex-y',
      vertexIndex: 2,
    });
  });

  it('builds parcel summary properties', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'parcel:test',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'B', 'C'],
        areaSquareMeters: 187.5,
        perimeterMeters: 69.154759,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
      },
    ]);
    const parcel = project.entities.find((entity) => entity.id === 'parcel:test');
    if (!parcel || parcel.type !== 'parcel') throw new Error('Parcel not found');

    const state = buildCadPropertiesPanelState(project, [parcel]);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') throw new Error('Parcel properties missing');

    expect(state.entity.properties.find((row) => row.label === 'Parcel')?.value).toBe('Parcel 1');
    expect(state.entity.properties.find((row) => row.label === 'Area')?.value).toBe('187.500');
    expect(state.entity.properties.find((row) => row.label === 'Perimeter')?.value).toBe('69.155');
  });

  it('builds alignment station properties', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'alignment:test',
        type: 'alignment',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        name: 'ALIGN1',
        startStation: 100,
        stationEquations: [{ backStation: 110, aheadStation: 120, rawStation: 110 }],
        elements: [
          {
            kind: 'line' as const,
            start: { x: 0, y: 0 },
            end: { x: 100, y: 0 },
          },
        ],
      },
    ]);
    const alignment = project.entities.find((entity) => entity.id === 'alignment:test');
    if (!alignment || alignment.type !== 'alignment') throw new Error('Alignment not found');

    const state = buildCadPropertiesPanelState(project, [alignment]);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') throw new Error('Alignment properties missing');

    expect(state.entity.properties.find((row) => row.label === 'Start station')?.value).toBe('1+00.000');
    expect(state.entity.properties.find((row) => row.label === 'End station')?.value).toBe('2+10.000');
    expect(state.entity.properties.find((row) => row.label === 'Station equations')?.value).toBe('1');
  });

  it('builds stakeout point properties with alignment metadata', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'point:stakeout',
        type: 'survey-point',
        layerId: 'points',
        styleId: 'style-point',
        visible: true,
        locked: false,
        stationId: 'SO1',
        x: 66,
        y: 44,
        pointClass: 'free',
        source: 'parsed-input',
        metadata: {
          alignmentName: 'ALIGN1',
          alignmentStation: '1+10.000',
          alignmentOffset: 5,
          alignmentPointKind: 'station-offset',
        },
      },
    ]);
    const point = project.entities.find((entity) => entity.id === 'point:stakeout');
    if (!point || point.type !== 'survey-point') throw new Error('Stakeout point not found');

    const state = buildCadPropertiesPanelState(project, [point]);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') throw new Error('Stakeout point properties missing');

    expect(state.entity.properties.find((row) => row.label === 'Alignment')?.value).toBe('ALIGN1');
    expect(state.entity.properties.find((row) => row.label === 'Station')?.value).toBe('1+10.000');
    expect(state.entity.properties.find((row) => row.label === 'Offset')?.value).toBe('5.000');
    expect(state.entity.properties.find((row) => row.label === 'Stakeout kind')?.value).toBe('Station offset');
  });

  it('builds stakeout text properties with alignment metadata', () => {
    const project = appendCadProjectEntities(buildBaseProject(), [
      {
        id: 'text:stakeout',
        type: 'text',
        layerId: 'labels',
        styleId: 'style-text',
        visible: true,
        locked: false,
        x: 66,
        y: 44,
        text: 'SO1\nSTA 1+10.000\nOFF 5.000 m',
        metadata: {
          entityName: 'SO1',
          alignmentName: 'ALIGN1',
          alignmentStation: '1+10.000',
          alignmentOffset: 5,
          alignmentPointKind: 'station-offset',
        },
      },
    ]);
    const text = project.entities.find((entity) => entity.id === 'text:stakeout');
    if (!text || text.type !== 'text') throw new Error('Stakeout text not found');

    const state = buildCadPropertiesPanelState(project, [text]);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') throw new Error('Stakeout text properties missing');

    expect(state.entity.properties.find((row) => row.label === 'Text')?.value).toBe('SO1\nSTA 1+10.000\nOFF 5.000 m');
    expect(state.entity.properties.find((row) => row.label === 'Alignment')?.value).toBe('ALIGN1');
    expect(state.entity.properties.find((row) => row.label === 'Station')?.value).toBe('1+10.000');
    expect(state.entity.properties.find((row) => row.label === 'Offset')?.value).toBe('5.000');
    expect(state.entity.properties.find((row) => row.label === 'Stakeout kind')?.value).toBe('Station offset');
  });

  it('builds deterministic mixed-type multi-selection groups in selection order', () => {
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
      {
        id: 'alignment:test',
        type: 'alignment',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        name: 'ALIGN1',
        startStation: 100,
        elements: [
          {
            kind: 'line' as const,
            start: { x: 0, y: 0 },
            end: { x: 100, y: 0 },
          },
        ],
      },
    ]);
    const selectedEntities = [
      project.entities.find((entity) => entity.type === 'line' && entity.id === 'line:A|C'),
      project.entities.find((entity) => entity.type === 'survey-point' && entity.stationId === 'C'),
      project.entities.find((entity) => entity.type === 'alignment' && entity.id === 'alignment:test'),
    ].filter((entity): entity is NonNullable<typeof entity> => entity != null);

    const state = buildCadPropertiesPanelState(project, selectedEntities);
    expect(state?.mode).toBe('multi');
    if (!state || state.mode !== 'multi') throw new Error('Multi properties missing');

    expect(state.groups.map((group) => group.typeLabel)).toEqual(['Lines', 'Points', 'Alignments']);
    expect(state.defaultTypeKey).toBe('line');
    expect(state.defaultEntityId).toBe('line:A|C');
    expect(state.groups[1]?.entities[0]?.entityLabel).toBe('C');
    expect(state.groups[2]?.entities[0]?.entityLabel).toBe('ALIGN1');
  });
});
