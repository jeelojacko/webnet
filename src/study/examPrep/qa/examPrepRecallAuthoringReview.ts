// Exam Prep — deterministic Recall authoring-review bundle (QA tooling only).
//
// PURE, DEVELOPMENT-ONLY helpers that derive one human-review record for every
// frozen Recall card (exactly 57) from the bundled curriculum manifest. The
// purpose is AUDIT / AUTHORING-PREPARATION: each record surfaces the current
// card, its owning unit context (exam goal, depths, core understanding,
// recognition cues), frozen source context (documents, source anchors,
// mustLocate targets) and mechanical review flags — and then carries EMPTY
// human-authoring fields (`decision`, `proposedPrompt`, `proposedAnswer`,
// `proposedAction`, `reviewNotes`) that this batch MUST leave null.
//
// Nothing here rewrites curriculum content, invents sourceKeys, or edits
// learner-facing behaviour, and NOTHING here is imported by the production
// learner UI. Flags are deliberately mechanical and descriptive — no code
// decides a legal/content answer. Output is byte-deterministic for a fixed
// manifest: no wall-clock, no RNG.

import { EXAM_PREP_RECALL_PROMPT } from '../examPrepConstants';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { EXAM_PREP_MANIFEST } from '../examPrepManifest';
import { EXAM_PREP_RECALL_TASKS } from '../examPrepRecallTasks';
import { EXAM_PREP_TOTAL_RECALL_CARDS } from '../examPrepConstants';
import type { ExamPrepRecallTask } from '../examPrepTypes';
import type {
  ExamCurriculumManifest,
  ExamCurriculumSourceAnchor,
  ExamCurriculumUnit,
} from '../../examCurriculum/examCurriculumTypes';

// ---------------------------------------------------------------------------
// Frozen identity used by the generator (no wall-clock enters the output).
// ---------------------------------------------------------------------------

/** Repository baseline this authoring audit is generated against. */
export const EXAM_PREP_RECALL_AUTHORING_BASELINE_COMMIT =
  '36498a208a554a56bdadc991e4eb5e7bcebeb0eb';

export const EXAM_PREP_RECALL_AUTHORING_GENERATED_FROM =
  'current frozen Exam Curriculum V1';

// ---------------------------------------------------------------------------
// Mechanical flag definitions (deterministic, documented, transparent).
// ---------------------------------------------------------------------------

/** >240 characters mirrors the existing Recall QA long-answer threshold. */
export const EXAM_PREP_RECALL_LONG_ANSWER_CHARS = 240;

/** Additional >320-character very-long-answer threshold. */
export const EXAM_PREP_RECALL_VERY_LONG_ANSWER_CHARS = 320;

/**
 * Words/phrases that mark explicit numeric, duration, or threshold-like
 * material (years, metres, percentages, explicit values). Descriptive only.
 */
export const EXAM_PREP_RECALL_NUMERIC_DETAIL_PATTERN =
  /[0-9]|%|per cent|\b(?:years?|months?|days?|metres?|meters?|feet|acres?|hectares?|percent|degrees?|minutes?)\b/i;

/** Obvious exception/condition phrases. Descriptive only. */
export const EXAM_PREP_RECALL_EXCEPTION_PATTERN =
  /\bsubject to\b|\bunless\b|\bexcept(?:ion|ional|ions)?\b|\bexempt(?:ed|ion)?\b|\bwaiv(?:e|ed|er|ers)?\b/i;

/** Non-content words excluded from the best-effort Locate-overlap scan. */
export const EXAM_PREP_RECALL_OVERLAP_STOP_WORDS = new Set([
  'about',
  'act',
  'acts',
  'after',
  'before',
  'being',
  'between',
  'other',
  'provision',
  'provisions',
  'pursuant',
  'required',
  'section',
  'shall',
  'statutory',
  'their',
  'there',
  'these',
  'those',
  'through',
  'under',
  'where',
  'which',
  'within',
  'without',
]);

