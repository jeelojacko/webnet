import { describe, expect, it } from 'vitest';
import { cadDraftBatchCogo } from '../src/engine/cad/cadBatchCogo';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildCadExtendPreview } from '../src/engine/cad/cadTransactions';
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

  it('copies linked polyline vertex points and remaps the copied labels', () => {
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
          metadata: {
            entityName: 'PL1',
          },
        },
      ],
    );

    const copiedState = runCadCommand(
      createCadHistoryState(project, ['polyline:linked']),
      {
        key: 'COPY',
        deltaX: 40,
        deltaY: 5,
      },
    );
    const copiedPolyline = copiedState.present.project.entities.find(
      (entity) => entity.type === 'polyline' && entity.id !== 'polyline:linked',
    );
    expect(copiedPolyline?.type).toBe('polyline');
    if (copiedPolyline?.type !== 'polyline') throw new Error('Copied polyline missing');
    expect(copiedPolyline.vertices[0]).toEqual({ x: 50, y: 15 });
    expect(copiedPolyline.vertexLabels[0]).not.toBe('P1');
    expect(copiedPolyline.vertexLabels[1]).not.toBe('P2');
    expect(
      copiedState.present.project.entities.some(
        (entity) =>
          entity.type === 'survey-point' &&
          entity.stationId === copiedPolyline.vertexLabels[0] &&
          Math.abs(entity.x - 50) <= 1e-9 &&
          Math.abs(entity.y - 15) <= 1e-9,
      ),
    ).toBe(true);
    expect(
      copiedState.present.project.entities.some(
        (entity) =>
          entity.type === 'survey-point' &&
          entity.stationId === copiedPolyline.vertexLabels[1] &&
          Math.abs(entity.x - 60) <= 1e-9 &&
          Math.abs(entity.y - 15) <= 1e-9,
      ),
    ).toBe(true);
  });

  it('copies arc support points with the copied curve and keeps them anchored to the new arc', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const arcState = runCadCommand(createCadHistoryState(project), {
      key: 'ARC_3PT',
      start: { x: 5, y: 0, label: 'S' },
      through: { x: 0, y: 5, label: 'M' },
      end: { x: -5, y: 0, label: 'E' },
    });
    const sourceArc = arcState.present.project.entities.find((entity) => entity.type === 'arc');
    expect(sourceArc?.type).toBe('arc');
    if (sourceArc?.type !== 'arc') throw new Error('Arc missing');

    const copiedState = runCadCommand(
      createCadHistoryState(arcState.present.project, [sourceArc.id]),
      {
        key: 'COPY',
        deltaX: 20,
        deltaY: 10,
      },
    );
    const copiedArc = copiedState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.id !== sourceArc.id,
    );
    expect(copiedArc?.type).toBe('arc');
    if (copiedArc?.type !== 'arc') throw new Error('Copied arc missing');
    const copiedSupportPoints = copiedState.present.project.entities.filter(
      (entity): entity is Extract<(typeof copiedState.present.project.entities)[number], { type: 'survey-point' }> =>
        entity.type === 'survey-point' &&
        entity.metadata != null &&
        typeof entity.metadata === 'object' &&
        entity.metadata.anchorCurveEntityId === copiedArc.id,
    );
    expect(copiedSupportPoints).toHaveLength(4);
    expect(copiedSupportPoints.map((entity) => entity.stationId).sort()).toEqual(['BC2', 'EC2', 'MP2', 'R2']);

    const movedCopiedArcState = runCadCommand(copiedState, {
      key: 'GRIP_EDIT',
      entityId: copiedArc.id,
      gripKind: 'arc-radius',
      x: 20,
      y: 18,
    });
    const copiedRadiusPoint = movedCopiedArcState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'R2',
    );
    expect(copiedRadiusPoint?.type).toBe('survey-point');
    expect(copiedRadiusPoint?.type === 'survey-point' ? copiedRadiusPoint.x : Number.NaN).toBeCloseTo(20, 6);
    expect(copiedRadiusPoint?.type === 'survey-point' ? copiedRadiusPoint.y : Number.NaN).toBeCloseTo(10, 6);
  });

  it('edits point names and coordinates through command history with linked geometry updates', () => {
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
          id: 'label:C',
          type: 'text',
          layerId: 'point-labels',
          styleId: 'style-point-label',
          visible: true,
          locked: false,
          text: 'C',
          x: 60,
          y: 40,
          anchorEntityId: 'pt:C',
          metadata: {
            stationId: 'C',
          },
        },
      ],
    );

    const renamedState = runCadCommand(createCadHistoryState(project), {
      key: 'EDIT_ENTITY',
      entityId: 'pt:C',
      edit: {
        kind: 'entity-name',
        value: 'CP1',
      },
    });
    const renamedPoint = renamedState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.id === 'pt:C',
    );
    const renamedLine = renamedState.present.project.entities.find(
      (entity) => entity.type === 'line' && entity.id === 'line:A|C',
    );
    const renamedLabel = renamedState.present.project.entities.find((entity) => entity.id === 'label:C');
    expect(renamedPoint?.type).toBe('survey-point');
    expect(renamedPoint?.type === 'survey-point' ? renamedPoint.stationId : null).toBe('CP1');
    expect(renamedLine?.type === 'line' ? renamedLine.toStationId : null).toBe('CP1');
    expect(renamedLabel?.type === 'text' ? renamedLabel.text : null).toBe('CP1');

    const movedState = runCadCommand(renamedState, {
      key: 'EDIT_ENTITY',
      entityId: 'pt:C',
      edit: {
        kind: 'point-x',
        value: 75,
      },
    });
    const movedPoint = movedState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.id === 'pt:C',
    );
    const movedLine = movedState.present.project.entities.find(
      (entity) => entity.type === 'line' && entity.id === 'line:A|C',
    );
    const movedLabel = movedState.present.project.entities.find((entity) => entity.id === 'label:C');
    expect(movedPoint?.type === 'survey-point' ? movedPoint.x : Number.NaN).toBe(75);
    expect(movedLine?.type === 'line' ? movedLine.toX : Number.NaN).toBe(75);
    expect(movedLabel?.type === 'text' ? movedLabel.x : Number.NaN).toBe(75);
  });

  it('edits line and polyline geometry through command history', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const lineState = runCadCommand(createCadHistoryState(project), {
      key: 'EDIT_ENTITY',
      entityId: 'line:A|C',
      edit: {
        kind: 'line-end',
        toX: 80,
        toY: 40,
      },
    });
    const editedLine = lineState.present.project.entities.find((entity) => entity.id === 'line:A|C');
    const editedPoint = lineState.present.project.entities.find((entity) => entity.id === 'pt:C');
    expect(editedLine?.type === 'line' ? editedLine.toX : Number.NaN).toBe(80);
    expect(editedPoint?.type === 'survey-point' ? editedPoint.x : Number.NaN).toBe(80);

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

    const editedPolylineState = runCadCommand(plineState, {
      key: 'EDIT_ENTITY',
      entityId: polyline.id,
      edit: {
        kind: 'polyline-vertex',
        vertexIndex: 1,
        x: 25,
        y: 12,
      },
    });
    const editedPolyline = editedPolylineState.present.project.entities.find((entity) => entity.id === polyline.id);
    expect(editedPolyline?.type).toBe('polyline');
    expect(editedPolyline?.type === 'polyline' ? editedPolyline.vertices[1] : null).toEqual({
      x: 25,
      y: 12,
    });
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

  it('creates alignments from selected line and arc chains and replays them via undo/redo', () => {
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
          id: 'arc:alignment-test',
          type: 'arc',
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 60,
          centerY: 60,
          radius: 20,
          startAngleDeg: -90,
          endAngleDeg: 0,
        },
      ],
    );

    const alignmentState = runCadCommand(
      createCadHistoryState(project),
      {
        key: 'ALIGNMENT_CREATE',
        sourceEntityIds: ['line:A|C', 'arc:alignment-test'],
      },
    );
    const alignment = alignmentState.present.project.entities.find((entity) => entity.type === 'alignment');
    expect(alignment?.type).toBe('alignment');
    expect(alignmentState.commandState.prompt).toContain('ALIGNMENT_CREATE committed');
    expect(alignmentState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT');
    expect(alignment?.metadata?.cogo).toMatchObject({
      toolKey: 'ALIGNMENT',
      sourceEntityIds: ['line:A|C', 'arc:alignment-test'],
    });

    const undoneState = undoCadHistory(alignmentState);
    expect(undoneState.present.project.entities.some((entity) => entity.type === 'alignment')).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(redoneState.present.project.entities.some((entity) => entity.type === 'alignment')).toBe(true);
  });

  it('persists alignment station reports for selected alignment and point geometry', () => {
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
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 60, y: 40 },
            },
          ],
        },
      ],
    );

    const reportState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_STATION_REPORT',
      alignmentEntityId: 'alignment:test',
      pointEntityId: 'pt:C',
    });
    expect(reportState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_STATION');
    expect(reportState.present.project.cogoComputations.at(-1)?.report.title).toBe('Alignment Station');
    expect(
      reportState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Station')?.value,
    ).toBe('1+72.111');

    const undoneState = undoCadHistory(reportState);
    expect(undoneState.present.project.cogoComputations.some((entry) => entry.toolKey === 'ALIGNMENT_STATION')).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(redoneState.present.project.cogoComputations.some((entry) => entry.toolKey === 'ALIGNMENT_STATION')).toBe(true);
  });

  it('creates alignment station-offset points through history with persisted provenance', () => {
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
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 60, y: 40 },
            },
          ],
        },
      ],
    );

    const pointState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_OFFSET_POINT',
      alignmentEntityId: 'alignment:test',
      station: 110,
      offset: 5,
      label: 'SO1',
    });
    const pointEntity = pointState.present.project.entities.find(
      (entity): entity is Extract<(typeof pointState.present.project.entities)[number], { type: 'survey-point' }> =>
        entity.type === 'survey-point' && entity.stationId === 'SO1',
    );
    expect(pointEntity?.type).toBe('survey-point');
    expect(pointEntity?.x ?? Number.NaN).toBeCloseTo(5.54700196, 6);
    expect(pointEntity?.y ?? Number.NaN).toBeCloseTo(9.70725343, 6);
    expect(pointState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_POINT');
    expect(pointState.present.project.cogoComputations.at(-1)?.report.title).toBe(
      'Alignment Station Offset Point',
    );
    expect(
      pointState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Station')?.value,
    ).toBe('1+10.000');

    const undoneState = undoCadHistory(pointState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SO1',
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SO1',
      ),
    ).toBe(true);
  });

  it('adds alignment station equations through history and applies them to later station input', () => {
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
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 60, y: 40 },
            },
          ],
        },
      ],
    );

    const equationState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_STATION_EQUATION',
      alignmentEntityId: 'alignment:test',
      backStation: 110,
      aheadStation: 120,
    });
    const alignmentEntity = equationState.present.project.entities.find(
      (entity): entity is Extract<(typeof equationState.present.project.entities)[number], { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === 'alignment:test',
    );
    expect(alignmentEntity?.stationEquations).toEqual([
      { backStation: 110, aheadStation: 120, rawStation: 110 },
    ]);
    expect(equationState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_STATION_EQUATION');
    expect(equationState.present.project.cogoComputations.at(-1)?.report.title).toBe('Alignment Station Equation');
    expect(
      equationState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Back station')?.value,
    ).toBe('1+10.000');
    expect(
      equationState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Ahead station')?.value,
    ).toBe('1+20.000');

    const pointState = runCadCommand(equationState, {
      key: 'ALIGNMENT_OFFSET_POINT',
      alignmentEntityId: 'alignment:test',
      station: 125,
      offset: 0,
      label: 'SEQ1',
    });
    const pointEntity = pointState.present.project.entities.find(
      (entity): entity is Extract<(typeof pointState.present.project.entities)[number], { type: 'survey-point' }> =>
        entity.type === 'survey-point' && entity.stationId === 'SEQ1',
    );
    expect(pointEntity?.x ?? Number.NaN).toBeCloseTo(12.48075442, 6);
    expect(pointEntity?.y ?? Number.NaN).toBeCloseTo(8.32050294, 6);

    const undoneState = undoCadHistory(pointState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SEQ1',
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'SEQ1',
      ),
    ).toBe(true);
  });

  it('creates offset alignments through history with persisted provenance', () => {
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
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 100, y: 0 },
            },
            {
              kind: 'arc',
              center: { x: 100, y: 50 },
              radius: 50,
              startAngleDeg: -90,
              endAngleDeg: 0,
            },
          ],
        },
      ],
    );

    const offsetState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_OFFSET_CREATE',
      alignmentEntityId: 'alignment:test',
      offset: 10,
    });
    const offsetAlignment = offsetState.present.project.entities.find(
      (entity): entity is Extract<(typeof offsetState.present.project.entities)[number], { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id !== 'alignment:test',
    );
    expect(offsetAlignment?.name).toBe('ALIGN2');
    expect(offsetAlignment?.startStation).toBe(100);
    expect(offsetAlignment?.stationEquations).toEqual([
      { backStation: 110, aheadStation: 120, rawStation: 110 },
    ]);
    expect(offsetAlignment?.elements).toHaveLength(2);
    expect(offsetAlignment?.elements[0]).toEqual({
      kind: 'line',
      start: { x: 0, y: 10 },
      end: { x: 100, y: 10 },
      sourceEntityId: undefined,
    });
    expect(offsetState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_OFFSET');
    expect(offsetState.present.project.cogoComputations.at(-1)?.report.title).toBe('Offset Alignment');
    expect(
      offsetState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'End station')?.value,
    ).toBe('2+72.832');

    const undoneState = undoCadHistory(offsetState);
    expect(
      undoneState.present.project.entities.filter((entity) => entity.type === 'alignment'),
    ).toHaveLength(1);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.filter((entity) => entity.type === 'alignment'),
    ).toHaveLength(2);
  });

  it('creates alignment interval points through history with persisted provenance', () => {
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
              kind: 'line',
              start: { x: 0, y: 0 },
              end: { x: 60, y: 40 },
            },
          ],
        },
      ],
    );

    const pointState = runCadCommand(createCadHistoryState(project), {
      key: 'ALIGNMENT_INTERVAL_POINTS',
      alignmentEntityId: 'alignment:test',
      startStation: 100,
      endStation: 130,
      interval: 10,
      labelPrefix: 'INT',
    });
    expect(
      pointState.present.project.entities.filter(
        (entity) => entity.type === 'survey-point' && /^INT\d+$/.test(entity.stationId),
      ),
    ).toHaveLength(4);
    expect(pointState.present.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_INTERVALS');
    expect(pointState.present.project.cogoComputations.at(-1)?.report.title).toBe('Alignment Interval Points');
    expect(
      pointState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'Start station')?.value,
    ).toBe('1+00.000');
    expect(
      pointState.present.project.cogoComputations.at(-1)?.report.rows.find((row) => row.label === 'End station')?.value,
    ).toBe('1+30.000');

    const undoneState = undoCadHistory(pointState);
    expect(
      undoneState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && /^INT\d+$/.test(entity.stationId),
      ),
    ).toBe(false);

    const redoneState = redoCadHistory(undoneState);
    expect(
      redoneState.present.project.entities.filter(
        (entity) => entity.type === 'survey-point' && /^INT\d+$/.test(entity.stationId),
      ),
    ).toHaveLength(4);
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
    expect(threePointArc.metadata?.entityName).toBe('CURVE1');
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'BC1',
      ),
    ).toBe(true);
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'MP1',
      ),
    ).toBe(true);
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'EC1',
      ),
    ).toBe(true);
    expect(
      arc3ptState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'R1',
      ),
    ).toBe(true);
    expect(arc3ptState.present.project.cogoComputations[0]?.report.summary).toBe(
      'Created CURVE1 with BC1, MP1, EC1, R1',
    );
    expect(arc3ptState.present.project.cogoComputations[0]?.provenance.sourcePointIds).toEqual([
      'BC1',
      'MP1',
      'EC1',
      'R1',
    ]);

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
    expect(tangentState.present.project.cogoComputations[1]?.report.summary).toBe(
      'Created CURVE2 tangent curve with BC2, MP2, EC2, R2',
    );
    expect(tangentArc?.type).toBe('arc');
    if (tangentArc?.type !== 'arc') throw new Error('Tangent curve arc missing');
    expect(tangentArc.centerX).toBeCloseTo(-10, 6);
    expect(tangentArc.centerY).toBeCloseTo(10, 6);
    expect(tangentArc.radius).toBeCloseTo(10, 6);
    expect(tangentArc.metadata?.entityName).toBe('CURVE2');
    expect(
      tangentState.present.project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === 'R2',
      ),
    ).toBe(true);

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

  it('builds an extend preview for EXTEND when the picked target can reach the boundary', () => {
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

    const preview = buildCadExtendPreview(
      project,
      'line:extend-cutter',
      'line:extend-target',
      { x: 19, y: 0 },
      'line:extend-target#0',
    );
    expect(preview?.previewEntities).toHaveLength(1);
    const previewLine = preview?.previewEntities[0];
    expect(previewLine?.type).toBe('line');
    if (previewLine?.type !== 'line') throw new Error('Extend preview line missing');
    expect(previewLine.toX).toBeCloseTo(30, 6);
    expect(previewLine.toY).toBeCloseTo(0, 6);
  });

  it('creates a radius fillet between two clicked lines and keeps arc support points with the new curve', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project = appendCadProjectEntities(baseProject, [
      {
        id: 'line:fillet-a',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'FA',
        toStationId: 'FB',
        fromX: 0,
        fromY: 0,
        toX: 10,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:fillet-b',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'FC',
        toStationId: 'FD',
        fromX: 0,
        fromY: 0,
        toX: 0,
        toY: 10,
        sourceObservationIds: [],
      },
    ]);

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'line:fillet-a',
      firstPickPoint: { x: 1, y: 0 },
      secondEntityId: 'line:fillet-b',
      secondPickPoint: { x: 0, y: 1 },
    });

    const firstLine = filletState.present.project.entities.find((entity) => entity.id === 'line:fillet-a');
    const secondLine = filletState.present.project.entities.find((entity) => entity.id === 'line:fillet-b');
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(firstLine?.type).toBe('line');
    expect(secondLine?.type).toBe('line');
    expect(filletArc?.type).toBe('arc');
    if (firstLine?.type !== 'line' || secondLine?.type !== 'line' || filletArc?.type !== 'arc') {
      throw new Error('Fillet entities missing');
    }
    expect(firstLine.fromX).toBeCloseTo(2, 6);
    expect(firstLine.fromY).toBeCloseTo(0, 6);
    expect(secondLine.fromX).toBeCloseTo(0, 6);
    expect(secondLine.fromY).toBeCloseTo(2, 6);
    expect(filletArc.centerX).toBeCloseTo(2, 6);
    expect(filletArc.centerY).toBeCloseTo(2, 6);
    expect(filletArc.radius).toBeCloseTo(2, 6);
    expect(
      filletState.present.project.entities.filter(
        (entity) =>
          entity.type === 'survey-point' &&
          entity.metadata != null &&
          typeof entity.metadata === 'object' &&
          entity.metadata.anchorCurveEntityId === filletArc.id,
      ),
    ).toHaveLength(4);

    const undoneState = undoCadHistory(filletState);
    expect(undoneState.present.project.entities.some((entity) => entity.id === filletArc.id)).toBe(false);
    expect(
      undoneState.present.project.entities.find((entity) => entity.id === 'line:fillet-a' && entity.type === 'line'),
    ).toMatchObject({ fromX: 0, fromY: 0, toX: 10, toY: 0 });

    const redoneState = redoCadHistory(undoneState);
    expect(redoneState.present.project.entities.some((entity) => entity.id === filletArc.id)).toBe(true);
  });

  it('creates a fillet between a picked polyline segment and a line', () => {
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
          id: 'polyline:fillet-source',
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
          vertexLabels: ['P1', 'P2', 'P3'],
          closed: false,
        },
        {
          id: 'line:fillet-poly-boundary',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'PLA',
          toStationId: 'PLB',
          fromX: 0,
          fromY: 0,
          toX: 0,
          toY: 10,
          sourceObservationIds: [],
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'polyline:fillet-source',
      firstPickPoint: { x: 1, y: 0 },
      firstSegmentId: 'polyline:fillet-source#0',
      secondEntityId: 'line:fillet-poly-boundary',
      secondPickPoint: { x: 0, y: 1 },
    });

    const updatedPolyline = filletState.present.project.entities.find(
      (entity) => entity.id === 'polyline:fillet-source',
    );
    const boundaryLine = filletState.present.project.entities.find(
      (entity) => entity.id === 'line:fillet-poly-boundary',
    );
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedPolyline?.type).toBe('polyline');
    expect(boundaryLine?.type).toBe('line');
    expect(filletArc?.type).toBe('arc');
    if (updatedPolyline?.type !== 'polyline' || boundaryLine?.type !== 'line' || filletArc?.type !== 'arc') {
      throw new Error('Polyline fillet entities missing');
    }
    expect(updatedPolyline.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(updatedPolyline.vertices[1]).toEqual({ x: 2, y: 0 });
    expect(boundaryLine.fromX).toBeCloseTo(0, 6);
    expect(boundaryLine.toY).toBeCloseTo(2, 6);
    expect(filletArc.radius).toBeCloseTo(2, 6);
  });

  it('creates a fillet between a line and an arc while keeping the clicked line ray', () => {
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
          id: 'line:fillet-line-arc',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'LA1',
          toStationId: 'LA2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'arc:fillet-target',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 20,
          centerY: 0,
          radius: 10,
          startAngleDeg: 180,
          endAngleDeg: 90,
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'line:fillet-line-arc',
      firstPickPoint: { x: 9, y: 0 },
      secondEntityId: 'arc:fillet-target',
      secondPickPoint: { x: 10.5, y: 1 },
    });

    const updatedLine = filletState.present.project.entities.find((entity) => entity.id === 'line:fillet-line-arc');
    const updatedArc = filletState.present.project.entities.find((entity) => entity.id === 'arc:fillet-target');
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedLine?.type).toBe('line');
    expect(updatedArc?.type).toBe('arc');
    expect(filletArc?.type).toBe('arc');
    if (updatedLine?.type !== 'line' || updatedArc?.type !== 'arc' || filletArc?.type !== 'arc') {
      throw new Error('Line-arc fillet entities missing');
    }
    expect(updatedLine.fromX).toBeGreaterThan(7);
    expect(updatedLine.fromX).toBeLessThan(10);
    expect(updatedLine.toX).toBeCloseTo(10, 6);
    expect(updatedArc.startAngleDeg).toBeGreaterThan(160);
    expect(updatedArc.startAngleDeg).toBeLessThan(180);
    expect(filletState.present.project.entities.filter(
      (entity) =>
        entity.type === 'survey-point' &&
        entity.metadata != null &&
        typeof entity.metadata === 'object' &&
        entity.metadata.anchorCurveEntityId === filletArc.id,
    )).toHaveLength(4);
  });

  it('inserts a tangent vertex instead of dragging the neighboring polyline segment', () => {
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
          id: 'polyline:fillet-shared-corner',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: 0, y: -10 },
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          vertexLabels: ['P1', 'P2', 'P3'],
          closed: false,
        },
        {
          id: 'line:fillet-shared-corner-target',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'SC1',
          toStationId: 'SC2',
          fromX: 0,
          fromY: 0,
          toX: -10,
          toY: 10,
          sourceObservationIds: [],
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'polyline:fillet-shared-corner',
      firstSegmentId: 'polyline:fillet-shared-corner#1',
      firstPickPoint: { x: 4, y: 4 },
      secondEntityId: 'line:fillet-shared-corner-target',
      secondPickPoint: { x: -2, y: 2 },
    });

    const updatedPolyline = filletState.present.project.entities.find(
      (entity) => entity.id === 'polyline:fillet-shared-corner',
    );
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedPolyline?.type).toBe('polyline');
    expect(filletArc?.type).toBe('arc');
    if (updatedPolyline?.type !== 'polyline' || filletArc?.type !== 'arc') {
      throw new Error('Shared-corner polyline fillet entities missing');
    }
    expect(updatedPolyline.vertices).toHaveLength(4);
    expect(updatedPolyline.vertices[0]).toEqual({ x: 0, y: -10 });
    expect(updatedPolyline.vertices[1]).toEqual({ x: 0, y: 0 });
    expect(updatedPolyline.vertices[2].x).toBeGreaterThan(0);
    expect(updatedPolyline.vertices[2].y).toBeGreaterThan(0);
    expect(updatedPolyline.vertices[3]).toEqual({ x: 10, y: 10 });
    expect(filletArc.radius).toBeCloseTo(2, 6);
  });

  it('keeps the hovered side of a reversed line when filleting against an arc', () => {
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
          id: 'line:fillet-reversed-line-arc',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'RL2',
          toStationId: 'RL1',
          fromX: 30,
          fromY: 0,
          toX: -30,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'arc:fillet-reversed-target',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 20,
          centerY: 0,
          radius: 10,
          startAngleDeg: 180,
          endAngleDeg: 90,
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'line:fillet-reversed-line-arc',
      firstPickPoint: { x: 18, y: 0 },
      secondEntityId: 'arc:fillet-reversed-target',
      secondPickPoint: { x: 10.5, y: 1 },
    });

    const updatedLine = filletState.present.project.entities.find(
      (entity) => entity.id === 'line:fillet-reversed-line-arc',
    );
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedLine?.type).toBe('line');
    expect(filletArc?.type).toBe('arc');
    if (updatedLine?.type !== 'line' || filletArc?.type !== 'arc') {
      throw new Error('Reversed line-arc fillet entities missing');
    }
    expect(updatedLine.fromX).toBeCloseTo(30, 6);
    expect(updatedLine.toX).toBeGreaterThan(10);
    expect(updatedLine.toX).toBeLessThan(30);
  });

  it('keeps the hovered interior arc branch when filleting a line against a larger arc', () => {
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
          id: 'line:fillet-large-arc-line',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'LAL1',
          toStationId: 'LAL2',
          fromX: -40,
          fromY: 40,
          toX: 60,
          toY: -60,
          sourceObservationIds: [],
        },
        {
          id: 'arc:fillet-large-arc-target',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 35,
          startAngleDeg: 220,
          endAngleDeg: 20,
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 5,
      firstEntityId: 'line:fillet-large-arc-line',
      firstPickPoint: { x: -18, y: 18 },
      secondEntityId: 'arc:fillet-large-arc-target',
      secondPickPoint: { x: 0, y: 35 },
    });

    const updatedArc = filletState.present.project.entities.find(
      (entity) => entity.id === 'arc:fillet-large-arc-target',
    );
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedArc?.type).toBe('arc');
    expect(filletArc?.type).toBe('arc');
    if (updatedArc?.type !== 'arc' || filletArc?.type !== 'arc') {
      throw new Error('Large arc fillet entities missing');
    }
    expect(updatedArc.endAngleDeg).toBeCloseTo(20, 6);
    expect(updatedArc.startAngleDeg).toBeGreaterThan(220);
    expect(updatedArc.startAngleDeg).toBeLessThan(360);
  });

  it('rejects alternate acute line-line branches and keeps the picked corner rays only', () => {
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
          id: 'line:acute-upper',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'AU1',
          toStationId: 'AU2',
          fromX: 0,
          fromY: 20,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:acute-lower',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'AL1',
          toStationId: 'AL2',
          fromX: 10,
          fromY: 0,
          toX: 0,
          toY: -20,
          sourceObservationIds: [],
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'line:acute-upper',
      firstPickPoint: { x: 3, y: 14 },
      secondEntityId: 'line:acute-lower',
      secondPickPoint: { x: 3, y: -14 },
    });

    const updatedUpper = filletState.present.project.entities.find((entity) => entity.id === 'line:acute-upper');
    const updatedLower = filletState.present.project.entities.find((entity) => entity.id === 'line:acute-lower');
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedUpper?.type).toBe('line');
    expect(updatedLower?.type).toBe('line');
    expect(filletArc?.type).toBe('arc');
    if (updatedUpper?.type !== 'line' || updatedLower?.type !== 'line' || filletArc?.type !== 'arc') {
      throw new Error('Acute line-line fillet entities missing');
    }
    expect(updatedUpper.fromX).toBeCloseTo(0, 6);
    expect(updatedUpper.fromY).toBeCloseTo(20, 6);
    expect(updatedUpper.toY).toBeGreaterThan(0);
    expect(updatedLower.toX).toBeCloseTo(0, 6);
    expect(updatedLower.toY).toBeCloseTo(-20, 6);
    expect(updatedLower.fromY).toBeLessThan(0);
  });

  it('keeps the hovered survivor rays when filleting crossing lines away from both endpoints', () => {
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
          id: 'line:crossing-diagonal',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'XD1',
          toStationId: 'XD2',
          fromX: 0,
          fromY: 0,
          toX: 20,
          toY: 20,
          sourceObservationIds: [],
        },
        {
          id: 'line:crossing-horizontal',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'XH1',
          toStationId: 'XH2',
          fromX: -10,
          fromY: 10,
          toX: 30,
          toY: 10,
          sourceObservationIds: [],
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'line:crossing-diagonal',
      firstPickPoint: { x: 13, y: 13 },
      secondEntityId: 'line:crossing-horizontal',
      secondPickPoint: { x: 15, y: 10 },
    });

    const updatedDiagonal = filletState.present.project.entities.find(
      (entity) => entity.id === 'line:crossing-diagonal',
    );
    const updatedHorizontal = filletState.present.project.entities.find(
      (entity) => entity.id === 'line:crossing-horizontal',
    );
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedDiagonal?.type).toBe('line');
    expect(updatedHorizontal?.type).toBe('line');
    expect(filletArc?.type).toBe('arc');
    if (updatedDiagonal?.type !== 'line' || updatedHorizontal?.type !== 'line' || filletArc?.type !== 'arc') {
      throw new Error('Crossing line fillet entities missing');
    }
    expect(updatedDiagonal.toX).toBeCloseTo(20, 6);
    expect(updatedDiagonal.toY).toBeCloseTo(20, 6);
    expect(updatedDiagonal.fromX).toBeGreaterThan(10);
    expect(updatedDiagonal.fromY).toBeGreaterThan(10);
    expect(updatedHorizontal.toX).toBeCloseTo(30, 6);
    expect(updatedHorizontal.fromX).toBeGreaterThan(10);
    expect(filletArc.radius).toBeCloseTo(2, 6);
  });

  it('allows FILLET radius 0 and resolves both lines to a hard intersection without creating an arc', () => {
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
          id: 'line:corner-a',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'CA1',
          toStationId: 'CA2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:corner-b',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'CB1',
          toStationId: 'CB2',
          fromX: 0,
          fromY: 0,
          toX: 0,
          toY: 10,
          sourceObservationIds: [],
        },
      ],
    );

    const cornerState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 0,
      firstEntityId: 'line:corner-a',
      firstPickPoint: { x: 1, y: 0 },
      secondEntityId: 'line:corner-b',
      secondPickPoint: { x: 0, y: 1 },
    });

    expect(
      cornerState.present.project.entities.some(
        (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
      ),
    ).toBe(false);
    expect(
      cornerState.present.project.entities.find((entity) => entity.id === 'line:corner-a' && entity.type === 'line'),
    ).toMatchObject({ fromX: 0, fromY: 0 });
    expect(
      cornerState.present.project.entities.find((entity) => entity.id === 'line:corner-b' && entity.type === 'line'),
    ).toMatchObject({ fromX: 0, fromY: 0 });
    expect(cornerState.commandState.prompt).toContain('hard corner');
  });

  it('chooses the fillet side from the clicked line sides instead of forcing the opposite near-full-circle case', () => {
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
          id: 'line:fillet-cross-a',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'XA',
          toStationId: 'XB',
          fromX: -10,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:fillet-cross-b',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'XC',
          toStationId: 'XD',
          fromX: 0,
          fromY: -10,
          toX: 0,
          toY: 10,
          sourceObservationIds: [],
        },
      ],
    );

    const upperState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'line:fillet-cross-a',
      firstPickPoint: { x: 1, y: 0 },
      secondEntityId: 'line:fillet-cross-b',
      secondPickPoint: { x: 0, y: 1 },
    });
    const lowerState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'line:fillet-cross-a',
      firstPickPoint: { x: 1, y: 0 },
      secondEntityId: 'line:fillet-cross-b',
      secondPickPoint: { x: 0, y: -1 },
    });

    const upperArc = upperState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    const lowerArc = lowerState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(upperArc?.type).toBe('arc');
    expect(lowerArc?.type).toBe('arc');
    if (upperArc?.type !== 'arc' || lowerArc?.type !== 'arc') {
      throw new Error('Fillet side arcs missing');
    }

    expect(upperArc.centerX).toBeCloseTo(2, 6);
    expect(upperArc.centerY).toBeCloseTo(2, 6);
    expect(lowerArc.centerX).toBeCloseTo(2, 6);
    expect(lowerArc.centerY).toBeCloseTo(-2, 6);
  });

  it('keeps acute-corner fillets on the clicked interior sweep instead of producing a near-full-circle arc', () => {
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
          id: 'line:acute-a',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'AA1',
          toStationId: 'AA2',
          fromX: 0,
          fromY: 8,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:acute-b',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'AB1',
          toStationId: 'AB2',
          fromX: 0,
          fromY: -8,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 5,
      firstEntityId: 'line:acute-a',
      firstPickPoint: { x: 8.5, y: 1.2 },
      secondEntityId: 'line:acute-b',
      secondPickPoint: { x: 8.5, y: -1.2 },
    });

    const acuteArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(acuteArc?.type).toBe('arc');
    if (acuteArc?.type !== 'arc') throw new Error('Acute fillet arc missing');
    expect(Math.abs(acuteArc.endAngleDeg - acuteArc.startAngleDeg)).toBeLessThan(180);
    expect(acuteArc.centerX).toBeLessThan(10);
  });

  it('keeps arc support points synced when arc grips edit the committed curve', () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const arcState = runCadCommand(createCadHistoryState(project), {
      key: 'ARC_3PT',
      start: { x: 5, y: 0, label: 'S' },
      through: { x: 0, y: 5, label: 'M' },
      end: { x: -5, y: 0, label: 'E' },
    });
    const arc = arcState.present.project.entities.find((entity) => entity.type === 'arc');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Arc missing');

    const endpointEdited = runCadCommand(arcState, {
      key: 'GRIP_EDIT',
      entityId: arc.id,
      gripKind: 'arc-start',
      x: 3.5355339,
      y: -3.5355339,
    });
    const bc1 = endpointEdited.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'BC1',
    );
    const mp1 = endpointEdited.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'MP1',
    );
    const ec1 = endpointEdited.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'EC1',
    );
    expect(bc1?.type).toBe('survey-point');
    expect(mp1?.type).toBe('survey-point');
    expect(ec1?.type).toBe('survey-point');
    if (bc1?.type !== 'survey-point' || mp1?.type !== 'survey-point' || ec1?.type !== 'survey-point') {
      throw new Error('Arc support points missing after endpoint edit');
    }
    expect(bc1.x).toBeCloseTo(3.5355339, 3);
    expect(bc1.y).toBeCloseTo(-3.5355339, 3);
    expect(ec1.x).toBeCloseTo(-5, 6);
    expect(ec1.y).toBeCloseTo(0, 6);
    expect(mp1.x).not.toBeCloseTo(0, 6);
    expect(mp1.y).not.toBeCloseTo(5, 6);

    const radiusEdited = runCadCommand(endpointEdited, {
      key: 'GRIP_EDIT',
      entityId: arc.id,
      gripKind: 'arc-radius',
      x: 0,
      y: 8,
    });
    const radiusPoint = radiusEdited.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'R1',
    );
    const movedBc1 = radiusEdited.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'BC1',
    );
    expect(radiusPoint?.type).toBe('survey-point');
    expect(movedBc1?.type).toBe('survey-point');
    if (radiusPoint?.type !== 'survey-point' || movedBc1?.type !== 'survey-point') {
      throw new Error('Arc support points missing after radius edit');
    }
    expect(radiusPoint.x).toBeCloseTo(0, 6);
    expect(radiusPoint.y).toBeCloseTo(0, 6);
    expect(movedBc1.x).not.toBeCloseTo(bc1.x, 6);
    expect(movedBc1.y).not.toBeCloseTo(bc1.y, 6);
  });

  it('keeps linked line and polyline survey points synced when geometry edits move their vertices', () => {
    const project = appendCadProjectEntities(buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    }), [
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
    ]);

    const lineGripState = runCadCommand(createCadHistoryState(project), {
      key: 'GRIP_EDIT',
      entityId: 'line:P1|P2',
      gripKind: 'line-start',
      x: 12,
      y: 14,
    });
    const movedP1 = lineGripState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'P1',
    );
    const movedPolyline = lineGripState.present.project.entities.find(
      (entity) => entity.type === 'polyline' && entity.id === 'polyline:linked',
    );
    expect(movedP1?.type).toBe('survey-point');
    expect(movedPolyline?.type).toBe('polyline');
    if (movedP1?.type !== 'survey-point' || movedPolyline?.type !== 'polyline') {
      throw new Error('Linked entities missing after line grip edit');
    }
    expect(movedP1.x).toBeCloseTo(12, 6);
    expect(movedP1.y).toBeCloseTo(14, 6);
    expect(movedPolyline.vertices[0]?.x).toBeCloseTo(12, 6);
    expect(movedPolyline.vertices[0]?.y).toBeCloseTo(14, 6);

    const polylineEditState = runCadCommand(lineGripState, {
      key: 'EDIT_ENTITY',
      entityId: 'polyline:linked',
      edit: {
        kind: 'polyline-vertex',
        vertexIndex: 1,
        x: 26,
        y: 18,
      },
    });
    const movedP2 = polylineEditState.present.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'P2',
    );
    const movedLine = polylineEditState.present.project.entities.find(
      (entity) => entity.type === 'line' && entity.id === 'line:P1|P2',
    );
    expect(movedP2?.type).toBe('survey-point');
    expect(movedLine?.type).toBe('line');
    if (movedP2?.type !== 'survey-point' || movedLine?.type !== 'line') {
      throw new Error('Linked entities missing after polyline edit');
    }
    expect(movedP2.x).toBeCloseTo(26, 6);
    expect(movedP2.y).toBeCloseTo(18, 6);
    expect(movedLine.toX).toBeCloseTo(26, 6);
    expect(movedLine.toY).toBeCloseTo(18, 6);
  });
});
