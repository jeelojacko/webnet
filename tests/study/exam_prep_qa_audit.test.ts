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
  RECOGNITION_QA_FLAGS_TEXT,
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

  it('extended recognition flags: short NAV cues, generic legal nouns, cross-unit duplicates', () => {
    const rows = buildRecognitionQaRows(EXAM_PREP_RECOGNITION_TASKS);
    const counts = recognitionAuditCounts(rows);
    // Every duplicated cue in the frozen pool spans different expected units.
    expect(counts.crossUnitDuplicates).toBe(rows.filter((row) => row.duplicateOf.length > 0).length);
    expect(counts.crossUnitDuplicates).toBe(32);
    // Short NAV routing cues (<= 3 words) across the 12 NAV units.
    expect(counts.shortNav).toBe(114);
    const shortNavRows = rows.filter((row) => row.shortNavCue);
    for (const row of shortNavRows) {
      expect(row.tierLabel).toBe('Navigation');
      expect(row.wordCount).toBeLessThanOrEqual(3);
    }
    // Generic legal nouns: exact normalized match only (deed x2, transfer x1).
    expect(counts.genericNoun).toBe(3);
    const genericRows = rows.filter((row) => row.genericNounCue);
    expect(genericRows.map((row) => row.cue).sort()).toEqual(['deed', 'deed', 'transfer']);
    // A longer useful cue containing a generic word is NOT flagged.
    const surveyBordering = rows.find((row) => row.cue === 'survey bordering Crown land');
    expect(surveyBordering?.genericNounCue ?? false).toBe(false);
    // Flag text carries the machine-readable qualifiers.
    const deedRow = rows.find((row) => row.id === 'recognition:NAV-01:1');
    expect(deedRow?.genericNounCue).toBe(true);
    expect(deedRow ? RECOGNITION_QA_FLAGS_TEXT(deedRow) : '').toContain('generic legal noun cue');
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
    // Extended summary lines.
    expect(recognitionMarkdown).toContain('duplicate cues across different expected units');
    expect(recognitionMarkdown).toContain('short NAV cues (<=3 words)');
    expect(recognitionMarkdown).toContain('generic legal noun cue (exact normalized match)');
    for (const row of buildRecognitionQaRows(EXAM_PREP_RECOGNITION_TASKS)) {
      expect(recognitionMarkdown).toContain(row.id);
    }
    // Byte-determinism for a fixed manifest (same input => same string).
    expect(buildRecognitionQaMarkdown(EXAM_PREP_RECOGNITION_TASKS)).toBe(recognitionMarkdown);
    expect(buildRecallQaMarkdown(EXAM_PREP_RECALL_TASKS)).toBe(recallMarkdown);
  });
});
