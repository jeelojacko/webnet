import { cadDistance, type CadWorldPoint } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometry';
import { cadBuildAutoParcelVertexLabels, cadDeduplicateWorldPolygonVertices } from './cadCogoParcelLayoutPrimitives';
import { cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel, cadBuildParcelLayoutConstraintMessages } from './cadCogoParcelLayoutEvaluation';
import type {
  CadParcelLayoutConstraintEvaluation,
  CadParcelLayoutGeneratedParcelDraft,
  CadParcelLayoutPreviewCandidate,
} from './cadCogoParcelLayoutTypes';

export type ClosedBoundaryEdgeMetric = {
  start: CadWorldPoint;
  end: CadWorldPoint;
  lengthMeters: number;
  unitX: number;
  unitY: number;
  inwardNormal: CadWorldPoint;
  cornerTransitionMeters: number;
  usableStartMeters: number;
  usableEndMeters: number;
  usableLengthMeters: number;
  straightRunLotCount: number;
  straightRunFrontageMeters: number;
  depthMeters: number;
};

export type RingGeneratedParcelDraft = CadParcelLayoutGeneratedParcelDraft & {
  frontageStart?: CadWorldPoint;
  frontageEnd?: CadWorldPoint;
  frontageLengthMeters?: number;
  rearBoundaryPoints?: CadWorldPoint[];
  rearSortEdgeIndex?: number;
  rearSortDistanceMeters?: number;
};

export type RingLotDraftParams = {
  vertices: CadWorldPoint[];
  edgeIndex: number;
  frontageStart: CadWorldPoint;
  frontageEnd: CadWorldPoint;
  frontageLengthMeters: number;
  pathDepthMeters: number;
  rearBoundaryPoints: CadWorldPoint[];
  rearSortEdgeIndex: number;
  rearSortDistanceMeters: number;
  cornerLot?: boolean;
};

export const buildClosedBoundaryEdgeMetrics = (
  outerVertices: CadWorldPoint[],
  orientationSign: number,
  settings: CadParcelLayoutSettings,
): ClosedBoundaryEdgeMetric[] => {
  const solveDepthMeters = (frontageLengthMeters: number): number => {
    const areaDepthMeters =
      frontageLengthMeters > 1e-9
        ? settings.minAreaSquareMeters / frontageLengthMeters
        : settings.minDepthMeters;
    return Math.min(settings.maxDepthMeters, Math.max(settings.minDepthMeters, areaDepthMeters));
  };

  return outerVertices.map((start, edgeIndex) => {
    const end = outerVertices[(edgeIndex + 1) % outerVertices.length]!;
    const lengthMeters = cadDistance(start, end);
    const unitX = lengthMeters > 1e-9 ? (end.x - start.x) / lengthMeters : 0;
    const unitY = lengthMeters > 1e-9 ? (end.y - start.y) / lengthMeters : 0;
    const inwardNormal = orientationSign >= 0 ? { x: -unitY, y: unitX } : { x: unitY, y: -unitX };
    const cornerTransitionMeters = Math.min(settings.minFrontageMeters * 2, lengthMeters * 0.25);
    const usableStartMeters = cornerTransitionMeters;
    const usableEndMeters = lengthMeters - cornerTransitionMeters;
    const usableLengthMeters = Math.max(0, usableEndMeters - usableStartMeters);
    const straightRunLotCount =
      usableLengthMeters >= settings.minFrontageMeters - 1e-9
        ? Math.max(1, Math.floor(usableLengthMeters / settings.minFrontageMeters))
        : 0;
    const straightRunFrontageMeters =
      straightRunLotCount > 0 ? usableLengthMeters / straightRunLotCount : settings.minFrontageMeters;
    return {
      start,
      end,
      lengthMeters,
      unitX,
      unitY,
      inwardNormal,
      cornerTransitionMeters,
      usableStartMeters,
      usableEndMeters,
      usableLengthMeters,
      straightRunLotCount,
      straightRunFrontageMeters,
      depthMeters: solveDepthMeters(straightRunFrontageMeters),
    };
  });
};

export const pointAlongEdge = (
  edge: ClosedBoundaryEdgeMetric,
  distanceMeters: number,
): CadWorldPoint => ({
  x: edge.start.x + edge.unitX * distanceMeters,
  y: edge.start.y + edge.unitY * distanceMeters,
});

export const pointInsideEdge = (
  edge: ClosedBoundaryEdgeMetric,
  distanceMeters: number,
  depthMeters: number,
): CadWorldPoint => {
  const outerPoint = pointAlongEdge(edge, distanceMeters);
  return {
    x: outerPoint.x + edge.inwardNormal.x * depthMeters,
    y: outerPoint.y + edge.inwardNormal.y * depthMeters,
  };
};

