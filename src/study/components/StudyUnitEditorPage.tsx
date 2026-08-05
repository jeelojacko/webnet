import { useState } from 'react';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateReferenceAnswer,
  generateSourceCitationSummary,
  generateStudyQuestion,
  generateStudyTitle,
  suggestRequiredConcepts,
  type ReferenceAnswerOptions,
} from '../studyDraftGeneration';
import type {
  ImportedLegalComponent,
  StudyConcept,
  StudyDataSnapshot,
  StudyGeneratedContentState,
  StudyPrompt,
  StudyReferenceAnswerFormat,
  StudyUnit,
} from '../studyTypes';

type StudyUnitEditorPageProps = {
  data: StudyDataSnapshot;
  unitId: string;
  onSave: (_draft: { unit: StudyUnit; prompt: StudyPrompt; concepts: StudyConcept[] }) => Promise<void>;
  onNavigate: (_path: string) => void;
};

const emptyGeneratedState = (): StudyGeneratedContentState => ({
  title: 'empty',
  question: 'empty',
  referenceAnswer: 'empty',
  editableSummary: 'empty',
  concepts: 'empty',
});

const sourceRecordKey = (component: Pick<ImportedLegalComponent, 'documentId' | 'sourceKey'>): string =>
  `${component.documentId}::${component.sourceKey}`;

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

