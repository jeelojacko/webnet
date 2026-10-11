import { useEffect, useRef, useState } from 'react';
import { createCadHistoryState, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import { areCadProjectsCanonicallyEqual } from '../../engine/cad/cadProjectState';
import type { CadProject } from '../../engine/cad/cadTypes';

export const useSurveyCadWorkspaceHistory = (
  baseProject: CadProject,
  resetKey: string,
) => {
  const [history, setHistory] = useState(() =>
    createCadHistoryState(
      baseProject,
      baseProject.entities[0] ? [baseProject.entities[0].id] : [],
    ),
  );
  const historyRef = useRef(history);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const replaceHistory = (nextHistory: CadHistoryState) => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  };

  const applyHistoryUpdate = (updater: (_history: CadHistoryState) => CadHistoryState) => {
    const nextHistory = updater(historyRef.current);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  };

  useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    replaceHistory(
      createCadHistoryState(
        baseProject,
        baseProject.entities[0] ? [baseProject.entities[0].id] : [],
      ),
    );
  }, [baseProject, resetKey]);

  // Adopt authoritative external document updates (e.g. linked-F2F rerun
  // sync via top-level drawing state) as the new history baseline.
  // External updates cannot push history entries — history is
  // workspace-local — so the baseline resets (consistent with
  // replaceCadProject); re-running the source re-derives the same state.
  // Order-insensitive comparison: the drawing sync clones the project
  // (key order normalizes, e.g. imported-TIN surface definitions), which
  // is not an external update — a plain stringify comparison would wipe
  // the just-committed transaction and disable undo/redo.
  // Signature-guarded: the workspace's own persistence writes compare
  // equal, so no update loop is possible.
  // PERF-187: the previous double `buildStableCadProjectSignature` call paid
  // two complete canonical traversals + allocations + JSON.stringify per
  // effect run. `areCadProjectsCanonicallyEqual` preserves the exact same
  // key-order-insensitive equivalence (clone-normalized TIN surfaces stay
  // equal; genuine external edits still adopt) with a same-reference fast
  // path plus, per distinct-reference comparison, one cheap domain walk per
  // side and one allocation-light early-exit comparison walk with zero
  // serialization, falling back to the original canonical serializer on
  // exotic values rather than risking undo loss.
  useEffect(() => {
    if (resetKeyRef.current !== resetKey) return;
    if (history.present.project === baseProject) return;
    if (areCadProjectsCanonicallyEqual(history.present.project, baseProject)) return;
    replaceHistory(
      createCadHistoryState(
        baseProject,
        baseProject.entities[0] ? [baseProject.entities[0].id] : [],
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseProject, resetKey]);



  return {
    history,
    historyRef,
    applyHistoryUpdate,
  };
};
