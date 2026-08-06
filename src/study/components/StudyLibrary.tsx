import { useEffect, useMemo, useState } from 'react';
import {
  buildStudyLibrarySearchIndex,
  highlightLibraryMatch,
  searchStudyLibrary,
  type StudyLibrarySearchCategory,
  type StudyLibrarySearchResult,
} from '../studyLibrarySearch';
import type { StudyDataSnapshot, StudyPhase, StudyUnit } from '../studyTypes';

type StudyLibraryProps = {
  data: StudyDataSnapshot;
  onSelectDocument: (_documentId: string) => void;
  onCreateCustomUnit: () => void;
  onEditUnit: (_unitId: string) => void;
  onPreviewUnit: (_unitId: string) => void;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onDeleteUnit: (_unitId: string) => void;
  onDuplicateUnit: (_unitId: string) => void;
};

type LibraryTab = 'documents' | 'units';
type UnitFilter = 'all' | 'source-linked' | 'custom' | 'needs-review';
type UnitSort = 'related-source' | 'unit-title' | 'priority' | 'phase' | 'last-modified' | 'attempt-count';

const phaseLabels: Record<StudyPhase, string> = {
  unread: 'Unread',
  'guided-recall': 'Guided Recall',
  'free-recall': 'Free Recall',
  application: 'Application',
  maintenance: 'Maintenance',
};

const phaseOrder: Record<StudyPhase, number> = {
  unread: 0,
  'guided-recall': 1,
  'free-recall': 2,
  application: 3,
  maintenance: 4,
};

const unitSourceLabel = (unit: StudyUnit, data: StudyDataSnapshot): string => {
  const firstReference = unit.sourceReferences?.[0];
  const firstDocumentId = firstReference?.documentId ?? unit.documentIds[0];
  if (!firstDocumentId) return 'Custom / unlinked study units';
  const legal = data.legalDocuments.find((document) => document.id === firstDocumentId);
  const document = data.documents.find((entry) => entry.id === firstDocumentId);
  if (legal?.documentType === 'regulation' && legal.parentActId) {
    const parent = data.documents.find((entry) => entry.id === legal.parentActId);
    return `${parent?.title ?? legal.parentActId} / ${document?.title ?? legal.officialTitle}`;
  }
  return document?.title ?? legal?.officialTitle ?? firstDocumentId;
};

const unique = (values: string[]): string[] => values.filter((value, index) => values.indexOf(value) === index);

const searchCategoryLabels: Record<StudyLibrarySearchCategory, string> = {
  documents: 'Documents',
  'official-provisions': 'Official Provisions',
  'study-units': 'Study Units',
  'custom-units': 'Custom Units',
};

const searchCategoryOrder: StudyLibrarySearchCategory[] = ['documents', 'official-provisions', 'study-units', 'custom-units'];

