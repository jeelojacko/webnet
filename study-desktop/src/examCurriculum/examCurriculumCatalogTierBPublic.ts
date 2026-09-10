// Exam Curriculum V1 — Tier-B catalog (public): Highway, Protected Natural Areas, Public Works, Real Property Transfer Tax, Standard Forms of Conveyances (7 units).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const HWY = 'doc-highway-act';
const PNA = 'doc-protected-natural-areas-act';
const PW = 'doc-public-works-act';
const RPTT = 'doc-real-property-transfer-tax-act';
const SFC = 'doc-standard-forms-of-conveyances-act';

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

const hwy = unit(HWY, (id) => id === 'B-HWY-01');
const pna = unit(PNA, (id) => id === 'B-PNA-01');
const pw = unit(PW, (id) => id === 'B-PW-01');
const rptt = unit(RPTT, (id) => id === 'B-RPTT-01');
const sfc = unit(SFC, (id) => id === 'B-SFC-01');

export const examCurriculumTierBHwySpecs: ExamCurriculumUnitSpec[] = [
  hwy(
    'B-HWY-01',
    'What does the Highway Act control about land, highway creation and access?',
    [{ from: '1' }, { from: '11', to: '15' }, { from: '18', to: '34' }, { from: '38', to: '40' }, { from: '64', to: '68' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [
        'highway boundary',
        'highway right-of-way',
        'highway designation',
        'controlled-access highway',
        'road closure/discontinuance',
        'development area',
        'access to highway',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  hwy(
    'B-HWY-02',
    'How are highway location, width, boundaries, discontinuance and access controlled?',
    [{ from: '15' }, { from: '29', to: '34' }, { from: '38', to: '40' }, { from: '64', to: '68' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Where doubt or dispute arises as to the boundaries of a highway, the Highway Act deems a line along the centre line of the travelled portion to be the centre line of the highway.',
      ],
      mustLocate: [
        { prompt: 'highway certificate', sectionLabel: '29' },
        { prompt: 'statutory width rules/presumptions', sectionLabel: '30' },
        { prompt: 'discontinuance', sectionLabel: '33' },
        { prompt: 'closing', sectionLabel: '34' },
        { prompt: 'controlled access', sectionLabel: '38' },
        { prompt: 'control line', sectionLabel: '65' },
        { prompt: 'land constituting highway', sectionLabel: '68' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBPnaSpecs: ExamCurriculumUnitSpec[] = [
  pna(
    'B-PNA-01',
    'Protected natural areas: boundaries, plans, restrictions and existing land interests',
    [{ from: '1', to: '22' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'establishment/alteration of protected-area boundaries;',
        'descriptions/plans;',
        'Class I/Class II restrictions;',
        'permits;',
        'acquisition/existing interests.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'establishment/alteration', sectionLabel: '5' },
        { prompt: 'filing of descriptions/plans', sectionLabel: '8' },
        { prompt: 'restrictions', sectionLabel: '11' },
        { prompt: 'permits/existing interests' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBPwSpecs: ExamCurriculumUnitSpec[] = [
  pw(
    'B-PW-01',
    'What does the Public Works Act do to land designated or acquired for a public work?',
    [{ from: '1', to: '3' }, { from: '9', to: '17' }, { from: '25' }, { from: '33' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [
        'public work',
        'government survey/entry',
        'designation of land',
        'public-work development area',
        'compensation',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  pw(
    'B-PW-02',
    'Entry, surveying, designation and compensation for public works',
    [{ from: '9', to: '17' }, { from: '25' }, { from: '33' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'For purposes connected with a public work, the Act authorizes the Minister and the authorized architects, engineers, agents and workers to enter land, survey and take levels, and make the specified investigative borings or trial pits.',
      ],
      mustLocate: [
        { prompt: 'land-entry/survey authority', sectionLabel: '9' },
        { prompt: 'notice of designation', sectionLabel: '12' },
        { prompt: 'Community Planning Act exemption', sectionLabel: '14' },
        { prompt: 'permits/approvals', sectionLabel: '15' },
        { prompt: 'compensation', sectionLabel: '16' },
        { prompt: 'vesting', sectionLabel: '25' },
        { prompt: 'development area', sectionLabel: '33' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBRpttSpecs: ExamCurriculumUnitSpec[] = [
  rptt(
    'B-RPTT-01',
    'When does Real Property Transfer Tax apply to a land transfer?',
    [{ from: '1', to: '9' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'The Act imposes transfer tax in connection with registration of a deed, using the statutory comparison between consideration and assessed value.',
      ],
      mustLocate: [
        { prompt: 'current computation/rate', sectionLabel: '2' },
        { prompt: 'multiple-locality issue', sectionLabel: '3' },
        { prompt: 'exemptions', sectionLabel: '6' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBSfcSpecs: ExamCurriculumUnitSpec[] = [
  sfc(
    'B-SFC-01',
    'What does the Standard Forms of Conveyances Act standardize?',
    [{ from: '0.1', to: '3' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'standardizes form/content of conveyances;',
        'simplifies traditional conveyancing language;',
        'provides official-language equivalents/shortened clauses;',
        'permits standardized covenants/conditions and registration requirements.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'purpose', sectionLabel: '0.1' },
        { prompt: 'form/content', sectionLabel: '2' },
        { prompt: 'Chief Registrar direction/appeal', sectionLabel: '2.1' },
        { prompt: 'covenants/conditions', sectionLabel: '2.21' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];
