
import { describe, expect, it } from 'vitest';
import {
  buildSurveyCadSpikeProject,
  appendCadProjectEntities,
  createCadHistoryState,
  runCadCommand,
  input,
  parseOptions,
  sharedArcJoinTangentDot,
} from './cadCommandHistoryTestSupport';

describe('Survey CAD command history', () => {
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
    expect(sharedArcJoinTangentDot(updatedArc, filletArc)).toBeGreaterThan(0.98);
  });

  it('supports picking the arc first when filleting against a polyline segment', () => {
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
          id: 'arc:fillet-first-arc',
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
        {
          id: 'polyline:fillet-arc-polyline',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: -10 },
          ],
          vertexLabels: ['AP1', 'AP2', 'AP3'],
          closed: false,
        },
      ],
    );

    const filletState = runCadCommand(createCadHistoryState(project), {
      key: 'FILLET',
      radius: 2,
      firstEntityId: 'arc:fillet-first-arc',
      firstPickPoint: { x: 10.5, y: 1 },
      secondEntityId: 'polyline:fillet-arc-polyline',
      secondSegmentId: 'polyline:fillet-arc-polyline#0',
      secondPickPoint: { x: 9, y: 0 },
    });

    const updatedArc = filletState.present.project.entities.find(
      (entity) => entity.id === 'arc:fillet-first-arc',
    );
    const updatedPolyline = filletState.present.project.entities.find(
      (entity) => entity.id === 'polyline:fillet-arc-polyline',
    );
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedArc?.type).toBe('arc');
    expect(updatedPolyline?.type).toBe('polyline');
    expect(filletArc?.type).toBe('arc');
    if (updatedArc?.type !== 'arc' || updatedPolyline?.type !== 'polyline' || filletArc?.type !== 'arc') {
      throw new Error('Arc-first polyline fillet entities missing');
    }
    expect(updatedArc.startAngleDeg).toBeGreaterThan(160);
    expect(updatedArc.startAngleDeg).toBeLessThan(180);
    expect(updatedPolyline.vertices[0].x).toBeGreaterThan(7);
    expect(updatedPolyline.vertices[0].x).toBeLessThan(10);
    expect(updatedPolyline.vertices[1]).toEqual({ x: 10, y: 0 });
    expect(sharedArcJoinTangentDot(updatedArc, filletArc)).toBeGreaterThan(0.98);
  });

});
