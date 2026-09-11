// Exam Curriculum V1 — Tier-C + Tier-D catalog glue.
//
// Combines the 21 Tier-C catalog families and the 6 Tier-D catalog families
// into flat, deterministic spec lists and exposes the Tier-C/Tier-D document
// family counts / canonical document IDs / display titles. Tier C is a
// lightweight open-book orientation layer (21 documents); Tier D is an
// awareness-only layer (6 documents).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';
import {
  examCurriculumTierCAquacultureSpecs,
  examCurriculumTierCArchivesSpecs,
  examCurriculumTierCBituminousShaleSpecs,
  examCurriculumTierCCleanEnvironmentSpecs,
  examCurriculumTierCCrownGrantRestrictionsSpecs,
  examCurriculumTierCDevolutionOfEstatesSpecs,
  examCurriculumTierCElectronicTransactionsSpecs,
  examCurriculumTierCEscheatsAndForfeituresSpecs,
  examCurriculumTierCExecutorsAndTrusteesSpecs,
  examCurriculumTierCGasDistributionSpecs,
  examCurriculumTierCMaritalPropertySpecs,
  examCurriculumTierCMetricConversionSpecs,
  examCurriculumTierCOccupationalHealthAndSafetySpecs,
  examCurriculumTierCOwnershipOfMineralsSpecs,
  examCurriculumTierCParksSpecs,
  examCurriculumTierCProbateCourtSpecs,
  examCurriculumTierCPublicHealthSpecs,
  examCurriculumTierCEnergyAndUtilitiesBoardSpecs,
  examCurriculumTierCServiceNewBrunswickSpecs,
  examCurriculumTierCUndergroundStorageSpecs,
  examCurriculumTierCWillsSpecs,
} from './examCurriculumCatalogTierC';
import {
  examCurriculumTierDAssignmentsAndPreferencesSpecs,
  examCurriculumTierDMunicipalitiesSpecs,
  examCurriculumTierDOfficialLanguagesSpecs,
  examCurriculumTierDPartnershipsSpecs,
  examCurriculumTierDPublicRecordsSpecs,
  examCurriculumTierDResidentialPropertyTaxReliefSpecs,
} from './examCurriculumCatalogTierD';

/** Tier-C families in canonical (blueprint) document order. */
export const examCurriculumTierCFamilies: Array<{
  title: string;
  documentId: string;
  specs: ExamCurriculumUnitSpec[];
}> = [
  { title: 'Aquaculture Act', documentId: 'doc-aquaculture-act', specs: examCurriculumTierCAquacultureSpecs },
  { title: 'Archives Act', documentId: 'doc-archives-act', specs: examCurriculumTierCArchivesSpecs },
  { title: 'Bituminous Shale Act', documentId: 'doc-bituminous-shale-act', specs: examCurriculumTierCBituminousShaleSpecs },
  { title: 'Clean Environment Act', documentId: 'doc-clean-environment-act', specs: examCurriculumTierCCleanEnvironmentSpecs },
  { title: 'Crown Grant Restrictions Act', documentId: 'doc-crown-grant-restrictions-act', specs: examCurriculumTierCCrownGrantRestrictionsSpecs },
  { title: 'Devolution of Estates Act', documentId: 'doc-devolution-of-estates-act', specs: examCurriculumTierCDevolutionOfEstatesSpecs },
  { title: 'Electronic Transactions Act', documentId: 'doc-electronic-transactions-act', specs: examCurriculumTierCElectronicTransactionsSpecs },
  { title: 'Escheats and Forfeitures Act', documentId: 'doc-escheats-and-forfeitures-act', specs: examCurriculumTierCEscheatsAndForfeituresSpecs },
  { title: 'Executors and Trustees Act', documentId: 'doc-executors-and-trustees-act', specs: examCurriculumTierCExecutorsAndTrusteesSpecs },
  { title: 'Gas Distribution Act, 1999', documentId: 'doc-gas-distribution-act', specs: examCurriculumTierCGasDistributionSpecs },
  { title: 'Marital Property Act', documentId: 'doc-marital-property-act', specs: examCurriculumTierCMaritalPropertySpecs },
  { title: 'Metric Conversion Act', documentId: 'doc-metric-conversion-act', specs: examCurriculumTierCMetricConversionSpecs },
  { title: 'Occupational Health and Safety Act', documentId: 'doc-occupational-health-and-safety-act', specs: examCurriculumTierCOccupationalHealthAndSafetySpecs },
  { title: 'Ownership of Minerals Act', documentId: 'doc-ownership-of-minerals-act', specs: examCurriculumTierCOwnershipOfMineralsSpecs },
  { title: 'Parks Act', documentId: 'doc-parks-act', specs: examCurriculumTierCParksSpecs },
  { title: 'Probate Court Act', documentId: 'doc-probate-court-act', specs: examCurriculumTierCProbateCourtSpecs },
  { title: 'Public Health Act', documentId: 'doc-public-health-act', specs: examCurriculumTierCPublicHealthSpecs },
  { title: 'Energy and Utilities Board Act', documentId: 'doc-energy-and-utilities-board-act', specs: examCurriculumTierCEnergyAndUtilitiesBoardSpecs },
  { title: 'Service New Brunswick Act', documentId: 'doc-service-new-brunswick-act', specs: examCurriculumTierCServiceNewBrunswickSpecs },
  { title: 'Underground Storage Act', documentId: 'doc-underground-storage-act', specs: examCurriculumTierCUndergroundStorageSpecs },
  { title: 'Wills Act', documentId: 'doc-wills-act', specs: examCurriculumTierCWillsSpecs },
];

