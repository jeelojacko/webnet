import { useMemo, useState } from 'react';
import type { StudyDataSnapshot } from '../studyTypes';

type StudyLibraryProps = {
  data: StudyDataSnapshot;
  onSelectDocument: (_documentId: string) => void;
};

const StudyLibrary = ({ data, onSelectDocument }: StudyLibraryProps) => {
  const [typeFilter, setTypeFilter] = useState('all');
  const unitsByDocument = new Map<string, number>();
  const reviewCountsByDocument = new Map<string, number>();
  data.units.forEach((unit) => {
    unit.documentIds.forEach((documentId) => {
      unitsByDocument.set(documentId, (unitsByDocument.get(documentId) ?? 0) + 1);
      if (unit.sourceReviewRequired || unit.sourceReferenceMissing) {
        reviewCountsByDocument.set(documentId, (reviewCountsByDocument.get(documentId) ?? 0) + 1);
      }
    });
  });
  const legalById = useMemo(
    () => new Map(data.legalDocuments.map((document) => [document.id, document])),
    [data.legalDocuments],
  );
  const filteredDocuments = useMemo(
    () =>
      data.documents.filter((document) => {
        const legal = legalById.get(document.id);
        return typeFilter === 'all' || legal?.documentType === typeFilter;
      }),
    [data.documents, legalById, typeFilter],
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Library</h2>
        <p className="text-sm text-slate-500">Documents and linked study units stay separate.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {['all', 'act', 'regulation'].map((value) => (
          <button
            key={value}
            onClick={() => setTypeFilter(value)}
            className={`rounded px-3 py-1.5 text-xs ${typeFilter === value ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {filteredDocuments.map((document) => {
          const legal = legalById.get(document.id);
          const relatedForms = data.legalComponents.filter(
            (component) => component.documentId === document.id && component.extractionStatus === 'reference-only',
          ).length;
          return (
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
                <span>{legal ? 'official' : 'user-created'}</span>
                <span>{legal?.documentType ?? document.kind}</span>
                {legal?.parentActId ? <span>parent {legal.parentActId}</span> : null}
                <span>{document.category}</span>
                <span>{legal?.consolidatedTo ?? 'no official date'}</span>
                <span>{unitsByDocument.get(document.id) ?? 0} units</span>
                <span>{reviewCountsByDocument.get(document.id) ?? 0} reviews</span>
                {relatedForms ? <span>{relatedForms} reference-only forms</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StudyLibrary;
