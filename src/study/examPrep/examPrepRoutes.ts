// Exam Prep — route decoding shared by StudyApp and tests.
//
// Maps study paths to Exam Prep views. /study/exam-curriculum remains as a
// legacy alias that renders Learn, keeping old bookmarks working.

import type { ExamPrepViewKind } from './ExamPrepPage';

export const EXAM_PREP_ROUTES: Array<{ view: ExamPrepViewKind; path: string }> = [
  { view: 'home', path: '/study/exam-prep' },
  { view: 'learn', path: '/study/learn' },
  { view: 'recall', path: '/study/review' },
  { view: 'recognition', path: '/study/recognition' },
  { view: 'locate', path: '/study/locate' },
  { view: 'drills', path: '/study/drills' },
  { view: 'mock', path: '/study/mock-exam' },
];

export const decodeExamPrepView = (path: string): ExamPrepViewKind | null => {
  if (path === '/study/exam-prep') return 'home';
  if (path === '/study/learn' || path === '/study/exam-curriculum') return 'learn';
  if (path === '/study/review') return 'recall';
  if (path === '/study/recognition') return 'recognition';
  if (path === '/study/locate') return 'locate';
  if (path === '/study/drills') return 'drills';
  if (path === '/study/mock-exam') return 'mock';
  return null;
};
