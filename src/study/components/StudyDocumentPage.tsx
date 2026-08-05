import { useEffect, useMemo, useState } from 'react';
import type { StudyDataSnapshot, StudyDocument, StudyUnit } from '../studyTypes';

type StudyDocumentPageProps = {
  data: StudyDataSnapshot;
  documentId: string;
  onSaveDocument: (_document: StudyDocument) => Promise<void>;
  onSaveUnit: (_unit: StudyUnit) => Promise<void>;
  onCompleteReading: (_unitId: string) => Promise<void>;
};

const StudyDocumentPage = ({
  data,
  documentId,
  onSaveDocument,
  onSaveUnit,
  onCompleteReading,
}: StudyDocumentPageProps) => {
  const document = data.documents.find((entry) => entry.id === documentId);
  const units = useMemo(
    () => data.units.filter((unit) => unit.documentIds.includes(documentId)),
    [data.units, documentId],
  );
  const [documentDraft, setDocumentDraft] = useState(document);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, StudyUnit>>({});

  useEffect(() => {
    setDocumentDraft(document);
    setUnitDrafts(Object.fromEntries(units.map((unit) => [unit.id, unit])));
  }, [document, units]);

  if (!document || !documentDraft) {
    return <div className="text-sm text-slate-500">Document not found.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">{document.title}</h2>
          <p className="text-sm text-slate-500">
            {document.kind} · {document.jurisdiction} · priority {document.priority}
          </p>
        </div>
        <button
          onClick={() => onSaveDocument(documentDraft)}
          className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Save Document
        </button>
      </div>
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <label className="text-xs uppercase tracking-wide text-slate-500">Document Metadata Summary</label>
        <textarea
          value={documentDraft.summary}
          onChange={(event) => setDocumentDraft({ ...documentDraft, summary: event.target.value })}
          className="mt-2 min-h-28 w-full rounded border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100"
        />
        <div className="mt-3 text-xs text-slate-500">
          Source files are tracked separately from editable study notes.
        </div>
        <div className="mt-3 space-y-2">
          {document.sourceFiles.map((asset) => (
            <div key={asset.id} className="rounded bg-slate-950 px-3 py-2 text-xs text-slate-400">
              {asset.label} · {asset.role} · {asset.storagePath}
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Study Units</h3>
        {units.map((unit) => {
          const draft = unitDrafts[unit.id] ?? unit;
          const progress = data.progress.find((entry) => entry.unitId === unit.id);
          return (
            <div key={unit.id} className="rounded border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-slate-100">{unit.title}</h4>
                  <p className="text-xs text-slate-500">
                    {unit.sectionRefs.map((ref) => ref.label).join(', ')} · {progress?.phase ?? 'unread'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onCompleteReading(unit.id)}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Reading Done
                  </button>
                  <button
                    onClick={() => onSaveUnit(draft)}
                    className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white hover:bg-slate-600"
                  >
                    Save Unit
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
                  Editable Study Summary
                  <textarea
                    value={draft.editableSummary}
                    onChange={(event) =>
                      setUnitDrafts({
                        ...unitDrafts,
                        [unit.id]: { ...draft, editableSummary: event.target.value },
                      })
                    }
                    className="min-h-32 rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
                  Reference Answer
                  <textarea
                    value={draft.referenceAnswer}
                    onChange={(event) =>
                      setUnitDrafts({
                        ...unitDrafts,
                        [unit.id]: { ...draft, referenceAnswer: event.target.value },
                      })
                    }
                    className="min-h-32 rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
                  />
                </label>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};

export default StudyDocumentPage;
