import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import type { CadLineEntity, CadParcelEntity, CadParcelLayoutSettings } from './cadTypes';
import type { CadParcelAutoLayoutDraft } from './cadCogoParcelLayoutTypes';
import {
  cadBuildCornerFrontageConsumptionMeters,
} from './cadCogoParcelCornerGeometry';
import {
  cadBuildCornerFrontageReference,
} from './cadCogoParcelLayoutDrafts';
import { cadBuildGeneratedParcelOverlapPairCount } from './cadCogoParcelLayoutConflicts';
import { cadBuildParcelFrontagePathAutoLayoutDraft } from './cadCogoParcelFrontagePathAutoLayout';
import type { CadCornerInfillDraft } from './cadCogoParcelFrontageReferenceAutoLayoutTypes';

type FrontageReferenceDraftBuilder = (
  _parcel: CadParcelEntity,
  _frontageReference: CadParcelLayoutFrontageReference,
  _settings: CadParcelLayoutSettings,
  _tool: 'slide' | 'swing',
) => CadParcelAutoLayoutDraft;

export const cadBuildRemainderJunctionInfillDraft = ({
  buildParcelAutoLayoutDraftFromFrontageReference,
  buildPreferredParcelAutoLayoutDraftFromFrontageReference,
  firstFrontageLine,
  parcel,
  secondFrontageLine,
  settings,
  tool,
}: {
  buildParcelAutoLayoutDraftFromFrontageReference: FrontageReferenceDraftBuilder;
  buildPreferredParcelAutoLayoutDraftFromFrontageReference: FrontageReferenceDraftBuilder;
  parcel: CadParcelEntity;
  firstFrontageLine: CadLineEntity;
  secondFrontageLine: CadLineEntity;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}): CadCornerInfillDraft | null => {
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
      const preferredDraft = buildPreferredParcelAutoLayoutDraftFromFrontageReference(
        parcel,
        cornerFrontageReference,
        variantSettings,
        tool,
      );
      if (preferredDraft.isValid && preferredDraft.acceptedCandidates.length > 0) {
        candidateDrafts.push(preferredDraft);
      }
      const chainedDraft = buildParcelAutoLayoutDraftFromFrontageReference(
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
          draft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ??
          null,
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
