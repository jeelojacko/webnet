import { cadDistance } from './cadGeometry';
import type {
  CadParcelLayoutSettings,
  CadParcelEntity,
} from './cadTypes';
import { type CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import {
  type CadParcelAutoLayoutDraft,
  type CadParcelLayoutGeneratedParcelDraft,
  type CadParcelLayoutPreviewCandidate,
} from './cadCogoParcelLayoutTypes';
import { cadBuildCornerRemainderPreviewCandidate } from './cadCogoParcelLayoutEvaluation';
import {
  cadBuildFrontageLineForCurrentParcelSegment,
  cadBuildParcelEntityFromGeneratedDraft,
} from './cadCogoParcelLayoutDrafts';
import { cadResolveGeneratedParcelConflicts } from './cadCogoParcelLayoutConflicts';
import {
  cadBuildTrimmedFrontageLine,
} from './cadCogoParcelCornerGeometry';
import { cadBuildClosedBoundaryRingAutoLayoutDraft } from './cadCogoParcelClosedBoundary';
import {
  cadBuildParcelFrontageStripAutoLayoutDraft,
} from './cadCogoParcelFrontagePathAutoLayout';
import { cadBuildParcelAutoLayoutDraft } from './cadCogoParcelAutoLayoutSingle';
import {
  cadBuildFrontageBridgeDraft,
} from './cadCogoParcelFrontageReferenceCornerHelpers';
import { cadBuildCornerInfillDraft } from './cadCogoParcelFrontageReferenceCornerInfill';
import { cadBuildRemainderJunctionInfillDraft } from './cadCogoParcelFrontageReferenceJunctionInfill';
import { cadTryFillGeneratedRemaindersFromFrontageReference } from './cadCogoParcelFrontageReferenceRemainders';
import { cadBuildFrontageReferenceSegmentTrim } from './cadCogoParcelFrontageReferenceSegmentTrim';

export const cadBuildParcelAutoLayoutDraftFromFrontageReference = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  const segmentPairs = frontageReference.parcelSegmentLabelPairs ?? [];
  if (segmentPairs.length <= 1) {
    return cadBuildParcelAutoLayoutDraft(parcel, frontageReference.frontageLine, settings, tool);
  }
  const closedBoundaryDraft = cadBuildClosedBoundaryRingAutoLayoutDraft(
    parcel,
    frontageReference,
    settings,
    tool,
  );
  if (closedBoundaryDraft?.isValid) {
    return closedBoundaryDraft;
  }

  let currentParcel: CadParcelEntity = {
    ...parcel,
    vertices: parcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    vertexLabels: [...parcel.vertexLabels],
  };
  const generatedParcels: CadParcelLayoutGeneratedParcelDraft[] = [];
  const acceptedCandidates: CadParcelLayoutPreviewCandidate[] = [];
  const cornerTrimFromStartMetersBySegment = new Map<number, number>();
  const cornerTrimFromEndMetersBySegment = new Map<number, number>();
  const cornerDraftJunctionIndexes = new Set<number>();
  let usedFullParentSegmentRecovery = false;
  if (settings.useMaxDepth) {
    for (let index = 0; index < segmentPairs.length - 1; index += 1) {
      const firstFrontage = cadBuildFrontageLineForCurrentParcelSegment(parcel, frontageReference, index);
      const secondFrontage = cadBuildFrontageLineForCurrentParcelSegment(parcel, frontageReference, index + 1);
      if (!firstFrontage || !secondFrontage) continue;
      const cornerDraft = cadBuildCornerInfillDraft({
        parcel,
        firstFrontageLine: firstFrontage,
        secondFrontageLine: secondFrontage,
        settings,
        tool,
        buildParcelAutoLayoutDraftFromFrontageReference: cadBuildParcelAutoLayoutDraftFromFrontageReference,
        buildPreferredParcelAutoLayoutDraftFromFrontageReference:
          cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference,
      });
      if (!cornerDraft) continue;
      cornerDraftJunctionIndexes.add(index);
      generatedParcels.push(
        ...cornerDraft.draft.generatedParcels.map((generatedParcel) => ({
          ...generatedParcel,
          sourceKind: 'corner_prepass' as const,
          sourceSegmentIndex: index,
        })),
      );
      acceptedCandidates.push(...cornerDraft.draft.acceptedCandidates);
      cornerTrimFromEndMetersBySegment.set(
        index,
        Math.max(
          cornerTrimFromEndMetersBySegment.get(index) ?? 0,
          cornerDraft.firstSegmentTrimMeters,
        ),
      );
      cornerTrimFromStartMetersBySegment.set(
        index + 1,
        Math.max(
          cornerTrimFromStartMetersBySegment.get(index + 1) ?? 0,
          cornerDraft.secondSegmentTrimMeters,
        ),
      );
    }
  }

  for (let index = 0; index < segmentPairs.length; index += 1) {
    const carriedFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      currentParcel,
      frontageReference,
      index,
    );
    const originalFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      parcel,
      frontageReference,
      index,
    );
    const carriedFrontageLengthMeters = carriedFrontage
      ? cadDistance(
          { x: carriedFrontage.fromX, y: carriedFrontage.fromY },
          { x: carriedFrontage.toX, y: carriedFrontage.toY },
        )
      : 0;
    const originalFrontageLengthMeters = originalFrontage
      ? cadDistance(
          { x: originalFrontage.fromX, y: originalFrontage.fromY },
          { x: originalFrontage.toX, y: originalFrontage.toY },
        )
      : 0;
    const carriedFrontageStartShiftMeters =
      carriedFrontage && originalFrontage
        ? Math.min(
            cadDistance(
              { x: carriedFrontage.fromX, y: carriedFrontage.fromY },
              { x: originalFrontage.fromX, y: originalFrontage.fromY },
            ),
            cadDistance(
              { x: carriedFrontage.toX, y: carriedFrontage.toY },
              { x: originalFrontage.fromX, y: originalFrontage.fromY },
            ),
          )
        : 0;
    const shouldRecoverFullParentSegment =
      settings.useMaxDepth &&
      index > 0 &&
      originalFrontageLengthMeters > settings.minFrontageMeters * 2 &&
      (carriedFrontageLengthMeters + settings.minFrontageMeters < originalFrontageLengthMeters * 0.5 ||
        (index > 1 && carriedFrontageStartShiftMeters > settings.minFrontageMeters * 2));
    const segmentSourceParcel = shouldRecoverFullParentSegment ? parcel : currentParcel;
    if (shouldRecoverFullParentSegment) {
      usedFullParentSegmentRecovery = true;
    }
    const rawCurrentFrontage = cadBuildFrontageLineForCurrentParcelSegment(
      segmentSourceParcel,
      frontageReference,
      index,
    );
    if (!rawCurrentFrontage) continue;
    let currentFrontage = rawCurrentFrontage;
    const { trimFromStartMeters, trimFromEndMeters } = cadBuildFrontageReferenceSegmentTrim({
      parcel,
      frontageReference,
      settings,
      segmentIndex: index,
      cornerDraftJunctionIndexes,
      cornerTrimFromStartMetersBySegment,
      cornerTrimFromEndMetersBySegment,
    });
    currentFrontage =
      cadBuildTrimmedFrontageLine(currentFrontage, trimFromStartMeters, trimFromEndMeters) ??
      currentFrontage;

    const isLastSegment = index === segmentPairs.length - 1;
    const forceRemainderParcel =
      settings.useMaxDepth && segmentPairs.length > 1 && settings.remainderDistribution === 'place_remainder_in_last_parcel';
    const segmentSettings = isLastSegment && !forceRemainderParcel
      ? settings
      : {
          ...settings,
          remainderDistribution: 'create_parcel_from_remainder' as const,
        };
    const segmentDraft =
      (settings.useMaxDepth
        ? cadBuildParcelFrontageStripAutoLayoutDraft(
            segmentSourceParcel,
            currentFrontage,
            segmentSettings,
            tool,
          )
        : null) ??
      cadBuildParcelAutoLayoutDraft(
        segmentSourceParcel,
        currentFrontage,
        segmentSettings,
        tool,
      );
    if (!segmentDraft.isValid) {
      continue;
    }

    const segmentGeneratedParcels = [...segmentDraft.generatedParcels];
    const trailingRemainder =
      !isLastSegment && segmentGeneratedParcels.at(-1)?.role === 'remainder'
        ? segmentGeneratedParcels.pop() ?? null
        : null;
    const frontageRemainder =
      !isLastSegment && segmentGeneratedParcels.at(-1)?.role === 'remainder'
        ? segmentGeneratedParcels.pop() ?? null
        : null;

    generatedParcels.push(
      ...segmentGeneratedParcels.map((generatedParcel) => ({
        ...generatedParcel,
        sourceKind: generatedParcel.sourceKind ?? 'segment',
        sourceSegmentIndex: index,
      })),
    );
    acceptedCandidates.push(...segmentDraft.acceptedCandidates);
    if (frontageRemainder) {
      const frontageRemainderMeters =
        (frontageRemainder as CadParcelLayoutGeneratedParcelDraft & {
          frontageLengthMeters?: number;
        }).frontageLengthMeters ?? 0;
      const combinedFrontageMeters = Math.max(
        settings.minFrontageMeters,
        frontageRemainderMeters + settings.minFrontageMeters,
      );
      const cornerCandidate = cadBuildCornerRemainderPreviewCandidate(
        currentFrontage,
        settings,
        frontageRemainder,
        combinedFrontageMeters,
        tool,
      );
      if (cornerCandidate?.isValid) {
        generatedParcels.push({
          ...frontageRemainder,
          role: 'lot',
          sourceKind: 'corner_remainder',
          sourceSegmentIndex: index,
        });
        acceptedCandidates.push(cornerCandidate);
      } else {
        generatedParcels.push({
          ...frontageRemainder,
          sourceKind: 'segment',
          sourceSegmentIndex: index,
        });
      }
    }

    if (!isLastSegment && trailingRemainder) {
      let nextParcel = cadBuildParcelEntityFromGeneratedDraft(parcel, trailingRemainder, true);
      if (settings.useMaxDepth && !cornerDraftJunctionIndexes.has(index)) {
        const currentResidualFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          nextParcel,
          frontageReference,
          index,
        );
        const nextResidualFrontage = cadBuildFrontageLineForCurrentParcelSegment(
          nextParcel,
          frontageReference,
          index + 1,
        );
        if (currentResidualFrontage && nextResidualFrontage) {
          const bridgeDraft = cadBuildFrontageBridgeDraft(
            nextParcel,
            currentResidualFrontage,
            nextResidualFrontage,
            settings,
            tool,
          );
          if (bridgeDraft?.draft.generatedParcels.length) {
            generatedParcels.push(
              ...bridgeDraft.draft.generatedParcels.map((generatedParcel) => ({
                ...generatedParcel,
                sourceKind: 'corner_remainder' as const,
                sourceSegmentIndex: index,
              })),
            );
            acceptedCandidates.push(...bridgeDraft.draft.acceptedCandidates);
            if (bridgeDraft.remainderDraft) {
              nextParcel = cadBuildParcelEntityFromGeneratedDraft(
                parcel,
                bridgeDraft.remainderDraft,
                true,
              );
            }
          }
          const remainderCornerDraft = bridgeDraft
            ? null
            : cadBuildRemainderJunctionInfillDraft({
                parcel: nextParcel,
                firstFrontageLine: currentResidualFrontage,
                secondFrontageLine: nextResidualFrontage,
                settings,
                tool,
                buildParcelAutoLayoutDraftFromFrontageReference:
                  cadBuildParcelAutoLayoutDraftFromFrontageReference,
                buildPreferredParcelAutoLayoutDraftFromFrontageReference:
                  cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference,
              });
          if (remainderCornerDraft?.draft.generatedParcels.length) {
            generatedParcels.push(
              ...remainderCornerDraft.draft.generatedParcels.map((generatedParcel) => ({
                ...generatedParcel,
                sourceKind: 'corner_remainder' as const,
                sourceSegmentIndex: index,
              })),
            );
            acceptedCandidates.push(...remainderCornerDraft.draft.acceptedCandidates);
            if (remainderCornerDraft.remainderDraft) {
              nextParcel = cadBuildParcelEntityFromGeneratedDraft(
                parcel,
                remainderCornerDraft.remainderDraft,
                true,
              );
            }
          }
        }
      }
      currentParcel = nextParcel;
    }
  }

  if (generatedParcels.length < 2) {
    return {
      tool,
      generatedParcels: [],
      acceptedCandidates: [],
      isValid: false,
      statusMessage: 'Automatic fill could not create valid lots from the selected frontage edges.',
    };
  }

  const resolvedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels,
    acceptedCandidates,
    isValid: true,
    statusMessage: `Automatic fill prepared ${generatedParcels.length} parcels from the selected frontage edges.`,
  });
  if (usedFullParentSegmentRecovery) {
    return resolvedDraft;
  }
  return cadTryFillGeneratedRemaindersFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    tool,
    resolvedDraft,
    cadBuildParcelAutoLayoutDraftFromFrontageReference,
  );
};

export const cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference = (
  parcel: CadParcelEntity,
  frontageReference: CadParcelLayoutFrontageReference,
  settings: CadParcelLayoutSettings,
  preferredTool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft => {
  const preferredDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    preferredTool,
  );
  const alternateTool = preferredTool === 'slide' ? 'swing' : 'slide';
  if (preferredDraft.isValid) {
    return preferredDraft;
  }

  const alternateDraft = cadBuildParcelAutoLayoutDraftFromFrontageReference(
    parcel,
    frontageReference,
    settings,
    alternateTool,
  );
  return alternateDraft.isValid ? alternateDraft : preferredDraft;
};
