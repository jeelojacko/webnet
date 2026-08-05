import { useEffect, useMemo, useState } from 'react';
import type {
  ImportedLegalComponent,
  StudyDataSnapshot,
  StudyDocument,
  StudyUnit,
} from '../studyTypes';

type StudyDocumentPageProps = {
  data: StudyDataSnapshot;
  documentId: string;
  onSaveDocument: (_document: StudyDocument) => Promise<void>;
  onSaveUnit: (_unit: StudyUnit) => Promise<void>;
  onCompleteReading: (_unitId: string) => Promise<void>;
  onCreateUnitFromSelection: (_documentId: string, _components: ImportedLegalComponent[]) => Promise<void>;
  onAcknowledgeSourceReview: (_unitId: string) => Promise<void>;
  onSelectDocument: (_documentId: string) => void;
};

const normalizeSearch = (value: string): string => value.trim().toLowerCase();

const componentMatches = (component: ImportedLegalComponent, query: string): boolean => {
  if (!query) return true;
  const haystack = [
    component.label,
    component.heading ?? '',
    component.text,
    ...(component.subsections ?? []).flatMap((subsection) => [subsection.label, subsection.text]),
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
};

const highlight = (text: string, query: string) => {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-amber-400/80 text-slate-950">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
};

const legalReference = (document: StudyDocument, component: ImportedLegalComponent): string =>
  `${document.title}, ${component.label}${component.heading ? ` (${component.heading})` : ''}`;

const StudyDocumentPage = ({
  data,
  documentId,
  onSaveDocument,
  onSaveUnit,
  onCompleteReading,
  onCreateUnitFromSelection,
  onAcknowledgeSourceReview,
  onSelectDocument,
}: StudyDocumentPageProps) => {
  const document = data.documents.find((entry) => entry.id === documentId);
  const legalDocument = data.legalDocuments.find((entry) => entry.id === documentId);
  const components = useMemo(
    () => data.legalComponents.filter((component) => component.documentId === documentId),
    [data.legalComponents, documentId],
  );
  const units = useMemo(
    () => data.units.filter((unit) => unit.documentIds.includes(documentId)),
    [data.units, documentId],
  );
  const [documentDraft, setDocumentDraft] = useState(document);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, StudyUnit>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  useEffect(() => {
    setDocumentDraft(document);
    setUnitDrafts(Object.fromEntries(units.map((unit) => [unit.id, unit])));
    setSelectedKeys([]);
  }, [document, units]);

  const relatedRegulations = legalDocument?.documentType === 'act'
    ? data.legalDocuments.filter((entry) => entry.parentActId === documentId)
    : [];
  const parentAct = legalDocument?.parentActId
    ? data.documents.find((entry) => entry.id === legalDocument.parentActId)
    : undefined;
  const normalizedQuery = normalizeSearch(query);
  const visibleComponents = components.filter((component) => {
    const filterMatch = filter === 'all' || component.componentType === filter;
    return filterMatch && componentMatches(component, normalizedQuery);
  });
  const selectedComponents = components.filter((component) => selectedKeys.includes(component.sourceKey));
  const selectedTextLength = selectedComponents.reduce((sum, component) => sum + component.text.length, 0);

  if (!document || !documentDraft) {
    return <div className="text-sm text-slate-500">Document not found.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">{legalDocument?.officialTitle ?? document.title}</h2>
          <p className="text-sm text-slate-500">
            {legalDocument?.officialCitationDisplay ?? document.citation ?? document.kind} ·{' '}
            {legalDocument?.documentType ?? document.kind} · priority {document.priority}
          </p>
          {legalDocument ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
              <span>Consolidated to {legalDocument.consolidatedTo ?? 'not provided'}</span>
              <span>Fetched {legalDocument.fetchDate}</span>
              <span>Imported {legalDocument.importedAt}</span>
              <span>Package {legalDocument.packageId}</span>
              <a className="text-emerald-300 hover:text-emerald-200" href={legalDocument.sourceUrl} target="_blank" rel="noreferrer">
                Official source
              </a>
            </div>
          ) : null}
        </div>
        <button
          onClick={() => onSaveDocument(documentDraft)}
          className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Save Document
        </button>
      </div>

      {parentAct || relatedRegulations.length > 0 ? (
        <section className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          {parentAct ? (
            <button className="mr-2 text-emerald-300 hover:text-emerald-200" onClick={() => onSelectDocument(parentAct.id)}>
              Parent Act: {parentAct.title}
            </button>
          ) : null}
          {relatedRegulations.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <span className="text-slate-500">Related regulations:</span>
              {relatedRegulations.map((regulation) => (
                <button
                  key={regulation.id}
                  className="text-emerald-300 hover:text-emerald-200"
                  onClick={() => onSelectDocument(regulation.id)}
                >
                  {regulation.officialNumberDisplay ?? regulation.officialTitle}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <label className="text-xs uppercase tracking-wide text-slate-500">User-Authored Document Summary</label>
        <textarea
          value={documentDraft.summary}
          onChange={(event) => setDocumentDraft({ ...documentDraft, summary: event.target.value })}
          className="mt-2 min-h-28 w-full rounded border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100"
        />
      </section>

      {legalDocument ? (
        <section className="rounded border border-emerald-900 bg-slate-950 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search official text"
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
            {['all', 'section', 'schedule', 'form'].map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded px-3 py-2 text-xs ${filter === value ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                {value}
              </button>
            ))}
            <button
              onClick={() => setExpanded(Object.fromEntries(components.map((component) => [component.sourceKey, true])))}
              className="rounded bg-slate-800 px-3 py-2 text-xs text-slate-300"
            >
              Expand All
            </button>
            <button onClick={() => setExpanded({})} className="rounded bg-slate-800 px-3 py-2 text-xs text-slate-300">
              Collapse All
            </button>
            <span className="text-xs text-slate-500">{visibleComponents.length} results</span>
          </div>
          <div className="mb-3 rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
            Selected {selectedComponents.length} components · approximately {selectedTextLength.toLocaleString()} characters
            <button
              onClick={() => onCreateUnitFromSelection(document.id, selectedComponents)}
              disabled={selectedComponents.length === 0}
              className="ml-3 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-slate-700"
            >
              Create Study Unit from Selection
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[16rem_1fr]">
            <nav className="max-h-[70vh] overflow-auto rounded border border-slate-800 bg-slate-900 p-3 text-xs">
              {visibleComponents.slice(0, 300).map((component) => (
                <a key={component.sourceKey} href={`#${component.sourceKey}`} className="block py-1 text-slate-400 hover:text-emerald-300">
                  {component.label} {component.heading ?? ''}
                </a>
              ))}
            </nav>
            <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
              {visibleComponents.map((component) => {
                const isExpanded = expanded[component.sourceKey] ?? normalizedQuery.length > 0;
                const isSelected = selectedKeys.includes(component.sourceKey);
                const referenceOnly = component.extractionStatus === 'reference-only';
                return (
                  <article key={component.sourceKey} id={component.sourceKey} className="rounded border border-slate-800 bg-slate-900 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        onClick={() => setExpanded({ ...expanded, [component.sourceKey]: !isExpanded })}
                        className="text-left"
                      >
                        <div className="text-xs uppercase tracking-wide text-emerald-300">Official source text</div>
                        <h3 className="font-semibold text-white">
                          {highlight(component.label, normalizedQuery)} {component.heading ? highlight(component.heading, normalizedQuery) : null}
                        </h3>
                        <p className="text-xs text-slate-500">{component.componentType} · {component.sourceKey}</p>
                      </button>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => {
                            if (referenceOnly && event.target.checked && !window.confirm('This form is reference-only. Select it anyway?')) return;
                            setSelectedKeys((current) =>
                              event.target.checked
                                ? [...current, component.sourceKey].sort()
                                : current.filter((entry) => entry !== component.sourceKey),
                            );
                          }}
                        />
                        Select
                      </label>
                    </div>
                    {referenceOnly ? (
                      <div className="mt-3 rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">
                        The full prescribed form body was not present in the normalized source.
                      </div>
                    ) : null}
                    {isExpanded ? (
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{highlight(component.text, normalizedQuery)}</div>
                    ) : null}
                    {isExpanded && component.subsections?.length ? (
                      <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                        {component.subsections.map((subsection) => (
                          <div key={subsection.sourceKey} className="rounded bg-slate-950 p-3 text-xs text-slate-300">
                            <div className="font-semibold text-slate-100">{highlight(subsection.label, normalizedQuery)}</div>
                            <div className="mt-1 whitespace-pre-wrap">{highlight(subsection.text, normalizedQuery)}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
                        onClick={() => navigator.clipboard?.writeText(legalReference(document, component))}
                      >
                        Copy Reference
                      </button>
                      <button
                        className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
                        onClick={() => navigator.clipboard?.writeText(component.text)}
                      >
                        Copy Text
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

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
                  {unit.sourceReviewRequired || unit.sourceReferenceMissing ? (
                    <div className="mt-2 text-xs text-amber-300">
                      {unit.sourceReferenceMissing ? 'Source reference missing.' : 'Source review required.'}
                      <button onClick={() => onAcknowledgeSourceReview(unit.id)} className="ml-2 underline">
                        Acknowledge reviewed source
                      </button>
                    </div>
                  ) : null}
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
                      setUnitDrafts({ ...unitDrafts, [unit.id]: { ...draft, editableSummary: event.target.value } })
                    }
                    className="min-h-32 rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
                  />
                </label>
                <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
                  Reference Answer
                  <textarea
                    value={draft.referenceAnswer}
                    onChange={(event) =>
                      setUnitDrafts({ ...unitDrafts, [unit.id]: { ...draft, referenceAnswer: event.target.value } })
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
