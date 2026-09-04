// Exam Prep Mock — pre-submission question prompt text.
//
// Before submission the exam UI may render only the frozen question stimulus:
// the Recall prompt, the Recognition cue + ask line, the Locate prompt, or
// the Drill fact pattern + task. Expected answers / unit identity / document
// pins / answer keys are NEVER returned here, so the answering UI cannot leak
// them (even in hidden DOM).

import { EXAM_PREP_RECALL_PROMPT, EXAM_PREP_RECOGNITION_ASK } from '../examPrepConstants';
import { resolveExamPrepMockQuestionContent } from './examPrepMockQuestionContent';
import type { ExamPrepMockQuestionRef } from './examPrepMockTypes';

/** Multi-paragraph question text shown while answering. */
export const examPrepMockQuestionPromptText = (
  ref: ExamPrepMockQuestionRef,
): string => {
  if (ref.kind === 'recall') return EXAM_PREP_RECALL_PROMPT;
  const content = resolveExamPrepMockQuestionContent(ref);
  switch (content.kind) {
    case 'recall':
      return content.prompt;
    case 'recognition':
      return `${content.cue}\n\n${EXAM_PREP_RECOGNITION_ASK}`;
    case 'locate':
      return content.prompt;
    case 'drill':
      return `${content.factPattern}\n\n${content.task}`;
  }
};
