import { cadDistance } from './cadGeometry';
import type { CadLineEntity, CadParcelEntity, CadParcelLayoutSettings } from './cadTypes';
import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometry';
import type { CadParcelAutoLayoutDraft } from './cadCogoParcelLayoutTypes';
import {
  cadBuildParcelAutoLayoutDraftForSupportedRemainderMode,
  isParcelAutoRemainderDistributionSupported,
} from './cadCogoParcelAutoLayoutSequence';
import { cadBuildParcelFrontageStripAutoLayoutDraft } from './cadCogoParcelFrontagePathAutoLayout';

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
