import {
  generateStudyRubric,
  generateStudyRubricWithDiagnostics,
  getStudyRubricTemplate,
  STUDY_RUBRIC_CATEGORY_LABELS,
} from '../studyRubricGeneration';
import type {
  ImportedLegalComponent,
  ImportedLegalDocument,
  StudyRubricCategory,
  StudyRubricItem,
  StudyUnitType,
} from '../studyTypes';

type StudyRubricEditorProps = {
  unitId: string;
  unitType: StudyUnitType;
  generatedStateLabel: string;
  rubrics: StudyRubricItem[];
  sourceComponents: ImportedLegalComponent[];
  legalDocument?: ImportedLegalDocument;
  onRubricsChange: (_rubrics: StudyRubricItem[]) => void;
};

const rubricCategoryOptions = Object.keys(STUDY_RUBRIC_CATEGORY_LABELS) as StudyRubricCategory[];

const rubricRowsWithOrder = (rubrics: StudyRubricItem[]): StudyRubricItem[] =>
  rubrics.map((rubric, index) => ({ ...rubric, order: index }));

const createRubricId = (unitId: string, label: string, index = 1): string =>
  `${unitId}-rubric-${label}-${Date.now().toString(36)}-${index}`;

const StudyRubricEditor = ({
  unitId,
  unitType,
  generatedStateLabel,
  rubrics,
  sourceComponents,
  legalDocument,
  onRubricsChange,
}: StudyRubricEditorProps) => {
  const setRubrics = (next: StudyRubricItem[]) => onRubricsChange(rubricRowsWithOrder(next));
  const generationDiagnostic =
    import.meta.env.DEV && sourceComponents.length > 0
      ? generateStudyRubricWithDiagnostics({
          document: legalDocument,
          selectedSources: sourceComponents,
          unitType,
        }).diagnostic
      : null;

  const addRubric = (category: StudyRubricCategory = 'custom', prompt = '') => {
    const nowIso = new Date().toISOString();
    setRubrics([
      ...rubrics,
      {
        id: createRubricId(unitId, 'manual', rubrics.length + 1),
        unitId,
        category,
        prompt,
        referenceAnswer: '',
        required: true,
        origin: 'manual',
        order: rubrics.length,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]);
  };

  const updateRubric = (index: number, patch: Partial<StudyRubricItem>) =>
    setRubrics(rubrics.map((rubric, entryIndex) => (entryIndex === index ? { ...rubric, ...patch } : rubric)));

  const removeRubric = (index: number) => setRubrics(rubrics.filter((_, entryIndex) => entryIndex !== index));

  const moveRubric = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rubrics.length) return;
    const next = rubrics.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setRubrics(next);
  };

  const duplicateRubric = (index: number) => {
    const nowIso = new Date().toISOString();
    const rubric = rubrics[index];
    setRubrics([
      ...rubrics.slice(0, index + 1),
      {
        ...rubric,
        id: createRubricId(unitId, 'copy'),
        origin: 'manual',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      ...rubrics.slice(index + 1),
    ]);
  };

  const generatedRubrics = (startOrder: number): StudyRubricItem[] => {
    const nowIso = new Date().toISOString();
    return generateStudyRubric({
      document: legalDocument,
      selectedSources: sourceComponents,
      unitType,
    }).map((rubric, index): StudyRubricItem => ({
      ...rubric,
      id: createRubricId(unitId, 'generated', index + 1),
      unitId,
      order: startOrder + index,
      createdAt: nowIso,
      updatedAt: nowIso,
    }));
  };

  const addGeneratedRubrics = () => setRubrics([...rubrics, ...generatedRubrics(rubrics.length)]);

  const replaceGeneratedRubrics = () => {
    if (!window.confirm('Replace generated rubric items? Manual rubric items will be preserved.')) return;
    const manual = rubrics.filter((rubric) => rubric.origin === 'manual');
    setRubrics([...manual, ...generatedRubrics(manual.length)]);
  };

  const applyRubricTemplate = () => {
    const nowIso = new Date().toISOString();
    const template = getStudyRubricTemplate(unitType).map((item, index): StudyRubricItem => ({
      id: createRubricId(unitId, 'template', index + 1),
      unitId,
      category: item.category,
      prompt: item.prompt,
      referenceAnswer: '',
      required: true,
      origin: 'generated',
      order: rubrics.length + index,
      createdAt: nowIso,
      updatedAt: nowIso,
    }));
    setRubrics([...rubrics, ...template]);
  };

  return (
    <div className="rounded border border-slate-800 bg-slate-950 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-slate-500">Answer rubric ({generatedStateLabel})</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => addRubric()} className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
            + Add Item
          </button>
          <button onClick={addGeneratedRubrics} className="rounded bg-slate-700 px-2 py-1 text-xs text-white">
            Add Suggested Rubric Items
          </button>
          <button onClick={replaceGeneratedRubrics} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
            Regenerate Generated Rubric Items
          </button>
          <button onClick={applyRubricTemplate} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
            Apply Template
          </button>
          <button onClick={() => setRubrics(rubrics.filter((rubric) => rubric.origin !== 'generated'))} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
            Clear Generated Items
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {rubrics.map((rubric, index) => (
          <div key={rubric.id} className="grid gap-2 rounded border border-slate-800 bg-slate-900 p-3">
            <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto_auto_auto]">
              <select
                value={rubric.category}
                onChange={(event) => updateRubric(index, { category: event.target.value as StudyRubricCategory })}
                className="rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100"
              >
                {rubricCategoryOptions.map((category) => (
                  <option key={category} value={category}>{STUDY_RUBRIC_CATEGORY_LABELS[category]}</option>
                ))}
              </select>
              <div className="hidden sm:block" />
              <button onClick={() => moveRubric(index, -1)} disabled={index === 0} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 disabled:text-slate-600">
                Up
              </button>
              <button onClick={() => moveRubric(index, 1)} disabled={index === rubrics.length - 1} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 disabled:text-slate-600">
                Down
              </button>
              <button onClick={() => removeRubric(index)} className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                Delete
              </button>
            </div>
            <input
              value={rubric.prompt}
              title={rubric.prompt}
              onChange={(event) => updateRubric(index, { prompt: event.target.value })}
              className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100"
              placeholder="Rubric question"
              aria-label="Rubric question"
            />
            <textarea
              value={rubric.referenceAnswer}
              onChange={(event) => updateRubric(index, { referenceAnswer: event.target.value })}
              className="min-h-20 rounded border border-slate-700 bg-slate-950 p-2 text-sm leading-6 text-slate-100"
              placeholder="Reference answer"
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rubric.required}
                  onChange={(event) => updateRubric(index, { required: event.target.checked })}
                />
                Required
              </label>
              <span>{rubric.origin}</span>
              {rubric.sourceReferences?.length ? <span>{rubric.sourceReferences.map((reference) => reference.sourceKey).join(', ')}</span> : null}
              <button onClick={() => duplicateRubric(index)} className="text-emerald-300">
                Duplicate
              </button>
            </div>
          </div>
        ))}
      </div>
      {generationDiagnostic ? (
        <details className="mt-3 rounded border border-slate-800 bg-slate-900 p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-slate-500">
            Rubric generation diagnostics
          </summary>
          <div className="mt-3 grid gap-3 text-xs text-slate-300">
            <div>
              <div className="font-medium text-slate-100">Section topic selected</div>
              <div>{generationDiagnostic.sectionTopic}</div>
            </div>
            <div>
              <div className="font-medium text-slate-100">Extracted legal facts</div>
              <pre className="mt-1 max-h-52 overflow-auto rounded bg-slate-950 p-2">
                {JSON.stringify(generationDiagnostic.extractedFacts, null, 2)}
              </pre>
            </div>
            <div>
              <div className="font-medium text-slate-100">Merged rubric items</div>
              <pre className="mt-1 max-h-52 overflow-auto rounded bg-slate-950 p-2">
                {JSON.stringify(generationDiagnostic.mergedItems, null, 2)}
              </pre>
            </div>
            {generationDiagnostic.rejectedDuplicatePrompts.length > 0 ? (
              <div>
                <div className="font-medium text-slate-100">Rejected duplicate prompts</div>
                <div>{generationDiagnostic.rejectedDuplicatePrompts.join('; ')}</div>
              </div>
            ) : null}
            {generationDiagnostic.removedSourceText.length > 0 ? (
              <div>
                <div className="font-medium text-slate-100">Text removed as amendment history</div>
                <div>{generationDiagnostic.removedSourceText.join('; ')}</div>
              </div>
            ) : null}
            {generationDiagnostic.qualityWarnings.length > 0 ? (
              <div>
                <div className="font-medium text-slate-100">Quality warnings</div>
                <div>{generationDiagnostic.qualityWarnings.join('; ')}</div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
};

export default StudyRubricEditor;
