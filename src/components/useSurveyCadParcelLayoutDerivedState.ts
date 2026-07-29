import { useMemo } from 'react';
import {
  cadBuildParcelFrontagePathAutoLayoutDraft,
  cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference,
  cadBuildParcelLayoutFrontageReference,
  cadBuildParcelLayoutFrontageReferenceFromParcelSegments,
  cadSelectPreferredParcelLayoutPreviewCandidate,
} from '../engine/cad/cadCogo';
import type {
  CadDisplayPrimitive,
  CadEntity,
  CadParcelLayoutUiState,
  CadProject,
} from '../engine/cad/cadTypes';
import {
  findFrontageEntity,
  findParcelEntity,
  findSelectedFrontageForLayout,
  findSelectedParcelForLayout,
  type ParcelLayoutTool,
} from './surveyCadParcelLayoutWorkflowUtils';
import {
  buildParcelLayoutPreviewPrimitives,
  type ParcelLayoutAutoPreviewState,
  type ParcelLayoutPreviewState,
} from './surveyCadWorkspaceParcelLayout';

interface UseParcelLayoutDerivedStateOptions {
  activeProject: CadProject;
  commandPreviewPrimitives: CadDisplayPrimitive[];
  selectedEntities: CadEntity[];
  canCreateParcel: boolean;
  parcelLayoutState: CadParcelLayoutUiState;
  parcelLayoutPreviewState: ParcelLayoutPreviewState | null;
  parcelLayoutAutoPreviewState: ParcelLayoutAutoPreviewState | null;
  parcelLayoutAutoTool: ParcelLayoutTool;
  parcelLayoutFrontageSegmentSelectionActive: boolean;
  parcelLayoutFrontageSegmentSelectionIds: string[];
}