const StudyUnitEditorPage = ({ data, unitId, onSave, onNavigate }: StudyUnitEditorPageProps) => {
  const unit = data.units.find((entry) => entry.id === unitId);
  const initialPrompt =
    data.prompts.find((entry) => entry.unitId === unitId && entry.kind === 'guided-recall') ??
    data.prompts.find((entry) => entry.unitId === unitId);
  const initialConcepts = data.concepts.filter((concept) => concept.unitId === unitId);
  const selectedKeys = new Set(unit?.sourceReferences?.map((reference) => `${reference.documentId}::${reference.sourceKey}`) ?? []);
  const sourceComponents = data.legalComponents.filter((component) => selectedKeys.has(sourceRecordKey(component)));
  const legalDocument = unit?.documentIds[0]
    ? data.legalDocuments.find((document) => document.id === unit.documentIds[0])
    : undefined;
  const studyDocument = unit?.documentIds[0]
    ? data.documents.find((document) => document.id === unit.documentIds[0])
    : undefined;
  const returnTo =
    typeof window.history.state?.returnTo === 'string'
      ? window.history.state.returnTo
      : studyDocument
        ? `/study/document/${encodeURIComponent(studyDocument.id)}`
        : '/study/library';

  const [unitDraft, setUnitDraft] = useState(unit);
  const [promptDraft, setPromptDraft] = useState(initialPrompt);
  const [conceptDrafts, setConceptDrafts] = useState(initialConcepts);
  const [generatedState, setGeneratedState] = useState(unit?.generatedContentState ?? emptyGeneratedState());
  const [options, setOptions] = useState<ReferenceAnswerOptions>(DEFAULT_REFERENCE_ANSWER_OPTIONS);

  if (!unit || !unitDraft || !promptDraft || !studyDocument) {
    return <div className="text-sm text-slate-500">Study unit not found.</div>;
  }

  const documentTitle = legalDocument?.officialTitle ?? studyDocument.title;
  const regenerateQuestion = () => {
    if (!fieldCanOverwrite(generatedState, 'question')) return;
    const question = generateStudyQuestion({ documentTitle, selectedSources: sourceComponents }).question;
    setPromptDraft({ ...promptDraft, question });
    setGeneratedState({ ...generatedState, question: question ? 'generated' : 'empty' });
  };
  const regenerateTitle = () => {
    if (!fieldCanOverwrite(generatedState, 'title')) return;
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
  const regenerateConcepts = () => {
    if (!fieldCanOverwrite(generatedState, 'concepts')) return;
    const nowIso = new Date().toISOString();
    const concepts = suggestRequiredConcepts(sourceComponents).map((label, index): StudyConcept => ({
      id: `${unit.id}-concept-${index + 1}`,
      unitId: unit.id,
      label,
      required: true,
      createdAt: conceptDrafts[index]?.createdAt ?? nowIso,
      updatedAt: nowIso,
    }));
    setConceptDrafts(concepts);
    setPromptDraft({ ...promptDraft, conceptIds: concepts.map((concept) => concept.id) });
    setGeneratedState({ ...generatedState, concepts: concepts.length > 0 ? 'generated' : 'empty' });
  };
  const setFormat = (format: StudyReferenceAnswerFormat) => {
    const nextOptions = { ...options, format };
    setOptions(nextOptions);
    regenerateReferenceAnswer(nextOptions);
  };
  const clearGeneratedContent = () => {
    if (!window.confirm('Clear generated title, question, reference answer, summary and concepts?')) return;
    setUnitDraft({ ...unitDraft, title: '', editableSummary: '', referenceAnswer: '' });
    setPromptDraft({ ...promptDraft, question: '', referenceAnswer: '', conceptIds: [] });
    setConceptDrafts([]);
    setGeneratedState(emptyGeneratedState());
  };
  const save = async () => {
    await onSave({
      unit: {
        ...unitDraft,
        sourceCitationSummary: legalDocument
          ? generateSourceCitationSummary({ document: legalDocument, selectedSources: sourceComponents })
          : unitDraft.sourceCitationSummary,
        generatedContentState: generatedState,
      },
      prompt: { ...promptDraft, conceptIds: conceptDrafts.map((concept) => concept.id) },
      concepts: conceptDrafts,
    });
    onNavigate(returnTo);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.95fr)_minmax(24rem,1.05fr)]">
      <section className="max-h-[78vh] overflow-auto rounded border border-emerald-900 bg-slate-950 p-4">
        <div className="text-xs uppercase tracking-wide text-emerald-300">Selected official source text</div>
        <h2 className="mt-1 text-lg font-semibold text-white">{documentTitle}</h2>
        <div className="mt-2 whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300">
          {unitDraft.sourceCitationSummary?.text ?? 'No citation summary available.'}
        </div>
        {unitDraft.sourceReviewRequired || unitDraft.sourceReferenceMissing ? (
          <div className="mt-3 rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">
            {unitDraft.sourceReferenceMissing ? 'One or more source references are missing.' : 'Source review is required.'}
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
          <button onClick={() => setFormat('complete-exact-text')} className="rounded bg-slate-700 px-3 py-1.5 text-xs text-white">
            Reset to official-text format
          </button>
          <button onClick={clearGeneratedContent} className="rounded bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
            Clear generated content
          </button>
        </div>
        <label className="grid gap-2 text-xs uppercase tracking-wide text-slate-500">
          Generated title ({generatedState.title})
          <input
            value={unitDraft.title}
            onChange={(event) => {
              setUnitDraft({ ...unitDraft, title: event.target.value });
              setGeneratedState(nextStateAfterEdit(generatedState, 'title', event.target.value));
            }}
            className="rounded border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-slate-100"
          />
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
        <div className="rounded border border-slate-800 bg-slate-950 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">Required concepts ({generatedState.concepts})</div>
            <button onClick={regenerateConcepts} className="rounded bg-slate-700 px-2 py-1 text-xs text-white">
              Regenerate concepts
            </button>
          </div>
          <div className="space-y-2">
            {conceptDrafts.map((concept, index) => (
              <div key={concept.id} className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  value={concept.label}
                  onChange={(event) => {
                    const next = conceptDrafts.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, label: event.target.value } : entry,
                    );
                    setConceptDrafts(next);
                    setGeneratedState(nextStateAfterEdit(generatedState, 'concepts', next));
                  }}
                  className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                />
                <button
                  onClick={() => {
                    const next = conceptDrafts.filter((_, entryIndex) => entryIndex !== index);
                    setConceptDrafts(next);
                    setGeneratedState(nextStateAfterEdit(generatedState, 'concepts', next));
                  }}
                  className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default StudyUnitEditorPage;
