// Exam Curriculum V1 — Tier-B catalog (property): Crown Lands, Easements, Evidence,
// Expropriation, Limitation of Actions, Property, Territorial Division, Trespass (17 units).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const CLF = 'doc-crown-lands-and-forests-act';
const EASE = 'doc-easements-act';
const EVID = 'doc-evidence-act';
const EXPR = 'doc-expropriation-act';
const LIM = 'doc-limitation-of-actions-act';
const PROP = 'doc-property-act';
const TDA = 'doc-territorial-division-act';
const TRSP = 'doc-trespass-act';

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

const clf = unit(CLF, (id) => id === 'B-CLF-01');
const ease = unit(EASE, (id) => id === 'B-EASE-01');
const evid = unit(EVID, (id) => id === 'B-EVID-01');
const expr = unit(EXPR, (id) => id === 'B-EXPR-01');
const lim = unit(LIM, (id) => id === 'B-LIM-01');
const prop = unit(PROP, (id) => id === 'B-PROP-01');
const tda = unit(TDA, (id) => id === 'B-TDA-01');
const trsp = unit(TRSP, (id) => id === 'B-TRSP-01');

export const examCurriculumTierBClfSpecs: ExamCurriculumUnitSpec[] = [
  clf(
    'B-CLF-01',
    'When should a surveyor think of the Crown Lands and Forests Act?',
    [{ from: '1', to: '3' }, { from: '8', to: '13' }, { from: '19', to: '27' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [
        'Crown land',
        'Crown grant',
        'lease/licence',
        'right-of-way/easement over Crown land',
        'survey bordering Crown land',
      ],
      coreUnderstanding: [
        'Minister administers Crown Lands;',
        'Crown-land records and boundaries;',
        'grants, leases, easements and occupation rights.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  clf(
    'B-CLF-02',
    'Crown boundaries, survey plans, grants and water-boundary reservations',
    [{ from: '9', to: '18' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Where a survey adjacent to or on Crown Lands defines a parcel with one or more boundaries or corners touching or bordering Crown Lands, the surveyor must submit a copy of the plan of survey to the Minister.',
      ],
      mustLocate: [
        { prompt: 'Crown records/plans', sectionLabel: '9' },
        { prompt: 'plan submission', sectionLabel: '11' },
        { prompt: 'demarcation of legal boundaries', sectionLabel: '12.1' },
        { prompt: 'Crown grants', sectionLabel: '13' },
        { prompt: 'reservations on grants bordering river/lake', sectionLabel: '15' },
        { prompt: 'rectification', sectionLabel: '18' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  clf(
    'B-CLF-03',
    'Leases, rights-of-way, easements and occupation of Crown Lands',
    [{ from: '22', to: '27' }, { from: '71' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'Crown lease powers', sectionLabel: '23' },
        { prompt: 'right-of-way/easement', sectionLabel: '25' },
        { prompt: 'licence of occupation', sectionLabel: '26' },
        { prompt: 'continuation/cancellation', sectionLabel: '27' },
        { prompt: 'unauthorized occupation/use', sectionLabel: '71' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBEaseSpecs: ExamCurriculumUnitSpec[] = [
  ease(
    'B-EASE-01',
    'What does the Easements Act do and when does prescription matter?',
    [{ from: '1', to: '10' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'prescriptive rights;',
        'ways/easements/water rights;',
        'profits/benefits;',
        'interruption and statutory exclusions.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  ease(
    'B-EASE-02',
    'Prescriptive periods, interruption and exceptions',
    [{ from: '1', to: '7' }, { from: '9', to: '10' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'For a general way/easement/water-use claim, 20 years of qualifying enjoyment receives statutory protection against the specified historical-origin objection, while 40 years can make the right absolute and indefeasible unless the statutory written-consent exception applies.',
      ],
      mustLocate: [
        { prompt: 'profit/benefit rules', sectionLabel: '1' },
        { prompt: 'general easement', sectionLabel: '2' },
        { prompt: 'interruption', sectionLabel: '3' },
        { prompt: 'exclusions/time adjustments', sectionLabel: '6' },
        { prompt: 'cable/wire exception', sectionLabel: '9' },
        { prompt: 'local-government property provision', sectionLabel: '10' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBEvidSpecs: ExamCurriculumUnitSpec[] = [
  evid(
    'B-EVID-01',
    'What Evidence Act rules are most relevant to a land surveyor?',
    [{ from: '23' }, { from: '36', to: '43' }, { from: '47.1', to: '50' }, { from: '80', to: '87' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [
        'expert opinion',
        'map or plan in evidence',
        'record of survey',
        'certified public record',
        'electronic/business record',
        'registered instrument or will',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  evid(
    'B-EVID-02',
    'Maps, plans, records of survey, certified copies and expert evidence',
    [
      { from: '23' },
      { from: '36', to: '40' },
      { from: '47.1', to: '50' },
      { from: '80', to: '82' },
      { from: '87' },
    ],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'The Evidence Act provides routes by which properly proven or certified copies of public records \u2014 expressly including maps, plans and records of survey \u2014 may be received as evidence rather than requiring the original.',
      ],
      mustLocate: [
        { prompt: 'expert opinion', sectionLabel: '23' },
        { prompt: 'public records/maps/plans', sectionLabel: '36' },
        { prompt: 'electronic/business records and written expert findings', sectionLabel: '47.1' },
        { prompt: 'registered instruments/wills', sectionLabel: '80' },
        { prompt: 'Registry Office documents', sectionLabel: '87' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBExprSpecs: ExamCurriculumUnitSpec[] = [
  expr(
    'B-EXPR-01',
    'How does an expropriation proceed from proposal to taking?',
    [{ from: '1', to: '4' }, { from: '6', to: '20' }, { from: '22', to: '24' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'statutory authority/expropriating authority',
        'notice of intention',
        'objection',
        'hearing',
        'confirmation',
        'notice of expropriation',
        'title/possession',
        'abandonment',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  expr(
    'B-EXPR-02',
    'Survey entry, objections, title and possession in an expropriation',
    [{ from: '5', to: '24' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'The Expropriation Act permits the authorized statutory entry onto land to assess suitability for expropriation, including making surveys, taking levels, borings and other necessary tests, subject to the Act\'s notice/authorization requirements and compensation for resulting damage.',
      ],
      mustLocate: [
        { prompt: 'power of entry', sectionLabel: '5' },
        { prompt: 'notices/objections/hearing', sectionLabel: '6' },
        { prompt: 'notice of expropriation', sectionLabel: '19' },
        { prompt: 'title', sectionLabel: '20' },
        { prompt: 'further entry', sectionLabel: '21' },
        { prompt: 'possession', sectionLabel: '22' },
        { prompt: 'abandonment', sectionLabel: '24' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  expr(
    'B-EXPR-03',
    'How is expropriation compensation determined?',
    [{ from: '25', to: '55' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'The compensation framework can include market value, disturbance-related loss and injurious affection, subject to the Act\'s detailed rules.',
      ],
      mustLocate: [
        { prompt: 'general duty to compensate', sectionLabel: '25' },
        { prompt: 'market value', sectionLabel: '38' },
        { prompt: 'disturbance', sectionLabel: '44' },
        { prompt: 'injurious affection', sectionLabel: '46' },
        { prompt: 'interest/costs/settlement/payment', sectionLabel: '50' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBLimSpecs: ExamCurriculumUnitSpec[] = [
  lim(
    'B-LIM-01',
    'How do limitation periods affect land and property claims?',
    [{ from: '1', to: '9' }, { from: '15', to: '19' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'general limitation/discovery framework;',
        'special recovery-of-land provision;',
        'concealment;',
        'acknowledgment.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  lim(
    'B-LIM-02',
    'Recovery of land, dispossession and expiry of title',
    [{ from: '5' }, { from: '8.1' }, { from: '15', to: '16' }, { from: '19' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Subject to the specific statutory exceptions, the recovery-of-land provision uses 15 years of continuous dispossession generally and 60 years where the claimant is the Crown.',
        'When the limitation period under s.8.1 expires, the claimant\'s right or title to the land is extinguished.',
      ],
      mustLocate: [
        { prompt: 'general limitation', sectionLabel: '5' },
        { prompt: 'special present-interest/fixed-term-lease calculations', sectionLabel: '8.1' },
        { prompt: 'knowledge/discoverability', sectionLabel: '15' },
        { prompt: 'concealment', sectionLabel: '16' },
        { prompt: 'acknowledgment', sectionLabel: '19' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBPropSpecs: ExamCurriculumUnitSpec[] = [
  prop(
    'B-PROP-01',
    'Which conveyancing and easement rules in the Property Act matter to surveyors?',
    [{ from: '7', to: '27' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Subject to a contrary intention in the conveyance, a conveyance of land can carry the appurtenant ways, waters, watercourses, easements, rights and other interests described by the Act.',
      ],
      mustLocate: [
        { prompt: 'effect of conveyance', sectionLabel: '22' },
        { prompt: 'conveyancing provisions', sectionLabel: '23' },
        { prompt: 'easement/right/liberty/privilege', sectionLabel: '25' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  prop(
    'B-PROP-02',
    'Mortgages, redemption and statutory power of sale',
    [{ from: '37', to: '50' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'assignment/redemption', sectionLabel: '38' },
        { prompt: 'mortgagee powers', sectionLabel: '44' },
        { prompt: 'conditions for power of sale', sectionLabel: '45' },
        { prompt: 'effect/proceeds', sectionLabel: '47' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBTdaSpecs: ExamCurriculumUnitSpec[] = [
  tda(
    'B-TDA-01',
    'Where are New Brunswick\'s statutory county and parish boundaries found?',
    [{ from: '1', to: '32' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Know that the Territorial Division Act is the statutory navigation source for county geographic descriptions and the territorial divisions/parishes within them.',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'counties', sectionLabel: '1' },
        { prompt: 'statutory county descriptions', sectionLabel: '2' },
        { prompt: 'territorial divisions/parishes', sectionLabel: '17' },
        { prompt: 'shire towns', sectionLabel: '32' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierBTrspSpecs: ExamCurriculumUnitSpec[] = [
  trsp(
    'B-TRSP-01',
    'What does the Trespass Act prohibit and how do property categories change the rule?',
    [{ from: '1', to: '16' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'notice-based trespass;',
        'lawn/garden/enclosed-premises rules;',
        'specified classes of land;',
        'forest land;',
        'motor vehicles;',
        'statutory defences.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  trsp(
    'B-TRSP-02',
    'How does the Trespass Act interact with statutory authority to enter land?',
    [{ from: '2', to: '7' }, { from: '12.1' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'The Trespass Act does not apply to a person who enters or remains on premises under authority of an Act of the New Brunswick Legislature or an Act of the Parliament of Canada.',
      ],
      mustLocate: [
        { prompt: 'statutory-authority exclusion', sectionLabel: '2' },
        { prompt: 'property-category rules', sectionLabel: '3' },
        { prompt: 'defences', sectionLabel: '12.1' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];
