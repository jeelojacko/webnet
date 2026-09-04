// Exam Prep — deterministic Recall (57) / Recognition (317) QA audit.

import { describe, expect, it } from 'vitest';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_RECOGNITION_TASKS } from '../../src/study/examPrep/examPrepRecognitionTasks';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import {
  buildRecallQaRows,
  buildRecallQaMarkdown,
  buildRecognitionQaRows,
  buildRecognitionQaMarkdown,
  recallAuditCounts,
  recognitionAuditCounts,
} from '../../src/study/examPrep/qa/examPrepQaAudit';

describe('Exam Prep QA audit (deterministic reports)', () => {
  it('covers exactly the 57 frozen recall cards with mechanical flags', () => {
    const rows = buildRecallQaRows(EXAM_PREP_RECALL_TASKS);
    expect(rows).toHaveLength(57);
    const counts = recallAuditCounts(rows);
    expect(counts.total).toBe(57);
    // Real frozen pools: 10 fragment-flagged rows; 5 over 240 chars.
    expect(counts.fragments).toBe(10);
    expect(counts.long).toBe(5);
    const first = rows[0];
    expect(first?.id).toBe('recall:A-NBLS-01:1');
    expect(first?.order).toBe(1);
    expect(typeof first?.charCount).toBe('number');
    expect(typeof first?.wordCount).toBe('number');
    // Fragment-flag semantics are mechanical: starts-lowercase or trailing ;.
    const fragIds = rows.filter((row) => row.fragmentFlag).map((row) => row.id);
    expect(fragIds).toContain('recall:A-NBLS-01:1');
    expect(fragIds).toContain('recall:A-SURV-03:1');
  });

  it('covers exactly the 317 frozen recognition cues with mechanical flags', () => {
    const rows = buildRecognitionQaRows(EXAM_PREP_RECOGNITION_TASKS);
    expect(rows).toHaveLength(317);
    const counts = recognitionAuditCounts(rows);
    expect(counts.total).toBe(317);
    // Real frozen pools: duplicate-cue tasks, short, long.
    expect(rows.filter((row) => row.duplicateOf.length > 0).length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.veryShortCue).length).toBeGreaterThan(0);
    const flagged = rows.filter((row) => row.veryShortCue);
    expect(flagged[0]?.cue.trim().length).toBeLessThanOrEqual(5);
  });

  it('flags duplicate cues across units deterministically', () => {
    const rows = buildRecognitionQaRows(EXAM_PREP_RECOGNITION_TASKS);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const watercourse = rows.filter((row) => row.cue === 'watercourse');
    expect(watercourse.length).toBeGreaterThanOrEqual(2);
    for (const row of watercourse) {
      expect(row.duplicateOf.length).toBe(watercourse.length - 1);
    }
    for (const row of watercourse.slice(1)) {
      expect(byId.get(row.id)?.duplicateOf).toContain(watercourse[0]?.id);
    }
  });

  it('renders deterministic Markdown including the A-SURV-03 human-review note', () => {
    const recallMarkdown = buildRecallQaMarkdown(EXAM_PREP_RECALL_TASKS);
    expect(recallMarkdown).toContain(`cards audited: 57`);
    expect(recallMarkdown).toContain(`manifest contentHash: \`${EXAM_PREP_MANIFEST.contentHash}\``);
    expect(recallMarkdown).toContain('## A-SURV-03 — human review note');
    expect(recallMarkdown).toContain('`recall:A-SURV-03:1`');
    expect(recallMarkdown).toContain('`recall:A-SURV-03:2`');
    expect(recallMarkdown).toContain('`recall:A-SURV-03:3`');
    expect(recallMarkdown).toContain('intentionally NOT merged or reworded');
    expect(recallMarkdown).toContain('absent from the Recognition pool (317)');
    // Row-level data for all 57.
    for (const row of buildRecallQaRows(EXAM_PREP_RECALL_TASKS)) {
      expect(recallMarkdown).toContain(row.id);
    }

    const recognitionMarkdown = buildRecognitionQaMarkdown(EXAM_PREP_RECOGNITION_TASKS);
    expect(recognitionMarkdown).toContain(`cues audited: 317`);
    for (const row of buildRecognitionQaRows(EXAM_PREP_RECOGNITION_TASKS)) {
      expect(recognitionMarkdown).toContain(row.id);
    }
    // Byte-determinism for a fixed manifest (same input => same string).
    expect(buildRecognitionQaMarkdown(EXAM_PREP_RECOGNITION_TASKS)).toBe(recognitionMarkdown);
    expect(buildRecallQaMarkdown(EXAM_PREP_RECALL_TASKS)).toBe(recallMarkdown);
  });
});
