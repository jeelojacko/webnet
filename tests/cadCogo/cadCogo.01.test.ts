import { describe, expect, it } from 'vitest';
import {
  buildCadInverseSummary,
  buildCadDistanceSummary,
  buildCadMultiInverseSummary,
  cadAdjustTraverse,
  cadComputeDeflectionAnglePoint,
  cadComputeTurnedAnglePoint,
  cadExtendLineByDistance,
  cadIntersectBearingDistance,
  cadIntersectBearings,
  cadIntersectDistanceDistance,
  cadIntersectLineCircle,
  cadIntersectOffsetLines,
  cadIntersectPerpendicular,
  cadIntersectSkew,
  cadOffsetPointFromLine,
  cadPointAtDistanceAlongLine,
  cadPointAtFractionAlongLine,
  cadPointFromBearingDistance,
  formatCadBearing,
  buildCadBatchCogoReportRows,
  buildCadBatchCogoSummary,
  cadDraftBatchCogo,
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentEndStation,
  cadAlignmentLength,
  cadAlignmentRawStationToDisplayStation,
  cadBuildAlignmentStationPoints,
  cadBuildAlignmentDraft,
  cadPointAtAlignmentStationOffset,
  cadPointAtAlignmentStation,
  cadProjectPointToAlignment,
} from './cadCogoTestSupport';

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

  it('builds deterministic alignment chains from selected line and arc entities', () => {
    const alignment = cadBuildAlignmentDraft([
      {
        id: 'arc:test',
        type: 'arc',
        layerId: 'planning',
        visible: true,
        locked: false,
        centerX: 10,
        centerY: 10,
        radius: Math.sqrt(200),
        startAngleDeg: -45,
        endAngleDeg: 45,
      },
      {
        id: 'line:test',
        type: 'line',
        layerId: 'planning',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'B',
        fromX: 0,
        fromY: 0,
        toX: 20,
        toY: 0,
        sourceObservationIds: [],
      },
    ]);

    expect(alignment).not.toBeNull();
    expect(alignment?.elements).toHaveLength(2);
    expect(alignment?.elements[0]?.kind).toBe('line');
    expect(alignment?.elements[1]?.kind).toBe('arc');
    expect(alignment?.startPoint).toEqual({ x: 0, y: 0 });
    expect(alignment?.endPoint.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(alignment?.endPoint.y ?? Number.NaN).toBeCloseTo(20, 6);
    expect(cadAlignmentLength(alignment?.elements ?? [])).toBeCloseTo(alignment?.totalLength ?? Number.NaN, 6);
  });

  it('projects stations on alignment line and arc elements', () => {
    const elements = [
      {
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      },
      {
        kind: 'arc',
        center: { x: 10, y: 10 },
        radius: 10,
        startAngleDeg: -90,
        endAngleDeg: 0,
      },
    ] as const;

    const lineProjection = cadProjectPointToAlignment(elements, { x: 4, y: 3 });
    expect(lineProjection).not.toBeNull();
    expect(lineProjection?.station ?? Number.NaN).toBeCloseTo(4, 6);
    expect(lineProjection?.offset ?? Number.NaN).toBeCloseTo(3, 6);

    const arcProjection = cadProjectPointToAlignment(elements, {
      x: 10 + Math.cos((-45 * Math.PI) / 180) * 10,
      y: 10 + Math.sin((-45 * Math.PI) / 180) * 10,
    });
    expect(arcProjection).not.toBeNull();
    expect(arcProjection?.station ?? Number.NaN).toBeGreaterThan(10);
    expect(arcProjection?.offset ?? Number.NaN).toBeCloseTo(0, 6);

    const pointAtStation = cadPointAtAlignmentStation(
      { elements: [...elements], startStation: 100 },
      100 + 10 + Math.PI * 5,
    );
    expect(pointAtStation?.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(pointAtStation?.y ?? Number.NaN).toBeCloseTo(10, 6);

    const lineOffsetPoint = cadPointAtAlignmentStationOffset(
      { elements: [...elements], startStation: 100 },
      104,
      3,
    );
    expect(lineOffsetPoint?.point.x ?? Number.NaN).toBeCloseTo(4, 6);
    expect(lineOffsetPoint?.point.y ?? Number.NaN).toBeCloseTo(3, 6);

    const arcOffsetPoint = cadPointAtAlignmentStationOffset(
      { elements: [...elements], startStation: 100 },
      100 + 10 + Math.PI * 5,
      2,
    );
    expect(arcOffsetPoint?.point.x ?? Number.NaN).toBeCloseTo(18, 6);
    expect(arcOffsetPoint?.point.y ?? Number.NaN).toBeCloseTo(10, 6);

    const stationPoints = cadBuildAlignmentStationPoints(
      { elements: [...elements], startStation: 100 },
      { startStation: 100, endStation: 100 + 10 + Math.PI * 5, interval: 5 },
    );
    expect(stationPoints).toHaveLength(7);
    expect(stationPoints[0]?.station ?? Number.NaN).toBeCloseTo(100, 6);
    expect(stationPoints[1]?.point.x ?? Number.NaN).toBeCloseTo(5, 6);
    expect(stationPoints[1]?.point.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(stationPoints.at(-1)?.point.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(stationPoints.at(-1)?.point.y ?? Number.NaN).toBeCloseTo(10, 6);

    const equationAlignment = {
      elements: [...elements],
      startStation: 100,
      stationEquations: [{ backStation: 110, aheadStation: 120, rawStation: 110 }],
    };
    expect(cadAlignmentDisplayStationToRawStation(equationAlignment, 100)).toBeCloseTo(100, 6);
    expect(cadAlignmentDisplayStationToRawStation(equationAlignment, 110)).toBeCloseTo(110, 6);
    expect(cadAlignmentDisplayStationToRawStation(equationAlignment, 115)).toBeNull();
    expect(cadAlignmentDisplayStationToRawStation(equationAlignment, 120)).toBeCloseTo(110, 6);
    expect(cadAlignmentRawStationToDisplayStation(equationAlignment, 110)).toBeCloseTo(120, 6);
    expect(cadAlignmentRawStationToDisplayStation(equationAlignment, 125)).toBeCloseTo(135, 6);
    expect(cadAlignmentEndStation(equationAlignment)).toBeCloseTo(100 + 10 + Math.PI * 5 + 10, 6);

    const equationPoint = cadPointAtAlignmentStation(equationAlignment, 125);
    expect(equationPoint?.x ?? Number.NaN).toBeCloseTo(14.794255386, 6);
    expect(equationPoint?.y ?? Number.NaN).toBeCloseTo(1.224174381, 6);
  });

});
