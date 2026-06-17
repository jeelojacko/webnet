import { describe, expect, it } from 'vitest';
import {
  buildCadInverseSummary,
  buildCadDistanceSummary,
  buildCadMultiInverseSummary,
  cadBuildArcFromThreePoints,
  cadBuildArcFromChordBearingRadius,
  cadBuildArcFromPiRadiusDelta,
  cadBuildCompoundCurve,
  cadBuildCurveMetricsSummaryFromRadiusDelta,
  cadBuildCurveMetricsFromArcLength,
  cadBuildCurveMetricsFromChordLength,
  cadBuildCurveMetricsFromRadiusDelta,
  cadBuildCurveMetricsFromTangentLength,
  cadBuildParcelClosureSummary,
  cadBuildParcelReportSummary,
  cadBuildReverseCurve,
  cadBuildParallelLine,
  cadBuildPerpendicularFoot,
  cadBuildTangentCurve,
  cadAdjustTraverse,
  cadArcPointByArcDistance,
  cadArcPointByChordDistance,
  cadArcSubdivisionPoints,
  cadComputeDeflectionAnglePoint,
  cadComputeTurnedAnglePoint,
  cadExtendLineByDistance,
  cadIntersectBearingDistance,
  cadIntersectBearings,
  cadIntersectDistanceDistance,
  cadIntersectLineLikeEntities,
  cadIntersectLineCircle,
  cadIntersectOffsetLines,
  cadIntersectPerpendicular,
  cadIntersectSkew,
  cadIntersectArcEntities,
  cadIntersectLineArcEntity,
  cadOffsetLineSegment,
  cadOffsetArc,
  cadOffsetPointFromLine,
  cadPointAtDistanceAlongLine,
  cadPointAtFractionAlongLine,
  cadPointFromBearingDistance,
  cadRadialBearingAtArcAngle,
  cadSolveCurveMetrics,
  formatCadBearing,
} from '../src/engine/cad/cadCogo';
import {
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildContinuedArc,
} from '../src/engine/cad/cadGeometry';
import {
  buildCadBatchCogoReportRows,
  buildCadBatchCogoSummary,
  cadDraftBatchCogo,
} from '../src/engine/cad/cadBatchCogo';

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

  it('builds distance-only and multi-inverse summaries', () => {
    const distance = buildCadDistanceSummary({ x: 10, y: 20 }, { x: 25, y: 55 });
    expect(distance.deltaX).toBeCloseTo(15, 6);
    expect(distance.deltaY).toBeCloseTo(35, 6);
    expect(distance.distance2d).toBeCloseTo(Math.hypot(15, 35), 6);

    const multi = buildCadMultiInverseSummary([
      { x: 0, y: 0, label: 'A' },
      { x: 0, y: 10, label: 'B' },
      { x: 10, y: 10, label: 'C' },
    ]);
    expect(multi.legs).toHaveLength(2);
    expect(multi.legs[0]?.bearing).toBe('N00-00-00.00E');
    expect(multi.legs[1]?.bearing).toBe('N90-00-00.00E');
    expect(multi.totalDistance).toBeCloseTo(20, 6);
  });

  it('builds turned-angle, deflection, along-line, extend, and offset-point helpers', () => {
    const turned = cadComputeTurnedAnglePoint({
      occupyPoint: { x: 0, y: 0 },
      backsightPoint: { x: 0, y: 10 },
      angleDeg: 90,
      distance: 25,
      side: 'right',
    });
    expect(turned.x).toBeCloseTo(25, 6);
    expect(turned.y).toBeCloseTo(0, 6);

    const deflected = cadComputeDeflectionAnglePoint({
      lineStart: { x: 0, y: 0 },
      lineEnd: { x: 0, y: 10 },
      angleDeg: 45,
      distance: 10,
      side: 'right',
    });
    expect(deflected.x).toBeCloseTo(7.0710678, 6);
    expect(deflected.y).toBeCloseTo(17.0710678, 6);

    const along = cadPointAtDistanceAlongLine({ x: 0, y: 0 }, { x: 0, y: 100 }, 25);
    expect(along?.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(along?.y ?? Number.NaN).toBeCloseTo(25, 6);

    const fraction = cadPointAtFractionAlongLine({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.25);
    expect(fraction?.x ?? Number.NaN).toBeCloseTo(5, 6);
    expect(fraction?.y ?? Number.NaN).toBeCloseTo(0, 6);

    const extended = cadExtendLineByDistance({ x: 0, y: 0 }, { x: 0, y: 20 }, 10);
    expect(extended?.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(extended?.y ?? Number.NaN).toBeCloseTo(30, 6);

    const offsetPoint = cadOffsetPointFromLine({
      lineStart: { x: 0, y: 0 },
      lineEnd: { x: 0, y: 20 },
      alongDistance: 10,
      offsetDistance: 5,
      side: 'left',
    });
    expect(offsetPoint?.x ?? Number.NaN).toBeCloseTo(-5, 6);
    expect(offsetPoint?.y ?? Number.NaN).toBeCloseTo(10, 6);
  });

  it('balances traverses with angular, Bowditch, and transit methods', () => {
    const points = [
      { label: 'A', x: 0, y: 0 },
      { label: 'B', x: 100, y: 0 },
      { label: 'C', x: 100, y: 98 },
    ] as const;
    const target = { label: 'A', x: 0, y: 0 };

    const angular = cadAdjustTraverse({ points, targetPoint: target, method: 'angular' });
    expect(angular).not.toBeNull();
    expect(angular?.angularCorrectionPerLegSec ?? Number.NaN).not.toBe(0);
    expect(angular?.adjustedPoints).toHaveLength(points.length);
    expect(angular?.adjustedClosureDistanceMeters ?? Number.NaN).toBeGreaterThan(0);

    const bowditch = cadAdjustTraverse({ points, targetPoint: target, method: 'bowditch' });
    expect(bowditch).not.toBeNull();
    expect(bowditch?.adjustedClosureDistanceMeters ?? Number.NaN).toBeCloseTo(0, 6);
    expect(bowditch?.adjustedPoints.at(-1)?.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(bowditch?.adjustedPoints.at(-1)?.y ?? Number.NaN).toBeCloseTo(0, 6);

    const transit = cadAdjustTraverse({ points, targetPoint: target, method: 'transit' });
    expect(transit).not.toBeNull();
    expect(transit?.adjustedClosureDistanceMeters ?? Number.NaN).toBeCloseTo(0, 6);
    expect(transit?.legs[0]?.correctionX ?? Number.NaN).toBeCloseTo(-100, 6);
    expect(transit?.legs[1]?.correctionY ?? Number.NaN).toBeCloseTo(-98, 6);
  });

  it('builds survey intersection helpers with deterministic alternatives', () => {
    const bearingBearing = cadIntersectBearings({
      firstPoint: { x: 0, y: 0 },
      firstBearing: 'N45-00-00E',
      secondPoint: { x: 10, y: 0 },
      secondBearing: 'N45-00-00W',
      firstLabel: 'A',
      secondLabel: 'B',
    });
    expect(bearingBearing?.point.x ?? Number.NaN).toBeCloseTo(5, 6);
    expect(bearingBearing?.point.y ?? Number.NaN).toBeCloseTo(5, 6);

    const bearingDistance = cadIntersectBearingDistance({
      bearingPoint: { x: 0, y: 0 },
      bearing: 'N00-00-00E',
      distancePoint: { x: 3, y: 5 },
      distance: 5,
      bearingLabel: 'A',
      distanceLabel: 'B',
    });
    expect(bearingDistance).toHaveLength(2);
    expect(bearingDistance[0]?.point.y ?? Number.NaN).toBeGreaterThan(bearingDistance[1]?.point.y ?? Number.NaN);

    const distanceDistance = cadIntersectDistanceDistance({
      firstPoint: { x: 0, y: 0 },
      firstDistance: 5,
      secondPoint: { x: 4, y: 0 },
      secondDistance: 5,
      firstLabel: 'A',
      secondLabel: 'B',
    });
    expect(distanceDistance).toHaveLength(2);
    expect(distanceDistance[0]?.point.y ?? Number.NaN).toBeCloseTo(Math.sqrt(21), 6);
    expect(distanceDistance[1]?.point.y ?? Number.NaN).toBeCloseTo(-Math.sqrt(21), 6);

    const lineCircle = cadIntersectLineCircle({
      lineStart: { x: -10, y: 0 },
      lineEnd: { x: 10, y: 0 },
      center: { x: 0, y: 0 },
      radius: 5,
      lineLabel: 'L1',
      centerLabel: 'C1',
    });
    expect(lineCircle).toHaveLength(2);
    expect(lineCircle[0]?.point.x ?? Number.NaN).toBeCloseTo(-5, 6);
    expect(lineCircle[1]?.point.x ?? Number.NaN).toBeCloseTo(5, 6);

    const perpendicular = cadIntersectPerpendicular({
      lineStart: { x: 0, y: 0 },
      lineEnd: { x: 10, y: 0 },
      fromPoint: { x: 3, y: 7 },
    });
    expect(perpendicular?.point.x ?? Number.NaN).toBeCloseTo(3, 6);
    expect(perpendicular?.point.y ?? Number.NaN).toBeCloseTo(0, 6);

    const offset = cadIntersectOffsetLines({
      firstLineStart: { x: 0, y: 0 },
      firstLineEnd: { x: 10, y: 0 },
      firstOffset: 2,
      secondLineStart: { x: 0, y: 0 },
      secondLineEnd: { x: 0, y: 10 },
      secondOffset: -3,
    });
    expect(offset?.point.x ?? Number.NaN).toBeCloseTo(3, 6);
    expect(offset?.point.y ?? Number.NaN).toBeCloseTo(2, 6);

    const skew = cadIntersectSkew({
      lineStart: { x: 0, y: 0 },
      lineEnd: { x: 20, y: 0 },
      fromPoint: { x: 10, y: 10 },
      angleDeg: 45,
      side: 'right',
    });
    expect(skew?.point.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(skew?.point.y ?? Number.NaN).toBeCloseTo(0, 6);
  });

  it('parses batch deed rows with explicit start, deed bearings, and tangent curves', () => {
    const draft = cadDraftBatchCogo({
      sourceText: [
        'START POB=1000,1000',
        'P1=N 45°00\'00" E 100',
        'CURVE RIGHT R 50 DELTA 30-00-00',
      ].join('\n'),
    });

    expect(draft.canCommit).toBe(true);
    expect(draft.startPoint?.label).toBe('POB');
    expect(draft.generatedPointCount).toBe(3);
    expect(draft.generatedLineCount).toBe(1);
    expect(draft.generatedArcCount).toBe(1);
    expect(draft.previewRows.map((row) => row.status)).toEqual(['ok', 'ok', 'ok']);
    expect(draft.endPoint?.label).toBe('P2');
    expect(buildCadBatchCogoSummary(draft)).toContain('Generated 3 points');
    expect(buildCadBatchCogoReportRows(draft).some((row) => row.label === 'Arcs' && row.value === '1')).toBe(
      true,
    );
  });

  it('rejects curve-only batch deed rows without an incoming tangent', () => {
    const draft = cadDraftBatchCogo({
      sourceText: ['START POB=0,0', 'CURVE LEFT R 50 DELTA 20'].join('\n'),
    });

    expect(draft.canCommit).toBe(false);
    expect(draft.previewRows[1]?.status).toBe('error');
    expect(draft.previewRows[1]?.summary).toContain('incoming tangent');
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

  it('solves richer curve summaries from common parameter pairs', () => {
    const radiusDelta = cadBuildCurveMetricsSummaryFromRadiusDelta(200, 60);
    expect(radiusDelta?.externalDistance ?? Number.NaN).toBeCloseTo(30.940108, 6);
    expect(radiusDelta?.middleOrdinate ?? Number.NaN).toBeCloseTo(26.794919, 6);

    const arcChord = cadSolveCurveMetrics({
      pair: 'arc-chord',
      firstValue: radiusDelta?.arcLength ?? Number.NaN,
      secondValue: radiusDelta?.chordLength ?? Number.NaN,
    });
    expect(arcChord?.radius ?? Number.NaN).toBeCloseTo(200, 6);
    expect(arcChord?.deltaDeg ?? Number.NaN).toBeCloseTo(60, 6);

    const deltaTangent = cadSolveCurveMetrics({
      pair: 'delta-tangent',
      firstValue: 60,
      secondValue: radiusDelta?.tangentLength ?? Number.NaN,
    });
    expect(deltaTangent?.radius ?? Number.NaN).toBeCloseTo(200, 6);
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
        startAngleDeg: 0,
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

  it('builds PI-radius-delta, chord-bearing, reverse, and compound curve workflows', () => {
    const piCurve = cadBuildArcFromPiRadiusDelta({
      piPoint: { x: 0, y: 0 },
      backTangentPoint: { x: -10, y: 0 },
      radius: 10,
      deltaDeg: 90,
      side: 'left',
    });
    expect(piCurve?.radius ?? Number.NaN).toBeCloseTo(10, 6);

    const chordBearing = cadBuildArcFromChordBearingRadius({
      startPoint: { x: 0, y: 0 },
      chordBearing: 'N90-00-00E',
      chordDistance: 10,
      radius: 10,
      side: 'left',
    });
    expect(chordBearing?.radius ?? Number.NaN).toBeCloseTo(10, 6);

    const sourceArc = {
      centerX: 0,
      centerY: 0,
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
    };
    const reverse = cadBuildReverseCurve({
      sourceArc,
      radius: 8,
      deltaDeg: 45,
    });
    const compound = cadBuildCompoundCurve({
      sourceArc,
      radius: 12,
      deltaDeg: 45,
    });
    expect(reverse).not.toBeNull();
    expect(compound).not.toBeNull();
  });

  it('computes radial bearing, point-on-curve, subdivision, and offset-curve helpers', () => {
    const arc = {
      centerX: 0,
      centerY: 0,
      radius: 10,
      startAngleDeg: 0,
      endAngleDeg: 90,
    };

    expect(cadRadialBearingAtArcAngle({ arc, angleDeg: 0 })).toBe('N90-00-00.00E');

    const byArc = cadArcPointByArcDistance(arc, (Math.PI * 10) / 4);
    expect(byArc?.x ?? Number.NaN).toBeCloseTo(Math.sqrt(50), 6);
    expect(byArc?.y ?? Number.NaN).toBeCloseTo(Math.sqrt(50), 6);

    const byChord = cadArcPointByChordDistance(arc, 10);
    expect(byChord?.x ?? Number.NaN).toBeCloseTo(5, 6);
    expect(byChord?.y ?? Number.NaN).toBeCloseTo(8.660254, 6);

    const equalPoints = cadArcSubdivisionPoints({ arc, mode: 'equal', value: 4 });
    expect(equalPoints).toHaveLength(3);

    const offset = cadOffsetArc({ arc, offsetDistance: 2, side: 'right' });
    expect(offset?.radius ?? Number.NaN).toBeCloseTo(12, 6);
  });

  it('keeps the picked center and projects start-center-end endpoint direction onto the arc radius', () => {
    const projected = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 8 },
    );

    expect(projected).not.toBeNull();
    expect(projected?.center.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(projected?.center.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(projected?.radius ?? Number.NaN).toBeCloseTo(10, 6);
    expect(projected?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(projected?.endPoint.y ?? Number.NaN).toBeCloseTo(10, 6);
  });

  it('keeps picked start/end points for clockwise and reverse center-driven arcs', () => {
    const clockwise = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -10 },
    );

    expect(clockwise).not.toBeNull();
    expect(clockwise?.startPoint.x ?? Number.NaN).toBeCloseTo(10, 6);
    expect(clockwise?.startPoint.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(clockwise?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(clockwise?.endPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(clockwise?.deltaDeg ?? Number.NaN).toBeCloseTo(90, 6);

    const reverse = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -10 },
      true,
    );

    expect(reverse).not.toBeNull();
    expect(reverse?.startPoint.x ?? Number.NaN).toBeCloseTo(10, 6);
    expect(reverse?.startPoint.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(reverse?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(reverse?.endPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(reverse?.deltaDeg ?? Number.NaN).toBeCloseTo(270, 6);
  });

  it('keeps start/end order and tangency for clockwise continue-curve and start-end-angle arcs', () => {
    const sourceArc = cadBuildArcFromStartCenterEnd(
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -10 },
    );
    expect(sourceArc).not.toBeNull();
    if (!sourceArc) throw new Error('Source arc not created');

    const continuedArc = cadBuildContinuedArc(
      {
        centerX: sourceArc.center.x,
        centerY: sourceArc.center.y,
        radius: sourceArc.radius,
        startAngleDeg: sourceArc.startAngleDeg,
        endAngleDeg: sourceArc.endAngleDeg,
      },
      { x: -10, y: 0 },
    );
    expect(continuedArc).not.toBeNull();
    expect(continuedArc?.startPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(continuedArc?.startPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(continuedArc?.endPoint.x ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(continuedArc?.endPoint.y ?? Number.NaN).toBeCloseTo(0, 6);

    const startEndAngle = cadBuildArcFromStartEndAngle(
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      90,
    );
    expect(startEndAngle).not.toBeNull();
    expect(startEndAngle?.startPoint.x ?? Number.NaN).toBeCloseTo(10, 6);
    expect(startEndAngle?.startPoint.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(startEndAngle?.endPoint.x ?? Number.NaN).toBeCloseTo(0, 6);
    expect(startEndAngle?.endPoint.y ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(startEndAngle?.deltaDeg ?? Number.NaN).toBeCloseTo(90, 6);
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
