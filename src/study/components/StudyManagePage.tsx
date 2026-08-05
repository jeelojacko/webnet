import type { StudyDataSnapshot } from '../studyTypes';

type StudyManagePageProps = {
  data: StudyDataSnapshot;
  exportText: string;
  importText: string;
  onImportTextChange: (_text: string) => void;
  onImport: () => Promise<void>;
  statusMessage: string;
};

const StudyManagePage = ({
  data,
  exportText,
  importText,
  onImportTextChange,
  onImport,
  statusMessage,
}: StudyManagePageProps) => (
  <div className="space-y-5">
    <div>
      <h2 className="text-xl font-semibold text-white">Manage</h2>
      <p className="text-sm text-slate-500">Import, export, and content-management data.</p>
    </div>
    {statusMessage ? (
      <div className="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
        {statusMessage}
      </div>
    ) : null}
    <section className="grid gap-3 sm:grid-cols-3">
      <div className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-lg font-semibold text-white">{data.documents.length}</div>
        <div className="text-xs uppercase tracking-wide text-slate-500">Documents</div>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-lg font-semibold text-white">{data.units.length}</div>
        <div className="text-xs uppercase tracking-wide text-slate-500">Units</div>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-lg font-semibold text-white">{data.attempts.length}</div>
        <div className="text-xs uppercase tracking-wide text-slate-500">Attempts</div>
      </div>
    </section>
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Export JSON</div>
      <textarea
        readOnly
        value={exportText}
        className="min-h-72 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300"
      />
    </section>
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Import JSON</div>
      <textarea
        value={importText}
        onChange={(event) => onImportTextChange(event.target.value)}
        className="min-h-44 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300"
      />
      <button
        onClick={onImport}
        disabled={!importText.trim()}
        className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
      >
        Import Data
      </button>
    </section>
  </div>
);

export default StudyManagePage;
