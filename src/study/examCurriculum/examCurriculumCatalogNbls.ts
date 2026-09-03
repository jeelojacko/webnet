// Exam Curriculum V1 — Tier-A catalog: NBLS Act + ANBLS Bylaws (13 units).
//
// Curated, deterministic curation data. Educational fields are concise
// curriculum-defining statements (not final learner-facing content).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const NBLS_ACT = 'doc-new-brunswick-land-surveyors-act';
const ANBLS_BYLAWS = 'doc-new-brunswick-land-surveyors-bylaws';

const nbls = (id: string, title: string, ranges: ExamCurriculumUnitSpec['ranges'], spec: Omit<ExamCurriculumUnitSpec, 'id' | 'title' | 'documentId' | 'ranges' | 'unitType'>): ExamCurriculumUnitSpec => ({
  id,
  title,
  unitType: id === 'A-NBLS-01' ? 'document_orientation' : 'core_concept',
  documentId: NBLS_ACT,
  ranges,
  ...spec,
});

const bylaws = (id: string, title: string, ranges: ExamCurriculumUnitSpec['ranges'], spec: Omit<ExamCurriculumUnitSpec, 'id' | 'title' | 'documentId' | 'ranges' | 'unitType'>): ExamCurriculumUnitSpec => ({
  id,
  title,
  unitType: id === 'A-BYL-01' ? 'document_orientation' : 'core_concept',
  documentId: ANBLS_BYLAWS,
  ranges,
  ...spec,
});

