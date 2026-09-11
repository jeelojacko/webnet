// Exam Curriculum V1 — Tier-C catalog (21 lightweight open-book orientation units).
//
// Tier C teaches recognition of when a statute may matter, a broad
// understanding of its connection to surveying/property/land administration,
// and where to retrieve exact details. Every Tier-C unit is a
// document_orientation unit; there are deliberately zero core_concept units.
// Six units carry exactly one compact mustRecall entry (C-CGR-01, C-ETA-01,
// C-METRIC-01, C-OHS-01, C-OMIN-01, C-UGS-01); every other unit keeps
// mustRecall empty. Source ranges follow the human-reviewed Tier-C blueprint
// and are resolved against the authoritative corpus (corpus truth wins).

import type { ExamCurriculumUnitSpec } from './examCurriculumTypes';

const AQUACULTURE = 'doc-aquaculture-act';
const ARCHIVES = 'doc-archives-act';
const BITUMINOUS_SHALE = 'doc-bituminous-shale-act';
const CLEAN_ENVIRONMENT = 'doc-clean-environment-act';
const CROWN_GRANT_RESTRICTIONS = 'doc-crown-grant-restrictions-act';
const DEVOLUTION_OF_ESTATES = 'doc-devolution-of-estates-act';
const ELECTRONIC_TRANSACTIONS = 'doc-electronic-transactions-act';
const ESCHEATS_AND_FORFEITURES = 'doc-escheats-and-forfeitures-act';
const EXECUTORS_AND_TRUSTEES = 'doc-executors-and-trustees-act';
const GAS_DISTRIBUTION = 'doc-gas-distribution-act';
const MARITAL_PROPERTY = 'doc-marital-property-act';
const METRIC_CONVERSION = 'doc-metric-conversion-act';
const OCCUPATIONAL_HEALTH_AND_SAFETY = 'doc-occupational-health-and-safety-act';
const OWNERSHIP_OF_MINERALS = 'doc-ownership-of-minerals-act';
const PARKS = 'doc-parks-act';
const PROBATE_COURT = 'doc-probate-court-act';
const PUBLIC_HEALTH = 'doc-public-health-act';
const ENERGY_AND_UTILITIES_BOARD = 'doc-energy-and-utilities-board-act';
const SERVICE_NEW_BRUNSWICK = 'doc-service-new-brunswick-act';
const UNDERGROUND_STORAGE = 'doc-underground-storage-act';
const WILLS = 'doc-wills-act';

const C_DEPTHS = ['recognize', 'understand', 'retrieve'] as const;
const C_DEPTHS_WITH_RECALL = ['recognize', 'understand', 'recall', 'retrieve'] as const;

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
    tier: 'C',
    documentId,
    ranges,
    ...spec,
  });

const aquaculture = unit(AQUACULTURE);
const archives = unit(ARCHIVES);
const bituminousShale = unit(BITUMINOUS_SHALE);
const cleanEnvironment = unit(CLEAN_ENVIRONMENT);
const crownGrantRestrictions = unit(CROWN_GRANT_RESTRICTIONS);
const devolutionOfEstates = unit(DEVOLUTION_OF_ESTATES);
const electronicTransactions = unit(ELECTRONIC_TRANSACTIONS);
const escheatsAndForfeitures = unit(ESCHEATS_AND_FORFEITURES);
const executorsAndTrustees = unit(EXECUTORS_AND_TRUSTEES);
const gasDistribution = unit(GAS_DISTRIBUTION);
const maritalProperty = unit(MARITAL_PROPERTY);
const metricConversion = unit(METRIC_CONVERSION);
const occupationalHealthAndSafety = unit(OCCUPATIONAL_HEALTH_AND_SAFETY);
const ownershipOfMinerals = unit(OWNERSHIP_OF_MINERALS);
const parks = unit(PARKS);
const probateCourt = unit(PROBATE_COURT);
const publicHealth = unit(PUBLIC_HEALTH);
const energyAndUtilitiesBoard = unit(ENERGY_AND_UTILITIES_BOARD);
const serviceNewBrunswick = unit(SERVICE_NEW_BRUNSWICK);
const undergroundStorage = unit(UNDERGROUND_STORAGE);
const wills = unit(WILLS);

