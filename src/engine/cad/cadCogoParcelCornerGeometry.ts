import { cadDistance, type CadWorldPoint } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings } from './cadTypes';
import { cadBuildFrontageLineFromCurrentParcelSegmentGeometry } from './cadCogoParcelLayoutDrafts';
import {
  cadDistancePointToSegment,
} from './cadCogoParcelLayoutPrimitives';
import {
  cadPointOnSegment,
  normalizeParcelPolygonVertices,
  parcelPointsMatch,
} from './cadCogoParcelGeometry';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutGeneratedParcelDraft,
} from './cadCogoParcelLayoutTypes';

export const cadBuildCornerFrontageConsumptionMeters = (
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

export const cadBuildCornerFrontageTouchingLotCount = (
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

export const cadGeneratedParcelTouchesFrontageLine = (
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

export const cadBuildSharedFrontagePoint = (
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

export const cadGeneratedParcelTouchesPoint = (
  generatedParcel: CadParcelLayoutGeneratedParcelDraft,
  point: CadWorldPoint,
): boolean => {
  const vertices = normalizeParcelPolygonVertices(generatedParcel.vertices);
  return vertices.some((start, index) =>
    cadPointOnSegment(point, start, vertices[(index + 1) % vertices.length]!),
  );
};

export const cadBuildTaggedGeneratedLotDraft = ({
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

export const cadBuildTrimmedFrontageLine = (
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

export const cadBuildReservedFrontageTrimDistance = (
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

export const cadBuildCappedFallbackCornerTrimDistance = (
  reserveMeters: number,
  settings: CadParcelLayoutSettings,
): number =>
  Math.min(
    reserveMeters,
    Math.max(settings.minFrontageMeters, settings.minWidthMeters, 1e-9),
  );
