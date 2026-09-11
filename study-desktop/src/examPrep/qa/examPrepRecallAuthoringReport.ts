// Exam Prep — Recall authoring-review Markdown/JSON report builders (QA only).
//
// Deterministic report formatting over the pure review records produced by
// `examPrepRecallAuthoringReview.ts`. Emits:
//   - a compact group summary (per-flag counts + affected task ids) for triage,
//   - ONE section per card in canonical order (57),
//   - a "Multi-card units" appendix showing every answer of units with >1
//     Recall entry together.
// Human-authoring fields stay null in the JSON payload (never filled here),
// and the Markdown's HUMAN REVIEW blocks are empty templates. No wall-clock,
// no RNG, no curriculum mutation.

import { EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS } from './examPrepRecallAuthoringReview';
import type {
  ExamPrepRecallAuthoringBundle,
  ExamPrepRecallAuthoringFlagKey,
  ExamPrepRecallAuthoringRecord,
  ExamPrepRecallAuthoringSummary,
} from './examPrepRecallAuthoringReview';

export const EXAM_PREP_RECALL_AUTHORING_REPORT_TITLE =
  'Exam Prep — Recall authoring review bundle';

const flagLabel = (key: ExamPrepRecallAuthoringFlagKey): string => {
  switch (key) {
    case 'genericPrompt':
      return 'genericPrompt (shared learner prompt)';
    case 'multiRecallUnit':
      return 'multiRecallUnit (unit has >1 Recall entry)';
    case 'fragmentLike':
      return 'fragmentLike (starts lowercase and/or ends with ;)';
    case 'longAnswer':
      return 'longAnswer (>240 chars)';
    case 'veryLongAnswer':
      return 'veryLongAnswer (>320 chars)';
    case 'numericDetail':
      return 'numericDetail (numbers/durations/thresholds)';
    case 'exceptionLanguage':
      return 'exceptionLanguage (subject to / unless / except / exempt / waived)';
    case 'multipleConcepts':
      return 'multipleConcepts (interior clause boundary or dense connectors)';
    case 'answerOverlapsLocate':
      return 'answerOverlapsLocate (detail also present in same-unit mustLocate)';
  }
};

const activeFlagKeys = (record: ExamPrepRecallAuthoringRecord): ExamPrepRecallAuthoringFlagKey[] =>
  EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS.filter((key) => record.flags[key]);

const flagListText = (record: ExamPrepRecallAuthoringRecord): string => {
  const keys = activeFlagKeys(record);
  return keys.length > 0 ? keys.join(', ') : '—';
};

const humanReviewBlock = (): string =>
  [
    '',
    'HUMAN REVIEW',
    'Decision: [ ]',
    '',
    'Proposed specific question:',
    '[ ]',
    '',
    'Proposed answer:',
    '[ ]',
    '',
    'Action:',
    '[ ]',
    '',
    'Notes:',
    '[ ]',
    '',
  ].join('\n');

const recordSection = (record: ExamPrepRecallAuthoringRecord): string => {
  const lines: string[] = [];
  lines.push(`## ${String(record.order).padStart(2, '0')} — ${record.taskId}`);
  lines.push('');
  lines.push('Unit:');
  lines.push(`${record.unitId} — ${record.unitTitle}`);
  lines.push('');
  lines.push('Tier / weight:');
  lines.push(`${record.tier} / ${record.reviewWeight}`);
  lines.push('');
  lines.push('Current learner prompt:');
  lines.push(record.currentCard.currentPrompt);
  lines.push('');
  lines.push('Current expected answer:');
  lines.push(record.currentCard.currentExpectedAnswer);
  lines.push('');
  lines.push('Flags:');
  lines.push(flagListText(record));
  lines.push('');
  lines.push(`Expected answer length: ${record.currentCard.currentAnswerCharCount} chars / ${record.currentCard.currentAnswerWordCount} words`);
  lines.push('');
  if (record.unitContext.examGoal) {
    lines.push('Exam goal:');
    lines.push(record.unitContext.examGoal);
    lines.push('');
  }
  if (record.unitContext.learningDepths.length > 0) {
    lines.push(`Learning depths: ${record.unitContext.learningDepths.join(', ')}`);
    lines.push('');
  }
  if (record.unitContext.coreUnderstanding.length > 0) {
    lines.push('Core understanding:');
    for (const entry of record.unitContext.coreUnderstanding) lines.push(`- ${entry}`);
    lines.push('');
  }
  if (record.unitContext.recognitionCues.length > 0) {
    lines.push('Recognition cues (same unit):');
    for (const cue of record.unitContext.recognitionCues) lines.push(`- ${cue}`);
    lines.push('');
  }
  if (record.sourceContext.documentTitles.length > 0) {
    lines.push(`Source documents: ${record.sourceContext.documentTitles.join('; ')}`);
    lines.push('');
  }
  lines.push('Source anchors (owning unit only):');
  if (record.sourceContext.sourceAnchors.length === 0) {
    lines.push('- (no source anchors — unit has only broad source metadata)');
  } else {
    for (const anchor of record.sourceContext.sourceAnchors) {
      lines.push(
        `- ${anchor.documentTitle} — ${anchor.label || anchor.sourceKey} — ${anchor.sourceKey} [${anchor.role}]`,
      );
    }
  }
  lines.push('');
  lines.push('Existing LOOK HERE targets (same unit):');
  if (record.lookupContext.length === 0) {
    lines.push('- (none)');
  } else {
    for (const lookup of record.lookupContext) {
      lines.push(
        `- ${lookup.prompt} — ${lookup.documentTitle}${lookup.sourceKey ? ` — ${lookup.sourceKey}` : ' — document-level'}`,
      );
    }
  }
  lines.push('');
  if (record.relationships.otherRecallTaskIds.length > 0) {
    lines.push('Other Recall entries in this unit:');
    for (const siblingId of record.relationships.otherRecallTaskIds) {
      lines.push(`- ${siblingId}`);
    }
    lines.push('');
  }
  lines.push(humanReviewBlock());
  return lines.join('\n');
};

