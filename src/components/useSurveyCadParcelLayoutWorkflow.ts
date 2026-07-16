import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  cadBuildParcelFrontagePathAutoLayoutDraft,
  cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference,
  cadBuildParcelLayoutFrontageReference,
  cadBuildParcelLayoutFrontageReferenceFromParcelSegments,
  cadSelectPreferredParcelLayoutPreviewCandidate,
} from '../engine/cad/cadCogo';
import type { CadDisplayPrimitive, CadEntity, CadEntityId, CadParcelLayoutUiState, CadProject } from '../engine/cad/cadTypes';
import {
  findFrontageEntity,
  findParcelEntity,
  findSelectedFrontageForLayout,
  findSelectedParcelForLayout,
  type ParcelLayoutAlternative,
  type ParcelLayoutAutoCommitOptions,
  type ParcelLayoutCommitOptions,
  type ParcelLayoutTool,
} from './surveyCadParcelLayoutWorkflowUtils';
import {
  buildParcelLayoutPreviewPrimitives,
  cloneParcelLayoutSettings,
  type ParcelLayoutAutoPreviewState,
  type ParcelLayoutPreviewState,
} from './surveyCadWorkspaceParcelLayout';

interface UseSurveyCadParcelLayoutWorkflowOptions {
  activeProject: CadProject;
  commandPreviewPrimitives: CadDisplayPrimitive[];
  selectedEntities: CadEntity[];
  canCreateParcel: boolean;
  createParcelFromSelection: () => void;
  commitParcelSlideLayout: (_options: ParcelLayoutCommitOptions) => void;
  commitParcelSwingLayout: (_options: ParcelLayoutCommitOptions) => void;
  commitParcelAutoLayout: (_options: ParcelLayoutAutoCommitOptions) => void;
  parcelLayoutState: CadParcelLayoutUiState;
  setParcelLayoutState: Dispatch<SetStateAction<CadParcelLayoutUiState>>;
  parcelLayoutPreviewState: ParcelLayoutPreviewState | null;
  setParcelLayoutPreviewState: Dispatch<SetStateAction<ParcelLayoutPreviewState | null>>;
  parcelLayoutAutoPreviewState: ParcelLayoutAutoPreviewState | null;
  setParcelLayoutAutoPreviewState: Dispatch<SetStateAction<ParcelLayoutAutoPreviewState | null>>;
  parcelLayoutAutoTool: ParcelLayoutTool;
  setParcelLayoutAutoTool: Dispatch<SetStateAction<ParcelLayoutTool>>;
  parcelLayoutFrontageSegmentSelectionActive: boolean;
  setParcelLayoutFrontageSegmentSelectionActive: Dispatch<SetStateAction<boolean>>;
  parcelLayoutFrontageSegmentSelectionIds: string[];
  setParcelLayoutFrontageSegmentSelectionIds: Dispatch<SetStateAction<string[]>>;
}

