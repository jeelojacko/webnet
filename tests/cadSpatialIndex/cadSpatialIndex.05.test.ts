import { describe, expect, it } from 'vitest';
import {
  appendCadProjectEntities,
  buildSurveyCadSpikeProject,
  buildCadSpatialIndex,
  input,
  parseOptions,
} from './cadSpatialIndexTestSupport';

describe('Survey CAD spatial index', () => {
  it('refines locked perpendicular, parallel, and tangent guides onto nearby line and arc bodies', () => {
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
          type: 'line' as const,
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
          id: 'line:parallel-target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 20,
          fromY: 0,
          toX: 20,
          toY: 20,
          sourceObservationIds: [],
        },
        {
          id: 'line:tangent-target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 5,
          fromY: 6,
          toX: 5,
          toY: 16,
          sourceObservationIds: [],
        },
        {
          id: 'arc:perp-target',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 10,
          centerY: 10,
          radius: 5,
          startAngleDeg: 0,
          endAngleDeg: 180,
        },
        {
          id: 'arc:tangent-source',
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

    const lockedPerpendicular = index.queryNearestSnap(
      { x: 10.3, y: 14.5 },
      1,
      ['perpendicular', 'intersection'],
      {
        active: true,
        basePoint: { x: 8, y: 18 },
        lockedSnap: {
          kind: 'perpendicular',
          sourceEntityId: 'line:base',
          sourceSegmentId: 'line:base#0',
          guidePoint: { x: 8, y: 14 },
        },
      },
    );
    expect(lockedPerpendicular?.kind).toBe('perpendicular');
    expect(lockedPerpendicular?.compoundKinds).toEqual(['perpendicular', 'intersection']);
    expect(lockedPerpendicular?.x).toBeCloseTo(8, 6);
    expect(lockedPerpendicular?.y).toBeCloseTo(10 + Math.sqrt(21), 6);

    const lockedParallel = index.queryNearestSnap(
      { x: 20.1, y: 15 },
      1,
      ['parallel', 'intersection'],
      {
        active: true,
        basePoint: { x: 5, y: 10 },
        lockedSnap: {
          kind: 'parallel',
          sourceEntityId: 'line:base',
          sourceSegmentId: 'line:base#0',
          guidePoint: { x: 15, y: 10 },
        },
      },
    );
    expect(lockedParallel?.kind).toBe('parallel');
    expect(lockedParallel?.compoundKinds).toEqual(['parallel', 'intersection']);
    expect(lockedParallel?.x).toBeCloseTo(20, 6);
    expect(lockedParallel?.y).toBeCloseTo(10, 6);

    const lockedTangent = index.queryNearestSnap(
      { x: 5.1, y: 14 },
      1,
      ['tangent', 'intersection'],
      {
        active: true,
        basePoint: { x: 0, y: 20 },
        lockedSnap: {
          kind: 'tangent',
          sourceEntityId: 'arc:tangent-source',
          guidePoint: { x: 8.6602540378, y: 5 },
        },
      },
    );
    expect(lockedTangent?.kind).toBe('tangent');
    expect(lockedTangent?.compoundKinds).toEqual(['tangent', 'intersection']);
    expect(lockedTangent?.x).toBeCloseTo(5, 6);
    expect(lockedTangent?.y).toBeCloseTo(20 - 5 * Math.sqrt(3), 6);
  });

  it('derives start perpendicular from the tangent at a captured arc start point', () => {
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
          id: 'arc:start-seed',
          type: 'arc',
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
    );
    const index = buildCadSpatialIndex(project);

    const curveStartPerpendicular = index.queryNearestSnap(
      { x: 4.5, y: 2.4 },
      1,
      ['perpendicular'],
      {
        active: true,
        basePoint: { x: 8.6602540378, y: 5 },
        tangentSeedArcEntityId: 'arc:start-seed',
        tangentSeedPoint: { x: 8.6602540378, y: 5 },
      },
    );

    expect(curveStartPerpendicular?.kind).toBe('perpendicular');
    expect(curveStartPerpendicular?.sourceEntityId).toBe('arc:start-seed');
    expect(curveStartPerpendicular?.label).toContain('start perp');
    expect(curveStartPerpendicular?.lockGuidePoint?.x).toBeCloseTo(0, 6);
    expect(curveStartPerpendicular?.lockGuidePoint?.y).toBeCloseTo(0, 6);
    expect(curveStartPerpendicular?.x).toBeCloseTo(4.4142304845, 6);
    expect(curveStartPerpendicular?.y).toBeCloseTo(2.5485571585, 6);
  });

  it('keeps captured start-line perpendicular ahead of target-line perpendicular candidates', () => {
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
          id: 'line:start',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'S1',
          toStationId: 'S2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:target',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'T1',
          toStationId: 'T2',
          fromX: -5,
          fromY: 14,
          toX: 15,
          toY: 14,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const perpendicular = index.queryNearestSnap(
      { x: 8.5, y: 13.6 },
      1,
      ['perpendicular', 'intersection'],
      { active: true, basePoint: { x: 8, y: 0 }, scopeSeedSegmentId: 'line:start#0' },
    );

    expect(perpendicular?.kind).toBe('perpendicular');
    expect(perpendicular?.sourceSegmentId).toBe('line:start#0');
    expect(perpendicular?.label).toContain('start perp');
    expect(perpendicular?.x).toBeCloseTo(8, 6);
    expect(perpendicular?.y).toBeCloseTo(13.6, 6);
  });

  it('keeps exact intersections ahead of nearby nearest candidates in dense line-arc crossings', () => {
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
          id: 'line:x',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: -10,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'arc:x',
          type: 'arc',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 6,
          radius: 6,
          startAngleDeg: 180,
          endAngleDeg: 360,
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const candidates = index.querySnapCandidates(
      { x: 0.35, y: 0.15 },
      1,
      ['intersection', 'nearest'],
    );

    expect(candidates[0]?.kind).toBe('intersection');
    expect(candidates[0]?.x).toBeCloseTo(0, 6);
    expect(candidates[0]?.y).toBeCloseTo(0, 6);
    expect(candidates.some((candidate) => candidate.kind === 'nearest')).toBe(true);
    expect(index.queryNearestSnap({ x: 0.35, y: 0.15 }, 1, ['intersection', 'nearest'])?.kind).toBe(
      'intersection',
    );
  });

});
