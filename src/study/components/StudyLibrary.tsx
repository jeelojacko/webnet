import type { StudyDataSnapshot } from '../studyTypes';

type StudyLibraryProps = {
  data: StudyDataSnapshot;
  onSelectDocument: (_documentId: string) => void;
};

const StudyLibrary = ({ data, onSelectDocument }: StudyLibraryProps) => {
  const unitsByDocument = new Map<string, number>();
  data.units.forEach((unit) => {
    unit.documentIds.forEach((documentId) => {
      unitsByDocument.set(documentId, (unitsByDocument.get(documentId) ?? 0) + 1);
    });
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Library</h2>
        <p className="text-sm text-slate-500">Documents and linked study units stay separate.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.documents.map((document) => (
          <button
            key={document.id}
            onClick={() => onSelectDocument(document.id)}
            className="rounded border border-slate-800 bg-slate-900 p-4 text-left hover:border-emerald-700"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-100">{document.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{document.summary}</p>
              </div>
              <span className="rounded bg-slate-950 px-2 py-1 text-xs text-slate-400">
                P{document.priority}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>{document.kind}</span>
              <span>{document.category}</span>
              <span>{unitsByDocument.get(document.id) ?? 0} units</span>
              <span>{document.sourceFiles.length} source files</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default StudyLibrary;
