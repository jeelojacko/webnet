import type {
  CadLineEntity,
  CadParcelEntity,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
} from './cadTypes';
import {
  cadBuildAutomaticTargetAreaSquareMeters,
  cadBuildParcelLayoutPreviewCandidateForTargetArea,
} from './cadCogoParcelLayoutEvaluation';
import type {
  CadParcelAutoLayoutDraft,
  CadParcelLayoutGeneratedParcelDraft,
  CadParcelLayoutPreviewCandidate,
} from './cadCogoParcelLayoutTypes';
import {
  cadBuildAutoLayoutRemainderFrontageLine,
  cadCanCreateAnotherAutoLayoutLot,
  cadStabilizeFrontageLine,
  cadStabilizeParcelVertexCoordinates,
} from './cadCogoParcelAutoLayoutHelpers';
import {
  cadBuildParcelEntityFromGeneratedDraft,
  cadCanonicalizeParcelAgainstFrontage,
  cadCloneParcelLayoutGeneratedDraft,
} from './cadCogoParcelLayoutDrafts';

export const isParcelAutoRemainderDistributionSupported = (
  remainderDistribution: CadParcelLayoutRemainderDistribution,
): boolean =>
  remainderDistribution === 'place_remainder_in_last_parcel' ||
  remainderDistribution === 'create_parcel_from_remainder';

export const cadBuildParcelAutoLayoutDraftForSupportedRemainderMode = (
  parcel: CadParcelEntity,
  frontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  if (!isParcelAutoRemainderDistributionSupported(settings.remainderDistribution)) {
    return {
      tool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Selected remainder mode is staged for a later automatic layout slice.',
    };
  }

  let currentParcel = cadStabilizeParcelVertexCoordinates(
    cadCanonicalizeParcelAgainstFrontage(
      {
        ...parcel,
        vertices: parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...parcel.vertexLabels],
      },
      frontageLine,
    ),
  );
  let currentFrontage = cadStabilizeFrontageLine({ ...frontageLine });
  const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];

  for (let iteration = 0; iteration < 64; iteration += 1) {
    const automaticTargetAreaSquareMeters = cadBuildAutomaticTargetAreaSquareMeters(
      currentParcel,
      currentFrontage,
      settings,
    );
    const startCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
      currentParcel,
      currentFrontage,
      settings,
      tool,
      'start',
      automaticTargetAreaSquareMeters,
    );
    const endCandidate = cadBuildParcelLayoutPreviewCandidateForTargetArea(
      currentParcel,
      currentFrontage,
      settings,
      tool,
      'end',
      automaticTargetAreaSquareMeters,
    );
    const candidate =
      [startCandidate, endCandidate].sort((left, right) => {
        if (left.isValid !== right.isValid) return left.isValid ? -1 : 1;
        const leftScore = left.evaluation?.score ?? Number.POSITIVE_INFINITY;
        const rightScore = right.evaluation?.score ?? Number.POSITIVE_INFINITY;
        return leftScore - rightScore;
      })[0] ?? startCandidate;
    if (!candidate.isValid || !candidate.draft) {
      if (generatedParcels.length === 0) {
        return {
          tool,
          generatedParcels: [],
          acceptedCandidates: [],
          isValid: false,
          statusMessage: 'Automatic fill could not create a valid first lot from the active parent and frontage.',
        };
      }
      generatedParcels.push(
        cadCloneParcelLayoutGeneratedDraft(currentParcel.vertices, currentParcel.vertexLabels, 'remainder'),
      );
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }

    const remainderDraft = cadCloneParcelLayoutGeneratedDraft(
      candidate.draft.remainderVertices,
      candidate.draft.remainderVertexLabels,
      'remainder',
    );
    const rawRemainderFrontage =
      tool === 'slide'
        ? cadBuildAutoLayoutRemainderFrontageLine(currentFrontage, candidate)
        : { ...currentFrontage, id: `${currentFrontage.id}:auto-remainder` };
    const remainderFrontage = rawRemainderFrontage
      ? cadStabilizeFrontageLine(rawRemainderFrontage)
      : null;
    const remainderParcel = cadStabilizeParcelVertexCoordinates(
      cadCanonicalizeParcelAgainstFrontage(
        cadBuildParcelEntityFromGeneratedDraft(parcel, remainderDraft),
        remainderFrontage ?? currentFrontage,
      ),
    );
    const canCreateAnotherLot = cadCanCreateAnotherAutoLayoutLot(
      remainderParcel,
      remainderFrontage,
      settings,
      tool,
    );

    if (
      !canCreateAnotherLot &&
      settings.remainderDistribution === 'place_remainder_in_last_parcel'
    ) {
      if (generatedParcels.length === 0) {
        return {
          tool,
          generatedParcels: [],
          acceptedCandidates: [],
          isValid: false,
          statusMessage: 'Automatic fill needs room for at least two valid lots when remainder stays in the last parcel.',
        };
      }
      generatedParcels.push(
        cadCloneParcelLayoutGeneratedDraft(currentParcel.vertices, currentParcel.vertexLabels, 'remainder'),
      );
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels with remainder kept in the last parcel.`,
      };
    }

    generatedParcels.push(
      cadCloneParcelLayoutGeneratedDraft(candidate.draft.childVertices, candidate.draft.childVertexLabels, 'lot'),
    );
    acceptedCandidates.push(candidate);

    if (!canCreateAnotherLot) {
      generatedParcels.push(remainderDraft);
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }

    currentParcel = remainderParcel;
    if (!remainderFrontage) {
      generatedParcels.push(remainderDraft);
      return {
        tool,
        generatedParcels,
        acceptedCandidates,
        isValid: true,
        statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the active parent/frontage setup.`,
      };
    }
    currentFrontage = remainderFrontage;
  }

  return {
    tool,
    generatedParcels: [],
    acceptedCandidates: [],
    isValid: false,
    statusMessage: 'Automatic fill reached its safety limit before completing the lot sequence.',
  };
};
