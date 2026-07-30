
import { describe, expect, it } from 'vitest';
import {
  cadDraftBatchCogo,
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

  it('keeps traverse-created unnamed points on simple CAD labels', () => {
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
        { x: 0, y: 0, label: 'CAD1' },
        { x: 25, y: 0, label: 'CAD2' },
        { x: 25, y: 15, label: 'CAD3' },
      ],
      rawVertices: [
        { x: 0, y: 0, label: 'CAD1' },
        { x: 25, y: 0, label: 'CAD2' },
        { x: 25, y: 15, label: 'CAD3' },
      ],
    });

    const traversePolyline = traverseState.present.project.entities.find(
      (entity) => entity.type === 'polyline' && entity.vertexLabels.join(',') === 'CAD1,CAD2,CAD3',
    );
    expect(traversePolyline?.type).toBe('polyline');
    expect(
      traverseState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'CAD1',
      ),
    ).toBe(true);
    expect(
      traverseState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'CAD2',
      ),
    ).toBe(true);
    expect(
      traverseState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'CAD3',
      ),
    ).toBe(true);
  });

  it('commits batch deed cogo rows with persisted provenance and undo/redo support', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const draft = cadDraftBatchCogo({
      sourceText: ['START POB=1000,1000', 'P1=N45-00-00E,100', 'CURVE RIGHT R 50 DELTA 30'].join('\n'),
    });
    expect(draft.canCommit).toBe(true);

    const batchState = runCadCommand(createCadHistoryState(project), {
      key: 'BATCH_COGO',
      draft,
    });

    const batchComputation = batchState.present.project.cogoComputations.at(-1);
    expect(batchComputation?.toolKey).toBe('BATCH_COGO');
    expect(batchComputation?.report.rows.some((row) => row.label === 'Arcs' && row.value === '1')).toBe(true);
    expect(batchComputation?.provenance.inputs).toMatchObject({
      sourceText: draft.sourceText,
      startPointSource: 'input',
    });
    expect(
      batchState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'POB',
      ),
    ).toBe(true);
    expect(
      batchState.present.project.entities.some((entity) => entity.type === 'line'),
    ).toBe(true);
    expect(
      batchState.present.project.entities.some((entity) => entity.type === 'arc'),
    ).toBe(true);
    expect(
      batchState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'BC1',
      ),
    ).toBe(true);
    expect(
      batchState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'R1',
      ),
    ).toBe(true);

    const undoneState = undoCadHistory(batchState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'POB',
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'POB',
      ),
    ).toBe(true);
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

  it('extends linework to the picked boundary when EXTEND runs as its own command', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project = appendCadProjectEntities(baseProject, [
      {
        id: 'line:extend-cutter',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'EC1',
        toStationId: 'EC2',
        fromX: 30,
        fromY: -10,
        toX: 30,
        toY: 20,
        sourceObservationIds: [],
      },
      {
        id: 'line:extend-target',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'ET1',
        toStationId: 'ET2',
        fromX: 0,
        fromY: 0,
        toX: 20,
        toY: 0,
        sourceObservationIds: [],
      },
    ]);

    const extendedState = runCadCommand(createCadHistoryState(project), {
      key: 'EXTEND',
      boundaryEntityIds: ['line:extend-cutter'],
      targetEntityId: 'line:extend-target',
      targetPickPoint: { x: 19, y: 0 },
      targetSegmentId: 'line:extend-target#0',
    });

    const extendedLine = extendedState.present.project.entities.find(
      (entity) => entity.id === 'line:extend-target',
    );
    expect(extendedLine?.type).toBe('line');
    if (extendedLine?.type !== 'line') throw new Error('Extended line missing');
    expect(extendedLine.toX).toBeCloseTo(30, 6);
    expect(extendedLine.toY).toBeCloseTo(0, 6);
    expect(extendedState.commandState.prompt).toContain('EXTEND committed');
  });

});
