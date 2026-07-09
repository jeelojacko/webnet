import { cadDistance } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometry';
import {
  cadBuildDepthLimitedParcelFromFrontage,
} from './cadCogoParcelLayoutPrimitives';
import type {
  CadParcelAutoLayoutDraft,
  CadParcelLayoutGeneratedParcelDraft,
} from './cadCogoParcelLayoutTypes';
import {
  cadBuildCornerFrontageReference,
} from './cadCogoParcelLayoutDrafts';
import { cadBuildGeneratedParcelOverlapPairCount } from './cadCogoParcelLayoutConflicts';
import {
  cadBuildCornerFrontageConsumptionMeters,
  cadBuildCornerFrontageTouchingLotCount,
  cadBuildSharedFrontagePoint,
  cadGeneratedParcelTouchesFrontageLine,
  cadGeneratedParcelTouchesPoint,
} from './cadCogoParcelCornerGeometry';
import { cadBuildParcelFrontagePathAutoLayoutDraft } from './cadCogoParcelFrontagePathAutoLayout';
import {
  cadBuildCornerJunctionReplacementLotCount,
  cadBuildLimitedCornerPathDraft,
  cadBuildSequentialCornerStripDraft,
} from './cadCogoParcelFrontageReferenceCornerHelpers';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import type { CadCornerInfillDraft } from './cadCogoParcelFrontageReferenceAutoLayoutTypes';
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

export const cadBuildCornerInfillDraft = ({
  parcel,
  firstFrontageLine,
  secondFrontageLine,
  settings,
  tool,
  buildParcelAutoLayoutDraftFromFrontageReference,
  buildPreferredParcelAutoLayoutDraftFromFrontageReference,
  mode = 'prepass',
}: {
  parcel: CadParcelEntity;
  firstFrontageLine: CadLineEntity;
  secondFrontageLine: CadLineEntity;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
  buildParcelAutoLayoutDraftFromFrontageReference: (
    _parcel: CadParcelEntity,
    _frontageReference: CadParcelLayoutFrontageReference,
    _settings: CadParcelLayoutSettings,
    _tool: 'slide' | 'swing',
  ) => CadParcelAutoLayoutDraft;
  buildPreferredParcelAutoLayoutDraftFromFrontageReference: (
    _parcel: CadParcelEntity,
    _frontageReference: CadParcelLayoutFrontageReference,
    _settings: CadParcelLayoutSettings,
    _preferredTool: 'slide' | 'swing',
  ) => CadParcelAutoLayoutDraft;
  mode?: 'prepass' | 'remainder';
}): CadCornerInfillDraft | null => {
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
        const fallbackCornerDraft = buildPreferredParcelAutoLayoutDraftFromFrontageReference(
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
    const chainedCornerDraft = buildParcelAutoLayoutDraftFromFrontageReference(
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
