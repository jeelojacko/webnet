// Exam Prep Phase 2 — drill self-assessment readiness and local-date helpers.
//
// `buildExamPrepDrillStats` turns the immutable drill-attempt history of one
// drill task into a readiness status ladder: unattempted → developing (never
// perfect) → accurate (latest perfect) → exam_ready (perfect within the time
// target on two distinct local practice dates). Only current-hash attempts
// count; elapsed seconds freeze at reveal; dates use the machine-local
// calendar day via `formatExamPrepLocalDate`.

import { describe, expect, it } from 'vitest';
import { formatExamPrepLocalDate } from '../../src/study/examPrep/examPrepLocalDate';
import { buildExamPrepDrillStats, buildDrillMetrics } from '../../src/study/examPrep/examPrepDrillStats';
import { buildDrillAttempt } from '../../src/study/examPrep/examPrepAttemptBuilders';
import { archivedBinding, currentBinding, makeDrillAttempt } from './exam_prep_test_support';
import { DRILL_DIFFICULTY_LABELS, formatExamDrillTime } from '../../src/study/examPrep/examPrepFormat';

const drillTaskId = 'drill:DRILL-01';
const unitId = 'DRILL-01';

const perfect = (overrides: Partial<Parameters<typeof makeDrillAttempt>[0]> = {}) =>
  makeDrillAttempt({
    id: 'd1',
    taskId: drillTaskId,
    unitId,
    elapsedSeconds: 60,
    targetSeconds: 90,
    lawIdentified: true,
    provisionLocated: true,
    substantiveAnswerComplete: true,
    ...overrides,
  });

describe('Exam Prep drill readiness status ladder', () => {
  it('reports unattempted when no drill attempts exist', () => {
    const stats = buildExamPrepDrillStats([], drillTaskId);
    expect(stats).toEqual({
      status: 'unattempted',
      attemptCount: 0,
      latestAttempt: null,
      latestScore: null,
      latestElapsedSeconds: null,
      bestCorrectElapsedSeconds: null,
      qualifyingPracticeDates: [],
    });
  });

  it('reports developing while no attempt is perfect (score 3)', () => {
    const attempts = [
      perfect({
        id: 'a1',
        lawIdentified: true,
        provisionLocated: true,
        substantiveAnswerComplete: false,
      }),
    ];
    const stats = buildExamPrepDrillStats(attempts, drillTaskId);
    expect(stats.status).toBe('developing');
    expect(stats.attemptCount).toBe(1);
    expect(stats.latestScore).toBe(2);
    expect(stats.bestCorrectElapsedSeconds).toBeNull();
    expect(stats.qualifyingPracticeDates).toEqual([]);
  });

  it('reports accurate when the latest attempt is perfect but not qualifying', () => {
    // score 3 but slower than the time target: not a qualifying practice.
    const attempts = [
      perfect({ id: 'a1', elapsedSeconds: 95, completedAt: '2026-09-05T12:00:00.000Z' }),
    ];
    const stats = buildExamPrepDrillStats(attempts, drillTaskId);
    expect(stats.status).toBe('accurate');
    expect(stats.bestCorrectElapsedSeconds).toBe(95);
    expect(stats.qualifyingPracticeDates).toEqual([]);
  });

  it('reports accurate with one qualifying practice date and exam_ready with two', () => {
    const one = [
      perfect({ id: 'a1', completedAt: '2026-09-05T12:00:00.000Z', practiceDate: '2026-09-05' }),
    ];
    expect(buildExamPrepDrillStats(one, drillTaskId).status).toBe('accurate');
    expect(buildExamPrepDrillStats(one, drillTaskId).qualifyingPracticeDates).toEqual([
      '2026-09-05',
    ]);

    const two = [
      perfect({ id: 'a1', completedAt: '2026-09-05T12:00:00.000Z', practiceDate: '2026-09-05' }),
      perfect({ id: 'a2', completedAt: '2026-09-06T12:00:00.000Z', practiceDate: '2026-09-06' }),
    ];
    const stats = buildExamPrepDrillStats(two, drillTaskId);
    expect(stats.status).toBe('exam_ready');
    expect(stats.qualifyingPracticeDates).toEqual(['2026-09-05', '2026-09-06']);
    expect(stats.bestCorrectElapsedSeconds).toBe(60);
    expect(stats.latestAttempt?.id).toBe('a2'); // latest by completedAt
  });

  it('deduplicates qualifying practice dates and keeps them sorted', () => {
    const attempts = [
      perfect({ id: 'a1', completedAt: '2026-09-06T08:00:00.000Z', practiceDate: '2026-09-06' }),
      perfect({ id: 'a2', completedAt: '2026-09-05T20:00:00.000Z', practiceDate: '2026-09-05' }),
      perfect({ id: 'a3', completedAt: '2026-09-06T21:00:00.000Z', practiceDate: '2026-09-06' }),
    ];
    const stats = buildExamPrepDrillStats(attempts, drillTaskId);
    expect(stats.status).toBe('exam_ready');
    expect(stats.qualifyingPracticeDates).toEqual(['2026-09-05', '2026-09-06']);
    expect(stats.attemptCount).toBe(3);
  });

  it('ignores archived-hash drill attempts and other drill task ids', () => {
    const archived = perfect({
      id: 'archived',
      completedAt: '2026-09-06T12:00:00.000Z',
      practiceDate: '2026-09-06',
      binding: archivedBinding,
    });
    const otherTask = perfect({
      id: 'other',
      taskId: 'drill:DRILL-02',
      unitId: 'DRILL-02',
      completedAt: '2026-09-07T12:00:00.000Z',
      practiceDate: '2026-09-07',
    });
    const stats = buildExamPrepDrillStats([archived, otherTask], drillTaskId);
    expect(stats.status).toBe('unattempted');
    expect(stats.attemptCount).toBe(0);
  });
});

