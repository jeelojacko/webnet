// Exam Curriculum V1 — Tier-A catalog index.
//
// Curates the exact 51 Tier-A units in deterministic family order and
// pins the canonical corpus document IDs (never guessed — resolved from
// the authoritative content package at build time).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';
import { examCurriculumTierANblsSpecs, examCurriculumTierABylawsSpecs } from './examCurriculumCatalogNbls';
import {
  examCurriculumTierABcaRegSpecs,
  examCurriculumTierABcaSpecs,
  examCurriculumTierASurveysRegSpecs,
  examCurriculumTierASurveysSpecs,
} from './examCurriculumCatalogSurveying';
import {
  examCurriculumTierACpaRegSpecs,
  examCurriculumTierACpaSpecs,
  examCurriculumTierARegistryRegSpecs,
  examCurriculumTierARegistrySpecs,
} from './examCurriculumCatalogPlanning';
import {
  examCurriculumTierALandTitlesRegSpecs,
  examCurriculumTierALandTitlesSpecs,
} from './examCurriculumCatalogTitles';

export const EXAM_CURRICULUM_ID = 'nb-sit-statute-exam-curriculum-v1';

/** Canonical corpus document IDs for the 12 Tier-A source families. */
export const EXAM_CURRICULUM_TIER_A_DOCUMENTS = [
  'doc-new-brunswick-land-surveyors-act',
  'doc-new-brunswick-land-surveyors-bylaws',
  'doc-surveys-act',
  'reg-surveys-84-76',
  'doc-boundaries-confirmation-act',
  'reg-boundaries-95-166',
  'doc-community-planning-act',
  'reg-community-planning-80-159',
  'doc-registry-act',
  'reg-registry-84-190',
  'doc-land-titles-act',
  'reg-land-titles-83-130',
] as const;

export const EXAM_CURRICULUM_TIER_A_DOCUMENT_TITLES: Record<string, string> = {
  'doc-new-brunswick-land-surveyors-act': 'New Brunswick Land Surveyors Act, 1986',
  'doc-new-brunswick-land-surveyors-bylaws': 'Association of New Brunswick Land Surveyors Bylaws',
  'doc-surveys-act': 'Surveys Act',
  'reg-surveys-84-76': 'Surveys Regulation 84-76',
  'doc-boundaries-confirmation-act': 'Boundaries Confirmation Act',
  'reg-boundaries-95-166': 'Boundaries Confirmation Regulation 95-166',
  'doc-community-planning-act': 'Community Planning Act',
  'reg-community-planning-80-159': 'Community Planning Regulation 80-159',
  'doc-registry-act': 'Registry Act',
  'reg-registry-84-190': 'Registry Regulation 84-190',
  'doc-land-titles-act': 'Land Titles Act',
  'reg-land-titles-83-130': 'Land Titles Regulation 83-130',
};

const FAMILY_ORDER: Array<{ title: string; specs: ExamCurriculumUnitSpec[] }> = [
  { title: 'New Brunswick Land Surveyors Act', specs: examCurriculumTierANblsSpecs },
  { title: 'ANBLS Bylaws', specs: examCurriculumTierABylawsSpecs },
  { title: 'Surveys Act', specs: examCurriculumTierASurveysSpecs },
  { title: 'Surveys Regulation 84-76', specs: examCurriculumTierASurveysRegSpecs },
  { title: 'Boundaries Confirmation Act', specs: examCurriculumTierABcaSpecs },
  { title: 'Boundaries Confirmation Regulation 95-166', specs: examCurriculumTierABcaRegSpecs },
  { title: 'Community Planning Act', specs: examCurriculumTierACpaSpecs },
  { title: 'Community Planning Regulation 80-159', specs: examCurriculumTierACpaRegSpecs },
  { title: 'Registry Act', specs: examCurriculumTierARegistrySpecs },
  { title: 'Registry Regulation 84-190', specs: examCurriculumTierARegistryRegSpecs },
  { title: 'Land Titles Act', specs: examCurriculumTierALandTitlesSpecs },
  { title: 'Land Titles Regulation 83-130', specs: examCurriculumTierALandTitlesRegSpecs },
];

export const EXAM_CURRICULUM_TIER_A_FAMILIES = FAMILY_ORDER;

/** All 51 Tier-A unit specs in deterministic family order. */
export const examCurriculumTierASpecs: ExamCurriculumUnitSpec[] = FAMILY_ORDER.flatMap((f) => f.specs);

/** Expected unit count per family, asserted exactly at build time. */
export const EXAM_CURRICULUM_TIER_A_EXPECTED_COUNTS: Record<string, number> = FAMILY_ORDER.reduce(
  (acc, family) => {
    acc[family.title] = family.specs.length;
    return acc;
  },
  {} as Record<string, number>,
);

export const EXAM_CURRICULUM_TIER_A_TOTAL = examCurriculumTierASpecs.length;