/** Tier-D families in canonical (blueprint) document order. */
export const examCurriculumTierDFamilies: Array<{
  title: string;
  documentId: string;
  specs: ExamCurriculumUnitSpec[];
}> = [
  { title: 'Assignments and Preferences Act', documentId: 'doc-assignments-and-preferences-act', specs: examCurriculumTierDAssignmentsAndPreferencesSpecs },
  { title: 'Municipalities Act', documentId: 'doc-municipalities-act', specs: examCurriculumTierDMunicipalitiesSpecs },
  { title: 'Official Languages Act', documentId: 'doc-official-languages-act', specs: examCurriculumTierDOfficialLanguagesSpecs },
  { title: 'Partnerships and Business Names Registration Act', documentId: 'doc-partnerships-and-business-names-registration-act', specs: examCurriculumTierDPartnershipsSpecs },
  { title: 'Public Records Act', documentId: 'doc-public-records-act', specs: examCurriculumTierDPublicRecordsSpecs },
  { title: 'Residential Property Tax Relief Act', documentId: 'doc-residential-property-tax-relief-act', specs: examCurriculumTierDResidentialPropertyTaxReliefSpecs },
];

/** Flat Tier-C spec list in canonical family order (21 units). */
export const examCurriculumTierCSpecs: ExamCurriculumUnitSpec[] = examCurriculumTierCFamilies.flatMap(
  (family) => family.specs,
);

/** Flat Tier-D spec list in canonical family order (6 units). */
export const examCurriculumTierDSpecs: ExamCurriculumUnitSpec[] = examCurriculumTierDFamilies.flatMap(
  (family) => family.specs,
);

export const EXAM_CURRICULUM_TIER_C_TOTAL = 21;
export const EXAM_CURRICULUM_TIER_D_TOTAL = 6;

/** Every Tier-C/D document appears exactly once as a single-unit family. */
export const EXAM_CURRICULUM_TIER_C_EXPECTED_COUNTS: Record<string, number> = Object.fromEntries(
  examCurriculumTierCFamilies.map((family) => [family.title, 1]),
);
export const EXAM_CURRICULUM_TIER_D_EXPECTED_COUNTS: Record<string, number> = Object.fromEntries(
  examCurriculumTierDFamilies.map((family) => [family.title, 1]),
);

export const EXAM_CURRICULUM_TIER_C_DOCUMENTS: readonly string[] = examCurriculumTierCFamilies.map(
  (family) => family.documentId,
);
export const EXAM_CURRICULUM_TIER_D_DOCUMENTS: readonly string[] = examCurriculumTierDFamilies.map(
  (family) => family.documentId,
);

/** Display titles for Tier-C documents (canonical corpus titles). */
export const EXAM_CURRICULUM_TIER_C_DOCUMENT_TITLES: Record<string, string> = Object.fromEntries(
  examCurriculumTierCFamilies.map((family) => [family.documentId, family.title]),
);

/** Display titles for Tier-D documents (canonical corpus titles). */
export const EXAM_CURRICULUM_TIER_D_DOCUMENT_TITLES: Record<string, string> = Object.fromEntries(
  examCurriculumTierDFamilies.map((family) => [family.documentId, family.title]),
);
