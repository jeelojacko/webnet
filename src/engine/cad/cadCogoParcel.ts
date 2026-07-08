import {
  cadDistance,
  cadSegmentIntersection,
  type CadNamedPoint,
  type CadWorldPoint,
} from './cadGeometry';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
  CadParcelEntity,
  CadPolylineEntity,
} from './cadTypes';
import {
  type CadEntityIntersection,
  type CadIntersectionSolution,
} from './cadCogoMath';
import {
  cadBuildParcelClosureSummary,
  cadBuildParcelOverlapAreaSquareMeters,
  cadPointOnSegment,
  cadPointStrictlyInPolygon,
  cadPolygonSignedAreaDouble,
  normalizeParcelPolygonVertices,
  normalizeParcelVertexLabel,
  PARCEL_POINT_TOLERANCE,
  parcelPointsMatch,
  type CadAreaUnitSummary,
  type CadParcelClosureSummary,
  type CadParcelSourceDraft,
} from './cadCogoParcelGeometry';
export * from './cadCogoParcelGeometry';
import {
  type CadParcelSplitDraft,
} from './cadCogoParcelSplit';
export * from './cadCogoParcelSplit';
import { type CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
export * from './cadCogoParcelFrontage';
import {
  type CadParcelLayoutLocalPoint,
} from './cadCogoParcelLocalGeometry';
export * from './cadCogoParcelLocalGeometry';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutConstraintEvaluation,
  type CadParcelLayoutGeneratedParcelDraft,
  type CadParcelLayoutPreviewCandidate,
  type CadParcelLayoutSplitAlternative,
  type CadParcelLayoutSplitDraft,
} from './cadCogoParcelLayoutTypes';
export * from './cadCogoParcelLayoutTypes';
import {
  cadBuildAutoParcelVertexLabels,
  cadBuildDepthLimitedParcelFromFrontage,
  cadBuildDepthLimitedStripGeneratedParcel,
  cadBuildDepthLimitedStripRearRemainder,
  cadDeduplicateWorldPolygonVertices,
  cadDistancePointToSegment,
  cadBuildParcelLayoutFrontagePath,
  cadBuildParcelLayoutFrontageSubPath,
  cadBuildParcelLayoutGeneratedParcelFromFrontageInterval,
  cadBuildParcelLayoutPathDepthMeters,
  cadSimplifyCollinearWorldPolygonVertices,
  type CadParcelLayoutFrontagePath,
} from './cadCogoParcelLayoutPrimitives';
export * from './cadCogoParcelLayoutPrimitives';
import {
  cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel,
  cadBuildAutomaticTargetAreaSquareMeters,
  cadBuildCornerRemainderPreviewCandidate,
  cadBuildParcelLayoutConstraintMessages,
  cadBuildParcelLayoutPreviewCandidateForTargetArea,
} from './cadCogoParcelLayoutEvaluation';
export * from './cadCogoParcelLayoutEvaluation';


export const cadBuildParcelFrontagePathAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  const path = cadBuildParcelLayoutFrontagePath(parcel, frontageReference);
  if (!path || path.totalLengthMeters + 1e-9 < settings.minFrontageMeters) {
    return null;
  }
  const buildLotCandidate = (
    startDistanceMeters: number,
    endDistanceMeters: number,
    lotIndex: number,
    role: 'lot' | 'remainder',
  ) => {
    const frontageSubPath = cadBuildParcelLayoutFrontageSubPath(path, startDistanceMeters, endDistanceMeters);
    if (!frontageSubPath) return null;
    const generatedParcel =
      settings.useMaxDepth && path.segments.length === 1 && path.segments[0]?.kind === 'line'
        ? cadBuildDepthLimitedStripGeneratedParcel(
            parcel,
            frontageReference.frontageLine,
            startDistanceMeters,
            endDistanceMeters,
            settings.maxDepthMeters,
            lotIndex,
            role,
          )
        : cadBuildParcelLayoutGeneratedParcelFromFrontageInterval(
            parcel,
            path,
            startDistanceMeters,
            endDistanceMeters,
            lotIndex,
            role,
          );
    if (!generatedParcel) return null;
    const frontageLine: CadLineEntity = {
      ...frontageReference.frontageLine,
      id: `${frontageReference.frontageLine.id}:path:${lotIndex + 1}`,
      fromX: generatedParcel.frontageStart.x,
      fromY: generatedParcel.frontageStart.y,
      toX: generatedParcel.frontageEnd.x,
      toY: generatedParcel.frontageEnd.y,
    };
    const pathDepthMeters = cadBuildParcelLayoutPathDepthMeters(generatedParcel.vertices, frontageSubPath);
    const previewCandidate = cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel(
      frontageLine,
      generatedParcel.frontageLengthMeters,
      pathDepthMeters,
      settings,
      generatedParcel,
    );
    return {
      generatedParcel,
      frontageLine,
      frontageSubPath,
      pathDepthMeters,
      previewCandidate,
    };
  };
  type CadFrontagePathLotCandidate = NonNullable<ReturnType<typeof buildLotCandidate>>;

  const solveGreedyEndDistance = (
    startDistanceMeters: number,
    lotIndex: number,
  ): CadFrontagePathLotCandidate | null => {
    const minimumEndDistance = startDistanceMeters + settings.minFrontageMeters;
    if (minimumEndDistance > path.totalLengthMeters + 1e-9) return null;
    let bestValid: CadFrontagePathLotCandidate | null = null;
    let previousInvalidDistance = startDistanceMeters;
    const coarseSteps = 72;
    for (let index = 0; index < coarseSteps; index += 1) {
      const ratio = index / (coarseSteps - 1);
      const candidateEndDistance =
        minimumEndDistance + (path.totalLengthMeters - minimumEndDistance) * ratio;
      const candidate = buildLotCandidate(startDistanceMeters, candidateEndDistance, lotIndex, 'lot');
      if (candidate?.previewCandidate.isValid) {
        bestValid = candidate;
        break;
      }
      previousInvalidDistance = candidateEndDistance;
    }
    if (!bestValid) {
      return null;
    }
    let low = Math.max(minimumEndDistance, previousInvalidDistance);
    let high = bestValid.generatedParcel.frontageLengthMeters + startDistanceMeters;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const midpoint = (low + high) / 2;
      const candidate = buildLotCandidate(startDistanceMeters, midpoint, lotIndex, 'lot');
      if (candidate?.previewCandidate.isValid) {
        bestValid = candidate;
        high = midpoint;
      } else {
        low = midpoint;
      }
    }
    return bestValid;
  };

  const buildGreedyLots = (): {
    lots: CadFrontagePathLotCandidate[];
    remainderStartDistanceMeters: number;
  } => {
    const lots: CadFrontagePathLotCandidate[] = [];
    let cursor = 0;
    while (cursor + settings.minFrontageMeters <= path.totalLengthMeters + 1e-9) {
      const lotCandidate = solveGreedyEndDistance(cursor, lots.length);
      if (!lotCandidate) {
        break;
      }
      lots.push(lotCandidate);
      cursor += lotCandidate.generatedParcel.frontageLengthMeters;
      if (path.totalLengthMeters - cursor <= 1e-6) {
        cursor = path.totalLengthMeters;
        break;
      }
    }
    return {
      lots,
      remainderStartDistanceMeters: cursor,
    };
  };

  const greedy = buildGreedyLots();
  if (greedy.lots.length === 0) {
    return {
      tool: preferredTool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
    };
  }

  const buildResultFromIntervals = (
    intervals: Array<{ startDistanceMeters: number; endDistanceMeters: number; role: 'lot' | 'remainder' }>,
  ): CadParcelAutoLayoutDraft | null => {
    const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
    const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index]!;
      const candidate = buildLotCandidate(
        interval.startDistanceMeters,
        interval.endDistanceMeters,
        index,
        interval.role,
      );
      if (!candidate) return null;
      generatedParcels.push(candidate.generatedParcel);
      if (interval.role === 'lot') {
        if (!candidate.previewCandidate.isValid) {
          return {
            tool: preferredTool,
            generatedParcels: [],
            acceptedCandidates: [candidate.previewCandidate],
            isValid: false,
            statusMessage: candidate.previewCandidate.statusMessage,
          };
        }
        acceptedCandidates.push({
          ...candidate.previewCandidate,
          tool: preferredTool,
        });
      }
    }
    if (settings.useMaxDepth && path.segments.length === 1 && path.segments[0]?.kind === 'line') {
      const rearRemainder = cadBuildDepthLimitedStripRearRemainder(
        parcel,
        frontageReference.frontageLine,
        settings.maxDepthMeters,
      );
      if (rearRemainder) {
        generatedParcels.push(rearRemainder);
      }
    }
    return {
      tool: preferredTool,
      generatedParcels,
      acceptedCandidates,
      isValid: acceptedCandidates.length > 0,
      statusMessage: `Automatic fill prepared ${generatedParcels.length} frontage-path parcels from the active parent/frontage setup.`,
    };
  };

  const remainderFrontageMeters = Math.max(0, path.totalLengthMeters - greedy.remainderStartDistanceMeters);
  const greedyBoundaries = greedy.lots.reduce<number[]>(
    (boundaries, lot) => {
      boundaries.push(boundaries[boundaries.length - 1]! + lot.generatedParcel.frontageLengthMeters);
      return boundaries;
    },
    [0],
  );
  if (settings.remainderDistribution === 'redistribute_remainder') {
    const lotCount = greedy.lots.length;
    const equalFrontage = path.totalLengthMeters / lotCount;
    const redistributedIntervals = Array.from({ length: lotCount }, (_, index) => ({
      startDistanceMeters: index * equalFrontage,
      endDistanceMeters: index === lotCount - 1 ? path.totalLengthMeters : (index + 1) * equalFrontage,
      role: 'lot' as const,
    }));
    const redistributed = buildResultFromIntervals(redistributedIntervals);
    if (redistributed) {
      return {
        ...redistributed,
        statusMessage: `Automatic fill redistributed remainder across ${lotCount} lots.`,
      };
    }
    return {
      tool: preferredTool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage:
        'Automatic fill could not redistribute remainder across same lot count without breaking parcel constraints.',
    };
  }

  if (settings.remainderDistribution === 'place_remainder_in_last_parcel') {
    const intervals = greedy.lots.map((lot, index) => ({
      startDistanceMeters: greedyBoundaries[index]!,
      endDistanceMeters:
        index === greedy.lots.length - 1 && remainderFrontageMeters > 1e-6
          ? path.totalLengthMeters
          : greedyBoundaries[index + 1]!,
      role: 'lot' as const,
    }));
    const result = buildResultFromIntervals(intervals);
    return result
      ? {
          ...result,
          statusMessage: `Automatic fill prepared ${result.generatedParcels.length} parcels with remainder kept in the last parcel.`,
        }
      : null;
  }

  const intervals: Array<{
    startDistanceMeters: number;
    endDistanceMeters: number;
    role: 'lot' | 'remainder';
  }> = greedy.lots.map((lot, index) => ({
    startDistanceMeters: greedyBoundaries[index]!,
    endDistanceMeters: greedyBoundaries[index + 1]!,
    role: 'lot' as const,
  }));
  if (remainderFrontageMeters > 1e-6) {
    intervals.push({
      startDistanceMeters: greedy.remainderStartDistanceMeters,
      endDistanceMeters: path.totalLengthMeters,
      role: 'remainder' as const,
    });
  }
  return buildResultFromIntervals(intervals);
};

export const cadBuildParcelFrontageStripAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null =>
  cadBuildParcelFrontagePathAutoLayoutDraft(
    parcel,
    {
      sourceEntityId: frontageLine.id,
      displayLabel: `${frontageLine.fromStationId}-${frontageLine.toStationId}`,
      sourcePointIds: [frontageLine.fromStationId, frontageLine.toStationId],
      frontageLine,
      sourceGeometry: { kind: 'line' },
    },
    settings,
    preferredTool,
  );

const cadCloneParcelLayoutGeneratedDraft = (
  vertices: readonly CadWorldPoint[],
  vertexLabels: readonly string[],
  role: CadParcelLayoutGeneratedParcelDraft['role'],
): CadParcelLayoutGeneratedParcelDraft => ({
  vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  vertexLabels: [...vertexLabels],
  role,
});

const cadBuildParcelEntityFromGeneratedDraft = (
  sourceParcel: CadParcelEntity,
  generatedDraft: CadParcelLayoutGeneratedParcelDraft,
  preserveVertexLabels = false,
): CadParcelEntity => ({
  id: `${sourceParcel.id}:auto-draft`,
  type: 'parcel',
  layerId: sourceParcel.layerId,
  styleId: sourceParcel.styleId,
  visible: sourceParcel.visible,
  locked: sourceParcel.locked,
  parcelName: sourceParcel.parcelName,
  vertices: generatedDraft.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  vertexLabels: preserveVertexLabels
    ? [...generatedDraft.vertexLabels]
    : generatedDraft.vertices.map((_, index) => `AUTO${index + 1}`),
});

