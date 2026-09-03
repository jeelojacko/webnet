// Exam Curriculum V1 — Tier-B catalog (resources): Mining, Oil and Natural Gas, Quarriable Substances (7 units).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const MINING = 'doc-mining-act';
const OIL_NATURAL_GAS = 'doc-oil-and-natural-gas-act';
const QUARRIABLE_SUBSTANCES = 'doc-quarriable-substances-act';

const unit =
  (documentId: string, isOrientation: (_id: string) => boolean) =>
  (
    id: string,
    title: string,
    ranges: ExamCurriculumUnitSpec['ranges'],
    spec: Omit<ExamCurriculumUnitSpec, 'id' | 'title' | 'documentId' | 'ranges' | 'unitType'>,
  ): ExamCurriculumUnitSpec => ({
    id,
    title,
    unitType: isOrientation(id) ? 'document_orientation' : 'core_concept',
    documentId,
    ranges,
    ...spec,
  });

const mining = unit(MINING, (id) => id === 'B-MIN-01');
const ong = unit(OIL_NATURAL_GAS, (id) => id === 'B-ONG-01');
const qs = unit(QUARRIABLE_SUBSTANCES, (id) => id === 'B-QS-01');

export const examCurriculumTierBMinSpecs: ExamCurriculumUnitSpec[] = [
  mining(
    'B-MIN-01',
    'What does the Mining Act govern and how are mineral rights organized?',
    [
      { from: '1', to: '6' },
      { from: '24', to: '30' },
      { from: '44', to: '48.2' },
      { from: '67', to: '69' },
      { from: '75', to: '78' },
      { from: '98', to: '105' },
    ],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'mineral rights/regulatory administration;',
        'prospecting;',
        'mineral claims;',
        'mining leases;',
        'registration/priority;',
        'relation between mineral interests and surface land.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  mining(
    'B-MIN-02',
    'How are mineral claims located and what land rights follow a claim?',
    [
      { from: '24', to: '36' },
      { from: '44', to: '61' },
      { from: '109' },
    ],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'A mineral claim is described using the New Brunswick Mineral and Petroleum Grid and referenced to UTM grid coordinates in NAD83(CSRS), and the claim-area boundaries extend vertically downward.',
      ],
      mustLocate: [
        { prompt: 'land closed/open to prospecting', sectionLabel: '24' },
        { prompt: 'prospector rights/access', sectionLabel: '35' },
        { prompt: 'claim registration', sectionLabel: '44' },
        { prompt: 'priority/renewal/surrender/disputes', sectionLabel: '51' },
        { prompt: 'surface-owner contact/damage/reclamation obligations', sectionLabel: '109' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  mining(
    'B-MIN-03',
    'Boundary surveys under the Mining Act',
    [{ from: '90', to: '94' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'Minister may order the survey;',
        'surveyor has statutory entry rights for the survey subject to avoiding unnecessary damage;',
        'statutory rules determine what boundaries are surveyed.',
      ],
      mustRecall: [
        'A boundary survey under the Mining Act must be carried out by a land surveyor qualified under New Brunswick law and in accordance with the Surveys Act.',
        'Angles in such a boundary survey are designated by coordinates under the Surveys Act coordinate system, and orthometric heights use CGVD2013 based on a benchmark approved by the Director of Surveys.',
      ],
      mustLocate: [
        { prompt: 'survey qualification', sectionLabel: '90' },
        { prompt: 'coordinate/height framework', sectionLabel: '91' },
        { prompt: 'order of survey', sectionLabel: '92' },
        { prompt: 'surveyor entry rights', sectionLabel: '93' },
        { prompt: 'boundary rule', sectionLabel: '94' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBOngSpecs: ExamCurriculumUnitSpec[] = [
  ong(
    'B-ONG-01',
    'What does the Oil and Natural Gas Act govern?',
    [
      { from: '1', to: '4' },
      { from: '8', to: '15' },
      { from: '22', to: '35' },
    ],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'Crown oil/natural-gas interests;',
        'exploration licences;',
        'leases;',
        'surface entry;',
        'survey system.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  ong(
    'B-ONG-02',
    'Entry onto private land and the survey framework for oil and gas rights',
    [
      { from: '8', to: '10' },
      { from: '35' },
    ],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Where the holder cannot obtain the necessary agreement with the owner, tenant or occupant of private land, the Act provides a statutory special-order process for entry and use rather than an unrestricted right of entry.',
      ],
      mustLocate: [
        { prompt: 'Crown-land entry', sectionLabel: '8' },
        { prompt: 'ordinary/private-land entry', sectionLabel: '9' },
        { prompt: 'special order, notice, hearing, compensation/security', sectionLabel: '10' },
        { prompt: 'survey system', sectionLabel: '35' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBQsSpecs: ExamCurriculumUnitSpec[] = [
  qs(
    'B-QS-01',
    'How do quarry permits, quarry leases and peat rights relate to land?',
    [{ from: '1', to: '13' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'Crown ownership/administration of quarriable substances;',
        'quarry permits;',
        'quarry leases;',
        'peat exploration/leases;',
        'shore areas.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  qs(
    'B-QS-02',
    'Surveyed lease areas, changes, reclamation and filing',
    [
      { from: '7', to: '9' },
      { from: '13', to: '19' },
      { from: '26' },
    ],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'A quarry lease over Crown Lands requires the boundaries of the Crown Lands to be covered by the lease to have been surveyed in accordance with the regulations.',
      ],
      mustLocate: [
        { prompt: 'quarry-lease survey requirement', sectionLabel: '7' },
        { prompt: 'corresponding peat-lease requirements', sectionLabel: '9' },
        { prompt: 'lease term/renewal', sectionLabel: '13' },
        { prompt: 'obligations/reclamation', sectionLabel: '16' },
        { prompt: 'reduction/subdivision/amalgamation', sectionLabel: '19' },
        { prompt: 'execution/filing', sectionLabel: '26' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];
