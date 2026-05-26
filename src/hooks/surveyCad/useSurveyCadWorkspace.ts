import { useEffect, useMemo, useState } from 'react';
import { getSelectedCadEntities, replaceCadSelection, toggleCadSelectionEntity } from '../../engine/cad/cadSelection';
import { buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { buildMlightcadSpikeScene } from '../../engine/cad/cadMlightcadAdapter';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../../engine/cad/cadUndoRedo';
import { useSurveyCadSnapping } from './useSurveyCadSnapping';
import type { CadProject, CadSnapCandidate } from '../../engine/cad/cadTypes';

interface UseSurveyCadWorkspaceResult {
  cadProject: CadProject;
  displayScene: ReturnType<typeof buildCadDisplayScene>;
  mlightcadScene: ReturnType<typeof buildMlightcadSpikeScene>;
  selectedEntityIds: string[];
  selectedEntities: ReturnType<typeof getSelectedCadEntities>;
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  statusText: string;
  activeSnap: CadSnapCandidate | null;
  snapStatusText: string;
  historyDepth: number;
  redoDepth: number;
  selectEntity: (_entityId: string, _appendToSelection?: boolean) => void;
  updatePointerWorldPoint: (_worldPoint: { x: number; y: number } | null) => void;
  selectAll: () => void;
  clearSelection: () => void;
  eraseSelection: () => void;
  undo: () => void;
  redo: () => void;
}

export const useSurveyCadWorkspace = (baseProject: CadProject): UseSurveyCadWorkspaceResult => {
  const projectSignature = useMemo(() => buildCadProjectSignature(baseProject), [baseProject]);
  const [history, setHistory] = useState(() =>
    createCadHistoryState(baseProject, baseProject.entities[0] ? [baseProject.entities[0].id] : []),
  );

  useEffect(() => {
    setHistory(
      createCadHistoryState(baseProject, baseProject.entities[0] ? [baseProject.entities[0].id] : []),
    );
  }, [baseProject, projectSignature]);

  const cadProject = history.present.project;
  const selection = history.present.selection;

  const displayScene = useMemo(() => buildCadDisplayScene(cadProject), [cadProject]);
  const mlightcadScene = useMemo(() => buildMlightcadSpikeScene(cadProject), [cadProject]);
  const selectedEntities = useMemo(
    () => getSelectedCadEntities(cadProject, selection),
    [cadProject, selection],
  );
  const { activeSnap, snapStatusText, updatePointerWorldPoint } = useSurveyCadSnapping(cadProject);

  return {
    cadProject,
    displayScene,
    mlightcadScene,
    selectedEntityIds: selection.selectedEntityIds,
    selectedEntities,
    selectionCount: selection.selectedEntityIds.length,
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
    statusText: history.commandState.prompt,
    activeSnap,
    snapStatusText,
    historyDepth: history.undoStack.length,
    redoDepth: history.redoStack.length,
    selectEntity: (entityId, appendToSelection = false) => {
      setHistory((current) => {
        const nextSelection = appendToSelection
          ? toggleCadSelectionEntity(current.present.project, current.present.selection, entityId)
          : replaceCadSelection(current.present.project, [entityId]);
        return {
          ...current,
          present: {
            ...current.present,
            selection: nextSelection,
          },
          commandState: {
            key: 'IDLE',
            phase: 'idle',
            prompt: `Selected ${nextSelection.selectedEntityIds.length} entr${nextSelection.selectedEntityIds.length === 1 ? 'y' : 'ies'}.`,
          },
        };
      });
    },
    selectAll: () => {
      setHistory((current) => runCadCommand(current, { key: 'SELECT_ALL' }));
    },
    updatePointerWorldPoint,
    clearSelection: () => {
      setHistory((current) => runCadCommand(current, { key: 'CLEAR_SELECTION' }));
    },
    eraseSelection: () => {
      setHistory((current) => runCadCommand(current, { key: 'ERASE' }));
    },
    undo: () => {
      setHistory((current) => undoCadHistory(current));
    },
    redo: () => {
      setHistory((current) => redoCadHistory(current));
    },
  };
};
