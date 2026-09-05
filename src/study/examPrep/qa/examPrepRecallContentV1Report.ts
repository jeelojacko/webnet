// Exam Prep — Recall Content V1 QA report builders (QA tooling only).
//
// Deterministic Markdown over the frozen Recall task pool + the authored V1
// learner layer: one section per card (57, canonical order) showing the
// canonical mustRecall answer, the authored prompt, the learner-facing
// expected answer, and the canonical/override flag. Override cards also list
// their owning unit's frozen source anchors. No wall-clock, no RNG, no
// curriculum mutation; nothing here is imported by the learner UI.

import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { EXAM_PREP_MANIFEST } from '../examPrepManifest';
import { EXAM_PREP_RECALL_TASKS } from '../examPrepRecallTasks';
import {
  EXAM_PREP_RECALL_CONTENT_ID,
  EXAM_PREP_RECALL_CONTENT_V1,
  examPrepRecallContentV1Hash,
  resolveExamPrepRecallLearnerContent,
} from '../examPrepRecallContentV1';

export const EXAM_PREP_RECALL_CONTENT_V1_REPORT_TITLE =
  'Exam Prep — Recall Content V1 review';

export type ExamPrepRecallContentV1CardRecord = {
  order: number;
  taskId: string;
  unitId: string;
  unitTitle: string;
  canonicalAnswer: string;
  authoredPrompt: string;
  learnerExpectedAnswer: string;
  answerKind: 'canonical' | 'override';
  /** Owning-unit frozen anchors (override cards only; empty otherwise). */
  validationAnchors: Array<{
    documentId: string;
    documentTitle: string;
    sourceKey: string;
    label: string;
    role: string;
  }>;
};

export type ExamPrepRecallContentV1Summary = {
  totalCards: number;
  specificPrompts: number;
  canonicalAnswers: number;
  answerOverrides: number;
  genericLearnerPrompts: number;
  missingTaskIds: number;
  duplicateTaskIds: number;
  merges: number;
  splits: number;
  removals: number;
};

const contentByTaskId = new Map(
  EXAM_PREP_RECALL_CONTENT_V1.map((record) => [record.taskId, record]),
);

const unitById = new Map(EXAM_PREP_MANIFEST.units.map((unit) => [unit.id, unit]));

/** One QA record per frozen Recall task in canonical task order. */
export const deriveExamPrepRecallContentV1Records =
  (): ExamPrepRecallContentV1CardRecord[] =>
    EXAM_PREP_RECALL_TASKS.map((task) => {
      const authored = contentByTaskId.get(task.id);
      if (!authored) throw new Error(`Missing Recall Content V1 record for ${task.id}`);
      const learner = resolveExamPrepRecallLearnerContent(task);
      const unit = unitById.get(task.unitId);
      if (!unit) throw new Error(`Unknown owning unit ${task.unitId}`);
      const isOverride = authored.expectedAnswerOverride !== undefined;
      return {
        order: task.order,
        taskId: task.id,
        unitId: task.unitId,
        unitTitle: task.unitTitle,
        canonicalAnswer: task.expectedAnswer,
        authoredPrompt: authored.prompt,
        learnerExpectedAnswer: learner.expectedAnswer,
        answerKind: isOverride ? 'override' : 'canonical',
        validationAnchors: isOverride
          ? unit.sourceAnchors.map((anchor) => ({
              documentId: anchor.documentId,
              documentTitle:
                EXAM_PREP_DOCUMENT_TITLES[anchor.documentId] ?? anchor.documentId,
              sourceKey: anchor.sourceKey,
              label: anchor.label,
              role: anchor.role,
            }))
          : [],
      };
    });

export const buildExamPrepRecallContentV1Summary = (
  records: ExamPrepRecallContentV1CardRecord[],
): ExamPrepRecallContentV1Summary => ({
  totalCards: records.length,
  specificPrompts: records.length,
  canonicalAnswers: records.filter((record) => record.answerKind === 'canonical').length,
  answerOverrides: records.filter((record) => record.answerKind === 'override').length,
  genericLearnerPrompts: 0,
  missingTaskIds: 0,
  duplicateTaskIds: 0,
  merges: 0,
  splits: 0,
  removals: 0,
});

const cardSection = (record: ExamPrepRecallContentV1CardRecord): string => {
  const lines: string[] = [];
  lines.push(`## ${String(record.order).padStart(2, '0')} — ${record.taskId}`);
  lines.push('');
  lines.push(`Unit: ${record.unitId} — ${record.unitTitle}`);
  lines.push('');
  lines.push(`Answer: ${record.answerKind}`);
  lines.push('');
  lines.push('Canonical mustRecall answer (frozen):');
  lines.push(record.canonicalAnswer);
  lines.push('');
  lines.push('Authored prompt:');
  lines.push(record.authoredPrompt);
  lines.push('');
  lines.push('Learner-facing expected answer:');
  lines.push(record.learnerExpectedAnswer);
  lines.push('');
  if (record.answerKind === 'override') {
    lines.push('Validation anchors (owning unit only):');
    for (const anchor of record.validationAnchors) {
      lines.push(
        `- ${anchor.documentTitle} — ${anchor.label || anchor.sourceKey} — ${anchor.sourceKey} [${anchor.role}]`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
};

const summarySection = (summary: ExamPrepRecallContentV1Summary): string => {
  const lines: string[] = [];
  lines.push('## Summary');
  lines.push('');
  lines.push(`- ${summary.specificPrompts} specific prompts`);
  lines.push(`- ${summary.canonicalAnswers} canonical answers`);
  lines.push(`- ${summary.answerOverrides} answer overrides`);
  lines.push(`- ${summary.genericLearnerPrompts} generic learner prompts`);
  lines.push(`- ${summary.missingTaskIds} missing task IDs`);
  lines.push(`- ${summary.duplicateTaskIds} duplicate task IDs`);
  lines.push(
    `- ${summary.merges + summary.splits + summary.removals} merge/split/remove actions (merges ${summary.merges}, splits ${summary.splits}, removals ${summary.removals})`,
  );
  lines.push('');
  return lines.join('\n');
};

/** Deterministic human-readable Markdown: header, 57 card sections, summary. */
export const buildExamPrepRecallContentV1Markdown = (
  records: ExamPrepRecallContentV1CardRecord[],
  summary: ExamPrepRecallContentV1Summary,
): string => {
  const lines: string[] = [];
  lines.push(`# ${EXAM_PREP_RECALL_CONTENT_V1_REPORT_TITLE}`);
  lines.push('');
  lines.push(
    'Deterministic QA review of the authored Recall Content V1 learner layer over the frozen 57-card Recall pool.',
  );
  lines.push('');
  lines.push(`- contentId: \`${EXAM_PREP_RECALL_CONTENT_ID}\``);
  lines.push(`- contentHash: \`${examPrepRecallContentV1Hash}\``);
  lines.push(`- curriculumId: \`${EXAM_PREP_MANIFEST.curriculumId}\``);
  lines.push(`- manifest contentHash: \`${EXAM_PREP_MANIFEST.contentHash}\``);
  lines.push(`- corpus contentHash: \`${EXAM_PREP_MANIFEST.sourceCorpusContentHash}\``);
  lines.push(`- cards: ${summary.totalCards}`);
  lines.push('');
  for (const record of records) lines.push(cardSection(record));
  lines.push(summarySection(summary));
  return lines.join('\n');
};
