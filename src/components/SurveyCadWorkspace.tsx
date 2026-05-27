import React, { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Crosshair, Hand, Minus, Plus, ScanSearch, Search } from 'lucide-react';
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
    canUseActiveSnap,
    canFinishCommand,
    canCreateIntersectionPoint,
    activeSnap,
    snapStatusText,
    historyDepth,
    redoDepth,
    startPointCommand,
    startCogoPointCommand,
    startLineCommand,
    startPolylineCommand,
    startArc3PointCommand,
    startTangentCurveCommand,
    startInverseCommand,
    startMoveCommand,
    startCopyCommand,
    createIntersectionPoint,
    cancelActiveCommand,
    finishActiveCommand,
    setCommandInputValue,
    submitCommandInput,
    useActiveSnap,
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
  const [toolMode, setToolMode] = useState<'select' | 'pan' | 'zoom-window'>('select');

  useEffect(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
  }, [activeProject.id, activeProject.bounds?.minX, activeProject.bounds?.minY, activeProject.bounds?.maxX, activeProject.bounds?.maxY]);

  return (
    <div className="h-full overflow-hidden bg-slate-950 text-slate-100" data-survey-cad-dedicated-page>
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-800 bg-slate-900/90 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(16, current.zoom * 1.2) }))}
              className="rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900"
            >
              <span className="inline-flex items-center gap-2">
                <Plus size={14} />
                Zoom In
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.35, current.zoom / 1.2) }))}
              className="rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900"
            >
              <span className="inline-flex items-center gap-2">
                <Minus size={14} />
                Zoom Out
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
              className="rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900"
            >
              <span className="inline-flex items-center gap-2">
                <ScanSearch size={14} />
                Zoom Extents
              </span>
            </button>
            <div className="ml-auto flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-slate-400">
              <span className="inline-flex items-center gap-1">
                {toolMode === 'select' ? <Crosshair size={13} /> : toolMode === 'pan' ? <Hand size={13} /> : <Search size={13} />}
                {toolMode === 'select' ? 'Select Tool' : toolMode === 'pan' ? 'Pan Tool' : 'Zoom Window'}
              </span>
              <span>MMB Pan</span>
              <span>Wheel Zoom</span>
            </div>
          </div>
          <div className="mt-3 border-t border-slate-800 pt-3">
            <SurveyCadCommandLine
              toolMode={toolMode}
              onToolModeChange={setToolMode}
              selectionCount={selectionCount}
              canUndo={canUndo}
              canRedo={canRedo}
              activeCommandKey={activeCommandKey}
              commandInputValue={commandInputValue}
              statusText={statusText}
              commandHelpText={commandHelpText}
              canUseActiveSnap={canUseActiveSnap}
              canFinishCommand={canFinishCommand}
              canCreateIntersectionPoint={canCreateIntersectionPoint}
              onStartPoint={startPointCommand}
              onStartCogoPoint={startCogoPointCommand}
              onStartLine={startLineCommand}
              onStartPolyline={startPolylineCommand}
              onStartArc3Point={startArc3PointCommand}
              onStartTangentCurve={startTangentCurveCommand}
              onStartInverse={startInverseCommand}
              onStartMove={startMoveCommand}
              onStartCopy={startCopyCommand}
              onCreateIntersectionPoint={createIntersectionPoint}
              onCancelCommand={cancelActiveCommand}
              onFinishCommand={finishActiveCommand}
              onCommandInputChange={setCommandInputValue}
              onSubmitCommand={submitCommandInput}
              onUseActiveSnap={useActiveSnap}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onErase={eraseSelection}
              onUndo={undo}
              onRedo={redo}
            />
          </div>
        </div>

        <section className="min-h-0 flex-1 overflow-hidden p-4">
          <div className="h-full rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <SurveyCadPreview
              scene={displayScene}
              selectedEntityIds={selectedEntityIds}
              activeSnap={activeSnap}
              viewport={viewport}
              toolMode={toolMode}
              onViewportChange={setViewport}
              onSelectEntity={selectEntity}
              onSelectEntities={selectEntities}
              onPointerWorldPointChange={updatePointerWorldPoint}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 px-1 pt-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <span data-survey-cad-entity-count>{activeProject.entities.length} entities</span>
            <span data-survey-cad-selection-count>{selectionCount} selected</span>
            <span>{historyDepth} undo</span>
            <span>{redoDepth} redo</span>
            <span data-survey-cad-snap-status>{snapStatusText}</span>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
