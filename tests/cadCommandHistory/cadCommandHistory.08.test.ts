
import { describe, expect, it } from 'vitest';
import {
  buildSurveyCadSpikeProject,
  appendCadProjectEntities,
  buildCadExtendPreview,
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  input,
  parseOptions,
  sharedArcJoinTangentDot,
} from './cadCommandHistoryTestSupport';

describe('Survey CAD command history', () => {
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
    expect(sharedArcJoinTangentDot(updatedArc, filletArc)).toBeGreaterThan(0.98);
    expect(filletState.present.project.entities.filter(
      (entity) =>
        entity.type === 'survey-point' &&
        entity.metadata != null &&
        typeof entity.metadata === 'object' &&
        entity.metadata.anchorCurveEntityId === filletArc.id,
    )).toHaveLength(4);
  });

});
