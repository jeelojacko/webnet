// Exam Prep Phase 2 — Recognition and Locate practice-queue determinism.
//
// Both sprints share `buildExamPrepPracticeQueue`: a 10-item session capped by
// frozen 4/3/2/1 tier quotas (A 4 / B 3 / NAV 2 / C+D 1, DRILL excluded),
// missed items first, then unattempted, then last-got-it, weight-ranked and
// canonically tie-broken inside a bucket. These tests pin the fresh-learner
// order and prove current-hash-only filtering plus repeat-fill behavior.

import { describe, expect, it } from 'vitest';
import { buildExamPrepLocateQueue } from '../../src/study/examPrep/examPrepLocateQueue';
import { buildExamPrepRecognitionQueue } from '../../src/study/examPrep/examPrepRecognitionQueue';
import {
  buildLocateMetrics,
  buildRecognitionMetrics,
} from '../../src/study/examPrep/examPrepAttemptSelectors';
import { EXAM_PREP_LOCATE_TASKS } from '../../src/study/examPrep/examPrepLocateTasks';
import { EXAM_PREP_RECOGNITION_TASKS } from '../../src/study/examPrep/examPrepRecognitionTasks';
import type { ExamPrepLocateTask } from '../../src/study/examPrep/examPrepTypes';
import {
  archivedBinding,
  currentBinding,
  makeLocateAttempt,
  makeRecognitionAttempt,
  otherCurriculumBinding,
} from './exam_prep_test_support';

