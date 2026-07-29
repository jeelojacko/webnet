import { type Dispatch, type SetStateAction } from 'react';
import {
  cadSelectPreferredParcelLayoutPreviewCandidate,
} from '../engine/cad/cadCogo';
import type { CadDisplayPrimitive, CadEntity, CadEntityId, CadParcelLayoutUiState, CadProject } from '../engine/cad/cadTypes';
import {
  type ParcelLayoutAlternative,
  type ParcelLayoutAutoCommitOptions,
  type ParcelLayoutCommitOptions,
  type ParcelLayoutTool,
} from './surveyCadParcelLayoutWorkflowUtils';
import {
  cloneParcelLayoutSettings,
  type ParcelLayoutAutoPreviewState,
  type ParcelLayoutPreviewState,
} from './surveyCadWorkspaceParcelLayout';
import { useSurveyCadParcelLayoutDerivedState } from './useSurveyCadParcelLayoutDerivedState';
import { useSurveyCadParcelLayoutPreviewReset } from './useSurveyCadParcelLayoutPreviewReset';

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

  const {
    autoLayoutToolTitle,
    canCreateAllParcelLayout,
    canPreviewAllParcelLayout,
    canPreviewParcelSlideOrSwing,
    canRunAutoLayoutTool,
    canRunPrimaryParcelLayoutCreate,
    directParcelSlideCandidate,
    directParcelSplitTarget,
    directParcelSwingCandidate,
    effectiveParcelLayoutFrontageEntityId,
    effectiveParcelLayoutFrontageParcelSegmentIds,
    effectiveParcelLayoutFrontageReference,
    effectiveParcelLayoutParentEntity,
    mergedCommandPreviewPrimitives,
    parcelAutoLayoutDraft,
    parcelLayoutFrontageEntity,
    parcelLayoutFrontageLabel,
    parcelLayoutParentEntity,
    parcelLayoutPreviewDetails,
    parcelLayoutPreviewStatus,
    selectedFrontageForLayout,
    selectedParcelForLayout,
  } = useSurveyCadParcelLayoutDerivedState({
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
  });
  useSurveyCadParcelLayoutPreviewReset({
    activeProject,
    parcelLayoutParentEntity,
    parcelLayoutFrontageEntity,
    parcelLayoutState,
    setParcelLayoutPreviewState,
    setParcelLayoutAutoPreviewState,
  });

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
