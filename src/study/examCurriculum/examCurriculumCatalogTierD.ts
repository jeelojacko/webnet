// Exam Curriculum V1 — Tier-D catalog (6 awareness-only orientation units).
//
// Tier D is awareness only: recognize the statute/name/context and know when
// it may be necessary to look there. Every Tier-D unit is a
// document_orientation unit with no mustRecall and no substantive teaching.
// Learning depths default to recognize/retrieve; D-MUNI-01 also uses
// understand because grasping the Municipalities Act's legacy/repealed status
// is itself the point of the unit.

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const ASSIGNMENTS_AND_PREFERENCES = 'doc-assignments-and-preferences-act';
const MUNICIPALITIES = 'doc-municipalities-act';
const OFFICIAL_LANGUAGES = 'doc-official-languages-act';
const PARTNERSHIPS = 'doc-partnerships-and-business-names-registration-act';
const PUBLIC_RECORDS = 'doc-public-records-act';
const RESIDENTIAL_PROPERTY_TAX_RELIEF = 'doc-residential-property-tax-relief-act';

const D_DEPTHS = ['recognize', 'retrieve'] as const;
const D_MUNI_DEPTHS = ['recognize', 'understand', 'retrieve'] as const;

const unit =
  (documentId: string) =>
  (
    id: string,
    title: string,
    ranges: ExamCurriculumUnitSpec['ranges'],
    spec: Omit<ExamCurriculumUnitSpec, 'id' | 'title' | 'unitType' | 'tier' | 'documentId' | 'ranges'>,
  ): ExamCurriculumUnitSpec => ({
    id,
    title,
    unitType: 'document_orientation',
    tier: 'D',
    documentId,
    ranges,
    ...spec,
  });

const assignmentsAndPreferences = unit(ASSIGNMENTS_AND_PREFERENCES);
const municipalities = unit(MUNICIPALITIES);
const officialLanguages = unit(OFFICIAL_LANGUAGES);
const partnerships = unit(PARTNERSHIPS);
const publicRecords = unit(PUBLIC_RECORDS);
const residentialPropertyTaxRelief = unit(RESIDENTIAL_PROPERTY_TAX_RELIEF);

export const examCurriculumTierDAssignmentsAndPreferencesSpecs: ExamCurriculumUnitSpec[] = [
  assignmentsAndPreferences(
    'D-APA-01',
    'Assignments and preferences — awareness',
    [{ from: '1', to: '3' }, { from: '34' }],
    {
      learningDepths: [...D_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'assignment of property by a debtor',
        'preference among creditors',
        'valid assignment',
        'Bankruptcy Act interaction',
      ],
      coreUnderstanding: [
        'the Act deals with assignments of a debtor\'s property and with preferences among creditors;',
        'awareness is enough: recognize the name and context should an ownership record or conveyance reference a statutory assignment.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'transfers of property as preferences', sectionLabel: '2' },
        { prompt: 'valid assignments', sectionLabel: '3' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierDMunicipalitiesSpecs: ExamCurriculumUnitSpec[] = [
  municipalities(
    'D-MUNI-01',
    'Municipalities Act — legacy statute awareness',
    [{ from: '1' }, { from: '2' }],
    {
      learningDepths: [...D_MUNI_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'municipalities',
        'municipal incorporation',
        'historical municipal documents',
        'old municipal plans or title records',
      ],
      coreUnderstanding: [
        'the Municipalities Act is legacy/repealed legislation, not current municipal authority;',
        'it may still appear in historical plans, title records, old municipal documents or older materials;',
        'the candidate should recognize the name and its historical context and must not answer current municipal/local-government questions from this repealed Act.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'definitions (historical context)', sectionLabel: '1' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierDOfficialLanguagesSpecs: ExamCurriculumUnitSpec[] = [
  officialLanguages(
    'D-OLA-01',
    'Official Languages Act — document and service awareness',
    [{ from: '1' }, { from: '14', to: '15' }, { from: '27', to: '28' }],
    {
      learningDepths: [...D_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'official languages',
        'official documents',
        'documents published under an Act of the Province',
        'communications with government institutions',
      ],
      coreUnderstanding: [
        'the Act concerns the Province\'s official languages and language obligations for government institutions;',
        'awareness matters when a land/registry document is issued in official-language form.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'official documents', sectionLabel: '14' },
        { prompt: 'obligations of government institutions', sectionLabel: '28' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierDPartnershipsSpecs: ExamCurriculumUnitSpec[] = [
  partnerships(
    'D-PBNR-01',
    'Partnerships and registered business names',
    [{ from: '1' }, { from: '3' }, { from: '6' }, { from: '10' }, { from: '12' }],
    {
      learningDepths: [...D_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'partnership certificate',
        'registered business name',
        'register of certificates',
        'partnership owning land',
      ],
      coreUnderstanding: [
        'the Act requires registration of partnership/business certificates and maintains a public register;',
        'recognition only: where ownership or business identity context (for example a partnership named in a title) makes the registration regime relevant.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'registration of a certificate', sectionLabel: '6' },
        { prompt: 'establishment and maintenance of the register', sectionLabel: '10' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierDPublicRecordsSpecs: ExamCurriculumUnitSpec[] = [
  publicRecords(
    'D-PRA-01',
    'Ownership and preservation of public records',
    [{ from: '1', to: '3' }, { from: '6' }],
    {
      learningDepths: [...D_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'public records',
        'records vested in the Crown',
        'wrongful withholding of public records',
        'old public records',
      ],
      coreUnderstanding: [
        'the Act sets the current ownership/custody/preservation framework: public records vest in the Crown and wrongful withholding is addressed;',
        'keep distinct from the Archives Act: Public Records Act = ownership/custody; Archives Act = historical archival access/research/certified copies.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'public records vesting in the Crown', sectionLabel: '1' },
        { prompt: 'old public records vesting in the Crown', sectionLabel: '6' },
      ],
      relatedUnitIds: ['C-ARCH-01'],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierDResidentialPropertyTaxReliefSpecs: ExamCurriculumUnitSpec[] = [
  residentialPropertyTaxRelief(
    'D-RPTR-01',
    'Residential property tax relief — awareness',
    [
      { from: '1', to: '2.2' },
      { from: '4' },
      { from: '6' },
      { from: '10', to: '11' },
    ],
    {
      learningDepths: [...D_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'residential property tax credit',
        'principal residence',
        'one credit per year',
        'review and appeal of a credit decision',
      ],
      coreUnderstanding: [
        'the Act provides a property tax relief credit for qualifying owner-occupied residential property;',
        'awareness only: recognize when a residential property tax relief question arises and where to look;',
        'do not memorize credit mechanics or amounts.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'eligibility for the credit', sectionLabel: '2' },
        { prompt: 'application for review', sectionLabel: '6' },
        { prompt: 'administrative review/appeal', sectionLabel: '10' },
      ],
      relatedUnitIds: ['B-ASMT-01'],
      reviewWeight: 'low',
    },
  ),
];
