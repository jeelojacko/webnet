import { cadSegmentIntersection } from './cadGeometry';
import {
  cadBuildParcelOverlapAreaSquareMeters,
  cadPointStrictlyInPolygon,
  normalizeParcelPolygonVertices,
  parcelPointsMatch,
} from './cadCogoParcelGeometry';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutGeneratedParcelDraft,
  type CadParcelLayoutPreviewCandidate,
} from './cadCogoParcelLayoutTypes';

export interface CadGeneratedLotConflictPair {
  firstLotIndex: number;
  secondLotIndex: number;
  overlapAreaSquareMeters: number;
}

export interface CadGeneratedParcelLotEntry {
  generatedParcelIndex: number;
  lotIndex: number;
  candidateIndex: number;
  generatedParcel: CadParcelLayoutGeneratedParcelDraft;
  candidate: CadParcelLayoutPreviewCandidate;
}

export const cadBuildGeneratedParcelOverlapPairCount = (
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): number => {
  return cadBuildGeneratedParcelConflictPairs(generatedParcels).length;
};

export const cadBuildGeneratedParcelConflictPairs = (
  generatedParcels: readonly CadParcelLayoutGeneratedParcelDraft[],
): CadGeneratedLotConflictPair[] => {
  const conflictPairs: CadGeneratedLotConflictPair[] = [];
  for (let firstIndex = 0; firstIndex < generatedParcels.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < generatedParcels.length; secondIndex += 1) {
      const firstVertices = normalizeParcelPolygonVertices(generatedParcels[firstIndex]!.vertices);
      const secondVertices = normalizeParcelPolygonVertices(generatedParcels[secondIndex]!.vertices);
      if (firstVertices.length < 3 || secondVertices.length < 3) continue;
      const hasMaterialConflict =
        firstVertices.some((point) => cadPointStrictlyInPolygon(point, secondVertices)) ||
        secondVertices.some((point) => cadPointStrictlyInPolygon(point, firstVertices)) ||
        firstVertices.some((start, index) => {
          const end = firstVertices[(index + 1) % firstVertices.length]!;
          return secondVertices.some((clipStart, clipIndex) => {
            const clipEnd = secondVertices[(clipIndex + 1) % secondVertices.length]!;
            const intersection = cadSegmentIntersection(start, end, clipStart, clipEnd);
            if (!intersection) return false;
            const touchesAtSharedVertex =
              [start, end, clipStart, clipEnd].some((vertex) => parcelPointsMatch(intersection, vertex));
            return !touchesAtSharedVertex;
          });
        });
      if (hasMaterialConflict) {
        const overlapAreaSquareMeters = cadBuildParcelOverlapAreaSquareMeters(firstVertices, secondVertices);
        if (overlapAreaSquareMeters > 1) {
          conflictPairs.push({
            firstLotIndex: firstIndex,
            secondLotIndex: secondIndex,
            overlapAreaSquareMeters,
          });
        }
      }
    }
  }
  return conflictPairs;
};

export const cadBuildDraftLotEntries = ({
  generatedParcels,
  acceptedCandidates,
}: Pick<CadParcelAutoLayoutDraft, 'generatedParcels' | 'acceptedCandidates'>): CadGeneratedParcelLotEntry[] => {
  const lotEntries: CadGeneratedParcelLotEntry[] = [];
  let lotIndex = 0;
  let candidateIndex = 0;
  generatedParcels.forEach((generatedParcel, generatedParcelIndex) => {
    if (generatedParcel.role !== 'lot') return;
    const candidate = acceptedCandidates[candidateIndex];
    if (candidate) {
      lotEntries.push({
        generatedParcelIndex,
        lotIndex,
        candidateIndex,
        generatedParcel,
        candidate,
      });
    }
    lotIndex += 1;
    candidateIndex += 1;
  });
  return lotEntries;
};

