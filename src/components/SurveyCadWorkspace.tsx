import React, { useEffect, useMemo } from 'react';
import {
  Compass,
  FileCode2,
  FileText,
  GitBranch,
  Layers3,
  Network,
  Ruler,
} from 'lucide-react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import type { CadEntity } from '../engine/cad/cadTypes';
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
}

const entitySummaryOrder: CadEntity['type'][] = ['survey-point', 'line', 'error-ellipse', 'text'];

const SurveyCadWorkspace: React.FC<SurveyCadWorkspaceProps> = ({
  input,
  instrumentLibrary,
  parseOptions,
  units,
  result,
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
    statusText,
    historyDepth,
    redoDepth,
    selectEntity,
    selectAll,
    clearSelection,
    eraseSelection,
    undo,
    redo,
  } = useSurveyCadWorkspace(cadProject);
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

  return (
    <div className="h-full overflow-auto bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 md:px-8">
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-4xl">
              <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-300">
                Survey CAD Renderer / Model Spike
              </div>
              <h2 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <Ruler size={24} className="text-cyan-300" />
                Native CAD model first, renderer adapter second
              </h2>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
                This spike builds a native Survey CAD project model from current WebNet input or
                adjustment results, renders it through a lightweight internal SVG preview, and
                exports the same entities into an `mlightcad`-target adapter contract. No GPL/DWG
                runtime dependency is added to core WebNet in this branch.
              </p>
            </div>
            <div className="min-w-[18rem] rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-4 text-sm text-cyan-100">
              <div className="flex items-center gap-2 font-semibold">
                <GitBranch size={16} />
                Active spike branch
              </div>
              <div className="mt-2 font-mono text-xs text-cyan-50/90">
                spike/mlightcad-renderer-adapter
              </div>
              <div className="mt-2 text-xs leading-5 text-cyan-50/85">
                Proof goals: native IDs, live entity preview, adapter export, and documented
                package/license boundary.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-amber-300">
              <Network size={16} />
              Live spike preview
            </div>
            <div className="mt-4">
              <SurveyCadCommandLine
                selectionCount={selectionCount}
                canUndo={canUndo}
                canRedo={canRedo}
                statusText={statusText}
                onSelectAll={selectAll}
                onClearSelection={clearSelection}
                onErase={eraseSelection}
                onUndo={undo}
                onRedo={redo}
              />
            </div>
            <div className="mt-4 h-[34rem]">
              <SurveyCadPreview
                scene={displayScene}
                selectedEntityIds={selectedEntityIds}
                onSelectEntity={selectEntity}
              />
            </div>
            <div className="mt-4">
              <SurveyCadStatusBar
                entityCount={activeProject.entities.length}
                selectionCount={selectionCount}
                historyDepth={historyDepth}
                redoDepth={redoDepth}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
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
              `mlightcad` adapter export
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
                Spike findings
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
                Spike docs
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
