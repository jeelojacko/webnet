import { describe, expect, it } from 'vitest';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { buildExamPrepRecallQueue } from '../../src/study/examPrep/examPrepQueue';
import {
  compareExamPrepRecallTaskPriority,
  examPrepPriorityGroup,
} from '../../src/study/examPrep/examPrepPriority';
import type { ExamPrepRecallTask } from '../../src/study/examPrep/examPrepTypes';
import type { ExamPrepCurriculumTier } from '../../src/study/examPrep/examPrepTypes';
import type { ExamCurriculumReviewWeight } from '../../src/study/examCurriculum/examCurriculumTypes';

const NOW = new Date('2026-09-10T00:00:00.000Z');

let taskSeq = 0;
const makeTask = ({
  tier,
  reviewWeight,
  curriculumIndex,
  index = 1,
  label,
}: {
  tier: ExamPrepCurriculumTier;
  reviewWeight: ExamCurriculumReviewWeight;
  curriculumIndex: number;
  index?: number;
  label?: string;
}): ExamPrepRecallTask => {
  taskSeq += 1;
  const unitId = label ?? `U${taskSeq}`;
  return {
    id: `recall:${unitId}:${index}`,
    unitId,
    unitTitle: unitId,
    tier,
    index,
    order: taskSeq,
    reviewWeight,
    curriculumIndex,
    prompt: 'State the key rule you should remember for this curriculum unit.',
    expectedAnswer: `answer-${unitId}`,
  };
};

const queueIds = (tasks: ExamPrepRecallTask[], newPerSession: number) =>
  buildExamPrepRecallQueue({
    tasks,
    progress: [],
    now: NOW,
    newRecallCardsPerSession: newPerSession,
    maxRecallCardsPerSession: newPerSession,
  }).map((item) => item.task.id);

