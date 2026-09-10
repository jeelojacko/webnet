// Exam Curriculum V1 — lookup drill catalog (DRILL-01..DRILL-24).
//
// Deterministic human-curated open-book lookup drills on top of the
// frozen Tier A–D + Navigation curriculum. Each drill is a fact pattern
// requiring the learner to identify applicable statute(s), locate the
// controlling provision(s), formulate an answer, and recognize traps.
//
// Catalog order: DRILL-01, DRILL-02, ..., DRILL-24.
// Difficulty: DRILL-01..08 direct, DRILL-09..16 routing, DRILL-17..24 cross_document.
// All drills resolve with mustRecall=[], mustLocate=[], sourceAnchors role='drill_answer'.

import type { ExamLookupDrillSpec } from './examCurriculumTypes';

const DRILL = 'lookup_drill';
const DRILL_TIER = 'DRILL' as const;

const mk = (spec: Omit<ExamLookupDrillSpec, 'unitType' | 'tier' | 'learningDepths'>): ExamLookupDrillSpec => ({
  ...spec,
  unitType: 'lookup_drill',
  tier: 'DRILL',
  learningDepths:
    spec.difficulty === 'direct'
      ? ['recognize', 'retrieve']
      : ['recognize', 'understand', 'retrieve'],
});

