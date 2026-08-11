import { useMemo, useState } from 'react';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateReferenceAnswer,
  generateRequiredConcepts,
  generateSourceCitationSummary,
  generateStudyQuestion,
  generateStudyTitle,
  type ReferenceAnswerOptions,
} from '../studyDraftGeneration';
import { normalizeConceptLabelKey } from '../studyConceptGeneration';
import { summarizeStudyScheduling } from '../studySchedulingDisplay';
import type {
  ImportedLegalComponent,
  StudyConcept,
  StudyDataSnapshot,
  StudyGeneratedContentState,
  StudyPhase,
  StudyPrompt,
  StudyPromptKind,
  StudyResponseMode,
  StudyRubricItem,
  StudyReferenceAnswerFormat,
  StudyUnit,
  StudyUnitType,
} from '../studyTypes';
import StudyRubricEditor from './StudyRubricEditor';

type StudyUnitEditorPageProps = {
  data: StudyDataSnapshot;
  unitId: string;
  onSave: (_draft: { unit: StudyUnit; prompt: StudyPrompt; concepts: StudyConcept[]; rubrics: StudyRubricItem[] }) => Promise<void>;
  onAcknowledgeSourceReview?: (_unitId: string) => Promise<StudyUnit | void>;
  onNavigate: (_path: string) => void;
};

const emptyGeneratedState = (): StudyGeneratedContentState => ({
  title: 'empty',
  question: 'empty',
  referenceAnswer: 'empty',
  editableSummary: 'empty',
  concepts: 'empty',
  rubrics: 'empty',
});

const sourceRecordKey = (component: Pick<ImportedLegalComponent, 'documentId' | 'sourceKey'>): string => `${component.documentId}::${component.sourceKey}`;

const fieldCanOverwrite = (state: StudyGeneratedContentState, field: keyof StudyGeneratedContentState): boolean =>
  state[field] !== 'user-edited' || window.confirm(`Overwrite the edited ${field} field?`);

const nextStateAfterEdit = (
  state: StudyGeneratedContentState,
  field: keyof StudyGeneratedContentState,
  value: string | StudyConcept[],
): StudyGeneratedContentState => ({
  ...state,
  [field]: Array.isArray(value) ? (value.length > 0 ? 'user-edited' : 'empty') : value.trim() ? 'user-edited' : 'empty',
});

const formatLabel = (format: StudyReferenceAnswerFormat): string => {
  if (format === 'structured-exact') return 'Structured exact wording';
  if (format === 'complete-exact-text') return 'Complete exact source text';
  return 'Empty';
};

const normalizeConceptLabel = (value: string): string => value.replace(/\s+/g, ' ').trim();

const orderedConcepts = (concepts: StudyConcept[]): StudyConcept[] =>
  concepts.slice().sort((left, right) => left.order - right.order || left.label.localeCompare(right.label) || left.id.localeCompare(right.id));

const conceptRowsWithOrder = (concepts: StudyConcept[]): StudyConcept[] => concepts.map((concept, index) => ({ ...concept, order: index }));

const orderedRubrics = (rubrics: StudyRubricItem[]): StudyRubricItem[] =>
  rubrics.slice().sort((left, right) => left.order - right.order || left.prompt.localeCompare(right.prompt) || left.id.localeCompare(right.id));

const rubricRowsWithOrder = (rubrics: StudyRubricItem[]): StudyRubricItem[] => rubrics.map((rubric, index) => ({ ...rubric, order: index }));

const phaseOptions: StudyPhase[] = ['unread', 'guided-recall', 'free-recall', 'application', 'maintenance'];
const promptOptions: StudyPromptKind[] = ['guided-recall', 'free-recall', 'identification', 'scenario', 'comparison'];
const responseModeOptions: Array<StudyResponseMode | ''> = ['', 'guided', 'free-recall', 'hybrid'];
const unitTypeOptions: StudyUnitType[] = ['section', 'whole-act', 'survey-law-case', 'custom-principle', 'custom'];

