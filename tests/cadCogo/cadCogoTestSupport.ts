export {
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
} from '../../src/engine/cad/cadCogo';
export type { CadParcelLayoutSettings, CadParcelEntity, CadLineEntity } from '../../src/engine/cad/cadTypes';
export {
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildContinuedArc,
} from '../../src/engine/cad/cadGeometry';
export {
  buildCadBatchCogoReportRows,
  buildCadBatchCogoSummary,
  cadDraftBatchCogo,
} from '../../src/engine/cad/cadBatchCogo';
export {
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
} from '../../src/engine/cad/cadAlignment';

import type { CadParcelLayoutSettings, CadParcelEntity, CadLineEntity } from '../../src/engine/cad/cadTypes';

export const parcelLayoutTestParcel: CadParcelEntity = {
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

export const parcelLayoutFrontage: CadLineEntity = {
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

export const parcelLayoutSettings = (
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

export const closedBoundaryRingTestParcel: CadParcelEntity = {
  id: 'parcel:fixture',
  type: 'parcel',
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
    { x: 685624.955, y: 5091167.336 },
  ],
  vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4', 'CAD5'],
};

export const closedBoundaryRingFrontageReference = {
  sourceEntityId: closedBoundaryRingTestParcel.id,
  displayLabel: 'CAD1-CAD2, CAD2-CAD3, CAD3-CAD4, CAD4-CAD5, CAD5-CAD1',
  sourcePointIds: ['CAD1', 'CAD2', 'CAD3', 'CAD4', 'CAD5', 'CAD1'],
  frontageLine: {
    id: `${closedBoundaryRingTestParcel.id}:frontage-segment:0`,
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
  parcelSegmentIds: [
    'parcel:fixture#0',
    'parcel:fixture#1',
    'parcel:fixture#2',
    'parcel:fixture#3',
    'parcel:fixture#4',
  ],
  parcelSegmentLabelPairs: [
    ['CAD1', 'CAD2'],
    ['CAD2', 'CAD3'],
    ['CAD3', 'CAD4'],
    ['CAD4', 'CAD5'],
    ['CAD5', 'CAD1'],
  ] as Array<readonly [string, string]>,
  sourceGeometry: {
    kind: 'polyline' as const,
    vertices: [
      { x: 685672.814, y: 5091312.877 },
      { x: 686879.074, y: 5091312.877 },
      { x: 686694.912, y: 5090134.241 },
      { x: 685522.415, y: 5090336.819 },
      { x: 685624.955, y: 5091167.336 },
      { x: 685672.814, y: 5091312.877 },
    ],
    vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4', 'CAD5', 'CAD1'],
  },
};

export const parcelLayoutOffsetTestParcel: CadParcelEntity = {
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

export const parcelLayoutScoreTestParcel: CadParcelEntity = {
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

export const parcelLayoutScoreFrontage: CadLineEntity = {
  ...parcelLayoutFrontage,
  toStationId: 'B2',
  toX: 50,
};

export const parcelLayoutAutoTestParcel: CadParcelEntity = {
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

export const parcelLayoutAutoFrontage: CadLineEntity = {
  ...parcelLayoutFrontage,
  toStationId: 'B3',
  toX: 90,
};

export const parcelLayoutOffsetFrontage: CadLineEntity = {
  ...parcelLayoutFrontage,
  toX: 40,
};

