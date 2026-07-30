
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
    expect(polyline.metadata?.entityName).toBe('PL1');
  });

  it('moves linked points with selected polyline-style geometry but not ordinary lines', () => {
    const project = appendCadProjectEntities(
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary: {},
        parseOptions,
        units: 'm',
        result: null,
      }),
      [
        {
          id: 'pt:P1',
          type: 'survey-point',
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'P1',
          x: 10,
          y: 10,
          pointClass: 'free',
          source: 'parsed-input',
        },
        {
          id: 'pt:P2',
          type: 'survey-point',
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'P2',
          x: 20,
          y: 10,
          pointClass: 'free',
          source: 'parsed-input',
        },
        {
          id: 'line:P1|P2',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'P1',
          toStationId: 'P2',
          fromX: 10,
          fromY: 10,
          toX: 20,
          toY: 10,
          sourceObservationIds: [],
        },
        {
          id: 'polyline:linked',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 30, y: 10 },
          ],
          vertexLabels: ['P1', 'P2', ''],
          closed: false,
        },
      ],
    );

    const movedPolylineState = runCadCommand(
      createCadHistoryState(project, ['polyline:linked']),
      {
        key: 'MOVE',
        deltaX: 5,
        deltaY: 3,
      },
    );
    const movedP1 = movedPolylineState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'P1',
    );
    const movedP2 = movedPolylineState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'P2',
    );
    expect(movedP1?.type).toBe('survey-point');
    expect(movedP2?.type).toBe('survey-point');
    expect(movedP1?.type === 'survey-point' ? movedP1.x : Number.NaN).toBeCloseTo(15, 6);
    expect(movedP1?.type === 'survey-point' ? movedP1.y : Number.NaN).toBeCloseTo(13, 6);
    expect(movedP2?.type === 'survey-point' ? movedP2.x : Number.NaN).toBeCloseTo(25, 6);
    expect(movedP2?.type === 'survey-point' ? movedP2.y : Number.NaN).toBeCloseTo(13, 6);

    const movedLineState = runCadCommand(
      createCadHistoryState(project, ['line:P1|P2']),
      {
        key: 'MOVE',
        deltaX: 5,
        deltaY: 3,
      },
    );
    const unmovedP1 = movedLineState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'P1',
    );
    const unmovedP2 = movedLineState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'P2',
    );
    expect(unmovedP1?.type === 'survey-point' ? unmovedP1.x : Number.NaN).toBeCloseTo(10, 6);
    expect(unmovedP1?.type === 'survey-point' ? unmovedP1.y : Number.NaN).toBeCloseTo(10, 6);
    expect(unmovedP2?.type === 'survey-point' ? unmovedP2.x : Number.NaN).toBeCloseTo(20, 6);
    expect(unmovedP2?.type === 'survey-point' ? unmovedP2.y : Number.NaN).toBeCloseTo(10, 6);
  });

});
