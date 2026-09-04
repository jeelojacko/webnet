import { describe, expect, it } from 'vitest';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { buildExamPrepRecallQueue } from '../../src/study/examPrep/examPrepQueue';
import type { ExamPrepRecallProgress } from '../../src/study/examPrep/examPrepTypes';
import {
  archivedBinding,
  makeRecallProgress,
  otherCurriculumBinding,
  testCard,
} from './exam_prep_test_support';

const NOW = new Date('2026-09-10T00:00:00.000Z');
const at = (order: number) => EXAM_PREP_RECALL_TASKS[order];

describe('Exam Prep recall queue ordering and limits', () => {
  it('orders due cards earliest-first then priority-ranked new cards', () => {
    // Tasks: task0 due later, task1 due earlier, task2 new, task3 new.
    const lateDue = makeRecallProgress({
      taskId: at(0).id,
      unitId: at(0).unitId,
      card: testCard({ state: 'Review', due: '2026-09-09T23:00:00.000Z' }),
    });
    const earlyDue = makeRecallProgress({
      taskId: at(1).id,
      unitId: at(1).unitId,
      card: testCard({ state: 'Review', due: '2026-09-09T22:00:00.000Z' }),
    });
    const queue = buildExamPrepRecallQueue({
      progress: [lateDue, earlyDue],
      now: NOW,
      newRecallCardsPerSession: 4,
      maxRecallCardsPerSession: 20,
    });
    expect(queue).toHaveLength(6);
    expect(queue.slice(0, 2).map((item) => item.task.id)).toEqual([at(1).id, at(0).id]);
    expect(queue.slice(2).map((item) => item.task.id)).toEqual(
      [at(2).id, at(3).id, at(4).id, at(5).id],
    );
    expect(queue[0]?.progress?.taskId).toBe(at(1).id);
    expect(queue[2]?.progress).toBeNull(); // new
  });

  it('excludes future-due cards even when initialized', () => {
    const future = makeRecallProgress({
      taskId: at(0).id,
      unitId: at(0).unitId,
      card: testCard({ state: 'Review', due: '2026-10-01T00:00:00.000Z' }),
    });
    const queue = buildExamPrepRecallQueue({
      progress: [future],
      now: NOW,
      newRecallCardsPerSession: 8,
      maxRecallCardsPerSession: 20,
    });
    expect(queue.map((item) => item.task.id)).toEqual(
      EXAM_PREP_RECALL_TASKS.slice(1, 9).map((task) => task.id),
    );
  });

  it('respects the new-cards-per-session limit', () => {
    const queue = buildExamPrepRecallQueue({
      progress: [],
      now: NOW,
      newRecallCardsPerSession: 2,
      maxRecallCardsPerSession: 20,
    });
    expect(queue).toHaveLength(2);
    expect(queue.map((item) => item.task.id)).toEqual(
      EXAM_PREP_RECALL_TASKS.slice(0, 2).map((task) => task.id),
    );
  });

  it('caps the full session at the maximum session size', () => {
    const dueProgress = EXAM_PREP_RECALL_TASKS.slice(0, 12).map((task) =>
      makeRecallProgress({
        taskId: task.id,
        unitId: task.unitId,
        card: testCard({ state: 'Review', due: '2026-09-09T00:00:00.000Z' }),
      }),
    );
    const queue = buildExamPrepRecallQueue({
      progress: dueProgress,
      now: NOW,
      newRecallCardsPerSession: 8,
      maxRecallCardsPerSession: 15,
    });
    expect(queue).toHaveLength(15);
    expect(queue.slice(0, 12).every((item) => item.progress !== null)).toBe(true);
    expect(queue.slice(12).map((item) => item.task.id)).toEqual(
      EXAM_PREP_RECALL_TASKS.slice(12, 15).map((task) => task.id),
    );
  });

  it('does not add new cards when the due queue already fills the maximum', () => {
    const dueProgress = EXAM_PREP_RECALL_TASKS.slice(0, 10).map((task) =>
      makeRecallProgress({
        taskId: task.id,
        unitId: task.unitId,
        card: testCard({ state: 'Review', due: '2026-09-09T00:00:00.000Z' }),
      }),
    );
    const queue = buildExamPrepRecallQueue({
      progress: dueProgress,
      now: NOW,
      newRecallCardsPerSession: 8,
      maxRecallCardsPerSession: 10,
    });
    expect(queue).toHaveLength(10);
    expect(queue.every((item) => item.progress !== null)).toBe(true);
  });

  it('excludes archived same-curriculum and other-curriculum records entirely', () => {
    const archived = makeRecallProgress({
      taskId: at(0).id,
      unitId: at(0).unitId,
      card: testCard({ state: 'Review', due: '2026-09-09T00:00:00.000Z' }),
      binding: archivedBinding,
    });
    const other = makeRecallProgress({
      taskId: at(1).id,
      unitId: at(1).unitId,
      card: testCard({ state: 'Review', due: '2026-09-09T00:00:00.000Z' }),
      binding: otherCurriculumBinding,
    });
    const queue = buildExamPrepRecallQueue({
      progress: [archived, other],
      now: NOW,
      newRecallCardsPerSession: 2,
      maxRecallCardsPerSession: 20,
    });
    // both ignored: at(0)/at(1) treated as fresh new cards in canonical order
    expect(queue.map((item) => item.task.id)).toEqual([at(0).id, at(1).id]);
  });

  it('treats uninitialized progress records as new cards', () => {
    const uninitialized: ExamPrepRecallProgress = {
      ...makeRecallProgress({
        taskId: at(0).id,
        unitId: at(0).unitId,
        card: testCard(),
      }),
      scheduling: { schemaVersion: 1, algorithm: 'fsrs' as const, initialized: false, configVersion: 1 },
    };
    const queue = buildExamPrepRecallQueue({
      progress: [uninitialized],
      now: NOW,
      newRecallCardsPerSession: 1,
      maxRecallCardsPerSession: 20,
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]?.task.id).toBe(at(0).id);
    expect(queue[0]?.progress).toBeNull();
  });

  it('is deterministic for the same inputs', () => {
    const progress = EXAM_PREP_RECALL_TASKS.slice(0, 6).map((task, index) =>
      makeRecallProgress({
        taskId: task.id,
        unitId: task.unitId,
        card: testCard({ state: 'Review', due: `2026-09-0${index + 1}T00:00:00.000Z` }),
      }),
    );
    const first = buildExamPrepRecallQueue({
      progress,
      now: NOW,
      newRecallCardsPerSession: 3,
      maxRecallCardsPerSession: 20,
    });
    const second = buildExamPrepRecallQueue({
      progress,
      now: NOW,
      newRecallCardsPerSession: 3,
      maxRecallCardsPerSession: 20,
    });
    expect(first.map((item) => item.task.id)).toEqual(second.map((item) => item.task.id));
  });
});