describe('Exam Prep drill metrics and attempt builder', () => {
  it('buildDrillMetrics counts attempted and exam-ready drills over current-hash attempts', () => {
    const attempts = [
      perfect({ id: 'a1', taskId: 'drill:DRILL-01', unitId: 'DRILL-01' }),
      perfect({ id: 'a2', taskId: 'drill:DRILL-01', unitId: 'DRILL-01', completedAt: '2026-09-06T12:00:00.000Z', practiceDate: '2026-09-06' }),
      perfect({
        id: 'b1',
        taskId: 'drill:DRILL-02',
        unitId: 'DRILL-02',
        lawIdentified: true,
        provisionLocated: false,
        substantiveAnswerComplete: false,
      }),
      perfect({ id: 'archived', taskId: 'drill:DRILL-03', unitId: 'DRILL-03', binding: archivedBinding }),
    ];
    const metrics = buildDrillMetrics(attempts);
    expect(metrics).toEqual({ attemptedDrills: 2, examReadyDrills: 1 });
  });

  it('buildDrillAttempt computes score from the three self-assessment flags', () => {
    const attempt = buildDrillAttempt({
      attemptId: 'attempt-1',
      unitId: 'DRILL-01',
      taskId: 'drill:DRILL-01',
      difficulty: 'cross_document',
      answer: 'answer',
      elapsedSeconds: 200,
      targetSeconds: 240,
      lawIdentified: true,
      provisionLocated: false,
      substantiveAnswerComplete: true,
      practiceDate: '2026-09-05',
      completedAt: '2026-09-05T12:00:00.000Z',
    });
    expect(attempt).toMatchObject({
      id: 'attempt-1',
      kind: 'drill',
      curriculumId: currentBinding.curriculumId,
      curriculumContentHash: currentBinding.curriculumContentHash,
      taskId: 'drill:DRILL-01',
      unitId: 'DRILL-01',
      difficulty: 'cross_document',
      score: 2,
      practiceDate: '2026-09-05',
    });
    expect(attempt.answer).toBe('answer');
    expect(attempt.elapsedSeconds).toBe(200);
    expect(attempt.targetSeconds).toBe(240);
  });
});

describe('Exam Prep local-date and time formatting helpers', () => {
  it('formats local calendar dates zero-padded without UTC drift', () => {
    // Constructed from local parts so assertions hold under any machine TZ.
    expect(formatExamPrepLocalDate(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(formatExamPrepLocalDate(new Date(2026, 8, 5))).toBe('2026-09-05');
    expect(formatExamPrepLocalDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('formats drill elapsed seconds as M:SS', () => {
    expect(formatExamDrillTime(150)).toBe('2:30');
    expect(formatExamDrillTime(59)).toBe('0:59');
    expect(formatExamDrillTime(0)).toBe('0:00');
  });

  it('keeps drill difficulty labels stable', () => {
    expect(DRILL_DIFFICULTY_LABELS).toMatchObject({
      direct: expect.any(String),
      routing: expect.any(String),
      cross_document: expect.any(String),
    });
  });
});
