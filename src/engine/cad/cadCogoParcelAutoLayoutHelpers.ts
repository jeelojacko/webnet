import { cadDistance } from './cadGeometry';
import type { CadLineEntity, CadParcelEntity, CadParcelLayoutSettings } from './cadTypes';
import {
  cadBuildAutomaticTargetAreaSquareMeters,
  cadBuildParcelLayoutPreviewCandidateForTargetArea,
} from './cadCogoParcelLayoutEvaluation';
import type { CadParcelLayoutPreviewCandidate } from './cadCogoParcelLayoutTypes';

export const cadStabilizeParcelVertexCoordinates = (
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

export const cadStabilizeFrontageLine = (
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

export const cadBuildAutoLayoutRemainderFrontageLine = (
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

export const cadCanCreateAnotherAutoLayoutLot = (
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
