// Exam Prep Mock — frozen question content resolution.
//
// A persisted mock session stores only question references (questionId, kind,
// sourceTaskId, unitId, points). The expected content shown AFTER submission
// is resolved here from the frozen pools — never authored for the mock, never
// stored on the session, and never placed in the DOM before submission.

import type {
  ExamCurriculumLookupTarget,
  ExamCurriculumUnit,
} from '../../examCurriculum/examCurriculumTypes';
import type { ExamPrepLocateTask } from '../examPrepTypes';
import type { ExamPrepRecognitionTask } from '../examPrepTypes';
import type { ExamPrepRecallTask } from '../examPrepTypes';
import { EXAM_PREP_LOCATE_TASKS } from '../examPrepLocateTasks';
import { EXAM_PREP_RECALL_TASKS } from '../examPrepRecallTasks';
import { EXAM_PREP_RECOGNITION_TASKS } from '../examPrepRecognitionTasks';
import { EXAM_PREP_DRILL_UNITS } from '../examPrepDrillFilters';
import type { ExamPrepMockQuestionRef } from './examPrepMockTypes';

export type ExamPrepMockRecallContent = {
  kind: 'recall';
  prompt: string;
  expectedAnswer: string;
  unitTitle: string;
};

export type ExamPrepMockRecognitionContent = {
  kind: 'recognition';
  cue: string;
  unitId: string;
  unitTitle: string;
  tier: string;
  expectedDocumentIds: string[];
};

export type ExamPrepMockLocateContent = {
  kind: 'locate';
  prompt: string;
  unitTitle: string;
  expectedDocumentId: string;
  expectedSourceKey: string | null;
};

export type ExamPrepMockDrillContent = {
  kind: 'drill';
  factPattern: string;
  task: string;
  difficulty: string;
  requiredLookups: ExamCurriculumLookupTarget[];
  requiredAnswerPoints: string[];
  trapExplanation: string | undefined;
};

export type ExamPrepMockQuestionContent =
  | ExamPrepMockRecallContent
  | ExamPrepMockRecognitionContent
  | ExamPrepMockLocateContent
  | ExamPrepMockDrillContent;

const drillUnitById = (unitId: string): ExamCurriculumUnit | undefined =>
  EXAM_PREP_DRILL_UNITS.find((unit) => unit.id === unitId);

const recallTaskById = (taskId: string): ExamPrepRecallTask | undefined =>
  EXAM_PREP_RECALL_TASKS.find((task) => task.id === taskId);

const recognitionTaskById = (taskId: string): ExamPrepRecognitionTask | undefined =>
  EXAM_PREP_RECOGNITION_TASKS.find((task) => task.id === taskId);

const locateTaskById = (taskId: string): ExamPrepLocateTask | undefined =>
  EXAM_PREP_LOCATE_TASKS.find((task) => task.id === taskId);

export const resolveExamPrepMockQuestionContent = (
  ref: ExamPrepMockQuestionRef,
): ExamPrepMockQuestionContent => {
  switch (ref.kind) {
    case 'recall': {
      const task = recallTaskById(ref.sourceTaskId);
      if (!task) throw new Error(`Unresolved mock recall task: ${ref.sourceTaskId}`);
      return {
        kind: 'recall',
        prompt: task.prompt,
        expectedAnswer: task.expectedAnswer,
        unitTitle: task.unitTitle,
      };
    }
    case 'recognition': {
      const task = recognitionTaskById(ref.sourceTaskId);
      if (!task) throw new Error(`Unresolved mock recognition task: ${ref.sourceTaskId}`);
      return {
        kind: 'recognition',
        cue: task.cue,
        unitId: ref.unitId,
        unitTitle: task.unitTitle,
        tier: task.tier,
        expectedDocumentIds: [...task.expectedDocumentIds],
      };
    }
    case 'locate': {
      const task = locateTaskById(ref.sourceTaskId);
      if (!task) throw new Error(`Unresolved mock locate task: ${ref.sourceTaskId}`);
      return {
        kind: 'locate',
        prompt: task.prompt,
        unitTitle: task.unitTitle,
        expectedDocumentId: task.expectedDocumentId,
        expectedSourceKey: task.expectedSourceKey,
      };
    }
    case 'drill': {
      const unit = drillUnitById(ref.unitId);
      const payload = unit?.drill;
      if (!unit || !payload) throw new Error(`Unresolved mock drill unit: ${ref.unitId}`);
      return {
        kind: 'drill',
        factPattern: payload.factPattern,
        task: payload.task,
        difficulty: payload.difficulty,
        requiredLookups: payload.answerKey.requiredLookups.map((lookup) => ({ ...lookup })),
        requiredAnswerPoints: [...payload.answerKey.requiredAnswerPoints],
        trapExplanation: payload.answerKey.trapExplanation,
      };
    }
  }
};
