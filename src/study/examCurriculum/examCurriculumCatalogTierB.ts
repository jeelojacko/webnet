// Exam Curriculum V1 — Tier-B catalog glue.
//
// Combines the four Tier-B catalog modules (Land, Property, Resources,
// Public) into the flat, deterministic Tier-B spec list and exposes the
// Tier-B document family counts / canonical document IDs / display titles.
// Tier-A + Tier-B cumulative total is 94 planned units.

import { examCurriculumTierASpecs } from './examCurriculumCatalog';
import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';
import {
  examCurriculumTierBAgriSpecs,
  examCurriculumTierBAirSpecs,
  examCurriculumTierBAsmtSpecs,
  examCurriculumTierBCeSpecs,
  examCurriculumTierBCondoSpecs,
  examCurriculumTierBCwaSpecs,
} from './examCurriculumCatalogTierBLand';
import {
  examCurriculumTierBClfSpecs,
  examCurriculumTierBEaseSpecs,
  examCurriculumTierBEvidSpecs,
  examCurriculumTierBExprSpecs,
  examCurriculumTierBLimSpecs,
  examCurriculumTierBPropSpecs,
  examCurriculumTierBTdaSpecs,
  examCurriculumTierBTrspSpecs,
} from './examCurriculumCatalogTierBProperty';
import {
  examCurriculumTierBMinSpecs,
  examCurriculumTierBOngSpecs,
  examCurriculumTierBQsSpecs,
} from './examCurriculumCatalogTierBResources';
import {
  examCurriculumTierBHwySpecs,
  examCurriculumTierBPnaSpecs,
  examCurriculumTierBPwSpecs,
  examCurriculumTierBRpttSpecs,
  examCurriculumTierBSfcSpecs,
} from './examCurriculumCatalogTierBPublic';

/** Tier-B families in canonical document order. */
export const examCurriculumTierBFamilies: Array<{
  title: string;
  documentId: string;
  specs: ExamCurriculumUnitSpec[];
}> = [
  { title: 'Agricultural Land Protection and Development Act', documentId: 'doc-agricultural-land-protection-and-development-act', specs: examCurriculumTierBAgriSpecs },
  { title: 'Air Space Act', documentId: 'doc-air-space-act', specs: examCurriculumTierBAirSpecs },
  { title: 'Assessment Act', documentId: 'doc-assessment-act', specs: examCurriculumTierBAsmtSpecs },
  { title: 'Clean Water Act', documentId: 'doc-clean-water-act', specs: examCurriculumTierBCwaSpecs },
  { title: 'Condominium Property Act', documentId: 'doc-condominium-property-act', specs: examCurriculumTierBCondoSpecs },
  { title: 'Conservation Easements Act', documentId: 'doc-conservation-easements-act', specs: examCurriculumTierBCeSpecs },
  { title: 'Crown Lands and Forests Act', documentId: 'doc-crown-lands-and-forests-act', specs: examCurriculumTierBClfSpecs },
  { title: 'Easements Act', documentId: 'doc-easements-act', specs: examCurriculumTierBEaseSpecs },
  { title: 'Evidence Act', documentId: 'doc-evidence-act', specs: examCurriculumTierBEvidSpecs },
  { title: 'Expropriation Act', documentId: 'doc-expropriation-act', specs: examCurriculumTierBExprSpecs },
  { title: 'Highway Act', documentId: 'doc-highway-act', specs: examCurriculumTierBHwySpecs },
  { title: 'Limitation of Actions Act', documentId: 'doc-limitation-of-actions-act', specs: examCurriculumTierBLimSpecs },
  { title: 'Mining Act', documentId: 'doc-mining-act', specs: examCurriculumTierBMinSpecs },
  { title: 'Oil and Natural Gas Act', documentId: 'doc-oil-and-natural-gas-act', specs: examCurriculumTierBOngSpecs },
  { title: 'Property Act', documentId: 'doc-property-act', specs: examCurriculumTierBPropSpecs },
  { title: 'Protected Natural Areas Act', documentId: 'doc-protected-natural-areas-act', specs: examCurriculumTierBPnaSpecs },
  { title: 'Public Works Act', documentId: 'doc-public-works-act', specs: examCurriculumTierBPwSpecs },
  { title: 'Quarriable Substances Act', documentId: 'doc-quarriable-substances-act', specs: examCurriculumTierBQsSpecs },
  { title: 'Real Property Transfer Tax Act', documentId: 'doc-real-property-transfer-tax-act', specs: examCurriculumTierBRpttSpecs },
  { title: 'Standard Forms of Conveyances Act', documentId: 'doc-standard-forms-of-conveyances-act', specs: examCurriculumTierBSfcSpecs },
  { title: 'Territorial Division Act', documentId: 'doc-territorial-division-act', specs: examCurriculumTierBTdaSpecs },
  { title: 'Trespass Act', documentId: 'doc-trespass-act', specs: examCurriculumTierBTrspSpecs },
];

/** Flat Tier-B spec list in canonical family order (43 units). */
export const examCurriculumTierBSpecs: ExamCurriculumUnitSpec[] = examCurriculumTierBFamilies.flatMap(
  (family) => family.specs,
);

export const EXAM_CURRICULUM_TIER_B_TOTAL = 43;

export const EXAM_CURRICULUM_TIER_B_EXPECTED_COUNTS: Record<string, number> = {
  'Agricultural Land Protection and Development Act': 2,
  'Air Space Act': 2,
  'Assessment Act': 2,
  'Clean Water Act': 2,
  'Condominium Property Act': 3,
  'Conservation Easements Act': 1,
  'Crown Lands and Forests Act': 3,
  'Easements Act': 2,
  'Evidence Act': 2,
  'Expropriation Act': 3,
  'Highway Act': 2,
  'Limitation of Actions Act': 2,
  'Mining Act': 3,
  'Oil and Natural Gas Act': 2,
  'Property Act': 2,
  'Protected Natural Areas Act': 1,
  'Public Works Act': 2,
  'Quarriable Substances Act': 2,
  'Real Property Transfer Tax Act': 1,
  'Standard Forms of Conveyances Act': 1,
  'Territorial Division Act': 1,
  'Trespass Act': 2,
};

export const EXAM_CURRICULUM_TIER_B_DOCUMENTS: readonly string[] = examCurriculumTierBFamilies.map(
  (family) => family.documentId,
);

/** Display titles for Tier-B documents (canonical corpus titles). */
export const EXAM_CURRICULUM_TIER_B_DOCUMENT_TITLES: Record<string, string> = Object.fromEntries(
  examCurriculumTierBFamilies.map((family) => [family.documentId, family.title]),
);

/** Combined Tier-A (51) + Tier-B (43) spec list used by the build script. */
export const EXAM_CURRICULUM_TOTAL = 94;

export const examCurriculumAllSpecs: ExamCurriculumUnitSpec[] = [
  ...examCurriculumTierASpecs,
  ...examCurriculumTierBSpecs,
];
