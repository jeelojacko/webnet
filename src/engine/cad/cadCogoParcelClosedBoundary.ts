import { cadDistance, type CadWorldPoint } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary, cadPolygonSignedAreaDouble } from './cadCogoParcelGeometry';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import { cadBuildAutoParcelVertexLabels, cadDeduplicateWorldPolygonVertices, cadSimplifyCollinearWorldPolygonVertices } from './cadCogoParcelLayoutPrimitives';
import { cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel, cadBuildParcelLayoutConstraintMessages } from './cadCogoParcelLayoutEvaluation';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutConstraintEvaluation,
  type CadParcelLayoutGeneratedParcelDraft,
  type CadParcelLayoutPreviewCandidate,
} from './cadCogoParcelLayoutTypes';

export const cadBuildClosedBoundaryFrontageVertices = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
): CadWorldPoint[] | null => {
  const segmentPairs = frontageReference.parcelSegmentLabelPairs ?? [];
  if (segmentPairs.length !== parcel.vertices.length || segmentPairs.length < 3) return null;
  const orderedLabels = [segmentPairs[0]?.[0], ...segmentPairs.map((pair) => pair[1])].filter(
    (label): label is string => typeof label === 'string',
  );
  if (orderedLabels.length !== segmentPairs.length + 1) return null;
  if (orderedLabels[0] !== orderedLabels[orderedLabels.length - 1]) return null;
  const ringLabels = orderedLabels.slice(0, -1);
  const parentLabelSet = new Set(parcel.vertexLabels);
  if (ringLabels.length !== parentLabelSet.size) return null;
  if (!ringLabels.every((label) => parentLabelSet.has(label))) return null;
  const vertices = ringLabels.map((label) => {
    const vertexIndex = parcel.vertexLabels.indexOf(label);
    return vertexIndex >= 0 ? parcel.vertices[vertexIndex] ?? null : null;
  });
  if (vertices.some((vertex) => vertex == null)) return null;
  return vertices.map((vertex) => ({ x: vertex!.x, y: vertex!.y }));
};

export const cadBuildClosedBoundaryRingAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  if (!settings.useMaxDepth) return null;
  const outerVertices = cadBuildClosedBoundaryFrontageVertices(parcel, frontageReference);
  if (!outerVertices) return null;
  const outerAreaDouble = cadPolygonSignedAreaDouble(outerVertices);
  if (Math.abs(outerAreaDouble) <= 1e-9) return null;
  const orientationSign = outerAreaDouble >= 0 ? 1 : -1;
  const solveDepthMeters = (frontageLengthMeters: number): number => {
    const areaDepthMeters =
      frontageLengthMeters > 1e-9
        ? settings.minAreaSquareMeters / frontageLengthMeters
        : settings.minDepthMeters;
    return Math.min(
      settings.maxDepthMeters,
      Math.max(settings.minDepthMeters, areaDepthMeters),
    );
  };
  const edgeMetrics = outerVertices.map((start, edgeIndex) => {
    const end = outerVertices[(edgeIndex + 1) % outerVertices.length]!;
    const lengthMeters = cadDistance(start, end);
    const unitX = lengthMeters > 1e-9 ? (end.x - start.x) / lengthMeters : 0;
    const unitY = lengthMeters > 1e-9 ? (end.y - start.y) / lengthMeters : 0;
    const inwardNormal =
      orientationSign >= 0
        ? { x: -unitY, y: unitX }
        : { x: unitY, y: -unitX };
    const cornerTransitionMeters = Math.min(
      settings.minFrontageMeters * 2,
      lengthMeters * 0.25,
    );
    const usableStartMeters = cornerTransitionMeters;
    const usableEndMeters = lengthMeters - cornerTransitionMeters;
    const usableLengthMeters = Math.max(0, usableEndMeters - usableStartMeters);
    const straightRunLotCount =
      usableLengthMeters >= settings.minFrontageMeters - 1e-9
        ? Math.max(1, Math.floor(usableLengthMeters / settings.minFrontageMeters))
        : 0;
    const straightRunFrontageMeters =
      straightRunLotCount > 0
        ? usableLengthMeters / straightRunLotCount
        : settings.minFrontageMeters;
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
  if (edgeMetrics.some((edge) => edge.lengthMeters <= 1e-9)) return null;

  type RingGeneratedParcelDraft = CadParcelLayoutGeneratedParcelDraft & {
    frontageStart?: CadWorldPoint;
    frontageEnd?: CadWorldPoint;
    frontageLengthMeters?: number;
    rearBoundaryPoints?: CadWorldPoint[];
    rearSortEdgeIndex?: number;
    rearSortDistanceMeters?: number;
  };
  const generatedParcels: RingGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
  const firstStraightLotByEdgeIndex = new Map<
    number,
    { generatedIndex: number; candidateIndex: number }
  >();
  const lastStraightLotByEdgeIndex = new Map<
    number,
    { generatedIndex: number; candidateIndex: number }
  >();
  let lotIndex = 0;
  const pointAlongEdge = (
    edge: (typeof edgeMetrics)[number],
    distanceMeters: number,
  ): CadWorldPoint => ({
    x: edge.start.x + edge.unitX * distanceMeters,
    y: edge.start.y + edge.unitY * distanceMeters,
  });
  const pointInsideEdge = (
    edge: (typeof edgeMetrics)[number],
    distanceMeters: number,
    depthMeters: number,
  ): CadWorldPoint => {
    const outerPoint = pointAlongEdge(edge, distanceMeters);
    return {
      x: outerPoint.x + edge.inwardNormal.x * depthMeters,
      y: outerPoint.y + edge.inwardNormal.y * depthMeters,
    };
  };
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
  }: {
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
  }): {
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
    const areaToleranceSquareMeters = Math.max(settings.minAreaSquareMeters * 1e-6, 1e-3);
    const tolerableFailedRuleCodes = candidate.evaluation?.failedRuleCodes.filter(
      (ruleCode) =>
        !(
          ruleCode === 'min_width' ||
          (ruleCode === 'min_area' && areaSquareMeters + areaToleranceSquareMeters >= settings.minAreaSquareMeters)
        ),
    ) ?? [];
    if (
      !candidate.isValid &&
      candidate.evaluation &&
      tolerableFailedRuleCodes.length === 0 &&
      candidate.evaluation.failedRuleCodes.length > 0
    ) {
      const evaluationWithoutMessages: Omit<CadParcelLayoutConstraintEvaluation, 'messages'> = {
        ...candidate.evaluation,
        minimumSampledWidthMeters: settings.minWidthMeters,
        failedRuleCodes: [],
        score: Math.max(0, candidate.evaluation.score - 1_000_000),
      };
      candidate = {
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
    }
    if (!candidate.isValid) return null;
    return {
      generatedParcel,
      candidate: {
        ...candidate,
        tool,
      },
    };
  };
  const addRingLot = (params: Parameters<typeof buildRingLotDraft>[0]) => {
    const built = buildRingLotDraft(params);
    if (!built) return null;
    const generatedIndex = generatedParcels.length;
    const candidateIndex = acceptedCandidates.length;
    generatedParcels.push(built.generatedParcel);
    acceptedCandidates.push(built.candidate);
    lotIndex += 1;
    return { generatedIndex, candidateIndex };
  };
  const replaceRingLot = (
    indexes: { generatedIndex: number; candidateIndex: number },
    params: Parameters<typeof buildRingLotDraft>[0],
  ): boolean => {
    const built = buildRingLotDraft(params);
    if (!built) return false;
    generatedParcels[indexes.generatedIndex] = built.generatedParcel;
    acceptedCandidates[indexes.candidateIndex] = built.candidate;
    return true;
  };

  for (let edgeIndex = 0; edgeIndex < edgeMetrics.length; edgeIndex += 1) {
    const edge = edgeMetrics[edgeIndex]!;
    if (edge.straightRunLotCount === 0) continue;
    for (let splitIndex = 0; splitIndex < edge.straightRunLotCount; splitIndex += 1) {
      const startDistanceMeters =
        edge.usableStartMeters + (edge.usableLengthMeters * splitIndex) / edge.straightRunLotCount;
      const endDistanceMeters =
        edge.usableStartMeters +
        (edge.usableLengthMeters * (splitIndex + 1)) / edge.straightRunLotCount;
      const frontageLengthMeters = endDistanceMeters - startDistanceMeters;
      const depthMeters = edge.depthMeters;
      const addedLot = addRingLot({
        vertices: [
          pointAlongEdge(edge, startDistanceMeters),
          pointAlongEdge(edge, endDistanceMeters),
          pointInsideEdge(edge, endDistanceMeters, depthMeters),
          pointInsideEdge(edge, startDistanceMeters, depthMeters),
        ],
        edgeIndex,
        frontageStart: pointAlongEdge(edge, startDistanceMeters),
        frontageEnd: pointAlongEdge(edge, endDistanceMeters),
        frontageLengthMeters,
        pathDepthMeters: depthMeters,
        rearBoundaryPoints: [
          pointInsideEdge(edge, startDistanceMeters, depthMeters),
          pointInsideEdge(edge, endDistanceMeters, depthMeters),
        ],
        rearSortEdgeIndex: edgeIndex,
        rearSortDistanceMeters: startDistanceMeters,
      });
      if (addedLot) {
        if (!firstStraightLotByEdgeIndex.has(edgeIndex)) {
          firstStraightLotByEdgeIndex.set(edgeIndex, addedLot);
        }
        lastStraightLotByEdgeIndex.set(edgeIndex, addedLot);
      }
    }
  }

  for (let vertexIndex = 0; vertexIndex < outerVertices.length; vertexIndex += 1) {
    const previousEdgeIndex = (vertexIndex + edgeMetrics.length - 1) % edgeMetrics.length;
    const previousEdge = edgeMetrics[previousEdgeIndex]!;
    const currentEdge = edgeMetrics[vertexIndex]!;
    const outerBeforeCorner = pointAlongEdge(
      previousEdge,
      previousEdge.lengthMeters - previousEdge.cornerTransitionMeters,
    );
    const outerCorner = outerVertices[vertexIndex]!;
    const outerAfterCorner = pointAlongEdge(currentEdge, currentEdge.cornerTransitionMeters);
    const innerBeforeCorner = pointInsideEdge(
      previousEdge,
      previousEdge.lengthMeters - previousEdge.cornerTransitionMeters,
      previousEdge.depthMeters,
    );
    const innerAfterCorner = pointInsideEdge(
      currentEdge,
      currentEdge.cornerTransitionMeters,
      currentEdge.depthMeters,
    );
    const rearMidpoint = {
      x: (innerBeforeCorner.x + innerAfterCorner.x) / 2,
      y: (innerBeforeCorner.y + innerAfterCorner.y) / 2,
    };
    const splitCornerLotIndexes = {
      generatedStart: generatedParcels.length,
      candidateStart: acceptedCandidates.length,
      lotIndexStart: lotIndex,
    };
    const splitFirstAccepted = addRingLot({
      vertices: [
        outerBeforeCorner,
        outerCorner,
        rearMidpoint,
        innerBeforeCorner,
      ],
      edgeIndex: previousEdgeIndex,
      frontageStart: outerBeforeCorner,
      frontageEnd: outerCorner,
      frontageLengthMeters: previousEdge.cornerTransitionMeters,
      pathDepthMeters: previousEdge.depthMeters,
      rearBoundaryPoints: [
        innerBeforeCorner,
        rearMidpoint,
      ],
      rearSortEdgeIndex: previousEdgeIndex,
      rearSortDistanceMeters: previousEdge.lengthMeters - previousEdge.cornerTransitionMeters,
      cornerLot: true,
    });
    const splitSecondAccepted = addRingLot({
      vertices: [
        outerCorner,
        outerAfterCorner,
        innerAfterCorner,
        rearMidpoint,
      ],
      edgeIndex: vertexIndex,
      frontageStart: outerCorner,
      frontageEnd: outerAfterCorner,
      frontageLengthMeters: currentEdge.cornerTransitionMeters,
      pathDepthMeters: currentEdge.depthMeters,
      rearBoundaryPoints: [
        rearMidpoint,
        innerAfterCorner,
      ],
      rearSortEdgeIndex: vertexIndex,
      rearSortDistanceMeters: 0,
      cornerLot: true,
    });
    if (!splitFirstAccepted || !splitSecondAccepted) {
      generatedParcels.splice(splitCornerLotIndexes.generatedStart);
      acceptedCandidates.splice(splitCornerLotIndexes.candidateStart);
      lotIndex = splitCornerLotIndexes.lotIndexStart;
      const previousStraightLot = lastStraightLotByEdgeIndex.get(previousEdgeIndex);
      const currentStraightLot = firstStraightLotByEdgeIndex.get(vertexIndex);
      const previousSnapshot = previousStraightLot
        ? {
            generatedParcel: generatedParcels[previousStraightLot.generatedIndex],
            candidate: acceptedCandidates[previousStraightLot.candidateIndex],
          }
        : null;
      const currentSnapshot = currentStraightLot
        ? {
            generatedParcel: generatedParcels[currentStraightLot.generatedIndex],
            candidate: acceptedCandidates[currentStraightLot.candidateIndex],
          }
        : null;
      const absorbedIntoPrevious =
        previousStraightLot &&
        replaceRingLot(previousStraightLot, {
          vertices: [
            generatedParcels[previousStraightLot.generatedIndex]!.vertices[0]!,
            outerCorner,
            rearMidpoint,
            generatedParcels[previousStraightLot.generatedIndex]!.vertices.at(-1)!,
          ],
          edgeIndex: previousEdgeIndex,
          frontageStart:
            (
              generatedParcels[previousStraightLot.generatedIndex] as CadParcelLayoutGeneratedParcelDraft & {
                frontageStart?: CadWorldPoint;
              }
            ).frontageStart ?? outerBeforeCorner,
          frontageEnd: outerCorner,
          frontageLengthMeters:
            previousEdge.cornerTransitionMeters +
            (generatedParcels[previousStraightLot.generatedIndex]!.frontageLengthMeters ?? 0),
          pathDepthMeters: previousEdge.depthMeters,
          rearBoundaryPoints: [
            generatedParcels[previousStraightLot.generatedIndex]!.rearBoundaryPoints![0]!,
            rearMidpoint,
          ],
          rearSortEdgeIndex: previousEdgeIndex,
          rearSortDistanceMeters:
            generatedParcels[previousStraightLot.generatedIndex]!.rearSortDistanceMeters ?? 0,
        });
      const absorbedIntoCurrent =
        currentStraightLot &&
        replaceRingLot(currentStraightLot, {
          vertices: [
            outerCorner,
            generatedParcels[currentStraightLot.generatedIndex]!.vertices[1]!,
            generatedParcels[currentStraightLot.generatedIndex]!.vertices[2]!,
            rearMidpoint,
          ],
          edgeIndex: vertexIndex,
          frontageStart: outerCorner,
          frontageEnd:
            (
              generatedParcels[currentStraightLot.generatedIndex] as CadParcelLayoutGeneratedParcelDraft & {
                frontageEnd?: CadWorldPoint;
              }
            ).frontageEnd ?? outerAfterCorner,
          frontageLengthMeters:
            currentEdge.cornerTransitionMeters +
            (generatedParcels[currentStraightLot.generatedIndex]!.frontageLengthMeters ?? 0),
          pathDepthMeters: currentEdge.depthMeters,
          rearBoundaryPoints: [
            rearMidpoint,
            generatedParcels[currentStraightLot.generatedIndex]!.rearBoundaryPoints!.at(-1)!,
          ],
          rearSortEdgeIndex: vertexIndex,
          rearSortDistanceMeters: 0,
        });
      const absorbedIntoBoth = Boolean(absorbedIntoPrevious && absorbedIntoCurrent);
      if (
        !absorbedIntoBoth &&
        previousStraightLot &&
        previousSnapshot?.generatedParcel &&
        previousSnapshot.candidate
      ) {
        generatedParcels[previousStraightLot.generatedIndex] = previousSnapshot.generatedParcel;
        acceptedCandidates[previousStraightLot.candidateIndex] = previousSnapshot.candidate;
      }
      if (
        !absorbedIntoBoth &&
        currentStraightLot &&
        currentSnapshot?.generatedParcel &&
        currentSnapshot.candidate
      ) {
        generatedParcels[currentStraightLot.generatedIndex] = currentSnapshot.generatedParcel;
        acceptedCandidates[currentStraightLot.candidateIndex] = currentSnapshot.candidate;
      }
      const absorbedIntoCurrentOnly =
        !absorbedIntoBoth &&
        currentStraightLot &&
        replaceRingLot(currentStraightLot, {
          vertices: [
            outerBeforeCorner,
            outerCorner,
            generatedParcels[currentStraightLot.generatedIndex]!.vertices[1]!,
            generatedParcels[currentStraightLot.generatedIndex]!.vertices[2]!,
            innerBeforeCorner,
          ],
          edgeIndex: vertexIndex,
          frontageStart: outerBeforeCorner,
          frontageEnd:
            (
              generatedParcels[currentStraightLot.generatedIndex] as CadParcelLayoutGeneratedParcelDraft & {
                frontageEnd?: CadWorldPoint;
              }
            ).frontageEnd ?? outerAfterCorner,
          frontageLengthMeters:
            previousEdge.cornerTransitionMeters +
            currentEdge.cornerTransitionMeters +
            (generatedParcels[currentStraightLot.generatedIndex]!.frontageLengthMeters ?? 0),
          pathDepthMeters: Math.max(previousEdge.depthMeters, currentEdge.depthMeters),
          rearBoundaryPoints: [
            innerBeforeCorner,
            generatedParcels[currentStraightLot.generatedIndex]!.rearBoundaryPoints!.at(-1)!,
          ],
          rearSortEdgeIndex: previousEdgeIndex,
          rearSortDistanceMeters: previousEdge.lengthMeters - previousEdge.cornerTransitionMeters,
        });
      const absorbedIntoPreviousOnly =
        !absorbedIntoBoth &&
        !absorbedIntoCurrentOnly &&
        previousStraightLot &&
        replaceRingLot(previousStraightLot, {
          vertices: [
            generatedParcels[previousStraightLot.generatedIndex]!.vertices[0]!,
            outerCorner,
            outerAfterCorner,
            innerAfterCorner,
            generatedParcels[previousStraightLot.generatedIndex]!.vertices.at(-1)!,
          ],
          edgeIndex: previousEdgeIndex,
          frontageStart:
            (
              generatedParcels[previousStraightLot.generatedIndex] as CadParcelLayoutGeneratedParcelDraft & {
                frontageStart?: CadWorldPoint;
              }
            ).frontageStart ?? outerBeforeCorner,
          frontageEnd: outerAfterCorner,
          frontageLengthMeters:
            previousEdge.cornerTransitionMeters +
            currentEdge.cornerTransitionMeters +
            (generatedParcels[previousStraightLot.generatedIndex]!.frontageLengthMeters ?? 0),
          pathDepthMeters: Math.max(previousEdge.depthMeters, currentEdge.depthMeters),
          rearBoundaryPoints: [
            generatedParcels[previousStraightLot.generatedIndex]!.rearBoundaryPoints![0]!,
            innerAfterCorner,
          ],
          rearSortEdgeIndex: previousEdgeIndex,
          rearSortDistanceMeters:
            generatedParcels[previousStraightLot.generatedIndex]!.rearSortDistanceMeters ?? 0,
        });
      if (!absorbedIntoBoth && !absorbedIntoCurrentOnly && !absorbedIntoPreviousOnly) {
        addRingLot({
          vertices: [
            outerBeforeCorner,
            outerCorner,
            outerAfterCorner,
            innerAfterCorner,
            innerBeforeCorner,
          ],
          edgeIndex: previousEdgeIndex,
          frontageStart: outerBeforeCorner,
          frontageEnd: outerAfterCorner,
          frontageLengthMeters:
            previousEdge.cornerTransitionMeters + currentEdge.cornerTransitionMeters,
          pathDepthMeters: Math.max(previousEdge.depthMeters, currentEdge.depthMeters),
          rearBoundaryPoints: [
            innerBeforeCorner,
            innerAfterCorner,
          ],
          rearSortEdgeIndex: previousEdgeIndex,
          rearSortDistanceMeters: previousEdge.lengthMeters - previousEdge.cornerTransitionMeters,
          cornerLot: true,
        });
      }
    }
  }

  const centerRemainderVertices = cadSimplifyCollinearWorldPolygonVertices(
    [...generatedParcels]
      .filter((generatedParcel) => generatedParcel.role === 'lot')
      .sort((firstParcel, secondParcel) => {
        if (firstParcel.rearSortEdgeIndex !== secondParcel.rearSortEdgeIndex) {
          return (firstParcel.rearSortEdgeIndex ?? 0) - (secondParcel.rearSortEdgeIndex ?? 0);
        }
        return (firstParcel.rearSortDistanceMeters ?? 0) - (secondParcel.rearSortDistanceMeters ?? 0);
      })
      .flatMap((generatedParcel) => generatedParcel.rearBoundaryPoints ?? []),
  );
  const innerRemainderAreaSquareMeters =
    cadBuildParcelClosureSummary(centerRemainderVertices)?.areaSquareMeters ?? 0;
  if (innerRemainderAreaSquareMeters > 1e-6) {
    generatedParcels.push({
      vertices: centerRemainderVertices,
      vertexLabels: cadBuildAutoParcelVertexLabels(parcel, centerRemainderVertices, 9999),
      role: 'remainder',
    });
  }
  if (acceptedCandidates.length === 0) return null;
  return {
    tool,
    generatedParcels,
    acceptedCandidates,
    isValid: true,
    statusMessage: `Automatic closed-boundary ring prepared ${acceptedCandidates.length} lots around the selected frontage boundary.`,
  };
};