describe('Exam Prep Recognition queue (frozen 10-item 4/3/2/1 sprint)', () => {
  it('freezes exactly 10 tasks with A4/B3/NAV2/C1 (no D, no DRILL) for a fresh learner', () => {
    const queue = buildExamPrepRecognitionQueue([]);
    expect(queue).toHaveLength(10);
    const tiers = queue.reduce<Record<string, number>>((acc, task) => {
      acc[task.tier] = (acc[task.tier] ?? 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ A: 4, B: 3, NAV: 2, C: 1 });
    expect(queue.some((task) => task.tier === 'DRILL')).toBe(false);
    expect(queue.every((task) => task.id.startsWith('recognition:'))).toBe(true);
  });

  it('fresh order is deterministic and pinned', () => {
    const queue = buildExamPrepRecognitionQueue([]);
    expect(queue.map((task) => task.id)).toEqual([
      'recognition:A-NBLS-01:1',
      'recognition:A-BYL-01:1',
      'recognition:A-SURV-01:1',
      'recognition:A-BCA-01:1',
      'recognition:B-CLF-01:1',
      'recognition:B-HWY-01:1',
      'recognition:B-AGRI-01:1',
      'recognition:NAV-01:1',
      'recognition:NAV-02:1',
      'recognition:C-ARCH-01:1',
    ]);
    expect(buildExamPrepRecognitionQueue([]).map((task) => task.id)).toEqual(
      queue.map((task) => task.id),
    );
  });

  it('ignores archived and other-curriculum recognition attempts', () => {
    const first = EXAM_PREP_RECOGNITION_TASKS[0];
    if (!first) throw new Error('expected recognition tasks');
    const attempts = [
      makeRecognitionAttempt({
        id: 'archived-1',
        taskId: first.id,
        unitId: first.unitId,
        result: 'got_it',
        binding: archivedBinding,
      }),
      makeRecognitionAttempt({
        id: 'other-1',
        taskId: first.id,
        unitId: first.unitId,
        result: 'got_it',
        binding: otherCurriculumBinding,
      }),
    ];
    expect(buildExamPrepRecognitionQueue(attempts).map((task) => task.id)).toEqual(
      buildExamPrepRecognitionQueue([]).map((task) => task.id),
    );
  });

  it('ranks missed-before-unattempted-before-got-it inside each quota bucket', () => {
    const a0 = EXAM_PREP_RECOGNITION_TASKS.find((task) => task.id === 'recognition:A-NBLS-01:1');
    const a1 = EXAM_PREP_RECOGNITION_TASKS.find((task) => task.id === 'recognition:A-BYL-01:1');
    const b0 = EXAM_PREP_RECOGNITION_TASKS.find((task) => task.id === 'recognition:B-CLF-01:1');
    if (!a0 || !a1 || !b0) throw new Error('expected tasks');
    const attempts = [
      makeRecognitionAttempt({
        id: 'a0-missed',
        taskId: a0.id,
        unitId: a0.unitId,
        result: 'missed',
        completedAt: '2026-09-04T00:00:00.000Z',
        binding: currentBinding,
      }),
      makeRecognitionAttempt({
        id: 'a1-got',
        taskId: a1.id,
        unitId: a1.unitId,
        result: 'got_it',
        completedAt: '2026-09-05T00:00:00.000Z',
        binding: currentBinding,
      }),
      makeRecognitionAttempt({
        id: 'b0-got',
        taskId: b0.id,
        unitId: b0.unitId,
        result: 'got_it',
        completedAt: '2026-09-05T00:00:00.000Z',
        binding: currentBinding,
      }),
    ];
    const queue = buildExamPrepRecognitionQueue(attempts);
    // A bucket: a0 (missed) leads, followed by unattempted A tasks; the
    // got-it a1 never refills the first sprint because 3 fresh A remain.
    expect(queue[0]?.id).toBe(a0.id);
    expect(queue.some((task) => task.id === a1.id)).toBe(false);
    // B bucket: the got-it b0 drops behind the unattempted B tasks.
    const bIndex = queue.findIndex((task) => task.tier === 'B');
    expect(bIndex).toBeGreaterThanOrEqual(0);
    expect(queue[bIndex]?.id).not.toBe(b0.id);
    // Deterministic under the same attempt history.
    expect(buildExamPrepRecognitionQueue(attempts).map((task) => task.id)).toEqual(
      queue.map((task) => task.id),
    );
  });
});

describe('Exam Prep Locate queue (frozen 10-item 4/3/2/1 sprint)', () => {
  it('freezes exactly 10 tasks with A4/B3/NAV2/C1 (no D, no DRILL) for a fresh learner', () => {
    const queue = buildExamPrepLocateQueue([]);
    expect(queue).toHaveLength(10);
    const tiers = queue.reduce<Record<string, number>>((acc, task) => {
      acc[task.tier] = (acc[task.tier] ?? 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ A: 4, B: 3, NAV: 2, C: 1 });
    expect(queue.some((task) => task.tier === 'DRILL')).toBe(false);
    expect(queue.every((task) => task.id.startsWith('locate:'))).toBe(true);
  });

  it('fresh order is deterministic and pinned', () => {
    const queue = buildExamPrepLocateQueue([]);
    expect(queue.map((task) => task.id)).toEqual([
      'locate:A-NBLS-02:1',
      'locate:A-NBLS-03:1',
      'locate:A-NBLS-05:1',
      'locate:A-BYL-01:1',
      'locate:B-AIR-02:1',
      'locate:B-CWA-02:1',
      'locate:B-CONDO-01:1',
      'locate:NAV-01:1',
      'locate:NAV-02:1',
      'locate:C-ARCH-01:1',
    ]);
    expect(buildExamPrepLocateQueue([]).map((task) => task.id)).toEqual(
      queue.map((task) => task.id),
    );
  });

  it('ignores archived and other-curriculum locate attempts', () => {
    const first = EXAM_PREP_LOCATE_TASKS[0];
    if (!first) throw new Error('expected locate tasks');
    const attempts = [
      makeLocateAttempt({
        id: 'archived-1',
        taskId: first.id,
        unitId: first.unitId,
        result: 'found',
        binding: archivedBinding,
      }),
      makeLocateAttempt({
        id: 'other-1',
        taskId: first.id,
        unitId: first.unitId,
        result: 'found',
        binding: otherCurriculumBinding,
      }),
    ];
    expect(buildExamPrepLocateQueue(attempts).map((task) => task.id)).toEqual(
      buildExamPrepLocateQueue([]).map((task) => task.id),
    );
  });

  it('ranks a missed leader ahead of unattempted tasks and stays deterministic', () => {
    const leader = EXAM_PREP_LOCATE_TASKS.find((task) => task.id === 'locate:A-NBLS-02:1');
    if (!leader) throw new Error('expected locate task');
    const attempts = [
      makeLocateAttempt({
        id: 'leader-missed',
        taskId: leader.id,
        unitId: leader.unitId,
        result: 'missed',
        completedAt: '2026-09-04T00:00:00.000Z',
        binding: currentBinding,
      }),
    ];
    const queue = buildExamPrepLocateQueue(attempts);
    expect(queue[0]?.id).toBe(leader.id);
    expect(buildExamPrepLocateQueue(attempts).map((task) => task.id)).toEqual(
      queue.map((task) => task.id),
    );
  });
});

describe('buildExamPrepPracticeQueue quota mechanics (synthetic pools)', () => {
  const locateTask = (
    id: string,
    tier: ExamPrepLocateTask['tier'],
    unitId: string,
    curriculumIndex: number,
  ): ExamPrepLocateTask => ({
    id,
    unitId,
    unitTitle: `unit ${unitId}`,
    tier,
    reviewWeight: 'high',
    curriculumIndex,
    lookupIndex: 1,
    prompt: 'find',
    expectedDocumentId: 'doc',
    expectedSourceKey: null,
  });

  it('returns every task when the pool has fewer than 10 items', () => {
    const tasks = [
      locateTask('a1', 'A', 'u1', 0),
      locateTask('a2', 'A', 'u1', 1),
      locateTask('b1', 'B', 'u2', 2),
    ];
    const queue = buildExamPrepLocateQueue([], tasks);
    expect(queue.map((entry) => entry.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('fills a quota bucket from repeated units only after every distinct unit is taken', () => {
    const tasks = [
      locateTask('a1', 'A', 'u1', 0),
      locateTask('a2', 'A', 'u1', 1),
      locateTask('a3', 'A', 'u2', 2),
      locateTask('a4', 'A', 'u2', 3),
      locateTask('b1', 'B', 'u3', 4),
      locateTask('n1', 'NAV', 'u4', 5),
      locateTask('n2', 'NAV', 'u5', 6),
      locateTask('c1', 'C', 'u6', 7),
    ];
    const queue = buildExamPrepLocateQueue([], tasks);
    // distinct-unit pass takes a1 + a3, then the repeat pass fills a2 + a4.
    expect(queue.map((entry) => entry.id)).toEqual([
      'a1',
      'a3',
      'a2',
      'a4',
      'b1',
      'n1',
      'n2',
      'c1',
    ]);
  });

  it('consumes the single CD quota slot with C before D and only then lets D fill the tail', () => {
    const withC = [
      locateTask('a1', 'A', 'u1', 0),
      locateTask('b1', 'B', 'u2', 1),
      locateTask('n1', 'NAV', 'u3', 2),
      locateTask('c1', 'C', 'u4', 3),
      locateTask('d1', 'D', 'u5', 4),
    ];
    const queueWithC = buildExamPrepLocateQueue([], withC);
    expect(queueWithC.map((task) => task.id)).toEqual(['a1', 'b1', 'n1', 'c1', 'd1']);
    expect(queueWithC.indexOf(queueWithC.find((t) => t.id === 'c1') ?? queueWithC[0])).toBeLessThan(
      queueWithC.indexOf(queueWithC.find((t) => t.id === 'd1') ?? queueWithC[0]),
    );

    const withoutC = [
      locateTask('a1', 'A', 'u1', 0),
      locateTask('b1', 'B', 'u2', 1),
      locateTask('n1', 'NAV', 'u3', 2),
      locateTask('d1', 'D', 'u4', 3),
    ];
    const queueNoC = buildExamPrepLocateQueue([], withoutC);
    expect(queueNoC.map((task) => task.id)).toEqual(['a1', 'b1', 'n1', 'd1']);
  });

  it('is deterministic for identical synthetic inputs', () => {
    const tasks = [
      locateTask('a1', 'A', 'u1', 0),
      locateTask('b1', 'B', 'u2', 1),
      locateTask('n1', 'NAV', 'u3', 2),
      locateTask('c1', 'C', 'u4', 3),
    ];
    expect(buildExamPrepLocateQueue([], tasks)).toEqual(buildExamPrepLocateQueue([], tasks));
  });
});

describe('Recognition / Locate current-hash metrics', () => {
  it('buildRecognitionMetrics uses only the latest current-hash attempt per task', () => {
    const a0 = EXAM_PREP_RECOGNITION_TASKS.find((task) => task.id === 'recognition:A-NBLS-01:1');
    const a1 = EXAM_PREP_RECOGNITION_TASKS.find((task) => task.id === 'recognition:A-BYL-01:1');
    if (!a0 || !a1) throw new Error('expected recognition tasks');
    const attempts = [
      makeRecognitionAttempt({
        id: 'a0-old-miss',
        taskId: a0.id,
        unitId: a0.unitId,
        result: 'missed',
        completedAt: '2026-09-04T00:00:00.000Z',
      }),
      makeRecognitionAttempt({
        id: 'a0-new-got',
        taskId: a0.id,
        unitId: a0.unitId,
        result: 'got_it',
        completedAt: '2026-09-05T00:00:00.000Z',
      }),
      makeRecognitionAttempt({
        id: 'a1-got',
        taskId: a1.id,
        unitId: a1.unitId,
        result: 'got_it',
        completedAt: '2026-09-06T00:00:00.000Z',
      }),
      makeRecognitionAttempt({
        id: 'archived',
        taskId: a1.id,
        unitId: a1.unitId,
        result: 'missed',
        completedAt: '2026-09-07T00:00:00.000Z',
        binding: archivedBinding,
      }),
    ];
    const metrics = buildRecognitionMetrics(attempts);
    expect(metrics).toEqual({ attemptedTasks: 2, correctLatestTasks: 2, accuracy: 1 });
  });

  it('buildLocateMetrics uses only the latest current-hash attempt per task', () => {
    const a0 = EXAM_PREP_LOCATE_TASKS.find((task) => task.id === 'locate:A-NBLS-02:1');
    if (!a0) throw new Error('expected locate task');
    const attempts = [
      makeLocateAttempt({
        id: 'a0-miss',
        taskId: a0.id,
        unitId: a0.unitId,
        result: 'missed',
        completedAt: '2026-09-04T00:00:00.000Z',
      }),
      makeLocateAttempt({
        id: 'archived-found',
        taskId: a0.id,
        unitId: a0.unitId,
        result: 'found',
        completedAt: '2026-09-08T00:00:00.000Z',
        binding: archivedBinding,
      }),
    ];
    const metrics = buildLocateMetrics(attempts);
    expect(metrics).toEqual({ attemptedTasks: 1, foundLatestTasks: 0, accuracy: 0 });
  });
});
