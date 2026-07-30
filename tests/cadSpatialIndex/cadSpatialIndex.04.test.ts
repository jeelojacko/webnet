import { describe, expect, it } from 'vitest';
import {
  appendCadProjectEntities,
  buildSurveyCadSpikeProject,
  buildCadSpatialIndex,
  input,
  parseOptions,
} from './cadSpatialIndexTestSupport';

describe('Survey CAD spatial index', () => {
  it('rejects extension and apparent candidates whose guide path runs through other linework', () => {
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
          id: 'line:base',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'A',
          toStationId: 'B',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:blocked',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'C',
          toStationId: 'D',
          fromX: 15,
          fromY: -5,
          toX: 15,
          toY: 5,
          sourceObservationIds: [],
        },
        {
          id: 'line:far-horizontal',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'E',
          toStationId: 'F',
          fromX: 30,
          fromY: 8,
          toX: 40,
          toY: 8,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const blockedExtension = index.queryNearestSnap(
      { x: 20, y: 0.1 },
      2,
      ['extension'],
      { active: true, basePoint: { x: 5, y: 5 }, scopeSeedSegmentId: 'line:base#0' },
    );
    expect(blockedExtension).toBeNull();

    const blockedApparent = index.queryNearestSnap(
      { x: 35, y: 0.2 },
      3,
      ['apparent-intersection'],
      { active: true, basePoint: { x: 5, y: 5 }, scopeSeedSegmentId: 'line:base#0' },
    );
    expect(blockedApparent).toBeNull();
  });

  it('keeps a locked construction snap while refining onto an on-line apparent intersection', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project: ReturnType<typeof buildSurveyCadSpikeProject> = {
      ...baseProject,
      entities: [
        {
          id: 'line:base',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:short-vertical',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 5,
          fromY: 15,
          toX: 5,
          toY: 25,
          sourceObservationIds: [],
        },
      ],
    };
    const index = buildCadSpatialIndex(project);

    const compoundPerpendicular = index.queryNearestSnap(
      { x: 5.1, y: 0.2 },
      1,
      ['perpendicular', 'apparent-intersection'],
      { active: true, basePoint: { x: 5, y: 10 } },
    );
    expect(compoundPerpendicular?.kind).toBe('perpendicular');
    expect(compoundPerpendicular?.compoundKinds).toEqual(['perpendicular', 'apparent-intersection']);
    expect(compoundPerpendicular?.label).toContain('perp');
    expect(compoundPerpendicular?.label).toContain('apparent');
    expect(compoundPerpendicular?.x).toBeCloseTo(5, 6);
    expect(compoundPerpendicular?.y).toBeCloseTo(0, 6);
    expect(compoundPerpendicular?.guideSegments?.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves tangent-to-arc and line-arc apparent intersections from construction context', () => {
    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const project: ReturnType<typeof buildSurveyCadSpikeProject> = {
      ...baseProject,
      entities: [
        {
          id: 'line:high',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 20,
          fromY: 9,
          toX: 22,
          toY: 9,
          sourceObservationIds: [],
        },
        {
          id: 'arc:right',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 10,
          startAngleDeg: 0,
          endAngleDeg: 180,
        },
      ],
    };
    const index = buildCadSpatialIndex(project);

    const tangent = index.queryNearestSnap(
      { x: 8.7, y: 5.1 },
      1,
      ['tangent'],
      { active: true, basePoint: { x: 0, y: 20 } },
    );
    expect(tangent?.kind).toBe('tangent');
    expect(tangent?.sourceEntityId).toBe('arc:right');
    expect(tangent?.x).toBeCloseTo(8.660254, 6);
    expect(tangent?.y).toBeCloseTo(5, 6);
    expect(tangent?.guideSegments).toHaveLength(2);
    expect(tangent?.guideSegments?.[0]?.[0]?.x).toBeCloseTo(0, 6);
    expect(tangent?.guideSegments?.[0]?.[0]?.y).toBeCloseTo(20, 6);

    const apparentLineArc = index.queryNearestSnap(
      { x: 4.4, y: 9.1 },
      1,
      ['apparent-intersection'],
      { active: true, basePoint: { x: 20, y: 9 } },
    );
    expect(apparentLineArc?.kind).toBe('apparent-intersection');
    expect(apparentLineArc?.label).toContain('L1-L2');
    expect(apparentLineArc?.label).toContain('Arc');
    expect(apparentLineArc?.x).toBeCloseTo(Math.sqrt(19), 6);
    expect(apparentLineArc?.y).toBeCloseTo(9, 6);
    expect(apparentLineArc?.guideSegments).toHaveLength(2);
  });

});
