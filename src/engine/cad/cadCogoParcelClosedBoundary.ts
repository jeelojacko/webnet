import type { CadWorldPoint } from './cadGeometry';
import type { CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary, cadPolygonSignedAreaDouble } from './cadCogoParcelGeometry';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import { cadBuildAutoParcelVertexLabels, cadSimplifyCollinearWorldPolygonVertices } from './cadCogoParcelLayoutPrimitives';
import {
  buildClosedBoundaryEdgeMetrics,
  createRingLotDraftBuilder,
  pointAlongEdge,
  pointInsideEdge,
  type RingGeneratedParcelDraft,
  type RingLotDraftParams,
} from './cadCogoParcelClosedBoundaryHelpers';
import type {
  CadParcelAutoLayoutDraft,
  CadParcelLayoutPreviewCandidate,
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
  const edgeMetrics = buildClosedBoundaryEdgeMetrics(outerVertices, orientationSign, settings);
  if (edgeMetrics.some((edge) => edge.lengthMeters <= 1e-9)) return null;

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
  const ringLotBuilder = createRingLotDraftBuilder({ parcel, settings, tool });
  const addRingLot = (params: RingLotDraftParams) => {
    const built = ringLotBuilder.buildRingLotDraft(params);
    if (!built) return null;
    const generatedIndex = generatedParcels.length;
    const candidateIndex = acceptedCandidates.length;
    generatedParcels.push(built.generatedParcel);
    acceptedCandidates.push(built.candidate);
    ringLotBuilder.incrementLotIndex();
    return { generatedIndex, candidateIndex };
  };
  const replaceRingLot = (
    indexes: { generatedIndex: number; candidateIndex: number },
    params: RingLotDraftParams,
  ): boolean => {
    const built = ringLotBuilder.buildRingLotDraft(params);
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
      lotIndexStart: ringLotBuilder.getLotIndex(),
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
      ringLotBuilder.setLotIndex(splitCornerLotIndexes.lotIndexStart);
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
          frontageStart: generatedParcels[previousStraightLot.generatedIndex]!.frontageStart ?? outerBeforeCorner,
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
          frontageEnd: generatedParcels[currentStraightLot.generatedIndex]!.frontageEnd ?? outerAfterCorner,
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
          frontageEnd: generatedParcels[currentStraightLot.generatedIndex]!.frontageEnd ?? outerAfterCorner,
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
          frontageStart: generatedParcels[previousStraightLot.generatedIndex]!.frontageStart ?? outerBeforeCorner,
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
