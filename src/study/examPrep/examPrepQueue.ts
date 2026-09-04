// Exam Prep — deterministic recall queue/session construction.
//
// The recall queue orders due cards earliest-first, then prioritized new
// cards in canonical manifest order. It respects the new-card-per-session and
// maximum-session limits, excludes future-due and archived
// (same-curriculum/different-hash) records, and treats uninitialized recall
// progress as new. It is pure and deterministic for a fixed (records, now,
// limits) input. No undo, drafts, drill persistence, or Study phase
// transitions live here.

import { EXAM_PREP_RECALL_TASKS } from './examPrepRecallTasks';
import type { ExamPrepRecallTask } from './examPrepTypes';
import { isCurrentExamPrepBinding } from './examPrepManifest';
import { EXAM_PREP_SESSION_LIMIT_DEFAULT } from './examPrepConstants';
import {
  examPrepRecallDueAt,
  isExamPrepRecallDue,
  isExamPrepRecallIntroduced,
} from './examPrepSelectors';
import type { ExamPrepRecallProgress } from './examPrepTypes';

export type ExamPrepQueueItem = {
  task: ExamPrepRecallTask;
  progress: ExamPrepRecallProgress | null;
};

export type BuildExamPrepRecallQueueOptions = {
  tasks?: ExamPrepRecallTask[];
  progress: ExamPrepRecallProgress[];
  now: Date;
  newRecallCardsPerSession: number;
  maxRecallCardsPerSession?: number;
};

export const buildExamPrepRecallQueue = ({
  tasks = EXAM_PREP_RECALL_TASKS,
  progress,
  now,
  newRecallCardsPerSession,
  maxRecallCardsPerSession = EXAM_PREP_SESSION_LIMIT_DEFAULT,
}: BuildExamPrepRecallQueueOptions): ExamPrepQueueItem[] => {
  const progressByTask = new Map(
    progress
      .filter((entry) => isCurrentExamPrepBinding(entry))
      .map((entry) => [entry.taskId, entry]),
  );
  const maxSession = Math.max(1, Math.floor(maxRecallCardsPerSession));
  const newPerSession = Math.max(0, Math.min(newRecallCardsPerSession, maxSession));

  const due: ExamPrepQueueItem[] = [];
  const fresh: ExamPrepQueueItem[] = [];
  for (const task of tasks) {
    const entry = progressByTask.get(task.id);
    if (!entry || !isExamPrepRecallIntroduced(entry)) {
      fresh.push({ task, progress: null });
      continue;
    }
    if (!isExamPrepRecallDue(entry, now)) continue; // future or archived excluded
    due.push({ task, progress: entry });
  }
  due.sort(
    (left, right) =>
      (examPrepRecallDueAt(left.progress as ExamPrepRecallProgress) ?? '').localeCompare(
        examPrepRecallDueAt(right.progress as ExamPrepRecallProgress) ?? '',
      ) || left.task.order - right.task.order ||
      left.task.id.localeCompare(right.task.id),
  );
  fresh.sort((left, right) => left.task.order - right.task.order || left.task.id.localeCompare(right.task.id));

  const takenDue = due.slice(0, maxSession);
  const newBudget = Math.max(0, Math.min(newPerSession, maxSession - takenDue.length));
  return [...takenDue, ...fresh.slice(0, newBudget)];
};