const cadCanonicalizeParcelAgainstFrontage = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
): CadParcelEntity => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  const labels =
    parcel.vertexLabels.length === vertices.length
      ? [...parcel.vertexLabels]
      : vertices.map((_, index) => normalizeParcelVertexLabel(parcel.vertexLabels[index], index));
  const vertexCount = vertices.length;
  if (vertexCount < 3) return parcel;

  const buildRotatedParcel = (
    sourceVertices: readonly CadWorldPoint[],
    sourceLabels: readonly string[],
    startIndex: number,
  ): CadParcelEntity => ({
    ...parcel,
    vertices: Array.from({ length: vertexCount }, (_, index) => ({
      x: sourceVertices[(startIndex + index) % vertexCount]!.x,
      y: sourceVertices[(startIndex + index) % vertexCount]!.y,
    })),
    vertexLabels: Array.from({ length: vertexCount }, (_, index) => sourceLabels[(startIndex + index) % vertexCount]!),
  });

  for (let index = 0; index < vertexCount; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertexCount]!;
    if (
      parcelPointsMatch(current, { x: frontageLine.fromX, y: frontageLine.fromY }) &&
      parcelPointsMatch(next, { x: frontageLine.toX, y: frontageLine.toY })
    ) {
      return buildRotatedParcel(vertices, labels, index);
    }
  }

  const reversedVertices = [...vertices].reverse();
  const reversedLabels = [...labels].reverse();
  for (let index = 0; index < vertexCount; index += 1) {
    const current = reversedVertices[index]!;
    const next = reversedVertices[(index + 1) % vertexCount]!;
    if (
      parcelPointsMatch(current, { x: frontageLine.fromX, y: frontageLine.fromY }) &&
      parcelPointsMatch(next, { x: frontageLine.toX, y: frontageLine.toY })
    ) {
      return buildRotatedParcel(reversedVertices, reversedLabels, index);
    }
  }

  return parcel;
};

const cadBuildFrontageLineFromParcelLabelPair = (
  parcel: CadParcelEntity,
  startLabel: string,
  endLabel: string,
): CadLineEntity | null => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (vertices.length < 2 || parcel.vertexLabels.length !== vertices.length) return null;
  for (let index = 0; index < vertices.length; index += 1) {
    const nextIndex = (index + 1) % vertices.length;
    const currentLabel = parcel.vertexLabels[index];
    const nextLabel = parcel.vertexLabels[nextIndex];
    if (
      (currentLabel === startLabel && nextLabel === endLabel) ||
      (currentLabel === endLabel && nextLabel === startLabel)
    ) {
      const start = vertices[index]!;
      const end = vertices[nextIndex]!;
      return {
        id: `${parcel.id}:frontage-${index}`,
        type: 'line',
        layerId: parcel.layerId,
        styleId: parcel.styleId,
        visible: parcel.visible,
        locked: parcel.locked,
        fromStationId: currentLabel ?? startLabel,
        toStationId: nextLabel ?? endLabel,
        fromX: start.x,
        fromY: start.y,
        toX: end.x,
        toY: end.y,
        sourceObservationIds: [],
      };
    }
  }
  return null;
};

const cadBuildFrontageLineFromCurrentParcelSegmentGeometry = (
  parcel: CadParcelEntity,
  originalStart: CadWorldPoint,
  originalEnd: CadWorldPoint,
): CadLineEntity | null => {
  const vertices = normalizeParcelPolygonVertices(parcel.vertices);
  if (vertices.length < 2 || parcel.vertexLabels.length !== vertices.length) return null;
  const originalLengthMeters = cadDistance(originalStart, originalEnd);
  if (originalLengthMeters <= 1e-9) return null;
  const projectRatio = (point: CadWorldPoint): number =>
    ((point.x - originalStart.x) * (originalEnd.x - originalStart.x) +
      (point.y - originalStart.y) * (originalEnd.y - originalStart.y)) /
    (originalLengthMeters * originalLengthMeters);
  const overlappingEdges: Array<{
    startRatio: number;
    endRatio: number;
    startLabel: string;
    endLabel: string;
  }> = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const nextIndex = (index + 1) % vertices.length;
    const start = vertices[index]!;
    const end = vertices[nextIndex]!;
    if (
      !cadPointOnSegment(start, originalStart, originalEnd) ||
      !cadPointOnSegment(end, originalStart, originalEnd)
    ) {
      continue;
    }
    overlappingEdges.push({
      startRatio: projectRatio(start),
      endRatio: projectRatio(end),
      startLabel: parcel.vertexLabels[index] ?? `V${index + 1}`,
      endLabel: parcel.vertexLabels[nextIndex] ?? `V${nextIndex + 1}`,
    });
  }
  if (overlappingEdges.length === 0) return null;
  const orderedEdges = overlappingEdges
    .map((edge) => ({
      ...edge,
      startRatio: Math.min(edge.startRatio, edge.endRatio),
      endRatio: Math.max(edge.startRatio, edge.endRatio),
    }))
    .sort((left, right) => left.startRatio - right.startRatio);
  let bestInterval = orderedEdges[0]!;
  let currentInterval = { ...orderedEdges[0]! };
  for (let index = 1; index < orderedEdges.length; index += 1) {
    const edge = orderedEdges[index]!;
    if (edge.startRatio <= currentInterval.endRatio + 1e-9) {
      currentInterval = {
        ...currentInterval,
        endRatio: Math.max(currentInterval.endRatio, edge.endRatio),
        endLabel: edge.endLabel,
      };
    } else {
      if (currentInterval.endRatio - currentInterval.startRatio > bestInterval.endRatio - bestInterval.startRatio) {
        bestInterval = currentInterval;
      }
      currentInterval = { ...edge };
    }
  }
  if (currentInterval.endRatio - currentInterval.startRatio > bestInterval.endRatio - bestInterval.startRatio) {
    bestInterval = currentInterval;
  }
  const clampRatio = (ratio: number): number => Math.max(0, Math.min(1, ratio));
  const startRatio = clampRatio(bestInterval.startRatio);
  const endRatio = clampRatio(bestInterval.endRatio);
  if (endRatio - startRatio <= 1e-9) return null;
  return {
    id: `${parcel.id}:frontage-overlap-merged`,
    type: 'line',
    layerId: parcel.layerId,
    styleId: parcel.styleId,
    visible: parcel.visible,
    locked: parcel.locked,
    fromStationId: bestInterval.startLabel,
    toStationId: bestInterval.endLabel,
    fromX: originalStart.x + (originalEnd.x - originalStart.x) * startRatio,
    fromY: originalStart.y + (originalEnd.y - originalStart.y) * startRatio,
    toX: originalStart.x + (originalEnd.x - originalStart.x) * endRatio,
    toY: originalStart.y + (originalEnd.y - originalStart.y) * endRatio,
    sourceObservationIds: [],
  };
};

const cadBuildFrontageLineForCurrentParcelSegment = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  segmentIndex: number,
): CadLineEntity | null => {
  const pair = frontageReference.parcelSegmentLabelPairs?.[segmentIndex] ?? null;
  if (pair) {
    const matchedByLabel = cadBuildFrontageLineFromParcelLabelPair(parcel, pair[0], pair[1]);
    if (matchedByLabel) return matchedByLabel;
  }
  const sourceVertices = frontageReference.sourceGeometry?.kind === 'polyline'
    ? frontageReference.sourceGeometry.vertices
    : null;
  if (sourceVertices && segmentIndex >= 0 && segmentIndex < sourceVertices.length - 1) {
    return cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
      parcel,
      sourceVertices[segmentIndex]!,
      sourceVertices[segmentIndex + 1]!,
    );
  }
  return null;
};

const cadBuildFrontageReferenceSubset = (
  frontageReference: CadParcelLayoutFrontageReference,
  segmentIndexes: readonly number[],
): CadParcelLayoutFrontageReference | null => {
  if (segmentIndexes.length === 0) return null;
  const sortedIndexes = [...segmentIndexes].sort((left, right) => left - right);
  for (let index = 1; index < sortedIndexes.length; index += 1) {
    if (sortedIndexes[index] !== sortedIndexes[index - 1]! + 1) {
      return null;
    }
  }
  const firstIndex = sortedIndexes[0]!;
  const frontageLine = frontageReference.parcelSegmentLabelPairs?.length
    ? null
    : frontageReference.frontageLine;
  const subsetPointIds = frontageReference.sourcePointIds.slice(
    firstIndex,
    firstIndex + sortedIndexes.length + 1,
  );
  return {
    ...frontageReference,
    sourcePointIds: subsetPointIds,
    displayLabel: subsetPointIds.join(', '),
    frontageLine: frontageLine ?? frontageReference.frontageLine,
    parcelSegmentIds: frontageReference.parcelSegmentIds?.slice(
      firstIndex,
      firstIndex + sortedIndexes.length,
    ) ?? null,
    parcelSegmentLabelPairs: frontageReference.parcelSegmentLabelPairs?.slice(
      firstIndex,
      firstIndex + sortedIndexes.length,
    ) ?? null,
    sourceGeometry:
      frontageReference.sourceGeometry?.kind === 'polyline'
        ? {
            kind: 'polyline',
            vertices: frontageReference.sourceGeometry.vertices.slice(
              firstIndex,
              firstIndex + sortedIndexes.length + 1,
            ),
            vertexLabels:
              frontageReference.sourceGeometry.vertexLabels?.slice(
                firstIndex,
                firstIndex + sortedIndexes.length + 1,
              ) ?? null,
          }
        : frontageReference.sourceGeometry,
  };
};

const cadBuildGeneratedDraftRemainderAreaSquareMeters = (
  draft: CadParcelAutoLayoutDraft,
): number =>
  draft.generatedParcels.reduce((total, generatedParcel) => {
    if (generatedParcel.role !== 'remainder') return total;
    return total + (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0);
  }, 0);

const cadGeneratedParcelDraftsMatch = (
  first: CadParcelLayoutGeneratedParcelDraft,
  second: CadParcelLayoutGeneratedParcelDraft,
): boolean =>
  first.role === second.role &&
  first.vertices.length === second.vertices.length &&
  first.vertices.every((vertex, index) => parcelPointsMatch(vertex, second.vertices[index]!));

const cadBuildCornerFrontageReference = (
  cornerParcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
): CadParcelLayoutFrontageReference | null => {
  const firstOverlap = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    cornerParcel,
    { x: firstFrontageLine.fromX, y: firstFrontageLine.fromY },
    { x: firstFrontageLine.toX, y: firstFrontageLine.toY },
  );
  const secondOverlap = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    cornerParcel,
    { x: secondFrontageLine.fromX, y: secondFrontageLine.fromY },
    { x: secondFrontageLine.toX, y: secondFrontageLine.toY },
  );
  if (!firstOverlap || !secondOverlap) return null;

  const firstPoints = [
    { x: firstOverlap.fromX, y: firstOverlap.fromY, label: firstOverlap.fromStationId },
    { x: firstOverlap.toX, y: firstOverlap.toY, label: firstOverlap.toStationId },
  ];
  const secondPoints = [
    { x: secondOverlap.fromX, y: secondOverlap.fromY, label: secondOverlap.fromStationId },
    { x: secondOverlap.toX, y: secondOverlap.toY, label: secondOverlap.toStationId },
  ];
  const sharedPair =
    firstPoints.flatMap((firstPoint) =>
      secondPoints
        .filter((secondPoint) =>
          parcelPointsMatch(firstPoint, secondPoint),
        )
        .map((secondPoint) => ({ firstPoint, secondPoint })),
    )[0] ?? null;
  if (!sharedPair) return null;
  const firstOuterPoint = firstPoints.find((point) => !parcelPointsMatch(point, sharedPair.firstPoint)) ?? null;
  const secondOuterPoint = secondPoints.find((point) => !parcelPointsMatch(point, sharedPair.secondPoint)) ?? null;
  if (!firstOuterPoint || !secondOuterPoint) return null;

  return {
    sourceEntityId: cornerParcel.id,
    displayLabel: `${firstOverlap.fromStationId}-${firstOverlap.toStationId}, ${secondOverlap.fromStationId}-${secondOverlap.toStationId}`,
    sourcePointIds: [
      firstOuterPoint.label,
      sharedPair.firstPoint.label,
      secondOuterPoint.label,
    ],
    frontageLine: {
      ...firstOverlap,
      fromStationId: firstOuterPoint.label,
      fromX: firstOuterPoint.x,
      fromY: firstOuterPoint.y,
      toStationId: sharedPair.firstPoint.label,
      toX: sharedPair.firstPoint.x,
      toY: sharedPair.firstPoint.y,
    },
    sourceGeometry: {
      kind: 'polyline',
      vertices: [
        { x: firstOuterPoint.x, y: firstOuterPoint.y },
        { x: sharedPair.firstPoint.x, y: sharedPair.firstPoint.y },
        { x: secondOuterPoint.x, y: secondOuterPoint.y },
      ],
      vertexLabels: [
        firstOuterPoint.label,
        sharedPair.firstPoint.label,
        secondOuterPoint.label,
      ],
    },
  };
};

interface CadCornerInfillDraft {
  draft: CadParcelAutoLayoutDraft;
  remainderDraft: CadParcelLayoutGeneratedParcelDraft | null;
  firstSegmentTrimMeters: number;
  secondSegmentTrimMeters: number;
}

