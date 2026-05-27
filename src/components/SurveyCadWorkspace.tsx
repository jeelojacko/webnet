import React, { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
    appendCommandInputValue,
    backspaceCommandInputValue,
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
    selectEntity,
    selectEntities,
    updatePointerWorldPoint,
    selectAll,
    clearSelection,
    eraseSelection,
    pasteEntityIdsInPlace,
    undo,
    redo,
  } = useSurveyCadWorkspace(cadProject, persistedState, onPersistedStateChange);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [copiedEntityIds, setCopiedEntityIds] = useState<string[]>([]);
  const copiedEntityIdsRef = useRef<string[]>([]);

  useEffect(() => {
    copiedEntityIdsRef.current = copiedEntityIds;
  }, [copiedEntityIds]);

  const commandInputPlaceholder = useMemo(() => {
    if (!activeCommandKey) return 'Choose a command, then click or type in the drawing window';
    if (activeCommandKey === 'POINT') return 'Click in model space or type x,y / LABEL=x,y';
    if (activeCommandKey === 'COGO_POINT') return 'Click base/target or type @azimuth,distance';
    if (activeCommandKey === 'TRAVERSE') return 'Click start / next point or type bearing-distance';
    if (activeCommandKey === 'TANGENT_CURVE') return 'Click tangent points or type radius';
    return 'Click in model space or type x,y / bearing-distance';
  }, [activeCommandKey]);
  const commandStatusText = useMemo(
    () => (statusText.startsWith('Ready.') ? '' : statusText),
    [statusText],
  );

  useEffect(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
  }, [activeProject.id, activeProject.bounds?.minX, activeProject.bounds?.minY, activeProject.bounds?.maxX, activeProject.bounds?.maxY]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
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
      const modifierKey = event.ctrlKey || event.metaKey;
      if (modifierKey && !isEditableTarget(target)) {
        const lowerKey = event.key.toLowerCase();
        if (lowerKey === 'c' && selectionCount > 0) {
          event.preventDefault();
          setCopiedEntityIds(selectedEntityIds);
          copiedEntityIdsRef.current = selectedEntityIds;
          return;
        }
        if (lowerKey === 'v' && copiedEntityIdsRef.current.length > 0) {
          event.preventDefault();
          pasteEntityIdsInPlace(copiedEntityIdsRef.current);
          return;
        }
        if (lowerKey === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
            return;
          }
          undo();
          return;
        }
        if (lowerKey === 'y') {
          event.preventDefault();
          redo();
          return;
        }
      }
      if (event.key === 'Enter' && activeCommandKey != null) {
        if (isEditableTarget(target)) return;
        event.preventDefault();
        handleEnterKey();
        return;
      }
      if (activeCommandKey == null || modifierKey || isEditableTarget(target) || event.altKey) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspaceCommandInputValue();
        return;
      }
      if (event.key.length !== 1) return;
      event.preventDefault();
      appendCommandInputValue(event.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeCommandKey,
    appendCommandInputValue,
    backspaceCommandInputValue,
    clearSelection,
    handleEnterKey,
    handleEscapeKey,
    copiedEntityIds,
    pasteEntityIdsInPlace,
    redo,
    selectedEntityIds,
    selectionCount,
    undo,
  ]);

  return (
    <div className="h-full min-h-0 overflow-hidden bg-slate-950 text-slate-100" data-survey-cad-dedicated-page>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-slate-800 bg-slate-900/90 px-4 py-2">
          <div className="overflow-x-auto">
            <SurveyCadCommandLine
              entityCount={activeProject.entities.length}
              selectionCount={selectionCount}
              canUndo={canUndo}
              canRedo={canRedo}
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
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onErase={eraseSelection}
              onUndo={undo}
              onRedo={redo}
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
              commandStatusText={commandStatusText}
              commandHelpText={commandHelpText}
              snapStatusText={snapStatusText}
              commandInputValue={commandInputValue}
              commandInputPlaceholder={commandInputPlaceholder}
              commandInputEnabled={activeCommandKey != null}
              viewport={viewport}
              commandActive={activeCommandKey != null}
              onViewportChange={setViewport}
              onSelectEntity={selectEntity}
              onSelectEntities={selectEntities}
              onConsumeInteractionPoint={consumeInteractionPoint}
              onPointerWorldPointChange={updatePointerWorldPoint}
              onCommandInputChange={setCommandInputValue}
              onCommandInputEnter={handleEnterKey}
              onCommandInputEscape={() => {
                if (activeCommandKey) {
                  handleEscapeKey();
                  return;
                }
                if (selectionCount > 0) {
                  clearSelection();
                }
              }}
              onZoomExtents={() => setViewport({ zoom: 1, panX: 0, panY: 0 })}
            />
          </div>
        </section>
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
