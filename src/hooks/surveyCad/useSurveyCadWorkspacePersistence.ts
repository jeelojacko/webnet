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
      // PERF-188 (#188) correction: do NOT skip the clone on a raw
      // project-signature match. `cloneCadDrawingDocument` is not a
      // key-order-only normalization: `cloneCadProject` unconditionally
      // sets `version: 2`, defaults `cogoComputations` to `[]`, migrates
      // legacy surface point sources (`pointGroupId` -> `pointGroupIds`),
      // sanitizes surface purpose, and rebuilds nested key order; the
      // drawing clone also re-sanitizes the draft and defaults
      // `showParcelLabels`. A controlled drawing (supplied untouched by
      // `useSurveyCadDrawingSource`) or a legacy drawing document can
      // therefore carry a supported legacy shape whose project is
      // raw-equal to `cadProject` while still needing normalization on
      // publish. Raw equality cannot prove the project is already
      // canonical, so this path clones first and compares the *cloned*
      // result, exactly as before PR #262. The workspace wrapper's
      // reference-based no-op guard still removes the selection-only /
      // rejected-command clone, and a clone whose result is equal to
      // `current` is still discarded here.
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