interface CadGeneratedLotConflictPair {
  firstLotIndex: number;
  secondLotIndex: number;
  overlapAreaSquareMeters: number;
}

interface CadGeneratedParcelLotEntry {
  generatedParcelIndex: number;
  lotIndex: number;
  candidateIndex: number;
  generatedParcel: CadParcelLayoutGeneratedParcelDraft;
  candidate: CadParcelLayoutPreviewCandidate;
}

const cadBuildRemainderJunctionInfillDraft = (
  parcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadCornerInfillDraft | null => {
  const cornerFrontageReference = cadBuildCornerFrontageReference(
    parcel,
    firstFrontageLine,
    secondFrontageLine,
  );
  if (!cornerFrontageReference) return null;
  const cornerSizingVariants: CadParcelLayoutSettings[] = [
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    {
      ...settings,
      useMaxDepth: false,
      remainderDistribution: 'create_parcel_from_remainder',
    },
  ];
  const cornerSolutionPreferences: CadParcelLayoutSettings['solutionPreference'][] = [
    settings.solutionPreference,
    'closest_to_target_area',
    'smallest_area',
  ];
  const candidateDrafts: CadParcelAutoLayoutDraft[] = [];
  cornerSizingVariants.forEach((cornerSettings) => {
    cornerSolutionPreferences.forEach((solutionPreference) => {
      const variantSettings = {
        ...cornerSettings,
        solutionPreference,
      };
      const frontagePathDraft = cadBuildParcelFrontagePathAutoLayoutDraft(
        parcel,
        cornerFrontageReference,
        variantSettings,
        tool,
      );
      if (frontagePathDraft?.isValid && frontagePathDraft.acceptedCandidates.length > 0) {
        candidateDrafts.push(frontagePathDraft);
      }
      const preferredDraft = cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference(
        parcel,
        cornerFrontageReference,
        variantSettings,
        tool,
      );
      if (preferredDraft.isValid && preferredDraft.acceptedCandidates.length > 0) {
        candidateDrafts.push(preferredDraft);
      }
      const chainedDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
        parcel,
        cornerFrontageReference,
        variantSettings,
        tool,
      );
      if (chainedDraft.isValid && chainedDraft.acceptedCandidates.length > 0) {
        candidateDrafts.push(chainedDraft);
      }
    });
  });
  const resolvedDraft =
    candidateDrafts
      .map((draft) => ({
        draft,
        remainderDraft:
          draft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null,
        materialOverlapPairCount: cadBuildGeneratedParcelOverlapPairCount(
          draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
        ),
      }))
      .sort((left, right) => {
        if (left.materialOverlapPairCount !== right.materialOverlapPairCount) {
          return left.materialOverlapPairCount - right.materialOverlapPairCount;
        }
        const leftHasRemainder = left.remainderDraft != null;
        const rightHasRemainder = right.remainderDraft != null;
        if (leftHasRemainder !== rightHasRemainder) {
          return rightHasRemainder ? 1 : -1;
        }
        if (left.draft.acceptedCandidates.length !== right.draft.acceptedCandidates.length) {
          return right.draft.acceptedCandidates.length - left.draft.acceptedCandidates.length;
        }
        return left.draft.generatedParcels.length - right.draft.generatedParcels.length;
      })[0] ?? null;
  if (!resolvedDraft?.draft.isValid || resolvedDraft.draft.acceptedCandidates.length === 0) {
    return null;
  }
  const cornerLots = resolvedDraft.draft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'lot',
  );
  return {
    draft: {
      ...resolvedDraft.draft,
      generatedParcels: cornerLots,
    },
    remainderDraft: resolvedDraft.remainderDraft,
    firstSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
      firstFrontageLine,
      'end',
      cornerLots,
    ),
    secondSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
      secondFrontageLine,
      'start',
      cornerLots,
    ),
  };
};

const cadEstimateRemainingFrontageLotCapacity = (
  frontageLine: CadLineEntity,
  consumedMeters: number,
  minimumFrontageMeters: number,
): number => {
  if (minimumFrontageMeters <= 1e-9) return 0;
  const frontageLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  if (frontageLengthMeters <= 1e-9) return 0;
  const remainingMeters = Math.max(0, frontageLengthMeters - consumedMeters);
  return Math.max(0, Math.floor((remainingMeters + 1e-9) / minimumFrontageMeters));
};

const cadBuildGeneratedParcelOverlapPairCount = (
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): number => {
  return cadBuildGeneratedParcelConflictPairs(generatedParcels).length;
};

const cadBuildGeneratedParcelConflictPairs = (
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): CadGeneratedLotConflictPair[] => {
  const conflictPairs: CadGeneratedLotConflictPair[] = [];
  for (let firstIndex = 0; firstIndex < generatedParcels.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < generatedParcels.length; secondIndex += 1) {
      const firstVertices = normalizeParcelPolygonVertices(generatedParcels[firstIndex]!.vertices);
      const secondVertices = normalizeParcelPolygonVertices(generatedParcels[secondIndex]!.vertices);
      if (firstVertices.length < 3 || secondVertices.length < 3) continue;
      const hasMaterialConflict =
        firstVertices.some((point) => cadPointStrictlyInPolygon(point, secondVertices)) ||
        secondVertices.some((point) => cadPointStrictlyInPolygon(point, firstVertices)) ||
        firstVertices.some((start, index) => {
          const end = firstVertices[(index + 1) % firstVertices.length]!;
          return secondVertices.some((clipStart, clipIndex) => {
            const clipEnd = secondVertices[(clipIndex + 1) % secondVertices.length]!;
            const intersection = cadSegmentIntersection(start, end, clipStart, clipEnd);
            if (!intersection) return false;
            const touchesAtSharedVertex =
              [start, end, clipStart, clipEnd].some((vertex) => parcelPointsMatch(intersection, vertex));
            return !touchesAtSharedVertex;
          });
        });
      if (hasMaterialConflict) {
        const overlapAreaSquareMeters = cadBuildParcelOverlapAreaSquareMeters(firstVertices, secondVertices);
        if (overlapAreaSquareMeters > 1) {
          conflictPairs.push({
            firstLotIndex: firstIndex,
            secondLotIndex: secondIndex,
            overlapAreaSquareMeters,
          });
        }
      }
    }
  }
  return conflictPairs;
};

const cadBuildDraftLotEntries = ({
  generatedParcels,
  acceptedCandidates,
}: Pick<CadParcelAutoLayoutDraft, 'generatedParcels' | 'acceptedCandidates'>): CadGeneratedParcelLotEntry[] => {
  const lotEntries: CadGeneratedParcelLotEntry[] = [];
  let lotIndex = 0;
  let candidateIndex = 0;
  generatedParcels.forEach((generatedParcel, generatedParcelIndex) => {
    if (generatedParcel.role !== 'lot') return;
    const candidate = acceptedCandidates[candidateIndex];
    if (candidate) {
      lotEntries.push({
        generatedParcelIndex,
        lotIndex,
        candidateIndex,
        generatedParcel,
        candidate,
      });
    }
    lotIndex += 1;
    candidateIndex += 1;
  });
  return lotEntries;
};

