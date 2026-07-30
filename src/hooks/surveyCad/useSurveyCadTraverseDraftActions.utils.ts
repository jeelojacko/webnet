import type { MutableRefObject } from 'react';
import type {
  CommandPoint,
  CommandSession,
  TraverseSideshotDraft,
} from './useSurveyCadCommandTypes';
import type { TraverseSession } from './useSurveyCadTraverseDraftActions.types';

export const commandPointsMatch = (first: CommandPoint, second: CommandPoint): boolean =>
  Math.abs(first.x - second.x) <= 1e-9 && Math.abs(first.y - second.y) <= 1e-9;

export const filterTraverseSideshotsForPoints = (
  points: CommandPoint[],
  sideshots: TraverseSideshotDraft[],
): TraverseSideshotDraft[] =>
  sideshots.filter((shot) =>
    points.some((point, index, sourcePoints) =>
      point.label === shot.occupyLabel && index > 0 && sourcePoints[index - 1]?.label === shot.backsightLabel,
    ),
  );

export const getTraverseSession = (
  sessionRef: MutableRefObject<CommandSession | null>,
): TraverseSession | null => {
  const current = sessionRef.current;
  return current?.key === 'TRAVERSE' ? current : null;
};
