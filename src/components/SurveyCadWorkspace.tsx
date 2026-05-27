import React, { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import type { SurveyCadPersistedState } from '../engine/cad/cadTypes';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';
import { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadCommandLine from './surveyCad/SurveyCadCommandLine';
import SurveyCadPreview from './surveyCad/SurveyCadPreview';

interface SurveyCadWorkspaceProps {
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions: ParseOptions;
  units: UnitsMode;
  result: AdjustmentResult | null;
  persistedState?: SurveyCadPersistedState | null;
  onPersistedStateChange?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
}

const SurveyCadWorkspace: React.FC<SurveyCadWorkspaceProps> = ({
  input,
  instrumentLibrary,
  parseOptions,
  units,
  result,
  persistedState = null,
  onPersistedStateChange = (_value) => null,
}) => {
  useEffect(() => {
    noteUiTabReady('survey-cad');
  }, []);

  const cadProject = useMemo(
    () =>
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary,
        parseOptions,
        units,
        result,
      }),
    [input, instrumentLibrary, parseOptions, result, units],
  );
  const {
    cadProject: activeProject,
    displayScene,
    selectedEntityIds,
    selectionCount,
    canUndo,
    canRedo,
    activeCommandKey,
    commandInputValue,
    statusText,
    commandHelpText,
    commandPreviewPrimitives,
    canCreateIntersectionPoint,
    activeSnap,
    snapStatusText,
    historyDepth,
    redoDepth,
    startPointCommand,
    startCogoPointCommand,
    startLineCommand,
    startPolylineCommand,
    startTraverseCommand,
    startArc3PointCommand,
    startTangentCurveCommand,
    startInverseCommand,
    startMoveCommand,
    startCopyCommand,
    createIntersectionPoint,
    setCommandInputValue,
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
    selectEntity,
    selectEntities,
    updatePointerWorldPoint,
    selectAll,
    clearSelection,
    eraseSelection,
    undo,
    redo,
  } = useSurveyCadWorkspace(cadProject, persistedState, onPersistedStateChange);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });

  useEffect(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
  }, [activeProject.id, activeProject.bounds?.minX, activeProject.bounds?.minY, activeProject.bounds?.maxX, activeProject.bounds?.maxY]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeCommandKey == null && selectionCount === 0) return;
        event.preventDefault();
        if (activeCommandKey) {
          handleEscapeKey();
          return;
        }
        clearSelection();
        return;
      }
      if (event.key !== 'Enter' || activeCommandKey == null) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLButtonElement
      ) {
        return;
      }
      event.preventDefault();
      handleEnterKey();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCommandKey, clearSelection, handleEnterKey, handleEscapeKey, selectionCount]);

  return (
    <div className="h-full min-h-0 overflow-hidden bg-slate-950 text-slate-100" data-survey-cad-dedicated-page>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-slate-800 bg-slate-900/90 px-4 py-2">
          <div className="max-h-[32vh] overflow-y-auto">
            <SurveyCadCommandLine
              entityCount={activeProject.entities.length}
              selectionCount={selectionCount}
              canUndo={canUndo}
              canRedo={canRedo}
              activeCommandKey={activeCommandKey}
              commandInputValue={commandInputValue}
              statusText={statusText}
              commandHelpText={commandHelpText}
              snapStatusText={snapStatusText}
              historyDepth={historyDepth}
              redoDepth={redoDepth}
              canCreateIntersectionPoint={canCreateIntersectionPoint}
              onStartPoint={startPointCommand}
              onStartCogoPoint={startCogoPointCommand}
              onStartLine={startLineCommand}
              onStartPolyline={startPolylineCommand}
              onStartTraverse={startTraverseCommand}
              onStartArc3Point={startArc3PointCommand}
              onStartTangentCurve={startTangentCurveCommand}
              onStartInverse={startInverseCommand}
              onStartMove={startMoveCommand}
              onStartCopy={startCopyCommand}
              onCreateIntersectionPoint={createIntersectionPoint}
              onCommandInputChange={setCommandInputValue}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onErase={eraseSelection}
              onUndo={undo}
              onRedo={redo}
              onEnterKey={handleEnterKey}
              onEscapeKey={() => {
                if (activeCommandKey) {
                  handleEscapeKey();
                  return;
                }
                if (selectionCount > 0) {
                  clearSelection();
                }
              }}
            />
          </div>
        </div>

        <section className="min-h-0 flex-1 overflow-hidden p-3">
          <div className="h-full rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <SurveyCadPreview
              scene={displayScene}
              selectedEntityIds={selectedEntityIds}
              activeSnap={activeSnap}
              commandPreviewPrimitives={commandPreviewPrimitives}
              viewport={viewport}
              commandActive={activeCommandKey != null}
              onViewportChange={setViewport}
              onSelectEntity={selectEntity}
              onSelectEntities={selectEntities}
              onConsumeInteractionPoint={consumeInteractionPoint}
              onPointerWorldPointChange={updatePointerWorldPoint}
              onZoomExtents={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
