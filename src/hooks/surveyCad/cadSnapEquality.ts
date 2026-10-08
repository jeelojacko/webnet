import type { CadDisplayPoint, CadSnapCandidate, CadSnapLock } from '../../engine/cad/cadTypes';

/**
 * PERF-183.1 — semantic equality for snap state.
 *
 * The snapping hook recomputes candidates on every pointer move. Committing a
 * fresh object identity each time forces a root re-render even when the
 * resolved snap is unchanged. These helpers let the hook keep the previous
 * object whenever every consumed field matches, so React bails out of the
 * state update. Equality is field-by-field (never `id` alone) and includes
 * optional viewport stamps plus guide geometry.
 */

const pointsEqual = (
  left: CadDisplayPoint | undefined,
  right: CadDisplayPoint | undefined,
): boolean => {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return left.x === right.x && left.y === right.y;
};

const guideSegmentsEqual = (
  left: CadSnapCandidate['guideSegments'],
  right: CadSnapCandidate['guideSegments'],
): boolean => {
  if (left === right) return true;
  if (left == null || right == null) return false;
  if (left.length !== right.length) return false;
  return left.every(
    (segment, index) =>
      pointsEqual(segment[0], right[index]![0]) && pointsEqual(segment[1], right[index]![1]),
  );
};

const optionalKindsEqual = (
  left: CadSnapCandidate['compoundKinds'],
  right: CadSnapCandidate['compoundKinds'],
): boolean => {
  if (left === right) return true;
  if (left == null || right == null) return false;
  if (left.length !== right.length) return false;
  return left.every((kind, index) => kind === right[index]);
};

export const cadSnapCandidateEqual = (
  left: CadSnapCandidate | null,
  right: CadSnapCandidate | null,
): boolean => {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.sourceEntityId === right.sourceEntityId &&
    left.sourceSegmentId === right.sourceSegmentId &&
    left.x === right.x &&
    left.y === right.y &&
    left.distance === right.distance &&
    left.label === right.label &&
    left.computedScale === right.computedScale &&
    left.viewportGeneration === right.viewportGeneration &&
    pointsEqual(left.lockGuidePoint, right.lockGuidePoint) &&
    guideSegmentsEqual(left.guideSegments, right.guideSegments) &&
    optionalKindsEqual(left.compoundKinds, right.compoundKinds)
  );
};

export const cadSnapListEqual = (
  left: readonly CadSnapCandidate[],
  right: readonly CadSnapCandidate[],
): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((candidate, index) => cadSnapCandidateEqual(candidate, right[index]!));
};

export const cadSnapLockEqual = (left: CadSnapLock | null, right: CadSnapLock | null): boolean => {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.kind === right.kind &&
    left.sourceEntityId === right.sourceEntityId &&
    left.sourceSegmentId === right.sourceSegmentId &&
    pointsEqual(left.guidePoint, right.guidePoint)
  );
};
