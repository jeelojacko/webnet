import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { CadEntity, CadParcelLayoutUiState, CadProject } from '../engine/cad/cadTypes';
import type {
  ParcelLayoutAutoPreviewState,
  ParcelLayoutPreviewState,
} from './surveyCadWorkspaceParcelLayout';

interface UseParcelLayoutPreviewResetOptions {
  activeProject: CadProject;
  parcelLayoutParentEntity: CadEntity | null;
  parcelLayoutFrontageEntity: CadEntity | null;
  parcelLayoutState: CadParcelLayoutUiState;
  setParcelLayoutPreviewState: Dispatch<SetStateAction<ParcelLayoutPreviewState | null>>;
  setParcelLayoutAutoPreviewState: Dispatch<SetStateAction<ParcelLayoutAutoPreviewState | null>>;
}

export const useSurveyCadParcelLayoutPreviewReset = ({
  activeProject,
  parcelLayoutParentEntity,
  parcelLayoutFrontageEntity,
  parcelLayoutState,
  setParcelLayoutPreviewState,
  setParcelLayoutAutoPreviewState,
}: UseParcelLayoutPreviewResetOptions): void => {
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
};
