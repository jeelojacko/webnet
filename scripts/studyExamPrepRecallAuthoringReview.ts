// Study Exam Prep — deterministic Recall authoring-review bundle writer.
//
// Emits `reports/exam-prep/recall-authoring-review.json` and
// `reports/exam-prep/recall-authoring-review.md` for human authoring review of
// the frozen 57-card Recall pool. Deterministic: frozen baseline metadata, no
// wall clock, no RNG, byte-identical reruns. Reads frozen pools only — never
// rewrites curriculum, storage, schema, or the existing
// `recall-quality-audit.md`. This is development/QA tooling; nothing here is
// imported by the learner UI.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExamPrepRecallAuthoringBundle,
  buildExamPrepRecallAuthoringSummary,
} from '../src/study/examPrep/qa/examPrepRecallAuthoringReview';
import {
  buildExamPrepRecallAuthoringMarkdown,
  serializeExamPrepRecallAuthoringJson,
} from '../src/study/examPrep/qa/examPrepRecallAuthoringReport';

const REPORTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'exam-prep');
const JSON_REPORT = join(REPORTS_DIR, 'recall-authoring-review.json');
const MARKDOWN_REPORT = join(REPORTS_DIR, 'recall-authoring-review.md');

const run = (): void => {
  const bundle = buildExamPrepRecallAuthoringBundle();
  const summary = buildExamPrepRecallAuthoringSummary(bundle.records);

  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(JSON_REPORT, serializeExamPrepRecallAuthoringJson(bundle), 'utf8');
  writeFileSync(MARKDOWN_REPORT, buildExamPrepRecallAuthoringMarkdown(bundle, summary), 'utf8');

  console.log(`Wrote ${JSON_REPORT}`);
  console.log(`Wrote ${MARKDOWN_REPORT}`);
  console.log(
    `  ${summary.totalCards} recall cards audited (genericPrompt ${summary.counts.genericPrompt}, multiRecallUnit ${summary.counts.multiRecallUnit}, fragmentLike ${summary.counts.fragmentLike}, longAnswer ${summary.counts.longAnswer}, veryLongAnswer ${summary.counts.veryLongAnswer}, numericDetail ${summary.counts.numericDetail}, exceptionLanguage ${summary.counts.exceptionLanguage}, multipleConcepts ${summary.counts.multipleConcepts}, answerOverlapsLocate ${summary.counts.answerOverlapsLocate})`,
  );
};

run();
