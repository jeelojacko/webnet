import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { cloneSurveyCadPersistedState } from '../../engine/cad/cadPersistence';
import type { CadParcelLayoutUiState, CadProject, SurveyCadPersistedState } from '../../engine/cad/cadTypes';

type SurveyCadWorkspacePersistenceOptions = {
  cadProject: CadProject;
  onPersistedStateChange: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
  parcelLayoutState: CadParcelLayoutUiState | undefined;
  projectSignature: string;
  showParcelLabels: boolean;
};

export const useSurveyCadWorkspacePersistence = ({
  cadProject,
  onPersistedStateChange,
  parcelLayoutState,
  projectSignature,
  showParcelLabels,
}: SurveyCadWorkspacePersistenceOptions): void => {
  useEffect(() => {
    onPersistedStateChange((current) => {
      const nextState = cloneSurveyCadPersistedState({
        version: 1,
        sourceSignature: projectSignature,
        project: cadProject,
        parcelLayout: parcelLayoutState,
        showParcelLabels,
      });
      if (
        current?.sourceSignature === nextState.sourceSignature &&
        buildCadProjectSignature(current.project) === buildCadProjectSignature(nextState.project) &&
        JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(nextState.parcelLayout ?? null) &&
        (current?.showParcelLabels ?? true) === nextState.showParcelLabels
      ) {
        return current;
      }
      return nextState;
    });
  }, [cadProject, onPersistedStateChange, parcelLayoutState, projectSignature, showParcelLabels]);
};
