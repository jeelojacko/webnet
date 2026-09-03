// Exam Curriculum V1 — Tier-A catalog: Land Titles Act + Reg 83-130 (10 units).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const LTA = 'doc-land-titles-act';
const LTA_REG = 'reg-land-titles-83-130';

const lta = (
  id: string,
  title: string,
  ranges: ExamCurriculumUnitSpec['ranges'],
  spec: Omit<ExamCurriculumUnitSpec, 'id' | 'title' | 'documentId' | 'ranges' | 'unitType'>,
): ExamCurriculumUnitSpec => ({
  id,
  title,
  unitType: id === 'A-LTA-01' ? 'document_orientation' : 'core_concept',
  documentId: LTA,
  ranges,
  ...spec,
});

const ltr = (
  id: string,
  title: string,
  ranges: ExamCurriculumUnitSpec['ranges'],
  spec: Omit<ExamCurriculumUnitSpec, 'id' | 'title' | 'documentId' | 'ranges' | 'unitType'>,
): ExamCurriculumUnitSpec => ({
  id,
  title,
  unitType: 'core_concept',
  documentId: LTA_REG,
  ranges,
  ...spec,
});

export const examCurriculumTierALandTitlesSpecs: ExamCurriculumUnitSpec[] = [
  lta(
    'A-LTA-01',
    'What is the Land Titles system and how is it different from Registry?',
    [{ from: '1', to: '10.4' }],
    {
      learningDepths: ['recognize', 'understand', 'recall'],
      examGoal:
        'Recognize the Land Titles system, understand how it works, and recall how it differs from the Registry system.',
      recognitionCues: [
        'land titles / title insurance style registration of land',
        'Registrar General and the title register',
      ],
      coreUnderstanding: [
        'the Land Titles system registers interests, not just instruments;',
        'registration under Land Titles insures registered ownership, unlike deeds-based Registry.',
      ],
      mustRecall: [
        'Land Titles registration is the primary evidence of registered ownership of the land.',
      ],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  lta(
    'A-LTA-02',
    'How does land enter the Land Titles system and what does registration do?',
    [{ from: '11', to: '20' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand how land enters the system and what registration accomplishes.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'application to register land', sectionLabel: '11' },
        { prompt: 'registration necessary to pass an estate or interest', sectionLabel: '15' },
        { prompt: 'status of the registered owner', sectionLabel: '16' },
        { prompt: 'effect of registration on subsequent interests', sectionLabel: '17' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  lta(
    'A-LTA-03',
    'Transfers, easements, mortgages, leases, assignments and caveats',
    [{ from: '21', to: '38' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: 'Recognize and understand the core registered-interest mechanics.',
      recognitionCues: [
        'registered interests: transfers, easements, mortgages, leases, caveats',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'transfer of registered land' },
        { prompt: 'easements and leases in the title register' },
        { prompt: 'mortgages and assignments' },
        { prompt: 'caveats' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  lta(
    'A-LTA-04',
    'Parcel changes, judgments, expropriation, bankruptcy and transmission on death',
    [{ from: '39', to: '67' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Recognize and understand parcel changes and the special transmission/compulsory-proceeding provisions.',
      recognitionCues: [
        'parcel consolidation/division mechanics',
        'registration on death, expropriation, bankruptcy',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'changes to parcels and parcel identifiers' },
        { prompt: 'judgments and charges in the title register' },
        { prompt: 'expropriation and bankruptcy transmission' },
        { prompt: 'transmission of land on death' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  lta(
    'A-LTA-05',
    'When and how can the title register be rectified?',
    [{ from: '68', to: '72' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand when and how the title register can be rectified.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'rectification of the title register' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  lta(
    'A-LTA-06',
    'When does rectification or registration error lead to indemnification?',
    [{ from: '73', to: '80' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal:
        'Understand when rectification or a registration error leads to indemnification, as a conceptual chain rather than an enumerated list of exceptions.',
      recognitionCues: [],
      coreUnderstanding: [
        'qualifying damage/error;',
        'statutory entitlement;',
        'exceptions;',
        'award;',
        'payment/funding.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'indemnification entitlement and exceptions' },
        { prompt: 'award and payment of indemnification' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  lta(
    'A-LTA-07',
    'Affidavits, registered information and regulation structure',
    [{ from: '81', to: '86' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Recognize the affidavit, registered-information and regulation-structure provisions.',
      recognitionCues: [
        'supporting provisions: affidavits, records and regulations',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'affidavits and registered information' },
        { prompt: 'regulations under the Land Titles Act' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierALandTitlesRegSpecs: ExamCurriculumUnitSpec[] = [
  ltr(
    'A-LTR-01',
    'Land descriptions, survey plans and Land Titles administration',
    [{ from: '2', to: '16' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the Regulation\u2019s land-description, survey-plan and administration provisions.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'land description requirements' },
        { prompt: 'survey plan requirements' },
        { prompt: 'land titles administration under the Regulation' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  ltr(
    'A-LTR-02',
    'Instrument execution, identity, format and electronic registration mechanics',
    [{ from: '17', to: '21.4' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand instrument execution, identity, format and electronic registration mechanics.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'execution and identity of instruments' },
        { prompt: 'instrument format requirements' },
        { prompt: 'electronic registration mechanics' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  ltr(
    'A-LTR-03',
    'Forms, fees, statutory mortgage covenants and statutory lease covenants',
    [{ from: '22', to: '24' }],
    {
      schedules: ['A', 'B', 'C', 'D'],
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Teach how to navigate the form/schedule system — do NOT enumerate dozens of forms into mustRecall.',
      recognitionCues: [
        'land titles forms and schedules (fees, covenants)',
      ],
      coreUnderstanding: [
        'forms and schedules are navigational material: locate the right schedule/form rather than memorize all of them.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'statutory fees', scheduleLabel: 'A' },
        { prompt: 'statutory mortgage covenants', scheduleLabel: 'B' },
        { prompt: 'statutory lease covenants', scheduleLabel: 'C' },
        { prompt: 'additional schedules', scheduleLabel: 'D' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];
