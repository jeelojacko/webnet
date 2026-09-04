import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { currentExamPrepBinding, examPrepProgressId } from './examPrep/examPrepManifest';
import {
  appendImmutableAttempt,
  removeById,
  upsertById,
} from './examPrep/examPrepStateUpdates';
import type { ExamPrepQueueItem } from './examPrep/examPrepQueue';
import {
  buildExamPrepRatedRecallAttempt,
} from './examPrep/examPrepReview';
import {
  normalizeExamPrepSettings,
  resolveExamPrepSettings,
} from './examPrep/examPrepSettings';
import type { StudyStorage } from './studyStorageTypes';
import type { StudyDataSnapshot } from './studyTypes';

const createAttemptId = (taskId: string): string =>
  `recall-attempt-${taskId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const useStudyExamPrep = ({
  data,
  storage,
  setData,
  setStatusMessage,
}: {
  data: StudyDataSnapshot | null;
  storage: StudyStorage;
  setData: Dispatch<SetStateAction<StudyDataSnapshot | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
}) => {
  /** Mark/unmark one A-D/NAV unit as studied (independent of recall state). */
  const toggleUnitStudied = useCallback(
    async (unitId: string) => {
      if (!data) return;
      const binding = currentExamPrepBinding();
      const existing = data.examPrepUnitProgress.find(
        (record) => record.id === examPrepProgressId(binding, unitId),
      );
      const nowIso = new Date().toISOString();
      if (existing) {
        await storage.deleteExamPrepUnitProgress(existing.id);
        setData({
          ...data,
          examPrepUnitProgress: removeById(data.examPrepUnitProgress, existing.id),
        });
        return;
      }
      const record = {
        id: examPrepProgressId(binding, unitId),
        curriculumId: binding.curriculumId,
        curriculumContentHash: binding.curriculumContentHash,
        unitId,
        studiedAt: nowIso,
        updatedAt: nowIso,
      };
      await storage.saveExamPrepUnitProgress(record);
      setData({
        ...data,
        examPrepUnitProgress: upsertById(data.examPrepUnitProgress, record),
      });
    },
    [data, storage, setData],
  );

  /** Atomically persist one rated recall card (attempt + progress). */
  const rateRecallTask = useCallback(
    async ({
      item,
      rating,
      now,
      answer,
    }: {
      item: ExamPrepQueueItem;
      rating: 'again' | 'hard' | 'good' | 'easy';
      now: Date;
      answer?: string;
    }): Promise<void> => {
      if (!data) throw new Error('Exam Prep data is not loaded.');
      const result = buildExamPrepRatedRecallAttempt({
        data,
        item,
        rating,
        now,
        attemptId: createAttemptId(item.task.id),
        answer,
      });
      await storage.saveExamPrepRecallRating({
        attempt: result.attempt,
        progress: result.progress,
        expectedProgressUpdatedAt: item.progress?.updatedAt,
      });
      setData({
        ...data,
        examPrepAttempts: appendImmutableAttempt(data.examPrepAttempts, result.attempt),
        examPrepRecallProgress: upsertById(
          data.examPrepRecallProgress,
          result.progress,
        ),
      });
    },
    [data, storage, setData],
  );

  /** Persist current-hash Exam Prep session settings. */
  const saveExamPrepSettings = useCallback(
    async (next: { newRecallCardsPerSession?: number; maxRecallCardsPerSession?: number }) => {
      if (!data) return;
      const binding = currentExamPrepBinding();
      const nowIso = new Date().toISOString();
      const current = resolveExamPrepSettings(data.examPrepSettings, binding, nowIso);
      const record = normalizeExamPrepSettings({
        id: binding.curriculumContentHash,
        curriculumId: binding.curriculumId,
        curriculumContentHash: binding.curriculumContentHash,
        newRecallCardsPerSession:
          next.newRecallCardsPerSession ?? current.newRecallCardsPerSession,
        maxRecallCardsPerSession:
          next.maxRecallCardsPerSession ?? current.maxRecallCardsPerSession,
        updatedAt: nowIso,
      });
      await storage.saveExamPrepSettings(record);
      setData({
        ...data,
        examPrepSettings: upsertById(data.examPrepSettings, record),
      });
      setStatusMessage('Exam Prep session settings saved.');
    },
    [data, storage, setData, setStatusMessage],
  );

  return {
    toggleUnitStudied,
    rateRecallTask,
    saveExamPrepSettings,
  };
};
