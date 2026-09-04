import { useEffect, useMemo, useState } from 'react';
import { buildCompleteDocumentText, compareImportedLegalComponents, shouldShowLegalComponentInReader } from '../studyOfficialContent';
import {
  parseExamPrepLocatePickerSearch,
  postExamPrepLocatePick,
} from '../examPrep/examPrepLocatePicker';
import type { ImportedLegalComponent, StudyDataSnapshot, StudyDocument, StudyUnit } from '../studyTypes';

type StudyDocumentPageProps = {
  data: StudyDataSnapshot;
  documentId: string;
  onLoadLegalComponentsByDocument?: (_documentId: string) => Promise<ImportedLegalComponent[]>;
  onSaveDocument: (_document: StudyDocument) => Promise<void>;
  onSaveUnit: (_unit: StudyUnit) => Promise<void>;
  onCompleteReading: (_unitId: string) => Promise<void>;
  onCreateUnitFromSelection: (_documentId: string, _components: ImportedLegalComponent[]) => Promise<void>;
  onGenerateMissingStudyContent: (_unitId: string) => Promise<void>;
  onAcknowledgeSourceReview: (_unitId: string) => Promise<StudyUnit | void>;
  onSelectDocument: (_documentId: string) => void;
  onNavigate: (_path: string) => void;
  onPreviewUnit: (_unitId: string) => void;
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
  onLoadLegalComponentsByDocument,
  onSaveDocument,
  onSaveUnit,
  onCompleteReading,
  onCreateUnitFromSelection,
  onGenerateMissingStudyContent,
  onAcknowledgeSourceReview,
  onSelectDocument,
  onNavigate,
  onPreviewUnit,
}: StudyDocumentPageProps) => {
  const document = data.documents.find((entry) => entry.id === documentId);
  const legalDocument = data.legalDocuments.find((entry) => entry.id === documentId);
  const [components, setComponents] = useState<ImportedLegalComponent[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(Boolean(legalDocument));
  const units = useMemo(() => data.units.filter((unit) => unit.documentIds.includes(documentId)), [data.units, documentId]);
  const [documentDraft, setDocumentDraft] = useState(document);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, StudyUnit>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [focusedSourceKey, setFocusedSourceKey] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState<{
    sourceKey: string;
    parentSourceKey: string;
  } | null>(null);
  // Ephemeral Locate picker context from the URL query (present only when this
  // tab was opened from an active Locate sprint).
  const pickerContext = useMemo(
    () => parseExamPrepLocatePickerSearch(window.location.search),
    [],
  );
  const [pickerSent, setPickerSent] = useState<{
    label: string;
    posted: boolean;
  } | null>(null);

  const sendPickerPick = (sourceKey: string, label: string): void => {
    if (!pickerContext) return;
    const posted = postExamPrepLocatePick(pickerContext.token, documentId, sourceKey);
    setPickerSent({ label, posted });
  };

  useEffect(() => {
    setDocumentDraft(document);
    setUnitDrafts(Object.fromEntries(units.map((unit) => [unit.id, unit])));
    setSelectedKeys([]);
  }, [document, units]);

  useEffect(() => {
    let cancelled = false;
    setComponents([]);
    if (!legalDocument) {
      setComponentsLoading(false);
      return;
    }
    setComponentsLoading(true);
    const loadComponents =
      onLoadLegalComponentsByDocument ??
      (async (id: string) => data.legalComponents.filter((component) => component.documentId === id));
    loadComponents(documentId)
      .then((records: ImportedLegalComponent[]) => {
        if (!cancelled) setComponents(records.slice().sort(compareImportedLegalComponents));
      })
      .finally(() => {
        if (!cancelled) setComponentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.legalComponents, documentId, legalDocument, onLoadLegalComponentsByDocument]);

  const relatedRegulations = legalDocument?.documentType === 'act' ? data.legalDocuments.filter((entry) => entry.parentActId === documentId) : [];
  const parentAct = legalDocument?.parentActId ? data.documents.find((entry) => entry.id === legalDocument.parentActId) : undefined;
  const normalizedQuery = normalizeSearch(query);
  const readerComponents = useMemo(() => components.filter(shouldShowLegalComponentInReader), [components]);

  const navigateToSourceKey = (sourceKey: string, parentSourceKey = sourceKey) => {
    setExpanded((current) => ({ ...current, [parentSourceKey]: true }));
    setFocusedSourceKey(sourceKey);
    window.history.replaceState(window.history.state, '', `#${encodeURIComponent(sourceKey)}`);
    setPendingNavigation({ sourceKey, parentSourceKey });
    window.setTimeout(() => setFocusedSourceKey((current) => (current === sourceKey ? '' : current)), 1400);
  };

  useEffect(() => {
    if (!pendingNavigation) return;
    const startedAt = performance.now();
    const frame = window.requestAnimationFrame(() => {
      const target = globalThis.document.getElementById(pendingNavigation.sourceKey);
      if (!target) return;
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
      const heading = globalThis.document.getElementById(`${pendingNavigation.sourceKey}-heading`);
      if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
      if (import.meta.env.DEV) {
        console.debug('Study document navigation', {
          sourceKey: pendingNavigation.sourceKey,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      }
      setPendingNavigation(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingNavigation, expanded]);

  useEffect(() => {
    const sourceKey = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!sourceKey || readerComponents.length === 0) return;
    const parent = readerComponents.find(
      (component) => component.sourceKey === sourceKey || component.subsections?.some((subsection) => subsection.sourceKey === sourceKey),
    );
    if (parent) navigateToSourceKey(sourceKey, parent.sourceKey);
  }, [readerComponents]);
  const completeDocumentText = useMemo(() => buildCompleteDocumentText(components), [components]);
  const completeDocumentMatches =
    filter === 'all' && (!normalizedQuery || completeDocumentText.toLowerCase().includes(normalizedQuery) || 'complete document'.includes(normalizedQuery));
  const visibleComponents = readerComponents.filter((component) => {
    const filterMatch = filter === 'all' || component.componentType === filter;
    return filterMatch && componentMatches(component, normalizedQuery);
  });
  const selectedComponents = readerComponents.filter((component) => selectedKeys.includes(component.sourceKey));
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
            {legalDocument?.officialCitationDisplay ?? document.citation ?? document.kind} · {legalDocument?.documentType ?? document.kind} · priority{' '}
            {document.priority}
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
        <button onClick={() => onSaveDocument(documentDraft)} className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
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
                <button key={regulation.id} className="text-emerald-300 hover:text-emerald-200" onClick={() => onSelectDocument(regulation.id)}>
                  {regulation.officialNumberDisplay ?? regulation.officialTitle}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {pickerContext ? (
        <section className="rounded border border-sky-700 bg-sky-950/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">
                Locate picker
              </p>
              <p className="mt-1 text-sm text-sky-100">{pickerContext.prompt}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                Choose{' '}
                <span className="font-semibold text-sky-200">Select this provision</span> next to
                the exact provision (including inside subsections). The expected location stays
                hidden — your Locate sprint checks the selection automatically.
              </p>
            </div>
            {pickerSent ? (
              <span
                className={`rounded border px-2 py-1 text-xs font-semibold ${
                  pickerSent.posted
                    ? 'border-emerald-700 bg-emerald-900/60 text-emerald-200'
                    : 'border-amber-700 bg-amber-900/60 text-amber-200'
                }`}
              >
                {pickerSent.posted
                  ? `Sent: ${pickerSent.label} — you can close this tab.`
                  : 'Your Locate sprint tab could not be reached (it may have been closed).'}
              </span>
            ) : null}
          </div>
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
          {componentsLoading ? (
            <div className="mb-3 text-xs text-slate-500">Loading official document text...</div>
          ) : null}
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
            <span className="text-xs text-slate-500">{visibleComponents.length + (completeDocumentMatches ? 1 : 0)} results</span>
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
              {filter === 'all' ? (
                <button
                  onClick={() => navigateToSourceKey('complete-document')}
                  className="mb-2 block w-full border-b border-slate-800 pb-2 text-left text-emerald-300 hover:text-emerald-200"
                >
                  Complete document
                </button>
              ) : null}
              {visibleComponents.slice(0, 300).map((component) => (
                <div key={component.sourceKey}>
                  <button
                    onClick={() => navigateToSourceKey(component.sourceKey)}
                    className="block w-full py-1 text-left text-slate-400 hover:text-emerald-300"
                  >
                    {component.label} {component.heading ?? ''}
                  </button>
                  {component.subsections?.map((subsection) => (
                    <button
                      key={subsection.sourceKey}
                      onClick={() => navigateToSourceKey(subsection.sourceKey, component.sourceKey)}
                      className="block w-full py-0.5 pl-3 text-left text-slate-500 hover:text-emerald-300"
                    >
                      {subsection.label}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <div className="max-h-[70vh] space-y-3 overflow-auto pr-1">
              {completeDocumentMatches ? (
                <article
                  id="complete-document"
                  className={`rounded border bg-slate-900 p-4 ${focusedSourceKey === 'complete-document' ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-emerald-900'}`}
                >
                  <div className="text-xs uppercase tracking-wide text-emerald-300">Official source text</div>
                  <h3 id="complete-document-heading" tabIndex={-1} className="font-semibold text-white">
                    Complete document
                  </h3>
                  <p className="text-xs text-slate-500">Combined reader text, with reference-only form stubs omitted.</p>
                  <div className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-200">
                    {highlight(completeDocumentText, normalizedQuery)}
                  </div>
                  <button
                    className="mt-3 rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
                    onClick={() => navigator.clipboard?.writeText(completeDocumentText)}
                  >
                    Copy Complete Text
                  </button>
                </article>
              ) : null}
              {visibleComponents.map((component) => {
                const isExpanded = expanded[component.sourceKey] ?? normalizedQuery.length > 0;
                const isSelected = selectedKeys.includes(component.sourceKey);
                const referenceOnly = component.extractionStatus === 'reference-only';
                return (
                  <article
                    key={component.sourceKey}
                    id={component.sourceKey}
                    className={`rounded border bg-slate-900 p-4 ${focusedSourceKey === component.sourceKey ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-slate-800'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button onClick={() => setExpanded({ ...expanded, [component.sourceKey]: !isExpanded })} className="text-left">
                        <div className="text-xs uppercase tracking-wide text-emerald-300">Official source text</div>
                        <h3 id={`${component.sourceKey}-heading`} tabIndex={-1} className="font-semibold text-white">
                          {highlight(component.label, normalizedQuery)} {component.heading ? highlight(component.heading, normalizedQuery) : null}
                        </h3>
                        <p className="text-xs text-slate-500">
                          {component.componentType} · {component.sourceKey}
                        </p>
                      </button>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => {
                            if (referenceOnly && event.target.checked && !window.confirm('This form is reference-only. Select it anyway?')) return;
                            setSelectedKeys((current) =>
                              event.target.checked ? [...current, component.sourceKey].sort() : current.filter((entry) => entry !== component.sourceKey),
                            );
                          }}
                        />
                        Select
                      </label>
                      {pickerContext ? (
                        <button
                          type="button"
                          onClick={() =>
                            sendPickerPick(
                              component.sourceKey,
                              `${component.label}${component.heading ? ` ${component.heading}` : ''}`,
                            )
                          }
                          className="rounded border border-sky-600 bg-sky-900 px-2 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-800"
                        >
                          Select this provision
                        </button>
                      ) : null}
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
                          <div
                            key={subsection.sourceKey}
                            id={subsection.sourceKey}
                            className={`rounded p-3 text-xs text-slate-300 ${focusedSourceKey === subsection.sourceKey ? 'bg-amber-950/40 ring-2 ring-amber-400/40' : 'bg-slate-950'}`}
                          >
                            <div id={`${subsection.sourceKey}-heading`} tabIndex={-1} className="font-semibold text-slate-100">
                              {highlight(subsection.label, normalizedQuery)}
                            </div>
                            <div className="mt-1 whitespace-pre-wrap">{highlight(subsection.text, normalizedQuery)}</div>
                            {pickerContext ? (
                              <button
                                type="button"
                                onClick={() => sendPickerPick(subsection.sourceKey, subsection.label)}
                                className="mt-2 rounded border border-sky-600 bg-sky-900 px-2 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-800"
                              >
                                Select this provision
                              </button>
                            ) : null}
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
                      <button className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300" onClick={() => navigator.clipboard?.writeText(component.text)}>
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
                    onClick={() => onNavigate(`/study/unit/${encodeURIComponent(unit.id)}/edit`)}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onPreviewUnit(unit.id)}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Preview
                  </button>
                  {unit.sourceReferences?.length ? (
                    <button
                      onClick={() => onGenerateMissingStudyContent(unit.id)}
                      className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Generate Missing Study Content
                    </button>
                  ) : null}
                  <button
                    onClick={() => onCompleteReading(unit.id)}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Reading Done
                  </button>
                  <button onClick={() => onSaveUnit(draft)} className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white hover:bg-slate-600">
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
