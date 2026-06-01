import { describe, expect, it } from 'vitest';
import {
  buildCadInverseSummary,
  cadBuildArcFromThreePoints,
  cadBuildCurveMetricsFromArcLength,
  cadBuildCurveMetricsFromChordLength,
  cadBuildCurveMetricsFromRadiusDelta,
  cadBuildCurveMetricsFromTangentLength,
  cadBuildParcelClosureSummary,
  cadBuildParcelReportSummary,
  cadBuildParallelLine,
  cadBuildPerpendicularFoot,
  cadBuildTangentCurve,
  cadIntersectLineLikeEntities,
  cadIntersectArcEntities,
  cadIntersectLineArcEntity,
  cadOffsetLineSegment,
  cadPointFromBearingDistance,
  formatCadBearing,
} from '../src/engine/cad/cadCogo';
import {
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildContinuedArc,
} from '../src/engine/cad/cadGeometry';

describe('Survey CAD COGO helpers', () => {
  it('builds inverse summaries with azimuth and survey bearing formatting', () => {
    const inverse = buildCadInverseSummary({ x: 0, y: 0 }, { x: 100, y: 100 });

    expect(inverse.distance).toBeCloseTo(141.421356, 6);
    expect(inverse.azimuthDeg).toBeCloseTo(45, 6);
    expect(inverse.bearing).toBe('N45-00-00.00E');
    expect(formatCadBearing(225)).toBe('S45-00-00.00W');
  });

  it('creates points from survey bearing-distance input', () => {
    const point = cadPointFromBearingDistance({ x: 0, y: 0 }, 'S45-00-00E', 100);

    expect(point).not.toBeNull();
    expect(point?.x ?? Number.NaN).toBeCloseTo(70.710678, 6);
    expect(point?.y ?? Number.NaN).toBeCloseTo(-70.710678, 6);
  });

  it('finds deterministic line-like intersections', () => {
    const intersection = cadIntersectLineLikeEntities(
      {
        id: 'line:a',
        type: 'line',
        layerId: 'observation-lines',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'B',
        fromX: 0,
        fromY: 0,
        toX: 100,
        toY: 100,
        sourceObservationIds: [],
      },
      {
        id: 'pline:c',
        type: 'polyline',
        layerId: 'observation-lines',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 100 },
          { x: 100, y: 0 },
        ],
        vertexLabels: ['C', 'D'],
        closed: false,
      },
    );

    expect(intersection).not.toBeNull();
    expect(intersection?.point.x ?? Number.NaN).toBeCloseTo(50, 6);
    expect(intersection?.point.y ?? Number.NaN).toBeCloseTo(50, 6);
    expect(intersection?.label).toContain('A-B');
  });

  it('finds line-arc intersections on visible arc sweep', () => {
    const intersections = cadIntersectLineArcEntity(
      {
        id: 'line:east-west',
        type: 'line',
        layerId: 'observation-lines',
        visible: true,
        locked: false,
        fromStationId: 'W',
        toStationId: 'E',
        fromX: -10,
        fromY: 0,
        toX: 10,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'arc:north',
        type: 'arc',
        layerId: 'planning',
        visible: true,
        locked: false,
        centerX: 0,
        centerY: 0,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 180,
      },
    );

    expect(intersections).toHaveLength(2);
    expect(intersections[0]?.point.x ?? Number.NaN).toBeCloseTo(-5, 6);
    expect(intersections[0]?.point.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(intersections[1]?.point.x ?? Number.NaN).toBeCloseTo(5, 6);
    expect(intersections[1]?.point.y ?? Number.NaN).toBeCloseTo(0, 6);
  });

  it('finds arc-arc intersections deterministically', () => {
    const intersections = cadIntersectArcEntities(
      {
        id: 'arc:left',
        type: 'arc',
        layerId: 'planning',
        visible: true,
        locked: false,
        centerX: 0,
        centerY: 0,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 180,
      },
      {
        id: 'arc:right',
        type: 'arc',
        layerId: 'planning',
        visible: true,
        locked: false,
        centerX: 4,
        centerY: 0,
        radius: 5,
        startAngleDeg: 0,
        endAngleDeg: 180,
      },
    );

    expect(intersections).toHaveLength(1);
    expect(intersections[0]?.point.x ?? Number.NaN).toBeCloseTo(2, 6);
    expect(intersections[0]?.point.y ?? Number.NaN).toBeCloseTo(Math.sqrt(21), 6);
  });

  it('builds first offset, parallel, and perpendicular helpers from base geometry', () => {
    const offset = cadOffsetLineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 3);
    expect(offset.start.x).toBeCloseTo(0, 6);
    expect(offset.start.y).toBeCloseTo(3, 6);
    expect(offset.end.x).toBeCloseTo(10, 6);
    expect(offset.end.y).toBeCloseTo(3, 6);

    const parallel = cadBuildParallelLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 4 });
    expect(parallel.start.x).toBeCloseTo(2, 6);
    expect(parallel.start.y).toBeCloseTo(4, 6);
    expect(parallel.end.x).toBeCloseTo(12, 6);
    expect(parallel.end.y).toBeCloseTo(4, 6);

    const foot = cadBuildPerpendicularFoot({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 7 });
    expect(foot.x).toBeCloseTo(3, 6);
    expect(foot.y).toBeCloseTo(0, 6);
  });

  it('builds simple curve metrics from radius and common survey inputs', () => {
    const byDelta = cadBuildCurveMetricsFromRadiusDelta(200, 60);
    expect(byDelta).not.toBeNull();
    expect(byDelta?.arcLength ?? Number.NaN).toBeCloseTo(209.439510, 6);
    expect(byDelta?.chordLength ?? Number.NaN).toBeCloseTo(200, 6);
    expect(byDelta?.tangentLength ?? Number.NaN).toBeCloseTo(115.470054, 6);

    const byLength = cadBuildCurveMetricsFromArcLength(200, byDelta?.arcLength ?? Number.NaN);
    expect(byLength?.deltaDeg ?? Number.NaN).toBeCloseTo(60, 6);

    const byChord = cadBuildCurveMetricsFromChordLength(200, 200);
    expect(byChord?.deltaDeg ?? Number.NaN).toBeCloseTo(60, 6);

    const byTangent = cadBuildCurveMetricsFromTangentLength(200, byDelta?.tangentLength ?? Number.NaN);
    expect(byTangent?.deltaDeg ?? Number.NaN).toBeCloseTo(60, 6);
  });

  it('builds deterministic three-point and tangent-curve arc definitions', () => {
    const threePoint = cadBuildArcFromThreePoints(
      { x: 5, y: 0 },
      { x: 0, y: 5 },
      { x: -5, y: 0 },
    );
    expect(threePoint).not.toBeNull();
    expect(threePoint?.center.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(threePoint?.center.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(threePoint?.radius ?? Number.NaN).toBeCloseTo(5, 6);
    expect(threePoint?.deltaDeg ?? Number.NaN).toBeCloseTo(180, 6);

    const tangentCurve = cadBuildTangentCurve(
      { x: 0, y: 0 },
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      10,
    );
    expect(tangentCurve).not.toBeNull();
    expect(tangentCurve?.center.x ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(tangentCurve?.center.y ?? Number.NaN).toBeCloseTo(10, 6);
    expect(tangentCurve?.radius ?? Number.NaN).toBeCloseTo(10, 6);
    expect(tangentCurve?.deltaDeg ?? Number.NaN).toBeCloseTo(90, 6);

    const tangentPoints = [tangentCurve?.startPoint, tangentCurve?.endPoint]
      .filter((point): point is { x: number; y: number } => point != null)
      .sort((left, right) => {
        if (Math.abs(left.x - right.x) > 1e-9) return left.x - right.x;
        return left.y - right.y;
      });
    expect(tangentPoints).toHaveLength(2);
    expect(tangentPoints[0]?.x ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(tangentPoints[0]?.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(tangentPoints[1]?.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(tangentPoints[1]?.y ?? Number.NaN).toBeCloseTo(10, 6);
  });

  it('builds broader survey arc constructors for split-button arc modes', () => {
    const startCenterEnd = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    );
    expect(startCenterEnd?.radius ?? Number.NaN).toBeCloseTo(10, 6);

    const startCenterAngle = cadBuildArcFromStartCenterAngle(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      90,
    );
    expect(startCenterAngle?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(startCenterAngle?.endPoint.y ?? Number.NaN).toBeCloseTo(10, 6);

    const startEndRadius = cadBuildArcFromStartEndRadius(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      10,
    );
    expect(startEndRadius?.radius ?? Number.NaN).toBeCloseTo(10, 6);

    const startEndDirection = cadBuildArcFromStartEndDirection(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      90,
    );
    expect(startEndDirection).not.toBeNull();

    const continuedArc = cadBuildContinuedArc(
      {
        centerX: 0,
        centerY: 0,
        radius: 10,
        endAngleDeg: 90,
      },
      { x: -10, y: 0 },
    );
    expect(continuedArc).not.toBeNull();
    expect(cadArcEndPoint({
      centerX: 0,
      centerY: 0,
      radius: 10,
      endAngleDeg: 90,
    }).x).toBeCloseTo(0, 6);
  });

  it('rejects start-center-end arcs when the supplied end point is off the picked center radius', () => {
    const invalid = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 8 },
    );

    expect(invalid).toBeNull();
  });

  it('computes parcel closure metrics from traverse-style vertices', () => {
    const summary = cadBuildParcelClosureSummary([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 25, y: 15 },
      { x: 0, y: 0 },
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.areaSquareMeters ?? Number.NaN).toBeCloseTo(187.5, 6);
    expect(summary?.perimeterMeters ?? Number.NaN).toBeCloseTo(69.154759, 6);
    expect(summary?.closureDistanceMeters ?? Number.NaN).toBeCloseTo(0, 6);
    expect(summary?.centroid.x ?? Number.NaN).toBeCloseTo(16.6666667, 6);
    expect(summary?.centroid.y ?? Number.NaN).toBeCloseTo(5, 6);
  });

  it('builds a parcel closure report with ordered course azimuths and distances', () => {
    const report = cadBuildParcelReportSummary({
      parcelName: 'Parcel 1',
      vertices: [
        { x: 0, y: 0 },
        { x: 25, y: 0 },
        { x: 25, y: 15 },
        { x: 0, y: 0 },
      ],
      vertexLabels: ['A', 'B', 'C', 'A'],
    });

    expect(report).not.toBeNull();
    expect(report?.parcelName).toBe('Parcel 1');
    expect(report?.courseCount).toBe(3);
    expect(report?.courses.map((course) => `${course.fromLabel}-${course.toLabel}`)).toEqual([
      'A-B',
      'B-C',
      'C-A',
    ]);
    expect(report?.courses[0]?.azimuthText).toBe('90°00\'00"');
    expect(report?.courses[0]?.distanceMeters ?? Number.NaN).toBeCloseTo(25, 6);
    expect(report?.courses[1]?.azimuthText).toBe('0°00\'00"');
    expect(report?.courses[1]?.distanceMeters ?? Number.NaN).toBeCloseTo(15, 6);
    expect(report?.closureDistanceMeters ?? Number.NaN).toBeCloseTo(0, 6);
  });
});