const summarySection = (summary: ExamPrepRecallAuthoringSummary): string => {
  const lines: string[] = [];
  lines.push('## Group summary');
  lines.push('');
  lines.push('| Flag | Cards |');
  lines.push('| --- | --- |');
  for (const key of EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS) {
    lines.push(`| ${flagLabel(key)} | ${summary.counts[key]} |`);
  }
  lines.push('');
  lines.push('Affected task ids per flag (fast triage):');
  lines.push('');
  for (const key of EXAM_PREP_RECALL_AUTHORING_FLAG_KEYS) {
    const ids = summary.taskIdsByFlag[key];
    lines.push(`- **${key}** (${summary.counts[key]}): ${ids.length > 0 ? ids.join(', ') : '—'}`);
  }
  lines.push('');
  return lines.join('\n');
};

const multiCardAppendix = (records: ExamPrepRecallAuthoringRecord[]): string => {
  const byUnit = new Map<string, ExamPrepRecallAuthoringRecord[]>();
  for (const record of records) {
    if (record.relationships.mustRecallCount <= 1) continue;
    byUnit.set(record.unitId, [...(byUnit.get(record.unitId) ?? []), record]);
  }
  const orderedUnits = [...byUnit.keys()].sort((left, right) => {
    const firstOrder = (id: string): number => byUnit.get(id)?.[0]?.order ?? Number.MAX_SAFE_INTEGER;
    return firstOrder(left) - firstOrder(right);
  });
  const lines: string[] = [];
  lines.push('## Multi-card units appendix');
  lines.push('');
  lines.push('Every unit with more than one Recall card, with all its answers together (derived — no assumption).');
  lines.push('');
  for (const unitId of orderedUnits) {
    const unitRecords = byUnit.get(unitId) ?? [];
    const first = unitRecords[0];
    lines.push(`### ${unitId} — ${first?.unitTitle ?? ''}`);
    lines.push('');
    for (const record of unitRecords) {
      lines.push(`- **${record.taskId}** — ${record.currentCard.currentExpectedAnswer}`);
      lines.push(`  - flags: ${flagListText(record)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
};

/**
 * Deterministic human-readable Markdown: summary, one section per card, then
 * the multi-card appendix. `baselineCommit` is a frozen value supplied by the
 * bundle, so output never contains a wall-clock.
 */
export const buildExamPrepRecallAuthoringMarkdown = (
  bundle: ExamPrepRecallAuthoringBundle,
  summary: ExamPrepRecallAuthoringSummary,
): string => {
  const lines: string[] = [];
  lines.push(`# ${EXAM_PREP_RECALL_AUTHORING_REPORT_TITLE}`);
  lines.push('');
  lines.push(
    'Deterministic, source-grounded HUMAN REVIEW preparation for the frozen Recall card pool (audit only — no content changes, all authoring fields intentionally empty).',
  );
  lines.push('');
  lines.push(`- baselineCommit: \`${bundle.baselineCommit}\``);
  lines.push(`- curriculumId: \`${bundle.curriculumId}\``);
  lines.push(`- manifest contentHash: \`${bundle.manifestContentHash}\``);
  lines.push(`- corpus contentHash: \`${bundle.corpusContentHash}\``);
  lines.push(`- generatedFrom: ${bundle.generatedFrom}`);
  lines.push(`- cards: ${summary.totalCards}`);
  lines.push('');
  lines.push(summarySection(summary));
  for (const record of bundle.records) {
    lines.push(recordSection(record));
  }
  lines.push(multiCardAppendix(bundle.records));
  return lines.join('\n');
};

/** Deterministic canonical JSON (pretty-printed) for the review bundle. */
export const serializeExamPrepRecallAuthoringJson = (
  bundle: ExamPrepRecallAuthoringBundle,
): string => `${JSON.stringify(bundle, null, 2)}\n`;