export const examCurriculumTierCAquacultureSpecs: ExamCurriculumUnitSpec[] = [
  aquaculture(
    'C-AQUA-01',
    'When should a surveyor think of the Aquaculture Act?',
    [
      { from: '1' },
      { from: '7', to: '8' },
      { from: '12' },
      { from: '15', to: '16' },
      { from: '18' },
      { from: '20', to: '21' },
      { from: '23' },
      { from: '25', to: '26' },
      { from: '28' },
      { from: '30', to: '31' },
      { from: '35', to: '36' },
      { from: '39' },
      { from: '41', to: '42' },
      { from: '44' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'aquaculture site',
        'aquaculture land',
        'aquaculture lease',
        'aquaculture permit or licence',
        'aquaculture management area',
      ],
      coreUnderstanding: [
        'the Act governs aquaculture sites and aquaculture land, including their designation and management areas;',
        'tenure for aquaculture activity is granted by way of leases, permits and licences;',
        'recognize when aquaculture legislation may affect land or water-area work, including site, location and boundary issues.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'aquaculture management areas', sectionLabel: '7' },
        { prompt: 'designation of aquaculture land', sectionLabel: '8' },
        { prompt: 'public registry of aquaculture interests', sectionLabel: '12' },
        { prompt: 'application for and grant of an aquaculture lease', sectionLabel: '15' },
        { prompt: 'application for an aquaculture permit', sectionLabel: '25' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCArchivesSpecs: ExamCurriculumUnitSpec[] = [
  archives(
    'C-ARCH-01',
    'Archives, historical public records and certified copies',
    [{ from: '1' }, { from: '3' }, { from: '5' }, { from: '7', to: '11' }],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'historical public records',
        'Provincial Archivist',
        'public inspection of archival records',
        'certified copies of public records',
        'records schedule',
      ],
      coreUnderstanding: [
        'the Act provides for archives and the duties of the Provincial Archivist over public records;',
        'archival public records are generally open to public inspection, subject to restrictions and the request/review route;',
        'the Provincial Archivist may certify copies of public records, and a certified copy is equivalent to the original record;',
        'these routes matter to historical title, boundary and evidence research.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'duties of the Provincial Archivist', sectionLabel: '5' },
        { prompt: 'disposal/destruction controls through records schedules', sectionLabel: '7' },
        { prompt: 'public inspection of archival public records', sectionLabel: '10' },
        { prompt: 'request/review route for restricted records', sectionLabel: '10.1' },
        { prompt: 'certified copies of public records', sectionLabel: '11' },
      ],
      relatedUnitIds: ['D-PRA-01'],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCBituminousShaleSpecs: ExamCurriculumUnitSpec[] = [
  bituminousShale(
    'C-BSHALE-01',
    'Bituminous shale rights, licences and land',
    [
      { from: '1' },
      { from: '4' },
      { from: '9', to: '11' },
      { from: '13', to: '14' },
      { from: '17', to: '20' },
      { from: '25' },
      { from: '31', to: '32' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'bituminous shale',
        'licence to search',
        'development permit',
        'bituminous shale lease',
        'right of entry for resource work',
      ],
      coreUnderstanding: [
        'the Act governs exploration for and development of bituminous shale as a Crown resource;',
        'rights are held through licences to search, development permits and leases;',
        'the Act provides entry and land-use rights (including a special order to enter and use land) and survey provisions;',
        'recognize the Act when resource title, entry, or survey of shale lands is in issue.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'Crown land administration of shale rights', sectionLabel: '9' },
        { prompt: 'right of entry and special order to enter and use land', sectionLabel: '10' },
        { prompt: 'licence to search and licence-area limits', sectionLabel: '13' },
        { prompt: 'development permits and conversion to lease', sectionLabel: '17' },
        { prompt: 'surveys of shale lands', sectionLabel: '25' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCCleanEnvironmentSpecs: ExamCurriculumUnitSpec[] = [
  cleanEnvironment(
    'C-CEA-01',
    'Environmental orders, contaminated land and designated areas',
    [
      { from: '1' },
      { from: '4.3' },
      { from: '4.31' },
      { from: '5.01', to: '5.21' },
      { from: '6.1', to: '6.5' },
      { from: '12' },
      { from: '14' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'contaminated site designation',
        'environmental order',
        'release of a contaminant',
        'wetland or coastal designation order',
        'lien on land for environmental costs',
      ],
      coreUnderstanding: [
        'the Minister may designate contaminated sites and act on contaminant releases;',
        'environmental orders and cost-recovery powers (including a lien on land) attach to contaminated or affected land;',
        'wetland and coastal designation orders impose restrictions tied to described areas of land;',
        'affected land is identified through statutory descriptions, plans or parcel identifiers where the Act or orders use them.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'contaminated-site designation', sectionLabel: '4.31' },
        { prompt: 'ministerial action and orders on contaminated land', sectionLabel: '5.01' },
        { prompt: 'lien on the land for environmental costs', sectionLabel: '5.201' },
        { prompt: 'restoration of land and premises', sectionLabel: '5.21' },
        { prompt: 'wetland / coastal designation orders', sectionLabel: '6.1' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCCrownGrantRestrictionsSpecs: ExamCurriculumUnitSpec[] = [
  crownGrantRestrictions(
    'C-CGR-01',
    'Restrictions contained in historical Crown grants',
    [{ from: '1', to: '4' }],
    {
      learningDepths: [...C_DEPTHS_WITH_RECALL],
      examGoal: '',
      recognitionCues: [
        'historical Crown grant',
        'quit-rent',
        'restriction in a grant',
        'release and waiver of grant restrictions',
        'title research on old Crown grant language',
      ],
      coreUnderstanding: [
        'historical Crown grants sometimes carried restrictions (such as quit-rent, cultivation or settlement conditions);',
        'the Act provides a statutory release and waiver of specified historical restrictions originating in Crown grants;',
        'recognize this Act when old Crown grant language appears in title research.',
      ],
      mustRecall: [
        'The Act provides statutory release/waiver of specified historical restrictions originating in Crown grants.',
      ],
      mustLocate: [
        { prompt: 'scope/application of the release and waiver', sectionLabel: '2' },
        { prompt: 'restrictions released and waived (detailed categories)', sectionLabel: '4' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCDevolutionOfEstatesSpecs: ExamCurriculumUnitSpec[] = [
  devolutionOfEstates(
    'C-DOE-01',
    'Real property after death and the personal representative',
    [
      { from: '1' },
      { from: '3' },
      { from: '5', to: '6' },
      { from: '8', to: '10' },
      { from: '12', to: '13' },
      { from: '18', to: '19' },
      { from: '22' },
      { from: '24' },
      { from: '32' },
      { from: '38' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'devolution of real property on death',
        'personal representative',
        'executor or administrator dealing with land',
        'registration of a will',
        'intestacy',
      ],
      coreUnderstanding: [
        'the Act governs what happens to real property when its owner dies and the role of the personal representative;',
        'the personal representative has powers to sell, convey, divide, lease or mortgage estate real property;',
        'recognition when estate administration affects title to or dealings with land.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'devolution of real and personal property', sectionLabel: '3' },
        { prompt: 'powers of the personal representative over real property', sectionLabel: '5' },
        { prompt: 'conveyance/sale of real property by the representative', sectionLabel: '8' },
        { prompt: 'effect of registering a will on real property', sectionLabel: '18' },
        { prompt: 'vesting of property not disposed of', sectionLabel: '19' },
      ],
      relatedUnitIds: ['C-PROB-01', 'C-WILLS-01'],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCElectronicTransactionsSpecs: ExamCurriculumUnitSpec[] = [
  electronicTransactions(
    'C-ETA-01',
    'Electronic records, signatures and legal effect',
    [
      { from: '1' },
      { from: '3', to: '5' },
      { from: '7', to: '8' },
      { from: '10', to: '13' },
    ],
    {
      learningDepths: [...C_DEPTHS_WITH_RECALL],
      examGoal: '',
      recognitionCues: [
        'electronic record',
        'electronic signature',
        'information in writing',
        'electronic original',
        'retention of electronic information',
      ],
      coreUnderstanding: [
        'the Act addresses when electronic records satisfy writing, signature, original and retention requirements;',
        'it does not require any person to use or accept electronic information;',
        'recognize the Act wherever dealings or filings are effected electronically.',
      ],
      mustRecall: [
        'Information is not denied legal effect merely because it is in electronic form, subject to the Act\'s scope and exceptions.',
      ],
      mustLocate: [
        { prompt: 'scope and exclusions (application)', sectionLabel: '5' },
        { prompt: 'legal effect of electronic information', sectionLabel: '7' },
        { prompt: 'satisfying a requirement for information in writing', sectionLabel: '8' },
        { prompt: 'electronic originals', sectionLabel: '10' },
        { prompt: 'electronic signatures', sectionLabel: '11' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCEscheatsAndForfeituresSpecs: ExamCurriculumUnitSpec[] = [
  escheatsAndForfeitures(
    'C-ESCH-01',
    'Escheated and forfeited land',
    [{ from: '1', to: '3' }],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'escheat',
        'forfeiture',
        'land vested in the Crown',
        'grant of escheated lands',
        'relief from forfeiture',
      ],
      coreUnderstanding: [
        'the Act deals with land that escheats or is forfeited to the Crown;',
        'the Crown may grant or dispose of such lands, and relief from forfeiture is possible;',
        'recognize the statute when ownership fails or property passes to the Crown through escheat or forfeiture.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'Crown possession of escheated/forfeited lands', sectionLabel: '1' },
        { prompt: 'grant of escheated lands', sectionLabel: '2' },
        { prompt: 'relief from forfeiture', sectionLabel: '3' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCExecutorsAndTrusteesSpecs: ExamCurriculumUnitSpec[] = [
  executorsAndTrustees(
    'C-ETRUST-01',
    'Executors, trustees and dealings with real property',
    [{ from: '2', to: '3' }, { from: '6', to: '10' }],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'executor selling realty',
        'administrator selling realty',
        'sale of realty to satisfy a legacy',
        'mortgage of estate realty',
        'purchaser dealing with an estate',
      ],
      coreUnderstanding: [
        'the Act gives executors and administrators statutory powers to sell estate realty;',
        'it also deals with sale of realty to satisfy legacies, powers of successors, and mortgaging realty;',
        'purchasers of realty from an estate benefit from the Act\'s inquiry protections;',
        'recognize when land is held in an estate or trust context.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'sale of realty by an executor', sectionLabel: '2' },
        { prompt: 'sale of realty by an administrator', sectionLabel: '3' },
        { prompt: 'sale of realty to satisfy a legacy', sectionLabel: '6' },
        { prompt: 'powers of executors to mortgage realty', sectionLabel: '8' },
        { prompt: 'duty of inquiry of purchasers of estate realty', sectionLabel: '9' },
      ],
      relatedUnitIds: ['C-DOE-01'],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCGasDistributionSpecs: ExamCurriculumUnitSpec[] = [
  gasDistribution(
    'C-GAS-01',
    'Gas distribution infrastructure and land',
    [
      { from: '1' },
      { from: '3', to: '8' },
      { from: '14' },
      { from: '27' },
      { from: '47', to: '50' },
      { from: '57' },
      { from: '69' },
      { from: '71.1' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'gas distribution system',
        'gas distributor franchise',
        'underground storage facility for gas',
        'safety and inspection of gas facilities',
        'disposal or merger of a gas utility',
      ],
      coreUnderstanding: [
        'the Act governs who may distribute gas and the franchise/authorization framework;',
        'a gas distribution system is a public utility and its disposal or sale requires statutory leave;',
        'the Act regulates underground gas storage facilities, wells and related land/infrastructure;',
        'recognize pipeline and utility situations where the Act may become relevant to land work.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'who may distribute gas / franchise authorization', sectionLabel: '3' },
        { prompt: 'statutory leave for disposal or sale of a gas utility', sectionLabel: '27' },
        { prompt: 'prohibition/authorization of underground gas storage', sectionLabel: '47' },
        { prompt: 'safety and inspection of facilities', sectionLabel: '57' },
        { prompt: 'duties of gas distributors', sectionLabel: '69' },
      ],
      relatedUnitIds: ['C-EUB-01', 'C-UGS-01'],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCMaritalPropertySpecs: ExamCurriculumUnitSpec[] = [
  maritalProperty(
    'C-MAR-01',
    'Marital property interests affecting land',
    [
      { from: '1' },
      { from: '3', to: '4' },
      { from: '10' },
      { from: '16' },
      { from: '18', to: '22' },
      { from: '44' },
      { from: '47', to: '50' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'marital home',
        'spousal right to possession',
        'division of marital property',
        'registration of a marital-property order',
        'dower',
      ],
      coreUnderstanding: [
        'the Act governs division of marital property and spousal rights, including rights respecting the marital home;',
        'the marital home is specially described and protected against unilateral disposition;',
        'court orders and statutory rights under the Act can affect and be registered against real property;',
        'recognize when marriage or spousal rights may affect dealing with real property.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'description and protection of the marital home', sectionLabel: '16' },
        { prompt: 'spouses\' equal rights to possession of the marital home', sectionLabel: '18' },
        { prompt: 'disposition of an interest in the marital home', sectionLabel: '19' },
        { prompt: 'orders registrable under the Registry Act', sectionLabel: '48' },
        { prompt: 'abolition of dower', sectionLabel: '50' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCMetricConversionSpecs: ExamCurriculumUnitSpec[] = [
  metricConversion(
    'C-METRIC-01',
    'Statutory metric conversion',
    [{ from: '1', to: '3' }],
    {
      learningDepths: [...C_DEPTHS_WITH_RECALL],
      examGoal: '',
      recognitionCues: [
        'metric conversion',
        'Canadian system of units',
        'International System of Units (SI)',
        'instrument designated for conversion',
      ],
      coreUnderstanding: [
        'the Act provides the mechanism to apply metric conversion to designated New Brunswick instruments;',
        'designated Canadian-system measurements are treated by their prescribed SI equivalents;',
        'recognize the Act when older Canadian-unit measurements appear in statutory or land documents.',
      ],
      mustRecall: [
        'The Act provides the statutory mechanism for treating designated Canadian-system measurements as their prescribed SI equivalents.',
      ],
      mustLocate: [
        { prompt: 'definitions (Canadian system of units, SI)', sectionLabel: '1' },
        { prompt: 'designation and conversion mechanism', sectionLabel: '2' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCOccupationalHealthAndSafetySpecs: ExamCurriculumUnitSpec[] = [
  occupationalHealthAndSafety(
    'C-OHS-01',
    'Survey field work and occupational safety',
    [{ from: '1' }, { from: '8', to: '9' }, { from: '19', to: '24' }],
    {
      learningDepths: [...C_DEPTHS_WITH_RECALL],
      examGoal: '',
      recognitionCues: [
        'worksite safety policy and program',
        'employer and employee duties',
        'right to refuse dangerous work',
        'reassignment after refusal',
        'discriminatory action prohibited',
      ],
      coreUnderstanding: [
        'the Act sets employer/employee responsibilities for worksite health and safety, including safety policies and programs;',
        'it protects an employee who refuses dangerous work and prohibits retaliation;',
        'recognize the Act for field/worksite safety on survey and related operations.',
      ],
      mustRecall: [
        'An employee has a statutory right to refuse an act where there are reasonable grounds to believe it is likely to endanger health or safety.',
      ],
      mustLocate: [
        { prompt: 'safety policy / program duties', sectionLabel: '8' },
        { prompt: 'duties of the employer', sectionLabel: '9' },
        { prompt: 'right to refuse dangerous work (procedure)', sectionLabel: '19' },
        { prompt: 'reassignment and protection of the employee\'s right', sectionLabel: '21' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCOwnershipOfMineralsSpecs: ExamCurriculumUnitSpec[] = [
  ownershipOfMinerals(
    'C-OMIN-01',
    'Separate ownership of minerals and the soil',
    [{ from: '1', to: '7' }],
    {
      learningDepths: [...C_DEPTHS_WITH_RECALL],
      examGoal: '',
      recognitionCues: [
        'mineral ownership separate from the soil',
        'minerals beneath the surface',
        'order declaring minerals separate property',
        'Crown land mineral agreements',
      ],
      coreUnderstanding: [
        'the Act lets Cabinet declare minerals beneath the surface to be property separate from the soil;',
        'an order has effect as if embodied in an Act of the Legislature;',
        'the distinction between mineral ownership and ownership of the soil/surface matters to land and title work.',
      ],
      mustRecall: [
        'Minerals may constitute property separate from ownership of the soil.',
      ],
      mustLocate: [
        { prompt: 'definition of mineral (by reference to the Mining Act)', sectionLabel: '1' },
        { prompt: 'Cabinet orders declaring minerals separate property', sectionLabel: '3' },
        { prompt: 'effect of orders', sectionLabel: '4' },
        { prompt: 'Crown land agreements respecting minerals', sectionLabel: '6' },
      ],
      relatedUnitIds: ['B-MIN-01'],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCParksSpecs: ExamCurriculumUnitSpec[] = [
  parks(
    'C-PARK-01',
    'Provincial parks and interests or activities on park land',
    [
      { from: '1', to: '5' },
      { from: '8', to: '9' },
      { from: '11' },
      { from: '13' },
      { from: '17' },
      { from: '20' },
      { from: '22', to: '23' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'provincial park',
        'lease, licence, privilege or concession in a park',
        'use or occupancy of park land',
        'park roads',
        'prospecting or mining in parks',
      ],
      coreUnderstanding: [
        'the Act establishes provincial parks and the Minister\'s powers over park land;',
        'interests in park land arise by grant of lease, licence, privilege or concession, with limits on use or occupancy;',
        'entry can be restricted, roads can be opened or closed, and prospecting/mining is reserved against;',
        'recognize park-land situations when land is within or adjoining a provincial park.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'Minister\'s powers in relation to provincial parks', sectionLabel: '5' },
        { prompt: 'granting of leases, licences, privileges or concessions', sectionLabel: '11' },
        { prompt: 'limitations on use or occupancy', sectionLabel: '13' },
        { prompt: 'opening or closing of roads', sectionLabel: '20' },
        { prompt: 'prospecting and mining prohibition', sectionLabel: '22' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCProbateCourtSpecs: ExamCurriculumUnitSpec[] = [
  probateCourt(
    'C-PROB-01',
    'Probate records and authority over deceased estates',
    [
      { from: '1', to: '3' },
      { from: '15' },
      { from: '29', to: '32' },
      { from: '39' },
      { from: '44' },
      { from: '51' },
      { from: '53', to: '56' },
      { from: '73' },
      { from: '75', to: '75.1' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'probate',
        'letters of administration',
        'grant of probate',
        'estate records',
        'caveat',
      ],
      coreUnderstanding: [
        'the Act establishes the Probate Court and its jurisdiction over grants of probate and administration;',
        'letters and grants evidence authority over a deceased person\'s estate, including real property;',
        'the Court keeps estate records and provides official copies;',
        'recognize where to look when ownership or authority to deal with land depends on an estate.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'powers vested in the Probate Court', sectionLabel: '3' },
        { prompt: 'filing and preservation of court documents', sectionLabel: '15' },
        { prompt: 'effect of letters', sectionLabel: '31' },
        { prompt: 'obtaining official copies', sectionLabel: '51' },
        { prompt: 'appointment of an administrator', sectionLabel: '53' },
        { prompt: 'fees and estate tax on grants', sectionLabel: '75.1' },
      ],
      relatedUnitIds: ['C-DOE-01'],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCPublicHealthSpecs: ExamCurriculumUnitSpec[] = [
  publicHealth(
    'C-PH-01',
    'Public-health land issues and on-site sewage systems',
    [{ from: '1' }, { from: '21' }, { from: '23', to: '24.1' }, { from: '26' }, { from: '43' }],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'on-site sewage disposal system',
        'design and location approval',
        'certificate of compliance',
        'public water supply',
        'rights of entry and inspection',
      ],
      coreUnderstanding: [
        'the Act\'s main land/survey connection is the on-site sewage regime: installation and use require Ministerial approval of the system\'s design and location;',
        'related compliance provisions cover notice, orders and certificates of compliance;',
        'the Act also provides for emergency appropriation of real property and rights of entry and inspection;',
        'the Act\'s historical subdivision-assessment provision (former s.22) is repealed and must not be treated as current.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'on-site sewage disposal systems', sectionLabel: '23' },
        { prompt: 'Ministerial approval of design and location', sectionLabel: '24' },
        { prompt: 'certificate of compliance', sectionLabel: '24.1' },
        { prompt: 'appropriation of real property in emergencies', sectionLabel: '26' },
        { prompt: 'rights of entry and inspections', sectionLabel: '43' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCEnergyAndUtilitiesBoardSpecs: ExamCurriculumUnitSpec[] = [
  energyAndUtilitiesBoard(
    'C-EUB-01',
    'Utilities, pipelines and the Energy and Utilities Board',
    [
      { from: '1' },
      { from: '23' },
      { from: '28', to: '29' },
      { from: '33' },
      { from: '39' },
      { from: '43' },
      { from: '52', to: '54' },
      { from: '69', to: '71' },
      { from: '77' },
      { from: '103' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'Energy and Utilities Board',
        'public utility',
        'pipeline',
        'Board hearing or order',
        'utility service territory',
      ],
      coreUnderstanding: [
        'the Act establishes the Energy and Utilities Board and its regulatory functions over public utilities;',
        'the Board\'s jurisdiction covers utility/pipeline matters, including orders, evidence and supervision;',
        's.103 (repeal of the former Public Utilities Act) is retained only as a historical/navigation anchor;',
        'recognize when land or infrastructure matters fall under Board authority.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'duties and functions of the Board', sectionLabel: '23' },
        { prompt: 'powers of the Board and members', sectionLabel: '28' },
        { prompt: 'orders respecting applications', sectionLabel: '39' },
        { prompt: 'supervision of public utilities', sectionLabel: '54' },
        { prompt: 'extension, adequacy and discontinuance of service', sectionLabel: '69' },
      ],
      relatedUnitIds: ['C-GAS-01'],
      reviewWeight: 'low',
    },
  ),
];

export const examCurriculumTierCServiceNewBrunswickSpecs: ExamCurriculumUnitSpec[] = [
  serviceNewBrunswick(
    'C-SNB-01',
    'Service New Brunswick, geographic information and land administration',
    [
      { from: '1' },
      { from: '3', to: '4' },
      { from: '24' },
      { from: '32' },
      { from: '41' },
      { from: '53' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'Service New Brunswick',
        'geographic information standards',
        'property assessment services',
        'approved parcel identifier',
        'real property transfer notice',
      ],
      coreUnderstanding: [
        'the Act sets out Service New Brunswick\'s objects and powers, including property assessment services;',
        'SNB coordinates geographic information services and sets standards for geographic information in the Province;',
        's.53 uses approved parcel identifiers (as defined in the Land Titles Act) for notices respecting real property transferred and vested;',
        'recognize SNB\'s institutional role in assessment, registry-related and geographic-information land administration.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'objects and purposes', sectionLabel: '3' },
        { prompt: 'geographic information standards role', sectionLabel: '32' },
        { prompt: 'approved parcel identifier / transfer notice', sectionLabel: '53' },
      ],
      relatedUnitIds: [],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCUndergroundStorageSpecs: ExamCurriculumUnitSpec[] = [
  undergroundStorage(
    'C-UGS-01',
    'Underground storage rights and statutory land descriptions',
    [
      { from: '1', to: '2.1' },
      { from: '4' },
      { from: '6', to: '13' },
      { from: '15' },
      { from: '20', to: '21' },
    ],
    {
      learningDepths: [...C_DEPTHS_WITH_RECALL],
      examGoal: '',
      recognitionCues: [
        'underground storage facility',
        'underground storage site',
        'storage lease',
        'storage exploration licence',
        'land description by survey system',
      ],
      coreUnderstanding: [
        'a qualifying underground-storage site is statutorily treated as property separate from the soil and vested in the Crown;',
        'the Act provides exploration licences, storage leases and construction permits for underground storage;',
        'land areas in applications must be described by reference to the standard oil and natural gas survey system;',
        'recognize the Act\'s land-description and survey framework for underground storage sites.',
      ],
      mustRecall: [
        'A qualifying underground-storage site is statutorily treated as property separate from the soil and vested in the Crown.',
      ],
      mustLocate: [
        { prompt: 'declaration that sites are separate property vested in the Crown', sectionLabel: '2.1' },
        { prompt: 'description of land area by the oil and natural gas survey system', sectionLabel: '4' },
        { prompt: 'underground storage exploration licences', sectionLabel: '6' },
        { prompt: 'storage lease application/term', sectionLabel: '11' },
        { prompt: 'transference of licences, leases and permits', sectionLabel: '15' },
      ],
      relatedUnitIds: ['C-GAS-01'],
      reviewWeight: 'medium',
    },
  ),
];

export const examCurriculumTierCWillsSpecs: ExamCurriculumUnitSpec[] = [
  wills(
    'C-WILLS-01',
    'Wills affecting land and testamentary disposition',
    [
      { from: '1', to: '2' },
      { from: '20' },
      { from: '23', to: '25' },
      { from: '28', to: '29' },
      { from: '34', to: '40' },
    ],
    {
      learningDepths: [...C_DEPTHS],
      examGoal: '',
      recognitionCues: [
        'will',
        'testamentary disposition of real property',
        'devise',
        'ademption',
        'validity and effect of a will',
      ],
      coreUnderstanding: [
        'the Act defines a will and the power of a testator to dispose of real property by will;',
        'it contains interpretive rules on what a devise carries and how wills affect land;',
        'recognition when title depends on a will, and where to retrieve rules affecting validity and effect.',
      ],
      mustRecall: [],
      mustLocate: [
        { prompt: 'power of a testator to dispose by will', sectionLabel: '2' },
        { prompt: 'ademption by subsequent conveyance', sectionLabel: '20' },
        { prompt: 'devise passing the whole of the estate', sectionLabel: '25' },
        { prompt: 'devise of mortgaged property', sectionLabel: '34' },
        { prompt: 'formal requirements and validity of wills', sectionLabel: '37' },
      ],
      relatedUnitIds: ['C-DOE-01', 'C-PROB-01'],
      reviewWeight: 'low',
    },
  ),
];
