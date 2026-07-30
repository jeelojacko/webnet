
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
  it('keeps the hovered interior arc branch when filleting a picked polyline segment against a larger arc', () => {
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
          id: 'polyline:fillet-large-arc-polyline',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: -40, y: 40 },
            { x: 60, y: -60 },
          ],
          vertexLabels: ['LAP1', 'LAP2'],
          closed: false,
        },
        {
          id: 'arc:fillet-large-arc-polyline-target',
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
      firstEntityId: 'polyline:fillet-large-arc-polyline',
      firstSegmentId: 'polyline:fillet-large-arc-polyline#0',
      firstPickPoint: { x: -18, y: 18 },
      secondEntityId: 'arc:fillet-large-arc-polyline-target',
      secondPickPoint: { x: 0, y: 35 },
    });

    const updatedPolyline = filletState.present.project.entities.find(
      (entity) => entity.id === 'polyline:fillet-large-arc-polyline',
    );
    const updatedArc = filletState.present.project.entities.find(
      (entity) => entity.id === 'arc:fillet-large-arc-polyline-target',
    );
    const filletArc = filletState.present.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedPolyline?.type).toBe('polyline');
    expect(updatedArc?.type).toBe('arc');
    expect(filletArc?.type).toBe('arc');
    if (updatedPolyline?.type !== 'polyline' || updatedArc?.type !== 'arc' || filletArc?.type !== 'arc') {
      throw new Error('Large arc polyline fillet entities missing');
    }
    expect(updatedPolyline.vertices[0]).toEqual({ x: -40, y: 40 });
    expect(updatedPolyline.vertices[1].x).toBeGreaterThan(-40);
    expect(updatedPolyline.vertices[1].x).toBeLessThan(60);
    expect(updatedArc.endAngleDeg).toBeCloseTo(20, 6);
    expect(updatedArc.startAngleDeg).toBeGreaterThan(220);
    expect(updatedArc.startAngleDeg).toBeLessThan(360);
    expect(sharedArcJoinTangentDot(updatedArc, filletArc)).toBeGreaterThan(0.98);
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

});