const StudyUnitEditorPage = ({ data, unitId, onSave, onAcknowledgeSourceReview, onNavigate }: StudyUnitEditorPageProps) => {
  const unit = data.units.find((entry) => entry.id === unitId);
  const initialPrompt =
    data.prompts.find((entry) => entry.unitId === unitId && entry.kind === (unit?.promptKind ?? 'guided-recall')) ??
    data.prompts.find((entry) => entry.unitId === unitId && entry.kind === 'guided-recall') ??
    data.prompts.find((entry) => entry.unitId === unitId);
  const initialConcepts = orderedConcepts(data.concepts.filter((concept) => concept.unitId === unitId));
  const initialRubrics = orderedRubrics(data.rubrics.filter((rubric) => rubric.unitId === unitId));
  const selectedKeys = new Set(unit?.sourceReferences?.map((reference) => `${reference.documentId}::${reference.sourceKey}`) ?? []);
  const sourceComponents = data.legalComponents.filter((component) => selectedKeys.has(sourceRecordKey(component)));
  const progress = data.progress.find((entry) => entry.unitId === unitId);
  const schedulingSummary = unit ? summarizeStudyScheduling({ unit, progress, now: new Date() }) : null;
  const legalDocument = unit?.documentIds[0] ? data.legalDocuments.find((document) => document.id === unit.documentIds[0]) : undefined;
  const studyDocument = unit?.documentIds[0] ? data.documents.find((document) => document.id === unit.documentIds[0]) : undefined;
  const returnTo =
    typeof window.history.state?.returnTo === 'string'
      ? window.history.state.returnTo
      : studyDocument
        ? `/study/document/${encodeURIComponent(studyDocument.id)}`
        : '/study/library';

  const [unitDraft, setUnitDraft] = useState(unit);
  const [promptDraft, setPromptDraft] = useState(initialPrompt);
  const [conceptDrafts, setConceptDrafts] = useState(initialConcepts);
  const [rubricDrafts, setRubricDrafts] = useState(initialRubrics);
  const [generatedState, setGeneratedState] = useState(unit?.generatedContentState ?? emptyGeneratedState());
  const [options, setOptions] = useState<ReferenceAnswerOptions>(DEFAULT_REFERENCE_ANSWER_OPTIONS);
  const [selectedSuggestionKeys, setSelectedSuggestionKeys] = useState<string[]>([]);
  const [conceptMessage, setConceptMessage] = useState('');
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const suggestions = useMemo(
    () => generateRequiredConcepts({ document: legalDocument, selectedSources: sourceComponents }),
    [legalDocument, sourceComponents],
  );

  if (!unit || !unitDraft || !promptDraft) {
    return <div className="text-sm text-slate-500">Study unit not found.</div>;
  }

  const isCustom = unitDraft.sourceMode === 'custom';
  const documentTitle = legalDocument?.officialTitle ?? studyDocument?.title ?? 'Custom study unit';
  const existingConceptKeys = new Set(conceptDrafts.map((concept) => normalizeConceptLabelKey(concept.label)));
  const missingSuggestions = suggestions.filter((suggestion) => !existingConceptKeys.has(normalizeConceptLabelKey(suggestion.label)));
  const checkedSuggestionKeys = selectedSuggestionKeys.length
    ? selectedSuggestionKeys
    : missingSuggestions.map((suggestion) => normalizeConceptLabelKey(suggestion.label));

  const setConcepts = (concepts: StudyConcept[]) => {
    const next = conceptRowsWithOrder(concepts);
    setConceptDrafts(next);
    setPromptDraft({ ...promptDraft, conceptIds: next.map((concept) => concept.id) });
    setGeneratedState(nextStateAfterEdit(generatedState, 'concepts', next));
  };

  const addConcept = (label = '') => {
    const nowIso = new Date().toISOString();
    setConcepts([
      ...conceptDrafts,
      {
        id: `${unit.id}-concept-manual-${Date.now().toString(36)}-${conceptDrafts.length + 1}`,
        unitId: unit.id,
        label,
        required: true,
        origin: 'manual',
        order: conceptDrafts.length,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);
  };

  const updateConceptLabel = (index: number, label: string) => {
    const normalized = normalizeConceptLabel(label);
    const duplicate =
      normalized &&
      conceptDrafts.some((concept, entryIndex) => entryIndex !== index && normalizeConceptLabelKey(concept.label) === normalizeConceptLabelKey(normalized));
    if (duplicate) {
      setConceptMessage('Duplicate concept ignored.');
      return;
    }
    setConcepts(conceptDrafts.map((concept, entryIndex) => (entryIndex === index ? { ...concept, label } : concept)));
    setConceptMessage('');
  };

  const removeConcept = (index: number) => setConcepts(conceptDrafts.filter((_, entryIndex) => entryIndex !== index));

  const moveConcept = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= conceptDrafts.length) return;
    const next = conceptDrafts.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setConcepts(next);
  };

  const addSelectedSuggestions = () => {
    const keysToAdd = new Set(checkedSuggestionKeys);
    const nowIso = new Date().toISOString();
    const nextSuggestions = missingSuggestions.filter((suggestion) => keysToAdd.has(normalizeConceptLabelKey(suggestion.label)));
    if (nextSuggestions.length === 0) {
      setConceptMessage(suggestions.length === 0 ? 'No suggestions were found for these sources.' : 'No new suggestions to add.');
      return;
    }
    const next = [
      ...conceptDrafts,
      ...nextSuggestions.map(
        (suggestion, index): StudyConcept => ({
          id: `${unit.id}-concept-generated-${Date.now().toString(36)}-${index + 1}`,
          unitId: unit.id,
          label: suggestion.label,
          required: true,
          origin: 'generated',
          order: conceptDrafts.length + index,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      ),
    ];
    setConcepts(next);
    setConceptMessage(`Added ${nextSuggestions.length} suggested concepts.`);
    setSelectedSuggestionKeys([]);
  };

  const replaceSuggestedConcepts = (replaceManual: boolean) => {
    if (!window.confirm(replaceManual ? 'Replace all concepts with selected suggestions?' : 'Replace generated concepts with selected suggestions?')) return;
    const keysToAdd = new Set(checkedSuggestionKeys);
    const nowIso = new Date().toISOString();
    const retained = replaceManual ? [] : conceptDrafts.filter((concept) => concept.origin === 'manual');
    const selected = suggestions.filter((suggestion) => keysToAdd.has(normalizeConceptLabelKey(suggestion.label)));
    const next = [
      ...retained,
      ...selected.map(
        (suggestion, index): StudyConcept => ({
          id: `${unit.id}-concept-generated-${Date.now().toString(36)}-${index + 1}`,
          unitId: unit.id,
          label: suggestion.label,
          required: true,
          origin: 'generated',
          order: retained.length + index,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      ),
    ];
    setConcepts(next);
    setConceptMessage(`Replaced ${replaceManual ? 'all' : 'generated'} concepts with ${selected.length} suggestions.`);
  };

  const regenerateQuestion = () => {
    if (!fieldCanOverwrite(generatedState, 'question')) return;
    const question = isCustom
      ? promptDraft.question
      : generateStudyQuestion({
          documentTitle,
          selectedSources: sourceComponents,
          rubricCategories: rubricDrafts.map((rubric) => rubric.category),
        }).question;
    setPromptDraft({ ...promptDraft, question });
    setGeneratedState({ ...generatedState, question: question ? 'generated' : 'empty' });
  };

  const regenerateTitle = () => {
    if (isCustom || !fieldCanOverwrite(generatedState, 'title')) return;
    const title = generateStudyTitle({ documentTitle, selectedSources: sourceComponents });
    setUnitDraft({ ...unitDraft, title });
    setGeneratedState({ ...generatedState, title: title ? 'generated' : 'empty' });
  };

  const regenerateReferenceAnswer = (nextOptions = options) => {
    if (!legalDocument || !fieldCanOverwrite(generatedState, 'referenceAnswer')) return;
    const answer = generateReferenceAnswer({
      document: legalDocument,
      selectedSources: sourceComponents,
      options: nextOptions,
    }).text;
    setUnitDraft({ ...unitDraft, referenceAnswer: answer });
    setPromptDraft({ ...promptDraft, referenceAnswer: answer });
    setGeneratedState({ ...generatedState, referenceAnswer: answer ? 'generated' : 'empty' });
  };

  const setFormat = (format: StudyReferenceAnswerFormat) => {
    const nextOptions = { ...options, format };
    setOptions(nextOptions);
    regenerateReferenceAnswer(nextOptions);
  };

  const save = async () => {
    const cleanedConcepts = conceptRowsWithOrder(
      conceptDrafts
        .map((concept) => ({ ...concept, label: normalizeConceptLabel(concept.label) }))
        .filter(
          (concept, index, all) =>
            concept.label && all.findIndex((entry) => normalizeConceptLabelKey(entry.label) === normalizeConceptLabelKey(concept.label)) === index,
        ),
    );
    await onSave({
      unit: {
        ...unitDraft,
        sourceCitationSummary: legalDocument
          ? generateSourceCitationSummary({
              document: legalDocument,
              selectedSources: sourceComponents,
            })
          : unitDraft.sourceCitationSummary,
        sourceReferences: isCustom ? [] : unitDraft.sourceReferences,
        documentIds: isCustom ? [] : unitDraft.documentIds,
        sectionRefs: isCustom ? [] : unitDraft.sectionRefs,
        generatedContentState: generatedState,
      },
      prompt: {
        ...promptDraft,
        referenceAnswer: unitDraft.referenceAnswer,
        conceptIds: cleanedConcepts.map((concept) => concept.id),
      },
      concepts: cleanedConcepts,
      rubrics: rubricRowsWithOrder(
        rubricDrafts
          .map((rubric) => ({
            ...rubric,
            prompt: rubric.prompt.trim(),
            referenceAnswer: rubric.referenceAnswer.trim(),
          }))
          .filter((rubric) => rubric.prompt),
      ),
    });
    onNavigate(returnTo);
  };

  const acknowledgeSourceReview = async () => {
    const updated = await onAcknowledgeSourceReview?.(unit.id);
    if (updated) setUnitDraft(updated);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.95fr)_minmax(24rem,1.05fr)]">
      {!isCustom ? (
        <section className="max-h-[78vh] overflow-auto rounded border border-emerald-900 bg-slate-950 p-4">
          <div className="text-xs uppercase tracking-wide text-emerald-300">Selected official source text</div>
          <h2 className="mt-1 text-lg font-semibold text-white">{documentTitle}</h2>
          <div className="mt-2 whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
            {unitDraft.sourceCitationSummary?.text ?? 'No citation summary available.'}
          </div>
          {unitDraft.sourceReviewRequired || unitDraft.sourceReferenceMissing ? (
            <div className="mt-3 rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">
              {unitDraft.sourceReferenceMissing ? 'One or more source references are missing.' : 'Source review is required.'}
              {onAcknowledgeSourceReview ? (
                <button onClick={acknowledgeSourceReview} className="ml-2 underline">
                  Acknowledge reviewed source
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 space-y-4">
            {sourceComponents.map((component) => (
              <article key={sourceRecordKey(component)}>
                <h3 className="font-semibold text-slate-100">
                  {component.label} {component.heading ?? ''}
                </h3>
                <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{component.text}</pre>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded border border-slate-800 bg-slate-950 p-4">
          <div className="text-xs uppercase tracking-wide text-emerald-300">Custom study unit</div>
          <h2 className="mt-1 text-lg font-semibold text-white">{unitDraft.title || 'Untitled custom study unit'}</h2>
          <p className="mt-2 text-sm text-slate-500">This unit is not linked to an official legal source.</p>
          <label className="mt-4 grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Optional notes or citation text
            <textarea
              value={unitDraft.notesCitationText ?? ''}
              onChange={(event) => setUnitDraft({ ...unitDraft, notesCitationText: event.target.value })}
              className="min-h-32 rounded border border-slate-700 bg-slate-900 p-3 text-sm normal-case tracking-normal text-slate-100"
            />
          </label>
          <label className="mt-4 grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Optional custom source URL
            <input
              value={unitDraft.customSourceUrl ?? ''}
              onChange={(event) => setUnitDraft({ ...unitDraft, customSourceUrl: event.target.value })}
              className="rounded border border-slate-700 bg-slate-900 p-3 text-sm normal-case tracking-normal text-slate-100"
            />
          </label>
        </section>
      )}

      <section className="space-y-4 rounded border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Study Unit Editor</h2>
          <div className="flex gap-2">
            <button onClick={() => onNavigate(returnTo)} className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300">
              Cancel
            </button>
            <button onClick={save} className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
              Save
            </button>
          </div>
        </div>
        {!isCustom ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={regenerateTitle} className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white">
              Regenerate title
            </button>
            <button onClick={regenerateQuestion} className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white">
              Regenerate question
            </button>
            <button onClick={() => regenerateReferenceAnswer()} className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white">
              Regenerate reference answer
            </button>
          </div>
        ) : null}
        {schedulingSummary ? (
          <section className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-wide text-slate-500">Scheduling</div>
              <span className="rounded bg-slate-900 px-2 py-1 text-xs text-emerald-300">{schedulingSummary.label}</span>
            </div>
            <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              <div>
                <span className="text-slate-500">State: </span>
                {schedulingSummary.stateLabel}
              </div>
              <div>
                <span className="text-slate-500">Due: </span>
                {schedulingSummary.dueLabel}
              </div>
              <div>
                <span className="text-slate-500">Last reviewed: </span>
                {schedulingSummary.lastReviewedLabel}
              </div>
              <div>
                <span className="text-slate-500">Reviews: </span>
                {schedulingSummary.reviews ?? 0}
              </div>
              <div>
                <span className="text-slate-500">Lapses: </span>
                {schedulingSummary.lapses ?? 0}
              </div>
            </div>
            <details className="mt-3 text-xs text-slate-400">
              <summary className="cursor-pointer text-slate-500">Advanced scheduling values</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>Due ISO: {schedulingSummary.dueAt ?? 'not scheduled'}</div>
                <div>Stability: {schedulingSummary.stability?.toFixed(3) ?? 'n/a'}</div>
                <div>Difficulty: {schedulingSummary.difficulty?.toFixed(3) ?? 'n/a'}</div>
              </div>
            </details>
          </section>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Priority
            <select
              value={unitDraft.priority}
              onChange={(event) =>
                setUnitDraft({
                  ...unitDraft,
                  priority: Number(event.target.value) as StudyUnit['priority'],
                })
              }
              className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            >
              {[1, 2, 3, 4, 5].map((priority) => (
                <option key={priority} value={priority}>
                  P{priority}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Learning phase
            <select
              value={unitDraft.phase ?? data.progress.find((progress) => progress.unitId === unit.id)?.phase ?? 'unread'}
              onChange={(event) => setUnitDraft({ ...unitDraft, phase: event.target.value as StudyPhase })}
              className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            >
              {phaseOptions.map((phase) => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Unit type
            <select
              value={unitDraft.unitType ?? 'section'}
              onChange={(event) => setUnitDraft({ ...unitDraft, unitType: event.target.value as StudyUnitType })}
              className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            >
              {unitTypeOptions.map((unitType) => (
                <option key={unitType} value={unitType}>
                  {unitType}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Response mode override
            <select
              value={unitDraft.responseModeOverride ?? ''}
              onChange={(event) =>
                setUnitDraft({
                  ...unitDraft,
                  responseModeOverride: (event.target.value || undefined) as StudyResponseMode | undefined,
                })
              }
              className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            >
              {responseModeOptions.map((mode) => (
                <option key={mode || 'default'} value={mode}>
                  {mode || 'phase default'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
          Title ({generatedState.title})
          <input
            value={unitDraft.title}
            onChange={(event) => {
              setUnitDraft({ ...unitDraft, title: event.target.value });
              setGeneratedState(nextStateAfterEdit(generatedState, 'title', event.target.value));
            }}
            className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Category
            <input
              value={unitDraft.category}
              onChange={(event) => setUnitDraft({ ...unitDraft, category: event.target.value })}
              className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            />
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Tags
            <input
              value={(unitDraft.tags ?? []).join(', ')}
              onChange={(event) =>
                setUnitDraft({
                  ...unitDraft,
                  tags: event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
              className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Prompt type
            <select
              value={promptDraft.kind}
              onChange={(event) => {
                const kind = event.target.value as StudyPromptKind;
                setPromptDraft({ ...promptDraft, kind });
                setUnitDraft({ ...unitDraft, promptKind: kind });
              }}
              className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            >
              {promptOptions.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Recall question ({generatedState.question})
            <textarea
              value={promptDraft.question}
              onChange={(event) => {
                setPromptDraft({ ...promptDraft, question: event.target.value });
                setGeneratedState(nextStateAfterEdit(generatedState, 'question', event.target.value));
              }}
              className="min-h-20 rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            />
          </label>
        </div>
        <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
          Study summary ({generatedState.editableSummary})
          <textarea
            value={unitDraft.editableSummary}
            onChange={(event) => {
              setUnitDraft({ ...unitDraft, editableSummary: event.target.value });
              setGeneratedState(nextStateAfterEdit(generatedState, 'editableSummary', event.target.value));
            }}
            className="min-h-24 rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
          />
        </label>
        <div className="rounded border border-slate-800 bg-slate-950 p-3">
          {!isCustom ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {(['structured-exact', 'complete-exact-text', 'empty'] as const).map((format) => (
                  <button
                    key={format}
                    onClick={() => setFormat(format)}
                    className={`rounded px-3 py-1.5 text-xs ${options.format === format ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'}`}
                  >
                    {formatLabel(format)}
                  </button>
                ))}
              </div>
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                {[
                  ['includeAmendmentHistory', 'Include amendment history'],
                  ['includeConsolidationNotes', 'Include consolidation notes'],
                  ['includeRepealedProvisions', 'Include repealed provisions'],
                  ['includeSectionHeadings', 'Include section headings'],
                  ['includeSourceCitationAfterEachSection', 'Include source citation after each section'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(options[key as keyof ReferenceAnswerOptions])}
                      onChange={(event) => setOptions({ ...options, [key]: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </>
          ) : null}
          <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
            Reference answer ({generatedState.referenceAnswer})
            <textarea
              value={unitDraft.referenceAnswer}
              onChange={(event) => {
                setUnitDraft({ ...unitDraft, referenceAnswer: event.target.value });
                setPromptDraft({ ...promptDraft, referenceAnswer: event.target.value });
                setGeneratedState(nextStateAfterEdit(generatedState, 'referenceAnswer', event.target.value));
              }}
              className="min-h-56 rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
            />
          </label>
        </div>
        <StudyRubricEditor
          unitId={unit.id}
          unitType={unitDraft.unitType ?? 'section'}
          generatedStateLabel={generatedState.rubrics ?? 'empty'}
          rubrics={rubricDrafts}
          sourceComponents={sourceComponents}
          legalDocument={legalDocument}
          onRubricsChange={(nextRubrics) => {
            setRubricDrafts(nextRubrics);
            setGeneratedState({
              ...generatedState,
              rubrics: nextRubrics.length > 0 ? 'user-edited' : 'empty',
            });
          }}
        />
        <details className="rounded border border-slate-800 bg-slate-950 p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-slate-500">Keywords / Concepts ({generatedState.concepts})</summary>
          <div className="mt-3 mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">Required concepts</div>
            <button onClick={() => addConcept()} className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
              + Add Concept
            </button>
          </div>
          {conceptMessage ? <div className="mb-2 text-xs text-amber-300">{conceptMessage}</div> : null}
          <div className="space-y-2">
            {conceptDrafts.map((concept, index) => (
              <div key={concept.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-2">
                <span className="rounded bg-slate-900 px-2 py-2 text-xs text-slate-500">{concept.origin}</span>
                <input
                  value={concept.label}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') updateConceptLabel(index, concept.label);
                    if (event.key === 'Escape' && !concept.label.trim()) removeConcept(index);
                  }}
                  onBlur={() => updateConceptLabel(index, concept.label)}
                  onChange={(event) =>
                    setConceptDrafts(conceptDrafts.map((entry, entryIndex) => (entryIndex === index ? { ...entry, label: event.target.value } : entry)))
                  }
                  className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
                <button
                  onClick={() => moveConcept(index, -1)}
                  disabled={index === 0}
                  className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 disabled:text-slate-600"
                >
                  Up
                </button>
                <button
                  onClick={() => moveConcept(index, 1)}
                  disabled={index === conceptDrafts.length - 1}
                  className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 disabled:text-slate-600"
                >
                  Down
                </button>
                <button onClick={() => removeConcept(index)} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                  Delete
                </button>
              </div>
            ))}
          </div>
          {!isCustom ? (
            <div className="mt-4 rounded border border-slate-800 bg-slate-900 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-wide text-slate-500">Suggested concepts</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={addSelectedSuggestions} className="rounded bg-slate-700 px-2 py-1 text-xs text-white">
                    Add Suggested Concepts
                  </button>
                  <button onClick={() => replaceSuggestedConcepts(false)} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                    Replace Generated
                  </button>
                  <button onClick={() => replaceSuggestedConcepts(true)} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                    Replace All
                  </button>
                </div>
              </div>
              {suggestions.length === 0 ? (
                <p className="text-xs text-slate-500">No deterministic suggestions were found for the selected source text.</p>
              ) : (
                <div className="space-y-1">
                  {suggestions.map((suggestion) => {
                    const key = normalizeConceptLabelKey(suggestion.label);
                    return (
                      <label key={`${suggestion.sourceKey ?? 'source'}-${key}`} className="flex items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={checkedSuggestionKeys.includes(key)}
                          onChange={(event) =>
                            setSelectedSuggestionKeys(() =>
                              event.target.checked
                                ? uniqueConceptKeys([...checkedSuggestionKeys, key])
                                : checkedSuggestionKeys.filter((entry) => entry !== key),
                            )
                          }
                        />
                        <span>{suggestion.label}</span>
                        <span className="text-slate-500">
                          {suggestion.reason} · {suggestion.confidence}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {import.meta.env.DEV ? (
                <div className="mt-3">
                  <button onClick={() => setShowDiagnostics(!showDiagnostics)} className="text-xs text-emerald-300">
                    Concept-generation diagnostics
                  </button>
                  {showDiagnostics ? (
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      {suggestions.map((suggestion) => (
                        <div key={`${suggestion.sourceKey ?? 'source'}-${suggestion.label}`}>
                          {suggestion.label} · {suggestion.reason} · {suggestion.confidence} · {suggestion.sourceKey ?? 'selected source'}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </details>
      </section>
    </div>
  );
};

const uniqueConceptKeys = (keys: string[]): string[] => keys.filter((key, index) => keys.indexOf(key) === index);

export default StudyUnitEditorPage;
