import type { ExamCurriculumUnit } from '../examCurriculum/examCurriculumTypes';
import { EXAM_PREP_MANIFEST } from './examPrepManifest';
import { isExamPrepLearnUnit } from './examPrepRecallTasks';
import type { ExamPrepRecognitionTask } from './examPrepTypes';

export const deriveExamPrepRecognitionTasks = (
  units: ExamCurriculumUnit[],
): ExamPrepRecognitionTask[] =>
  units.flatMap((unit, curriculumIndex) =>
    isExamPrepLearnUnit(unit)
      ? unit.recognitionCues.map((cue, index) => ({
          id: `recognition:${unit.id}:${index + 1}`,
          unitId: unit.id,
          unitTitle: unit.title,
          tier: unit.tier,
          reviewWeight: unit.reviewWeight,
          curriculumIndex,
          cueIndex: index + 1,
          cue,
          expectedDocumentIds: [...unit.sourceDocumentIds],
        }))
      : [],
  );

export const EXAM_PREP_RECOGNITION_TASKS = deriveExamPrepRecognitionTasks(
  EXAM_PREP_MANIFEST.units,
);