/** Minimum significant-token length for the Locate-overlap scan. */
export const EXAM_PREP_RECALL_OVERLAP_MIN_TOKEN = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExamPrepRecallAuthoringFlagKey =
  | 'genericPrompt'
  | 'multiRecallUnit'
  | 'fragmentLike'
  | 'longAnswer'
  | 'veryLongAnswer'
  | 'numericDetail'
  | 'exceptionLanguage'
  | 'multipleConcepts'
  | 'answerOverlapsLocate';

export type ExamPrepRecallAuthoringFlags = Record<ExamPrepRecallAuthoringFlagKey, boolean>;

export type ExamPrepRecallAuthoringRecord = {
  /** 1-based canonical position (matches the Recall task's own order). */
  order: number;
  taskId: string;
  unitId: string;
  tier: string;
  reviewWeight: string;
  unitTitle: string;
  currentCard: {
    currentPrompt: string;
    currentExpectedAnswer: string;
    currentAnswerCharCount: number;
    currentAnswerWordCount: number;
  };
  unitContext: {
    examGoal: string;
    learningDepths: string[];
    coreUnderstanding: string[];
    recognitionCues: string[];
  };
  sourceContext: {
    sourceDocumentIds: string[];
    documentTitles: string[];
    sourceAnchors: Array<{
      documentId: string;
      documentTitle: string;
      sourceKey: string;
      label: string;
      role: string;
    }>;
  };
  lookupContext: Array<{
    prompt: string;
    documentId: string;
    documentTitle: string;
    sourceKey: string | null;
  }>;
  relationships: {
    relatedUnitIds: string[];
    mustRecallCount: number;
    mustRecallIndex: number;
    /** Sibling recall task ids in this unit (excluding this card). */
    otherRecallTaskIds: string[];
  };
  flags: ExamPrepRecallAuthoringFlags;
  /** Human-authoring fields — always null in this generated bundle. */
  decision: null;
  proposedPrompt: null;
  proposedAnswer: null;
  proposedAction: null;
  reviewNotes: null;
};

export type ExamPrepRecallAuthoringSummary = {
  totalCards: number;
  counts: Record<ExamPrepRecallAuthoringFlagKey, number>;
  taskIdsByFlag: Record<ExamPrepRecallAuthoringFlagKey, string[]>;
};

export type ExamPrepRecallAuthoringMetadata = {
  baselineCommit: string;
  curriculumId: string;
  manifestContentHash: string;
  corpusContentHash: string;
  totalCards: number;
  generatedFrom: string;
};

export type ExamPrepRecallAuthoringBundle = ExamPrepRecallAuthoringMetadata & {
  records: ExamPrepRecallAuthoringRecord[];
};

export const EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS: ExamPrepRecallAuthoringFlagKey[] = [
  'genericPrompt',
  'multiRecallUnit',
  'fragmentLike',
  'longAnswer',
  'veryLongAnswer',
  'numericDetail',
  'exceptionLanguage',
  'multipleConcepts',
  'answerOverlapsLocate',
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const wordCount = (text: string): number => {
  const words = text.trim().split(/\s+/);
  return words.length === 1 && words[0] === '' ? 0 : words.length;
};

const significantTokens = (text: string): Set<string> => {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= EXAM_PREP_RECALL_OVERLAP_MIN_TOKEN &&
        !EXAM_PREP_RECALL_OVERLAP_STOP_WORDS.has(token),
    );
  return new Set(tokens);
};

/** Interior clause-boundary count (a trailing semicolon is not a boundary). */
const interiorSemicolonCount = (answer: string): number =>
  Math.max(0, answer.trim().replace(/;\s*$/, '').split(';').length - 1);

/** Counts of list/connector words (and/or) plus commas. */
const connectorCount = (answer: string): number =>
  (answer.match(/\b(?:and|or)\b/g) ?? []).length + (answer.match(/,/g) ?? []).length;

const lookupTargetsForUnit = (unit: ExamCurriculumUnit) =>
  (unit.mustLocate ?? []).map((lookup) => ({
    prompt: lookup.prompt,
    documentId: lookup.documentId,
    sourceKey: lookup.sourceKey ?? null,
  }));

