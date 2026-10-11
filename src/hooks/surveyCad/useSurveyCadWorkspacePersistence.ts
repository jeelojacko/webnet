import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { cloneCadDrawingDocument } from '../../engine/cad/cadDrawingFile';
import type { CadDrawingDocument, CadParcelLayoutUiState, CadProject } from '../../engine/cad/cadTypes';

/**
 * PERF-188.2 provenance certificate for one workspace instance.
 *
 * The workspace wrapper outward-clones the drawing document at the ownership
 * boundary (`useSurveyCadWorkspace.applyHistoryUpdate`) whenever a committed
 * project/draft changes. That clone is already canonical (it runs the same
 * `cloneCadDrawingDocument` normalization the persistence sync would). This
 * record proves that the document currently held by the parent is *exactly*
 * that published clone for *exactly* the inputs the persistence sync is about
 * to normalize, so the sync can skip its redundant second clone.
 *
 * The record is reference/identity only: no signature, no cache, no global
 * state, no mutation of persisted objects. `publishId` is internal sequencing
 * used to absorb React StrictMode's dev double-invocation of the state updater
 * (React keeps the first produced value).
 */
export interface CadNormalizedSyncCertificate {
  /** Internal sequence id for the wrapper publish that produced `owned`. */
  readonly publishId: number;
  /** The exact normalized document the wrapper published. */
  readonly owned: CadDrawingDocument;
  readonly drawingId: string;
  /** The history project reference the wrapper cloned from. */
  readonly sourceProject: CadProject;
  /** The parcel-layout prop reference at publish time. */
  readonly layoutRef: CadParcelLayoutUiState | undefined;
  /** The show-labels prop value at publish time. */
  readonly labels: boolean;
}

/** Mutable per-workspace handle (one entry, most recent publish only). */
export interface CadNormalizedSyncCertificateHandle {
  current: CadNormalizedSyncCertificate | null;
}

/**
 * Creates the per-workspace certificate state consumed by the persistence sync.
 * `cert` holds exactly one most-recent record. `beginPublish` sequences wrapper
 * publishes (so a React StrictMode dev replay does not overwrite the first,
 * kept clone) and `record` writes that publish's certificate only from the
 * ownership-boundary clone. The hygiene effect drops a certificate whose
 * `owned` document is no longer the current drawing (drawing switch, external
 * publish) or when the reset key changes (even with an unchanged drawing
 * reference; the history baseline is rebuilt then, so any certificate is
 * invalid). Call this hook earlier in the workspace body than the persistence
 * hook so the hygiene effect runs first. Identity checks alone already fail the
 * sync closed — this is explicit defense in depth.
 */
export const useCadNormalizedSyncCertificate = (
  drawing: CadDrawingDocument,
  resetKey: string,
): {
  cert: { current: CadNormalizedSyncCertificate | null };
  beginPublish: () => number;
  record: (
    _publishId: number,
    _owned: CadDrawingDocument,
    _sourceProject: CadProject,
    _layoutRef: CadParcelLayoutUiState | undefined,
    _labels: boolean,
  ) => void;
} => {
  const cert = useRef<CadNormalizedSyncCertificate | null>(null);
  const publishId = useRef(0);
  // Track the previous reset key so a reset clears the certificate even when
  // the parent hands back the exact same drawing reference (the history
  // baseline is rebuilt on a reset, so no certificate can survive it).
  const resetKeyRef = useRef(resetKey);
  useEffect(() => {
    const resetChanged = resetKeyRef.current !== resetKey;
    resetKeyRef.current = resetKey;
    const certificate = cert.current;
    if (resetChanged || (certificate && certificate.owned !== drawing)) {
      cert.current = null;
    }
  }, [drawing, resetKey]);
  const beginPublish = useCallback((): number => {
    publishId.current += 1;
    return publishId.current;
  }, []);
  const record = useCallback(
    (
      id: number,
      owned: CadDrawingDocument,
      sourceProject: CadProject,
      layoutRef: CadParcelLayoutUiState | undefined,
      labels: boolean,
    ) => {
      if (cert.current?.publishId === id) return;
      cert.current = {
        publishId: id,
        owned,
        drawingId: owned.drawingId,
        sourceProject,
        layoutRef,
        labels,
      };
    },
    [],
  );
  return { cert, beginPublish, record };
};

type SurveyCadWorkspacePersistenceOptions = {
  cadProject: CadProject;
  drawing: CadDrawingDocument;
  onDrawingChange: Dispatch<SetStateAction<CadDrawingDocument | null>>;
  parcelLayoutState: CadParcelLayoutUiState | undefined;
  showParcelLabels: boolean;
  /**
   * Provenance handle written by the workspace wrapper at its ownership-boundary
   * clone. When it certifies `current` as that wrapper's normalized output for
   * these exact inputs, the redundant normalization clone is skipped.
   */
  cert: CadNormalizedSyncCertificateHandle;
};

export const useSurveyCadWorkspacePersistence = ({
  cadProject,
  drawing,
  onDrawingChange,
  parcelLayoutState,
  showParcelLabels,
  cert,
}: SurveyCadWorkspacePersistenceOptions): void => {
  useEffect(() => {
    const syncedDrawing = drawing;
    onDrawingChange((current) => {
      if (!current || current.drawingId !== syncedDrawing.drawingId) return current;
      // PERF-188.2: if this document is the exact normalized clone the wrapper
      // published for the same (project identity, layout identity, labels)
      // tuple, it is already canonical — the clone below is provably
      // discarded by the sig/layout/labels comparison. Provenance is identity
      // only; a stale certificate (external update, drawing switch, layout or
      // label change) fails one of these checks and falls through to the
      // unmodified clone-first path.
      const certificate = cert.current;
      if (
        certificate != null &&
        current === certificate.owned &&
        current.drawingId === certificate.drawingId &&
        cadProject === certificate.sourceProject &&
        parcelLayoutState === certificate.layoutRef &&
        showParcelLabels === certificate.labels
      ) {
        return current;
      }
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
