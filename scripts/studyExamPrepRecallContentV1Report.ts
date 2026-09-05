// Study Exam Prep — deterministic Recall Content V1 QA report writer.
//
// Emits `reports/exam-prep/recall-content-v1-review.md`: one section per
// authored V1 card (57, canonical order) plus the QA summary. Deterministic:
// frozen inputs only, no wall clock, no RNG, byte-identical reruns. Never
// rewrites curriculum, storage, schema, or the historical
// `recall-authoring-review.*` / `recall-quality-audit.md` artifacts. This is
// development/QA tooling; nothing here is imported by the learner UI.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExamPrepRecallContentV1Markdown,
  buildExamPrepRecallContentV1Summary,
  deriveExamPrepRecallContentV1Records,
} from '../src/study/examPrep/qa/examPrepRecallContentV1Report';

const REPORTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'exam-prep');
const MARKDOWN_REPORT = join(REPORTS_DIR, 'recall-content-v1-review.md');

const run = (): void => {
  const records = deriveExamPrepRecallContentV1Records();
  const summary = buildExamPrepRecallContentV1Summary(records);

  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(MARKDOWN_REPORT, buildExamPrepRecallContentV1Markdown(records, summary), 'utf8');

  console.log(`Wrote ${MARKDOWN_REPORT}`);
  console.log(
    `  ${summary.totalCards} recall cards reviewed (${summary.specificPrompts} specific prompts, ${summary.canonicalAnswers} canonical answers, ${summary.answerOverrides} answer overrides, ${summary.genericLearnerPrompts} generic prompts)`,
  );
};

run();
