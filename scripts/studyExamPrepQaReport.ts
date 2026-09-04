// Study Exam Prep — deterministic Recall/Recognition QA report writer.
//
// Emits `reports/exam-prep/recall-quality-audit.md` (all 57 frozen Recall
// cards) and `reports/exam-prep/recognition-quality-audit.md` (all 317 frozen
// Recognition cues) from the bundled curriculum manifest. Deterministic: no
// wall clock, no RNG, byte-identical reruns. Reads frozen pools only — never
// rewrites curriculum, storage, or schema.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAM_PREP_RECALL_TASKS } from '../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_RECOGNITION_TASKS } from '../src/study/examPrep/examPrepRecognitionTasks';
import {
  buildRecallQaMarkdown,
  buildRecognitionQaMarkdown,
  recallAuditCounts,
  recognitionAuditCounts,
  buildRecallQaRows,
  buildRecognitionQaRows,
} from '../src/study/examPrep/qa/examPrepQaAudit';

const REPORTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'exam-prep');
const RECALL_REPORT = join(REPORTS_DIR, 'recall-quality-audit.md');
const RECOGNITION_REPORT = join(REPORTS_DIR, 'recognition-quality-audit.md');

const writeReport = (path: string, markdown: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, markdown, 'utf8');
};

const run = (): void => {
  const recallMarkdown = buildRecallQaMarkdown(EXAM_PREP_RECALL_TASKS);
  const recognitionMarkdown = buildRecognitionQaMarkdown(EXAM_PREP_RECOGNITION_TASKS);
  writeReport(RECALL_REPORT, recallMarkdown);
  writeReport(RECOGNITION_REPORT, recognitionMarkdown);

  const recall = recallAuditCounts(buildRecallQaRows(EXAM_PREP_RECALL_TASKS));
  const recognition = recognitionAuditCounts(buildRecognitionQaRows(EXAM_PREP_RECOGNITION_TASKS));
  console.log(`Wrote ${RECALL_REPORT}`);
  console.log(
    `  ${recall.total} recall cards audited (${recall.fragments} fragment, ${recall.long} long)`,
  );
  console.log(`Wrote ${RECOGNITION_REPORT}`);
  console.log(
    `  ${recognition.total} recognition cues audited (${recognition.duplicates} duplicate-cue groups, ${recognition.crossUnitDuplicates} cross-unit duplicates, ${recognition.shortNav} short NAV, ${recognition.genericNoun} generic nouns, ${recognition.veryShort} very short, ${recognition.long} long)`,
  );
};

run();
