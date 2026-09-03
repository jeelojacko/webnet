// Exam Curriculum V1 — Tier-B catalog (land): Agricultural Land, Air Space, Assessment, Clean Water, Condominium Property, Conservation Easements (12 units).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const AGRI = 'doc-agricultural-land-protection-and-development-act';
const AIR_SPACE = 'doc-air-space-act';
const ASSESSMENT = 'doc-assessment-act';
const CLEAN_WATER = 'doc-clean-water-act';
const CONDO = 'doc-condominium-property-act';
const CONSERVATION_EASEMENTS = 'doc-conservation-easements-act';

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

const agri = unit(AGRI, (id) => id === 'B-AGRI-01');
const air = unit(AIR_SPACE, (id) => id === 'B-AIR-01');
const asmt = unit(ASSESSMENT, (id) => id === 'B-ASMT-01');
const cwa = unit(CLEAN_WATER, (id) => id === 'B-CWA-01');
const condo = unit(CONDO, (id) => id === 'B-CONDO-01');
const ce = unit(CONSERVATION_EASEMENTS, (id) => id === 'B-CE-01');

export const examCurriculumTierBAgriSpecs: ExamCurriculumUnitSpec[] = [
  agri(
    'B-AGRI-01',
    'What does the Agricultural Land Protection and Development Act govern?',
    [{ from: '1', to: '11' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal:
        'Recognize the Act as legislation dealing with agricultural-land owners associations, registered agricultural land, land-use/stewardship issues and agricultural drainage.',
      recognitionCues: [
        'registered agricultural land',
        'agricultural land owners association',
        'agricultural-land drainage',
        'Ministerial land-use recommendation',
      ],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'objects/purposes of an agricultural land owners association', sectionLabel: '4' },
        { prompt: 'registration of agricultural land', sectionLabel: '8' },
        { prompt: 'Ministerial recommendations respecting land use', sectionLabel: '11' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  agri(
    'B-AGRI-02',
    'Shared agricultural ditches and drains across neighbouring land',
    [{ from: '12', to: '17' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Where proper drainage of agricultural land requires a ditch or drain through an adjacent owner\'s property, the agricultural-land owner or an agricultural land owners association may apply to the Minister for permission to construct it.',
        'Where a qualifying ditch or drain serves two or more adjacent owners and was paid for by the Province or jointly by the owners, those owners are jointly responsible for its maintenance and repair.',
      ],
      mustLocate: [
        { prompt: 'permission/construction/damages', sectionLabel: '12' },
        { prompt: 'obstruction of ditch/drain', sectionLabel: '14' },
        { prompt: 'maintenance and repair process', sectionLabel: '15' },
        { prompt: 'review/determination of damages', sectionLabel: '16' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBAirSpecs: ExamCurriculumUnitSpec[] = [
  air(
    'B-AIR-01',
    'What is an air-space parcel and how is it treated as land?',
    [{ from: '1', to: '3' }, { from: '6', to: '8' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'recall'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'air space may constitute land;',
        'an air-space parcel is created through the statutory plan system;',
        'the resulting parcel can be conveyed/dealt with as land.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'air space as land', sectionLabel: '2' },
        { prompt: 'creation of air-space parcel', sectionLabel: '3' },
        { prompt: 'conveyance', sectionLabel: '6' },
        { prompt: 'assessment/taxation', sectionLabel: '7' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  air(
    'B-AIR-02',
    'What must an air-space plan show and who must approve it?',
    [{ from: '4', to: '5' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'An air-space plan submitted for filing must carry the surveyor\'s certificate and seal certifying correctness and compliance with the statutory plan requirements, and requires the statutory development-officer and Director of Surveys approvals.',
      ],
      mustLocate: [
        { prompt: '3D boundary/height/dimension content', sectionLabel: '4' },
        { prompt: 'filing and approval requirements', sectionLabel: '5' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBAsmtSpecs: ExamCurriculumUnitSpec[] = [
  asmt(
    'B-ASMT-01',
    'How does New Brunswick\'s real-property assessment system work?',
    [{ from: '1', to: '3' }, { from: '8' }, { from: '14', to: '17' }, { from: '21', to: '22.1' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'Director administers property assessment;',
        'property classification and information/access provisions;',
        'valuation framework;',
        'assessment notices and corrections.',
      ],
      mustRecall: [
        'Subject to the Act\'s specific exceptions and special valuation provisions, real property is generally assessed at its real and true value.',
      ],
      mustLocate: [
        { prompt: 'Director\'s access/information authority', sectionLabel: '8' },
        { prompt: 'mode of assessment', sectionLabel: '14' },
        { prompt: 'valuation', sectionLabel: '15' },
        { prompt: 'special agricultural/timber classifications', sectionLabel: '16' },
        { prompt: 'assessment notices/amendments', sectionLabel: '21' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  asmt(
    'B-ASMT-02',
    'How do assessment reviews and appeals work?',
    [{ from: '25', to: '29' }, { from: '37' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'An assessment challenge begins with a request for review to the Director; the Act then provides the appeal route to the Assessment and Planning Appeal Board and a further court route on questions of law.',
      ],
      mustLocate: [
        { prompt: 'request for review', sectionLabel: '25' },
        { prompt: 'appeal framework', sectionLabel: '27' },
        { prompt: 'court appeal', sectionLabel: '37' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBCwaSpecs: ExamCurriculumUnitSpec[] = [
  cwa(
    'B-CWA-01',
    'When should a land surveyor think of the Clean Water Act?',
    [{ from: '1', to: '3' }, { from: '9' }, { from: '13', to: '16' }, { from: '35', to: '39' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [
        'watercourse',
        'wetland',
        'watershed',
        'aquifer',
        'water supply',
        'well',
        'drainage diversion',
        'watercourse alteration permit',
      ],
      coreUnderstanding: [
        'Crown control of water;',
        'protected-area framework;',
        'watercourse/wetland alterations;',
        'well drilling;',
        'permit/licence/appeal system.',
      ],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
  cwa(
    'B-CWA-02',
    'Watercourse and wetland alterations: when are plans and permits required?',
    [{ from: '14', to: '16' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Before undertaking a qualifying project or structure that alters a watercourse or wetland or diverts water, the person must provide the Minister with the required plans/information and, unless exempted or waived under the Act, obtain the required permit.',
      ],
      mustLocate: [
        { prompt: 'protected areas and exemptions', sectionLabel: '14' },
        { prompt: 'watercourse/wetland alteration', sectionLabel: '15' },
        { prompt: 'well-drilling requirements', sectionLabel: '16' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
];

export const examCurriculumTierBCondoSpecs: ExamCurriculumUnitSpec[] = [
  condo(
    'B-CONDO-01',
    'What is a condominium property and what does registration create?',
    [{ from: '1', to: '18' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'Registration of the declaration and description brings the described land and appurtenant interests under the Condominium Property Act and creates the condominium corporation whose members are the owners.',
      ],
      mustLocate: [
        { prompt: 'declaration/description approval', sectionLabel: '5' },
        { prompt: 'effects of registration', sectionLabel: '10' },
        { prompt: 'units/common elements/easements', sectionLabel: '15' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  condo(
    'B-CONDO-02',
    'What survey material must a condominium description contain?',
    [{ from: '5', to: '9' }, { from: '7' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [
        'A condominium description includes a plan of survey and surveyor certification.',
        'For a bare-land condominium, unit boundaries are specified by reference to the appropriate coordinate monument, and the surveyor certifies the required monumentation and substantial agreement of the diagrams with those monuments.',
      ],
      mustLocate: [
        { prompt: 'complete description contents', sectionLabel: '7' },
        { prompt: 'approval requirements', sectionLabel: '8' },
        { prompt: 'registration approval', sectionLabel: '9' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'high',
    },
  ),
  condo(
    'B-CONDO-03',
    'How are condominium descriptions, units and common elements changed or terminated?',
    [{ from: '43', to: '45' }, { from: '47' }, { from: '54', to: '58' }, { from: '63', to: '64' }],
    {
      tier: 'B',
      learningDepths: ['understand', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [],
      mustRecall: [],
      mustLocate: [
        { prompt: 'amendments to declarations/descriptions', sectionLabel: '43' },
        { prompt: 'consolidation', sectionLabel: '45' },
        { prompt: 'sale of common elements', sectionLabel: '47' },
        { prompt: 'termination', sectionLabel: '54' },
        { prompt: 'expropriation', sectionLabel: '63' },
        { prompt: 'Community Planning Act interaction', sectionLabel: '64' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierBCeSpecs: ExamCurriculumUnitSpec[] = [
  ce(
    'B-CE-01',
    'What is a conservation easement and how is it created, registered, changed and enforced?',
    [{ from: '1', to: '12' }],
    {
      tier: 'B',
      learningDepths: ['recognize', 'understand', 'recall', 'retrieve'],
      examGoal: '',
      recognitionCues: [],
      coreUnderstanding: [
        'conservation easement can impose/secure conservation-related rights or obligations affecting land;',
        'registration gives it effect;',
        'the Act governs amendment, assignment, termination and enforcement.',
      ],
      mustRecall: [
        'A conservation easement has no legal effect until it is registered in the appropriate land registration office.',
      ],
      mustLocate: [
        { prompt: 'purpose', sectionLabel: '3' },
        { prompt: 'who may grant/hold', sectionLabel: '4' },
        { prompt: 'registration', sectionLabel: '6' },
        { prompt: 'priority', sectionLabel: '7' },
        { prompt: 'amendment/assignment/termination', sectionLabel: '8' },
        { prompt: 'enforcement', sectionLabel: '11' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];
