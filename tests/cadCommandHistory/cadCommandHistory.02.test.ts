
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

});
