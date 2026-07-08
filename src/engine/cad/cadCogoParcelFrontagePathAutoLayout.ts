import type { CadLineEntity, CadParcelEntity, CadParcelLayoutSettings } from './cadTypes';
import { cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel } from './cadCogoParcelLayoutEvaluation';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import {
  cadBuildDepthLimitedStripGeneratedParcel,
  cadBuildDepthLimitedStripRearRemainder,
  cadBuildParcelLayoutFrontagePath,
  cadBuildParcelLayoutFrontageSubPath,
  cadBuildParcelLayoutGeneratedParcelFromFrontageInterval,
  cadBuildParcelLayoutPathDepthMeters,
} from './cadCogoParcelLayoutPrimitives';
import type {
  CadParcelAutoLayoutDraft,
  CadParcelLayoutGeneratedParcelDraft,
  CadParcelLayoutPreviewCandidate,
} from './cadCogoParcelLayoutTypes';

export const cadBuildParcelFrontagePathAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  const path = cadBuildParcelLayoutFrontagePath(parcel, frontageReference);
  if (!path || path.totalLengthMeters + 1e-9 < settings.minFrontageMeters) {
    return null;
  }
  const buildLotCandidate = (
    startDistanceMeters: number,
    endDistanceMeters: number,
    lotIndex: number,
    role: 'lot' | 'remainder',
  ) => {
    const frontageSubPath = cadBuildParcelLayoutFrontageSubPath(path, startDistanceMeters, endDistanceMeters);
    if (!frontageSubPath) return null;
    const generatedParcel =
      settings.useMaxDepth && path.segments.length === 1 && path.segments[0]?.kind === 'line'
        ? cadBuildDepthLimitedStripGeneratedParcel(
            parcel,
            frontageReference.frontageLine,
            startDistanceMeters,
            endDistanceMeters,
            settings.maxDepthMeters,
            lotIndex,
            role,
          )
        : cadBuildParcelLayoutGeneratedParcelFromFrontageInterval(
            parcel,
            path,
            startDistanceMeters,
            endDistanceMeters,
            lotIndex,
            role,
          );
    if (!generatedParcel) return null;
    const frontageLine: CadLineEntity = {
      ...frontageReference.frontageLine,
      id: `${frontageReference.frontageLine.id}:path:${lotIndex + 1}`,
      fromX: generatedParcel.frontageStart.x,
      fromY: generatedParcel.frontageStart.y,
      toX: generatedParcel.frontageEnd.x,
      toY: generatedParcel.frontageEnd.y,
    };
    const pathDepthMeters = cadBuildParcelLayoutPathDepthMeters(generatedParcel.vertices, frontageSubPath);
    const previewCandidate = cadBuildAutoLayoutPreviewCandidateFromGeneratedParcel(
      frontageLine,
      generatedParcel.frontageLengthMeters,
      pathDepthMeters,
      settings,
      generatedParcel,
    );
    return {
      generatedParcel,
      frontageLine,
      frontageSubPath,
      pathDepthMeters,
      previewCandidate,
    };
  };
  type CadFrontagePathLotCandidate = NonNullable<ReturnType<typeof buildLotCandidate>>;

  const solveGreedyEndDistance = (
    startDistanceMeters: number,
    lotIndex: number,
  ): CadFrontagePathLotCandidate | null => {
    const minimumEndDistance = startDistanceMeters + settings.minFrontageMeters;
    if (minimumEndDistance > path.totalLengthMeters + 1e-9) return null;
    let bestValid: CadFrontagePathLotCandidate | null = null;
    let previousInvalidDistance = startDistanceMeters;
    const coarseSteps = 72;
    for (let index = 0; index < coarseSteps; index += 1) {
      const ratio = index / (coarseSteps - 1);
      const candidateEndDistance =
        minimumEndDistance + (path.totalLengthMeters - minimumEndDistance) * ratio;
      const candidate = buildLotCandidate(startDistanceMeters, candidateEndDistance, lotIndex, 'lot');
      if (candidate?.previewCandidate.isValid) {
        bestValid = candidate;
        break;
      }
      previousInvalidDistance = candidateEndDistance;
    }
    if (!bestValid) {
      return null;
    }
    let low = Math.max(minimumEndDistance, previousInvalidDistance);
    let high = bestValid.generatedParcel.frontageLengthMeters + startDistanceMeters;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const midpoint = (low + high) / 2;
      const candidate = buildLotCandidate(startDistanceMeters, midpoint, lotIndex, 'lot');
      if (candidate?.previewCandidate.isValid) {
        bestValid = candidate;
        high = midpoint;
      } else {
        low = midpoint;
      }
    }
    return bestValid;
  };

  const buildGreedyLots = (): {
    lots: CadFrontagePathLotCandidate[];
    remainderStartDistanceMeters: number;
  } => {
    const lots: CadFrontagePathLotCandidate[] = [];
    let cursor = 0;
    while (cursor + settings.minFrontageMeters <= path.totalLengthMeters + 1e-9) {
      const lotCandidate = solveGreedyEndDistance(cursor, lots.length);
      if (!lotCandidate) {
        break;
      }
      lots.push(lotCandidate);
      cursor += lotCandidate.generatedParcel.frontageLengthMeters;
      if (path.totalLengthMeters - cursor <= 1e-6) {
        cursor = path.totalLengthMeters;
        break;
      }
    }
    return {
      lots,
      remainderStartDistanceMeters: cursor,
    };
  };

  const greedy = buildGreedyLots();
  if (greedy.lots.length === 0) {
    return {
      tool: preferredTool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
    };
  }

  const buildResultFromIntervals = (
    intervals: Array<{ startDistanceMeters: number; endDistanceMeters: number; role: 'lot' | 'remainder' }>,
  ): CadParcelAutoLayoutDraft | null => {
    const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
    const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index]!;
      const candidate = buildLotCandidate(
        interval.startDistanceMeters,
        interval.endDistanceMeters,
        index,
        interval.role,
      );
      if (!candidate) return null;
      generatedParcels.push(candidate.generatedParcel);
      if (interval.role === 'lot') {
        if (!candidate.previewCandidate.isValid) {
          return {
            tool: preferredTool,
            generatedParcels: [],
            acceptedCandidates: [candidate.previewCandidate],
            isValid: false,
            statusMessage: candidate.previewCandidate.statusMessage,
          };
        }
        acceptedCandidates.push({
          ...candidate.previewCandidate,
          tool: preferredTool,
        });
      }
    }
    if (settings.useMaxDepth && path.segments.length === 1 && path.segments[0]?.kind === 'line') {
      const rearRemainder = cadBuildDepthLimitedStripRearRemainder(
        parcel,
        frontageReference.frontageLine,
        settings.maxDepthMeters,
      );
      if (rearRemainder) {
        generatedParcels.push(rearRemainder);
      }
    }
    return {
      tool: preferredTool,
      generatedParcels,
      acceptedCandidates,
      isValid: acceptedCandidates.length > 0,
      statusMessage: `Automatic fill prepared ${generatedParcels.length} frontage-path parcels from the active parent/frontage setup.`,
    };
  };

  const remainderFrontageMeters = Math.max(0, path.totalLengthMeters - greedy.remainderStartDistanceMeters);
  const greedyBoundaries = greedy.lots.reduce<number[]>(
    (boundaries, lot) => {
      boundaries.push(boundaries[boundaries.length - 1]! + lot.generatedParcel.frontageLengthMeters);
      return boundaries;
    },
    [0],
  );
  if (settings.remainderDistribution === 'redistribute_remainder') {
    const lotCount = greedy.lots.length;
    const equalFrontage = path.totalLengthMeters / lotCount;
    const redistributedIntervals = Array.from({ length: lotCount }, (_, index) => ({
      startDistanceMeters: index * equalFrontage,
      endDistanceMeters: index === lotCount - 1 ? path.totalLengthMeters : (index + 1) * equalFrontage,
      role: 'lot' as const,
    }));
    const redistributed = buildResultFromIntervals(redistributedIntervals);
    if (redistributed) {
      return {
        ...redistributed,
        statusMessage: `Automatic fill redistributed remainder across ${lotCount} lots.`,
      };
    }
    return {
      tool: preferredTool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage:
        'Automatic fill could not redistribute remainder across same lot count without breaking parcel constraints.',
    };
  }

  if (settings.remainderDistribution === 'place_remainder_in_last_parcel') {
    const intervals = greedy.lots.map((lot, index) => ({
      startDistanceMeters: greedyBoundaries[index]!,
      endDistanceMeters:
        index === greedy.lots.length - 1 && remainderFrontageMeters > 1e-6
          ? path.totalLengthMeters
          : greedyBoundaries[index + 1]!,
      role: 'lot' as const,
    }));
    const result = buildResultFromIntervals(intervals);
    return result
      ? {
          ...result,
          statusMessage: `Automatic fill prepared ${result.generatedParcels.length} parcels with remainder kept in the last parcel.`,
        }
      : null;
  }

  const intervals: Array<{
    startDistanceMeters: number;
    endDistanceMeters: number;
    role: 'lot' | 'remainder';
  }> = greedy.lots.map((lot, index) => ({
    startDistanceMeters: greedyBoundaries[index]!,
    endDistanceMeters: greedyBoundaries[index + 1]!,
    role: 'lot' as const,
  }));
  if (remainderFrontageMeters > 1e-6) {
    intervals.push({
      startDistanceMeters: greedy.remainderStartDistanceMeters,
      endDistanceMeters: path.totalLengthMeters,
      role: 'remainder' as const,
    });
  }
  return buildResultFromIntervals(intervals);
};

export const cadBuildParcelFrontageStripAutoLayoutDraft = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null =>
  cadBuildParcelFrontagePathAutoLayoutDraft(
    parcel,
    {
      sourceEntityId: frontageLine.id,
      displayLabel: `${frontageLine.fromStationId}-${frontageLine.toStationId}`,
      sourcePointIds: [frontageLine.fromStationId, frontageLine.toStationId],
      frontageLine,
      sourceGeometry: { kind: 'line' },
    },
    settings,
    preferredTool,
  );
