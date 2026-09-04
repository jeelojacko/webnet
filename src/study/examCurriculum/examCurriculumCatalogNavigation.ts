// Exam Curriculum V1 — cross-document Navigation catalog (12 units).
//
// Deterministic human-curated routing/issue-classification layer on top of the
// frozen Tier A-D curriculum. These units teach WHICH law to open first, WHICH
// other law may modify or supplement it, WHICH branch to follow, and WHERE to
// retrieve the exact rule — they do not duplicate the substantive content of
// the A-D statute units. Source ranges are resolved against the authoritative
// nb-sit corpus (corpus truth wins over the blueprint where a provision is
// repealed, absent or structurally different); NAV units must span at least
// two documents and every lookup pin resolves only against its explicit
// documentId.

import type {
  ExamCrossDocumentNavigationSpec,
  ExamLearningDepth,
} from './examCurriculumTypes';

const CROSS = 'cross_document_navigation';

const RECALL_DEPTHS: ExamLearningDepth[] = ['recognize', 'understand', 'recall', 'retrieve'];
const NO_RECALL_DEPTHS: ExamLearningDepth[] = ['recognize', 'understand', 'retrieve'];

const nav = (
  id: string,
  title: string,
  spec: Omit<ExamCrossDocumentNavigationSpec, 'id' | 'title' | 'unitType' | 'tier'>,
): ExamCrossDocumentNavigationSpec => ({ id, title, unitType: CROSS, tier: 'NAV', ...spec });