const cadResolveGeneratedParcelConflicts = (
  draft: CadParcelAutoLayoutDraft,
): CadParcelAutoLayoutDraft => {
  const buildSourcePriority = (
    sourceKind: CadParcelLayoutGeneratedParcelDraft['sourceKind'],
  ): number => {
    switch (sourceKind) {
      case 'corner_remainder':
        return 0;
      case 'corner_prepass':
        return 1;
      case 'segment':
        return 2;
      default:
        return 3;
    }
  };
  const lotEntries = cadBuildDraftLotEntries(draft);
  if (lotEntries.length < 2) return draft;
  const conflictPairs = cadBuildGeneratedParcelConflictPairs(
    lotEntries.map((entry) => entry.generatedParcel),
  );
  if (conflictPairs.length === 0) return draft;

  const activeLotIndexes = new Set(lotEntries.map((entry) => entry.lotIndex));
  while (true) {
    const activeConflictPairs = conflictPairs.filter(
      (pair) =>
        activeLotIndexes.has(pair.firstLotIndex) &&
        activeLotIndexes.has(pair.secondLotIndex),
    );
    if (activeConflictPairs.length === 0) break;

    const metricsByLotIndex = new Map<
      number,
      {
        degree: number;
        overlapAreaSquareMeters: number;
      }
    >();
    activeConflictPairs.forEach((pair) => {
      const firstMetrics = metricsByLotIndex.get(pair.firstLotIndex) ?? {
        degree: 0,
        overlapAreaSquareMeters: 0,
      };
      firstMetrics.degree += 1;
      firstMetrics.overlapAreaSquareMeters += pair.overlapAreaSquareMeters;
      metricsByLotIndex.set(pair.firstLotIndex, firstMetrics);

      const secondMetrics = metricsByLotIndex.get(pair.secondLotIndex) ?? {
        degree: 0,
        overlapAreaSquareMeters: 0,
      };
      secondMetrics.degree += 1;
      secondMetrics.overlapAreaSquareMeters += pair.overlapAreaSquareMeters;
      metricsByLotIndex.set(pair.secondLotIndex, secondMetrics);
    });

    const lotToRemove =
      lotEntries
        .filter((entry) => activeLotIndexes.has(entry.lotIndex))
        .sort((left, right) => {
          const leftMetrics = metricsByLotIndex.get(left.lotIndex) ?? {
            degree: 0,
            overlapAreaSquareMeters: 0,
          };
          const rightMetrics = metricsByLotIndex.get(right.lotIndex) ?? {
            degree: 0,
            overlapAreaSquareMeters: 0,
          };
          if (leftMetrics.degree !== rightMetrics.degree) {
            return rightMetrics.degree - leftMetrics.degree;
          }
          if (
            Math.abs(leftMetrics.overlapAreaSquareMeters - rightMetrics.overlapAreaSquareMeters) >
            1e-6
          ) {
            return rightMetrics.overlapAreaSquareMeters - leftMetrics.overlapAreaSquareMeters;
          }
          const leftScore = left.candidate.evaluation?.score ?? Number.POSITIVE_INFINITY;
          const rightScore = right.candidate.evaluation?.score ?? Number.POSITIVE_INFINITY;
          const leftSourcePriority = buildSourcePriority(left.generatedParcel.sourceKind);
          const rightSourcePriority = buildSourcePriority(right.generatedParcel.sourceKind);
          if (leftSourcePriority !== rightSourcePriority) {
            return rightSourcePriority - leftSourcePriority;
          }
          if (Math.abs(leftScore - rightScore) > 1e-6) {
            return rightScore - leftScore;
          }
          const leftFrontage =
            'frontageLengthMeters' in left.generatedParcel
              ? (left.generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          const rightFrontage =
            'frontageLengthMeters' in right.generatedParcel
              ? (right.generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          if (Math.abs(leftFrontage - rightFrontage) > 1e-6) {
            return rightFrontage - leftFrontage;
          }
          return right.lotIndex - left.lotIndex;
        })[0] ?? null;
    if (!lotToRemove) break;
    activeLotIndexes.delete(lotToRemove.lotIndex);
  }

  const removedGeneratedParcelIndexes = new Set<number>();
  const removedCandidateIndexes = new Set<number>();
  lotEntries.forEach((entry) => {
    if (activeLotIndexes.has(entry.lotIndex)) return;
    removedGeneratedParcelIndexes.add(entry.generatedParcelIndex);
    removedCandidateIndexes.add(entry.candidateIndex);
  });
  if (removedGeneratedParcelIndexes.size === 0) return draft;
  const resolvedGeneratedParcels = draft.generatedParcels.filter(
    (_generatedParcel, index) => !removedGeneratedParcelIndexes.has(index),
  );
  const resolvedAcceptedCandidates = draft.acceptedCandidates.filter(
    (_candidate, index) => !removedCandidateIndexes.has(index),
  );
  return {
    ...draft,
    generatedParcels: resolvedGeneratedParcels,
    acceptedCandidates: resolvedAcceptedCandidates,
    statusMessage: `${draft.statusMessage} Removed ${removedGeneratedParcelIndexes.size} overlapping duplicate lots; kept ${resolvedAcceptedCandidates.length} lots and ${resolvedGeneratedParcels.length} parcels.`,
  };
};

const cadBuildLocalizedRemainderReplacementDraft = ({
  draft,
  replacedGeneratedParcelIndex,
  infillDraft,
}: {
  draft: CadParcelAutoLayoutDraft;
  replacedGeneratedParcelIndex: number;
  infillDraft: CadParcelAutoLayoutDraft;
}): CadParcelAutoLayoutDraft | null => {
  const remainingGeneratedParcels = draft.generatedParcels.filter(
    (_entry, index) => index !== replacedGeneratedParcelIndex,
  );
  const remainingAcceptedCandidates = [...draft.acceptedCandidates];
  const existingLotEntries = cadBuildDraftLotEntries({
    generatedParcels: remainingGeneratedParcels,
    acceptedCandidates: remainingAcceptedCandidates,
  });
  const infillLots = infillDraft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'lot',
  );
  if (existingLotEntries.length === 0 || infillLots.length === 0) return null;

  const conflictPairs = cadBuildGeneratedParcelConflictPairs([
    ...existingLotEntries.map((entry) => entry.generatedParcel),
    ...infillLots,
  ]);
  const conflictingExistingLotIndexes = new Set<number>();
  conflictPairs.forEach((pair) => {
    const firstIsExisting = pair.firstLotIndex < existingLotEntries.length;
    const secondIsExisting = pair.secondLotIndex < existingLotEntries.length;
    if (firstIsExisting === secondIsExisting) return;
    conflictingExistingLotIndexes.add(firstIsExisting ? pair.firstLotIndex : pair.secondLotIndex);
  });
  if (conflictingExistingLotIndexes.size === 0) return null;

  const removedGeneratedParcelIndexes = new Set<number>();
  const removedCandidateIndexes = new Set<number>();
  existingLotEntries.forEach((entry, localLotIndex) => {
    if (!conflictingExistingLotIndexes.has(localLotIndex)) return;
    removedGeneratedParcelIndexes.add(entry.generatedParcelIndex);
    removedCandidateIndexes.add(entry.candidateIndex);
  });
  if (removedGeneratedParcelIndexes.size === 0) return null;

  return cadResolveGeneratedParcelConflicts({
    ...draft,
    generatedParcels: [
      ...remainingGeneratedParcels.filter(
        (_entry, index) => !removedGeneratedParcelIndexes.has(index),
      ),
      ...infillDraft.generatedParcels,
    ],
    acceptedCandidates: [
      ...remainingAcceptedCandidates.filter(
        (_candidate, index) => !removedCandidateIndexes.has(index),
      ),
      ...infillDraft.acceptedCandidates,
    ],
    statusMessage: `${draft.statusMessage} Replaced ${removedGeneratedParcelIndexes.size} conflicting strip lots with localized corner fill.`,
  });
};

const cadTryFillGeneratedRemaindersFromFrontageReference = (
  sourceParcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  draft: CadParcelAutoLayoutDraft,
): CadParcelAutoLayoutDraft => {
  let workingDraft = draft;
  let filledRemainderCount = 0;
  const originalRemainders = draft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'remainder',
  );
  for (const originalRemainder of originalRemainders) {
    const generatedIndex = workingDraft.generatedParcels.findIndex((generatedParcel) =>
      cadGeneratedParcelDraftsMatch(generatedParcel, originalRemainder),
    );
    if (generatedIndex < 0) continue;
    const generatedParcel = workingDraft.generatedParcels[generatedIndex]!;
    if (generatedParcel.role !== 'remainder') continue;
    const remainderParcel = cadBuildParcelEntityFromGeneratedDraft(
      sourceParcel,
      generatedParcel,
      true,
    );
    const touchedSegmentIndexes: number[] = [];
    const segmentCount = frontageReference.parcelSegmentLabelPairs?.length ?? 1;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      if (cadBuildFrontageLineForCurrentParcelSegment(remainderParcel, frontageReference, segmentIndex)) {
        touchedSegmentIndexes.push(segmentIndex);
      }
    }

    const infillCandidateDrafts: Array<{
      draft: CadParcelAutoLayoutDraft;
      sourceKind: CadParcelLayoutGeneratedParcelDraft['sourceKind'];
    }> = [];
    if (touchedSegmentIndexes.length === 1) {
      const frontageLine = cadBuildFrontageLineForCurrentParcelSegment(
        remainderParcel,
        frontageReference,
        touchedSegmentIndexes[0]!,
      );
      if (frontageLine) {
        const selectedFrontageDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
          remainderParcel,
          frontageLine,
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          tool,
        );
        if (selectedFrontageDraft.isValid && selectedFrontageDraft.acceptedCandidates.length > 0) {
          infillCandidateDrafts.push({
            draft: selectedFrontageDraft,
            sourceKind: 'corner_remainder',
          });
        }
      }
    } else {
      const subsetReference = cadBuildFrontageReferenceSubset(frontageReference, touchedSegmentIndexes);
      const firstFrontageLine = cadBuildFrontageLineForCurrentParcelSegment(
        remainderParcel,
        frontageReference,
        touchedSegmentIndexes[0]!,
      );
      if (subsetReference && firstFrontageLine) {
        const selectedFrontageDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
          remainderParcel,
          {
            ...subsetReference,
            sourceEntityId: remainderParcel.id,
            frontageLine: firstFrontageLine,
          },
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          tool,
        );
        if (selectedFrontageDraft.isValid && selectedFrontageDraft.acceptedCandidates.length > 0) {
          infillCandidateDrafts.push({
            draft: selectedFrontageDraft,
            sourceKind: 'corner_remainder',
          });
        }
      }
    }
    const remainingGeneratedParcels = workingDraft.generatedParcels.filter(
      (_entry, index) => index !== generatedIndex,
    );
    const remainingAcceptedCandidates = [...workingDraft.acceptedCandidates];
    const workingRemainderArea = cadBuildGeneratedDraftRemainderAreaSquareMeters(workingDraft);
    const workingRemainderCount = workingDraft.generatedParcels.filter(
      (entry) => entry.role === 'remainder',
    ).length;
    const bestCandidate =
      infillCandidateDrafts
        .map((candidateEntry) => {
          const infillDraft = candidateEntry.draft;
          const mergedDraft =
            cadBuildLocalizedRemainderReplacementDraft({
              draft: workingDraft,
              replacedGeneratedParcelIndex: generatedIndex,
              infillDraft,
            }) ??
            cadResolveGeneratedParcelConflicts({
              ...workingDraft,
              generatedParcels: [...remainingGeneratedParcels, ...infillDraft.generatedParcels],
              acceptedCandidates: [...remainingAcceptedCandidates, ...infillDraft.acceptedCandidates],
              statusMessage: workingDraft.statusMessage,
            });
          const mergedRemainderArea = cadBuildGeneratedDraftRemainderAreaSquareMeters(mergedDraft);
          const mergedRemainderCount = mergedDraft.generatedParcels.filter(
            (entry) => entry.role === 'remainder',
          ).length;
          const improvesLotCount =
            mergedDraft.acceptedCandidates.length > workingDraft.acceptedCandidates.length;
          const improvesRemainder =
            mergedDraft.acceptedCandidates.length === workingDraft.acceptedCandidates.length &&
            (mergedRemainderCount < workingRemainderCount ||
              mergedRemainderArea + 1e-3 < workingRemainderArea);
          return {
            ...candidateEntry,
            infillDraft,
            mergedDraft,
            mergedRemainderArea,
            mergedRemainderCount,
            improvesLotCount,
            improvesRemainder,
          };
        })
        .filter((candidateEntry) => candidateEntry.improvesLotCount || candidateEntry.improvesRemainder)
        .sort((left, right) => {
          if (left.mergedDraft.acceptedCandidates.length !== right.mergedDraft.acceptedCandidates.length) {
            return right.mergedDraft.acceptedCandidates.length - left.mergedDraft.acceptedCandidates.length;
          }
          if (left.mergedRemainderCount !== right.mergedRemainderCount) {
            return left.mergedRemainderCount - right.mergedRemainderCount;
          }
          if (Math.abs(left.mergedRemainderArea - right.mergedRemainderArea) > 1e-6) {
            return left.mergedRemainderArea - right.mergedRemainderArea;
          }
          return left.mergedDraft.generatedParcels.length - right.mergedDraft.generatedParcels.length;
        })[0] ?? null;
    if (!bestCandidate) continue;
    workingDraft = {
      ...bestCandidate.mergedDraft,
      statusMessage: `${bestCandidate.mergedDraft.statusMessage} Filled 1 remainder parcel from available frontage.`,
    };
    filledRemainderCount += 1;
  }
  return filledRemainderCount > 0 ? workingDraft : draft;
};

const cadBuildCornerFrontageConsumptionMeters = (
  frontageLine: CadLineEntity,
  sharedAt: 'start' | 'end',
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): number => {
  const lineStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const lineEnd = { x: frontageLine.toX, y: frontageLine.toY };
  const lineLengthMeters = cadDistance(lineStart, lineEnd);
  if (lineLengthMeters <= 1e-9) return 0;
  let maximumOffsetMeters = 0;
  generatedParcels.forEach((generatedParcel, index) => {
    const overlapLine = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
      {
        id: `corner-frontage-consumption:${index}`,
        type: 'parcel',
        layerId: frontageLine.layerId,
        styleId: frontageLine.styleId,
        visible: frontageLine.visible,
        locked: frontageLine.locked,
        parcelName: `Corner frontage consumption ${index + 1}`,
        vertices: generatedParcel.vertices,
        vertexLabels: generatedParcel.vertexLabels,
      },
      lineStart,
      lineEnd,
    );
    if (!overlapLine) return;
    const overlapEndpoints = [
      { x: overlapLine.fromX, y: overlapLine.fromY },
      { x: overlapLine.toX, y: overlapLine.toY },
    ];
    overlapEndpoints.forEach((vertex) => {
      const offsetMeters =
        sharedAt === 'start' ? cadDistance(lineStart, vertex) : cadDistance(lineEnd, vertex);
      if (Number.isFinite(offsetMeters)) {
        maximumOffsetMeters = Math.max(maximumOffsetMeters, offsetMeters);
      }
    });
  });
  return Math.min(lineLengthMeters, maximumOffsetMeters);
};

const cadBuildCornerFrontageTouchingLotCount = (
  frontageLine: CadLineEntity,
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): number =>
  generatedParcels.filter((generatedParcel, index) =>
    cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
      {
        id: `corner-frontage-touch:${index}`,
        type: 'parcel',
        layerId: frontageLine.layerId,
        styleId: frontageLine.styleId,
        visible: frontageLine.visible,
        locked: frontageLine.locked,
        parcelName: `Corner frontage touch ${index + 1}`,
        vertices: generatedParcel.vertices,
        vertexLabels: generatedParcel.vertexLabels,
      },
      { x: frontageLine.fromX, y: frontageLine.fromY },
      { x: frontageLine.toX, y: frontageLine.toY },
    ) != null,
  ).length;

const cadGeneratedParcelTouchesFrontageLine = (
  frontageLine: CadLineEntity,
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
): boolean =>
  cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    {
      id: 'corner-frontage-touch-check',
      type: 'parcel',
      layerId: frontageLine.layerId,
      styleId: frontageLine.styleId,
      visible: frontageLine.visible,
      locked: frontageLine.locked,
      parcelName: 'Corner frontage touch check',
      vertices: generatedParcel.vertices,
      vertexLabels: generatedParcel.vertexLabels,
    },
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  ) != null;

const cadBuildSharedFrontagePoint = (
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
): CadWorldPoint | null => {
  const firstPoints = [
    { x: firstFrontageLine.fromX, y: firstFrontageLine.fromY },
    { x: firstFrontageLine.toX, y: firstFrontageLine.toY },
  ];
  const secondPoints = [
    { x: secondFrontageLine.fromX, y: secondFrontageLine.fromY },
    { x: secondFrontageLine.toX, y: secondFrontageLine.toY },
  ];
  return (
    firstPoints.find((firstPoint) =>
      secondPoints.some((secondPoint) => parcelPointsMatch(firstPoint, secondPoint)),
    ) ?? null
  );
};

const cadGeneratedParcelTouchesPoint = (
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
  point: CadWorldPoint,
): boolean => {
  const vertices = normalizeParcelPolygonVertices(generatedParcel.vertices);
  return vertices.some((start, index) =>
    cadPointOnSegment(point, start, vertices[(index + 1) % vertices.length]!),
  );
};

const cadBuildTaggedGeneratedLotDraft = ({
  draft,
  sourceKind,
  sourceSegmentIndex,
}: {
  draft: CadParcelAutoLayoutDraft;
  sourceKind: CadParcelLayoutGeneratedParcelDraft['sourceKind'];
  sourceSegmentIndex?: number;
}): CadParcelAutoLayoutDraft => ({
  ...draft,
  generatedParcels: draft.generatedParcels
    .filter((generatedParcel) => generatedParcel.role === 'lot')
    .map((generatedParcel) => ({
      ...generatedParcel,
      sourceKind: generatedParcel.sourceKind ?? sourceKind,
      sourceSegmentIndex,
    })),
});

