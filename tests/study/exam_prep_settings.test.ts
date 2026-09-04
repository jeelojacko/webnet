import { describe, expect, it } from 'vitest';
import {
  createDefaultExamPrepSettings,
  normalizeExamPrepSettings,
  resolveExamPrepSettings,
  isExamPrepSettingsForBinding,
} from '../../src/study/examPrep/examPrepSettings';
import {
  EXAM_PREP_DEFAULT_MAX_RECALL_CARDS_PER_SESSION,
  EXAM_PREP_DEFAULT_NEW_RECALL_CARDS_PER_SESSION,
} from '../../src/study/examPrep/examPrepConstants';
import {
  archivedBinding,
  currentBinding,
  makeSettings,
} from './exam_prep_test_support';

describe('Exam Prep settings defaults, bounds, and hash binding', () => {
  it('defaults are 8 new cards and 20 max per session', () => {
    const record = createDefaultExamPrepSettings(currentBinding, '2026-09-05T00:00:00.000Z');
    expect(record.newRecallCardsPerSession).toBe(EXAM_PREP_DEFAULT_NEW_RECALL_CARDS_PER_SESSION);
    expect(record.maxRecallCardsPerSession).toBe(EXAM_PREP_DEFAULT_MAX_RECALL_CARDS_PER_SESSION);
    expect(record.id).toBe(currentBinding.curriculumContentHash);
    expect(record.curriculumId).toBe(currentBinding.curriculumId);
  });

  it('clamps new cards to [0,57] and max to [1,57]', () => {
    const normalized = normalizeExamPrepSettings(
      makeSettings({
        newRecallCardsPerSession: 99,
        maxRecallCardsPerSession: 0,
      }),
    );
    expect(normalized.newRecallCardsPerSession).toBe(1);
    expect(normalized.maxRecallCardsPerSession).toBe(1);
    const negative = normalizeExamPrepSettings(
      makeSettings({
        newRecallCardsPerSession: -3,
        maxRecallCardsPerSession: -7,
      }),
    );
    expect(negative.newRecallCardsPerSession).toBe(0);
    expect(negative.maxRecallCardsPerSession).toBe(1);
  });

  it('ensures new <= max', () => {
    const normalized = normalizeExamPrepSettings(
      makeSettings({ newRecallCardsPerSession: 30, maxRecallCardsPerSession: 10 }),
    );
    expect(normalized.newRecallCardsPerSession).toBe(10);
    expect(normalized.maxRecallCardsPerSession).toBe(10);
  });

  it('resolves archived/current settings records by content hash', () => {
    const current = makeSettings({ newRecallCardsPerSession: 4, maxRecallCardsPerSession: 9 });
    const archived = makeSettings(
      { newRecallCardsPerSession: 1, maxRecallCardsPerSession: 3 },
      archivedBinding,
    );
    const resolvedCurrent = resolveExamPrepSettings(
      [archived, current],
      currentBinding,
      '2026-09-05T00:00:00.000Z',
    );
    expect(resolvedCurrent.id).toBe(currentBinding.curriculumContentHash);
    expect(resolvedCurrent.newRecallCardsPerSession).toBe(4);
    expect(resolvedCurrent.maxRecallCardsPerSession).toBe(9);
    const resolvedArchived = resolveExamPrepSettings(
      [archived, current],
      archivedBinding,
      '2026-09-05T00:00:00.000Z',
    );
    expect(resolvedArchived.id).toBe(archivedBinding.curriculumContentHash);
    expect(resolvedArchived.newRecallCardsPerSession).toBe(1);
  });

  it('falls back to defaults when no matching record exists', () => {
    const resolved = resolveExamPrepSettings([], currentBinding, '2026-09-05T00:00:00.000Z');
    expect(resolved.newRecallCardsPerSession).toBe(8);
    expect(resolved.maxRecallCardsPerSession).toBe(20);
    expect(isExamPrepSettingsForBinding(resolved, currentBinding)).toBe(true);
  });
});
