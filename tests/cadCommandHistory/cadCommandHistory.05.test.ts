
import { describe, expect, it } from 'vitest';
import {
  buildSurveyCadSpikeProject,
  appendCadProjectEntities,
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  input,
  parseOptions,
} from './cadCommandHistoryTestSupport';

describe('Survey CAD command history', () => {
  it('creates parcel entities from a closed selection of line entities', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project = appendCadProjectEntities(baseProject, [
      {
        id: 'line:A|P1',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'P1',
        fromX: 0,
        fromY: 0,
        toX: 25,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:P1|P2',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'P1',
        toStationId: 'P2',
        fromX: 25,
        fromY: 0,
        toX: 25,
        toY: 15,
        sourceObservationIds: [],
      },
      {
        id: 'line:P2|A',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'P2',
        toStationId: 'A',
        fromX: 25,
        fromY: 15,
        toX: 0,
        toY: 0,
        sourceObservationIds: [],
      },
    ]);

    const parcelState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_CREATE',
      sourceEntityIds: ['line:A|P1', 'line:P1|P2', 'line:P2|A'],
    });
    const parcel = parcelState.present.project.entities.find((entity) => entity.type === 'parcel');
    expect(parcel?.type).toBe('parcel');
    if (parcel?.type !== 'parcel') throw new Error('Parcel missing');

    expect(parcel.vertexLabels).toEqual(['A', 'P1', 'P2']);
    expect(parcel.metadata?.cogo).toMatchObject({
      toolKey: 'PARCEL_CREATE',
      sourceEntityIds: ['line:A|P1', 'line:P1|P2', 'line:P2|A'],
    });
    expect(parcel.areaSquareMeters).toBeCloseTo(187.5, 6);
    expect(parcel.perimeterMeters).toBeCloseTo(69.154759, 6);
    expect(parcel.closureDistanceMeters).toBeCloseTo(0, 6);
    const parcelReportRows = parcelState.present.project.cogoComputations.at(-1)?.report.rows ?? [];
    expect(parcelReportRows).toEqual(
      expect.arrayContaining([
        { label: 'Course 1', value: 'A-P1 N90-00-00.00E' },
        { label: 'Course 2', value: 'P1-P2 N00-00-00.00E' },
        { label: 'Course 3', value: 'P2-A S59-02-10.48W' },
      ]),
    );
  });

  it('splits a parcel entity by a selected line into two child parcels', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project = appendCadProjectEntities(baseProject, [
      {
        id: 'parcel:source',
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
        vertexLabels: ['A', 'P1', 'P2'],
        areaSquareMeters: 187.5,
        perimeterMeters: 69.154759,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
      },
      {
        id: 'line:split',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'S1',
        toStationId: 'S2',
        fromX: 20,
        fromY: -5,
        toX: 20,
        toY: 20,
        sourceObservationIds: [],
      },
    ]);

    const splitState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_SPLIT',
      parcelEntityId: 'parcel:source',
      splitLineEntityId: 'line:split',
    });

    const parcels = splitState.present.project.entities.filter((entity) => entity.type === 'parcel');
    expect(parcels).toHaveLength(2);
    expect(parcels.map((entity) => entity.parcelName)).toEqual(['Parcel 2', 'Parcel 3']);
    const parcelAreas = parcels.map((entity) => entity.areaSquareMeters ?? Number.NaN).sort((a, b) => a - b);
    expect(parcelAreas[0]).toBeCloseTo(67.5, 6);
    expect(parcelAreas[1]).toBeCloseTo(120, 6);
    expect(splitState.present.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT');

    const undoneSplitState = undoCadHistory(splitState);
    expect(
      undoneSplitState.present.project.entities.some(
        (entity) => entity.type === 'parcel' && entity.id === 'parcel:source',
      ),
    ).toBe(true);

    const redoneSplitState = redoCadHistory(undoneSplitState);
    expect(redoneSplitState.present.project.entities.filter((entity) => entity.type === 'parcel')).toHaveLength(2);
  });

  it('normalizes generic polyline vertex labels to simple CAD labels when creating a parcel', () => {
    const project = appendCadProjectEntities(buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    }), [
      {
        id: 'polyline:generic',
        type: 'polyline',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 25, y: 0 },
          { x: 25, y: 15 },
          { x: 0, y: 0 },
        ],
        vertexLabels: ['CAD1', 'V2', 'CAD2', 'CAD1'],
        closed: true,
      },
    ]);

    const parcelState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_CREATE',
      sourceEntityIds: ['polyline:generic'],
    });
    const parcel = parcelState.present.project.entities.find((entity) => entity.type === 'parcel');
    expect(parcel?.type).toBe('parcel');
    if (parcel?.type !== 'parcel') throw new Error('Parcel missing');

    expect(parcel.vertexLabels).toEqual(['CAD1', 'CAD2', 'CAD3']);
    expect(parcelState.present.project.cogoComputations.at(-1)?.report.summary).toContain('CAD1-CAD1');
  });

  it('splits a parcel entity by a through-point bearing into two child parcels', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project = appendCadProjectEntities(baseProject, [
      {
        id: 'parcel:source',
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
        vertexLabels: ['A', 'P1', 'P2'],
        areaSquareMeters: 187.5,
        perimeterMeters: 69.154759,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
      },
    ]);

    const splitState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_SPLIT_BEARING',
      parcelEntityId: 'parcel:source',
      throughPointX: 20,
      throughPointY: 6,
      throughPointLabel: 'SP1',
      bearing: 'N00-00-00E',
    });

    const parcels = splitState.present.project.entities.filter((entity) => entity.type === 'parcel');
    expect(parcels).toHaveLength(2);
    expect(parcels.map((entity) => entity.parcelName)).toEqual(['Parcel 2', 'Parcel 3']);
    const parcelAreas = parcels.map((entity) => entity.areaSquareMeters ?? Number.NaN).sort((a, b) => a - b);
    expect(parcelAreas[0]).toBeCloseTo(67.5, 6);
    expect(parcelAreas[1]).toBeCloseTo(120, 6);
    expect(splitState.present.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_BEARING');

    const undoneSplitState = undoCadHistory(splitState);
    expect(
      undoneSplitState.present.project.entities.some(
        (entity) => entity.type === 'parcel' && entity.id === 'parcel:source',
      ),
    ).toBe(true);
  });

  it('splits a parcel entity by a through-point target area into two child parcels', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project = appendCadProjectEntities(baseProject, [
      {
        id: 'parcel:source',
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
        vertexLabels: ['A', 'P1', 'P2'],
        areaSquareMeters: 187.5,
        perimeterMeters: 69.154759,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
      },
    ]);

    const splitState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_SPLIT_AREA',
      parcelEntityId: 'parcel:source',
      throughPointX: 20,
      throughPointY: 6,
      throughPointLabel: 'SP1',
      targetAreaSquareMeters: 67.5,
    });

    const parcels = splitState.present.project.entities.filter((entity) => entity.type === 'parcel');
    expect(parcels).toHaveLength(2);
    expect(parcels.map((entity) => entity.parcelName)).toEqual(['Parcel 2', 'Parcel 3']);
    const parcelAreas = parcels.map((entity) => entity.areaSquareMeters ?? Number.NaN).sort((a, b) => a - b);
    expect(parcelAreas[0]).toBeCloseTo(67.5, 2);
    expect(parcelAreas[1]).toBeCloseTo(120, 2);
    expect(splitState.present.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_AREA');
  });

});
