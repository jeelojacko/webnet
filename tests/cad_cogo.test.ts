import { describe, expect, it } from 'vitest';
import {
  buildCadInverseSummary,
  buildCadDistanceSummary,
  buildCadMultiInverseSummary,
  cadBuildParcelGapDiagnostics,
  cadBuildParcelLineworkDiagnostics,
  cadBuildParcelOverlapDiagnostics,
  cadBuildParcelSplitByAreaDraft,
  cadBuildParcelSplitByBearingDraft,
  cadBuildParcelSplitByLineDraft,
  cadBuildParcelSplitBySlideDraft,
  cadBuildParcelSplitBySwingDraft,
  cadBuildParcelLayoutPreviewCandidate,
  cadBuildParcelAutoLayoutDraft,
  cadBuildParcelAutoLayoutDraftFromFrontageReference,
  cadBuildParcelFrontageStripAutoLayoutDraft,
  cadBuildParcelLayoutFrontageReference,
  cadEvaluateParcelLayoutConstraints,
  cadConvertAreaSquareMeters,
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
import type { CadParcelLayoutSettings, CadParcelEntity, CadLineEntity } from '../src/engine/cad/cadTypes';
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
import {
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentEndStation,
  cadAlignmentLength,
  cadAlignmentRawStationToDisplayStation,
  cadBuildOffsetAlignmentDraft,
  cadBuildAlignmentStationPoints,
  cadBuildAlignmentDraft,
  cadPointAtAlignmentStationOffset,
  cadPointAtAlignmentStation,
  cadProjectPointToAlignment,
} from '../src/engine/cad/cadAlignment';

describe('Survey CAD COGO helpers', () => {
  const parcelLayoutTestParcel: CadParcelEntity = {
    id: 'parcel:layout',
    type: 'parcel',
    layerId: 'parcels',
    styleId: 'style-parcel',
    visible: true,
    locked: false,
    parcelName: 'Layout Parcel',
    vertices: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ],
    vertexLabels: ['A', 'B', 'C', 'D'],
  };

  const parcelLayoutFrontage: CadLineEntity = {
    id: 'line:A|B',
    type: 'line',
    layerId: 'planning',
    styleId: 'style-observation-line',
    visible: true,
    locked: false,
    fromStationId: 'A',
    toStationId: 'B',
    fromX: 0,
    fromY: 0,
    toX: 80,
    toY: 0,
    sourceObservationIds: [],
  };

  const parcelLayoutSettings = (
    overrides: Partial<CadParcelLayoutSettings> = {},
  ): CadParcelLayoutSettings => ({
    minAreaSquareMeters: 1200,
    minFrontageMeters: 20,
    useFrontageAtOffset: false,
    frontageOffsetMeters: 10,
    minWidthMeters: 10,
    minDepthMeters: 20,
    useMaxDepth: false,
    maxDepthMeters: 150,
    solutionPreference: 'shortest_frontage',
    automaticMode: 'off',
    remainderDistribution: 'place_remainder_in_last_parcel',
    ...overrides,
  });

  const parcelLayoutOffsetTestParcel: CadParcelEntity = {
    id: 'parcel:offset',
    type: 'parcel',
    layerId: 'parcels',
    styleId: 'style-parcel',
    visible: true,
    locked: false,
    parcelName: 'Offset Parcel',
    vertices: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ],
    vertexLabels: ['A', 'B', 'C', 'D'],
  };

  const parcelLayoutScoreTestParcel: CadParcelEntity = {
    id: 'parcel:score',
    type: 'parcel',
    layerId: 'parcels',
    styleId: 'style-parcel',
    visible: true,
    locked: false,
    parcelName: 'Score Parcel',
    vertices: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ],
    vertexLabels: ['A', 'B', 'C', 'D'],
  };

  const parcelLayoutScoreFrontage: CadLineEntity = {
    ...parcelLayoutFrontage,
    toStationId: 'B2',
    toX: 50,
  };

  const parcelLayoutAutoTestParcel: CadParcelEntity = {
    id: 'parcel:auto',
    type: 'parcel',
    layerId: 'parcels',
    styleId: 'style-parcel',
    visible: true,
    locked: false,
    parcelName: 'Auto Parcel',
    vertices: [
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 90, y: 60 },
      { x: 0, y: 60 },
    ],
    vertexLabels: ['A', 'B', 'C', 'D'],
  };

  const parcelLayoutAutoFrontage: CadLineEntity = {
    ...parcelLayoutFrontage,
    toStationId: 'B3',
    toX: 90,
  };

  const parcelLayoutOffsetFrontage: CadLineEntity = {
    ...parcelLayoutFrontage,
    toX: 40,
  };

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

  it('builds an implied-closure parcel report from an open point sequence', () => {
    const report = cadBuildParcelReportSummary({
      parcelName: 'Area Sequence',
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
      vertexLabels: ['A', 'B', 'C'],
    });

    expect(report).not.toBeNull();
    expect(report?.courseCount).toBe(3);
    expect(report?.areaSquareMeters ?? Number.NaN).toBeCloseTo(50, 6);
    expect(report?.perimeterMeters ?? Number.NaN).toBeCloseTo(34.142136, 6);
    expect(report?.closureDeltaX ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(report?.closureDeltaY ?? Number.NaN).toBeCloseTo(-10, 6);
    expect(report?.closureDistanceMeters ?? Number.NaN).toBeCloseTo(14.142136, 6);
    expect(report?.courses.map((course) => `${course.fromLabel}-${course.toLabel}`)).toEqual([
      'A-B',
      'B-C',
      'C-A',
    ]);
  });

  it('diagnoses open ends and overlaps in parcel linework', () => {
    const diagnostics = cadBuildParcelLineworkDiagnostics([
      {
        id: 'line:A|B:1',
        type: 'line',
        layerId: 'planning',
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
        id: 'line:B|C',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'B',
        toStationId: 'C',
        fromX: 10,
        fromY: 0,
        toX: 20,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:A|B:2',
        type: 'line',
        layerId: 'planning',
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
    ]);

    expect(diagnostics.lineCount).toBe(3);
    expect(diagnostics.nodeCount).toBe(3);
    expect(diagnostics.componentCount).toBe(1);
    expect(diagnostics.isClosedLoopCandidate).toBe(false);
    expect(diagnostics.danglingNodes.map((node) => node.label)).toEqual(['C']);
    expect(diagnostics.branchNodes.map((node) => node.label)).toEqual(['B']);
    expect(diagnostics.overlapSegments).toEqual([
      {
        firstLabel: 'A',
        secondLabel: 'B',
        segmentCount: 2,
        lengthMeters: 10,
      },
    ]);
  });

  it('splits a parcel by a crossing line into two child loops', () => {
    const split = cadBuildParcelSplitByLineDraft(
      {
        id: 'parcel:1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      {
        id: 'line:split',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'S1',
        toStationId: 'S2',
        fromX: 20,
        fromY: -5,
        toX: 20,
        toY: 20,
        sourceObservationIds: [],
      },
    );

    expect(split).not.toBeNull();
    const childAreas = [split?.firstVertices ?? [], split?.secondVertices ?? []]
      .map((vertices) => cadBuildParcelClosureSummary(vertices)?.areaSquareMeters ?? Number.NaN)
      .sort((left, right) => left - right);
    expect(split?.splitStart.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitStart.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(split?.splitEnd.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitEnd.y ?? Number.NaN).toBeCloseTo(12, 6);
    expect(childAreas[0]).toBeCloseTo(67.5, 6);
    expect(childAreas[1]).toBeCloseTo(120, 6);
  });

  it('splits a parcel by a through-point bearing into two child loops', () => {
    const split = cadBuildParcelSplitByBearingDraft(
      {
        id: 'parcel:1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      { x: 20, y: 6 },
      'N00-00-00E',
    );

    expect(split).not.toBeNull();
    const childAreas = [split?.firstVertices ?? [], split?.secondVertices ?? []]
      .map((vertices) => cadBuildParcelClosureSummary(vertices)?.areaSquareMeters ?? Number.NaN)
      .sort((left, right) => left - right);
    expect(split?.splitStart.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitStart.y ?? Number.NaN).toBeCloseTo(0, 6);
    expect(split?.splitEnd.x ?? Number.NaN).toBeCloseTo(20, 6);
    expect(split?.splitEnd.y ?? Number.NaN).toBeCloseTo(12, 6);
    expect(childAreas[0]).toBeCloseTo(67.5, 6);
    expect(childAreas[1]).toBeCloseTo(120, 6);
  });

  it('splits a parcel by a through-point target area into two child loops', () => {
    const split = cadBuildParcelSplitByAreaDraft(
      {
        id: 'parcel:1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      { x: 20, y: 6 },
      67.5,
    );

    expect(split).not.toBeNull();
    const childAreas = [split?.firstVertices ?? [], split?.secondVertices ?? []]
      .map((vertices) => cadBuildParcelClosureSummary(vertices)?.areaSquareMeters ?? Number.NaN)
      .sort((left, right) => left - right);
    expect(childAreas[0]).toBeCloseTo(67.5, 2);
    expect(childAreas[1]).toBeCloseTo(120, 2);
  });

  it('builds a parcel slide draft from a matched frontage edge', () => {
    const layoutDraft = cadBuildParcelSplitBySlideDraft(
      {
        id: 'parcel:1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      {
        id: 'line:A|P1',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'P1',
        fromX: 0,
        fromY: 0,
        toX: 25,
        toY: 0,
        sourceObservationIds: [],
      },
      67.5,
      10,
      'start',
    );

    expect(layoutDraft).not.toBeNull();
    expect(layoutDraft?.alternative).toBe('start');
    expect(layoutDraft?.frontageLengthMeters ?? Number.NaN).toBeCloseTo(15, 2);
    expect(layoutDraft?.childAreaSquareMeters ?? Number.NaN).toBeCloseTo(67.5, 2);
  });

  it('builds a parcel swing draft from a matched frontage edge', () => {
    const layoutDraft = cadBuildParcelSplitBySwingDraft(
      {
        id: 'parcel:1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 25, y: 0 },
          { x: 25, y: 15 },
        ],
        vertexLabels: ['A', 'P1', 'P2'],
      },
      {
        id: 'line:A|P1',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'A',
        toStationId: 'P1',
        fromX: 0,
        fromY: 0,
        toX: 25,
        toY: 0,
        sourceObservationIds: [],
      },
      67.5,
      10,
      'start',
    );

    expect(layoutDraft).not.toBeNull();
    expect(layoutDraft?.alternative).toBe('start');
    expect(layoutDraft?.frontageLengthMeters ?? Number.NaN).toBeCloseTo(25, 6);
    expect(layoutDraft?.childAreaSquareMeters ?? Number.NaN).toBeCloseTo(67.5, 2);
  });

  it('evaluates a valid slide preview candidate with width and depth metrics', () => {
    const candidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutTestParcel,
      parcelLayoutFrontage,
      parcelLayoutSettings(),
      'slide',
      'start',
    );

    expect(candidate.draft).not.toBeNull();
    expect(candidate.evaluation).not.toBeNull();
    expect(candidate.isValid).toBe(true);
    expect(candidate.evaluation?.minimumSampledWidthMeters ?? Number.NaN).toBeCloseTo(
      candidate.draft?.frontageLengthMeters ?? Number.NaN,
      6,
    );
    expect(candidate.evaluation?.depthMeters ?? Number.NaN).toBeCloseTo(60, 6);
  });

  it('rejects a slide preview when frontage-at-offset width fails', () => {
    const candidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutOffsetTestParcel,
      parcelLayoutOffsetFrontage,
      parcelLayoutSettings({
        useFrontageAtOffset: true,
        frontageOffsetMeters: 10,
        minAreaSquareMeters: 600,
        minFrontageMeters: 24,
      }),
      'slide',
      'start',
    );

    expect(candidate.isValid).toBe(false);
    expect(candidate.evaluation?.failedRuleCodes).toContain('frontage_at_offset');
  });

  it('rejects a swing preview when minimum depth fails', () => {
    const draft = cadBuildParcelSplitBySwingDraft(
      parcelLayoutTestParcel,
      parcelLayoutFrontage,
      1200,
      20,
      'start',
    );
    expect(draft).not.toBeNull();
    if (!draft) throw new Error('Expected swing draft');

    const evaluation = cadEvaluateParcelLayoutConstraints(
      draft,
      parcelLayoutFrontage,
      parcelLayoutSettings({ minDepthMeters: 70 }),
    );

    expect(evaluation.failedRuleCodes).toContain('min_depth');
  });

  it('scores start and end slide alternatives by solution preference', () => {
    const startCandidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutScoreTestParcel,
      parcelLayoutScoreFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 600,
        solutionPreference: 'shortest_frontage',
      }),
      'slide',
      'start',
    );
    const endCandidate = cadBuildParcelLayoutPreviewCandidate(
      parcelLayoutScoreTestParcel,
      parcelLayoutScoreFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 600,
        solutionPreference: 'shortest_frontage',
      }),
      'slide',
      'end',
    );

    expect(startCandidate.isValid).toBe(true);
    expect(endCandidate.isValid).toBe(true);
    expect(startCandidate.draft?.frontageLengthMeters ?? Number.NaN).toBeLessThan(
      endCandidate.draft?.frontageLengthMeters ?? Number.NaN,
    );
    expect(startCandidate.evaluation?.score ?? Number.NaN).toBeLessThan(
      endCandidate.evaluation?.score ?? Number.NaN,
    );
  });

  it('builds auto layout lots and keeps remainder in the last parcel', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 1200,
        minFrontageMeters: 20,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.generatedParcels).toHaveLength(4);
    expect(
      autoLayout.generatedParcels.map(
        (generatedParcel) =>
          cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? Number.NaN,
      ),
    ).toEqual([
      expect.closeTo(1200, 3),
      expect.closeTo(1200, 3),
      expect.closeTo(1200, 3),
      expect.closeTo(1800, 3),
    ]);
  });

  it('uses frontage and depth constraints to size first automatic lot when minimum area is smaller', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      {
        ...parcelLayoutAutoTestParcel,
        vertices: [
          { x: 0, y: 0 },
          { x: 1200, y: 0 },
          { x: 1200, y: 500 },
          { x: 0, y: 500 },
        ],
        vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
      },
      {
        ...parcelLayoutAutoFrontage,
        fromStationId: 'CAD1',
        toStationId: 'CAD2',
        toX: 1200,
      },
      parcelLayoutSettings({
        minAreaSquareMeters: 100,
        minFrontageMeters: 30,
        minWidthMeters: 20,
        minDepthMeters: 20,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThan(30);
    expect(autoLayout.acceptedCandidates[0]?.evaluation?.failedRuleCodes).toEqual([]);
    expect(autoLayout.acceptedCandidates[0]?.draft?.frontageLengthMeters ?? Number.NaN).toBeCloseTo(30, 3);
    expect(autoLayout.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.NaN).toBeCloseTo(15000, 3);
  });

  it('builds auto layout lots and creates a separate remainder parcel', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 1200,
        minFrontageMeters: 20,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.generatedParcels).toHaveLength(5);
    expect(autoLayout.generatedParcels.at(-1)?.role).toBe('remainder');
    expect(
      cadBuildParcelClosureSummary(autoLayout.generatedParcels.at(-1)?.vertices ?? [])?.areaSquareMeters ?? Number.NaN,
    ).toBeCloseTo(600, 3);
  });

  it('redistributes auto layout remainder across same lot count', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 1200,
        minFrontageMeters: 20,
        remainderDistribution: 'redistribute_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates).toHaveLength(3);
    expect(autoLayout.generatedParcels).toHaveLength(4);
    expect(autoLayout.generatedParcels.every((generatedParcel) => generatedParcel.role === 'lot')).toBe(true);
    expect(autoLayout.statusMessage).toContain('redistributed remainder across 4 lots');
    expect(
      autoLayout.generatedParcels.map(
        (generatedParcel) =>
          cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? Number.NaN,
      ),
    ).toEqual([
      expect.closeTo(1350, 3),
      expect.closeTo(1350, 3),
      expect.closeTo(1350, 3),
      expect.closeTo(1350, 3),
    ]);
  });

  it('builds a swing auto layout draft from the selected frontage', () => {
    const autoLayout = cadBuildParcelAutoLayoutDraft(
      parcelLayoutAutoTestParcel,
      parcelLayoutAutoFrontage,
      parcelLayoutSettings({
        minAreaSquareMeters: 300,
        minFrontageMeters: 20,
        minWidthMeters: 5,
        minDepthMeters: 5,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'swing',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates).toHaveLength(1);
    expect(autoLayout.acceptedCandidates[0]?.tool).toBe('swing');
    expect(autoLayout.generatedParcels).toHaveLength(2);
    expect(autoLayout.generatedParcels[0]?.role).toBe('lot');
    expect(autoLayout.generatedParcels[1]?.role).toBe('remainder');
  });

  it('builds auto layout across multiple frontage segments from one frontage polyline', () => {
    const frontageReference = cadBuildParcelLayoutFrontageReference({
      id: 'frontage:multi',
      type: 'polyline',
      layerId: 'planning',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 90, y: 0 },
        { x: 90, y: 60 },
      ],
      vertexLabels: ['A', 'B', 'C'],
      closed: false,
    });
    expect(frontageReference).not.toBeNull();

    const autoLayout = cadBuildParcelAutoLayoutDraftFromFrontageReference(
      parcelLayoutAutoTestParcel,
      frontageReference!,
      parcelLayoutSettings({
        minAreaSquareMeters: 600,
        minFrontageMeters: 20,
        minWidthMeters: 10,
        minDepthMeters: 20,
        remainderDistribution: 'create_parcel_from_remainder',
      }),
      'slide',
    );

    expect(autoLayout.isValid).toBe(true);
    expect(autoLayout.acceptedCandidates.length).toBeGreaterThan(2);
    expect(autoLayout.generatedParcels.length).toBeGreaterThan(3);
    expect(autoLayout.statusMessage).toContain('selected frontage edges');
  });

  it('builds frontage-strip auto lots for the screenshot parcel fixture', () => {
    const parcel = {
      id: 'parcel:fixture',
      type: 'parcel' as const,
      layerId: 'parcels',
      styleId: 'style-parcel',
      visible: true,
      locked: false,
      parcelName: 'Parcel 1',
      vertices: [
        { x: 685672.814, y: 5091312.877 },
        { x: 686879.074, y: 5091312.877 },
        { x: 686694.912, y: 5090134.241 },
        { x: 685522.415, y: 5090336.819 },
      ],
      vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
    };
    const frontageReference = {
      sourceEntityId: parcel.id,
      displayLabel: 'CAD1-CAD2',
      sourcePointIds: ['CAD1', 'CAD2'],
      frontageLine: {
        id: `${parcel.id}:frontage-segment:0`,
        type: 'line' as const,
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        fromStationId: 'CAD1',
        toStationId: 'CAD2',
        fromX: 685672.814,
        fromY: 5091312.877,
        toX: 686879.074,
        toY: 5091312.877,
        sourceObservationIds: [],
      },
      parcelSegmentIds: ['parcel:fixture#0'],
      parcelSegmentLabelPairs: [['CAD1', 'CAD2']] as Array<readonly [string, string]>,
    };

    const autoLayout = cadBuildParcelFrontageStripAutoLayoutDraft(
      parcel,
      frontageReference.frontageLine,
      parcelLayoutSettings({
        minAreaSquareMeters: 100,
        minFrontageMeters: 30,
        minWidthMeters: 20,
        minDepthMeters: 20,
        useMaxDepth: true,
        maxDepthMeters: 150,
        remainderDistribution: 'place_remainder_in_last_parcel',
      }),
      'slide',
    );

    expect(autoLayout).not.toBeNull();
    expect(autoLayout?.isValid).toBe(true);
    expect(autoLayout?.generatedParcels).toHaveLength(40);
    expect(autoLayout?.acceptedCandidates).toHaveLength(40);
  });

  it('diagnoses overlapping parcel pairs with shared area', () => {
    const diagnostics = cadBuildParcelOverlapDiagnostics([
      {
        id: 'parcel:1',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 1',
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        vertexLabels: ['A', 'B', 'C', 'D'],
      },
      {
        id: 'parcel:2',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel 2',
        vertices: [
          { x: 5, y: 0 },
          { x: 15, y: 0 },
          { x: 15, y: 10 },
          { x: 5, y: 10 },
        ],
        vertexLabels: ['E', 'F', 'G', 'H'],
      },
    ]);

    expect(diagnostics.parcelCount).toBe(2);
    expect(diagnostics.pairCount).toBe(1);
    expect(diagnostics.overlapPairs).toHaveLength(1);
    expect(diagnostics.overlapPairs[0]?.firstParcelName).toBe('Parcel 1');
    expect(diagnostics.overlapPairs[0]?.secondParcelName).toBe('Parcel 2');
    expect(diagnostics.overlapPairs[0]?.overlapAreaSquareMeters ?? Number.NaN).toBeCloseTo(50, 6);
    expect(diagnostics.totalOverlapAreaSquareMeters).toBeCloseTo(50, 6);
  });

  it('diagnoses enclosed parcel gaps from one connected parcel coverage', () => {
    const diagnostics = cadBuildParcelGapDiagnostics([
      {
        id: 'parcel:bl',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel BL',
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        vertexLabels: ['A', 'B', 'C', 'D'],
      },
      {
        id: 'parcel:bm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel BM',
        vertices: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
        vertexLabels: ['E', 'F', 'G', 'H'],
      },
      {
        id: 'parcel:br',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel BR',
        vertices: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }],
        vertexLabels: ['I', 'J', 'K', 'L'],
      },
      {
        id: 'parcel:lm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel LM',
        vertices: [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }],
        vertexLabels: ['M', 'N', 'O', 'P'],
      },
      {
        id: 'parcel:rm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel RM',
        vertices: [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 20, y: 20 }],
        vertexLabels: ['Q', 'R', 'S', 'T'],
      },
      {
        id: 'parcel:tl',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel TL',
        vertices: [{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 30 }],
        vertexLabels: ['U', 'V', 'W', 'X'],
      },
      {
        id: 'parcel:tm',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel TM',
        vertices: [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 30 }, { x: 10, y: 30 }],
        vertexLabels: ['Y', 'Z', 'AA', 'AB'],
      },
      {
        id: 'parcel:tr',
        type: 'parcel',
        layerId: 'parcels',
        styleId: 'style-parcel',
        visible: true,
        locked: false,
        parcelName: 'Parcel TR',
        vertices: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }],
        vertexLabels: ['AC', 'AD', 'AE', 'AF'],
      },
    ]);

    expect(diagnostics.isSupported).toBe(true);
    expect(diagnostics.componentCount).toBe(2);
    expect(diagnostics.exposedLoopCount).toBe(2);
    expect(diagnostics.gapLoops).toHaveLength(1);
    expect(diagnostics.gapLoops[0]?.areaSquareMeters ?? Number.NaN).toBeCloseTo(100, 6);
    expect(diagnostics.gapLoops[0]?.centroid.x ?? Number.NaN).toBeCloseTo(15, 6);
    expect(diagnostics.gapLoops[0]?.centroid.y ?? Number.NaN).toBeCloseTo(15, 6);
    expect(diagnostics.totalGapAreaSquareMeters).toBeCloseTo(100, 6);
  });

  it('converts parcel area square meters into shared display units', () => {
    const converted = cadConvertAreaSquareMeters(187.5);

    expect(converted.hectares).toBeCloseTo(0.01875, 8);
    expect(converted.acres).toBeCloseTo(0.046332259, 8);
    expect(converted.squareFeet).toBeCloseTo(2018.2332031, 6);
  });
});
