// Exam Curriculum V1 — canonical catalog composition (A → B → C → D → NAV → DRILL).
//
// Composes the frozen Tier-A (51), Tier-B (43), Tier-C (21) and Tier-D (6)
// spec lists with the cross-document Navigation catalog (12) and the new
// lookup drill catalog (24) into the single deterministic catalog the
// builder, reports and tests consume.
// Canonical manifest order: Tier A (indexes 0-50), Tier B (51-93), Tier C
// (94-114), Tier D (115-120), Navigation (121-132), DRILL (133-156); total 157.

import type { ExamCurriculumCatalogSpec } from './examCurriculumTypes';
import { examCurriculumTierASpecs } from './examCurriculumCatalog';
import {
  EXAM_CURRICULUM_TIER_B_TOTAL,
  examCurriculumTierBSpecs,
} from './examCurriculumCatalogTierB';
import {
  EXAM_CURRICULUM_TIER_C_TOTAL,
  EXAM_CURRICULUM_TIER_D_TOTAL,
  examCurriculumTierCSpecs,
  examCurriculumTierDSpecs,
} from './examCurriculumCatalogTierCD';
import {
  EXAM_CURRICULUM_NAV_TOTAL,
  examCurriculumNavigationSpecs,
} from './examCurriculumCatalogNavigation';
import {
  examCurriculumDrillSpecs,
} from './examCurriculumCatalogDrills';

export const EXAM_CURRICULUM_TOTAL = 157;
export const EXAM_CURRICULUM_DRILL_TOTAL = 24;

/** Tier-A (51) + Tier-B (43) + Tier-C (21) + Tier-D (6) + Navigation (12) + DRILL (24). */
export const examCurriculumAllSpecs: ExamCurriculumCatalogSpec[] = [
  ...examCurriculumTierASpecs,
  ...examCurriculumTierBSpecs,
  ...examCurriculumTierCSpecs,
  ...examCurriculumTierDSpecs,
  ...examCurriculumNavigationSpecs,
  ...examCurriculumDrillSpecs,
];

export const EXAM_CURRICULUM_TIER_TOTALS: Record<string, number> = {
  A: examCurriculumTierASpecs.length,
  B: EXAM_CURRICULUM_TIER_B_TOTAL,
  C: EXAM_CURRICULUM_TIER_C_TOTAL,
  D: EXAM_CURRICULUM_TIER_D_TOTAL,
  NAV: EXAM_CURRICULUM_NAV_TOTAL,
  DRILL: EXAM_CURRICULUM_DRILL_TOTAL,
};
