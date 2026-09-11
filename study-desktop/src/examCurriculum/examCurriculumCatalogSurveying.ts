// Exam Curriculum V1 — Tier-A catalog: Surveys Act, Reg 84-76,
// Boundaries Confirmation Act, Reg 95-166 (13 units).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const SURVEYS_ACT = 'doc-surveys-act';
const SURVEYS_REG = 'reg-surveys-84-76';
const BCA = 'doc-boundaries-confirmation-act';
const BCA_REG = 'reg-boundaries-95-166';

const unit =
  (documentId: string, isOrientation: (_id: string) => boolean) =>
  (id: string, title: string, ranges: ExamCurriculumUnitSpec['ranges'], spec: Omit<ExamCurriculumUnitSpec, 'id' | 'title' | 'documentId' | 'ranges' | 'unitType'>): ExamCurriculumUnitSpec => ({
    id,
    title,
    unitType: isOrientation(id) ? 'document_orientation' : 'core_concept',
    documentId,
    ranges,
    ...spec,
  });

const surv = unit(SURVEYS_ACT, (id) => id === 'A-SURV-01');
const survr = unit(SURVEYS_REG, () => false);
const bca = unit(BCA, (id) => id === 'A-BCA-01');
const bcar = unit(BCA_REG, () => false);

export const examCurriculumTierASurveysSpecs: ExamCurriculumUnitSpec[] = [
  surv(
    'A-SURV-01',
    'What is the Surveys Act about?',
    [{ from: '1', to: '3' }],
    {
      learningDepths: ['recognize', 'understand'],
      examGoal:
        'Recognize the Surveys Act and understand the coordinate survey system, monuments and the Director of Surveys.',
      recognitionCues: [
        'provincial statute on land surveying standards and monuments',
        'coordinate survey system / Director of Surveys',
      ],
      coreUnderstanding: [
        'surveys;',
        'legal monuments;',
        'coordinate monuments;',
        'coordinate survey system;',
        'Director of Surveys.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  surv(
    'A-SURV-02',
    'Coordinate survey systems and coordinate monuments',
    [{ from: '2', to: '6' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand how the coordinate survey system and coordinate monuments work.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'establishment of the provincial coordinate survey system', sectionLabel: '2' },
        { prompt: 'surveyor duties respecting the coordinate survey system', sectionLabel: '4' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  surv(
    'A-SURV-03',
    'What changes inside an integrated survey area?',
    [{ from: '5', to: '8' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: 'Understand the requirements that change inside an integrated survey area.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'relevant legal monuments established by the surveyor must be tied into the coordinate-monument framework where the Act requires;',
        'subdivision work is explicitly included;',
        'certification responsibility remains with the surveyor.',
      ],
      mustLocate: [
        { prompt: 'integrated survey area plan and duties', sectionLabel: '7' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  surv(
    'A-SURV-04',
    'Plan certification and lost legal monuments',
    [{ from: '8' }, { from: '12' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand plan filing/certification in an integrated survey area and handling of lost legal monuments.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'survey plan requirements in an integrated survey area', sectionLabel: '8' },
        { prompt: 'procedure for lost legal monuments', sectionLabel: '12' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  surv(
    'A-SURV-05',
    'Entry onto private property, offences and administration',
    [{ from: '13', to: '15' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Recognize the entry, offence and administration provisions of the Surveys Act.',
      recognitionCues: ['survey entry onto private property', 'offences and penalties in surveying statutes'],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'authority respecting private property', sectionLabel: '13' },
        { prompt: 'offences and penalties', sectionLabel: '14' },
        { prompt: 'administration and regulations', sectionLabel: '14.1' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierASurveysRegSpecs: ExamCurriculumUnitSpec[] = [
  survr(
    'A-SURVR-01',
    'Control points, coordinate monuments and when lot monuments need not be planted',
    [{ from: '2', to: '5' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal:
        'Understand control points and coordinate monument requirements, and know where to look up numeric thresholds.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'control point and coordinate monument requirements' },
        { prompt: 'when lot monuments need not be planted' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  survr(
    'A-SURVR-02',
    'What must accompany a plan submitted for approval?',
    [{ from: '6', to: '7' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand what must accompany a plan submitted for approval.',
      recognitionCues: [],
      coreUnderstanding: [
        'plan;',
        'field notes;',
        'computations;',
        "Director's standard-setting/approval framework.",
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'contents required with a plan submission for approval' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierABcaSpecs: ExamCurriculumUnitSpec[] = [
  bca(
    'A-BCA-01',
    'What problem does boundary confirmation solve?',
    [{ from: '1' }, { from: '6', to: '8' }],
    {
      learningDepths: ['recognize', 'understand'],
      examGoal:
        'Recognize the Boundaries Confirmation Act and understand the problem it solves.',
      recognitionCues: [
        'statute confirming disputed or uncertain boundaries',
        'application/objection/hearing process for land boundaries',
      ],
      coreUnderstanding: [
        'boundary confirmation resolves disputes/uncertainties over land boundaries by a statutory decision process;',
        'the confirmed boundary then carries legal effect.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bca(
    'A-BCA-02',
    'Application, notice, objections and parties',
    [{ from: '7' }, { from: '9', to: '10' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the application, notice, objection and party framework.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'application for confirmation of boundaries' },
        { prompt: 'notice, objections and joining of parties' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bca(
    'A-BCA-03',
    'Hearing, order, appeal and certification',
    [{ from: '11', to: '14' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the hearing, order, appeal and certification steps.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'hearing and order confirming boundaries' },
        { prompt: 'appeal and certification of the order' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bca(
    'A-BCA-04',
    'What happens to the boundary after the decision?',
    [{ from: '15', to: '20' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the legal effect of a confirmation decision on the boundary.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'effect of the confirmed boundary and enforcement' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierABcaRegSpecs: ExamCurriculumUnitSpec[] = [
  bcar(
    'A-BCAR-01',
    'What must accompany a boundary-confirmation application?',
    [{ from: '2', to: '4' }],
    {
      forms: ['Form 1'],
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal:
        'Understand the application package for boundary confirmation and what the surveyor\u2019s report addresses.',
      recognitionCues: [],
      coreUnderstanding: [
        'the application package can involve: current survey; field notes; surveyor\u2019s report; instruments; affected owners/interests; supporting evidence.',
        "the surveyor\u2019s report addresses: issue; boundary history; evidence; reasoning for accepting/rejecting competing boundary evidence.",
      ],
      mustRecall: [
        'A boundary-confirmation surveyor\u2019s report addresses the issue to be determined, the history of the boundary, the evidence relied on, and the reasons for accepting or rejecting competing boundary evidence.',
      ],
      mustLocate: [
        { prompt: 'application contents for boundary confirmation' },
        { prompt: 'form of the application', formLabel: 'Form 1' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bcar(
    'A-BCAR-02',
    'Evidence, hearings, filing, appeals and fees',
    [{ from: '5', to: '10' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the Regulation\u2019s evidence, hearing, filing, appeal and fee provisions.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'evidence and hearing requirements' },
        { prompt: 'filing, appeals and fees' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];
