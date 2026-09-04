// Exam Prep — IndexedDB store configuration.
//
// Single source of truth for the four Exam Prep stores registered in the
// Study database (schema v9): store names, id key paths, and native index
// definitions. studyStorage.ts consumes these so store registration and
// index creation/migration never drift between the fresh-create and
// missing-index paths.

export const EXAM_PREP_STORE_NAMES = [
  'examPrepUnitProgress',
  'examPrepRecallProgress',
  'examPrepAttempts',
  'examPrepSettings',
] as const;

export type ExamPrepStoreName = (typeof EXAM_PREP_STORE_NAMES)[number];

export const EXAM_PREP_STORE_KEYS: Record<ExamPrepStoreName, string> = {
  examPrepUnitProgress: 'id',
  examPrepRecallProgress: 'id',
  examPrepAttempts: 'id',
  examPrepSettings: 'id',
};

export type ExamPrepIndexSpec = {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
};

export const EXAM_PREP_STORE_INDEXES: Record<ExamPrepStoreName, ExamPrepIndexSpec[]> = {
  examPrepUnitProgress: [
    { name: 'byCurriculumId', keyPath: 'curriculumId' },
    { name: 'byCurriculumContentHash', keyPath: 'curriculumContentHash' },
    { name: 'byUnitId', keyPath: 'unitId' },
  ],
  examPrepRecallProgress: [
    { name: 'byCurriculumId', keyPath: 'curriculumId' },
    { name: 'byCurriculumContentHash', keyPath: 'curriculumContentHash' },
    { name: 'byTaskId', keyPath: 'taskId' },
    { name: 'byCurriculumAndTask', keyPath: ['curriculumContentHash', 'taskId'] },
  ],
  examPrepAttempts: [
    { name: 'byCurriculumId', keyPath: 'curriculumId' },
    { name: 'byCurriculumContentHash', keyPath: 'curriculumContentHash' },
    { name: 'byTaskId', keyPath: 'taskId' },
    { name: 'byCurriculumAndTask', keyPath: ['curriculumContentHash', 'taskId'] },
    { name: 'byKind', keyPath: 'kind' },
  ],
  examPrepSettings: [{ name: 'byCurriculumId', keyPath: 'curriculumId' }],
};
