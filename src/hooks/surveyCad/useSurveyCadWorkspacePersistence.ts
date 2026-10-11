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
      const currentSignature = buildCadProjectSignature(current.project);
      if (currentSignature !== buildCadProjectSignature(syncedDrawing.project)) {
        return current;
      }
      // PERF-188 (#188): decide whether a write is needed BEFORE paying for
      // the full deep clone. The clone only normalizes key order (and
      // re-sanitizes the draft); it never changes the observable project,
      // parcel-layout, or label values. When all three already match the
      // intended target there is nothing to publish and the clone would be
      // discarded immediately. A genuine change still falls through to the
      // clone below, so sanitation/normalization on real writes is retained.
      const projectMatches = currentSignature === buildCadProjectSignature(cadProject);
      const layoutMatches =
        JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(parcelLayoutState ?? null);
      const labelsMatch = (current.showParcelLabels ?? true) === (showParcelLabels ?? true);
      if (projectMatches && layoutMatches && labelsMatch) {
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
        currentSignature === buildCadProjectSignature(nextState.project);
      const layoutSame =
        JSON.stringify(current.parcelLayout ?? null) === JSON.stringify(nextState.parcelLayout ?? null);
      const labelsSame = (current.showParcelLabels ?? true) === nextState.showParcelLabels;
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
