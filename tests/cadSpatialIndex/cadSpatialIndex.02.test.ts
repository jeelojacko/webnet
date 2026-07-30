import { describe, expect, it } from 'vitest';
import {
  appendCadProjectEntities,
  buildSurveyCadSpikeProject,
  buildCadSpatialIndex,
  cadArcMidpoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterChord,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildArcFromThreePoints,
  cadBuildContinuedArc,
  cadBuildTangentCurve,
  cadPointOnCircle,
  cadSignedSweepDeg,
  input,
  parseOptions,
} from './cadSpatialIndexTestSupport';

describe('Survey CAD spatial index', () => {
  it('limits passive snap candidates to entities inside the current visible window', () => {
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
          id: 'line:visible',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'V1',
          toStationId: 'V2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:offscreen',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'O1',
          toStationId: 'O2',
          fromX: 40,
          fromY: 0,
          toX: 50,
          toY: 0,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const globalNearest = index.queryNearestSnap({ x: 45.2, y: 0.2 }, 2, ['nearest']);
    expect(globalNearest?.sourceEntityId).toBe('line:offscreen');

    const visibleOnlyNearest = index.queryNearestSnap(
      { x: 45.2, y: 0.2 },
      2,
      ['nearest'],
      { active: false, basePoint: null },
      { minX: -5, minY: -5, maxX: 15, maxY: 5 },
    );
    expect(visibleOnlyNearest).toBeNull();

    const localVisibleNearest = index.queryNearestSnap(
      { x: 9.8, y: 0.2 },
      2,
      ['nearest'],
      { active: false, basePoint: null },
      { minX: -5, minY: -5, maxX: 15, maxY: 5 },
    );
    expect(localVisibleNearest?.sourceEntityId).toBe('line:visible');
  });

  it('keeps arc-body midpoint and nearest snaps valid across all native arc constructors', () => {
    const start = { x: 10, y: 0 };
    const center = { x: 20, y: 0 };
    const end = { x: 30, y: 0 };
    const tangentSource = {
      centerX: 20,
      centerY: 0,
      radius: 10,
      startAngleDeg: 180,
      endAngleDeg: 90,
    };
    const arcDefinitions = [
      { label: 'ARC_3PT', definition: cadBuildArcFromThreePoints(start, { x: 20, y: 10 }, end) },
      { label: 'ARC_SCE', definition: cadBuildArcFromStartCenterEnd(start, center, { x: 27, y: 7 }) },
      { label: 'ARC_CSE', definition: cadBuildArcFromStartCenterEnd(start, center, { x: 27, y: 7 }) },
      { label: 'ARC_SCA', definition: cadBuildArcFromStartCenterAngle(start, center, 90) },
      { label: 'ARC_CSA', definition: cadBuildArcFromStartCenterAngle(start, center, 90) },
      { label: 'ARC_SCL', definition: cadBuildArcFromStartCenterChord(start, center, 14.1421356237) },
      { label: 'ARC_CSL', definition: cadBuildArcFromStartCenterChord(start, center, 14.1421356237) },
      { label: 'ARC_SEA', definition: cadBuildArcFromStartEndAngle(start, end, 90) },
      { label: 'ARC_SED', definition: cadBuildArcFromStartEndDirection(start, end, 45) },
      { label: 'ARC_SER', definition: cadBuildArcFromStartEndRadius(start, end, 10) },
      { label: 'CONTINUE_CURVE', definition: cadBuildContinuedArc(tangentSource, { x: 10, y: 20 }) },
      {
        label: 'TANGENT_CURVE',
        definition: cadBuildTangentCurve({ x: 20, y: 20 }, { x: 20, y: 0 }, { x: 40, y: 20 }, 10),
      },
    ];

    arcDefinitions.forEach(({ label, definition }, index) => {
      expect(definition, `${label} should produce a valid arc definition for snap auditing`).not.toBeNull();
      if (!definition) return;

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
            id: `arc:audit:${index + 1}`,
            type: 'arc' as const,
            layerId: 'observation-lines',
            styleId: 'style-observation-line',
            visible: true,
            locked: false,
            centerX: definition.center.x,
            centerY: definition.center.y,
            radius: definition.radius,
            startAngleDeg: definition.startAngleDeg,
            endAngleDeg: definition.endAngleDeg,
          },
        ],
      );
      const indexer = buildCadSpatialIndex(project);

      const midpoint = cadArcMidpoint(
        definition.center,
        definition.radius,
        definition.startAngleDeg,
        definition.endAngleDeg,
      );
      const midpointSnap = indexer.queryNearestSnap(
        { x: midpoint.x + 0.1, y: midpoint.y + 0.1 },
        1.5,
        ['arc-midpoint', 'nearest'],
      );
      expect(midpointSnap?.sourceEntityId, `${label} should expose an on-body midpoint snap`).toBe(`arc:audit:${index + 1}`);
      expect(['arc-midpoint', 'nearest']).toContain(midpointSnap?.kind);

      const signedSweep = cadSignedSweepDeg(definition.startAngleDeg, definition.endAngleDeg);
      const sampleAngleDeg = definition.startAngleDeg + signedSweep * 0.3;
      const onCurvePoint = cadPointOnCircle(definition.center, definition.radius, sampleAngleDeg);
      const radialVectorX = onCurvePoint.x - definition.center.x;
      const radialVectorY = onCurvePoint.y - definition.center.y;
      const radialLength = Math.hypot(radialVectorX, radialVectorY) || 1;
      const nearCurveQuery = {
        x: onCurvePoint.x + (radialVectorX / radialLength) * 0.35,
        y: onCurvePoint.y + (radialVectorY / radialLength) * 0.35,
      };
      const nearestSnap = indexer.queryNearestSnap(
        nearCurveQuery,
        1.5,
        ['endpoint', 'arc-midpoint', 'center', 'quadrant', 'nearest'],
      );
      expect(nearestSnap?.kind, `${label} should expose a usable on-body nearest snap`).toBe('nearest');
      expect(nearestSnap?.sourceEntityId).toBe(`arc:audit:${index + 1}`);
    });
  });

  it('resolves construction snaps only when active command context supplies a base point', () => {
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
          id: 'line:apparent',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 20,
          fromY: -5,
          toX: 20,
          toY: 5,
          sourceObservationIds: [],
        },
        {
          id: 'arc:upper',
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
    const inactiveContext = { active: false, basePoint: null };
    const activeContext = { active: true, basePoint: { x: 5, y: 10 } };
    const parallelContext = { active: true, basePoint: { x: 5, y: 10 }, scopeSeedSegmentId: 'line:base#0' };

    expect(index.queryNearestSnap({ x: 15, y: 0.1 }, 1, ['extension'], inactiveContext)).toBeNull();

    const extension = index.queryNearestSnap({ x: 15, y: 0.1 }, 1, ['extension'], activeContext);
    expect(extension?.kind).toBe('extension');
    expect(extension?.x).toBeCloseTo(15, 6);
    expect(extension?.y).toBeCloseTo(0, 6);

    const perpendicular = index.queryNearestSnap({ x: 5.2, y: 0.1 }, 1, ['perpendicular'], activeContext);
    expect(perpendicular?.kind).toBe('perpendicular');
    expect(perpendicular?.x).toBeCloseTo(5, 6);
    expect(perpendicular?.y).toBeCloseTo(0, 6);

    const parallel = index.queryNearestSnap({ x: 15.1, y: 10.2 }, 1, ['parallel'], parallelContext);
    expect(parallel?.kind).toBe('parallel');
    expect(parallel?.x).toBeCloseTo(15.1, 6);
    expect(parallel?.y).toBeCloseTo(10, 6);
    expect(parallel?.guideSegments).toHaveLength(2);

    const apparentIntersection = index.queryNearestSnap(
      { x: 20.1, y: 0.2 },
      1,
      ['apparent-intersection'],
      activeContext,
    );
    expect(apparentIntersection?.kind).toBe('apparent-intersection');
    expect(apparentIntersection?.x).toBeCloseTo(20, 6);
    expect(apparentIntersection?.y).toBeCloseTo(0, 6);

    const arcPerpendicular = index.queryNearestSnap(
      { x: 0.1, y: 10.2 },
      1,
      ['perpendicular'],
      { active: true, basePoint: { x: 0, y: 30 } },
    );
    expect(arcPerpendicular?.kind).toBe('perpendicular');
    expect(arcPerpendicular?.sourceEntityId).toBe('arc:upper');
    expect(arcPerpendicular?.x).toBeCloseTo(0, 6);
    expect(arcPerpendicular?.y).toBeCloseTo(10, 6);

    const startPerpendicular = index.queryNearestSnap(
      { x: 10.3, y: 6.5 },
      1,
      ['perpendicular'],
      { active: true, basePoint: { x: 10, y: 0 }, scopeSeedSegmentId: 'line:base#0' },
    );
    expect(startPerpendicular?.kind).toBe('perpendicular');
    expect(startPerpendicular?.sourceSegmentId).toBe('line:base#0');
    expect(startPerpendicular?.label).toContain('start perp');
    expect(startPerpendicular?.x).toBeCloseTo(10, 6);
    expect(startPerpendicular?.y).toBeCloseTo(6.5, 6);

    const direction = index.queryNearestSnap(
      { x: 7.4, y: 7.1 },
      1,
      ['direction'],
      { active: true, basePoint: { x: 0, y: 0 } },
    );
    expect(direction?.kind).toBe('direction');
    expect(direction?.label).toContain('NE 045');
    expect(direction?.x).toBeCloseTo(direction?.y ?? 0, 6);
  });

  it('limits parallel candidates to segments within one hop of the captured endpoint', () => {
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
          id: 'pline:chain',
          type: 'polyline',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          closed: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
          ],
          vertexLabels: ['P1', 'P2', 'P3', 'P4'],
        },
        {
          id: 'line:remote-vertical',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 40,
          fromY: -20,
          toX: 40,
          toY: 20,
          sourceObservationIds: [],
        },
      ],
    );
    const index = buildCadSpatialIndex(project);

    const filteredParallel = index.queryNearestSnap(
      { x: 0.1, y: 15 },
      1,
      ['parallel'],
      {
        active: true,
        basePoint: { x: 0, y: 0 },
      },
    );
    expect(filteredParallel).toBeNull();
  });

});
