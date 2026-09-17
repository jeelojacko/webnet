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
    const syncedDrawing = drawing;
    onDrawingChange((current) => {
      if (!current || current.drawingId !== syncedDrawing.drawingId) return current;
      // Only sync the document this effect run observed. If the project
      // content moved on underneath (a newer external update, or a drawing
      // rebuilt by the legacy persisted-state fallback), a stale closure
      // must not overwrite it — otherwise this effect and the
      // history-adoption effect ping-pong the document between blank and
      // imported states on every external update. A content comparison
      // (not reference equality) keeps the legacy fallback working, since
      // it rebuilds an equivalent document object on every write.
      if (
        buildCadProjectSignature(current.project) !==
        buildCadProjectSignature(syncedDrawing.project)
      ) {
        return current;
      }
      const nowIso = new Date().toISOString();
      const nextState = cloneCadDrawingDocument({
        ...current,
        updatedAt: nowIso,
        project: cadProject,
        parcelLayout: parcelLayoutState,
        showParcelLabels,
      });
      const sigSame =
        buildCadProjectSignature(current.project) === buildCadProjectSignature(nextState.project);
      const layoutSame =
        JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(nextState.parcelLayout ?? null);
      const labelsSame = (current?.showParcelLabels ?? true) === nextState.showParcelLabels;
      if (sigSame && layoutSame && labelsSame) {
        return current;
      }
      return nextState;
    });
    // Intentionally not keyed on `drawing`: external document updates flow
    // internal via the history-adoption effect (which then changes
    // `cadProject` and re-fires this sync with a fresh closure). Keying on
    // `drawing` lets a stale internal snapshot overwrite a newer external
    // update, ping-ponging with adoption on every import/open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadProject, onDrawingChange, parcelLayoutState, showParcelLabels]);
};
