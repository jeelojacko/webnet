import type { CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutGeneratedParcelDraft,
} from './cadCogoParcelLayoutTypes';
import {
  cadBuildFrontageLineForCurrentParcelSegment,
  cadBuildFrontageReferenceSubset,
  cadBuildGeneratedDraftRemainderAreaSquareMeters,
  cadBuildParcelEntityFromGeneratedDraft,
  cadGeneratedParcelDraftsMatch,
} from './cadCogoParcelLayoutDrafts';
import {
  cadBuildDraftLotEntries,
  cadBuildGeneratedParcelConflictPairs,
  cadResolveGeneratedParcelConflicts,
} from './cadCogoParcelLayoutConflicts';
import { cadBuildParcelAutoLayoutDraftForSupportedRemainderMode } from './cadCogoParcelAutoLayoutSequence';

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

export const cadTryFillGeneratedRemaindersFromFrontageReference = (
  sourceParcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
  draft: CadParcelAutoLayoutDraft,
  buildParcelAutoLayoutDraftFromFrontageReference: (
    _parcel: CadParcelEntity,
    _frontageReference: CadParcelLayoutFrontageReference,
    _settings: CadParcelLayoutSettings,
    _tool: 'slide' | 'swing',
  ) => CadParcelAutoLayoutDraft,
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
        const selectedFrontageDraft = buildParcelAutoLayoutDraftFromFrontageReference(
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