export const examCurriculumNavigationSpecs: ExamCrossDocumentNavigationSpec[] = [
  nav('NAV-01', 'Registry or Land Titles: which registration system am I in?', {
    reviewWeight: 'high',
    learningDepths: RECALL_DEPTHS,
    examGoal:
      'Given a land-registration fact pattern, first identify whether the parcel is governed by Registry or Land Titles and route the issue into the correct registration system.',
    recognitionCues: [
      'deed',
      'registered instrument',
      'registry office',
      'title register',
      'certificate of registered ownership',
      'PID',
      'priority',
      'registered owner',
      'rectification',
      'registration error',
    ],
    sources: [
      { documentId: 'doc-registry-act', ranges: [{ from: '19' }, { from: '34' }, { from: '46' }, { from: '50' }] },
      {
        documentId: 'doc-land-titles-act',
        ranges: [{ from: '15', to: '19' }, { from: '39' }, { from: '68', to: '73' }],
      },
    ],
    coreUnderstanding: [
      'Registry and Land Titles are different land-registration systems and registration has different legal consequences under each.',
      'The first routing question in many title/registration problems is therefore which system governs the parcel.',
      'Registry problems generally direct the candidate toward instruments, registration, execution, plans and priority.',
      'Land Titles problems generally direct the candidate toward registered ownership, registered interests, parcel changes, rectification and indemnification.',
    ],
    mustRecall: [
      'Before applying registration rules, determine whether the parcel is governed by Registry or Land Titles; the two systems give registration different legal effects.',
    ],
    mustLocate: [
      { prompt: 'Registry — registration of instruments', documentId: 'doc-registry-act', sectionLabel: '19' },
      { prompt: 'Registry — legal effect of a registered conveyance', documentId: 'doc-registry-act', sectionLabel: '34' },
      { prompt: 'Registry — subdivision-plan certification requirements', documentId: 'doc-registry-act', sectionLabel: '46' },
      { prompt: 'Registry — registration of plans', documentId: 'doc-registry-act', sectionLabel: '50' },
      { prompt: 'Land Titles — registration required to pass an estate or interest', documentId: 'doc-land-titles-act', sectionLabel: '15' },
      { prompt: 'Land Titles — status/effect of registered ownership', documentId: 'doc-land-titles-act', sectionLabel: '16' },
      { prompt: 'Land Titles — rectification of the title register', documentId: 'doc-land-titles-act', sectionLabel: '68' },
      { prompt: 'Land Titles — indemnification for qualifying registration/rectification loss', documentId: 'doc-land-titles-act', sectionLabel: '73' },
    ],
    relatedUnitIds: ['A-REG-01', 'A-REG-02', 'A-REG-04', 'A-LTA-01', 'A-LTA-02', 'A-LTA-05', 'A-LTA-06'],
  }),

  nav('NAV-02', 'Solving a boundary problem: where do I look first, and when do I escalate?', {
    reviewWeight: 'high',
    learningDepths: RECALL_DEPTHS,
    examGoal:
      'Route a boundary uncertainty or dispute through title records, survey evidence, special statutory boundary rules and, when necessary, the formal Boundaries Confirmation process.',
    recognitionCues: [
      'conflicting deed descriptions',
      'conflicting plans',
      'lost monument',
      'occupation inconsistent with title',
      'uncertain boundary',
      'disputed boundary',
      'highway boundary',
      'Crown boundary',
      'old survey evidence',
    ],
    sources: [
      { documentId: 'doc-registry-act', ranges: [{ from: '14' }, { from: '50' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '9', to: '10.4' }, { from: '82' }] },
      { documentId: 'doc-surveys-act', ranges: [{ from: '4' }, { from: '8' }, { from: '12', to: '13' }] },
      { documentId: 'doc-boundaries-confirmation-act', ranges: [{ from: '7', to: '15' }] },
      { documentId: 'reg-boundaries-95-166', ranges: [{ from: '2', to: '5' }] },
      { documentId: 'doc-evidence-act', ranges: [{ from: '36', to: '40' }, { from: '87' }] },
      { documentId: 'doc-crown-lands-and-forests-act', ranges: [{ from: '11' }] },
      { documentId: 'doc-highway-act', ranges: [{ from: '30' }] },
      { documentId: 'doc-easements-act', ranges: [{ from: '2', to: '3' }] },
    ],
    coreUnderstanding: [
      'Boundary work begins with title/record research and field/survey evidence, not automatically with a statutory confirmation proceeding.',
      'Special statutes can modify the analysis for particular boundaries, including Crown land and highways.',
      'The Boundaries Confirmation Act supplies a formal statutory process for resolving/confirming a disputed or uncertain boundary; it is not the same thing as the surveyor performing the underlying boundary investigation.',
    ],
    mustRecall: [
      "A surveyor's boundary investigation/determination and a statutory confirmation of a boundary under the Boundaries Confirmation Act are different processes.",
    ],
    mustLocate: [
      { prompt: 'lost legal monuments procedure', documentId: 'doc-surveys-act', sectionLabel: '12' },
      { prompt: 'private-property entry for surveys', documentId: 'doc-surveys-act', sectionLabel: '13' },
      { prompt: 'boundary-confirmation application', documentId: 'doc-boundaries-confirmation-act', sectionLabel: '7' },
      { prompt: 'boundary-confirmation objections', documentId: 'doc-boundaries-confirmation-act', sectionLabel: '10' },
      { prompt: 'boundary-confirmation hearing/order', documentId: 'doc-boundaries-confirmation-act', sectionLabel: '11' },
      { prompt: 'Crown-bordering survey-plan submission', documentId: 'doc-crown-lands-and-forests-act', sectionLabel: '11' },
      { prompt: 'highway boundary/centre-line rule', documentId: 'doc-highway-act', sectionLabel: '30' },
      { prompt: 'public records/maps/plans as evidence', documentId: 'doc-evidence-act', sectionLabel: '36' },
    ],
    relatedUnitIds: ['A-SURV-04', 'A-SURV-05', 'A-BCA-01', 'A-BCA-02', 'A-BCA-03', 'A-BCA-04', 'A-BCAR-01', 'B-EVID-02', 'B-CLF-02', 'B-HWY-02', 'B-EASE-01'],
  }),

  nav('NAV-03', 'Subdividing land: from idea to filed parcels', {
    reviewWeight: 'high',
    learningDepths: NO_RECALL_DEPTHS,
    examGoal:
      'Route a subdivision from the initial question of whether subdivision law applies through tentative planning, technical survey requirements, approval and land-registration filing.',
    recognitionCues: [
      'creating new lots',
      'splitting a parcel',
      'tentative subdivision plan',
      'subdivision exemption',
      'development officer',
      'new street',
      'new PID',
      'subdivision-plan filing',
    ],
    sources: [
      { documentId: 'doc-community-planning-act', ranges: [{ from: '77' }, { from: '79', to: '86' }] },
      { documentId: 'reg-community-planning-80-159', ranges: [{ from: '2', to: '7.1' }] },
      { documentId: 'doc-surveys-act', ranges: [{ from: '7', to: '8' }] },
      { documentId: 'reg-surveys-84-76', ranges: [{ from: '4', to: '7' }] },
      { documentId: 'doc-registry-act', ranges: [{ from: '46' }, { from: '50' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '18' }, { from: '39' }] },
      { documentId: 'doc-new-brunswick-land-surveyors-bylaws', ranges: [{ from: '19' }] },
    ],
    coreUnderstanding: [
      'A subdivision issue should first be classified under the Community Planning framework, including exemptions and tentative-plan requirements.',
      'The surveyor must then satisfy the applicable technical survey/monument/plan rules.',
      'Approval and filing/registration are separate stages.',
      'The applicable land-registration system still matters after the subdivision plan is approved.',
    ],
    mustRecall: [],
    mustLocate: [
      { prompt: 'subdivision framework', documentId: 'doc-community-planning-act', sectionLabel: '77' },
      { prompt: 'subdivision exemptions', documentId: 'doc-community-planning-act', sectionLabel: '80' },
      { prompt: 'tentative subdivision plan', documentId: 'doc-community-planning-act', sectionLabel: '81' },
      { prompt: 'subdivision-plan application', documentId: 'doc-community-planning-act', sectionLabel: '84' },
      { prompt: 'subdivision-plan approval', documentId: 'doc-community-planning-act', sectionLabel: '85' },
      { prompt: 'filing of subdivision plan', documentId: 'doc-community-planning-act', sectionLabel: '86' },
      { prompt: 'development-officer approval', documentId: 'reg-community-planning-80-159', sectionLabel: '7' },
      { prompt: 'integrated-survey-area subdivision duties', documentId: 'doc-surveys-act', sectionLabel: '7' },
    ],
    relatedUnitIds: ['A-CPA-03', 'A-CPA-04', 'A-CPA-05', 'A-CPAR-01', 'A-CPAR-02', 'A-SURV-03', 'A-SURV-04', 'A-SURVR-01', 'A-SURVR-02', 'A-REG-04', 'A-LTA-04', 'A-BYL-06'],
  }),

  nav('NAV-04', 'Survey monuments, certification, validation and plan filing', {
    reviewWeight: 'high',
    learningDepths: NO_RECALL_DEPTHS,
    examGoal:
      'Route monument placement and survey-plan work through statutory survey requirements, professional certification, plan validation and land-registration filing.',
    recognitionCues: [
      'setting survey monuments',
      'integrated survey area',
      'coordinate monument',
      'lost monument',
      'Survey Plan',
      'surveyor seal',
      'plan validation',
      'plan filing',
    ],
    sources: [
      { documentId: 'doc-new-brunswick-land-surveyors-act', ranges: [{ from: '30', to: '35' }] },
      {
        documentId: 'doc-new-brunswick-land-surveyors-bylaws',
        ranges: [{ from: '10' }, { from: '11' }, { from: '19' }],
      },
      { documentId: 'doc-surveys-act', ranges: [{ from: '4', to: '8' }, { from: '12' }] },
      { documentId: 'reg-surveys-84-76', ranges: [{ from: '4', to: '7' }] },
      { documentId: 'doc-registry-act', ranges: [{ from: '50' }] },
      { documentId: 'reg-land-titles-83-130', ranges: [{ from: '2', to: '16' }] },
    ],
    coreUnderstanding: [
      'Monumentation, preparation of a Survey Plan, professional certification/sealing, plan validation and statutory filing are related but distinct requirements.',
      'Integrated-survey-area rules and coordinate-monument rules may alter technical field requirements.',
      'The existing frozen Bylaw rule governing monuments placed and Survey Plan preparation remains authoritative and must not be reversed.',
    ],
    mustRecall: [],
    mustLocate: [
      { prompt: 'integrated-survey-area duties', documentId: 'doc-surveys-act', sectionLabel: '7' },
      { prompt: 'integrated-survey-area plan/certification', documentId: 'doc-surveys-act', sectionLabel: '8' },
      { prompt: 'lost legal monument procedure', documentId: 'doc-surveys-act', sectionLabel: '12' },
      { prompt: 'lot-monument exception/rules', documentId: 'reg-surveys-84-76', sectionLabel: '5' },
      { prompt: 'plan/field-notes/computation submission', documentId: 'reg-surveys-84-76', sectionLabel: '6' },
      { prompt: "Director's plan standard/approval framework", documentId: 'reg-surveys-84-76', sectionLabel: '7' },
      { prompt: 'plan-validation framework', documentId: 'doc-new-brunswick-land-surveyors-bylaws', sectionLabel: '11' },
      { prompt: 'plan-after-monumentation framework', documentId: 'doc-new-brunswick-land-surveyors-bylaws', sectionLabel: '19' },
      { prompt: 'Registry registration of plans', documentId: 'doc-registry-act', sectionLabel: '50' },
    ],
    relatedUnitIds: ['A-NBLS-04', 'A-BYL-06', 'A-BYL-07', 'A-SURV-02', 'A-SURV-03', 'A-SURV-04', 'A-SURVR-01', 'A-SURVR-02', 'A-REG-04', 'A-LTR-01'],
  }),

  nav('NAV-05', 'Easements, rights-of-way and other interests: what kind of right is this?', {
    reviewWeight: 'high',
    learningDepths: RECALL_DEPTHS,
    examGoal:
      'Classify an easement/right-of-way fact pattern by how the interest arose and route it through prescription, express grants, Land Titles, conservation or Crown-land legislation as applicable.',
    recognitionCues: [
      'right-of-way',
      'access',
      'long use',
      'prescription',
      'utility corridor',
      'conservation easement',
      'Crown easement',
      'unregistered access',
    ],
    sources: [
      { documentId: 'doc-easements-act', ranges: [{ from: '1', to: '3' }, { from: '6' }, { from: '9', to: '10' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '17' }, { from: '24' }] },
      { documentId: 'doc-property-act', ranges: [{ from: '25' }] },
      { documentId: 'doc-conservation-easements-act', ranges: [{ from: '2' }, { from: '6', to: '11' }] },
      { documentId: 'doc-crown-lands-and-forests-act', ranges: [{ from: '25' }] },
      { documentId: 'doc-registry-act', ranges: [{ from: '19' }, { from: '34' }] },
    ],
    coreUnderstanding: [
      'First identify how the claimed right arose.',
      'Prescription, an express written grant, a conservation easement, a Crown-land easement and a registered Land Titles interest are not interchangeable legal routes.',
      'Land Titles status can materially change the prescription analysis.',
    ],
    mustRecall: [
      'Do not apply the Easements Act prescriptive periods mechanically to registered Land Titles land; check the Land Titles Act rules governing prescription and pre-registration rights.',
    ],
    mustLocate: [
      { prompt: 'general prescriptive easement framework', documentId: 'doc-easements-act', sectionLabel: '2' },
      { prompt: 'interruption of prescription', documentId: 'doc-easements-act', sectionLabel: '3' },
      { prompt: 'Land Titles effect on unregistered/prescriptive interests', documentId: 'doc-land-titles-act', sectionLabel: '17' },
      { prompt: 'registered easements under Land Titles', documentId: 'doc-land-titles-act', sectionLabel: '24' },
      { prompt: 'express easement/conveyancing rule', documentId: 'doc-property-act', sectionLabel: '25' },
      { prompt: 'conservation easement registration', documentId: 'doc-conservation-easements-act', sectionLabel: '6' },
    ],
    relatedUnitIds: ['B-EASE-01', 'B-EASE-02', 'A-LTA-02', 'A-LTA-03', 'B-PROP-01', 'B-CE-01', 'B-CLF-03'],
  }),

  nav('NAV-06', 'Crown land and resource rights: which resource regime applies?', {
    reviewWeight: 'medium',
    learningDepths: NO_RECALL_DEPTHS,
    examGoal:
      'Distinguish ordinary Crown land from mineral, oil and gas, quarry, bituminous shale and underground-storage interests and route the problem into the correct statutory regime.',
    recognitionCues: [
      'Crown land',
      'Crown grant',
      'mineral claim',
      'mining lease',
      'oil and gas',
      'quarry lease',
      'peat',
      'bituminous shale',
      'underground storage',
      'resource survey',
      'mineral ownership',
    ],
    sources: [
      {
        documentId: 'doc-crown-lands-and-forests-act',
        ranges: [{ from: '11' }, { from: '13' }, { from: '15' }, { from: '23' }, { from: '25', to: '26' }],
      },
      { documentId: 'doc-ownership-of-minerals-act', ranges: [{ from: '1', to: '7' }] },
      { documentId: 'doc-mining-act', ranges: [{ from: '24' }, { from: '44' }, { from: '90', to: '94' }, { from: '109' }] },
      { documentId: 'doc-oil-and-natural-gas-act', ranges: [{ from: '8', to: '10' }, { from: '35' }] },
      { documentId: 'doc-quarriable-substances-act', ranges: [{ from: '7' }, { from: '9' }, { from: '19' }, { from: '26' }] },
      { documentId: 'doc-bituminous-shale-act', ranges: [{ from: '9', to: '10' }, { from: '13' }, { from: '17' }, { from: '25' }] },
      { documentId: 'doc-underground-storage-act', ranges: [{ from: '2.1' }, { from: '4' }] },
      { documentId: 'doc-protected-natural-areas-act', ranges: [{ from: '5', to: '8' }, { from: '19' }, { from: '22' }] },
      { documentId: 'doc-crown-grant-restrictions-act', ranges: [{ from: '4' }] },
    ],
    coreUnderstanding: [
      'Always distinguish the surface-land question from the resource-interest question.',
      'Ordinary Crown grants/leases/easements and Crown boundaries belong primarily in the Crown Lands and Forests framework.',
      'Minerals, mining claims, oil and gas, quarry rights, shale and underground storage each have distinct statutory regimes.',
      'Protected-area or historical Crown-grant restrictions can overlay those interests.',
    ],
    mustRecall: [],
    mustLocate: [
      { prompt: 'Crown-bordering survey plan', documentId: 'doc-crown-lands-and-forests-act', sectionLabel: '11' },
      { prompt: 'Crown right-of-way/easement', documentId: 'doc-crown-lands-and-forests-act', sectionLabel: '25' },
      { prompt: 'mineral-claim access/location framework', documentId: 'doc-mining-act', sectionLabel: '24' },
      { prompt: 'Mining Act survey qualification/framework', documentId: 'doc-mining-act', sectionLabel: '90' },
      { prompt: 'oil/gas private-land special-order route', documentId: 'doc-oil-and-natural-gas-act', sectionLabel: '10' },
      { prompt: 'quarry-lease survey requirement', documentId: 'doc-quarriable-substances-act', sectionLabel: '7' },
      { prompt: 'historic Crown-grant restriction release', documentId: 'doc-crown-grant-restrictions-act', sectionLabel: '4' },
    ],
    relatedUnitIds: ['B-CLF-01', 'B-CLF-02', 'B-CLF-03', 'B-MIN-01', 'B-MIN-02', 'B-MIN-03', 'B-ONG-01', 'B-ONG-02', 'B-QS-01', 'B-QS-02', 'C-OMIN-01', 'C-BSHALE-01', 'C-UGS-01', 'C-CGR-01', 'B-PNA-01'],
  }),

  nav('NAV-07', 'Government entry, use and acquisition of private land', {
    reviewWeight: 'high',
    learningDepths: RECALL_DEPTHS,
    examGoal:
      'Distinguish statutory authority to enter land for surveying or investigation from statutory acquisition/expropriation of an interest in the land.',
    recognitionCues: [
      'surveyor entering private property',
      'government survey crew',
      'borings',
      'test pits',
      'public work',
      'expropriation',
      'highway acquisition',
      'possession',
      'compensation',
      'resource-company entry',
    ],
    sources: [
      { documentId: 'doc-surveys-act', ranges: [{ from: '13' }] },
      { documentId: 'doc-new-brunswick-land-surveyors-act', ranges: [{ from: '38' }] },
      { documentId: 'doc-expropriation-act', ranges: [{ from: '5' }, { from: '19', to: '25' }] },
      { documentId: 'doc-public-works-act', ranges: [{ from: '9' }, { from: '12' }, { from: '16' }, { from: '25' }, { from: '33' }] },
      { documentId: 'doc-highway-act', ranges: [{ from: '11', to: '23' }] },
      { documentId: 'doc-oil-and-natural-gas-act', ranges: [{ from: '9', to: '10' }] },
      { documentId: 'doc-mining-act', ranges: [{ from: '93' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '49' }] },
    ],
    coreUnderstanding: [
      'A right to enter land for surveying, inspection, testing or investigation does not itself necessarily transfer ownership.',
      'Different statutes supply different entry powers for different purposes.',
      'Where title or possession is actually being taken, follow the relevant acquisition/expropriation and compensation framework.',
    ],
    mustRecall: [
      'A statutory right to enter land to survey, inspect or investigate is not the same thing as expropriating the land or acquiring title to it.',
    ],
    mustLocate: [
      { prompt: 'ordinary survey entry', documentId: 'doc-surveys-act', sectionLabel: '13' },
      { prompt: 'NBLS statutory field/property authority', documentId: 'doc-new-brunswick-land-surveyors-act', sectionLabel: '38' },
      { prompt: 'pre-expropriation survey/test entry', documentId: 'doc-expropriation-act', sectionLabel: '5' },
      { prompt: 'notice of expropriation', documentId: 'doc-expropriation-act', sectionLabel: '19' },
      { prompt: 'title following expropriation', documentId: 'doc-expropriation-act', sectionLabel: '20' },
      { prompt: 'possession', documentId: 'doc-expropriation-act', sectionLabel: '22' },
      { prompt: 'public-work survey/entry authority', documentId: 'doc-public-works-act', sectionLabel: '9' },
      { prompt: 'oil/gas special-order private-land entry', documentId: 'doc-oil-and-natural-gas-act', sectionLabel: '10' },
    ],
    relatedUnitIds: ['A-SURV-05', 'A-NBLS-06', 'B-EXPR-01', 'B-EXPR-02', 'B-EXPR-03', 'B-PW-01', 'B-PW-02', 'B-HWY-01', 'B-ONG-02', 'B-MIN-03', 'A-LTA-04'],
  }),

  nav('NAV-08', 'Conveying or changing ownership of land', {
    reviewWeight: 'high',
    learningDepths: NO_RECALL_DEPTHS,
    examGoal:
      'Classify why ownership is changing and route the transaction through the applicable registration, conveyancing, estate, marital, expropriation or subdivision rules.',
    recognitionCues: [
      'deed',
      'transfer',
      'sale',
      'estate',
      'death of owner',
      'executor',
      'will',
      'Crown grant',
      'marital property',
      'expropriation',
      'parcel severance',
      'transfer tax',
    ],
    sources: [
      {
        documentId: 'doc-registry-act',
        ranges: [{ from: '19' }, { from: '34' }, { from: '36', to: '47' }, { from: '50' }],
      },
      {
        documentId: 'doc-land-titles-act',
        ranges: [{ from: '15' }, { from: '21', to: '24' }, { from: '39' }, { from: '49' }, { from: '53' }],
      },
      { documentId: 'doc-property-act', ranges: [{ from: '22', to: '25' }, { from: '62' }] },
      { documentId: 'doc-standard-forms-of-conveyances-act', ranges: [{ from: '0.1', to: '3' }] },
      { documentId: 'doc-real-property-transfer-tax-act', ranges: [{ from: '1', to: '6' }] },
      { documentId: 'doc-devolution-of-estates-act', ranges: [{ from: '3' }, { from: '5' }, { from: '8' }, { from: '18', to: '19' }] },
      { documentId: 'doc-wills-act', ranges: [{ from: '20' }, { from: '23', to: '25' }] },
      { documentId: 'doc-probate-court-act', ranges: [{ from: '29', to: '32' }] },
      { documentId: 'doc-executors-and-trustees-act', ranges: [{ from: '6', to: '10' }] },
      { documentId: 'doc-marital-property-act', ranges: [{ from: '18', to: '22' }] },
      { documentId: 'doc-expropriation-act', ranges: [{ from: '19', to: '20' }] },
      { documentId: 'doc-community-planning-act', ranges: [{ from: '80' }, { from: '84', to: '86' }] },
    ],
    coreUnderstanding: [
      'First identify why ownership is changing.',
      'An ordinary voluntary conveyance, transfer on death, executor/trustee sale, marital-property issue, expropriation and subdivision-induced parcel change follow different statutory routes.',
      'The applicable Registry or Land Titles system remains a foundational classification step.',
    ],
    mustRecall: [],
    mustLocate: [
      { prompt: 'Registry registration', documentId: 'doc-registry-act', sectionLabel: '19' },
      { prompt: 'Registry effect of conveyance', documentId: 'doc-registry-act', sectionLabel: '34' },
      { prompt: 'Land Titles transfer of registered land', documentId: 'doc-land-titles-act', sectionLabel: '21' },
      { prompt: 'Land Titles parcel severance/consolidation', documentId: 'doc-land-titles-act', sectionLabel: '39' },
      { prompt: 'Land Titles transmission on death', documentId: 'doc-land-titles-act', sectionLabel: '53' },
      { prompt: 'standardized conveyance form/content', documentId: 'doc-standard-forms-of-conveyances-act', sectionLabel: '2' },
      { prompt: 'transfer tax calculation framework', documentId: 'doc-real-property-transfer-tax-act', sectionLabel: '2' },
      { prompt: "personal representative's powers over estate land", documentId: 'doc-devolution-of-estates-act', sectionLabel: '5' },
    ],
    relatedUnitIds: ['A-REG-02', 'A-REG-03', 'A-LTA-03', 'A-LTA-04', 'B-PROP-01', 'B-SFC-01', 'B-RPTT-01', 'C-DOE-01', 'C-ETRUST-01', 'C-WILLS-01', 'C-PROB-01', 'C-MAR-01', 'B-EXPR-01', 'A-CPA-04'],
  }),

  nav('NAV-09', 'Condominiums and three-dimensional parcels', {
    reviewWeight: 'medium',
    learningDepths: RECALL_DEPTHS,
    examGoal:
      'Distinguish air-space parcels from condominium property and route three-dimensional parcel and condominium survey questions into the correct statutory regime.',
    recognitionCues: [
      'air-space parcel',
      'three-dimensional boundary',
      'elevation',
      'condominium description',
      'common elements',
      'bare-land condominium',
      'coordinate monument',
      'unit boundary',
    ],
    sources: [
      { documentId: 'doc-air-space-act', ranges: [{ from: '2', to: '6' }] },
      {
        documentId: 'doc-condominium-property-act',
        ranges: [{ from: '5', to: '10' }, { from: '15' }, { from: '43', to: '45' }, { from: '54' }, { from: '64' }],
      },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '14.1' }, { from: '18' }, { from: '39' }] },
      { documentId: 'reg-land-titles-83-130', ranges: [{ from: '2', to: '16' }] },
    ],
    coreUnderstanding: [
      'Air-space parcels and condominium units are different statutory concepts.',
      "An Air Space Act plan creates and defines an air-space parcel using the Act's three-dimensional plan requirements.",
      'The Condominium Property Act governs declarations/descriptions, units, common elements and bare-land condominium survey requirements.',
      'Registration requirements remain relevant after the specialized plan requirements are satisfied.',
    ],
    mustRecall: [
      'An air-space parcel and a condominium unit are not interchangeable concepts; they are created and governed through different statutory schemes.',
    ],
    mustLocate: [
      { prompt: 'air space treated as land', documentId: 'doc-air-space-act', sectionLabel: '2' },
      { prompt: 'creation of air-space parcel', documentId: 'doc-air-space-act', sectionLabel: '3' },
      { prompt: 'air-space plan dimensions/boundaries', documentId: 'doc-air-space-act', sectionLabel: '4' },
      { prompt: 'air-space filing/approval', documentId: 'doc-air-space-act', sectionLabel: '5' },
      { prompt: 'condominium description contents', documentId: 'doc-condominium-property-act', sectionLabel: '7' },
      { prompt: 'condominium registration approval', documentId: 'doc-condominium-property-act', sectionLabel: '9' },
      { prompt: 'effect of condominium registration', documentId: 'doc-condominium-property-act', sectionLabel: '10' },
      { prompt: 'amendment of condominium declaration/description', documentId: 'doc-condominium-property-act', sectionLabel: '43' },
    ],
    relatedUnitIds: ['B-AIR-01', 'B-AIR-02', 'B-CONDO-01', 'B-CONDO-02', 'B-CONDO-03', 'A-LTA-03', 'A-LTA-04', 'A-LTR-01'],
  }),

  nav('NAV-10', 'Environmental and land-use constraints: what overlays the parcel?', {
    reviewWeight: 'medium',
    learningDepths: NO_RECALL_DEPTHS,
    examGoal:
      'Recognize that several independent planning, environmental, protected-area and public-health regimes can apply to the same parcel and route each issue into the correct statute.',
    recognitionCues: [
      'zoning',
      'subdivision restriction',
      'wetland',
      'watercourse',
      'contaminated site',
      'coastal area',
      'protected natural area',
      'conservation easement',
      'septic system',
      'park land',
      'agricultural land',
    ],
    sources: [
      { documentId: 'doc-community-planning-act', ranges: [{ from: '53', to: '90' }] },
      { documentId: 'reg-community-planning-80-159', ranges: [{ from: '2', to: '7.1' }] },
      { documentId: 'doc-clean-water-act', ranges: [{ from: '14', to: '16' }] },
      { documentId: 'doc-clean-environment-act', ranges: [{ from: '4.31' }, { from: '5.01', to: '5.21' }, { from: '6.1', to: '6.5' }] },
      { documentId: 'doc-protected-natural-areas-act', ranges: [{ from: '5', to: '8' }, { from: '11' }, { from: '20' }, { from: '22' }] },
      { documentId: 'doc-conservation-easements-act', ranges: [{ from: '6', to: '11' }] },
      { documentId: 'doc-public-health-act', ranges: [{ from: '23', to: '24.1' }] },
      {
        documentId: 'doc-parks-act',
        ranges: [{ from: '1', to: '5' }, { from: '8', to: '9' }, { from: '11' }, { from: '13' }, { from: '17' }, { from: '20' }, { from: '22', to: '23' }],
      },
      { documentId: 'doc-agricultural-land-protection-and-development-act', ranges: [{ from: '8' }, { from: '11', to: '17' }] },
    ],
    coreUnderstanding: [
      'A single parcel can be subject to several independent statutory overlays.',
      'Finding one approval or restriction does not mean the legal search is complete.',
      'Planning/zoning, watercourse/wetland rules, contaminated/designated land, protected areas, conservation easements, sewage-system approvals, park rules and agricultural-land provisions serve different functions.',
    ],
    mustRecall: [],
    mustLocate: [
      { prompt: 'zoning/development controls', documentId: 'doc-community-planning-act', sectionLabel: '53' },
      { prompt: 'subdivision framework', documentId: 'doc-community-planning-act', sectionLabel: '77' },
      { prompt: 'watercourse/wetland alteration', documentId: 'doc-clean-water-act', sectionLabel: '15' },
      { prompt: 'contaminated-site designation', documentId: 'doc-clean-environment-act', sectionLabel: '4.31' },
      { prompt: 'protected-area establishment/boundary', documentId: 'doc-protected-natural-areas-act', sectionLabel: '5' },
      { prompt: 'conservation easement registration', documentId: 'doc-conservation-easements-act', sectionLabel: '6' },
      { prompt: 'on-site sewage design/location approval', documentId: 'doc-public-health-act', sectionLabel: '24' },
    ],
    relatedUnitIds: ['A-CPA-01', 'A-CPA-02', 'A-CPA-03', 'A-CPAR-01', 'B-CWA-01', 'B-CWA-02', 'C-CEA-01', 'B-PNA-01', 'B-CE-01', 'C-PH-01', 'C-PARK-01', 'B-AGRI-01', 'B-AGRI-02'],
  }),

  nav('NAV-11', 'Evidence, records and historical title research', {
    reviewWeight: 'high',
    learningDepths: RECALL_DEPTHS,
    examGoal:
      'Route a historical title or boundary-research problem through current land-registration records, archival/public records and the separate evidentiary rules governing how records may be proved or used.',
    recognitionCues: [
      'old deed',
      'old survey plan',
      'Crown grant',
      'registered will',
      'certified copy',
      'archival record',
      'public record',
      'historic boundary evidence',
      'old Registry document',
    ],
    sources: [
      { documentId: 'doc-registry-act', ranges: [{ from: '12', to: '14' }, { from: '50' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '9' }, { from: '82' }] },
      { documentId: 'doc-evidence-act', ranges: [{ from: '36', to: '40' }, { from: '80', to: '87' }] },
      { documentId: 'doc-archives-act', ranges: [{ from: '10', to: '11' }] },
      { documentId: 'doc-public-records-act', ranges: [{ from: '1', to: '3' }, { from: '6' }] },
      { documentId: 'doc-crown-grant-restrictions-act', ranges: [{ from: '4' }] },
      { documentId: 'reg-boundaries-95-166', ranges: [{ from: '2', to: '5' }] },
    ],
    coreUnderstanding: [
      'Finding/accessing a record and proving/using that record as evidence are different legal questions.',
      'Registry, Land Titles, Archives and Public Records provisions help locate, preserve or access records.',
      'The Evidence Act supplies routes by which qualifying records, certified copies, maps, plans and survey records can be received as evidence.',
      'Formal boundary-confirmation work has its own evidence/application requirements.',
    ],
    mustRecall: [
      'Finding or obtaining a record and proving or using that record as evidence are separate questions: land-registration and archival statutes govern records/access, while the Evidence Act supplies evidentiary routes for qualifying records and copies.',
    ],
    mustLocate: [
      { prompt: 'Registry office records', documentId: 'doc-registry-act', sectionLabel: '14' },
      { prompt: 'registration of plans', documentId: 'doc-registry-act', sectionLabel: '50' },
      { prompt: 'Land Titles registered information', documentId: 'doc-land-titles-act', sectionLabel: '82' },
      { prompt: 'public records/maps/plans as evidence', documentId: 'doc-evidence-act', sectionLabel: '36' },
      { prompt: 'registered instruments/wills as evidence', documentId: 'doc-evidence-act', sectionLabel: '80' },
      { prompt: 'Registry Office documents as evidence', documentId: 'doc-evidence-act', sectionLabel: '87' },
      { prompt: 'archival public inspection', documentId: 'doc-archives-act', sectionLabel: '10' },
      { prompt: 'certified archival copies', documentId: 'doc-archives-act', sectionLabel: '11' },
    ],
    relatedUnitIds: ['A-REG-04', 'A-REG-06', 'A-LTA-07', 'B-EVID-01', 'B-EVID-02', 'C-ARCH-01', 'D-PRA-01', 'C-CGR-01', 'A-BCAR-01'],
  }),

  nav('NAV-12', 'Who is the decision-maker?', {
    reviewWeight: 'high',
    learningDepths: NO_RECALL_DEPTHS,
    examGoal:
      'Given an approval, registration, appeal, discipline, survey-system or statutory-decision question, identify the correct official/body before searching for the detailed procedure.',
    recognitionCues: [
      'who approves',
      'who decides',
      'who may order',
      'who hears an objection',
      'who hears an appeal',
      'who may rectify',
      'who certifies',
      'Registrar',
      'Chief Registrar',
      'Registrar General',
      'Director of Surveys',
      'development officer',
      'Minister',
      'Board',
      'ANBLS Council',
    ],
    sources: [
      {
        documentId: 'doc-new-brunswick-land-surveyors-act',
        ranges: [{ from: '12' }, { from: '20' }, { from: '23' }, { from: '25' }],
      },
      { documentId: 'doc-new-brunswick-land-surveyors-bylaws', ranges: [{ from: '5', to: '6' }] },
      { documentId: 'doc-surveys-act', ranges: [{ from: '3' }, { from: '7', to: '8' }] },
      { documentId: 'doc-community-planning-act', ranges: [{ from: '84', to: '86' }, { from: '108', to: '140' }] },
      { documentId: 'doc-registry-act', ranges: [{ from: '12' }, { from: '17' }, { from: '46' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '5' }, { from: '12' }, { from: '68', to: '70' }, { from: '79' }] },
      { documentId: 'doc-boundaries-confirmation-act', ranges: [{ from: '3', to: '4' }, { from: '8', to: '14' }] },
      { documentId: 'doc-assessment-act', ranges: [{ from: '25', to: '29' }, { from: '37' }] },
      {
        // Reviewed administration/Minister/Recorder scope from B-MIN-01 plus the
        // survey-order band (90-94) for survey-order/Director questions.
        documentId: 'doc-mining-act',
        ranges: [
          { from: '1', to: '6' },
          { from: '24', to: '30' },
          { from: '44', to: '48.2' },
          { from: '67', to: '69' },
          { from: '75', to: '78' },
          { from: '98', to: '105' },
          { from: '90', to: '94' },
        ],
      },
      {
        // Reviewed live C-EUB-01 decision-maker/jurisdiction provisions; the
        // s.103 Public Utilities Act repeal history is intentionally omitted.
        documentId: 'doc-energy-and-utilities-board-act',
        ranges: [
          { from: '1' },
          { from: '23' },
          { from: '28', to: '29' },
          { from: '33' },
          { from: '39' },
          { from: '43' },
          { from: '52', to: '54' },
          { from: '69', to: '71' },
          { from: '77' },
        ],
      },
    ],
    coreUnderstanding: [
      'Many exam questions can be answered faster once the candidate identifies the correct statutory actor.',
      'Different functions belong to different decision-makers: professional registration/discipline, survey-system administration, subdivision approval, Registry administration, Land Titles registration/rectification, boundary confirmation, assessment appeals and resource regulation.',
      'Do not infer authority from a job title; locate the statutory provision giving the power.',
    ],
    mustRecall: [],
    mustLocate: [
      { prompt: 'Board of Examiners / registration qualification', documentId: 'doc-new-brunswick-land-surveyors-act', sectionLabel: '12' },
      { prompt: 'professional complaints structure', documentId: 'doc-new-brunswick-land-surveyors-act', sectionLabel: '20' },
      { prompt: 'Director of Surveys / survey-system administration', documentId: 'doc-surveys-act', sectionLabel: '3' },
      { prompt: 'subdivision-plan application/approval actor', documentId: 'doc-community-planning-act', sectionLabel: '84' },
      { prompt: 'Registry registrar duties', documentId: 'doc-registry-act', sectionLabel: '12' },
      { prompt: 'Chief Registrar powers', documentId: 'doc-registry-act', sectionLabel: '17' },
      { prompt: 'Land Titles rectification authority', documentId: 'doc-land-titles-act', sectionLabel: '68' },
      { prompt: 'boundary-confirmation hearing/order route', documentId: 'doc-boundaries-confirmation-act', sectionLabel: '11' },
      { prompt: 'assessment appeal framework', documentId: 'doc-assessment-act', sectionLabel: '27' },
    ],
    relatedUnitIds: ['A-BYL-04', 'A-NBLS-02', 'A-NBLS-05', 'A-SURV-01', 'A-SURV-04', 'A-CPA-06', 'A-CPAR-02', 'A-REG-06', 'A-LTA-05', 'A-LTA-07', 'A-BCA-03', 'B-ASMT-02', 'B-MIN-01', 'B-MIN-03', 'C-EUB-01'],
  }),
];

export const EXAM_CURRICULUM_NAV_TOTAL = examCurriculumNavigationSpecs.length;

/** Navigation source documents in canonical source order (deduplicated). */
export const EXAM_CURRICULUM_NAV_DOCUMENTS: readonly string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const spec of examCurriculumNavigationSpecs) {
    for (const source of spec.sources) {
      if (!seen.has(source.documentId)) {
        seen.add(source.documentId);
        out.push(source.documentId);
      }
    }
  }
  return out;
})();
