import { cadDistance, type CadWorldPoint } from './cadGeometry';
import type { CadLineEntity, CadParcelEntity } from './cadTypes';
import {
  cadBuildParcelClosureSummary,
  cadPointOnSegment,
  normalizeParcelPolygonVertices,
  normalizeParcelVertexLabel,
  parcelPointsMatch,
} from './cadCogoParcelGeometry';
import { type CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutGeneratedParcelDraft,
} from './cadCogoParcelLayoutTypes';

export const cadCloneParcelLayoutGeneratedDraft = (
  vertices: readonly CadWorldPoint[],
  vertexLabels: readonly string[],
  role: CadParcelLayoutGeneratedParcelDraft['role'],
): CadParcelLayoutGeneratedParcelDraft => ({
  vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  vertexLabels: [...vertexLabels],
  role,
});

export const cadBuildParcelEntityFromGeneratedDraft = (
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

export const cadCanonicalizeParcelAgainstFrontage = (
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

export const cadBuildFrontageLineFromParcelLabelPair = (
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

export const cadBuildFrontageLineFromCurrentParcelSegmentGeometry = (
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

export const cadBuildFrontageLineForCurrentParcelSegment = (
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

export const cadBuildFrontageReferenceSubset = (
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

export const cadBuildGeneratedDraftRemainderAreaSquareMeters = (
  draft: CadParcelAutoLayoutDraft,
): number =>
  draft.generatedParcels.reduce((total, generatedParcel) => {
    if (generatedParcel.role !== 'remainder') return total;
    return total + (cadBuildParcelClosureSummary(generatedParcel.vertices)?.areaSquareMeters ?? 0);
  }, 0);

export const cadGeneratedParcelDraftsMatch = (
  first: CadParcelLayoutGeneratedParcelDraft,
  second: CadParcelLayoutGeneratedParcelDraft,
): boolean =>
  first.role === second.role &&
  first.vertices.length === second.vertices.length &&
  first.vertices.every((vertex, index) => parcelPointsMatch(vertex, second.vertices[index]!));

export const cadBuildCornerFrontageReference = (
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
