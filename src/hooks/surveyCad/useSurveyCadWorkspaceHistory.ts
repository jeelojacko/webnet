import { useEffect, useRef, useState } from 'react';
import { createCadHistoryState, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
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



  return {
    history,
    historyRef,
    applyHistoryUpdate,
  };
};
