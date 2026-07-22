import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { createCadHistoryState, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadProject, SurveyCadPersistedState } from '../../engine/cad/cadTypes';

export const useSurveyCadWorkspaceHistory = (
  baseProject: CadProject,
  persistedState: SurveyCadPersistedState | null,
) => {
  const projectSignature = useMemo(() => buildCadProjectSignature(baseProject), [baseProject]);
  const persistedProjectRef = useRef(persistedState?.project ?? null);
  const historySourceSignatureRef = useRef<string | null>(
    persistedState?.sourceSignature === projectSignature ? persistedState.sourceSignature : projectSignature,
  );

  useEffect(() => {
    persistedProjectRef.current = persistedState?.project ?? null;
  }, [persistedState]);

  const [history, setHistory] = useState(() =>
    createCadHistoryState(
      persistedState?.sourceSignature === projectSignature ? persistedState.project : baseProject,
      baseProject.entities[0] ? [baseProject.entities[0].id] : [],
    ),
  );
  const historyRef = useRef(history);

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
    const nextSourceSignature =
      persistedState?.sourceSignature === projectSignature ? persistedState.sourceSignature : projectSignature;
    if (historySourceSignatureRef.current === nextSourceSignature) return;
    historySourceSignatureRef.current = nextSourceSignature;
    replaceHistory(
      createCadHistoryState(
        persistedState?.sourceSignature === projectSignature && persistedProjectRef.current
          ? persistedProjectRef.current
          : baseProject,
        baseProject.entities[0] ? [baseProject.entities[0].id] : [],
      ),
    );
  }, [baseProject, persistedState?.sourceSignature, projectSignature]);



  return {
    projectSignature,
    history,
    historyRef,
    applyHistoryUpdate,
  };
};
