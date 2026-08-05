import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { cloneCadDrawingDocument } from '../../engine/cad/cadDrawingFile';
import type { CadDrawingDocument, CadParcelLayoutUiState, CadProject } from '../../engine/cad/cadTypes';

type SurveyCadWorkspacePersistenceOptions = {
  cadProject: CadProject;
  drawing: CadDrawingDocument;
  onDrawingChange: Dispatch<SetStateAction<CadDrawingDocument | null>>;
  parcelLayoutState: CadParcelLayoutUiState | undefined;
  showParcelLabels: boolean;
};

export const useSurveyCadWorkspacePersistence = ({
  cadProject,
  drawing,
  onDrawingChange,
  parcelLayoutState,
  showParcelLabels,
}: SurveyCadWorkspacePersistenceOptions): void => {
  useEffect(() => {
    onDrawingChange((current) => {
      if (!current || current.drawingId !== drawing.drawingId) return current;
      const nowIso = new Date().toISOString();
      const nextState = cloneCadDrawingDocument({
        ...current,
        updatedAt: nowIso,
        project: cadProject,
        parcelLayout: parcelLayoutState,
        showParcelLabels,
      });
      if (
        buildCadProjectSignature(current.project) === buildCadProjectSignature(nextState.project) &&
        JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(nextState.parcelLayout ?? null) &&
        (current?.showParcelLabels ?? true) === nextState.showParcelLabels
      ) {
        return current;
      }
      return nextState;
    });
  }, [cadProject, drawing, onDrawingChange, parcelLayoutState, showParcelLabels]);
};