export const useSurveyCadParcelLayoutDerivedState = ({
  activeProject,
  commandPreviewPrimitives,
  selectedEntities,
  canCreateParcel,
  parcelLayoutState,
  parcelLayoutPreviewState,
  parcelLayoutAutoPreviewState,
  parcelLayoutAutoTool,
  parcelLayoutFrontageSegmentSelectionActive,
  parcelLayoutFrontageSegmentSelectionIds,
}: UseParcelLayoutDerivedStateOptions) => {
  const parcelLayoutParentEntity = useMemo(
    () => findParcelEntity(activeProject, parcelLayoutState.activeParentParcelId),
    [activeProject, parcelLayoutState.activeParentParcelId],
  );
  const parcelLayoutFrontageEntity = useMemo(
    () => findFrontageEntity(activeProject, parcelLayoutState.activeFrontageEntityId),
    [activeProject, parcelLayoutState.activeFrontageEntityId],
  );
  const selectedParcelForLayout = findSelectedParcelForLayout(selectedEntities);
  const selectedFrontageForLayout = findSelectedFrontageForLayout(selectedEntities);
  const activeParcelSegmentFrontageReference = useMemo(
    () =>
      (parcelLayoutParentEntity ?? selectedParcelForLayout) &&
      parcelLayoutState.activeFrontageParcelSegmentIds?.length
        ? cadBuildParcelLayoutFrontageReferenceFromParcelSegments(
            (parcelLayoutParentEntity ?? selectedParcelForLayout)!,
            parcelLayoutState.activeFrontageParcelSegmentIds,
          )
        : null,
    [parcelLayoutParentEntity, parcelLayoutState.activeFrontageParcelSegmentIds, selectedParcelForLayout],
  );
  const parcelLayoutFrontageReference = useMemo(
    () =>
      parcelLayoutFrontageEntity
        ? cadBuildParcelLayoutFrontageReference(parcelLayoutFrontageEntity)
        : null,
    [parcelLayoutFrontageEntity],
  );
  const directParcelSplitTarget = useMemo(() => {
    const parcel = parcelLayoutParentEntity ?? selectedParcelForLayout;
    const frontage = parcelLayoutFrontageEntity ?? selectedFrontageForLayout;
    const frontageReference = frontage
      ? cadBuildParcelLayoutFrontageReference(frontage)
      : null;
    return parcel && frontage && frontageReference ? { parcel, frontage, frontageReference } : null;
  }, [
    parcelLayoutFrontageEntity,
    parcelLayoutParentEntity,
    selectedFrontageForLayout,
    selectedParcelForLayout,
  ]);
  const effectiveParcelLayoutParentEntity =
    directParcelSplitTarget?.parcel ?? parcelLayoutParentEntity ?? selectedParcelForLayout ?? null;
  const draftParcelSegmentFrontageReference = useMemo(
    () =>
      parcelLayoutFrontageSegmentSelectionActive &&
      effectiveParcelLayoutParentEntity &&
      parcelLayoutFrontageSegmentSelectionIds.length > 0
        ? cadBuildParcelLayoutFrontageReferenceFromParcelSegments(
            effectiveParcelLayoutParentEntity,
            parcelLayoutFrontageSegmentSelectionIds,
          )
        : null,
    [
      effectiveParcelLayoutParentEntity,
      parcelLayoutFrontageSegmentSelectionActive,
      parcelLayoutFrontageSegmentSelectionIds,
    ],
  );
  const effectiveParcelLayoutFrontageEntity =
    activeParcelSegmentFrontageReference == null && draftParcelSegmentFrontageReference == null
      ? directParcelSplitTarget?.frontage ?? parcelLayoutFrontageEntity ?? selectedFrontageForLayout ?? null
      : null;
  const effectiveParcelLayoutFrontageReference =
    draftParcelSegmentFrontageReference ??
    activeParcelSegmentFrontageReference ??
    directParcelSplitTarget?.frontageReference ??
    parcelLayoutFrontageReference;
  const parcelAutoLayoutDraft = useMemo(() => {
    if (!effectiveParcelLayoutParentEntity || !effectiveParcelLayoutFrontageReference) return null;
    const preferredDraft = cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference(
      effectiveParcelLayoutParentEntity,
      effectiveParcelLayoutFrontageReference,
      parcelLayoutState.settings,
      parcelLayoutAutoTool,
    );
    if (preferredDraft.isValid || parcelLayoutState.settings.automaticMode !== 'fill_parent') {
      return preferredDraft;
    }
    return (
      cadBuildParcelFrontagePathAutoLayoutDraft(
        effectiveParcelLayoutParentEntity,
        effectiveParcelLayoutFrontageReference,
        parcelLayoutState.settings,
        parcelLayoutAutoTool,
      ) ?? preferredDraft
    );
  }, [
    effectiveParcelLayoutFrontageReference,
    effectiveParcelLayoutParentEntity,
    parcelLayoutAutoTool,
    parcelLayoutState.settings,
  ]);
  const parcelLayoutPreviewPrimitives = useMemo(
    () =>
      buildParcelLayoutPreviewPrimitives(
        parcelLayoutPreviewState,
        parcelLayoutAutoPreviewState,
        effectiveParcelLayoutParentEntity?.id ?? null,
      ),
    [effectiveParcelLayoutParentEntity?.id, parcelLayoutAutoPreviewState, parcelLayoutPreviewState],
  );
  const parcelLayoutPreviewStatus = useMemo(
    () =>
      buildParcelLayoutPreviewStatus({
        effectiveParcelLayoutParentEntity,
        effectiveParcelLayoutFrontageReference,
        parcelLayoutFrontageSegmentSelectionActive,
        parcelLayoutFrontageSegmentSelectionIds,
        parcelLayoutAutoPreviewState,
        parcelLayoutState,
        parcelAutoLayoutDraft,
        parcelLayoutPreviewState,
      }),
    [
      effectiveParcelLayoutParentEntity,
      effectiveParcelLayoutFrontageReference,
      parcelLayoutFrontageSegmentSelectionActive,
      parcelLayoutFrontageSegmentSelectionIds,
      parcelLayoutAutoPreviewState,
      parcelLayoutState,
      parcelAutoLayoutDraft,
      parcelLayoutPreviewState,
    ],
  );
  const parcelLayoutPreviewDetails = useMemo(() => {
    if (parcelLayoutAutoPreviewState) {
      const activeCandidate =
        parcelLayoutAutoPreviewState.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex] ?? null;
      return [
        `Generated parcels: ${parcelLayoutAutoPreviewState.draft.generatedParcels.length}`,
        `Generated lots: ${parcelLayoutAutoPreviewState.draft.acceptedCandidates.length}`,
        ...(activeCandidate?.evaluation?.messages ?? []),
      ];
    }
    return parcelLayoutPreviewState?.candidate.evaluation?.messages ?? [];
  }, [parcelLayoutAutoPreviewState, parcelLayoutPreviewState]);

  const canCreateAllParcelLayout =
    effectiveParcelLayoutParentEntity != null &&
    effectiveParcelLayoutFrontageReference != null &&
    parcelLayoutState.settings.automaticMode === 'fill_parent' &&
    (parcelAutoLayoutDraft?.isValid ?? false);
  const canCreateSingleAutomaticParcel =
    parcelLayoutState.settings.automaticMode === 'single_preview' &&
    effectiveParcelLayoutParentEntity != null &&
    effectiveParcelLayoutFrontageReference != null &&
    (
      (parcelLayoutAutoPreviewState?.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex]?.isValid ?? false) ||
      (parcelAutoLayoutDraft?.acceptedCandidates[0]?.isValid ?? false)
    );
  const canPreviewAllParcelLayout =
    effectiveParcelLayoutParentEntity != null &&
    effectiveParcelLayoutFrontageReference != null &&
    parcelLayoutState.settings.automaticMode !== 'off' &&
    (parcelAutoLayoutDraft?.isValid ?? false);

  return {
    autoLayoutToolTitle: getAutoLayoutToolTitle(parcelLayoutState.settings.automaticMode),
    canCreateAllParcelLayout,
    canPreviewAllParcelLayout,
    canPreviewParcelSlideOrSwing:
      effectiveParcelLayoutParentEntity != null && effectiveParcelLayoutFrontageReference != null,
    canRunAutoLayoutTool:
      parcelLayoutState.settings.automaticMode === 'fill_parent'
        ? canCreateAllParcelLayout
        : canPreviewAllParcelLayout,
    canRunPrimaryParcelLayoutCreate:
      parcelLayoutState.settings.automaticMode === 'fill_parent'
        ? canCreateAllParcelLayout
        : parcelLayoutState.settings.automaticMode === 'single_preview'
          ? canCreateSingleAutomaticParcel
          : canCreateParcel,
    directParcelSlideCandidate: directParcelSplitTarget
      ? cadSelectPreferredParcelLayoutPreviewCandidate(
          directParcelSplitTarget.parcel,
          directParcelSplitTarget.frontageReference.frontageLine,
          parcelLayoutState.settings,
          'slide',
        )
      : null,
    directParcelSplitTarget,
    directParcelSwingCandidate: directParcelSplitTarget
      ? cadSelectPreferredParcelLayoutPreviewCandidate(
          directParcelSplitTarget.parcel,
          directParcelSplitTarget.frontageReference.frontageLine,
          parcelLayoutState.settings,
          'swing',
        )
      : null,
    effectiveParcelLayoutFrontageEntityId: effectiveParcelLayoutFrontageEntity?.id ?? null,
    effectiveParcelLayoutFrontageParcelSegmentIds:
      effectiveParcelLayoutFrontageReference?.parcelSegmentIds ?? null,
    effectiveParcelLayoutFrontageReference,
    effectiveParcelLayoutParentEntity,
    mergedCommandPreviewPrimitives: [...commandPreviewPrimitives, ...parcelLayoutPreviewPrimitives],
    parcelAutoLayoutDraft,
    parcelLayoutFrontageEntity,
    parcelLayoutFrontageLabel: effectiveParcelLayoutFrontageReference?.displayLabel ?? null,
    parcelLayoutParentEntity,
    parcelLayoutPreviewDetails,
    parcelLayoutPreviewStatus,
    selectedFrontageForLayout,
    selectedParcelForLayout,
  };
};