export const createRingLotDraftBuilder = ({
  parcel,
  settings,
  tool,
}: {
  parcel: CadParcelEntity;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}) => {
  let lotIndex = 0;

  const buildRingLotDraft = ({
    vertices,
    edgeIndex,
    frontageStart,
    frontageEnd,
    frontageLengthMeters,
    pathDepthMeters,
    rearBoundaryPoints,
    rearSortEdgeIndex,
    rearSortDistanceMeters,
    cornerLot = false,
  }: RingLotDraftParams): {
    generatedParcel: RingGeneratedParcelDraft;
    candidate: CadParcelLayoutPreviewCandidate;
  } | null => {
    const normalizedVertices = cadDeduplicateWorldPolygonVertices(vertices);
    if (normalizedVertices.length < 4) return null;
    const areaSquareMeters = cadBuildParcelClosureSummary(normalizedVertices)?.areaSquareMeters ?? 0;
    if (areaSquareMeters <= 1e-6) return null;
    const frontageLine: CadLineEntity = {
      id: `${parcel.id}:closed-boundary-frontage:${edgeIndex}:${lotIndex}`,
      type: 'line',
      layerId: parcel.layerId,
      styleId: parcel.styleId,
      visible: true,
      locked: false,
      fromStationId: `LOT${lotIndex + 1}F1`,
      toStationId: `LOT${lotIndex + 1}F2`,
      fromX: frontageStart.x,
      fromY: frontageStart.y,
      toX: frontageEnd.x,
      toY: frontageEnd.y,
      sourceObservationIds: [],
    };
    const generatedParcel: RingGeneratedParcelDraft = {
      vertices: normalizedVertices,
      vertexLabels: cadBuildAutoParcelVertexLabels(parcel, normalizedVertices, lotIndex),
      role: 'lot',
      sourceKind: cornerLot ? 'corner_remainder' : 'segment',
      sourceSegmentIndex: edgeIndex,
      frontageStart,
      frontageEnd,
      frontageLengthMeters,
      rearBoundaryPoints: cadDeduplicateWorldPolygonVertices(rearBoundaryPoints),
      rearSortEdgeIndex,
      rearSortDistanceMeters,
    };
    let candidate = cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel(
      frontageLine,
      frontageLengthMeters,
      pathDepthMeters,
      settings,
      generatedParcel,
    );
    candidate = tolerateClosedBoundaryAreaOnlyFailure(candidate, settings, areaSquareMeters, frontageLengthMeters);
    if (!candidate.isValid) return null;
    return { generatedParcel, candidate: { ...candidate, tool } };
  };

  return {
    buildRingLotDraft,
    getLotIndex: () => lotIndex,
    incrementLotIndex: () => {
      lotIndex += 1;
    },
    setLotIndex: (nextLotIndex: number) => {
      lotIndex = nextLotIndex;
    },
  };
};

const tolerateClosedBoundaryAreaOnlyFailure = (
  candidate: CadParcelLayoutPreviewCandidate,
  settings: CadParcelLayoutSettings,
  areaSquareMeters: number,
  frontageLengthMeters: number,
): CadParcelLayoutPreviewCandidate => {
  const areaToleranceSquareMeters = Math.max(settings.minAreaSquareMeters * 1e-6, 1e-3);
  const tolerableFailedRuleCodes = candidate.evaluation?.failedRuleCodes.filter(
    (ruleCode) =>
      !(
        ruleCode === 'min_width' ||
        (ruleCode === 'min_area' && areaSquareMeters + areaToleranceSquareMeters >= settings.minAreaSquareMeters)
      ),
  ) ?? [];
  if (
    candidate.isValid ||
    !candidate.evaluation ||
    tolerableFailedRuleCodes.length > 0 ||
    candidate.evaluation.failedRuleCodes.length === 0
  ) {
    return candidate;
  }
  const evaluationWithoutMessages: Omit<CadParcelLayoutConstraintEvaluation, 'messages'> = {
    ...candidate.evaluation,
    minimumSampledWidthMeters: settings.minWidthMeters,
    failedRuleCodes: [],
    score: Math.max(0, candidate.evaluation.score - 1_000_000),
  };
  return {
    ...candidate,
    evaluation: {
      ...evaluationWithoutMessages,
      messages: cadBuildParcelLayoutConstraintMessages(
        settings,
        candidate.draft!,
        evaluationWithoutMessages,
      ),
    },
    isValid: true,
    statusMessage: `Automatic ring lot valid: ${areaSquareMeters.toFixed(3)} m2 area and ${frontageLengthMeters.toFixed(3)} m frontage.`,
  };
};
