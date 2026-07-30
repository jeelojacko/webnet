import { describe, expect, it } from 'vitest';
import {
  cadBuildArcFromThreePoints,
  cadBuildArcFromChordBearingRadius,
  cadBuildArcFromPiRadiusDelta,
  cadBuildCompoundCurve,
  cadBuildCurveMetricsSummaryFromRadiusDelta,
  cadBuildCurveMetricsFromArcLength,
  cadBuildCurveMetricsFromChordLength,
  cadBuildCurveMetricsFromRadiusDelta,
  cadBuildCurveMetricsFromTangentLength,
  cadBuildReverseCurve,
  cadBuildParallelLine,
  cadBuildPerpendicularFoot,
  cadBuildTangentCurve,
  cadIntersectLineLikeEntities,
  cadIntersectArcEntities,
  cadIntersectLineArcEntity,
  cadOffsetLineSegment,
  cadSolveCurveMetrics,
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildContinuedArc,
  cadBuildOffsetAlignmentDraft,
} from './cadCogoTestSupport';

describe('Survey CAD COGO helpers', () => {
  it('builds continuous offset alignments from tangent line-arc chains', () => {
    const draft = cadBuildOffsetAlignmentDraft(
      {
        elements: [
          {
            kind: 'line',
            start: { x: 0, y: 0 },
            end: { x: 100, y: 0 },
          },
          {
            kind: 'arc',
            center: { x: 100, y: 50 },
            radius: 50,
            startAngleDeg: -90,
            endAngleDeg: 0,
          },
        ],
        startStation: 0,
      },
      10,
    );

    expect(draft).not.toBeNull();
    expect(draft?.elements).toHaveLength(2);
    expect(draft?.elements[0]).toEqual({
      kind: 'line',
      start: { x: 0, y: 10 },
      end: { x: 100, y: 10 },
      sourceEntityId: undefined,
    });
    expect(draft?.elements[1]?.kind).toBe('arc');
    if (!draft || draft.elements[1]?.kind !== 'arc') {
      throw new Error('Expected offset arc element');
    }
    expect(draft.elements[1].radius).toBeCloseTo(40, 6);
    expect(draft.elements[1].startAngleDeg).toBeCloseTo(270, 6);
    expect(draft.elements[1].endAngleDeg).toBeCloseTo(360, 6);
    expect(draft.startPoint.x).toBeCloseTo(0, 6);
    expect(draft.startPoint.y).toBeCloseTo(10, 6);
    expect(draft.endPoint.x).toBeCloseTo(140, 6);
    expect(draft.endPoint.y).toBeCloseTo(50, 6);
    expect(draft.totalLength).toBeCloseTo(100 + 20 * Math.PI, 6);
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

});
