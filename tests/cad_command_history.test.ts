import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
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

describe('Survey CAD command history', () => {
  it('replays multi-entity erase through undo and redo deterministically', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const pointIds = project.entities
      .filter((entity) => entity.type === 'survey-point')
      .slice(0, 2)
      .map((entity) => entity.id);
    const initialState = createCadHistoryState(project, pointIds);
    const erasedState = runCadCommand(initialState, { key: 'ERASE' });

    expect(erasedState.present.project.entities.some((entity) => pointIds.includes(entity.id))).toBe(false);
    expect(erasedState.undoStack).toHaveLength(1);
    expect(erasedState.commandState.prompt).toContain('ERASE committed');

    const undoneState = undoCadHistory(erasedState);
    expect(undoneState.present.project.entities.some((entity) => entity.id === pointIds[0])).toBe(true);
    expect(undoneState.redoStack).toHaveLength(1);
    expect(undoneState.commandState.prompt).toContain('Undo ERASE');

    const redoneState = redoCadHistory(undoneState);
    expect(redoneState.present.project.entities.some((entity) => entity.id === pointIds[0])).toBe(false);
    expect(redoneState.undoStack).toHaveLength(1);
    expect(redoneState.commandState.prompt).toContain('Redo ERASE');
  });

  it('tracks selection commands in deterministic project order', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const initialState = createCadHistoryState(project);
    const selectedState = runCadCommand(initialState, { key: 'SELECT_ALL' });

    expect(selectedState.present.selection.selectedEntityIds).toEqual(
      project.entities.map((entity) => entity.id),
    );

    const clearedState = runCadCommand(selectedState, { key: 'CLEAR_SELECTION' });
    expect(clearedState.present.selection.selectedEntityIds).toEqual([]);
    expect(clearedState.undoStack).toHaveLength(2);
  });

  it('adds manual point and line entities through command history and replays them via undo/redo', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const pointState = runCadCommand(createCadHistoryState(project), {
      key: 'POINT',
      x: 10,
      y: 20,
      label: 'CAD99',
    });
    expect(pointState.present.project.entities.some((entity) => entity.id === 'pt:CAD99')).toBe(true);
    expect(pointState.present.project.entities.some((entity) => entity.id === 'label:CAD99')).toBe(true);

    const lineState = runCadCommand(pointState, {
      key: 'LINE',
      start: { x: 0, y: 0, label: 'A' },
      end: { x: 10, y: 20, label: 'CAD99' },
    });
    expect(
      lineState.present.project.entities.some(
        (entity) => entity.type === 'line' && entity.fromStationId === 'A' && entity.toStationId === 'CAD99',
      ),
    ).toBe(true);

    const undoneLineState = undoCadHistory(lineState);
    expect(
      undoneLineState.present.project.entities.some(
        (entity) => entity.type === 'line' && entity.fromStationId === 'A' && entity.toStationId === 'CAD99',
      ),
    ).toBe(false);

    const redoneLineState = redoCadHistory(undoneLineState);
    expect(
      redoneLineState.present.project.entities.some(
        (entity) => entity.type === 'line' && entity.fromStationId === 'A' && entity.toStationId === 'CAD99',
      ),
    ).toBe(true);
  });

  it('adds plines and replays move/copy edits deterministically', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const plineState = runCadCommand(createCadHistoryState(project), {
      key: 'PLINE',
      vertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 20, y: 10, label: 'P1' },
        { x: 35, y: 15, label: 'P2' },
      ],
    });
    const polyline = plineState.present.project.entities.find((entity) => entity.type === 'polyline');
    expect(polyline?.type).toBe('polyline');
    if (polyline?.type !== 'polyline') throw new Error('Polyline not created');

    const movedState = runCadCommand(
      {
        ...plineState,
        present: {
          ...plineState.present,
          selection: {
            selectedEntityIds: [polyline.id],
          },
        },
      },
      {
        key: 'MOVE',
        deltaX: 5,
        deltaY: -2,
      },
    );
    const movedPolyline = movedState.present.project.entities.find((entity) => entity.id === polyline.id);
    expect(movedPolyline?.type).toBe('polyline');
    if (movedPolyline?.type !== 'polyline') throw new Error('Moved polyline missing');
    expect(movedPolyline.vertices[0]).toEqual({ x: 5, y: -2 });

    const copiedState = runCadCommand(movedState, {
      key: 'COPY',
      deltaX: 10,
      deltaY: 20,
    });
    const copiedPolyline = copiedState.present.project.entities.find(
      (entity) => entity.type === 'polyline' && entity.id !== polyline.id,
    );
    expect(copiedPolyline?.type).toBe('polyline');
    if (copiedPolyline?.type !== 'polyline') throw new Error('Copied polyline missing');
    expect(copiedPolyline.vertices[0]).toEqual({ x: 15, y: 18 });

    const undoneCopyState = undoCadHistory(copiedState);
    expect(
      undoneCopyState.present.project.entities.some(
        (entity) => entity.type === 'polyline' && entity.id === copiedPolyline.id,
      ),
    ).toBe(false);

    const redoneCopyState = redoCadHistory(undoneCopyState);
    expect(
      redoneCopyState.present.project.entities.some(
        (entity) => entity.type === 'polyline' && entity.id === copiedPolyline.id,
      ),
    ).toBe(true);
  });

  it('tracks cogo point creation and intersection point creation through history', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const cogoPointState = runCadCommand(createCadHistoryState(project), {
      key: 'COGO_POINT',
      x: 20,
      y: 20,
      basisLabel: 'A',
      directionLabel: 'N45-00-00E,28.284',
    });
    expect(cogoPointState.present.project.entities.some((entity) => entity.id === 'pt:CAD1')).toBe(true);
    expect(cogoPointState.commandState.prompt).toContain('COGO_POINT committed');
    expect(cogoPointState.present.project.cogoComputations).toHaveLength(1);
    expect(cogoPointState.present.project.cogoComputations[0]?.toolKey).toBe('COGO_POINT');
    const cogoPoint = cogoPointState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'CAD1',
    );
    expect(cogoPoint?.metadata?.cogo).toMatchObject({
      toolKey: 'COGO_POINT',
      sourcePointIds: ['A'],
    });

    const intersectionState = runCadCommand(cogoPointState, {
      key: 'INTERSECT_POINT',
      x: 60,
      y: 40,
      firstLabel: 'line:A-C',
      secondLabel: 'line:B-C',
    });
    expect(intersectionState.present.project.cogoComputations).toHaveLength(2);
    expect(intersectionState.present.project.cogoComputations[1]?.toolKey).toBe('INTERSECT_POINT');
    expect(
      intersectionState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'CAD2',
      ),
    ).toBe(true);

    const undoneState = undoCadHistory(intersectionState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'CAD2',
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'CAD2',
      ),
    ).toBe(true);
  });

  it('creates three-point and tangent-curve arc entities through history with undo/redo', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const arc3ptState = runCadCommand(createCadHistoryState(project), {
      key: 'ARC_3PT',
      start: { x: 5, y: 0, label: 'S' },
      through: { x: 0, y: 5, label: 'M' },
      end: { x: -5, y: 0, label: 'E' },
    });
    const threePointArc = arc3ptState.present.project.entities.find((entity) => entity.type === 'arc');
    expect(threePointArc?.type).toBe('arc');
    if (threePointArc?.type !== 'arc') throw new Error('Three-point arc missing');
    expect(threePointArc.centerX).toBeCloseTo(0, 6);
    expect(threePointArc.centerY).toBeCloseTo(0, 6);
    expect(threePointArc.radius).toBeCloseTo(5, 6);

    const tangentState = runCadCommand(arc3ptState, {
      key: 'TANGENT_CURVE',
      pi: { x: 0, y: 0, label: 'PI' },
      backTangentPoint: { x: -10, y: 0, label: 'BACK' },
      aheadTangentPoint: { x: 0, y: 10, label: 'AHEAD' },
      radius: 10,
    });
    const tangentArc = tangentState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.id !== threePointArc.id,
    );
    expect(tangentState.present.project.cogoComputations.map((entry) => entry.toolKey)).toEqual([
      'ARC_CREATE',
      'TANGENT_CURVE',
    ]);
    expect(tangentArc?.type).toBe('arc');
    if (tangentArc?.type !== 'arc') throw new Error('Tangent curve arc missing');
    expect(tangentArc.centerX).toBeCloseTo(-10, 6);
    expect(tangentArc.centerY).toBeCloseTo(10, 6);
    expect(tangentArc.radius).toBeCloseTo(10, 6);

    const undoneState = undoCadHistory(tangentState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'arc' && entity.id === tangentArc.id,
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'arc' && entity.id === tangentArc.id,
      ),
    ).toBe(true);
  });

  it('creates parcel entities with closure metrics from a selected traverse/polyline seam', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const traverseState = runCadCommand(createCadHistoryState(project), {
      key: 'TRAVERSE',
      vertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 25, y: 0, label: 'P1' },
        { x: 25, y: 15, label: 'P2' },
        { x: 0, y: 0, label: 'A' },
      ],
    });
    const traversePolyline = traverseState.present.project.entities.find(
      (entity) => entity.type === 'polyline',
    );
    expect(traversePolyline?.type).toBe('polyline');
    if (traversePolyline?.type !== 'polyline') throw new Error('Traverse polyline missing');

    const parcelState = runCadCommand(
      {
        ...traverseState,
        present: {
          ...traverseState.present,
          selection: {
            selectedEntityIds: [traversePolyline.id],
          },
        },
      },
      {
        key: 'PARCEL_CREATE',
        sourceEntityId: traversePolyline.id,
      },
    );
    const parcel = parcelState.present.project.entities.find((entity) => entity.type === 'parcel');
    expect(parcel?.type).toBe('parcel');
    if (parcel?.type !== 'parcel') throw new Error('Parcel missing');
    expect(parcelState.present.project.cogoComputations.map((entry) => entry.toolKey)).toEqual([
      'TRAVERSE',
      'PARCEL_CREATE',
    ]);
    expect(parcel.metadata?.cogo).toMatchObject({
      toolKey: 'PARCEL_CREATE',
      sourceEntityIds: [traversePolyline.id],
    });
    expect(parcel.areaSquareMeters).toBeCloseTo(187.5, 6);
    expect(parcel.perimeterMeters).toBeCloseTo(69.154759, 6);
    expect(parcel.closureDistanceMeters).toBeCloseTo(0, 6);

    const undoneParcelState = undoCadHistory(parcelState);
    expect(
      undoneParcelState.present.project.entities.some(
        (entity) => entity.type === 'parcel' && entity.id === parcel.id,
      ),
    ).toBe(false);

    const redoneParcelState = redoCadHistory(undoneParcelState);
    expect(
      redoneParcelState.present.project.entities.some(
        (entity) => entity.type === 'parcel' && entity.id === parcel.id,
      ),
    ).toBe(true);
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

  it('persists traverse adjustment provenance and metadata when an adjusted traverse commits', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const traverseState = runCadCommand(createCadHistoryState(project), {
      key: 'TRAVERSE',
      mode: 'closed',
      rawVertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 100, y: 0, label: 'B' },
        { x: 100, y: 98, label: 'C' },
      ],
      vertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 50, y: 0, label: 'B' },
        { x: 0, y: 0, label: 'C' },
      ],
      adjustment: {
        method: 'bowditch',
        targetLabel: 'A',
        rawClosureDistance: 140.0142849854971,
        adjustedClosureDistance: 0,
        rawClosureBearing: 'S45-34-27.69W',
        adjustedClosureBearing: null,
        angularCorrectionPerLegSec: null,
      },
    });

    const traversePolyline = traverseState.present.project.entities.find(
      (entity) => entity.type === 'polyline',
    );
    expect(traversePolyline?.type).toBe('polyline');
    if (traversePolyline?.type !== 'polyline') throw new Error('Traverse polyline missing');
    expect(traversePolyline.metadata?.traverseAdjustmentMethod).toBe('bowditch');

    const traverseComputation = traverseState.present.project.cogoComputations.at(-1);
    expect(traverseComputation?.report.rows.some((row) => row.label === 'Adjustment' && row.value === 'bowditch')).toBe(true);
    expect(traverseComputation?.provenance.inputs).toMatchObject({
      rawVertices: [
        { x: 0, y: 0, label: 'A' },
        { x: 100, y: 0, label: 'B' },
        { x: 100, y: 98, label: 'C' },
      ],
      adjustment: {
        method: 'bowditch',
      },
    });
  });

  it('trims a line between selected cutting edges and replays the split through undo/redo', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project = appendCadProjectEntities(baseProject, [
      {
        id: 'line:trim-target',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'T1',
        toStationId: 'T2',
        fromX: 10,
        fromY: 20,
        toX: 90,
        toY: 20,
        sourceObservationIds: [],
      },
    ]);

    const cuttingEdgeIds = project.entities
      .filter((entity) => entity.type === 'line' && entity.id !== 'line:trim-target')
      .map((entity) => entity.id);
    expect(cuttingEdgeIds).toContain('line:A|C');
    expect(cuttingEdgeIds).toContain('line:B|C');

    const trimmedState = runCadCommand(
      createCadHistoryState(project, cuttingEdgeIds),
      {
        key: 'TRIM',
        cuttingEntityIds: cuttingEdgeIds,
        targetEntityId: 'line:trim-target',
        pickPoint: { x: 50, y: 20 },
        targetSegmentId: 'line:trim-target#0',
      },
    );

    const remainingTrimPieces = trimmedState.present.project.entities.filter(
      (entity) => entity.type === 'line' && entity.fromY === 20 && entity.toY === 20,
    );
    expect(remainingTrimPieces).toHaveLength(2);
    expect(trimmedState.present.project.entities.some((entity) => entity.id === 'line:trim-target')).toBe(false);
    expect(
      remainingTrimPieces.some(
        (entity) =>
          entity.type === 'line' &&
          entity.fromX === 10 &&
          entity.toX === 30,
      ),
    ).toBe(true);
    expect(
      remainingTrimPieces.some(
        (entity) =>
          entity.type === 'line' &&
          entity.fromX === 80 &&
          entity.toX === 90,
      ),
    ).toBe(true);
    expect(trimmedState.commandState.prompt).toContain('TRIM committed');

    const undoneState = undoCadHistory(trimmedState);
    expect(
      undoneState.present.project.entities.some((entity) => entity.id === 'line:trim-target'),
    ).toBe(true);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some((entity) => entity.id === 'line:trim-target'),
    ).toBe(false);
    expect(
      redoneState.present.project.entities.filter(
        (entity) => entity.type === 'line' && entity.fromY === 20 && entity.toY === 20,
      ),
    ).toHaveLength(2);
  });
});
