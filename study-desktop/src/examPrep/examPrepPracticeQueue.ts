import { latestAttemptByTaskId } from './examPrepAttemptSelectors';
import type {
  ExamPrepLocateAttempt,
  ExamPrepLocateTask,
  ExamPrepRecognitionAttempt,
  ExamPrepRecognitionTask,
} from './examPrepTypes';

export const EXAM_PREP_PRACTICE_SPRINT_SIZE = 10;
const QUOTAS = { A: 4, B: 3, NAV: 2, CD: 1 } as const;
type Bucket = keyof typeof QUOTAS;
type Task = ExamPrepRecognitionTask | ExamPrepLocateTask;
type Attempt = ExamPrepRecognitionAttempt | ExamPrepLocateAttempt;

const bucketFor = (task: Task): Bucket =>
  task.tier === 'A' || task.tier === 'B' || task.tier === 'NAV' ? task.tier : 'CD';
const itemIndex = (task: Task): number =>
  'cueIndex' in task ? task.cueIndex : task.lookupIndex;
const weightRank = (weight: Task['reviewWeight']): number =>
  ({ high: 0, medium: 1, low: 2 })[weight];

const resultRank = (attempt: Attempt | undefined): number => {
  if (!attempt) return 1;
  return attempt.result === 'missed' ? 0 : 2;
};

const compareTasks = (latest: Map<string, Attempt>) => (left: Task, right: Task): number => {
  const leftAttempt = latest.get(left.id);
  const rightAttempt = latest.get(right.id);
  return (
    resultRank(leftAttempt) - resultRank(rightAttempt) ||
    (leftAttempt && rightAttempt
      ? leftAttempt.completedAt.localeCompare(rightAttempt.completedAt) ||
        leftAttempt.id.localeCompare(rightAttempt.id)
      : 0) ||
    weightRank(left.reviewWeight) - weightRank(right.reviewWeight) ||
    left.curriculumIndex - right.curriculumIndex ||
    itemIndex(left) - itemIndex(right) ||
    left.id.localeCompare(right.id)
  );
};

const take = (
  pool: Task[],
  count: number,
  selected: Task[],
  selectedIds: Set<string>,
  selectedUnits: Set<string>,
) => {
  for (const allowRepeat of [false, true]) {
    for (const task of pool) {
      if (selected.length >= count || selectedIds.has(task.id)) continue;
      if (!allowRepeat && selectedUnits.has(task.unitId)) continue;
      selected.push(task);
      selectedIds.add(task.id);
      selectedUnits.add(task.unitId);
    }
  }
};

export const buildExamPrepPracticeQueue = <T extends Task, A extends Attempt>(
  tasks: T[],
  attempts: A[],
): T[] => {
  const latest = latestAttemptByTaskId(attempts) as Map<string, Attempt>;
  const sorted = [...tasks].sort(compareTasks(latest));
  const selected: Task[] = [];
  const selectedIds = new Set<string>();
  const selectedUnits = new Set<string>();
  for (const bucket of Object.keys(QUOTAS) as Bucket[]) {
    const target = selected.length + QUOTAS[bucket];
    take(sorted.filter((task) => bucketFor(task) === bucket), target, selected, selectedIds, selectedUnits);
  }
  take(sorted, EXAM_PREP_PRACTICE_SPRINT_SIZE, selected, selectedIds, selectedUnits);
  return selected.slice(0, EXAM_PREP_PRACTICE_SPRINT_SIZE) as T[];
};
