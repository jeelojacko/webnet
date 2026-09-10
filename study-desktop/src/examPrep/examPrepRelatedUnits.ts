// Exam Prep — related-unit resolution helpers.
//
// Curriculum units carry `relatedUnitIds` (cross-references curated by the
// frozen manifest — 47 units across A–D/NAV/DRILL reference others). Rows
// render as titled chips so a learner can jump straight to the related unit's
// Learn card. Lookups resolve against the bundled manifest only; ids that
// fail to resolve render as their raw id (defensive — validation already
// guarantees every related id exists).

import { EXAM_PREP_MANIFEST } from './examPrepManifest';

const unitTitleById = new Map(EXAM_PREP_MANIFEST.units.map((unit) => [unit.id, unit.title]));

export const examPrepRelatedUnitTitle = (unitId: string): string =>
  unitTitleById.get(unitId) ?? unitId;

/** Stable DOM id of a Learn unit card (`exam-unit-<unitId>`). */
export const examPrepUnitCardId = (unitId: string): string => `exam-unit-${unitId}`;
