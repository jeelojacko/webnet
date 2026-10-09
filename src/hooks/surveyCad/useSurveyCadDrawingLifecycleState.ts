/**
 * STRUCT-194.3 — early, unconditional drawing-file / LandXML lifecycle state.
 *
 * Holds the workspace-owned refs and state that both the drawing-file control
 * plane and the LandXML control plane operate on:
 *   - the hidden drawing + LandXML file-input refs,
 *   - the staged LandXML preview (UI-only),
 *   - the imported surfaces awaiting the deferred build schedule,
 *   - the watched imported-surface id set (materialization notice),
 *   - the single file-status line.
 *
 * Called once, early in `SurveyCadWorkspace`, at the exact position and in the
 * exact inner order of the pre-extraction root hooks (`useRef`/`useState`
 * sequence), so hook order and state identity are unchanged. `setFileStatusText`
 * must be available before the worker-service construction (~line 380), which
 * is why this state lives in its own early hook rather than in the later
 * action hooks. Behavior-preserving only: no new state, no new effect.
 */
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { LandXmlImportStagedState } from '../../components/landXmlImportReview/landXmlImportReview.types';

export interface SurveyCadDrawingLifecycleState {
  /** Hidden `<input type="file">` for opening a `.wncad` drawing. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** Hidden `<input type="file">` for staging a LandXML import. */
  landXmlImportInputRef: RefObject<HTMLInputElement | null>;
  /** Staged LandXML preview bound to one drawing (UI-only). */
  stagedLandXmlImport: LandXmlImportStagedState | null;
  setStagedLandXmlImport: Dispatch<SetStateAction<LandXmlImportStagedState | null>>;
  /** Imported-surface ids awaiting the deferred schedule/settlement pass. */
  pendingImportedSurfaceIds: readonly string[];
  setPendingImportedSurfaceIds: Dispatch<SetStateAction<readonly string[]>>;
  /** Watched imported-surface ids for the one-shot materialization notice. */
  importedSurfaceIdsRef: RefObject<Set<string>>;
  /** Single user-facing file/status line. */
  fileStatusText: string;
  setFileStatusText: Dispatch<SetStateAction<string>>;
}

export const useSurveyCadDrawingLifecycleState = (): SurveyCadDrawingLifecycleState => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const landXmlImportInputRef = useRef<HTMLInputElement | null>(null);
  // Phase 18M — staged LandXML preview bound to one drawing (UI-only).
  const [stagedLandXmlImport, setStagedLandXmlImport] = useState<LandXmlImportStagedState | null>(null);
  // Phase 18M — imported surfaces awaiting schedule/settlement. The build
  // service reads the drawing-project ref, so scheduling waits one render
  // (effect) for the committed project to be visible. `watched` drives the
  // workspace-level materialization-failure notice.
  const [pendingImportedSurfaceIds, setPendingImportedSurfaceIds] = useState<readonly string[]>([]);
  const importedSurfaceIdsRef = useRef<Set<string>>(new Set());
  const [fileStatusText, setFileStatusText] = useState('');
  return {
    fileInputRef,
    landXmlImportInputRef,
    stagedLandXmlImport,
    setStagedLandXmlImport,
    pendingImportedSurfaceIds,
    setPendingImportedSurfaceIds,
    importedSurfaceIdsRef,
    fileStatusText,
    setFileStatusText,
  };
};
