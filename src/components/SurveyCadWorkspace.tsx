import React, { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Crosshair,
  Compass,
  FileCode2,
  FileText,
  GitBranch,
  Minus,
  Layers3,
  Network,
  Plus,
  Ruler,
  ScanSearch,
} from 'lucide-react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import type { CadEntity, SurveyCadPersistedState } from '../engine/cad/cadTypes';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';
import { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadCommandLine from './surveyCad/SurveyCadCommandLine';
import SurveyCadPreview from './surveyCad/SurveyCadPreview';
import SurveyCadStatusBar from './surveyCad/SurveyCadStatusBar';

const DOC_LINKS = [
  {
    href: '/docs/webnet-survey-cad-master-plan.md',
    label: 'Master Plan',
  },
  {
    href: '/docs/webnet-survey-cad-todo.md',
    label: 'Phased TODO',
  },
  {
    href: '/docs/webnet-cad-mlightcad-evaluation.md',
    label: 'mlightcad Evaluation',
  },
  {
    href: '/docs/webnet-cad-licensing-notes.md',
    label: 'Licensing Notes',
  },
];

interface SurveyCadWorkspaceProps {
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions: ParseOptions;
  units: UnitsMode;
  result: AdjustmentResult | null;
  persistedState?: SurveyCadPersistedState | null;
  onPersistedStateChange?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
}

const entitySummaryOrder: CadEntity['type'][] = ['survey-point', 'line', 'error-ellipse', 'text'];

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
    mlightcadScene,
    selectedEntityIds,
    selectedEntities,
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
  const selectedEntity = selectedEntities[0] ?? null;

  const entityCounts = useMemo(() => {
    const counts = new Map<CadEntity['type'], number>();
    activeProject.entities.forEach((entity) => {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    });
    return entitySummaryOrder
      .map((type) => ({ type, count: counts.get(type) ?? 0 }))
      .filter((entry) => entry.count > 0);
  }, [activeProject.entities]);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });

  useEffect(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
  }, [activeProject.id, activeProject.bounds?.minX, activeProject.bounds?.minY, activeProject.bounds?.maxX, activeProject.bounds?.maxY]);

  return (
    <div className="h-full overflow-hidden bg-slate-950 text-slate-100" data-survey-cad-dedicated-page>
      <div className="flex h-full flex-col">
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-4xl">
              <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-300">
                Survey CAD Workspace
              </div>
              <h2 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <Ruler size={24} className="text-cyan-300" />
                Native Survey CAD workspace
              </h2>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
                This dedicated workspace builds a native Survey CAD project model from current
                WebNet input or adjustment results, renders it through an internal SVG viewport,
                and keeps renderer-adapter seams visible while core CAD commands, selection, and
                COGO workflows continue to grow on the plan branch.
              </p>
            </div>
            <div className="min-w-[18rem] rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-4 text-sm text-cyan-100">
              <div className="flex items-center gap-2 font-semibold">
                <GitBranch size={16} />
                Implementation branch
              </div>
              <div className="mt-2 font-mono text-xs text-cyan-50/90">
                feature/webnet-survey-cad-plan
              </div>
              <div className="mt-2 text-xs leading-5 text-cyan-50/85">
                Current focus: dedicated CAD workspace, native command workflows, viewport tools,
                and documented package/license boundaries for future renderer work.
              </div>
            </div>
          </div>
        </section>

        <div className="border-y border-slate-800 bg-slate-900/90 px-4 py-3">
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
                <Crosshair size={13} />
                Drag Box Select
              </span>
              <span>MMB Pan</span>
              <span>Wheel Zoom</span>
            </div>
          </div>
        </div>

        <section className="grid min-h-0 flex-1 gap-6 overflow-hidden px-5 py-6 md:px-8 xl:grid-cols-[minmax(0,1.3fr)_24rem]">
          <div className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-amber-300">
              <Network size={16} />
              Live CAD preview
            </div>
            <div className="mt-4">
              <SurveyCadCommandLine
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
            <div className="mt-4 min-h-0 flex-1">
              <SurveyCadPreview
                scene={displayScene}
                selectedEntityIds={selectedEntityIds}
                activeSnap={activeSnap}
                viewport={viewport}
                onViewportChange={setViewport}
                onSelectEntity={selectEntity}
                onSelectEntities={selectEntities}
                onPointerWorldPointChange={updatePointerWorldPoint}
              />
            </div>
            <div className="mt-4">
              <SurveyCadStatusBar
                entityCount={activeProject.entities.length}
                selectionCount={selectionCount}
                historyDepth={historyDepth}
                redoDepth={redoDepth}
                snapStatusText={snapStatusText}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-auto">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">
                <Layers3 size={16} />
                Model snapshot
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Source
                  </div>
                  <div className="mt-1 font-medium text-white">{activeProject.metadata.source}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Run mode
                  </div>
                  <div className="mt-1 font-medium text-white">{activeProject.metadata.runMode}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Units
                  </div>
                  <div className="mt-1 font-medium text-white">{activeProject.metadata.units}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    Layers
                  </div>
                  <div className="mt-1 font-medium text-white">{activeProject.layers.length}</div>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                {entityCounts.map((entry) => (
                  <div
                    key={entry.type}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm"
                  >
                    <span className="capitalize text-slate-300">{entry.type.replace('-', ' ')}</span>
                    <span className="font-mono text-cyan-300">{entry.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-blue-300">
                <Compass size={16} />
                Selected entity
              </div>
              {selectedEntity ? (
                <div className="mt-4 space-y-2 text-sm">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">ID</div>
                    <div className="mt-1 font-mono text-cyan-300">{selectedEntity.id}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Type</div>
                    <div className="mt-1 text-white">{selectedEntity.type}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Layer</div>
                    <div className="mt-1 text-white">{selectedEntity.layerId}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      Selection set
                    </div>
                    <div className="mt-1 text-white">{selectionCount} selected</div>
                  </div>
                  <pre className="overflow-auto rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-[11px] leading-5 text-slate-300">
                    {JSON.stringify(selectedEntity, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm text-slate-400">
                  {activeProject.entities.length === 0 ? 'No entity available.' : 'No entity selected.'}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
              <FileCode2 size={16} />
              Renderer adapter export
            </div>
            <div className="mt-4 rounded-lg border border-fuchsia-900/50 bg-fuchsia-950/15 px-4 py-3 text-xs leading-6 text-fuchsia-50/90">
              This JSON is the inferred handoff contract from native WebNet entities into a future
              `mlightcad` spike. IDs stay native. Layers stay WebNet-owned. Geometry payloads are
              disposable adapter output.
            </div>
            <pre className="mt-4 max-h-[28rem] overflow-auto rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-[11px] leading-5 text-slate-300">
              {JSON.stringify(
                {
                  layerCount: mlightcadScene.layers.length,
                  entityCount: mlightcadScene.entities.length,
                  extents: mlightcadScene.extents,
                  sampleEntities: mlightcadScene.entities.slice(0, 6),
                },
                null,
                2,
              )}
            </pre>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">
                <FileText size={16} />
                Renderer findings
              </div>
              <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-200">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                  `@mlightcad/cad-viewer` is Vue-specific. `@mlightcad/cad-simple-viewer` is
                  framework-agnostic but still brings a LibreDWG converter dependency chain.
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                  Current spike therefore proves model ownership and renderer independence first,
                  using internal SVG preview plus an external-target adapter export.
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                  Next external package test can stay isolated: DXF-only renderer path if possible,
                  or a clearly optional DWG/GPL boundary if not.
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-sky-300">
                <FileText size={16} />
                CAD docs
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {DOC_LINKS.map((doc) => (
                  <a
                    key={doc.href}
                    href={doc.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 transition-colors hover:border-cyan-500/70 hover:bg-slate-900"
                  >
                    <div className="text-sm font-semibold text-white">{doc.label}</div>
                    <div className="mt-2 text-[11px] text-cyan-300">{doc.href}</div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