const StudyLibrary = ({
  data,
  onSelectDocument,
  onCreateCustomUnit,
  onEditUnit,
  onPreviewUnit,
  onOpenProvision,
  onDeleteUnit,
  onDuplicateUnit,
}: StudyLibraryProps) => {
  const [tab, setTab] = useState<LibraryTab>('documents');
  const [documentFilter, setDocumentFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState<UnitFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<StudyPhase | 'all'>('all');
  const [unitSort, setUnitSort] = useState<UnitSort>('related-source');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  const legalById = useMemo(() => new Map(data.legalDocuments.map((document) => [document.id, document])), [data.legalDocuments]);
  const progressByUnitId = useMemo(() => new Map(data.progress.map((progress) => [progress.unitId, progress])), [data.progress]);
  const conceptsByUnitId = useMemo(() => {
    const map = new Map<string, number>();
    data.concepts.forEach((concept) => map.set(concept.unitId, (map.get(concept.unitId) ?? 0) + 1));
    return map;
  }, [data.concepts]);
  const promptsByUnitId = useMemo(() => {
    const map = new Map<string, number>();
    data.prompts.forEach((prompt) => map.set(prompt.unitId, (map.get(prompt.unitId) ?? 0) + 1));
    return map;
  }, [data.prompts]);
  const attemptsByUnitId = useMemo(() => {
    const map = new Map<string, number>();
    data.attempts.forEach((attempt) => map.set(attempt.unitId, (map.get(attempt.unitId) ?? 0) + 1));
    return map;
  }, [data.attempts]);
  const searchIndex = useMemo(() => buildStudyLibrarySearchIndex(data), [data]);
  const searchResults = useMemo(
    () => searchStudyLibrary(searchIndex, debouncedSearchQuery),
    [debouncedSearchQuery, searchIndex],
  );
  const searchResultsByCategory = useMemo(
    () =>
      searchCategoryOrder.map((category) => ({
        category,
        label: searchCategoryLabels[category],
        results: searchResults.filter((result) => result.category === category),
      })),
    [searchResults],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 120);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => setActiveSearchIndex(0), [debouncedSearchQuery]);

  const openSearchResult = (result: StudyLibrarySearchResult) => {
    if (result.category === 'documents' && result.documentId) onSelectDocument(result.documentId);
    if (result.category === 'official-provisions' && result.documentId && result.sourceKey) {
      onOpenProvision(result.documentId, result.sourceKey);
    }
    if ((result.category === 'study-units' || result.category === 'custom-units') && result.unitId) onEditUnit(result.unitId);
  };

  const renderHighlighted = (text: string) =>
    highlightLibraryMatch(text, debouncedSearchQuery).map((part, index) =>
      part.match ? <mark key={index} className="bg-amber-400/80 text-slate-950">{part.text}</mark> : <span key={index}>{part.text}</span>,
    );

  const filteredDocuments = data.documents.filter((document) => {
    const legal = legalById.get(document.id);
    if (documentFilter === 'all') return true;
    if (documentFilter === 'custom') return !legal;
    return legal?.documentType === documentFilter;
  });

  const filteredUnits = data.units
    .filter((unit) => {
      const sourceMatch =
        unitFilter === 'all' ||
        (unitFilter === 'source-linked' && unit.sourceMode !== 'custom') ||
        (unitFilter === 'custom' && unit.sourceMode === 'custom') ||
        (unitFilter === 'needs-review' && (unit.sourceReviewRequired || unit.sourceReferenceMissing));
      const phase = progressByUnitId.get(unit.id)?.phase ?? unit.phase ?? 'unread';
      return sourceMatch && (phaseFilter === 'all' || phase === phaseFilter);
    })
    .slice()
    .sort((left, right) => {
      if (unitSort === 'unit-title') return left.title.localeCompare(right.title);
      if (unitSort === 'priority') return left.priority - right.priority || left.title.localeCompare(right.title);
      if (unitSort === 'phase') {
        const leftPhase = progressByUnitId.get(left.id)?.phase ?? left.phase ?? 'unread';
        const rightPhase = progressByUnitId.get(right.id)?.phase ?? right.phase ?? 'unread';
        return phaseOrder[leftPhase] - phaseOrder[rightPhase] || left.title.localeCompare(right.title);
      }
      if (unitSort === 'last-modified') return right.updatedAt.localeCompare(left.updatedAt);
      if (unitSort === 'attempt-count') return (attemptsByUnitId.get(right.id) ?? 0) - (attemptsByUnitId.get(left.id) ?? 0);
      return unitSourceLabel(left, data).localeCompare(unitSourceLabel(right, data)) || left.title.localeCompare(right.title);
    });

  const groupedUnits = unique(filteredUnits.map((unit) => unitSourceLabel(unit, data))).map((label) => ({
    label,
    units: filteredUnits.filter((unit) => unitSourceLabel(unit, data) === label),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Library</h2>
          <p className="text-sm text-slate-500">Source documents and study units are managed separately.</p>
        </div>
        <button onClick={onCreateCustomUnit} className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
          New Custom Study Unit
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['documents', 'units'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded px-3 py-1.5 text-xs ${tab === value ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            {value === 'documents' ? 'Documents' : 'Study Units'}
          </button>
        ))}
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-3">
        <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
          Library Search
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveSearchIndex((index) => Math.min(index + 1, Math.max(searchResults.length - 1, 0)));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveSearchIndex((index) => Math.max(index - 1, 0));
              }
              if (event.key === 'Enter' && searchResults[activeSearchIndex]) {
                event.preventDefault();
                openSearchResult(searchResults[activeSearchIndex]);
              }
            }}
            placeholder="Search documents, provisions and study units"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
          />
        </label>
        {debouncedSearchQuery ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {searchResultsByCategory.map(({ category, label, results }) => (
              <section key={category} className="rounded border border-slate-800 bg-slate-950 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
                  <span className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-500">{results.length}</span>
                </div>
                {results.length ? (
                  <div className="space-y-2">
                    {results.map((result) => {
                      const flatIndex = searchResults.findIndex((entry) => entry.id === result.id);
                      return (
                        <button
                          key={result.id}
                          onClick={() => openSearchResult(result)}
                          className={`w-full rounded border p-3 text-left ${
                            activeSearchIndex === flatIndex ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-800 bg-slate-900'
                          }`}
                        >
                          <div className="text-sm font-medium text-slate-100">{renderHighlighted(result.title)}</div>
                          <div className="mt-1 text-xs text-slate-500">{result.subtitle}</div>
                          {result.matchText ? <div className="mt-2 text-xs text-slate-300">{renderHighlighted(result.matchText)}</div> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No results.</div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-xs text-slate-500">Enter a search term to find documents, official provisions, study units, and custom units.</div>
        )}
      </div>

      {tab === 'documents' ? (
        <>
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'All'],
              ['act', 'Acts'],
              ['regulation', 'Regulations'],
              ['custom', 'Custom Sources'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setDocumentFilter(value)}
                className={`rounded px-3 py-1.5 text-xs ${documentFilter === value ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredDocuments.map((document) => {
              const legal = legalById.get(document.id);
              const unitCount = data.units.filter((unit) => unit.documentIds.includes(document.id)).length;
              const reviewCount = data.units.filter(
                (unit) => unit.documentIds.includes(document.id) && (unit.sourceReviewRequired || unit.sourceReferenceMissing),
              ).length;
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
                      <p className="mt-1 text-sm text-slate-500">{document.summary || 'No local summary yet.'}</p>
                    </div>
                    <span className="rounded bg-slate-950 px-2 py-1 text-xs text-slate-400">P{document.priority}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{legal ? 'official' : 'custom source'}</span>
                    <span>{legal?.documentType ?? document.kind}</span>
                    {legal?.parentActId ? <span>parent {data.documents.find((entry) => entry.id === legal.parentActId)?.title ?? legal.parentActId}</span> : null}
                    <span>{document.category}</span>
                    <span>{legal?.consolidatedTo ?? 'no official date'}</span>
                    <span>{unitCount} units</span>
                    <span>{reviewCount} reviews</span>
                    {relatedForms ? <span>{relatedForms} reference-only forms</span> : null}
                  </div>
                </button>
              );
            })}
            {filteredDocuments.length === 0 ? <div className="text-sm text-slate-500">No documents match this filter.</div> : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {(['all', 'source-linked', 'custom', 'needs-review'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setUnitFilter(value)}
                className={`rounded px-3 py-1.5 text-xs ${unitFilter === value ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                {value}
              </button>
            ))}
            {(['all', 'unread', 'guided-recall', 'free-recall', 'application', 'maintenance'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setPhaseFilter(value)}
                className={`rounded px-3 py-1.5 text-xs ${phaseFilter === value ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                {value === 'all' ? 'All phases' : phaseLabels[value]}
              </button>
            ))}
            <select
              value={unitSort}
              onChange={(event) => setUnitSort(event.target.value as UnitSort)}
              className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100"
            >
              <option value="related-source">Related source</option>
              <option value="unit-title">Unit title</option>
              <option value="priority">Priority</option>
              <option value="phase">Phase</option>
              <option value="last-modified">Last modified</option>
              <option value="attempt-count">Attempt count</option>
            </select>
          </div>
          <div className="space-y-3">
            {groupedUnits.map((group) => {
              const collapsed = collapsedGroups.includes(group.label);
              return (
                <section key={group.label} className="rounded border border-slate-800 bg-slate-900">
                  <button
                    onClick={() =>
                      setCollapsedGroups((current) =>
                        current.includes(group.label) ? current.filter((entry) => entry !== group.label) : [...current, group.label],
                      )
                    }
                    className="flex w-full items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 text-left"
                  >
                    <span className="font-semibold text-slate-100">{group.label}</span>
                    <span className="text-xs text-slate-500">{group.units.length} units</span>
                  </button>
                  {!collapsed ? (
                    <div className="divide-y divide-slate-800">
                      {group.units.map((unit) => {
                        const phase = progressByUnitId.get(unit.id)?.phase ?? unit.phase ?? 'unread';
                        const relatedDocs = unit.documentIds
                          .map((documentId) => data.documents.find((document) => document.id === documentId)?.title ?? documentId)
                          .join(', ');
                        return (
                          <div key={unit.id} className="p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h3 className="font-semibold text-slate-100">{unit.title}</h3>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                                  <span>{unit.sourceMode === 'custom' ? 'custom' : 'source-linked'}</span>
                                  {relatedDocs ? <span>{relatedDocs}</span> : null}
                                  <span>{unit.sectionRefs.map((ref) => ref.label).join(', ') || 'no selected official sections'}</span>
                                  <span>P{unit.priority}</span>
                                  <span>{unit.category || 'uncategorized'}</span>
                                  <span>{phaseLabels[phase]}</span>
                                  <span>{conceptsByUnitId.get(unit.id) ?? 0} concepts</span>
                                  <span>{promptsByUnitId.get(unit.id) ?? 0} prompts</span>
                                  <span>{unit.sourceReviewRequired || unit.sourceReferenceMissing ? 'needs review' : 'source current'}</span>
                                  <span>modified {unit.updatedAt}</span>
                                  <span>{attemptsByUnitId.get(unit.id) ?? 0} attempts</span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button onClick={() => onEditUnit(unit.id)} className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white">
                                  Edit
                                </button>
                                <button onClick={() => onPreviewUnit(unit.id)} className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
                                  Preview
                                </button>
                                <button onClick={() => onDuplicateUnit(unit.id)} className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
                                  Duplicate
                                </button>
                                <button onClick={() => onDeleteUnit(unit.id)} className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {groupedUnits.length === 0 ? <div className="text-sm text-slate-500">No study units match this filter.</div> : null}
          </div>
        </>
      )}
    </div>
  );
};

export default StudyLibrary;