const lookupPromptText = (unit: ExamCurriculumUnit): string =>
  (unit.mustLocate ?? []).map((lookup) => lookup.prompt).join(' ');

const anchorToContext = (
  anchor: ExamCurriculumSourceAnchor,
): {
  documentId: string;
  documentTitle: string;
  sourceKey: string;
  label: string;
  role: string;
} => ({
  documentId: anchor.documentId,
  documentTitle: EXAM_PREP_DOCUMENT_TITLES[anchor.documentId] ?? anchor.documentId,
  sourceKey: anchor.sourceKey,
  label: anchor.label,
  role: anchor.role,
});

const isGenericPrompt = (task: ExamPrepRecallTask): boolean =>
  task.prompt === EXAM_PREP_RECALL_PROMPT;

const isFragmentLike = (answer: string): boolean => {
  const trimmed = answer.trim();
  return /^[a-z]/.test(trimmed) || trimmed.endsWith(';');
};

const isNumericDetail = (answer: string): boolean =>
  EXAM_PREP_RECALL_NUMERIC_DETAIL_PATTERN.test(answer);

const isExceptionLanguage = (answer: string): boolean =>
  EXAM_PREP_RECALL_EXCEPTION_PATTERN.test(answer);

/** Transparent multi-clause heuristic: an interior clause boundary, or >=3
 * list/connector separators (commas + and/or + interior semicolons). */
const isMultipleConcepts = (answer: string): boolean => {
  const interiorSemicolons = interiorSemicolonCount(answer);
  const connectors = connectorCount(answer);
  return interiorSemicolons >= 1 || interiorSemicolons + connectors >= 3;
};

/**
 * Best-effort lexical overlap flag: the answer carries numeric/detail material
 * AND shares a significant token with a same-unit mustLocate prompt. This is
 * intentionally mechanical — it never decides whether any overlap is real.
 */
const answerOverlapsLocate = (task: ExamPrepRecallTask, unit: ExamCurriculumUnit): boolean => {
  if ((unit.mustLocate ?? []).length === 0) return false;
  if (!isNumericDetail(task.expectedAnswer)) return false;
  const answerTokens = significantTokens(task.expectedAnswer);
  const lookupTokens = significantTokens(lookupPromptText(unit));
  for (const token of answerTokens) {
    if (lookupTokens.has(token)) return true;
  }
  return false;
};