export const cadResolveGeneratedParcelConflicts = (
  draft: CadParcelAutoLayoutDraft,
): CadParcelAutoLayoutDraft => {
  const buildSourcePriority = (
    sourceKind: CadParcelLayoutGeneratedParcelDraft['sourceKind'],
  ): number => {
    switch (sourceKind) {
      case 'corner_remainder':
        return 0;
      case 'corner_prepass':
        return 1;
      case 'segment':
        return 2;
      default:
        return 3;
    }
  };
  const lotEntries = cadBuildDraftLotEntries(draft);
  if (lotEntries.length < 2) return draft;
  const conflictPairs = cadBuildGeneratedParcelConflictPairs(
    lotEntries.map((entry) => entry.generatedParcel),
  );
  if (conflictPairs.length === 0) return draft;

  const activeLotIndexes = new Set(lotEntries.map((entry) => entry.lotIndex));
  while (true) {
    const activeConflictPairs = conflictPairs.filter(
      (pair) =>
        activeLotIndexes.has(pair.firstLotIndex) &&
        activeLotIndexes.has(pair.secondLotIndex),
    );
    if (activeConflictPairs.length === 0) break;

    const metricsByLotIndex = new Map<
      number,
      {
        degree: number;
        overlapAreaSquareMeters: number;
      }
    >();
    activeConflictPairs.forEach((pair) => {
      const firstMetrics = metricsByLotIndex.get(pair.firstLotIndex) ?? {
        degree: 0,
        overlapAreaSquareMeters: 0,
      };
      firstMetrics.degree += 1;
      firstMetrics.overlapAreaSquareMeters += pair.overlapAreaSquareMeters;
      metricsByLotIndex.set(pair.firstLotIndex, firstMetrics);

      const secondMetrics = metricsByLotIndex.get(pair.secondLotIndex) ?? {
        degree: 0,
        overlapAreaSquareMeters: 0,
      };
      secondMetrics.degree += 1;
      secondMetrics.overlapAreaSquareMeters += pair.overlapAreaSquareMeters;
      metricsByLotIndex.set(pair.secondLotIndex, secondMetrics);
    });

    const lotToRemove =
      lotEntries
        .filter((entry) => activeLotIndexes.has(entry.lotIndex))
        .sort((left, right) => {
          const leftMetrics = metricsByLotIndex.get(left.lotIndex) ?? {
            degree: 0,
            overlapAreaSquareMeters: 0,
          };
          const rightMetrics = metricsByLotIndex.get(right.lotIndex) ?? {
            degree: 0,
            overlapAreaSquareMeters: 0,
          };
          if (leftMetrics.degree !== rightMetrics.degree) {
            return rightMetrics.degree - leftMetrics.degree;
          }
          if (
            Math.abs(leftMetrics.overlapAreaSquareMeters - rightMetrics.overlapAreaSquareMeters) >
            1e-6
          ) {
            return rightMetrics.overlapAreaSquareMeters - leftMetrics.overlapAreaSquareMeters;
          }
          const leftScore = left.candidate.evaluation?.score ?? Number.POSITIVE_INFINITY;
          const rightScore = right.candidate.evaluation?.score ?? Number.POSITIVE_INFINITY;
          const leftSourcePriority = buildSourcePriority(left.generatedParcel.sourceKind);
          const rightSourcePriority = buildSourcePriority(right.generatedParcel.sourceKind);
          if (leftSourcePriority !== rightSourcePriority) {
            return rightSourcePriority - leftSourcePriority;
          }
          if (Math.abs(leftScore - rightScore) > 1e-6) {
            return rightScore - leftScore;
          }
          const leftFrontage =
            'frontageLengthMeters' in left.generatedParcel
              ? (left.generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          const rightFrontage =
            'frontageLengthMeters' in right.generatedParcel
              ? (right.generatedParcel as CadParcelLayoutGeneratedParcelDraft & {
                  frontageLengthMeters?: number;
                }).frontageLengthMeters ?? 0
              : 0;
          if (Math.abs(leftFrontage - rightFrontage) > 1e-6) {
            return rightFrontage - leftFrontage;
          }
          return right.lotIndex - left.lotIndex;
        })[0] ?? null;
    if (!lotToRemove) break;
    activeLotIndexes.delete(lotToRemove.lotIndex);
  }

  const removedGeneratedParcelIndexes = new Set<number>();
  const removedCandidateIndexes = new Set<number>();
  lotEntries.forEach((entry) => {
    if (activeLotIndexes.has(entry.lotIndex)) return;
    removedGeneratedParcelIndexes.add(entry.generatedParcelIndex);
    removedCandidateIndexes.add(entry.candidateIndex);
  });
  if (removedGeneratedParcelIndexes.size === 0) return draft;
  const resolvedGeneratedParcels = draft.generatedParcels.filter(
    (_generatedParcel, index) => !removedGeneratedParcelIndexes.has(index),
  );
  const resolvedAcceptedCandidates = draft.acceptedCandidates.filter(
    (_candidate, index) => !removedCandidateIndexes.has(index),
  );
  return {
    ...draft,
    generatedParcels: resolvedGeneratedParcels,
    acceptedCandidates: resolvedAcceptedCandidates,
    statusMessage: `${draft.statusMessage} Removed ${removedGeneratedParcelIndexes.size} overlapping duplicate lots; kept ${resolvedAcceptedCandidates.length} lots and ${resolvedGeneratedParcels.length} parcels.`,
  };
};
