// Exam Prep — deterministic Recall / Recognition QA audit.
//
// Pure builders that mechanically flag every frozen Recall card (57) and
// Recognition cue (317) WITHOUT re-reading the corpus or re-running the
// curriculum validator. Inputs are the frozen derived task pools, so output
// is byte-deterministic for a fixed manifest and no wall-clock or RNG ever
// enters. Flags are deliberately mechanical and descriptive — nothing here
// rewrites curriculum content; A-SURV-03's fragmented recall entries are
// documented for human review, not edited.

import type { ExamPrepRecallTask, ExamPrepRecognitionTask } from '../examPrepTypes';
import { examPrepTierLabel } from '../examPrepFormat';
import {
  EXAM_PREP_TOTAL_RECALL_CARDS,
  EXAM_PREP_TOTAL_RECOGNITION_TASKS,
} from '../examPrepConstants';
import { EXAM_PREP_MANIFEST } from '../examPrepManifest';

const wordCount = (text: string): number => {
  const words = text.trim().split(/\s+/);
  return words.length === 1 && words[0] === '' ? 0 : words.length;
};

export type RecallQaRow = {
  id: string;
  unitId: string;
  unitTitle: string;
  tierLabel: string;
  reviewWeight: string;
  order: number;
  answer: string;
  charCount: number;
  wordCount: number;
  startsLowercase: boolean;
  endsSemicolon: boolean;
  fragmentFlag: boolean;
  longFlag: boolean;
  unitRecallCount: number;
};

export const RECALL_FRAGMENT_LENGTH_WARNING = 240;

export const buildRecallQaRows = (tasks: ExamPrepRecallTask[]): RecallQaRow[] => {
  const countByUnit = new Map<string, number>();
  for (const task of tasks) {
    countByUnit.set(task.unitId, (countByUnit.get(task.unitId) ?? 0) + 1);
  }
  return tasks.map((task) => {
    const answer = task.expectedAnswer;
    const trimmed = answer.trim();
    const startsLowercase = /^[a-z]/.test(trimmed);
    const endsSemicolon = trimmed.endsWith(';');
    return {
      id: task.id,
      unitId: task.unitId,
      unitTitle: task.unitTitle,
      tierLabel: examPrepTierLabel(task.tier),
      reviewWeight: task.reviewWeight,
      order: task.order,
      answer,
      charCount: answer.length,
      wordCount: wordCount(answer),
      startsLowercase,
      endsSemicolon,
      // A recall fragment is a continuation piece of a multi-entry rule set:
      // it starts lowercase (continues the preceding clause) or ends with the
      // list-joining semicolon used by the curated multi-clause entries.
      fragmentFlag: startsLowercase || endsSemicolon,
      longFlag: answer.length > RECALL_FRAGMENT_LENGTH_WARNING,
      unitRecallCount: countByUnit.get(task.unitId) ?? 1,
    };
  });
};

export const RECALL_QA_FLAGS_TEXT = (row: RecallQaRow): string => {
  const flags: string[] = [];
  if (row.fragmentFlag) flags.push('fragment');
  if (row.endsSemicolon) flags.push('ends-with-;');
  if (row.startsLowercase) flags.push('starts-lowercase');
  if (row.longFlag) flags.push(`>${RECALL_FRAGMENT_LENGTH_WARNING} chars`);
  if (row.unitRecallCount > 1) flags.push(`part of ${row.unitRecallCount}-entry unit recall`);
  return flags.length > 0 ? flags.join(', ') : 'ok';
};

export type RecognitionQaRow = {
  id: string;
  unitId: string;
  unitTitle: string;
  tierLabel: string;
  reviewWeight: string;
  cueIndex: number;
  cue: string;
  charCount: number;
  wordCount: number;
  expectedDocumentCount: number;
  duplicateOf: string[];
  veryShortCue: boolean;
  longCue: boolean;
};

export const RECOGNITION_SHORT_CUE_MAX = 5;
export const RECOGNITION_LONG_CUE_MIN = 80;