const buildFlags = (task: ExamPrepRecallTask, unit: ExamCurriculumUnit): ExamPrepRecallAuthoringFlags => {
  const answer = task.expectedAnswer;
  return {
    genericPrompt: isGenericPrompt(task),
    multiRecallUnit: unit.mustRecall.length > 1,
    fragmentLike: isFragmentLike(answer),
    longAnswer: answer.length > EXAM_PREP_RECALL_LONG_ANSWER_CHARS,
    veryLongAnswer: answer.length > EXAM_PREP_RECALL_VERY_LONG_ANSWER_CHARS,
    numericDetail: isNumericDetail(answer),
    exceptionLanguage: isExceptionLanguage(answer),
    multipleConcepts: isMultipleConcepts(answer),
    answerOverlapsLocate: answerOverlapsLocate(task, unit),
  };
};

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** One review record per frozen Recall task in canonical task order. */
export const deriveExamPrepRecallAuthoringRecords = (
  tasks: ExamPrepRecallTask[] = EXAM_PREP_RECALL_TASKS,
  units: ExamCurriculumUnit[] = EXAM_PREP_MANIFEST.units,
): ExamPrepRecallAuthoringRecord[] => {
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const siblingIdsByUnit = new Map<string, string[]>();
  for (const task of tasks) {
    siblingIdsByUnit.set(task.unitId, [...(siblingIdsByUnit.get(task.unitId) ?? []), task.id]);
  }
  return tasks.map((task) => {
    const unit = unitById.get(task.unitId);
    if (!unit) throw new Error(`Exam Prep recall authoring: unknown unit ${task.unitId}`);
    const siblings = (siblingIdsByUnit.get(task.unitId) ?? []).filter((id) => id !== task.id);
    return {
      order: task.order,
      taskId: task.id,
      unitId: task.unitId,
      tier: task.tier,
      reviewWeight: task.reviewWeight,
      unitTitle: task.unitTitle,
      currentCard: {
        currentPrompt: task.prompt,
        currentExpectedAnswer: task.expectedAnswer,
        currentAnswerCharCount: task.expectedAnswer.length,
        currentAnswerWordCount: wordCount(task.expectedAnswer),
      },
      unitContext: {
        examGoal: unit.examGoal,
        learningDepths: [...unit.learningDepths],
        coreUnderstanding: [...unit.coreUnderstanding],
        recognitionCues: [...unit.recognitionCues],
      },
      sourceContext: {
        sourceDocumentIds: [...unit.sourceDocumentIds],
        documentTitles: unit.sourceDocumentIds.map(
          (documentId) => EXAM_PREP_DOCUMENT_TITLES[documentId] ?? documentId,
        ),
        sourceAnchors: [...unit.sourceAnchors].map(anchorToContext),
      },
      lookupContext: lookupTargetsForUnit(unit).map((lookup) => ({
        ...lookup,
        documentTitle: EXAM_PREP_DOCUMENT_TITLES[lookup.documentId] ?? lookup.documentId,
      })),
      relationships: {
        relatedUnitIds: [...unit.relatedUnitIds],
        mustRecallCount: unit.mustRecall.length,
        mustRecallIndex: task.index,
        otherRecallTaskIds: siblings,
      },
      flags: buildFlags(task, unit),
      decision: null,
      proposedPrompt: null,
      proposedAnswer: null,
      proposedAction: null,
      reviewNotes: null,
    };
  });
};

/** Deterministic summary counts + affected task ids per flag. */
export const buildExamPrepRecallAuthoringSummary = (
  records: ExamPrepRecallAuthoringRecord[],
): ExamPrepRecallAuthoringSummary => {
  const counts = Object.fromEntries(
    EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS.map((key) => [key, 0]),
  ) as Record<ExamPrepRecallAuthoringFlagKey, number>;
  const taskIdsByFlag = Object.fromEntries(
    EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS.map((key) => [key, [] as string[]]),
  ) as Record<ExamPrepRecallAuthoringFlagKey, string[]>;
  for (const record of records) {
    for (const key of EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS) {
      if (record.flags[key]) {
        counts[key] += 1;
        taskIdsByFlag[key].push(record.taskId);
      }
    }
  }
  return { totalCards: records.length, counts, taskIdsByFlag };
};

/** Frozen metadata block for the deterministic output. */
export const buildExamPrepRecallAuthoringMetadata = (
  manifest: ExamCurriculumManifest = EXAM_PREP_MANIFEST,
): ExamPrepRecallAuthoringMetadata => ({
  baselineCommit: EXAM_PREP_RECALL_AUTHORING_BASELINE_COMMIT,
  curriculumId: manifest.curriculumId,
  manifestContentHash: manifest.contentHash,
  corpusContentHash: manifest.sourceCorpusContentHash,
  totalCards: EXAM_PREP_TOTAL_RECALL_CARDS,
  generatedFrom: EXAM_PREP_RECALL_AUTHORING_GENERATED_FROM,
});

export const buildExamPrepRecallAuthoringBundle = (
  tasks: ExamPrepRecallTask[] = EXAM_PREP_RECALL_TASKS,
  units: ExamCurriculumUnit[] = EXAM_PREP_MANIFEST.units,
  manifest: ExamCurriculumManifest = EXAM_PREP_MANIFEST,
): ExamPrepRecallAuthoringBundle => ({
  ...buildExamPrepRecallAuthoringMetadata(manifest),
  records: deriveExamPrepRecallAuthoringRecords(tasks, units),
});