export const useSurveyCadParcelLayoutWorkflow = ({
  activeProject,
  commandPreviewPrimitives,
  selectedEntities,
  canCreateParcel,
  createParcelFromSelection,
  commitParcelSlideLayout,
  commitParcelSwingLayout,
  commitParcelAutoLayout,
  parcelLayoutState,
  setParcelLayoutState,
  parcelLayoutPreviewState,
  setParcelLayoutPreviewState,
  parcelLayoutAutoPreviewState,
  setParcelLayoutAutoPreviewState,
  parcelLayoutAutoTool,
  setParcelLayoutAutoTool,
  parcelLayoutFrontageSegmentSelectionActive,
  setParcelLayoutFrontageSegmentSelectionActive,
  parcelLayoutFrontageSegmentSelectionIds,
  setParcelLayoutFrontageSegmentSelectionIds,
}: UseSurveyCadParcelLayoutWorkflowOptions) => {
  const updateParcelLayoutState = (
    updater: (_current: CadParcelLayoutUiState) => CadParcelLayoutUiState,
  ) => {
    setParcelLayoutState((current) => updater(current));
  };

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
      (parcelLayoutParentEntity ?? selectedParcelForLayout) && parcelLayoutState.activeFrontageParcelSegmentIds?.length
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
  const effectiveParcelLayoutFrontageEntityId = effectiveParcelLayoutFrontageEntity?.id ?? null;
  const effectiveParcelLayoutFrontageParcelSegmentIds =
    effectiveParcelLayoutFrontageReference?.parcelSegmentIds ?? null;
  const parcelLayoutFrontageLabel = useMemo(() => {
    return effectiveParcelLayoutFrontageReference?.displayLabel ?? null;
  }, [effectiveParcelLayoutFrontageReference]);
  const canPreviewParcelSlideOrSwing =
    effectiveParcelLayoutParentEntity != null && effectiveParcelLayoutFrontageReference != null;
  const directParcelSlideCandidate = useMemo(
    () =>
      directParcelSplitTarget
        ? cadSelectPreferredParcelLayoutPreviewCandidate(
            directParcelSplitTarget.parcel,
            directParcelSplitTarget.frontageReference.frontageLine,
            parcelLayoutState.settings,
            'slide',
          )
        : null,
    [directParcelSplitTarget, parcelLayoutState.settings],
  );
  const directParcelSwingCandidate = useMemo(
    () =>
      directParcelSplitTarget
        ? cadSelectPreferredParcelLayoutPreviewCandidate(
            directParcelSplitTarget.parcel,
            directParcelSplitTarget.frontageReference.frontageLine,
            parcelLayoutState.settings,
            'swing',
          )
        : null,
    [directParcelSplitTarget, parcelLayoutState.settings],
  );
  const parcelLayoutPreviewPrimitives = useMemo(
    () =>
      buildParcelLayoutPreviewPrimitives(
        parcelLayoutPreviewState,
        parcelLayoutAutoPreviewState,
        effectiveParcelLayoutParentEntity?.id ?? null,
      ),
    [effectiveParcelLayoutParentEntity?.id, parcelLayoutAutoPreviewState, parcelLayoutPreviewState],
  );
  const mergedCommandPreviewPrimitives = useMemo(
    () => [...commandPreviewPrimitives, ...parcelLayoutPreviewPrimitives],
    [commandPreviewPrimitives, parcelLayoutPreviewPrimitives],
  );
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
  const parcelLayoutPreviewStatus = useMemo(() => {
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
  }, [
    parcelAutoLayoutDraft,
    parcelLayoutAutoPreviewState,
    parcelLayoutFrontageSegmentSelectionActive,
    parcelLayoutFrontageSegmentSelectionIds.length,
    effectiveParcelLayoutFrontageReference,
    effectiveParcelLayoutParentEntity,
    parcelLayoutPreviewState,
    parcelLayoutState.settings.automaticMode,
  ]);

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
  const canRunPrimaryParcelLayoutCreate =
    parcelLayoutState.settings.automaticMode === 'fill_parent'
      ? canCreateAllParcelLayout
      : parcelLayoutState.settings.automaticMode === 'single_preview'
        ? canCreateSingleAutomaticParcel
        : canCreateParcel;
  const canPreviewAllParcelLayout =
    effectiveParcelLayoutParentEntity != null &&
    effectiveParcelLayoutFrontageReference != null &&
    parcelLayoutState.settings.automaticMode !== 'off' &&
    (parcelAutoLayoutDraft?.isValid ?? false);
  const canRunAutoLayoutTool =
    parcelLayoutState.settings.automaticMode === 'fill_parent'
      ? canCreateAllParcelLayout
      : canPreviewAllParcelLayout;
  const autoLayoutToolTitle =
    parcelLayoutState.settings.automaticMode === 'fill_parent'
      ? 'Automatically create all parcels from the active parent/frontage setup'
      : parcelLayoutState.settings.automaticMode === 'single_preview'
        ? 'Preview the automatic parcel layout set from the active parent/frontage setup'
        : 'Turn automatic mode on below to use automatic parcel layout';

  const commitParcelCandidate = (candidate: {
    tool: ParcelLayoutTool;
    alternative: ParcelLayoutAlternative;
  }) => {
    if (!effectiveParcelLayoutParentEntity) return;
    const commitOptions = {
      parcelEntityId: effectiveParcelLayoutParentEntity.id,
      frontageEntityId: effectiveParcelLayoutFrontageEntityId,
      frontageParcelSegmentIds: effectiveParcelLayoutFrontageParcelSegmentIds,
      targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
      minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
      alternative: candidate.alternative,
      settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
    };
    if (candidate.tool === 'slide') {
      commitParcelSlideLayout(commitOptions);
    } else {
      commitParcelSwingLayout(commitOptions);
    }
  };

  const previewParcelLayoutSplit = (
    tool: ParcelLayoutTool,
    alternative = parcelLayoutPreviewState?.candidate.tool === tool
      ? parcelLayoutPreviewState.candidate.alternative
      : null,
  ) => {
    if (!effectiveParcelLayoutParentEntity || !effectiveParcelLayoutFrontageReference) return;
    setParcelLayoutAutoTool(tool);
    setParcelLayoutAutoPreviewState(null);
    const preferredCandidate = cadSelectPreferredParcelLayoutPreviewCandidate(
      effectiveParcelLayoutParentEntity,
      effectiveParcelLayoutFrontageReference.frontageLine,
      parcelLayoutState.settings,
      tool,
      alternative,
    );
    setParcelLayoutPreviewState({ candidate: preferredCandidate });
  };

  const cycleParcelLayoutPreviewAlternative = () => {
    if (parcelLayoutAutoPreviewState) {
      setParcelLayoutAutoPreviewState((current) =>
        current == null
          ? current
          : {
              ...current,
              activeIndex: (current.activeIndex + 1) % Math.max(current.draft.acceptedCandidates.length, 1),
            },
      );
      return;
    }
    if (!parcelLayoutPreviewState) return;
    previewParcelLayoutSplit(
      parcelLayoutPreviewState.candidate.tool,
      parcelLayoutPreviewState.candidate.alternative === 'start' ? 'end' : 'start',
    );
  };

  const acceptParcelLayoutPreview = () => {
    if (parcelLayoutAutoPreviewState) {
      const activeCandidate =
        parcelLayoutAutoPreviewState.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex] ?? null;
      if (!activeCandidate?.isValid || !activeCandidate.draft) return;
      commitParcelCandidate(activeCandidate);
      setParcelLayoutAutoPreviewState(null);
      setParcelLayoutPreviewState(null);
      return;
    }
    if (
      !parcelLayoutPreviewState ||
      !parcelLayoutPreviewState.candidate.isValid ||
      !parcelLayoutPreviewState.candidate.draft ||
      !effectiveParcelLayoutFrontageReference
    ) {
      return;
    }
    commitParcelCandidate(parcelLayoutPreviewState.candidate);
    setParcelLayoutPreviewState(null);
  };

  const commitAutomaticSinglePreviewCandidate = () => {
    const activeCandidate = parcelLayoutAutoPreviewState?.draft.acceptedCandidates[parcelLayoutAutoPreviewState.activeIndex]
      ?? parcelAutoLayoutDraft?.acceptedCandidates[0]
      ?? null;
    if (
      !activeCandidate?.isValid ||
      !effectiveParcelLayoutParentEntity ||
      !effectiveParcelLayoutFrontageReference
    ) {
      return;
    }
    commitParcelCandidate(activeCandidate);
    setParcelLayoutAutoPreviewState(null);
    setParcelLayoutPreviewState(null);
  };

  const previewAllParcelLayout = () => {
    if (!canPreviewAllParcelLayout || !parcelAutoLayoutDraft) return;
    setParcelLayoutPreviewState(null);
    setParcelLayoutAutoPreviewState({
      draft: parcelAutoLayoutDraft,
      activeIndex: 0,
    });
  };

  const createAllParcelLayout = () => {
    if (
      !canCreateAllParcelLayout ||
      !effectiveParcelLayoutParentEntity ||
      !effectiveParcelLayoutFrontageReference
    ) {
      return;
    }
    commitParcelAutoLayout({
      parcelEntityId: effectiveParcelLayoutParentEntity.id,
      frontageEntityId: effectiveParcelLayoutFrontageEntityId,
      frontageParcelSegmentIds: effectiveParcelLayoutFrontageParcelSegmentIds,
      tool: parcelLayoutAutoTool,
      settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
    });
    setParcelLayoutAutoPreviewState(null);
    setParcelLayoutPreviewState(null);
  };

  const splitParcelBySlide = () => {
    if (!directParcelSplitTarget) return;
    commitParcelSlideLayout({
      parcelEntityId: directParcelSplitTarget.parcel.id,
      frontageEntityId: directParcelSplitTarget.frontage.id,
      targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
      minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
      alternative: directParcelSlideCandidate?.alternative ?? 'start',
      settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
    });
    setParcelLayoutAutoPreviewState(null);
    setParcelLayoutPreviewState(null);
  };

  const splitParcelBySwing = () => {
    if (!directParcelSplitTarget) return;
    commitParcelSwingLayout({
      parcelEntityId: directParcelSplitTarget.parcel.id,
      frontageEntityId: directParcelSplitTarget.frontage.id,
      targetAreaSquareMeters: parcelLayoutState.settings.minAreaSquareMeters,
      minFrontageMeters: parcelLayoutState.settings.minFrontageMeters,
      alternative: directParcelSwingCandidate?.alternative ?? 'start',
      settings: cloneParcelLayoutSettings(parcelLayoutState.settings),
    });
    setParcelLayoutAutoPreviewState(null);
    setParcelLayoutPreviewState(null);
  };

  const createPrimaryParcelLayout = () => {
    if (parcelLayoutState.settings.automaticMode === 'fill_parent') {
      createAllParcelLayout();
      return;
    }
    if (parcelLayoutState.settings.automaticMode === 'single_preview') {
      commitAutomaticSinglePreviewCandidate();
      return;
    }
    createParcelFromSelection();
  };

  const startFrontageSegmentSelection = () => {
    if (!effectiveParcelLayoutParentEntity) return;
    setParcelLayoutFrontageSegmentSelectionIds([
      ...(parcelLayoutState.activeFrontageParcelSegmentIds ?? []),
    ]);
    setParcelLayoutFrontageSegmentSelectionActive(true);
  };

  const acceptFrontageSegmentSelection = () => {
    if (!effectiveParcelLayoutParentEntity || parcelLayoutFrontageSegmentSelectionIds.length === 0) {
      setParcelLayoutFrontageSegmentSelectionActive(false);
      setParcelLayoutFrontageSegmentSelectionIds([]);
      return;
    }
    const nextSegmentIds = [...new Set(parcelLayoutFrontageSegmentSelectionIds)];
    updateParcelLayoutState((current) => ({
      ...current,
      activeFrontageEntityId: null,
      activeFrontageParcelSegmentIds: nextSegmentIds,
    }));
    setParcelLayoutFrontageSegmentSelectionActive(false);
    setParcelLayoutFrontageSegmentSelectionIds([]);
  };

  const cancelFrontageSegmentSelection = () => {
    setParcelLayoutFrontageSegmentSelectionActive(false);
    setParcelLayoutFrontageSegmentSelectionIds([]);
  };

  const toggleFrontageSegmentSelection = (entityId: CadEntityId, segmentId?: string) => {
    if (
      !parcelLayoutFrontageSegmentSelectionActive ||
      !effectiveParcelLayoutParentEntity ||
      entityId !== effectiveParcelLayoutParentEntity.id ||
      segmentId == null
    ) {
      return false;
    }
    setParcelLayoutFrontageSegmentSelectionIds((current) =>
      current.includes(segmentId)
        ? current.filter((entry) => entry !== segmentId)
        : [...current, segmentId],
    );
    return true;
  };

  const runAutoLayoutTool = () => {
    if (parcelLayoutState.settings.automaticMode === 'fill_parent') {
      createAllParcelLayout();
      return;
    }
    if (parcelLayoutState.settings.automaticMode === 'single_preview') {
      previewAllParcelLayout();
    }
  };

  const useSelectedParentParcel = () => {
    if (!selectedParcelForLayout || selectedParcelForLayout.type !== 'parcel') return;
    updateParcelLayoutState((current) => ({
      ...current,
      activeParentParcelId: selectedParcelForLayout.id,
      activeFrontageParcelSegmentIds:
        current.activeParentParcelId === selectedParcelForLayout.id
          ? current.activeFrontageParcelSegmentIds
          : null,
    }));
  };

  const useSelectedFrontageEntity = () => {
    if (!selectedFrontageForLayout) return;
    updateParcelLayoutState((current) => ({
      ...current,
      activeFrontageEntityId: selectedFrontageForLayout.id,
      activeFrontageParcelSegmentIds: null,
    }));
  };

  useEffect(() => {
    setParcelLayoutPreviewState(null);
  }, [
    parcelLayoutParentEntity?.id,
    parcelLayoutFrontageEntity?.id,
    parcelLayoutState.settings.minAreaSquareMeters,
    parcelLayoutState.settings.minFrontageMeters,
    parcelLayoutState.settings.useFrontageAtOffset,
    parcelLayoutState.settings.frontageOffsetMeters,
    parcelLayoutState.settings.minWidthMeters,
    parcelLayoutState.settings.minDepthMeters,
    parcelLayoutState.settings.useMaxDepth,
    parcelLayoutState.settings.maxDepthMeters,
    parcelLayoutState.settings.solutionPreference,
    activeProject.entities.length,
    setParcelLayoutPreviewState,
  ]);

  useEffect(() => {
    setParcelLayoutAutoPreviewState(null);
  }, [
    parcelLayoutParentEntity?.id,
    parcelLayoutFrontageEntity?.id,
    parcelLayoutState.settings.minAreaSquareMeters,
    parcelLayoutState.settings.minFrontageMeters,
    parcelLayoutState.settings.useFrontageAtOffset,
    parcelLayoutState.settings.frontageOffsetMeters,
    parcelLayoutState.settings.minWidthMeters,
    parcelLayoutState.settings.minDepthMeters,
    parcelLayoutState.settings.useMaxDepth,
    parcelLayoutState.settings.maxDepthMeters,
    parcelLayoutState.settings.solutionPreference,
    parcelLayoutState.settings.automaticMode,
    parcelLayoutState.settings.remainderDistribution,
    activeProject.entities.length,
    setParcelLayoutAutoPreviewState,
  ]);

  return {
    autoLayoutToolTitle,
    canAcceptParcelLayoutPreview:
      parcelLayoutAutoPreviewState != null
        ? parcelLayoutState.settings.automaticMode === 'single_preview'
        : (parcelLayoutPreviewState?.candidate.isValid ?? false),
    canCreateAllParcelLayout,
    canPreviewAllParcelLayout,
    canPreviewParcelSlideOrSwing,
    canRunAutoLayoutTool,
    canRunPrimaryParcelLayoutCreate,
    canSplitParcelBySlideOrSwing: directParcelSplitTarget != null,
    canUseCurrentSelectionAsFrontage: selectedFrontageForLayout != null,
    canUseCurrentSelectionAsParent: selectedParcelForLayout != null,
    canUseParcelFrontageSegments: effectiveParcelLayoutParentEntity != null,
    effectiveParcelLayoutParentEntity,
    frontageSegmentActionTitle: effectiveParcelLayoutParentEntity
      ? 'Pick parcel boundary segments for frontage'
      : 'Choose a parent parcel before selecting frontage segments',
    hasParcelLayoutPreview: parcelLayoutPreviewState != null || parcelLayoutAutoPreviewState != null,
    mergedCommandPreviewPrimitives,
    parcelLayoutFrontageLabel,
    parcelLayoutPreviewDetails,
    parcelLayoutPreviewStatus,
    acceptFrontageSegmentSelection,
    acceptParcelLayoutPreview,
    cancelFrontageSegmentSelection,
    createPrimaryParcelLayout,
    cycleParcelLayoutPreviewAlternative,
    previewParcelLayoutSplit,
    previewAllParcelLayout,
    runAutoLayoutTool,
    createAllParcelLayout,
    splitParcelBySlide,
    splitParcelBySwing,
    startFrontageSegmentSelection,
    toggleFrontageSegmentSelection,
    updateParcelLayoutState,
    useSelectedFrontageEntity,
    useSelectedParentParcel,
  };
};