export const buildRecognitionQaRows = (tasks: ExamPrepRecognitionTask[]): RecognitionQaRow[] => {
  const byCue = new Map<string, string[]>();
  for (const task of tasks) {
    byCue.set(task.cue, [...(byCue.get(task.cue) ?? []), task.id]);
  }
  return tasks.map((task) => ({
    id: task.id,
    unitId: task.unitId,
    unitTitle: task.unitTitle,
    tierLabel: examPrepTierLabel(task.tier),
    reviewWeight: task.reviewWeight,
    cueIndex: task.cueIndex,
    cue: task.cue,
    charCount: task.cue.length,
    wordCount: wordCount(task.cue),
    expectedDocumentCount: task.expectedDocumentIds.length,
    duplicateOf: (byCue.get(task.cue) ?? []).filter((id) => id !== task.id),
    veryShortCue: task.cue.length <= RECOGNITION_SHORT_CUE_MAX,
    longCue: task.cue.length >= RECOGNITION_LONG_CUE_MIN,
  }));
};

export const RECOGNITION_QA_FLAGS_TEXT = (row: RecognitionQaRow): string => {
  const flags: string[] = [];
  if (row.duplicateOf.length > 0) flags.push(`duplicate cue of ${row.duplicateOf.join(', ')}`);
  if (row.veryShortCue) flags.push(`<=${RECOGNITION_SHORT_CUE_MAX} chars`);
  if (row.longCue) flags.push(`>=${RECOGNITION_LONG_CUE_MIN} chars`);
  if (row.expectedDocumentCount > 1)
    flags.push(`expected across ${row.expectedDocumentCount} documents`);
  return flags.length > 0 ? flags.join(', ') : 'ok';
};

const escapeCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const countsOf = <T>(rows: T[], flag: (_row: T) => boolean): number => rows.filter(flag).length;

const summaryLine = (label: string, count: number): string => `| ${label} | ${count} |`;

export const buildRecallQaMarkdown = (tasks: ExamPrepRecallTask[]): string => {
  const rows = buildRecallQaRows(tasks);
  const fragmentRows = rows.filter((row) => row.fragmentFlag);
  const longRows = rows.filter((row) => row.longFlag);
  const multiRows = rows.filter((row) => row.unitRecallCount > 1);
  const lines: string[] = [];
  lines.push('# Exam Prep — Recall quality audit');
  lines.push('');
  lines.push(
    'Deterministic mechanical audit of the frozen Recall card pool. Generated from the bundled curriculum manifest — no corpus revalidation, no content changes.',
  );
  lines.push('');
  lines.push(`- curriculumId: \`${EXAM_PREP_MANIFEST.curriculumId}\``);
  lines.push(`- manifest contentHash: \`${EXAM_PREP_MANIFEST.contentHash}\``);
  lines.push(`- cards audited: ${rows.length} (expected ${EXAM_PREP_TOTAL_RECALL_CARDS})`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Flag | Cards |');
  lines.push('| --- | --- |');
  lines.push(summaryLine('fragment (starts-lowercase and/or ends-with-;)', fragmentRows.length));
  lines.push(summaryLine(`long (>${RECALL_FRAGMENT_LENGTH_WARNING} chars)`, longRows.length));
  lines.push(
    summaryLine(
      'unit with multiple recall entries',
      new Set(multiRows.map((row) => row.unitId)).size,
    ),
  );
  lines.push('');
  lines.push('## Per-card audit');
  lines.push('');
  lines.push('| # | Task id | Unit | Weight | Chars | Words | Flags | Expected answer |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| ${row.order} | ${row.id} | ${escapeCell(row.unitTitle)} | ${row.reviewWeight} | ${row.charCount} | ${row.wordCount} | ${RECALL_QA_FLAGS_TEXT(row)} | ${escapeCell(row.answer)} |`,
    );
  }
  lines.push('');
  lines.push('## A-SURV-03 — human review note');
  lines.push('');
  lines.push(
    '`A-SURV-03` (Surveys Act integrated survey area) contributes THREE separate recall cards that are fragments of one rule set:',
  );
  lines.push('');
  const survRows = rows.filter((row) => row.unitId === 'A-SURV-03');
  for (const row of survRows) {
    lines.push(`- \`${row.id}\` (${row.charCount} chars) — \`${escapeCell(row.answer)}\``);
  }
  lines.push('');
  lines.push(
    'The three strings read as a single integrated rule (“relevant legal monuments … must be tied into the coordinate-monument framework where the Act requires”, “subdivision work is explicitly included”, “certification responsibility remains with the surveyor”). They are intentionally NOT merged or reworded here: the frozen curriculum must not be rewritten. A human reviewer should confirm whether the three should be presented as one recall entry when the curriculum is next versioned.',
  );
  lines.push('');
  lines.push(
    'A-SURV-03 carries no recognition cue, so it is absent from the Recognition pool (317).',
  );
  lines.push('');
  return lines.join('\n');
};