const cadBuildCornerJunctionReplacementLotCount = ({
  parcel,
  firstFrontageLine,
  secondFrontageLine,
  cornerDraft,
  firstSegmentTrimMeters,
  secondSegmentTrimMeters,
  settings,
  tool,
}: {
  parcel: CadParcelEntity;
  firstFrontageLine: CadLineEntity;
  secondFrontageLine: CadLineEntity;
  cornerDraft: CadParcelAutoLayoutDraft;
  firstSegmentTrimMeters: number;
  secondSegmentTrimMeters: number;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}): number => {
  const buildStraightStripDraft = (
    frontageLine: CadLineEntity,
    trimFromStartMeters: number,
    trimFromEndMeters: number,
    sourceSegmentIndex: number,
  ): CadParcelAutoLayoutDraft | null => {
    const trimmedFrontage =
      cadBuildTrimmedFrontageLine(frontageLine, trimFromStartMeters, trimFromEndMeters) ??
      frontageLine;
    const stripSettings: CadParcelLayoutSettings = {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    };
    const stripDraft =
      (settings.useMaxDepth
        ? cadBuildParcelFrontageStripAutoLayoutDraft(
            parcel,
            trimmedFrontage,
            stripSettings,
            tool,
          )
        : null) ??
      cadBuildParcelAutoLayoutDraft(
        parcel,
        trimmedFrontage,
        stripSettings,
        tool,
      );
    if (!stripDraft.isValid || stripDraft.acceptedCandidates.length === 0) return null;
    return cadBuildTaggedGeneratedLotDraft({
      draft: stripDraft,
      sourceKind: 'segment',
      sourceSegmentIndex,
    });
  };

  const taggedCornerDraft = cadBuildTaggedGeneratedLotDraft({
    draft: cornerDraft,
    sourceKind: 'corner_prepass',
  });
  const firstStripDraft = buildStraightStripDraft(
    firstFrontageLine,
    0,
    firstSegmentTrimMeters,
    0,
  );
  const secondStripDraft = buildStraightStripDraft(
    secondFrontageLine,
    secondSegmentTrimMeters,
    0,
    1,
  );
  const mergedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels: [
      ...taggedCornerDraft.generatedParcels,
      ...(firstStripDraft?.generatedParcels ?? []),
      ...(secondStripDraft?.generatedParcels ?? []),
    ],
    acceptedCandidates: [
      ...taggedCornerDraft.acceptedCandidates,
      ...(firstStripDraft?.acceptedCandidates ?? []),
      ...(secondStripDraft?.acceptedCandidates ?? []),
    ],
    isValid: true,
    statusMessage: 'Corner junction replacement estimate.',
  });
  return mergedDraft.acceptedCandidates.length;
};

const cadBuildSequentialCornerStripDraft = ({
  cornerParcel,
  primaryFrontageLine,
  secondaryFrontageLine,
  settings,
  tool,
}: {
  cornerParcel: CadParcelEntity;
  primaryFrontageLine: CadLineEntity;
  secondaryFrontageLine: CadLineEntity;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}): CadParcelAutoLayoutDraft | null => {
  const primaryDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    cornerParcel,
    primaryFrontageLine,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!primaryDraft.isValid || primaryDraft.acceptedCandidates.length === 0) return null;
  const primaryRemainder =
    primaryDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null;
  if (!primaryRemainder) return null;
  const primaryRemainderParcel = cadBuildParcelEntityFromGeneratedDraft(
    cornerParcel,
    primaryRemainder,
    true,
  );
  const recoveredSecondaryFrontage = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    primaryRemainderParcel,
    { x: secondaryFrontageLine.fromX, y: secondaryFrontageLine.fromY },
    { x: secondaryFrontageLine.toX, y: secondaryFrontageLine.toY },
  );
  if (!recoveredSecondaryFrontage) return null;
  const secondaryDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    primaryRemainderParcel,
    recoveredSecondaryFrontage,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!secondaryDraft.isValid || secondaryDraft.acceptedCandidates.length === 0) return null;
  const mergedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels: [
      ...primaryDraft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ...secondaryDraft.generatedParcels,
    ],
    acceptedCandidates: [
      ...primaryDraft.acceptedCandidates,
      ...secondaryDraft.acceptedCandidates,
    ],
    isValid: true,
    statusMessage: 'Sequential corner strip draft.',
  });
  return mergedDraft.acceptedCandidates.length > 0 ? mergedDraft : null;
};

const cadBuildLimitedCornerPathDraft = (
  cornerParcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  const sharedPoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  if (!sharedPoint) return null;
  const pointAwayFromShared = (
    frontageLine: CadLineEntity,
    maxDistanceMeters: number,
  ): CadWorldPoint | null => {
    const start = { x: frontageLine.fromX, y: frontageLine.fromY };
    const end = { x: frontageLine.toX, y: frontageLine.toY };
    const other = parcelPointsMatch(sharedPoint, start)
      ? end
      : parcelPointsMatch(sharedPoint, end)
        ? start
        : null;
    if (!other) return null;
    const lengthMeters = cadDistance(sharedPoint, other);
    if (lengthMeters <= 1e-9) return null;
    const distanceMeters = Math.min(lengthMeters, maxDistanceMeters);
    return {
      x: sharedPoint.x + ((other.x - sharedPoint.x) / lengthMeters) * distanceMeters,
      y: sharedPoint.y + ((other.y - sharedPoint.y) / lengthMeters) * distanceMeters,
    };
  };
  const cornerFrontageMeters = Math.max(
    settings.minFrontageMeters * 2,
    settings.minWidthMeters * 2,
    Math.sqrt(settings.minAreaSquareMeters) * 1.5,
  );
  const firstOuterPoint = pointAwayFromShared(firstFrontageLine, cornerFrontageMeters);
  const secondOuterPoint = pointAwayFromShared(secondFrontageLine, cornerFrontageMeters);
  if (!firstOuterPoint || !secondOuterPoint) return null;

  const cornerReference: CadParcelLayoutFrontageReference = {
    sourceEntityId: cornerParcel.id,
    displayLabel: `${firstFrontageLine.fromStationId}-${firstFrontageLine.toStationId}, ${secondFrontageLine.fromStationId}-${secondFrontageLine.toStationId}`,
    sourcePointIds: ['CORNER1', 'CORNER', 'CORNER2'],
    frontageLine: {
      ...firstFrontageLine,
      id: `${cornerParcel.id}:limited-corner-frontage`,
      fromStationId: 'CORNER1',
      fromX: firstOuterPoint.x,
      fromY: firstOuterPoint.y,
      toStationId: 'CORNER',
      toX: sharedPoint.x,
      toY: sharedPoint.y,
    },
    sourceGeometry: {
      kind: 'polyline',
      vertices: [
        { x: firstOuterPoint.x, y: firstOuterPoint.y },
        { x: sharedPoint.x, y: sharedPoint.y },
        { x: secondOuterPoint.x, y: secondOuterPoint.y },
      ],
      vertexLabels: ['CORNER1', 'CORNER', 'CORNER2'],
    },
  };
  const draft = cadBuildParcelFrontagePathAutoLayoutDraft(
    cornerParcel,
    cornerReference,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!draft?.isValid || draft.acceptedCandidates.length === 0) return null;
  return {
    ...draft,
    generatedParcels: draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
  };
};

const cadBuildFrontageBridgeDraft = (
  parcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadCornerInfillDraft | null => {
  const sharedPoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  if (!sharedPoint) return null;
  const firstStart = { x: firstFrontageLine.fromX, y: firstFrontageLine.fromY };
  const firstEnd = { x: firstFrontageLine.toX, y: firstFrontageLine.toY };
  const secondStart = { x: secondFrontageLine.fromX, y: secondFrontageLine.fromY };
  const secondEnd = { x: secondFrontageLine.toX, y: secondFrontageLine.toY };
  const firstOuterPoint = parcelPointsMatch(sharedPoint, firstStart)
    ? firstEnd
    : parcelPointsMatch(sharedPoint, firstEnd)
      ? firstStart
      : null;
  const secondOuterPoint = parcelPointsMatch(sharedPoint, secondStart)
    ? secondEnd
    : parcelPointsMatch(sharedPoint, secondEnd)
      ? secondStart
      : null;
  if (!firstOuterPoint || !secondOuterPoint) return null;
  const firstRemainderFrontageMeters = cadDistance(firstOuterPoint, sharedPoint);
  const secondAvailableFrontageMeters = cadDistance(sharedPoint, secondOuterPoint);
  if (
    firstRemainderFrontageMeters <= 1e-9 ||
    secondAvailableFrontageMeters <= 1e-9 ||
    firstRemainderFrontageMeters >= settings.minFrontageMeters - 1e-9
  ) {
    return null;
  }
  const minimumSecondFrontageMeters = Math.max(
    settings.minFrontageMeters - firstRemainderFrontageMeters,
    1,
  );
  const maximumSecondFrontageMeters = Math.min(
    secondAvailableFrontageMeters,
    Math.max(settings.minFrontageMeters * 2, settings.minWidthMeters * 2, minimumSecondFrontageMeters),
  );
  if (maximumSecondFrontageMeters + 1e-9 < minimumSecondFrontageMeters) return null;
  const secondLengthMeters = cadDistance(sharedPoint, secondOuterPoint);
  const buildSecondPoint = (distanceMeters: number): CadWorldPoint => ({
    x: sharedPoint.x + ((secondOuterPoint.x - sharedPoint.x) / secondLengthMeters) * distanceMeters,
    y: sharedPoint.y + ((secondOuterPoint.y - sharedPoint.y) / secondLengthMeters) * distanceMeters,
  });
  const candidateDrafts: CadCornerInfillDraft[] = [];
  const steps = 16;
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const secondFrontageMeters =
      minimumSecondFrontageMeters +
      (maximumSecondFrontageMeters - minimumSecondFrontageMeters) * ratio;
    const secondPoint = buildSecondPoint(secondFrontageMeters);
    const bridgeReference: CadParcelLayoutFrontageReference = {
      sourceEntityId: parcel.id,
      displayLabel: `${firstFrontageLine.fromStationId}-${firstFrontageLine.toStationId}, ${secondFrontageLine.fromStationId}-${secondFrontageLine.toStationId}`,
      sourcePointIds: ['BRIDGE1', 'BRIDGE', 'BRIDGE2'],
      frontageLine: {
        ...firstFrontageLine,
        id: `${parcel.id}:frontage-bridge`,
        fromStationId: 'BRIDGE1',
        fromX: firstOuterPoint.x,
        fromY: firstOuterPoint.y,
        toStationId: 'BRIDGE',
        toX: sharedPoint.x,
        toY: sharedPoint.y,
      },
      sourceGeometry: {
        kind: 'polyline',
        vertices: [
          { x: firstOuterPoint.x, y: firstOuterPoint.y },
          { x: sharedPoint.x, y: sharedPoint.y },
          secondPoint,
        ],
        vertexLabels: ['BRIDGE1', 'BRIDGE', 'BRIDGE2'],
      },
    };
    const bridgeDraft = cadBuildParcelFrontagePathAutoLayoutDraft(
      parcel,
      bridgeReference,
      {
        ...settings,
        remainderDistribution: 'create_parcel_from_remainder',
      },
      tool,
    );
    if (!bridgeDraft?.isValid || bridgeDraft.acceptedCandidates.length === 0) continue;
    const bridgeLots = bridgeDraft.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'lot',
    );
    if (bridgeLots.length === 0) continue;
    candidateDrafts.push({
      draft: {
        ...bridgeDraft,
        generatedParcels: bridgeLots,
      },
      remainderDraft:
        bridgeDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null,
      firstSegmentTrimMeters: firstRemainderFrontageMeters,
      secondSegmentTrimMeters: secondFrontageMeters,
    });
  }
  return (
    candidateDrafts
      .sort((left, right) => {
        if (left.draft.acceptedCandidates.length !== right.draft.acceptedCandidates.length) {
          return right.draft.acceptedCandidates.length - left.draft.acceptedCandidates.length;
        }
        const leftArea = left.draft.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.POSITIVE_INFINITY;
        const rightArea = right.draft.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.POSITIVE_INFINITY;
        return leftArea - rightArea;
      })[0] ?? null
  );
};

