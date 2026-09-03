// Exam Curriculum V1 — Tier-A catalog: Community Planning Act, Reg 80-159,
// Registry Act, Reg 84-190 (15 units).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const CPA = 'doc-community-planning-act';
const CPA_REG = 'reg-community-planning-80-159';
const REGISTRY_ACT = 'doc-registry-act';
const REGISTRY_REG = 'reg-registry-84-190';

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

const cpa = unit(CPA, (id) => id === 'A-CPA-01');
const cpar = unit(CPA_REG, () => false);
const reg = unit(REGISTRY_ACT, (id) => id === 'A-REG-01');
const regr = unit(REGISTRY_REG, (id) => id === 'A-REGR-01');

export const examCurriculumTierACpaSpecs: ExamCurriculumUnitSpec[] = [
  cpa(
    'A-CPA-01',
    'How does New Brunswick\u2019s planning system fit together?',
    [{ from: '1', to: '52' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Recognize the Community Planning Act and understand how New Brunswick\u2019s planning system fits together.',
      recognitionCues: [
        'provincial planning/zoning legislation',
        'provincial-planning authority / regional planning context',
      ],
      coreUnderstanding: [
        'the Act provides the provincial framework for planning, zoning and development control;',
        'planning decisions involve provincial, regional/county and local-government layers.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'definitions and structure of the planning framework' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  cpa(
    'A-CPA-02',
    'Zoning, development, variances and street controls',
    [{ from: '53', to: '73' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: 'Understand the zoning, development-control, variance and street-control provisions.',
      recognitionCues: [
        'zoning by-law / development controls',
        'variances (minor variances / exemptions) in planning law',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'zoning and development control provisions' },
        { prompt: 'variances and exemptions' },
        { prompt: 'street controls' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  cpa(
    'A-CPA-03',
    'How does the subdivision process start?',
    [{ from: '74', to: '82' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand how the subdivision process starts.',
      recognitionCues: [],
      coreUnderstanding: [
        'subdivision framework;',
        'tentative plans;',
        'exemptions;',
        'development officer.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'making of the subdivision by-law', sectionLabel: '74' },
        { prompt: 'exemptions for certain parcels or conveyances', sectionLabel: '80' },
        { prompt: 'tentative subdivision plan', sectionLabel: '81' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  cpa(
    'A-CPA-04',
    'From approved tentative plan to registered subdivision plan',
    [{ from: '83', to: '90' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: 'Understand the path from approved tentative plan to registered subdivision plan.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'application for approval of a subdivision plan', sectionLabel: '84' },
        { prompt: 'approval of a subdivision plan', sectionLabel: '85' },
        { prompt: 'filing of a subdivision plan', sectionLabel: '86' },
        { prompt: 'amendments to a subdivision plan', sectionLabel: '89' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  cpa(
    'A-CPA-05',
    'What technical survey information belongs on a subdivision plan?',
    [{ from: '83', to: '89' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: 'Understand what technical survey information belongs on a subdivision plan.',
      recognitionCues: [],
      coreUnderstanding: [
        'monuments;',
        'boundaries;',
        'title-block information;',
        'lots/streets;',
        'easements/public-purpose land;',
        'curve/boundary information.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'information required in the subdivision plan application (especially s.84)', sectionLabel: '84' },
        { prompt: 'lay-out of streets and lots', sectionLabel: '83' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  cpa(
    'A-CPA-06',
    'Who approves, varies, appeals and enforces planning decisions?',
    [{ from: '108', to: '140' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: 'Identify who approves, varies, appeals and enforces planning decisions.',
      recognitionCues: [
        'planning decision appeals (board/appeal body)',
        'enforcement of planning and zoning decisions',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'appeal body for planning decisions' },
        { prompt: 'enforcement and prosecution of planning violations' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierACpaRegSpecs: ExamCurriculumUnitSpec[] = [
  cpar(
    'A-CPAR-01',
    'Provincial subdivision street, lot and access standards',
    [{ from: '2', to: '6' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal:
        'Understand the provincial subdivision street, lot and access standards, with numeric thresholds kept as lookup material.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'street standards for subdivisions' },
        { prompt: 'lot standards for subdivisions' },
        { prompt: 'access requirements' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  cpar(
    'A-CPAR-02',
    'When may or must a development officer approve a subdivision plan?',
    [{ from: '7', to: '7.1' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand when a development officer may or must approve a subdivision plan.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'development officer approval of subdivision plans', sectionLabel: '7' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierARegistrySpecs: ExamCurriculumUnitSpec[] = [
  reg(
    'A-REG-01',
    'What is the Registry system and when does the Registry Act matter?',
    [{ from: '1', to: '19.1' }],
    {
      learningDepths: ['recognize', 'understand'],
      examGoal:
        'Recognize the Registry system, understand when the Registry Act matters, and understand the distinction from Land Titles.',
      recognitionCues: [
        'deeds-based / registry system of land registration',
        'registry office, registrar and registration of instruments',
      ],
      coreUnderstanding: [
        'the Registry is a deeds-based system: instruments are registered in order and affect priority;',
        'distinct from the Land Titles system, where registration vests and insures title.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  reg(
    'A-REG-02',
    'What is registration supposed to accomplish?',
    [{ from: '19', to: '35' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: 'Understand what registration accomplishes, using the legal effect of registration as the conceptual anchor.',
      recognitionCues: [],
      coreUnderstanding: [
        'legal effect of registration: priority and notice consequences for registered instruments.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'registration of instruments', sectionLabel: '19' },
        { prompt: 'contents of a conveyance', sectionLabel: '20' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  reg(
    'A-REG-03',
    'Execution, witnesses, affidavits, acknowledgments and proof',
    [{ from: '36', to: '47' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal:
        'Understand execution, witnessing, affidavit, acknowledgment and proof requirements.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'a party to an instrument shall not witness another party\u2019s execution;',
        'a party shall not take the affidavit/acknowledgment of another party\u2019s execution.',
      ],
      mustLocate: [
        { prompt: 'official/person lists for taking acknowledgments and proofs' },
        { prompt: 'out-of-province execution and proof details' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  reg(
    'A-REG-04',
    'Plans, Crown grants, mortgages, judgments and other land records',
    [{ from: '48', to: '64' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Recognize the registry provisions covering plans, Crown grants, mortgages, judgments and other land records.',
      recognitionCues: [
        'registered land records beyond conveyances (plans, Crown grants, mortgages, judgments)',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'registration of plans' },
        { prompt: 'Crown grants' },
        { prompt: 'mortgages and judgments in the registry' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  reg(
    'A-REG-05',
    'Digital instruments and the surveyor/subscriber pathway',
    [{ from: '13.2' }, { from: '19.01', to: '19.05' }, { from: '65.1' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: 'Understand digital/digitally-scanned instruments and the surveyor/subscriber pathway.',
      recognitionCues: [
        'digital or digitally scanned instruments in the registry',
        'subscriber/agreement pathway for electronic submission',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'electronic information storage system', sectionLabel: '13.2' },
        { prompt: 'instruments that may be submitted as digitally scanned images', sectionLabel: '19.01' },
        { prompt: 'effect of a digitally scanned image of an instrument', sectionLabel: '19.04' },
        { prompt: 'subscriber or land surveyor agreement', sectionLabel: '19.05' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  reg(
    'A-REG-06',
    'Registrar, records, searches, fees and regulation-making',
    [{ from: '12', to: '18' }, { from: '65', to: '71' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: 'Understand the registrar, registry records, searches, fees and regulation-making powers.',
      recognitionCues: [
        'registrar / registry office administration',
        'official searches and fees',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'duties of the registrar', sectionLabel: '12' },
        { prompt: 'contents of the registry office and record production', sectionLabel: '14' },
        { prompt: 'powers of the Chief Registrar', sectionLabel: '17' },
        { prompt: 'fees and regulation-making' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierARegistryRegSpecs: ExamCurriculumUnitSpec[] = [
  regr(
    'A-REGR-01',
    'Instrument formatting standards for Registry documents',
    [{ from: '1', to: '4' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Recognize the Registry Regulation\u2019s instrument formatting standards and understand what they standardize; keep exact margins/sizes/format rules as lookup material.',
      recognitionCues: [
        'formatting standards for registry instruments',
        'instrument size, margins and paper standards',
      ],
      coreUnderstanding: [
        'the Regulation standardizes how registry instruments are physically prepared (size, margins, format) so documents registered in the Registry are uniform;',
        'exact numeric formatting rules are open-book lookup material, not memorization targets.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'instrument size, margins and format rules' },
        { prompt: 'paper and preparation standards for registered documents' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];
