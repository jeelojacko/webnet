// Exam Prep — pure attempt builders for recognition / locate / drill.
//
// Components and tests assemble immutable attempts through these builders so
// every record carries the current curriculum binding, mirrors the frozen
// task exactly, and never drifts from the discriminated union shape. The
// builders are pure; persistence belongs to storage + the hook.

import { currentExamPrepBinding } from './examPrepManifest';
import type {
  ExamPrepDrillAttempt,
  ExamPrepLocateAttempt,
  ExamPrepLocateTask,
  ExamPrepRecognitionAttempt,
  ExamPrepRecognitionTask,
} from './examPrepTypes';

export type BuildRecognitionAttemptOptions = {
  attemptId: string;
  task: ExamPrepRecognitionTask;
  result: 'got_it' | 'missed';
  completedAt: string;
  answer?: string;
};

export const buildRecognitionAttempt = ({
  attemptId,
  task,
  result,
  completedAt,
  answer,
}: BuildRecognitionAttemptOptions): ExamPrepRecognitionAttempt => {
  const binding = currentExamPrepBinding();
  return {
    id: attemptId,
    kind: 'recognition',
    curriculumId: binding.curriculumId,
    curriculumContentHash: binding.curriculumContentHash,
    taskId: task.id,
    unitId: task.unitId,
    cueIndex: task.cueIndex,
    cue: task.cue,
    expectedUnitTitle: task.unitTitle,
    expectedDocumentIds: [...task.expectedDocumentIds],
    ...(answer !== undefined ? { answer } : {}),
    result,
    completedAt,
  };
};

export type BuildLocateAttemptOptions = {
  attemptId: string;
  task: ExamPrepLocateTask;
  result: 'found' | 'missed';
  elapsedSeconds: number;
  completedAt: string;
};

export const buildLocateAttempt = ({
  attemptId,
  task,
  result,
  elapsedSeconds,
  completedAt,
}: BuildLocateAttemptOptions): ExamPrepLocateAttempt => {
  const binding = currentExamPrepBinding();
  return {
    id: attemptId,
    kind: 'locate',
    curriculumId: binding.curriculumId,
    curriculumContentHash: binding.curriculumContentHash,
    taskId: task.id,
    unitId: task.unitId,
    lookupIndex: task.lookupIndex,
    prompt: task.prompt,
    expectedDocumentId: task.expectedDocumentId,
    expectedSourceKey: task.expectedSourceKey,
    result,
    elapsedSeconds,
    completedAt,
  };
};

export type BuildDrillAttemptOptions = {
  attemptId: string;
  unitId: string;
  taskId: string;
  difficulty: ExamPrepDrillAttempt['difficulty'];
  answer: string;
  elapsedSeconds: number;
  targetSeconds: number;
  lawIdentified: boolean;
  provisionLocated: boolean;
  substantiveAnswerComplete: boolean;
  practiceDate: string;
  completedAt: string;
};

export const buildDrillAttempt = ({
  attemptId,
  unitId,
  taskId,
  difficulty,
  answer,
  elapsedSeconds,
  targetSeconds,
  lawIdentified,
  provisionLocated,
  substantiveAnswerComplete,
  practiceDate,
  completedAt,
}: BuildDrillAttemptOptions): ExamPrepDrillAttempt => {
  const binding = currentExamPrepBinding();
  return {
    id: attemptId,
    kind: 'drill',
    curriculumId: binding.curriculumId,
    curriculumContentHash: binding.curriculumContentHash,
    taskId,
    unitId,
    difficulty,
    answer,
    elapsedSeconds,
    targetSeconds,
    lawIdentified,
    provisionLocated,
    substantiveAnswerComplete,
    score: [lawIdentified, provisionLocated, substantiveAnswerComplete].filter(Boolean)
      .length as 0 | 1 | 2 | 3,
    practiceDate,
    completedAt,
  };
};