const cadBuildCornerInfillDraft = (
  parcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  mode: 'prepass' | 'remainder' = 'prepass',
): CadCornerInfillDraft | null => {
  if (!settings.useMaxDepth) return null;
  const firstDepthLimitedParcel = cadBuildDepthLimitedParcelFromFrontage(
    parcel,
    firstFrontageLine,
    settings.maxDepthMeters,
  );
  if (!firstDepthLimitedParcel) return null;
  const cornerParcel = cadBuildDepthLimitedParcelFromFrontage(
    firstDepthLimitedParcel,
    secondFrontageLine,
    settings.maxDepthMeters,
  );
  if (!cornerParcel) return null;
  const cornerAreaSquareMeters = cadBuildParcelClosureSummary(cornerParcel.vertices)?.areaSquareMeters ?? 0;
  if (cornerAreaSquareMeters + 1e-9 < settings.minAreaSquareMeters) return null;
  const cornerFrontageReference = cadBuildCornerFrontageReference(
    cornerParcel,
    firstFrontageLine,
    secondFrontageLine,
  );
  if (!cornerFrontageReference) return null;
  const cornerSizingVariants: CadParcelLayoutSettings[] =
    mode === 'remainder'
      ? [
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'create_parcel_from_remainder',
          },
        ]
      : [
          {
            ...settings,
            remainderDistribution: 'place_remainder_in_last_parcel',
          },
          {
            ...settings,
            remainderDistribution: 'redistribute_remainder',
          },
          {
            ...settings,
            remainderDistribution: 'create_parcel_from_remainder',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'place_remainder_in_last_parcel',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'redistribute_remainder',
          },
          {
            ...settings,
            useMaxDepth: false,
            remainderDistribution: 'create_parcel_from_remainder',
          },
        ];
  const cornerSolutionPreferences: CadParcelLayoutSettings['solutionPreference'][] = [
    settings.solutionPreference,
    'closest_to_target_area',
    'smallest_area',
  ];
  const buildCornerDraftsForTool = (cornerTool: 'slide' | 'swing'): CadParcelAutoLayoutDraft[] => {
    const candidateDrafts: CadParcelAutoLayoutDraft[] = [];
    cornerSizingVariants.forEach((cornerSettings) => {
      cornerSolutionPreferences.forEach((solutionPreference) => {
        const variantSettings = {
          ...cornerSettings,
          solutionPreference,
        };
        const limitedCornerDraft = cadBuildLimitedCornerPathDraft(
          cornerParcel,
          firstFrontageLine,
          secondFrontageLine,
          variantSettings,
          cornerTool,
        );
        if (limitedCornerDraft?.isValid && limitedCornerDraft.acceptedCandidates.length > 0) {
          candidateDrafts.push(limitedCornerDraft);
        }
        const cornerDraft = cadBuildParcelFrontagePathAutoLayoutDraft(
          cornerParcel,
          cornerFrontageReference,
          variantSettings,
          cornerTool,
        );
        if (cornerDraft?.isValid && cornerDraft.acceptedCandidates.length > 0) {
          candidateDrafts.push(cornerDraft);
        }
        const fallbackCornerDraft = cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference(
          cornerParcel,
          cornerFrontageReference,
          variantSettings,
          cornerTool,
        );
        if (fallbackCornerDraft.isValid && fallbackCornerDraft.acceptedCandidates.length > 0) {
          candidateDrafts.push(fallbackCornerDraft);
        }
        const sequentialPrimaryFirst = cadBuildSequentialCornerStripDraft({
          cornerParcel,
          primaryFrontageLine: firstFrontageLine,
          secondaryFrontageLine: secondFrontageLine,
          settings: variantSettings,
          tool: cornerTool,
        });
        if (sequentialPrimaryFirst?.isValid && sequentialPrimaryFirst.acceptedCandidates.length > 0) {
          candidateDrafts.push(sequentialPrimaryFirst);
        }
        const sequentialSecondaryFirst = cadBuildSequentialCornerStripDraft({
          cornerParcel,
          primaryFrontageLine: secondFrontageLine,
          secondaryFrontageLine: firstFrontageLine,
          settings: variantSettings,
          tool: cornerTool,
        });
        if (sequentialSecondaryFirst?.isValid && sequentialSecondaryFirst.acceptedCandidates.length > 0) {
          candidateDrafts.push(sequentialSecondaryFirst);
        }
      });
    });
    const chainedCornerDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
      cornerParcel,
      cornerFrontageReference,
      {
        ...settings,
        useMaxDepth: false,
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
      cornerTool,
    );
    if (chainedCornerDraft.isValid && chainedCornerDraft.acceptedCandidates.length > 0) {
      candidateDrafts.push(chainedCornerDraft);
    }
    return candidateDrafts;
  };
  const preferredCornerDrafts = buildCornerDraftsForTool(tool);
  const alternateCornerDrafts = buildCornerDraftsForTool(tool === 'slide' ? 'swing' : 'slide');
  const compareCornerDraftEntries = (
    left: {
      draft: CadParcelAutoLayoutDraft;
      remainderAreaSquareMeters: number;
      maximumLotFrontageMeters: number;
      firstSegmentTrimMeters: number;
      secondSegmentTrimMeters: number;
      materialOverlapPairCount: number;
      junctionReplacementLotCount: number;
      firstFrontageLotCount: number;
      secondFrontageLotCount: number;
    },
    right: {
      draft: CadParcelAutoLayoutDraft;
      remainderAreaSquareMeters: number;
      maximumLotFrontageMeters: number;
      firstSegmentTrimMeters: number;
      secondSegmentTrimMeters: number;
      materialOverlapPairCount: number;
      junctionReplacementLotCount: number;
      firstFrontageLotCount: number;
      secondFrontageLotCount: number;
    },
    includeJunctionReplacementLotCount: boolean,
  ): number => {
    if (left.materialOverlapPairCount !== right.materialOverlapPairCount) {
      return left.materialOverlapPairCount - right.materialOverlapPairCount;
    }
    if (
      includeJunctionReplacementLotCount &&
      left.junctionReplacementLotCount !== right.junctionReplacementLotCount
    ) {
      return right.junctionReplacementLotCount - left.junctionReplacementLotCount;
    }
    const leftBalancedFrontageLotCount = Math.min(left.firstFrontageLotCount, left.secondFrontageLotCount);
    const rightBalancedFrontageLotCount = Math.min(right.firstFrontageLotCount, right.secondFrontageLotCount);
    if (leftBalancedFrontageLotCount !== rightBalancedFrontageLotCount) {
      return rightBalancedFrontageLotCount - leftBalancedFrontageLotCount;
    }
    const leftTotalFrontageLotCount = left.firstFrontageLotCount + left.secondFrontageLotCount;
    const rightTotalFrontageLotCount = right.firstFrontageLotCount + right.secondFrontageLotCount;
    if (leftTotalFrontageLotCount !== rightTotalFrontageLotCount) {
      return rightTotalFrontageLotCount - leftTotalFrontageLotCount;
    }
    const leftHasRemainder = left.draft.generatedParcels.some(
      (generatedParcel) => generatedParcel.role === 'remainder',
    );
    const rightHasRemainder = right.draft.generatedParcels.some(
      (generatedParcel) => generatedParcel.role === 'remainder',
    );
    if (mode === 'remainder' && leftHasRemainder !== rightHasRemainder) {
      return rightHasRemainder ? 1 : -1;
    }
    const leftEstimatedTotalLotCount =
      left.draft.acceptedCandidates.length +
      cadEstimateRemainingFrontageLotCapacity(
        firstFrontageLine,
        left.firstSegmentTrimMeters,
        settings.minFrontageMeters,
      ) +
      cadEstimateRemainingFrontageLotCapacity(
        secondFrontageLine,
        left.secondSegmentTrimMeters,
        settings.minFrontageMeters,
      );
    const rightEstimatedTotalLotCount =
      right.draft.acceptedCandidates.length +
      cadEstimateRemainingFrontageLotCapacity(
        firstFrontageLine,
        right.firstSegmentTrimMeters,
        settings.minFrontageMeters,
      ) +
      cadEstimateRemainingFrontageLotCapacity(
        secondFrontageLine,
        right.secondSegmentTrimMeters,
        settings.minFrontageMeters,
      );
    if (leftEstimatedTotalLotCount !== rightEstimatedTotalLotCount) {
      return rightEstimatedTotalLotCount - leftEstimatedTotalLotCount;
    }
    if (left.draft.acceptedCandidates.length !== right.draft.acceptedCandidates.length) {
      return right.draft.acceptedCandidates.length - left.draft.acceptedCandidates.length;
    }
    if (Math.abs(left.remainderAreaSquareMeters - right.remainderAreaSquareMeters) > 1e-6) {
      return left.remainderAreaSquareMeters - right.remainderAreaSquareMeters;
    }
    const leftTrimTotal = left.firstSegmentTrimMeters + left.secondSegmentTrimMeters;
    const rightTrimTotal = right.firstSegmentTrimMeters + right.secondSegmentTrimMeters;
    if (Math.abs(leftTrimTotal - rightTrimTotal) > 1e-6) {
      return leftTrimTotal - rightTrimTotal;
    }
    if (Math.abs(left.maximumLotFrontageMeters - right.maximumLotFrontageMeters) > 1e-6) {
      return left.maximumLotFrontageMeters - right.maximumLotFrontageMeters;
    }
    return left.draft.generatedParcels.length - right.draft.generatedParcels.length;
  };
  const baseCornerDraftEntries = [...preferredCornerDrafts, ...alternateCornerDrafts]
    .map((draft) => ({
      draft,
      remainderAreaSquareMeters: draft.generatedParcels
        .filter((generatedParcel) => generatedParcel.role === 'remainder')
        .reduce(
          (total, generatedParcel) =>
            total +
            (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0),
          0,
        ),
      maximumLotFrontageMeters: draft.generatedParcels
        .filter((generatedParcel) => generatedParcel.role === 'lot')
        .reduce((maximumFrontageMeters, generatedParcel) => {
          const frontageLengthMeters =
            'frontageLengthMeters' in generatedParcel
              ? (generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          return Math.max(maximumFrontageMeters, frontageLengthMeters);
        }, 0),
      firstSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
        firstFrontageLine,
        'end',
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      secondSegmentTrimMeters: cadBuildCornerFrontageConsumptionMeters(
        secondFrontageLine,
        'start',
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      materialOverlapPairCount: cadBuildGeneratedParcelOverlapPairCount(
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      junctionReplacementLotCount: -1,
      firstFrontageLotCount: cadBuildCornerFrontageTouchingLotCount(
        firstFrontageLine,
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
      secondFrontageLotCount: cadBuildCornerFrontageTouchingLotCount(
        secondFrontageLine,
        draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ),
    }))
    .sort((left, right) => compareCornerDraftEntries(left, right, false));
  const junctionScoredCornerEntries = new Set(
    baseCornerDraftEntries
      .slice(0, Math.min(baseCornerDraftEntries.length, 6))
      .map((entry) => entry.draft),
  );
  const resolvedCornerDraftEntry =
    baseCornerDraftEntries
      .map((entry) => ({
        ...entry,
        junctionReplacementLotCount: junctionScoredCornerEntries.has(entry.draft)
          ? cadBuildCornerJunctionReplacementLotCount({
              parcel,
              firstFrontageLine,
              secondFrontageLine,
              cornerDraft: entry.draft,
              firstSegmentTrimMeters: entry.firstSegmentTrimMeters,
              secondSegmentTrimMeters: entry.secondSegmentTrimMeters,
              settings,
              tool: entry.draft.tool,
            })
          : -1,
      }))
      .sort((left, right) => compareCornerDraftEntries(left, right, true))[0] ?? null;
  const resolvedCornerDraft = resolvedCornerDraftEntry?.draft ?? null;
  if (!resolvedCornerDraft?.isValid || resolvedCornerDraft.acceptedCandidates.length === 0) return null;
  const cornerRemainderDraft =
    resolvedCornerDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ??
    null;
  const allCornerLots = resolvedCornerDraft.generatedParcels.filter(
    (generatedParcel) => generatedParcel.role === 'lot',
  );
  const sharedFrontagePoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  const trueSharedCornerLotIndexes = allCornerLots
    .map((generatedParcel, index) => ({
      generatedParcel,
      index,
      touchesFirst: cadGeneratedParcelTouchesFrontageLine(firstFrontageLine, generatedParcel),
      touchesSecond: cadGeneratedParcelTouchesFrontageLine(secondFrontageLine, generatedParcel),
      touchesSharedPoint:
        sharedFrontagePoint != null && cadGeneratedParcelTouchesPoint(generatedParcel, sharedFrontagePoint),
    }))
    .filter((entry) => entry.touchesFirst && entry.touchesSecond && entry.touchesSharedPoint)
    .map((entry) => entry.index);
  const selectedCornerLotIndexes =
    mode === 'prepass'
      ? trueSharedCornerLotIndexes.slice(0, 2)
      : allCornerLots.map((_generatedParcel, index) => index);
  const cornerLots = allCornerLots.filter((_generatedParcel, index) =>
    selectedCornerLotIndexes.includes(index),
  );
  const cornerAcceptedCandidates = resolvedCornerDraft.acceptedCandidates
    .filter((_candidate, index) => selectedCornerLotIndexes.includes(index))
    .map((candidate) => ({
      ...candidate,
      tool: resolvedCornerDraft.tool,
    }));
  if (cornerLots.length === 0 || cornerAcceptedCandidates.length === 0) return null;
  return {
    draft: {
      ...resolvedCornerDraft,
      tool: resolvedCornerDraft.tool,
      acceptedCandidates: cornerAcceptedCandidates,
      generatedParcels: cornerLots,
    },
    remainderDraft: cornerRemainderDraft,
    firstSegmentTrimMeters:
      resolvedCornerDraftEntry?.firstSegmentTrimMeters ??
      cadBuildCornerFrontageConsumptionMeters(firstFrontageLine, 'end', cornerLots),
    secondSegmentTrimMeters:
      resolvedCornerDraftEntry?.secondSegmentTrimMeters ??
      cadBuildCornerFrontageConsumptionMeters(secondFrontageLine, 'start', cornerLots),
  };
};

const cadBuildTrimmedFrontageLine = (
  frontageLine: CadLineEntity,
  trimFromStartMeters: number,
  trimFromEndMeters: number,
): CadLineEntity | null => {
  const lineLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  if (lineLengthMeters <= 1e-9) return null;
  const usableLengthMeters = lineLengthMeters - trimFromStartMeters - trimFromEndMeters;
  if (usableLengthMeters <= 1e-9) return null;
  const unitX = (frontageLine.toX - frontageLine.fromX) / lineLengthMeters;
  const unitY = (frontageLine.toY - frontageLine.fromY) / lineLengthMeters;
  return {
    ...frontageLine,
    fromX: frontageLine.fromX + unitX * trimFromStartMeters,
    fromY: frontageLine.fromY + unitY * trimFromStartMeters,
    toX: frontageLine.toX - unitX * trimFromEndMeters,
    toY: frontageLine.toY - unitY * trimFromEndMeters,
  };
};

const cadBuildReservedFrontageTrimDistance = (
  frontageLine: CadLineEntity,
  adjacentFrontageLine: CadLineEntity,
  sharedAt: 'start' | 'end',
  depthLimitMeters: number,
): number => {
  if (depthLimitMeters <= 1e-9) return 0;
  const lineStart = { x: frontageLine.fromX, y: frontageLine.fromY };
  const lineEnd = { x: frontageLine.toX, y: frontageLine.toY };
  const lineLengthMeters = cadDistance(lineStart, lineEnd);
  if (lineLengthMeters <= 1e-9) return 0;
  const unitX = (lineEnd.x - lineStart.x) / lineLengthMeters;
  const unitY = (lineEnd.y - lineStart.y) / lineLengthMeters;
  const adjacentStart = { x: adjacentFrontageLine.fromX, y: adjacentFrontageLine.fromY };
  const adjacentEnd = { x: adjacentFrontageLine.toX, y: adjacentFrontageLine.toY };
  const pointAtOffset = (offsetMeters: number): CadWorldPoint =>
    sharedAt === 'start'
      ? {
          x: lineStart.x + unitX * offsetMeters,
          y: lineStart.y + unitY * offsetMeters,
        }
      : {
          x: lineEnd.x - unitX * offsetMeters,
          y: lineEnd.y - unitY * offsetMeters,
        };

  if (
    cadDistancePointToSegment(pointAtOffset(Math.min(lineLengthMeters, depthLimitMeters)), adjacentStart, adjacentEnd) >
    depthLimitMeters
  ) {
    let low = 0;
    let high = Math.min(lineLengthMeters, depthLimitMeters);
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const midpoint = (low + high) / 2;
      const distanceMeters = cadDistancePointToSegment(pointAtOffset(midpoint), adjacentStart, adjacentEnd);
      if (distanceMeters <= depthLimitMeters + 1e-9) {
        low = midpoint;
      } else {
        high = midpoint;
      }
    }
    return low;
  }

  let low = Math.min(lineLengthMeters, depthLimitMeters);
  let high = lineLengthMeters;
  if (
    cadDistancePointToSegment(pointAtOffset(high), adjacentStart, adjacentEnd) <=
    depthLimitMeters + 1e-9
  ) {
    return high;
  }
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const midpoint = (low + high) / 2;
    const distanceMeters = cadDistancePointToSegment(pointAtOffset(midpoint), adjacentStart, adjacentEnd);
    if (distanceMeters <= depthLimitMeters + 1e-9) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  return low;
};

const cadBuildCappedFallbackCornerTrimDistance = (
  reserveMeters: number,
  settings: CadParcelLayoutSettings,
): number =>
  Math.min(
    reserveMeters,
    Math.max(settings.minFrontageMeters, settings.minWidthMeters, 1e-9),
  );

const cadBuildClosedBoundaryFrontageVertices = (
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

const cadBuildClosedBoundaryRingAutoLayoutDraft = (
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

const cadStabilizeParcelVertexCoordinates = (
  parcel: CadParcelEntity,
  tolerance = 1e-9,
): CadParcelEntity => {
  const stabilizeCoordinate = (value: number): number => Math.round(value / tolerance) * tolerance;
  const stabilizedVertices = parcel.vertices.map((vertex) => ({
    x: stabilizeCoordinate(vertex.x),
    y: stabilizeCoordinate(vertex.y),
  }));
  for (let index = 0; index < stabilizedVertices.length; index += 1) {
    for (let compareIndex = 0; compareIndex < index; compareIndex += 1) {
      if (
        Math.abs(stabilizedVertices[index]!.x - stabilizedVertices[compareIndex]!.x) <= tolerance
      ) {
        stabilizedVertices[index]!.x = stabilizedVertices[compareIndex]!.x;
      }
      if (
        Math.abs(stabilizedVertices[index]!.y - stabilizedVertices[compareIndex]!.y) <= tolerance
      ) {
        stabilizedVertices[index]!.y = stabilizedVertices[compareIndex]!.y;
      }
    }
  }
  return {
    ...parcel,
    vertices: stabilizedVertices,
  };
};

const cadStabilizeFrontageLine = (
  frontageLine: CadLineEntity,
  tolerance = 1e-9,
): CadLineEntity => {
  const stabilizeCoordinate = (value: number): number => Math.round(value / tolerance) * tolerance;
  return {
    ...frontageLine,
    fromX: stabilizeCoordinate(frontageLine.fromX),
    fromY: stabilizeCoordinate(frontageLine.fromY),
    toX: stabilizeCoordinate(frontageLine.toX),
    toY: stabilizeCoordinate(frontageLine.toY),
  };
};

const cadBuildAutoLayoutRemainderFrontageLine = (
  frontageLine: CadLineEntity,
  candidate: CadParcelLayoutPreviewCandidate,
): CadLineEntity | null => {
  const frontageLength = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  const childFrontage = candidate.draft?.frontageLengthMeters ?? 0;
  const remainderFrontage = frontageLength - childFrontage;
  if (!candidate.draft || remainderFrontage <= 1e-9) return null;
  const ratio =
    candidate.alternative === 'start' ? childFrontage / frontageLength : remainderFrontage / frontageLength;
  const cutPoint = {
    x: frontageLine.fromX + (frontageLine.toX - frontageLine.fromX) * ratio,
    y: frontageLine.fromY + (frontageLine.toY - frontageLine.fromY) * ratio,
  };
  return candidate.alternative === 'start'
    ? {
        ...frontageLine,
        id: `${frontageLine.id}:auto-remainder`,
        fromStationId: 'CUT',
        fromX: cutPoint.x,
        fromY: cutPoint.y,
      }
    : {
        ...frontageLine,
        id: `${frontageLine.id}:auto-remainder`,
        toStationId: 'CUT',
        toX: cutPoint.x,
        toY: cutPoint.y,
      };
};

const cadCanCreateAnotherAutoLayoutLot = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity | null,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): boolean => {
  if (!frontageLine) return false;
  const automaticTargetAreaSquareMeters = cadBuildAutomaticTargetAreaSquareMeters(
    parcel,
    frontageLine,
    settings,
  );
  const startCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
    parcel,
    frontageLine,
    settings,
    tool,
    'start',
    automaticTargetAreaSquareMeters,
  );
  const endCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
    parcel,
    frontageLine,
    settings,
    tool,
    'end',
    automaticTargetAreaSquareMeters,
  );
  return startCandidate.isValid || endCandidate.isValid;
};

const cadBuildParcelAutoLayoutDraftForSupportedRemainderMode = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  if (!isParcelAutoRemainderDistributionSupported(settings.remainderDistribution)) {
    return {
      tool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Selected remainder mode is staged for a later automatic layout slice.',
    };
  }

  let currentParcel = cadStabilizeParcelVertexCoordinates(
    cadCanonicalizeParcelAgainstFrontage(
      {
        ...parcel,
        vertices: parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...parcel.vertexLabels],
      },
      frontageLine,
    ),
  );
  let currentFrontage = cadStabilizeFrontageLine({ ...frontageLine });
  const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];

  for (let iteration = 0; iteration < 64; iteration += 1) {
    const automaticTargetAreaSquareMeters = cadBuildAutomaticTargetAreaSquareMeters(
      currentParcel,
      currentFrontage,
      settings,
    );
    const startCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
      currentParcel,
      currentFrontage,
      settings,
      tool,
      'start',
      automaticTargetAreaSquareMeters,
    );
    const endCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
      currentParcel,
      currentFrontage,
      settings,
      tool,
      'end',
      automaticTargetAreaSquareMeters,
    );
    const candidate =
      [startCandidate, endCandidate].sort((left, right) => {
        if (left.isValid !== right.isValid) return left.isValid ? -1 : 1;
        const leftScore = left.evaluation?.score ?? Number.POSITIVE_INFINITY;
        const rightScore = right.evaluation?.score ?? Number.POSITIVE_INFINITY;
        return leftScore - rightScore;
      })[0] ?? startCandidate;
    if (!candidate.isValid || !candidate.draft) {
      if (generatedParcels.length === 0) {
        return {
          tool,
          generatedParcels: [],
          acceptedCandidates: [],
          isValid: false,
          statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
        };
      }
      generatedParcels.push(
        cadCloneParcelLayoutGeneratedDraft(currentParcel.vertices, currentParcel.vertexLabels, 'remainder'),
      );
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }

    const remainderDraft = cadCloneParcelLayoutGeneratedDraft(
      candidate.draft.remainderVertices,
      candidate.draft.remainderVertexLabels,
      'remainder',
    );
    const rawRemainderFrontage =
      tool === 'slide'
        ? cadBuildAutoLayoutRemainderFrontageLine(currentFrontage, candidate)
        : { ...currentFrontage, id: `${currentFrontage.id}:auto-remainder` };
    const remainderFrontage = rawRemainderFrontage
      ? cadStabilizeFrontageLine(rawRemainderFrontage)
      : null;
    const remainderParcel = cadStabilizeParcelVertexCoordinates(
      cadCanonicalizeParcelAgainstFrontage(
        cadBuildParcelEntityFromGeneratedDraft(parcel, remainderDraft),
        remainderFrontage ?? currentFrontage,
      ),
    );
    const canCreateAnotherLot = cadCanCreateAnotherAutoLayoutLot(
      remainderParcel,
      remainderFrontage,
      settings,
      tool,
    );

    if (
      !canCreateAnotherLot &&
      settings.remainderDistribution === 'place_remainder_in_last_parcel'
    ) {
      if (generatedParcels.length === 0) {
        return {
          tool,
          generatedParcels: [],
          acceptedCandidates: [],
          isValid: false,
          statusMessage: 'Automatic fill needs room for at least two valid lots when remainder stays in the last parcel.',
        };
      }
      generatedParcels.push(
        cadCloneParcelLayoutGeneratedDraft(currentParcel.vertices, currentParcel.vertexLabels, 'remainder'),
      );
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels with remainder kept in the last parcel.`,
      };
    }

    generatedParcels.push(
      cadCloneParcelLayoutGeneratedDraft(candidate.draft.childVertices, candidate.draft.childVertexLabels, 'lot'),
    );
    acceptedCandidates.push(candidate);

    if (!canCreateAnotherLot) {
      generatedParcels.push(remainderDraft);
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }

    currentParcel = remainderParcel;
    if (!remainderFrontage) {
      generatedParcels.push(remainderDraft);
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }
    currentFrontage = remainderFrontage;
  }

  return {
    tool,
    generatedParcels: [],
    acceptedCandidates: [],
    isValid: false,
    statusMessage: 'Automatic fill reached its safety limit before completing the lot sequence.',
  };
};

const isParcelAutoRemainderDistributionSupported = (
  remainderDistribution: CadParcelLayoutRemainderDistribution,
): boolean =>
  remainderDistribution === 'place_remainder_in_last_parcel' ||
  remainderDistribution === 'create_parcel_from_remainder';

export const cadBuildParcelAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  if (isParcelAutoRemainderDistributionSupported(settings.remainderDistribution)) {
    const directDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
      parcel,
      frontageLine,
      settings,
      tool,
    );
    if (directDraft.isValid) {
      return directDraft;
    }
    if (!settings.useMaxDepth) {
      return directDraft;
    }
    return cadBuildParcelFrontageStripAutoLayoutDraft(
      parcel,
      frontageLine,
      settings,
      tool,
    ) ?? directDraft;
  }

  const baseAutoLayout = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    parcel,
    frontageLine,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!baseAutoLayout.isValid) {
    return baseAutoLayout;
  }

  const lotCount = baseAutoLayout.acceptedCandidates.length;
  const remainderParcel = baseAutoLayout.generatedParcels.at(-1);
  if (lotCount === 0) {
    return {
      ...baseAutoLayout,
      isValid: false,
      statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
    };
  }
  if (lotCount === 1) {
    return cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
      parcel,
      frontageLine,
      {
        ...settings,
        remainderDistribution: 'place_remainder_in_last_parcel',
      },
      tool,
    );
  }

  const remainderAreaSquareMeters =
    remainderParcel?.role === 'remainder'
      ? cadBuildParcelClosureSummary(remainderParcel.vertices)?.areaSquareMeters ?? 0
      : 0;
  if (remainderAreaSquareMeters <= 1e-6) {
    return {
      ...baseAutoLayout,
      generatedParcels: baseAutoLayout.generatedParcels.map((generatedParcel) => ({
        ...generatedParcel,
        role: 'lot',
      })),
      statusMessage: `Automatic fill redistributed remainder across ${lotCount} lots.`,
    };
  }

  const parcelAreaSquareMeters = cadBuildParcelClosureSummary(parcel.vertices)?.areaSquareMeters ?? 0;
  const redistributedTargetAreaSquareMeters = parcelAreaSquareMeters / lotCount;
  const frontageLengthMeters = cadDistance(
    { x: frontageLine.fromX, y: frontageLine.fromY },
    { x: frontageLine.toX, y: frontageLine.toY },
  );
  const redistributedTargetFrontageMeters = frontageLengthMeters / lotCount;
  const redistributedAutoLayout = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    parcel,
    frontageLine,
    {
      ...settings,
      minAreaSquareMeters: redistributedTargetAreaSquareMeters,
      minFrontageMeters: Math.max(settings.minFrontageMeters, redistributedTargetFrontageMeters),
      solutionPreference: 'closest_to_target_area',
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (
    !redistributedAutoLayout.isValid ||
    redistributedAutoLayout.generatedParcels.length !== lotCount
  ) {
    return {
      ...baseAutoLayout,
      isValid: false,
      statusMessage:
        'Automatic fill could not redistribute remainder across same lot count without dropping a lot.',
    };
  }

  return {
    ...redistributedAutoLayout,
    generatedParcels: redistributedAutoLayout.generatedParcels.map((generatedParcel) => ({
      ...generatedParcel,
      role: 'lot',
    })),
    statusMessage: `Automatic fill redistributed remainder across ${lotCount} lots.`,
  };
};

export const cadBuildParcelAutoLayoutDraftFromFrontageReference = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  const segmentPairs = frontageReference.parcelSegmentLabelPairs ?? [];
  if (segmentPairs.length <= 1) {
    return cadBuildParcelAutoLayoutDraft(parcel, frontageReference.frontageLine, settings, tool);
  }
  const closedBoundaryDraft = cadBuildClosedBoundaryRingAutoLayoutDraft(
    parcel,
    frontageReference,
    settings,
    tool,
  );
  if (closedBoundaryDraft?.isValid) {
    return closedBoundaryDraft;
  }

  let currentParcel: CadParcelEntity = {
    ...parcel,
    vertices: parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    vertexLabels: [...parcel.vertexLabels],
  };
  const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
  const cornerTrimFromStartMetersBySegment = new Map<number, number>();
  const cornerTrimFromEndMetersBySegment = new Map<number, number>();
  const cornerDraftJunctionIndexes = new Set<number>();
  let usedFullParentSegmentRecovery = false;
  if (settings.useMaxDepth) {
    for (let index = 0; index < segmentPairs.length - 1; index += 1) {
      const firstFrontage = cadBuildFrontageLineForCurrentParcelSegment(parcel, frontageReference, index);
      const secondFrontage = cadBuildFrontageLineForCurrentParcelSegment(parcel, frontageReference, index + 1);
      if (!firstFrontage || !secondFrontage) continue;
      const cornerDraft = cadBuildCornerInfillDraft(
        parcel,
        firstFrontage,
        secondFrontage,
        settings,
        tool,
      );
      if (!cornerDraft) continue;
      cornerDraftJunctionIndexes.add(index);
      generatedParcels.push(
        ...cornerDraft.draft.generatedParcels.map((generatedParcel) => ({
          ...generatedParcel,
          sourceKind: 'corner_prepass' as const,
          sourceSegmentIndex: index,
        })),
      );
      acceptedCandidates.push(...cornerDraft.draft.acceptedCandidates);
      cornerTrimFromEndMetersBySegment.set(
        index,
        Math.max(
          cornerTrimFromEndMetersBySegment.get(index) ?? 0,
          cornerDraft.firstSegmentTrimMeters,
        ),
      );
      cornerTrimFromStartMetersBySegment.set(
        index + 1,
        Math.max(
          cornerTrimFromStartMetersBySegment.get(index + 1) ?? 0,
          cornerDraft.secondSegmentTrimMeters,
        ),
      );
    }
  }

  for (let index = 0; index < segmentPairs.length; index += 1) {
    const carriedFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      currentParcel,
      frontageReference,
      index,
    );
    const originalFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      parcel,
      frontageReference,
      index,
    );
    const carriedFrontageLengthMeters = carriedFrontage
      ? cadDistance(
          { x: carriedFrontage.fromX, y: carriedFrontage.fromY },
          { x: carriedFrontage.toX, y: carriedFrontage.toY },
        )
      : 0;
    const originalFrontageLengthMeters = originalFrontage
      ? cadDistance(
          { x: originalFrontage.fromX, y: originalFrontage.fromY },
          { x: originalFrontage.toX, y: originalFrontage.toY },
        )
      : 0;
    const carriedFrontageStartShiftMeters =
      carriedFrontage && originalFrontage
        ? Math.min(
            cadDistance(
              { x: carriedFrontage.fromX, y: carriedFrontage.fromY },
              { x: originalFrontage.fromX, y: originalFrontage.fromY },
            ),
            cadDistance(
              { x: carriedFrontage.toX, y: carriedFrontage.toY },
              { x: originalFrontage.fromX, y: originalFrontage.fromY },
            ),
          )
        : 0;
    const shouldRecoverFullParentSegment =
      settings.useMaxDepth &&
      index > 0 &&
      originalFrontageLengthMeters > settings.minFrontageMeters * 2 &&
      (carriedFrontageLengthMeters + settings.minFrontageMeters < originalFrontageLengthMeters * 0.5 ||
        (index > 1 && carriedFrontageStartShiftMeters > settings.minFrontageMeters * 2));
    const segmentSourceParcel = shouldRecoverFullParentSegment ? parcel : currentParcel;
    if (shouldRecoverFullParentSegment) {
      usedFullParentSegmentRecovery = true;
    }
    const rawCurrentFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      segmentSourceParcel,
      frontageReference,
      index,
    );
    if (!rawCurrentFrontage) continue;
    let currentFrontage = rawCurrentFrontage;
    let trimFromStartMeters = cornerTrimFromStartMetersBySegment.get(index) ?? 0;
    let trimFromEndMeters = cornerTrimFromEndMetersBySegment.get(index) ?? 0;
    if (settings.useMaxDepth) {
      const previousJunctionIndex = index - 1;
      if (previousJunctionIndex >= 0 && !cornerDraftJunctionIndexes.has(previousJunctionIndex)) {
        const previousFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          parcel,
          frontageReference,
          previousJunctionIndex,
        );
        const originalCurrentFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          parcel,
          frontageReference,
          index,
        );
        if (previousFrontage && originalCurrentFrontage) {
          if (previousFrontage.toStationId === originalCurrentFrontage.fromStationId) {
            trimFromStartMeters = Math.max(
              trimFromStartMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  previousFrontage,
                  'start',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          } else if (previousFrontage.toStationId === originalCurrentFrontage.toStationId) {
            trimFromEndMeters = Math.max(
              trimFromEndMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  previousFrontage,
                  'end',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          } else if (previousFrontage.fromStationId === originalCurrentFrontage.fromStationId) {
            trimFromStartMeters = Math.max(
              trimFromStartMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  {
                    ...previousFrontage,
                    fromStationId: previousFrontage.toStationId,
                    fromX: previousFrontage.toX,
                    fromY: previousFrontage.toY,
                    toStationId: previousFrontage.fromStationId,
                    toX: previousFrontage.fromX,
                    toY: previousFrontage.fromY,
                  },
                  'start',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          } else if (previousFrontage.fromStationId === originalCurrentFrontage.toStationId) {
            trimFromEndMeters = Math.max(
              trimFromEndMeters,
              cadBuildCappedFallbackCornerTrimDistance(
                cadBuildReservedFrontageTrimDistance(
                  originalCurrentFrontage,
                  {
                    ...previousFrontage,
                    fromStationId: previousFrontage.toStationId,
                    fromX: previousFrontage.toX,
                    fromY: previousFrontage.toY,
                    toStationId: previousFrontage.fromStationId,
                    toX: previousFrontage.fromX,
                    toY: previousFrontage.fromY,
                  },
                  'end',
                  settings.maxDepthMeters,
                ),
                settings,
              ),
            );
          }
        }
      }
    }
    currentFrontage =
      cadBuildTrimmedFrontageLine(currentFrontage, trimFromStartMeters, trimFromEndMeters) ??
      currentFrontage;

    const isLastSegment = index === segmentPairs.length - 1;
    const forceRemainderParcel =
      settings.useMaxDepth && segmentPairs.length > 1 && settings.remainderDistribution === 'place_remainder_in_last_parcel';
    const segmentSettings = isLastSegment && !forceRemainderParcel
      ? settings
      : {
          ...settings,
          remainderDistribution: 'create_parcel_from_remainder' as const,
        };
    const segmentDraft =
      (settings.useMaxDepth
        ? cadBuildParcelFrontageStripAutoLayoutDraft(
            segmentSourceParcel,
            currentFrontage,
            segmentSettings,
            tool,
          )
        : null) ??
      cadBuildParcelAutoLayoutDraft(
        segmentSourceParcel,
        currentFrontage,
        segmentSettings,
        tool,
      );
    if (!segmentDraft.isValid) {
      continue;
    }

    const segmentGeneratedParcels = [...segmentDraft.generatedParcels];
    const trailingRemainder =
      !isLastSegment && segmentGeneratedParcels.at(-1)?.role === 'remainder'
        ? segmentGeneratedParcels.pop() ?? null
        : null;
    const frontageRemainder =
      !isLastSegment && segmentGeneratedParcels.at(-1)?.role === 'remainder'
        ? segmentGeneratedParcels.pop() ?? null
        : null;

    generatedParcels.push(
      ...segmentGeneratedParcels.map((generatedParcel) => ({
        ...generatedParcel,
        sourceKind: generatedParcel.sourceKind ?? 'segment',
        sourceSegmentIndex: index,
      })),
    );
    acceptedCandidates.push(...segmentDraft.acceptedCandidates);
    if (frontageRemainder) {
      const frontageRemainderMeters =
        (frontageRemainder as CadParcelLayoutGeneratedParcelDraft & {
          frontageLengthMeters?: number;
        }).frontageLengthMeters ?? 0;
      const combinedFrontageMeters = Math.max(
        settings.minFrontageMeters,
        frontageRemainderMeters + settings.minFrontageMeters,
      );
      const cornerCandidate = cadBuildCornerRemainderPreviewCandidate(
        currentFrontage,
        settings,
        frontageRemainder,
        combinedFrontageMeters,
        tool,
      );
      if (cornerCandidate?.isValid) {
        generatedParcels.push({
          ...frontageRemainder,
          role: 'lot',
          sourceKind: 'corner_remainder',
          sourceSegmentIndex: index,
        });
        acceptedCandidates.push(cornerCandidate);
      } else {
        generatedParcels.push({
          ...frontageRemainder,
          sourceKind: 'segment',
          sourceSegmentIndex: index,
        });
      }
    }

    if (!isLastSegment && trailingRemainder) {
      let nextParcel = cadBuildParcelEntityFromGeneratedDraft(parcel, trailingRemainder, true);
      if (settings.useMaxDepth && !cornerDraftJunctionIndexes.has(index)) {
        const currentResidualFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          nextParcel,
          frontageReference,
          index,
        );
        const nextResidualFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          nextParcel,
          frontageReference,
          index + 1,
        );
        if (currentResidualFrontage && nextResidualFrontage) {
          const bridgeDraft = cadBuildFrontageBridgeDraft(
            nextParcel,
            currentResidualFrontage,
            nextResidualFrontage,
            settings,
            tool,
          );
          if (bridgeDraft?.draft.generatedParcels.length) {
            generatedParcels.push(
              ...bridgeDraft.draft.generatedParcels.map((generatedParcel) => ({
                ...generatedParcel,
                sourceKind: 'corner_remainder' as const,
                sourceSegmentIndex: index,
              })),
            );
            acceptedCandidates.push(...bridgeDraft.draft.acceptedCandidates);
            if (bridgeDraft.remainderDraft) {
              nextParcel = cadBuildParcelEntityFromGeneratedDraft(
                parcel,
                bridgeDraft.remainderDraft,
                true,
              );
            }
          }
          const remainderCornerDraft = bridgeDraft
            ? null
            : cadBuildRemainderJunctionInfillDraft(
                nextParcel,
                currentResidualFrontage,
                nextResidualFrontage,
                settings,
                tool,
              );
          if (remainderCornerDraft?.draft.generatedParcels.length) {
            generatedParcels.push(
              ...remainderCornerDraft.draft.generatedParcels.map((generatedParcel) => ({
                ...generatedParcel,
                sourceKind: 'corner_remainder' as const,
                sourceSegmentIndex: index,
              })),
            );
            acceptedCandidates.push(...remainderCornerDraft.draft.acceptedCandidates);
            if (remainderCornerDraft.remainderDraft) {
              nextParcel = cadBuildParcelEntityFromGeneratedDraft(
                parcel,
                remainderCornerDraft.remainderDraft,
                true,
              );
            }
          }
        }
      }
      currentParcel = nextParcel;
    }
  }

  if (generatedParcels.length < 2) {
    return {
      tool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Automatic fill could not create valid lots from the selected frontage edges.',
    };
  }

  const resolvedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels,
    acceptedCandidates,
    isValid: true,
    statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the selected frontage edges.`,
  });
  if (usedFullParentSegmentRecovery) {
    return resolvedDraft;
  }
  return cadTryFillGeneratedRemaindersFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    tool,
    resolvedDraft,
  );
};

export const cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  const preferredDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    preferredTool,
  );
  const alternateTool = preferredTool === 'slide' ? 'swing' : 'slide';
  if (preferredDraft.isValid) {
    return preferredDraft;
  }

  const alternateDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    alternateTool,
  );
  return alternateDraft.isValid ? alternateDraft : preferredDraft;
};