const getAutoLayoutToolTitle = (
  automaticMode: CadParcelLayoutUiState['settings']['automaticMode'],
): string =>
  automaticMode === 'fill_parent'
    ? 'Automatically create all parcels from the active parent/frontage setup'
    : automaticMode === 'single_preview'
      ? 'Preview the automatic parcel layout set from the active parent/frontage setup'
      : 'Turn automatic mode on below to use automatic parcel layout';

const buildParcelLayoutPreviewStatus = ({
  effectiveParcelLayoutParentEntity,
  effectiveParcelLayoutFrontageReference,
  parcelLayoutFrontageSegmentSelectionActive,
  parcelLayoutFrontageSegmentSelectionIds,
  parcelLayoutAutoPreviewState,
  parcelLayoutState,
  parcelAutoLayoutDraft,
  parcelLayoutPreviewState,
}: {
  effectiveParcelLayoutParentEntity: CadEntity | null;
  effectiveParcelLayoutFrontageReference: ReturnType<typeof cadBuildParcelLayoutFrontageReference> | null;
  parcelLayoutFrontageSegmentSelectionActive: boolean;
  parcelLayoutFrontageSegmentSelectionIds: string[];
  parcelLayoutAutoPreviewState: ParcelLayoutAutoPreviewState | null;
  parcelLayoutState: CadParcelLayoutUiState;
  parcelAutoLayoutDraft: ReturnType<typeof cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference> | null;
  parcelLayoutPreviewState: ParcelLayoutPreviewState | null;
}): string => {
  if (!effectiveParcelLayoutParentEntity) {
    return 'Choose one parent parcel for parcel-layout preview.';
  }
  if (!effectiveParcelLayoutFrontageReference) {
    if (parcelLayoutFrontageSegmentSelectionActive) {
      return parcelLayoutFrontageSegmentSelectionIds.length === 0
        ? 'Click parcel edges to build frontage, then accept with ✓.'
        : `Selected ${parcelLayoutFrontageSegmentSelectionIds.length} frontage segment${parcelLayoutFrontageSegmentSelectionIds.length === 1 ? '' : 's'}. Accept with ✓ or cancel with X.`;
    }
    return 'Choose one frontage entity that matches a parent parcel edge.';
  }
  if (parcelLayoutAutoPreviewState) {
    const lotCount = parcelLayoutAutoPreviewState.draft.acceptedCandidates.length;
    const previewIndex = Math.min(parcelLayoutAutoPreviewState.activeIndex + 1, lotCount);
    return `Automatic preview ${previewIndex} of ${lotCount}: ${parcelLayoutAutoPreviewState.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex]?.statusMessage ?? parcelLayoutAutoPreviewState.draft.statusMessage}`;
  }
  if (
    parcelLayoutState.settings.automaticMode !== 'off' &&
    parcelAutoLayoutDraft &&
    !parcelAutoLayoutDraft.isValid
  ) {
    return parcelAutoLayoutDraft.statusMessage;
  }
  if (!parcelLayoutPreviewState) {
    return 'Use Slide or Swing to preview one child lot from the active parent/frontage setup.';
  }
  return parcelLayoutPreviewState.candidate.statusMessage;
};
