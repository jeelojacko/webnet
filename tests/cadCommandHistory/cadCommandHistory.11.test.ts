
import { describe, expect, it } from 'vitest';
import {
  buildSurveyCadSpikeProject,
  appendCadProjectEntities,
  createCadHistoryState,
  runCadCommand,
  input,
  parseOptions,
} from './cadCommandHistoryTestSupport';

describe('Survey CAD command history', () => {
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
