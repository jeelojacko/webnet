// Exam Prep Mock — pre-submission question prompt text.
//
// Before submission the exam UI may render only the frozen question stimulus:
// the authored Recall question, the Recognition cue + task-aware ask line, the Locate
// prompt, or the Drill fact pattern + task. Expected answers / unit identity /
// document pins / answer keys are NEVER returned here, so the answering UI
// cannot leak them (even in hidden DOM). The Recognition ask line is shared
// with the Recognition sprint via `examPrepRecognitionAskForTier` so normal /
// NAV / Mock copy cannot drift.

import { examPrepRecognitionAskForTier } from '../examPrepConstants';
import { resolveExamPrepMockQuestionContent } from './examPrepMockQuestionContent';
import type { ExamPrepMockQuestionRef } from './examPrepMockTypes';

/** Multi-paragraph question text shown while answering. */
export const examPrepMockQuestionPromptText = (
  ref: ExamPrepMockQuestionRef,
): string => {
  const content = resolveExamPrepMockQuestionContent(ref);
  switch (content.kind) {
    case 'recall':
      return content.prompt;
    case 'recognition':
      return `${content.cue}\n\n${examPrepRecognitionAskForTier(content.tier)}`;
    case 'locate':
      return content.prompt;
    case 'drill':
      return `${content.factPattern}\n\n${content.task}`;
  }
};