/** DRILL-01..DRILL-08 — direct difficulty (8 drills, 1 answer lookup each = 8). */
export const examCurriculumDrillSpecsDirect: ExamLookupDrillSpec[] = [
  mk({
    id: 'DRILL-01',
    title: 'Can one party witness another party\'s execution?',
    difficulty: 'direct',
    timeTargetSeconds: 60,
    factPattern: 'Two people are parties to the same instrument being registered under the Registry Act. One party proposes to witness the other party\'s execution of the instrument. Is that permitted?',
    task: 'Identify the controlling provision and answer whether one party may witness the other party\'s execution.',
    sources: [{ documentId: 'doc-registry-act', ranges: [{ from: '36' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-registry-act'],
      requiredLookups: [{ prompt: 'Registry Act s.36', documentId: 'doc-registry-act', sectionLabel: '36' }],
      requiredAnswerPoints: [
        'No.',
        'A party to the instrument may not witness the execution of the instrument by another party.',
        'The provision also addresses a party taking another party\'s affidavit or acknowledgment of execution.',
      ],
      trapExplanation: 'Do not assume ordinary witnessing rules apply without checking the Registry Act\'s specific execution restriction.',
    },
    relatedUnitIds: ['A-REG-03', 'NAV-01'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-02',
    title: 'When may subdivision lot monuments be omitted?',
    difficulty: 'direct',
    timeTargetSeconds: 90,
    factPattern: 'You are surveying subdivision lots within the statutory coordinate-survey framework. The client asks whether every lot corner must physically receive a monument.',
    task: 'Locate the regulation governing when lot monuments need not be planted and identify the statutory conditions and distance thresholds.',
    sources: [{ documentId: 'reg-surveys-84-76', ranges: [{ from: '5' }] }],
    answerKey: {
      expectedDocumentIds: ['reg-surveys-84-76'],
      requiredLookups: [{ prompt: 'Regulation 84-76 s.5', documentId: 'reg-surveys-84-76', sectionLabel: '5' }],
      requiredAnswerPoints: [
        'The regulation provides an exception in qualifying circumstances.',
        'The learner must identify the nearby-control-point/coordinate requirement.',
        'The learner must retrieve the applicable 150 m / 300 m distance thresholds and associate them with the correct statutory lot-size conditions.',
        'Do not award full credit for merely stating that monuments are optional.',
      ],
    },
    relatedUnitIds: ['A-SURVR-01', 'NAV-04'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-03',
    title: 'What belongs in a boundary-confirmation surveyor\'s report?',
    difficulty: 'direct',
    timeTargetSeconds: 90,
    factPattern: 'You are the surveyor preparing the supporting material for an application under the Boundaries Confirmation Act. What subjects must your surveyor\'s report address?',
    task: 'Find the controlling regulation and list the required subject matter of the surveyor\'s report.',
    sources: [{ documentId: 'reg-boundaries-95-166', ranges: [{ from: '3' }] }],
    answerKey: {
      expectedDocumentIds: ['reg-boundaries-95-166'],
      requiredLookups: [{ prompt: 'Regulation 95-166 s.3', documentId: 'reg-boundaries-95-166', sectionLabel: '3' }],
      requiredAnswerPoints: [
        'Issue to be determined.',
        'History of the boundary.',
        'Evidence relied upon.',
        'Reasons for accepting or rejecting competing boundary evidence, including relevant plan/documentary/physical evidence as required by the source.',
      ],
      trapExplanation: 'Do not answer only with the general application form requirements; the question asks specifically about the surveyor\'s report.',
    },
    relatedUnitIds: ['A-BCAR-01', 'NAV-02'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-04',
    title: 'Where is the centre line when highway boundaries are in doubt?',
    difficulty: 'direct',
    timeTargetSeconds: 60,
    factPattern: 'The legal boundaries of an existing highway are uncertain or disputed. What line does the Highway Act deem to be the centre line for the statutory boundary analysis?',
    task: 'Locate the Highway Act rule and identify the deemed centre line.',
    sources: [{ documentId: 'doc-highway-act', ranges: [{ from: '30' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-highway-act'],
      requiredLookups: [{ prompt: 'Highway Act s.30', documentId: 'doc-highway-act', sectionLabel: '30' }],
      requiredAnswerPoints: [
        'Where the statutory rule applies, the line along the centre line of the travelled portion is deemed to be the centre line of the highway.',
      ],
    },
    relatedUnitIds: ['B-HWY-02', 'NAV-02'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-05',
    title: 'Surveying a parcel that touches Crown Lands',
    difficulty: 'direct',
    timeTargetSeconds: 60,
    factPattern: 'A private parcel survey establishes a parcel with a boundary or corner touching or bordering Crown Lands. Does the Crown Lands and Forests Act impose an additional plan-related duty on the surveyor?',
    task: 'Find the controlling provision and state the surveyor\'s additional duty.',
    sources: [{ documentId: 'doc-crown-lands-and-forests-act', ranges: [{ from: '11' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-crown-lands-and-forests-act'],
      requiredLookups: [{ prompt: 'Crown Lands and Forests Act s.11', documentId: 'doc-crown-lands-and-forests-act', sectionLabel: '11' }],
      requiredAnswerPoints: [
        'The surveyor must submit a copy of the plan of survey to the Minister where the statutory Crown-border condition is met.',
      ],
    },
    relatedUnitIds: ['B-CLF-02', 'NAV-02', 'NAV-06'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-06',
    title: 'Approval for a new on-site sewage system',
    difficulty: 'direct',
    timeTargetSeconds: 60,
    factPattern: 'A proposed dwelling will use an on-site sewage disposal system. Before the system is installed or constructed, what does the Public Health Act require to be approved?',
    task: 'Locate the live Public Health provision and identify what must be approved.',
    sources: [{ documentId: 'doc-public-health-act', ranges: [{ from: '24' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-public-health-act'],
      requiredLookups: [{ prompt: 'Public Health Act s.24', documentId: 'doc-public-health-act', sectionLabel: '24' }],
      requiredAnswerPoints: [
        'The design and location of the on-site sewage disposal system must receive the required Ministerial approval before installation/construction under the live statutory framework.',
      ],
      trapExplanation: 'Former s.22 subdivision assessment is repealed and is not the answer.',
    },
    relatedUnitIds: ['C-PH-01', 'NAV-10'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-07',
    title: 'Altering a watercourse or wetland',
    difficulty: 'direct',
    timeTargetSeconds: 75,
    factPattern: 'A proposed project will alter a watercourse or wetland. What does the Clean Water Act generally require before the work proceeds?',
    task: 'Locate the controlling provision and identify the plans/information and permit requirement.',
    sources: [{ documentId: 'doc-clean-water-act', ranges: [{ from: '15' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-clean-water-act'],
      requiredLookups: [{ prompt: 'Clean Water Act s.15', documentId: 'doc-clean-water-act', sectionLabel: '15' }],
      requiredAnswerPoints: [
        'The person must provide the required plans/documents/information and obtain the required Ministerial permit before carrying out a qualifying alteration, subject to the Act\'s exemptions/waivers.',
      ],
    },
    relatedUnitIds: ['B-CWA-02', 'NAV-10'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-08',
    title: 'Does registering an easement attract transfer tax?',
    difficulty: 'direct',
    timeTargetSeconds: 75,
    factPattern: 'An instrument creating an easement is being registered. Is real-property transfer tax payable merely because the easement is registered?',
    task: 'Locate the applicable exemption and answer the tax question.',
    sources: [{ documentId: 'doc-real-property-transfer-tax-act', ranges: [{ from: '6' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-real-property-transfer-tax-act'],
      requiredLookups: [{ prompt: 'Real Property Transfer Tax Act s.6', documentId: 'doc-real-property-transfer-tax-act', sectionLabel: '6' }],
      requiredAnswerPoints: [
        'The easement falls within the applicable statutory transfer-tax exemption.',
        'The learner should identify the correct easement/right exemption in s.6.',
      ],
    },
    relatedUnitIds: ['B-RPTT-01', 'B-EASE-01', 'NAV-05'],
    reviewWeight: 'medium',
  }),
];

/** DRILL-09..DRILL-16 — routing difficulty (8 drills, 17 answer lookups). */
export const examCurriculumDrillSpecsRouting: ExamLookupDrillSpec[] = [
  mk({
    id: 'DRILL-09',
    title: 'A signed transfer is not yet registered — Registry or Land Titles?',
    difficulty: 'routing',
    timeTargetSeconds: 120,
    factPattern: 'A client has signed a transfer but it has not yet been registered. Explain why you cannot answer the legal effect of that fact until you know whether the parcel is governed by Registry or Land Titles.',
    task: 'Compare the applicable Registry and Land Titles provisions governing registration and identify the key system distinction.',
    sources: [
      { documentId: 'doc-registry-act', ranges: [{ from: '34' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '15', to: '16' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-registry-act', 'doc-land-titles-act'],
      requiredLookups: [
        { prompt: 'Registry Act s.34', documentId: 'doc-registry-act', sectionLabel: '34' },
        { prompt: 'Land Titles Act s.15', documentId: 'doc-land-titles-act', sectionLabel: '15' },
        { prompt: 'Land Titles Act s.16', documentId: 'doc-land-titles-act', sectionLabel: '16' },
      ],
      requiredAnswerPoints: [
        'First classify the parcel as Registry or Land Titles.',
        'Registry uses the registered-conveyance/instrument framework.',
        'Land Titles makes registration central to passing the registered estate or interest and to the statutory status of the registered owner.',
        'The systems must not be treated as legally identical.',
      ],
    },
    relatedUnitIds: ['NAV-01', 'A-REG-02', 'A-LTA-02'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-10',
    title: 'Thirty years of driveway use over registered Land Titles land',
    difficulty: 'routing',
    timeTargetSeconds: 150,
    factPattern: 'A neighbour says they have acquired a right-of-way because they have used a driveway continuously for 30 years. The servient parcel was already registered under the Land Titles system before that period accrued.',
    task: 'Identify why the Easements Act cannot be applied in isolation and determine which Land Titles provision must also be checked.',
    sources: [
      { documentId: 'doc-easements-act', ranges: [{ from: '2' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '17' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-easements-act', 'doc-land-titles-act'],
      requiredLookups: [
        { prompt: 'Easements Act s.2', documentId: 'doc-easements-act', sectionLabel: '2' },
        { prompt: 'Land Titles Act s.17', documentId: 'doc-land-titles-act', sectionLabel: '17' },
      ],
      requiredAnswerPoints: [
        'The Easements Act provides the general prescriptive framework.',
        'The learner must then check Land Titles Act s.17.',
        'Do not mechanically conclude that 30 years creates the claimed easement over already-registered Land Titles land.',
        'Land Titles changes the treatment of prescription after registration and must control the analysis where applicable.',
      ],
      trapExplanation: 'The numerical Easements Act period by itself is insufficient.',
    },
    relatedUnitIds: ['NAV-05', 'B-EASE-02', 'A-LTA-02'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-11',
    title: 'Approved subdivision plan that was never filed',
    difficulty: 'routing',
    timeTargetSeconds: 120,
    factPattern: 'A subdivision plan received the required statutory approval eight months ago, but it has not yet been filed in the land registration office. The owner assumes approval alone completed the subdivision.',
    task: 'Determine the distinction between approval and filing and find the statutory validity period for an approved but unfiled plan.',
    sources: [{ documentId: 'doc-community-planning-act', ranges: [{ from: '85', to: '86' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-community-planning-act'],
      requiredLookups: [
        { prompt: 'Community Planning Act s.85', documentId: 'doc-community-planning-act', sectionLabel: '85' },
        { prompt: 'Community Planning Act s.86', documentId: 'doc-community-planning-act', sectionLabel: '86' },
      ],
      requiredAnswerPoints: [
        'Approval and filing are separate statutory stages.',
        'The approved plan still has to be filed as required.',
        'The learner must retrieve the one-year statutory validity/failure-to-file rule from s.86 and apply it correctly to the eight-month fact pattern.',
      ],
    },
    relatedUnitIds: ['A-CPA-04', 'NAV-03'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-12',
    title: 'Subdivision inside an integrated survey area',
    difficulty: 'routing',
    timeTargetSeconds: 150,
    factPattern: 'A subdivision has progressed through the Community Planning approval process. The land lies inside an integrated survey area. Is planning approval alone enough to complete the survey-law analysis?',
    task: 'Identify the planning provision and the additional Surveys Act regime that must be checked.',
    sources: [
      { documentId: 'doc-community-planning-act', ranges: [{ from: '84', to: '86' }] },
      { documentId: 'doc-surveys-act', ranges: [{ from: '7', to: '8' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-community-planning-act', 'doc-surveys-act'],
      requiredLookups: [
        { prompt: 'Community Planning Act s.84', documentId: 'doc-community-planning-act', sectionLabel: '84' },
        { prompt: 'Surveys Act s.7', documentId: 'doc-surveys-act', sectionLabel: '7' },
        { prompt: 'Surveys Act s.8', documentId: 'doc-surveys-act', sectionLabel: '8' },
      ],
      requiredAnswerPoints: [
        'Planning/subdivision approval does not end the analysis.',
        'Integrated-survey-area requirements under the Surveys Act still apply.',
        'The learner should identify the additional coordinate/monument/plan duties under ss.7–8 and route into Regulation 84-76 if further technical detail is needed.',
      ],
      trapExplanation: 'Do not stop at Community Planning approval.',
    },
    relatedUnitIds: ['NAV-03', 'A-CPA-04', 'A-SURV-03', 'A-SURV-04'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-13',
    title: 'You placed monuments — what plan obligations follow?',
    difficulty: 'routing',
    timeTargetSeconds: 120,
    factPattern: 'A survey results in new survey monuments being placed in the field. Determine the general Survey Plan consequence and then locate the Association\'s plan-validation framework.',
    task: 'Route the question through the applicable ANBLS Bylaw provisions.',
    sources: [
      { documentId: 'doc-new-brunswick-land-surveyors-bylaws', ranges: [{ from: '11' }, { from: '19' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-new-brunswick-land-surveyors-bylaws'],
      requiredLookups: [
        { prompt: 'ANBLS Bylaws Part/section 19', documentId: 'doc-new-brunswick-land-surveyors-bylaws', sectionLabel: '19' },
        { prompt: 'ANBLS Bylaws Part/section 11', documentId: 'doc-new-brunswick-land-surveyors-bylaws', sectionLabel: '11' },
      ],
      requiredAnswerPoints: [
        'Where a survey results in monuments being placed, a Survey Plan is generally required under the frozen Bylaw rule.',
        'The qualifying coordinated-plan exception must be respected.',
        'The resulting plan must then be considered under the applicable plan-validation framework.',
      ],
      trapExplanation: 'Never reverse the proposition into "plans cause monuments to be placed."',
    },
    relatedUnitIds: ['A-BYL-06', 'NAV-04'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-14',
    title: 'Who must approve or certify an air-space plan?',
    difficulty: 'routing',
    timeTargetSeconds: 120,
    factPattern: 'A surveyor is preparing a statutory air-space parcel plan for filing. Identify the distinct certification and approval functions required by the Air Space Act.',
    task: 'Locate the plan-content and filing/approval provisions and distinguish the responsible actors.',
    sources: [{ documentId: 'doc-air-space-act', ranges: [{ from: '4', to: '5' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-air-space-act'],
      requiredLookups: [
        { prompt: 'Air Space Act s.4', documentId: 'doc-air-space-act', sectionLabel: '4' },
        { prompt: 'Air Space Act s.5', documentId: 'doc-air-space-act', sectionLabel: '5' },
      ],
      requiredAnswerPoints: [
        'The surveyor provides the required certificate/seal respecting the plan.',
        'The development officer supplies the statutory approval assigned to that office.',
        'The Director of Surveys supplies the distinct statutory approval assigned to the Director.',
        'These functions are not interchangeable.',
      ],
    },
    relatedUnitIds: ['B-AIR-02', 'NAV-09', 'NAV-12'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-15',
    title: 'Bare-land condominium unit boundaries',
    difficulty: 'routing',
    timeTargetSeconds: 150,
    factPattern: 'You are preparing the survey component of a bare-land condominium description. How are the unit boundaries to be referenced and what must the surveyor certify?',
    task: 'Find the controlling Condominium Property Act provision and identify the boundary/monument certification requirements.',
    sources: [{ documentId: 'doc-condominium-property-act', ranges: [{ from: '7' }] }],
    answerKey: {
      expectedDocumentIds: ['doc-condominium-property-act'],
      requiredLookups: [
        { prompt: 'Condominium Property Act s.7', documentId: 'doc-condominium-property-act', sectionLabel: '7' },
      ],
      requiredAnswerPoints: [
        'Bare-land unit boundaries are specified by reference to the appropriate coordinate monument as required by the Act.',
        'The required monuments must be established on the ground.',
        'The surveyor\'s certification addresses the statutory monumentation and the substantial agreement of the diagrams with those monuments.',
      ],
    },
    relatedUnitIds: ['B-CONDO-02', 'NAV-09'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-16',
    title: 'Wrong information in the Land Titles register',
    difficulty: 'routing',
    timeTargetSeconds: 120,
    factPattern: 'An error is discovered in the Land Titles register. Correcting the register may cause financial loss to a person who relied on the registration system.',
    task: 'Identify where to look for correcting the title register and where to look for possible compensation.',
    sources: [
      { documentId: 'doc-land-titles-act', ranges: [{ from: '68' }, { from: '73' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-land-titles-act'],
      requiredLookups: [
        { prompt: 'Land Titles Act s.68', documentId: 'doc-land-titles-act', sectionLabel: '68' },
        { prompt: 'Land Titles Act s.73', documentId: 'doc-land-titles-act', sectionLabel: '73' },
      ],
      requiredAnswerPoints: [
        'Rectification/correction of the title register is addressed beginning at s.68.',
        'Indemnification for qualifying loss is addressed beginning at s.73.',
        'The learner should distinguish correction of the register from the separate question of compensation and note that statutory conditions/exceptions apply.',
      ],
    },
    relatedUnitIds: ['A-LTA-05', 'A-LTA-06', 'NAV-01'],
    reviewWeight: 'high',
  }),
];

/** DRILL-17..DRILL-24 — cross_document difficulty (8 drills, 28 answer lookups). */
export const examCurriculumDrillSpecsCrossDocument: ExamLookupDrillSpec[] = [
  mk({
    id: 'DRILL-17',
    title: 'Old fence, missing monument and conflicting plans',
    difficulty: 'cross_document',
    timeTargetSeconds: 240,
    factPattern: 'Two Registry-system owners disagree about a boundary. A monument shown on an older survey is gone, occupation follows an old fence, and two historical plans appear inconsistent. The owners ask you to "have the boundary legally confirmed."',
    task: 'Describe the legal research and survey route before a formal boundary-confirmation decision, and identify when the Boundaries Confirmation process becomes relevant.',
    sources: [
      { documentId: 'doc-registry-act', ranges: [{ from: '14' }, { from: '50' }] },
      { documentId: 'doc-surveys-act', ranges: [{ from: '12' }] },
      { documentId: 'doc-evidence-act', ranges: [{ from: '36' }] },
      { documentId: 'doc-boundaries-confirmation-act', ranges: [{ from: '7' }] },
      { documentId: 'reg-boundaries-95-166', ranges: [{ from: '3' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-registry-act', 'doc-surveys-act', 'doc-evidence-act', 'doc-boundaries-confirmation-act', 'reg-boundaries-95-166'],
      requiredLookups: [
        { prompt: 'Registry Act s.14', documentId: 'doc-registry-act', sectionLabel: '14' },
        { prompt: 'Registry Act s.50', documentId: 'doc-registry-act', sectionLabel: '50' },
        { prompt: 'Surveys Act s.12', documentId: 'doc-surveys-act', sectionLabel: '12' },
        { prompt: 'Evidence Act s.36', documentId: 'doc-evidence-act', sectionLabel: '36' },
        { prompt: 'Boundaries Confirmation Act s.7', documentId: 'doc-boundaries-confirmation-act', sectionLabel: '7' },
        { prompt: 'Regulation 95-166 s.3', documentId: 'reg-boundaries-95-166', sectionLabel: '3' },
      ],
      requiredAnswerPoints: [
        'Begin with Registry/title and plan research.',
        'Investigate the field evidence and apply the lost-monument framework where relevant.',
        'Historical plans/records may require consideration under the Evidence Act.',
        'The surveyor\'s professional boundary investigation/determination is not the same thing as statutory boundary confirmation.',
        'If formal confirmation is required, route into the Boundaries Confirmation Act application process and the regulation\'s required surveyor report/evidence package.',
      ],
      trapExplanation: 'Do not treat filing an application for boundary confirmation as a substitute for first investigating the boundary evidence.',
    },
    relatedUnitIds: ['NAV-02', 'NAV-11', 'A-SURV-04', 'A-BCA-01', 'A-BCAR-01', 'B-EVID-02'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-18',
    title: 'Three different rights to enter private land',
    difficulty: 'cross_document',
    timeTargetSeconds: 180,
    factPattern: 'Compare three situations: (1) a land surveyor entering private property for ordinary survey work, (2) an authorized person entering to make surveys/borings to assess land for possible expropriation, and (3) an authorized public-works crew entering to survey and investigate for a public work.',
    task: 'Identify the separate statutory authorities and explain why none of these entry powers should automatically be treated as a transfer of title.',
    sources: [
      { documentId: 'doc-surveys-act', ranges: [{ from: '13' }] },
      { documentId: 'doc-expropriation-act', ranges: [{ from: '5' }] },
      { documentId: 'doc-public-works-act', ranges: [{ from: '9' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-surveys-act', 'doc-expropriation-act', 'doc-public-works-act'],
      requiredLookups: [
        { prompt: 'Surveys Act s.13', documentId: 'doc-surveys-act', sectionLabel: '13' },
        { prompt: 'Expropriation Act s.5', documentId: 'doc-expropriation-act', sectionLabel: '5' },
        { prompt: 'Public Works Act s.9', documentId: 'doc-public-works-act', sectionLabel: '9' },
      ],
      requiredAnswerPoints: [
        'Each scenario derives from a different statutory entry authority.',
        'Ordinary survey entry is not automatically expropriation.',
        'Pre-expropriation investigation is not itself the acquisition of title.',
        'Public-work investigative entry is also distinct from subsequent designation, vesting or acquisition.',
        'A statutory right to enter, survey or test land is not equivalent to ownership transfer.',
      ],
    },
    relatedUnitIds: ['NAV-07', 'A-SURV-05', 'B-EXPR-02', 'B-PW-02'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-19',
    title: 'Registered Land Titles owner dies',
    difficulty: 'cross_document',
    timeTargetSeconds: 180,
    factPattern: 'A registered owner of Land Titles land dies. The executor wants the land dealt with through the estate and eventually transferred to the beneficiary named in the estate process.',
    task: 'Identify the Land Titles transmission provision and determine whether the qualifying estate-to-beneficiary transfer is automatically subject to real-property transfer tax.',
    sources: [
      { documentId: 'doc-land-titles-act', ranges: [{ from: '53' }] },
      { documentId: 'doc-real-property-transfer-tax-act', ranges: [{ from: '6' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-land-titles-act', 'doc-real-property-transfer-tax-act'],
      requiredLookups: [
        { prompt: 'Land Titles Act s.53', documentId: 'doc-land-titles-act', sectionLabel: '53' },
        { prompt: 'Real Property Transfer Tax Act s.6', documentId: 'doc-real-property-transfer-tax-act', sectionLabel: '6' },
      ],
      requiredAnswerPoints: [
        'The death/transmission question is first routed through Land Titles Act s.53 and the personal-representative registration framework.',
        'The later estate transfer must then be checked against the statutory transfer-tax exemptions.',
        'The learner should identify the qualifying executor/administrator-to-beneficiary/heir exemption in s.6 where the statutory facts are satisfied.',
        'Do not treat every estate transfer as automatically taxable or automatically exempt without checking the exemption conditions.',
      ],
    },
    relatedUnitIds: ['A-LTA-04', 'B-RPTT-01', 'C-DOE-01', 'C-PROB-01', 'NAV-08'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-20',
    title: 'Surface ownership, mineral ownership and a Mining Act survey',
    difficulty: 'cross_document',
    timeTargetSeconds: 180,
    factPattern: 'A client owns the surface parcel. Another party asserts statutory mineral rights, and a formal Mining Act boundary survey may be ordered. The client assumes owning the surface necessarily means owning the minerals and that an ordinary cadastral survey framework alone applies.',
    task: 'Separate the mineral-ownership question from the Mining Act survey question and identify the relevant statutory provisions.',
    sources: [
      { documentId: 'doc-ownership-of-minerals-act', ranges: [{ from: '3' }] },
      { documentId: 'doc-mining-act', ranges: [{ from: '90', to: '91' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-ownership-of-minerals-act', 'doc-mining-act'],
      requiredLookups: [
        { prompt: 'Ownership of Minerals Act s.3', documentId: 'doc-ownership-of-minerals-act', sectionLabel: '3' },
        { prompt: 'Mining Act s.90', documentId: 'doc-mining-act', sectionLabel: '90' },
        { prompt: 'Mining Act s.91', documentId: 'doc-mining-act', sectionLabel: '91' },
      ],
      requiredAnswerPoints: [
        'Minerals may constitute property separate from ownership of the soil/surface under the statutory framework.',
        'A Mining Act boundary survey must satisfy the Act\'s surveyor-qualification/Surveys Act framework.',
        'The learner must retrieve the Mining Act coordinate/height requirements from the applicable provision.',
        'Surface title and mineral rights must not be collapsed into one ownership question.',
      ],
    },
    relatedUnitIds: ['C-OMIN-01', 'B-MIN-03', 'NAV-06'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-21',
    title: 'Approved lot beside a wetland with a septic system',
    difficulty: 'cross_document',
    timeTargetSeconds: 210,
    factPattern: 'A subdivision plan creating a residential lot has been approved. The proposed building area is near a wetland and the property will use an on-site sewage system. The owner says the planning approval means every land-related approval is complete.',
    task: 'Identify the independent statutory regimes that still need to be considered.',
    sources: [
      { documentId: 'doc-community-planning-act', ranges: [{ from: '84' }] },
      { documentId: 'doc-clean-water-act', ranges: [{ from: '15' }] },
      { documentId: 'doc-public-health-act', ranges: [{ from: '24' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-community-planning-act', 'doc-clean-water-act', 'doc-public-health-act'],
      requiredLookups: [
        { prompt: 'Community Planning Act s.84', documentId: 'doc-community-planning-act', sectionLabel: '84' },
        { prompt: 'Clean Water Act s.15', documentId: 'doc-clean-water-act', sectionLabel: '15' },
        { prompt: 'Public Health Act s.24', documentId: 'doc-public-health-act', sectionLabel: '24' },
      ],
      requiredAnswerPoints: [
        'Subdivision/planning approval is only one statutory regime.',
        'Qualifying wetland/watercourse alteration may independently require Clean Water Act compliance/permit.',
        'The on-site sewage system separately requires the live Public Health design/location approval.',
        'Multiple statutory overlays may simultaneously affect the same parcel.',
      ],
      trapExplanation: 'Do not use repealed Public Health s.22 as a live subdivision approval.',
    },
    relatedUnitIds: ['NAV-10', 'NAV-03', 'B-CWA-02', 'C-PH-01'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-22',
    title: 'Can an old government survey plan be used as evidence?',
    difficulty: 'cross_document',
    timeTargetSeconds: 210,
    factPattern: 'During a boundary investigation, you locate an old government survey plan in archival/public records. The client asks whether merely finding the plan means it is automatically usable as proof of the boundary.',
    task: 'Separate record access/certification from the distinct question of evidentiary treatment.',
    sources: [
      { documentId: 'doc-registry-act', ranges: [{ from: '14' }] },
      { documentId: 'doc-archives-act', ranges: [{ from: '10', to: '11' }] },
      { documentId: 'doc-evidence-act', ranges: [{ from: '36' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-registry-act', 'doc-archives-act', 'doc-evidence-act'],
      requiredLookups: [
        { prompt: 'Registry Act s.14', documentId: 'doc-registry-act', sectionLabel: '14' },
        { prompt: 'Archives Act s.10', documentId: 'doc-archives-act', sectionLabel: '10' },
        { prompt: 'Archives Act s.11', documentId: 'doc-archives-act', sectionLabel: '11' },
        { prompt: 'Evidence Act s.36', documentId: 'doc-evidence-act', sectionLabel: '36' },
      ],
      requiredAnswerPoints: [
        'Record access/retrieval is one question.',
        'Archival inspection and certified-copy mechanisms are separate from admissibility/proof.',
        'The Evidence Act supplies the evidentiary route for qualifying public records, maps, plans and records of survey.',
        'Finding a document does not by itself determine its evidentiary effect.',
      ],
    },
    relatedUnitIds: ['NAV-11', 'B-EVID-02', 'C-ARCH-01', 'A-REG-06'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-23',
    title: 'Unsigned legal effect of a conservation easement?',
    difficulty: 'cross_document',
    timeTargetSeconds: 180,
    factPattern: 'The owner of a parcel registered under Land Titles has executed a conservation easement in favour of a qualifying holder, but the easement has not yet been registered. The parties also ask whether registering the easement itself attracts real-property transfer tax.',
    task: 'Determine when the conservation easement obtains legal effect, identify the relevant Land Titles registration route and find the applicable transfer-tax treatment.',
    sources: [
      { documentId: 'doc-conservation-easements-act', ranges: [{ from: '6' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '24' }] },
      { documentId: 'doc-real-property-transfer-tax-act', ranges: [{ from: '6' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-conservation-easements-act', 'doc-land-titles-act', 'doc-real-property-transfer-tax-act'],
      requiredLookups: [
        { prompt: 'Conservation Easements Act s.6', documentId: 'doc-conservation-easements-act', sectionLabel: '6' },
        { prompt: 'Land Titles Act s.24', documentId: 'doc-land-titles-act', sectionLabel: '24' },
        { prompt: 'Real Property Transfer Tax Act s.6', documentId: 'doc-real-property-transfer-tax-act', sectionLabel: '6' },
      ],
      requiredAnswerPoints: [
        'The conservation easement does not acquire the statutory legal effect until the required registration occurs.',
        'For this fact pattern, route the registered interest through the Land Titles easement framework.',
        'The learner must identify the applicable easement transfer-tax exemption.',
        'Execution alone and registration are not interchangeable legal events.',
      ],
    },
    relatedUnitIds: ['B-CE-01', 'A-LTA-03', 'B-RPTT-01', 'NAV-05'],
    reviewWeight: 'high',
  }),
  mk({
    id: 'DRILL-24',
    title: 'Who actually decides each part of the job?',
    difficulty: 'cross_document',
    timeTargetSeconds: 240,
    factPattern: 'A complex file raises four separate questions: (1) who handles the statutory subdivision-plan approval process, (2) who administers the provincial survey-system framework, (3) who handles Registry administration, and (4) who has statutory authority in the Land Titles rectification process.',
    task: 'Route each question to the correct statutory actor and controlling provision rather than assuming that one government office handles everything.',
    sources: [
      { documentId: 'doc-community-planning-act', ranges: [{ from: '84' }] },
      { documentId: 'doc-surveys-act', ranges: [{ from: '3' }] },
      { documentId: 'doc-registry-act', ranges: [{ from: '12' }] },
      { documentId: 'doc-land-titles-act', ranges: [{ from: '68' }] },
    ],
    answerKey: {
      expectedDocumentIds: ['doc-community-planning-act', 'doc-surveys-act', 'doc-registry-act', 'doc-land-titles-act'],
      requiredLookups: [
        { prompt: 'Community Planning Act s.84', documentId: 'doc-community-planning-act', sectionLabel: '84' },
        { prompt: 'Surveys Act s.3', documentId: 'doc-surveys-act', sectionLabel: '3' },
        { prompt: 'Registry Act s.12', documentId: 'doc-registry-act', sectionLabel: '12' },
        { prompt: 'Land Titles Act s.68', documentId: 'doc-land-titles-act', sectionLabel: '68' },
      ],
      requiredAnswerPoints: [
        'Subdivision-plan processing/approval must be routed to the development-officer/planning authority identified by the Act.',
        'Provincial survey-system administration routes to the Director of Surveys.',
        'Registry administration routes to the registrar structure established under the Registry Act.',
        'Land Titles rectification routes through the statutory rectification authority/process in s.68, including any approval/actor structure required by that provision.',
        'Do not infer powers merely from similar titles such as Registrar, Chief Registrar or Registrar General.',
      ],
    },
    relatedUnitIds: ['NAV-12', 'A-CPA-06', 'A-SURV-01', 'A-REG-06', 'A-LTA-05'],
    reviewWeight: 'high',
  }),
];

/** All 24 lookup drill specs in canonical order DRILL-01..DRILL-24. */
export const examCurriculumDrillSpecs: ExamLookupDrillSpec[] = [
  ...examCurriculumDrillSpecsDirect,
  ...examCurriculumDrillSpecsRouting,
  ...examCurriculumDrillSpecsCrossDocument,
];

/** Difficulty distribution assertions. */
export const EXAM_CURRICULUM_DRILL_TOTAL = 24;
export const EXAM_CURRICULUM_DRILL_DIRECT_COUNT = 8;
export const EXAM_CURRICULUM_DRILL_ROUTING_COUNT = 8;
export const EXAM_CURRICULUM_DRILL_CROSS_DOCUMENT_COUNT = 8;

/** Hidden answer-key lookup totals per difficulty. */
export const EXAM_CURRICULUM_DRILL_ANSWER_LOOKUPS = {
  direct: 8,
  routing: 17,
  cross_document: 28,
  total: 53,
} as const;

/** Time targets for every drill (seconds), in canonical DRILL-01..DRILL-24 order. */
export const EXAM_CURRICULUM_DRILL_TIME_TARGETS = [
  60, 90, 90, 60, 60, 60, 75, 75,
  120, 150, 120, 150, 120, 120, 150, 120,
  240, 180, 180, 180, 210, 210, 180, 240,
];

/** Verify time targets match spec order. */
export const assertDrillTimeTargets = (): void => {
  if (examCurriculumDrillSpecs.length !== EXAM_CURRICULUM_DRILL_TOTAL) {
    throw new Error(`exam-curriculum: expected ${EXAM_CURRICULUM_DRILL_TOTAL} drill specs, found ${examCurriculumDrillSpecs.length}`);
  }
  for (let i = 0; i < examCurriculumDrillSpecs.length; i++) {
    if (examCurriculumDrillSpecs[i].timeTargetSeconds !== EXAM_CURRICULUM_DRILL_TIME_TARGETS[i]) {
      throw new Error(`exam-curriculum: drill ${examCurriculumDrillSpecs[i].id} time target ${examCurriculumDrillSpecs[i].timeTargetSeconds} does not match expected ${EXAM_CURRICULUM_DRILL_TIME_TARGETS[i]}`);
    }
  }
};
