import React, { useEffect } from 'react';
import { Compass, FileText, GitBranch, Layers3, Ruler } from 'lucide-react';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';

const DOC_LINKS = [
  {
    href: '/docs/webnet-survey-cad-master-plan.md',
    label: 'Master Plan',
    detail: 'Repo-fit architecture, phase strategy, risks, and reuse boundaries.',
  },
  {
    href: '/docs/webnet-survey-cad-todo.md',
    label: 'Phased TODO',
    detail: 'Batched checklist for source-of-truth model, renderer spike, commands, IO, and plotting.',
  },
  {
    href: '/docs/webnet-cad-mlightcad-evaluation.md',
    label: 'mlightcad Evaluation',
    detail: 'MIT/GPL split, package audit, adapter spike criteria, and go/no-go questions.',
  },
  {
    href: '/docs/webnet-cad-licensing-notes.md',
    label: 'Licensing Notes',
    detail: 'DWG boundary, GPL implications, README obligations, and safer plugin strategy.',
  },
];

const WORKSTREAMS = [
  'Keep WebNet survey/CAD model authoritative. Renderers and exchange formats stay adapters.',
  'Reuse current map, CRS, project storage, and survey entities before introducing CAD-specific kernels.',
  'Build command, snapping, COGO, parcel, and plotting seams as native TypeScript modules in current repo structure.',
  'Treat DXF/LandXML/Geo outputs as exchange formats. Keep DWG optional behind explicit license boundary.',
];

const SurveyCadWorkspace: React.FC = () => {
  useEffect(() => {
    noteUiTabReady('survey-cad');
  }, []);

  return (
    <div className="h-full overflow-auto bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-6 md:px-8">
        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/30">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-300">
                Survey CAD Planning Workspace
              </div>
              <h2 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
                <Ruler size={24} className="text-cyan-300" />
                Lean survey CAD foundation for WebNet
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                This tab is the app-shell entry for the new Survey CAD initiative. Current scope is
                planning and architecture groundwork: durable docs, phased TODOs, ADR seeds, and a
                minimal workspace seam beside Project Options so future CAD batches land inside the
                existing browser workflow instead of as a side project.
              </p>
            </div>
            <div className="min-w-[16rem] rounded-lg border border-cyan-900/70 bg-cyan-950/20 p-4 text-sm text-cyan-100">
              <div className="flex items-center gap-2 font-semibold">
                <GitBranch size={16} />
                Current branch seam
              </div>
              <div className="mt-2 text-xs leading-5 text-cyan-50/85">
                Toolbar button beside <span className="font-semibold">Project Options</span>.
                Workspace tab always available before any solve. Heavy CAD implementation still
                follows docs-first phased batches.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-amber-300">
              <Compass size={16} />
              Immediate principles
            </div>
            <div className="mt-4 grid gap-3">
              {WORKSTREAMS.map((item) => (
                <div
                  key={item}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-slate-200"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">
              <Layers3 size={16} />
              Next implementation branch
            </div>
            <div className="mt-4 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-4 py-3 text-sm leading-6 text-emerald-50/90">
              Target spike after this planning batch:
              <div className="mt-2 font-mono text-xs text-emerald-200">
                spike/mlightcad-renderer-adapter
              </div>
              <div className="mt-2 text-xs text-emerald-50/80">
                Goal: render WebNet-native geometry through adapter, preserve native IDs, verify
                selection mapping and layer control, then write renderer decision record.
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-blue-300">
            <FileText size={16} />
            Planning docs in this branch
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
                <div className="mt-1 text-xs leading-5 text-slate-400">{doc.detail}</div>
                <div className="mt-2 text-[11px] text-cyan-300">{doc.href}</div>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
