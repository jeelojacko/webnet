// Exam Prep — deterministic locate-task derivation.
//
// Locate tasks are derived PURELY from every A-D/NAV `unit.mustLocate` entry
// in canonical manifest order (exactly 452: A 112 / B 140 / C 94 / D 12 /
// NAV 94; DRILL excluded). Each frozen target already resolves to a corpus
// document; targets that intentionally stop at document level in the frozen
// curriculum carry `expectedSourceKey: null` (62 document-level targets: 61
// Tier-A + 1 Tier-B). Pinned targets always carry their exact `sourceKey`.
// The derivation is deterministic: the same manifest units always produce the
// same task list and never invents prompts or provisions.

import type { ExamCurriculumUnit } from '../examCurriculum/examCurriculumTypes';
import { EXAM_PREP_MANIFEST } from './examPrepManifest';
import { isExamPrepLearnUnit } from './examPrepRecallTasks';
import type { ExamPrepLocateTask } from './examPrepTypes';

export const deriveExamPrepLocateTasks = (
  units: ExamCurriculumUnit[],
): ExamPrepLocateTask[] =>
  units.flatMap((unit, curriculumIndex) => {
    if (!isExamPrepLearnUnit(unit)) return [];
    return unit.mustLocate.map((lookup, index) => ({
      id: `locate:${unit.id}:${index + 1}`,
      unitId: unit.id,
      unitTitle: unit.title,
      tier: unit.tier,
      reviewWeight: unit.reviewWeight,
      curriculumIndex,
      lookupIndex: index + 1,
      prompt: lookup.prompt,
      expectedDocumentId: lookup.documentId,
      expectedSourceKey: lookup.sourceKey ?? null,
    }));
  });

/** Frozen current-hash task list derived once from the bundled manifest. */
export const EXAM_PREP_LOCATE_TASKS: ExamPrepLocateTask[] = deriveExamPrepLocateTasks(
  EXAM_PREP_MANIFEST.units,
);
