// Exam Prep — shared curriculum catalog metadata for the UI.
//
// Merges the per-tier canonical document-title maps used by the Learn and
// Lookup Drill views (kept out of component files so rendering is not
// duplicated).

import { EXAM_CURRICULUM_TIER_A_DOCUMENT_TITLES } from '../examCurriculum/examCurriculumCatalog';
import { EXAM_CURRICULUM_TIER_B_DOCUMENT_TITLES } from '../examCurriculum/examCurriculumCatalogTierB';
import {
  EXAM_CURRICULUM_TIER_C_DOCUMENT_TITLES,
  EXAM_CURRICULUM_TIER_D_DOCUMENT_TITLES,
} from '../examCurriculum/examCurriculumCatalogTierCD';

export const EXAM_PREP_DOCUMENT_TITLES: Record<string, string> = {
  ...EXAM_CURRICULUM_TIER_A_DOCUMENT_TITLES,
  ...EXAM_CURRICULUM_TIER_B_DOCUMENT_TITLES,
  ...EXAM_CURRICULUM_TIER_C_DOCUMENT_TITLES,
  ...EXAM_CURRICULUM_TIER_D_DOCUMENT_TITLES,
};
