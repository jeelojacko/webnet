import { cadDistance } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings } from './cadTypes';
import type { CadParcelAutoLayoutDraft } from './cadCogoParcelLayoutTypes';

export interface CadCornerDraftRankingEntry {
  draft: CadParcelAutoLayoutDraft;
  remainderAreaSquareMeters: number;
  maximumLotFrontageMeters: number;
  firstSegmentTrimMeters: number;
  secondSegmentTrimMeters: number;
  materialOverlapPairCount: number;
  junctionReplacementLotCount: number;
  firstFrontageLotCount: number;
  secondFrontageLotCount: number;
}

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

export const cadCompareCornerDraftRankingEntries = ({
  firstFrontageLine,
  includeJunctionReplacementLotCount,
  left,
  mode,
  right,
  secondFrontageLine,
  settings,
}: {
  firstFrontageLine: CadLineEntity;
  includeJunctionReplacementLotCount: boolean;
  left: CadCornerDraftRankingEntry;
  mode: 'prepass' | 'remainder';
  right: CadCornerDraftRankingEntry;
  secondFrontageLine: CadLineEntity;
  settings: CadParcelLayoutSettings;
}): number => {
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