describe('Exam Prep priority rank philosophy', () => {
  it('maps tier/weight pairs to exactly the documented ranks', () => {
    expect(examPrepPriorityGroup('A', 'high')).toBe(0);
    expect(examPrepPriorityGroup('B', 'high')).toBe(1);
    expect(examPrepPriorityGroup('NAV', 'high')).toBe(2);
    expect(examPrepPriorityGroup('A', 'medium')).toBe(3);
    expect(examPrepPriorityGroup('A', 'low')).toBe(3);
    expect(examPrepPriorityGroup('B', 'medium')).toBe(4);
    expect(examPrepPriorityGroup('B', 'low')).toBe(4);
    expect(examPrepPriorityGroup('NAV', 'medium')).toBe(5);
    expect(examPrepPriorityGroup('NAV', 'low')).toBe(5);
    expect(examPrepPriorityGroup('C', 'high')).toBe(6);
    expect(examPrepPriorityGroup('C', 'low')).toBe(6);
    expect(examPrepPriorityGroup('D', 'medium')).toBe(7);
    expect(examPrepPriorityGroup('DRILL', 'high')).toBe(8);
  });

  it('orders new cards exactly high A, high B, high NAV, other A, other B, other NAV, C, D', () => {
    const tasks = [
      makeTask({ tier: 'D', reviewWeight: 'low', curriculumIndex: 9 }),
      makeTask({ tier: 'C', reviewWeight: 'medium', curriculumIndex: 6 }),
      makeTask({ tier: 'A', reviewWeight: 'high', curriculumIndex: 1 }),
      makeTask({ tier: 'B', reviewWeight: 'high', curriculumIndex: 0 }),
      makeTask({ tier: 'NAV', reviewWeight: 'medium', curriculumIndex: 7 }),
      makeTask({ tier: 'B', reviewWeight: 'low', curriculumIndex: 4 }),
      makeTask({ tier: 'NAV', reviewWeight: 'high', curriculumIndex: 2 }),
      makeTask({ tier: 'A', reviewWeight: 'high', curriculumIndex: 3 }),
      makeTask({ tier: 'A', reviewWeight: 'medium', curriculumIndex: 5 }),
      makeTask({ tier: 'C', reviewWeight: 'high', curriculumIndex: 8 }),
    ];
    // deliberately shuffled: rank order wins over manifest order
    expect(queueIds(tasks, 10)).toEqual([
      'recall:U3:1', // A high (curriculumIndex 1)
      'recall:U8:1', // A high (curriculumIndex 3)
      'recall:U4:1', // B high (curriculumIndex 0)
      'recall:U7:1', // NAV high (curriculumIndex 2)
      'recall:U9:1', // A medium (rank 3, other A)
      'recall:U6:1', // B low (rank 4, other B)
      'recall:U5:1', // NAV medium (rank 5, other NAV)
      'recall:U2:1', // C medium (rank 6, curriculumIndex 6)
      'recall:U10:1', // C high (rank 6, curriculumIndex 8)
      'recall:U1:1', // D (rank 7)
    ]);
  });

  it('breaks equal-rank ties by curriculum index, then mustRecall index, then task id', () => {
    const a2 = makeTask({
      tier: 'A',
      reviewWeight: 'high',
      curriculumIndex: 4,
      index: 2,
      label: 'SAME',
    });
    const a1 = makeTask({
      tier: 'A',
      reviewWeight: 'high',
      curriculumIndex: 4,
      index: 1,
      label: 'SAME',
    });
    const idX = makeTask({
      tier: 'A',
      reviewWeight: 'high',
      curriculumIndex: 4,
      index: 1,
      label: 'Z',
    });
    const idA = makeTask({
      tier: 'A',
      reviewWeight: 'high',
      curriculumIndex: 4,
      index: 1,
      label: 'A',
    });
    const bEarly = makeTask({
      tier: 'B',
      reviewWeight: 'high',
      curriculumIndex: 2,
      index: 1,
      label: 'B',
    });
    const tasks = [a2, idX, a1, bEarly, idA];
    expect(queueIds(tasks, 5)).toEqual([
      idA.id, // rank-0 A high, id tie-break 'recall:A:1' first
      a1.id, // same group/curriculum/index, 'recall:SAME:1' after 'recall:A:1'
      idX.id, // 'recall:Z:1' sorts after 'recall:SAME:1'
      a2.id, // same unit curriculumIndex 4, mustRecall index 2 after index 1
      bEarly.id, // rank-1 B high last despite earlier curriculumIndex
    ]);
  });

  it('orders the real 57-task deck by group with within-group canonical order', () => {
    const sorted = [...EXAM_PREP_RECALL_TASKS].sort(compareExamPrepRecallTaskPriority);
    const queue = buildExamPrepRecallQueue({
      progress: [],
      now: NOW,
      newRecallCardsPerSession: 57,
      maxRecallCardsPerSession: 57,
    });
    expect(queue.map((item) => item.task.id)).toEqual(sorted.map((task) => task.id));
    // observed rank sequence: 18× high A, 16× high B, 5× high NAV,
    // 11× other B, 1× other NAV, 6× C (no other A, no D in the deck)
    const ranks = sorted.map((task) =>
      examPrepPriorityGroup(task.tier, task.reviewWeight),
    );
    expect(ranks).toEqual([
      ...Array.from({ length: 18 }, () => 0),
      ...Array.from({ length: 16 }, () => 1),
      ...Array.from({ length: 5 }, () => 2),
      ...Array.from({ length: 11 }, () => 4),
      5,
      ...Array.from({ length: 6 }, () => 6),
    ]);
    // within every equal-rank run, curriculum index then mustRecall index ascend
    for (let i = 1; i < sorted.length; i += 1) {
      const left = sorted[i - 1];
      const right = sorted[i];
      if (examPrepPriorityGroup(left.tier, left.reviewWeight) !==
          examPrepPriorityGroup(right.tier, right.reviewWeight)) {
        continue;
      }
      expect(right.curriculumIndex).toBeGreaterThanOrEqual(left.curriculumIndex);
      if (right.curriculumIndex === left.curriculumIndex) {
        expect(right.index).toBeGreaterThan(left.index);
      }
    }
  });
});