export const buildRecognitionQaMarkdown = (tasks: ExamPrepRecognitionTask[]): string => {
  const rows = buildRecognitionQaRows(tasks);
  const duplicateRows = rows.filter((row) => row.duplicateOf.length > 0);
  const shortRows = rows.filter((row) => row.veryShortCue);
  const longRows = rows.filter((row) => row.longCue);
  const multiDocRows = rows.filter((row) => row.expectedDocumentCount > 1);
  const lines: string[] = [];
  lines.push('# Exam Prep — Recognition quality audit');
  lines.push('');
  lines.push(
    'Deterministic mechanical audit of the frozen Recognition cue pool. Generated from the bundled curriculum manifest — no corpus revalidation, no content changes.',
  );
  lines.push('');
  lines.push(`- curriculumId: \`${EXAM_PREP_MANIFEST.curriculumId}\``);
  lines.push(`- manifest contentHash: \`${EXAM_PREP_MANIFEST.contentHash}\``);
  lines.push(`- cues audited: ${rows.length} (expected ${EXAM_PREP_TOTAL_RECOGNITION_TASKS})`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Flag | Cues |');
  lines.push('| --- | --- |');
  lines.push(summaryLine('duplicate cue text (shared with another task)', duplicateRows.length));
  lines.push(summaryLine(`very short (<=${RECOGNITION_SHORT_CUE_MAX} chars)`, shortRows.length));
  lines.push(summaryLine(`long (>=${RECOGNITION_LONG_CUE_MIN} chars)`, longRows.length));
  lines.push(summaryLine('expected across multiple documents', multiDocRows.length));
  lines.push('');
  lines.push('## Per-cue audit');
  lines.push('');
  lines.push('| Task id | Unit | Weight | Cue # | Chars | Words | Docs | Flags | Cue text |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.unitId} | ${row.reviewWeight} | ${row.cueIndex} | ${row.charCount} | ${row.wordCount} | ${row.expectedDocumentCount} | ${RECOGNITION_QA_FLAGS_TEXT(row)} | ${escapeCell(row.cue)} |`,
    );
  }
  lines.push('');
  lines.push(
    'A-SURV-03 carries no recognition cue, so it is absent from this pool (by design, noted in the Recall audit).',
  );
  lines.push('');
  return lines.join('\n');
};

// Kept for potential future machine use (assertion helpers without DOM).
export const recallAuditCounts = (rows: RecallQaRow[]) => ({
  total: rows.length,
  fragments: countsOf(rows, (row: RecallQaRow) => row.fragmentFlag),
  long: countsOf(rows, (row: RecallQaRow) => row.longFlag),
});

export const recognitionAuditCounts = (rows: RecognitionQaRow[]) => ({
  total: rows.length,
  // Distinct cue strings shared by more than one task (duplicate groups).
  duplicates: new Set(rows.filter((row) => row.duplicateOf.length > 0).map((row) => row.cue)).size,
  veryShort: countsOf(rows, (row: RecognitionQaRow) => row.veryShortCue),
  long: countsOf(rows, (row: RecognitionQaRow) => row.longCue),
});