export const examCurriculumTierANblsSpecs: ExamCurriculumUnitSpec[] = [
  nbls(
    'A-NBLS-01',
    'What does the NBLS Act govern, and what counts as land surveying?',
    [{ from: '2' }, { from: '5', to: '8' }],
    {
      learningDepths: ['recognize', 'understand', 'recall'],
      examGoal:
        'Recognize the professional statute and understand the statutory scope of the practice of land surveying and the Association.',
      recognitionCues: [
        'statute governing the practice of land surveying in New Brunswick',
        'professional/Association regulation of a surveying body',
      ],
      coreUnderstanding: [
        'statutory definition/scope of land surveying;',
        "Association's purpose and regulatory role.",
      ],
      mustRecall: [
        'legal-boundary determination is core practice;',
        'locating things relative to boundaries can constitute practice;',
        'watercourse boundary work and preparation of related plans/documents/advice fall within the statutory scope.',
      ],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  nbls(
    'A-NBLS-02',
    'How does a person become authorized to practise?',
    [{ from: '12', to: '19' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the qualification, Board of Examiners, registration and register framework.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'qualification requirements for registration', sectionLabel: '15' },
        { prompt: 'Board of Examiners composition and authority', sectionLabel: '12' },
        { prompt: 'register of registrants and its publication', sectionLabel: '18' },
        { prompt: 'fees and membership status provisions', sectionLabel: '19' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  nbls(
    'A-NBLS-03',
    'Who may practise, and how may firms practise?',
    [{ from: '16', to: '17' }, { from: '28', to: '29' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: 'Distinguish individual registration from organizational authorization to practise.',
      recognitionCues: [],
      coreUnderstanding: [
        'distinction between individual registration and organizational authorization;',
        'certificate-of-authorization framework;',
        'unauthorized-practice consequences.',
      ],
      mustRecall: [
        'Individual practice is tied to registration under the Act, while partnerships, associations and corporations practise through the Act\u2019s organizational-authorization framework.',
      ],
      mustLocate: [
        { prompt: 'who may practise as a registered land surveyor', sectionLabel: '16' },
        { prompt: 'authorization of partnerships and firms', sectionLabel: '17' },
        { prompt: 'consequences of practicing without registration/authorization', sectionLabel: '29' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  nbls(
    'A-NBLS-04',
    "What responsibility attaches to a surveyor's professional work?",
    [{ from: '30', to: '35' }],
    {
      learningDepths: ['understand', 'recall'],
      examGoal:
        'Understand the statutory responsibilities attached to survey plans, reports, records and opinions.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'final professional survey plans/reports/opinions/documents intended to be relied upon require the responsible surveyor\u2019s signature/seal where prescribed;',
        'professional records/plans carry statutory responsibilities.',
      ],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  nbls(
    'A-NBLS-05',
    'How do complaints, discipline and appeals work?',
    [{ from: '20', to: '25' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the complaint, discipline and appeal structure without memorizing every procedural detail.',
      recognitionCues: [],
      coreUnderstanding: ['complaint \u2192 investigation/committee \u2192 discipline/hearing \u2192 appeal structure.'],
      mustRecall: [],
      mustLocate: [
        { prompt: 'constitution of the Complaints Committee', sectionLabel: '20' },
        { prompt: 'discipline proceedings and available orders', sectionLabel: '23' },
        { prompt: 'appeal of discipline committee decisions', sectionLabel: '25' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  nbls(
    'A-NBLS-06',
    'What enforcement and field authority does the Act provide?',
    [{ from: '26', to: '29' }, { from: '36', to: '38' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: 'Recognize the enforcement and field-authority provisions of the Act.',
      recognitionCues: ['unauthorized practice offences', 'field access and property authority in surveying'],
      coreUnderstanding: [
        'unauthorized practice/offences;',
        'relevant field/property authority;',
        'protections/limitations.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'offences and penalties for unauthorized practice', sectionLabel: '26' },
        { prompt: 'civil liability protections for members and officers', sectionLabel: '36' },
        { prompt: 'field/property authority and entry to land', sectionLabel: '38' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierABylawsSpecs: ExamCurriculumUnitSpec[] = [
  bylaws(
    'A-BYL-01',
    'How are the ANBLS Bylaws organized and what do they add to the Act?',
    [{ from: '1.1' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Orient to the Bylaws\u2019 part structure and understand what the Bylaws add on top of the NBLS Act.',
      recognitionCues: [
        'professional-association internal governance (membership, Council, committees, fees)',
        'bylaw part-numbered structure (e.g. 2.1, 3.1, 6.5)',
      ],
      coreUnderstanding: [
        'the Bylaws operationalize the Association: membership, governance, practice standards and discipline details;',
        'the Act sets out the statutory framework while the Bylaws govern internal Association life.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'how the Bylaws are organized (arrangement/navigation)', sectionLabel: '1.1' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bylaws(
    'A-BYL-02',
    'Membership classes, applications and registration',
    [{ from: '2.1', to: '2.5' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the membership classification and registration/application framework.',
      recognitionCues: [],
      coreUnderstanding: [
        'member classifications;',
        'SIT;',
        'registration/application/status framework.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'classes of membership and their conditions' },
        { prompt: 'membership applications and registration of members' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bylaws(
    'A-BYL-03',
    'Practice through partnerships, associations and corporations',
    [{ from: '3' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand how the Association governs practice by groups and organizations.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'requirements for practice by partnerships, associations or corporations' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  bylaws(
    'A-BYL-04',
    'Who governs what inside ANBLS?',
    [{ from: '5' }, { from: '6' }],
    {
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: 'Identify the proper decision-maker/body for a given Association matter.',
      recognitionCues: ['governance bodies of a professional association', 'committee jurisdictions'],
      coreUnderstanding: [
        'Council;',
        'Registrar;',
        'major committees;',
        'identify the proper decision-maker/body.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'Council powers and composition' },
        { prompt: 'Registrar duties' },
        { prompt: 'major committees and their jurisdictions' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  bylaws(
    'A-BYL-05',
    'Complaints, hearings and professional misconduct',
    [{ from: '8' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the Bylaws\u2019 complaints, hearings and misconduct framework.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'complaint and hearing procedure', },
        { prompt: 'professional misconduct standards and sanctions' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bylaws(
    'A-BYL-06',
    'Quality assurance, plan validation, survey review, insurance and continuing education',
    [{ from: '11' }, { from: '12' }, { from: '18' }, { from: '19' }],
    {
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal:
        'Understand the Bylaws\u2019 quality-assurance framework, including the plan-after-monumentation requirement and its general exception structure.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'When a survey results in monuments being placed, a Survey Plan must generally be prepared in accordance with the Standards Manual; the Bylaws provide an exception for monumentation complying with qualifying existing coordinated plans.',
      ],
      mustLocate: [
        { prompt: 'quality assurance and plan validation requirements' },
        { prompt: 'survey review requirements' },
        { prompt: 'insurance requirements' },
        { prompt: 'continuing education requirements' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  bylaws(
    'A-BYL-07',
    'Professional standards, seals and code of conduct',
    [{ from: '7' }, { from: '10' }, { from: '14' }],
    {
      learningDepths: ['understand', 'retrieve'],
      examGoal: 'Understand the Bylaws\u2019 professional standards, seal and code-of-conduct provisions.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'seal and seal-usage provisions' },
        { prompt: 'code of conduct / professional standards' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];
