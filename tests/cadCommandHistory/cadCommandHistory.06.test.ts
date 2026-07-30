
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
  it('splits a parcel entity by slide frontage layout into two child parcels', () => {
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
    ]);

    const splitState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_SPLIT_SLIDE',
      parcelEntityId: 'parcel:source',
      frontageEntityId: 'line:A|P1',
      targetAreaSquareMeters: 67.5,
      minFrontageMeters: 10,
      alternative: 'start',
      settings: {
        minAreaSquareMeters: 67.5,
        minFrontageMeters: 10,
        useFrontageAtOffset: true,
        frontageOffsetMeters: 12,
        minWidthMeters: 5,
        minDepthMeters: 6,
        useMaxDepth: true,
        maxDepthMeters: 40,
        solutionPreference: 'most_rectangular',
        automaticMode: 'off',
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
    });

    const parcels = splitState.present.project.entities.filter((entity) => entity.type === 'parcel');
    expect(parcels).toHaveLength(2);
    expect(splitState.present.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_SLIDE');
    expect(splitState.present.project.cogoComputations.at(-1)?.report.tables?.[0]?.title).toBe('Created Parcels');
    expect(splitState.present.project.cogoComputations.at(-1)?.report.tables?.[0]?.rows).toHaveLength(2);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Frontage at offset' && row.value === '12.000 m',
      ),
    ).toBe(true);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Solution preference' && row.value === 'Most rectangular',
      ),
    ).toBe(true);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Sampled minimum width',
      ),
    ).toBe(true);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Child depth',
      ),
    ).toBe(true);
  });

  it('splits a parcel entity by swing frontage layout into two child parcels', () => {
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
    ]);

    const splitState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_SPLIT_SWING',
      parcelEntityId: 'parcel:source',
      frontageEntityId: 'line:A|P1',
      targetAreaSquareMeters: 67.5,
      minFrontageMeters: 10,
      alternative: 'start',
      settings: {
        minAreaSquareMeters: 67.5,
        minFrontageMeters: 10,
        useFrontageAtOffset: false,
        frontageOffsetMeters: 10,
        minWidthMeters: 7,
        minDepthMeters: 8,
        useMaxDepth: false,
        maxDepthMeters: 150,
        solutionPreference: 'smallest_area',
        automaticMode: 'off',
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
    });

    const parcels = splitState.present.project.entities.filter((entity) => entity.type === 'parcel');
    expect(parcels).toHaveLength(2);
    expect(splitState.present.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_SWING');
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Maximum depth' && row.value === 'Off',
      ),
    ).toBe(true);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Solution preference' && row.value === 'Smallest area',
      ),
    ).toBe(true);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Minimum width' && row.value === '7.000 m',
      ),
    ).toBe(true);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Sampled minimum width',
      ),
    ).toBe(true);
    expect(
      splitState.present.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Child depth',
      ),
    ).toBe(true);
  });

  it('splits a parcel entity by slide frontage layout using a polyline frontage reference', () => {
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
        id: 'pline:frontage',
        type: 'polyline',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        closed: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 12.5, y: -2 },
          { x: 25, y: 0 },
        ],
        vertexLabels: ['A', 'MID', 'P1'],
      },
    ]);

    const splitState = runCadCommand(createCadHistoryState(project), {
      key: 'PARCEL_SPLIT_SLIDE',
      parcelEntityId: 'parcel:source',
      frontageEntityId: 'pline:frontage',
      targetAreaSquareMeters: 67.5,
      minFrontageMeters: 10,
      alternative: 'start',
      settings: {
        minAreaSquareMeters: 67.5,
        minFrontageMeters: 10,
        useFrontageAtOffset: false,
        frontageOffsetMeters: 10,
        minWidthMeters: 5,
        minDepthMeters: 5,
        useMaxDepth: false,
        maxDepthMeters: 150,
        solutionPreference: 'shortest_frontage',
        automaticMode: 'off',
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
    });

    const parcels = splitState.present.project.entities.filter((entity) => entity.type === 'parcel');
    expect(parcels).toHaveLength(2);
    expect(splitState.present.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_SLIDE');
    expect(splitState.present.project.cogoComputations.at(-1)?.report.tables?.[0]?.title).toBe('Created Parcels');
  });

  it('commits point-to-point traverses with sideshots into geometry and persisted COGO history', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const traverseState = runCadCommand(createCadHistoryState(project), {
      key: 'TRAVERSE',
      mode: 'point-to-point',
      closePoint: { x: 100, y: 0, label: 'B' },
      vertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 20, y: 20, label: 'P1' },
        { x: 100, y: 0, label: 'B' },
      ],
      sideshots: [
        {
          occupyLabel: 'P1',
          backsightLabel: 'A',
          side: 'left',
          angleDeg: 45,
          distance: 10,
          point: { x: 20, y: 30, label: 'SS1' },
        },
      ],
    });

    const traversePolyline = traverseState.present.project.entities.find(
      (entity) => entity.type === 'polyline' && entity.vertexLabels.includes('P1') && entity.vertexLabels.includes('B'),
    );
    expect(traversePolyline?.type).toBe('polyline');
    if (traversePolyline?.type !== 'polyline') throw new Error('Traverse polyline missing');
    expect(traversePolyline.closed).toBe(false);
    expect(
      traverseState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SS1',
      ),
    ).toBe(true);
    expect(
      traverseState.present.project.entities.some(
        (entity) => entity.type === 'line' && entity.toStationId === 'SS1',
      ),
    ).toBe(true);

    const traverseComputation = traverseState.present.project.cogoComputations.at(-1);
    expect(traverseComputation?.toolKey).toBe('TRAVERSE');
    expect(traverseComputation?.report.rows.some((row) => row.label === 'Mode' && row.value === 'point-to-point')).toBe(true);
    expect(traverseComputation?.report.rows.some((row) => row.label === 'Sideshots' && row.value === '1')).toBe(true);

    const undoneState = undoCadHistory(traverseState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SS1',
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SS1',
      ),
    ).toBe(true);
  });

});
