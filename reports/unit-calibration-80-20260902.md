# Frozen Map → Unit Authoring Calibration-80 — 20260902

Run id: `ai-units-2026-09-02-frozen-map-cal80-v4`
Seed / tag: `20260902`
Prompt spec: `unit-authoring-v4`
Source map run: `ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342`
Preflight run: `ai-units-2026-09-02-frozen-map-v4-preflight`
Generated at: `2026-09-02T00:00:00.000Z`

## Selection counts

| Metric | Value |
| --- | --- |
| Selected jobs | 80 |
| Grouping-adjudication pins | 20 |
| Retry representatives | 9 |
| Regression-anchor-tagged jobs | 7 |
| Distinct grouping-correction parents | 8 |

## Selection method

- Final order: pins (freeze-correction list order, unit jobId within a parent) → retry representatives (fixed target list) → regression anchors (fixed target list) → fill pick order
- Algorithm: Deterministic; seed/tag 20260902; NO RNG — pure sorted passes. Pins are hard. Retry/regression targets resolve through the corpus package (document title + component label → sourceKey) to the frozen proposals whose targetSourceKeys include that sourceKey, then to the first approved-group unit job of the parent by jobId; a job already selected for another set is reused so tags stack and the job counts once. The fill scans the remaining pool in stable jobId order for the priority under target and takes the job with the best (domain-deficit desc, domain rank asc, not-yet-covered feature gain desc, stable index asc) score.
- 1. grouping-adjudication pins (tag final-map-grouping-adjudication)
- 2. retry-nine representatives (tag map-retry-history)
- 3. regression anchors (tag unit-v4-regression-anchor)
- 4. deterministic fill to the priority targets (selection reason fill-coverage / fill-priority)


- pin-zero-jobs: Grouping-correction map job(s) with zero unit jobs (expected for a skip correction, e.g. Service NB Act s.56): map-d747c4a97d7161d3.

## Pins (grouping-adjudication, 20)

- unit-40730d04faf14076
- unit-f1d3de4004dd0d17
- unit-02c1922ab2c2961a
- unit-9ceefa172c31deea
- unit-d9b1e53de714665c
- unit-1d069dae182e4d4a
- unit-ad5f94891873617a
- unit-e9fe22342cc56c8a
- unit-ea7e4c75c7a425ce
- unit-892e38efffb31976
- unit-b176ebe94507fd17
- unit-9aa4dea732c4bc43
- unit-de14b7aae121ea5a
- unit-df983b36ee36be82
- unit-2f3e7edff1d80df7
- unit-15fa5c5ac251dfa1
- unit-6a94737b69e069ce
- unit-fdccd69202d3a203
- unit-ade0ea76fa6d04ef
- unit-dc58323956b9fd42

## Retry-nine coverage

| Target | Unit job |
| --- | --- |
| Assessment Act s.15.3 | unit-047b933c1567c5dd |
| Community Planning Act s.1 | unit-2e7e67eb0f35fe35 |
| Community Planning Act s.75 | unit-019c765ae138d8b5 |
| Gas Distribution Act s.52 | unit-143fc780953799e6 |
| Mining Act s.68 | unit-2eedbe7a21cb2c32 |
| Municipalities Act s.100 | unit-023c1a4ddb31e2c5 |
| Occupational Health and Safety Act s.9 | unit-5fadda40929f11f0 |
| Property Act s.44 | unit-5d2a9f36002162d0 |
| Registry Act s.44 | unit-c7dc47a1735eb69d |

## Regression anchors

| Target | Unit job |
| --- | --- |
| Boundaries Confirmation Act s.10 | unit-09121fea0dce567b |
| Surveys Act s.1 | unit-e60f2ed653e5363a |
| Land Titles Act s.18 | unit-21c62d64fd32c92f |
| Registry Act s.19 | unit-806dcd5f7b8ca4e8 |
| Regulation 95-166 s.3 | unit-24d4ce03d041f274 |
| Community Planning Act s.125 | unit-00066425d3dd3645 |
| Occupational Health and Safety Act s.9 | unit-5fadda40929f11f0 |

## Priority: actual vs target

| Key | Target | Actual |
| --- | --- | --- |
| P1 | 24 | 24 |
| P2 | 28 | 28 |
| P3 | 20 | 20 |
| P4 | 8 | 8 |

## Domain: actual vs target (approximate)

| Key | Target | Actual |
| --- | --- | --- |
| adjacent | 18 | 18 |
| cadastral | 28 | 28 |
| core | 34 | 34 |

### Deviation explanations

- **priority** — exact match: Targets met exactly. Phase composition: 20 grouping-adjudication pins (P2=2, P3=15, P4=3 — the freeze corrections skew P3), 9 retry representatives (P1=3, P2=5, P3=1), 6 additional regression anchors (P1=3, P2=3; the OH&S s.9 anchor stacks on the retry representative and is counted once), and 45 deterministic fill jobs (P1=18, P2=18, P3=4, P4=5). No priority was modified: every selected frozenMapPriority equals its frozen proposal suggestedPriority.
- **domain** — exact match: Approximate targets met exactly. By phase the 80 jobs are core=9 (pins 3, retry 3, anchors 3), cadastral=9 (pins 5, retry 3, anchor 1), adjacent=17 (pins 12, retry 3, anchors 2); the priority fill topped each domain up to its target by preferring the most under-target domain inside every priority pass. Domain classification is a deterministic title-keyword table: core surveying/licensing titles (Surveys, NB Land Surveyors, Boundaries Confirmation, Territorial Division, Land Titles, Registry, Standard Forms of Conveyances, Crown Grant Restrictions, Regs 84-76/83-130/84-190/95-166), cadastral property/registration/planning titles (assessment, planning, municipal, property, condominium, easements, air space, crown lands, escheats, devolution/wills, expropriation, minerals, quarriable, trespass, transfer tax, tax relief, highway, parks, limitation of actions), everything else adjacent.

## Parent provenance mix

| Key | Count |
| --- | --- |
| final-QC-adjudicated | 20 |
| human-adjudicated | 3 |
| original | 50 |
| recovered | 1 |
| retry-promoted | 6 |

## Source size buckets

| Key | Count |
| --- | --- |
| large | 15 |
| medium | 35 |
| small | 30 |

## Focus styles

| Key | Count |
| --- | --- |
| multiple | 2 |
| single | 78 |

## Feature coverage

| Key | Count |
| --- | --- |
| broad-group-risk | 5 |
| combine | 2 |
| concept-deadline | 9 |
| concept-duty | 56 |
| concept-enumeration | 19 |
| concept-fee | 18 |
| concept-filing | 22 |
| concept-legal-effect | 18 |
| concept-power | 28 |
| concept-procedure | 32 |
| concept-prohibition | 13 |
| concept-regulation-power | 41 |
| definition-context | 76 |
| direct-reference | 45 |
| focus-multiple | 2 |
| focus-none | 0 |
| focus-single | 78 |
| multi-source | 2 |
| parent-combine | 2 |
| parent-split | 53 |
| parent-standalone | 25 |
| prov-final-QC-adjudicated | 20 |
| prov-human-adjudicated | 3 |
| prov-original | 50 |
| prov-recovered | 1 |
| prov-retry-promoted | 6 |
| repealed-mix | 16 |
| size-large | 15 |
| size-medium | 35 |
| size-small | 30 |

Feature coverage counts the selected jobs carrying each tag.
`focus-none` (group without any focus selection) is zero because the whole prepared preflight pool contains no such jobs: every one of the 4,251 prepared jobs has at least one focus selection.
`repealed-mix` (a group mixes live and repealed material: either a wholly repealed/historical source sits next to live ones — a `sourceStatuses` mix of `current` with `repealed`/`historical` — or a live source contains repealed subprovisions — any `contentFlagsBySourceKey` entry with `containsRepealedSubprovision: true`) is covered by 16 of the 80 selected jobs.

| Combine metric | Value |
| --- | --- |
| Combine-parent jobs | 2 |
| Multi-source jobs | 2 |
| Max sourceKeys on one job | 2 |

## Selected jobs (80)

| # | unit jobId | map jobId | document/section | P | disp | domain | group title | goal | foci | sourceKeys | size | provenance | reason | ⚑ flags | coverage tags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | unit-40730d04faf14076 | map-10ff468d35d10873 | Registry Act s.71 | P3 | split | core | Instrument form requirements and registrar acceptance discre… | State the instrument-form compliance requirement in subsection (2) and the regis… | single | section:71 | medium (2959) | final-QC-adjudicated | pin | correction | concept-duty concept-filing concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split pro… |
| 2 | unit-f1d3de4004dd0d17 | map-10ff468d35d10873 | Registry Act s.71 | P3 | split | core | Registry administration regulation-making power (s. 71(1)) | Explain what the Lieutenant-Governor in Council may regulate for the administrat… | single | section:71 | medium (2959) | final-QC-adjudicated | pin | correction | concept-duty concept-filing concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split pro… |
| 3 | unit-02c1922ab2c2961a | map-19c48590a1b233de | Clean Water Act s.40 | P3 | split | adjacent | Release, handling and disposal of contaminants and wastes | Explain how regulations may control contaminants and wastes and the withdrawal, … | single | section:40 | large (8934) | final-QC-adjudicated | pin | correction | concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix size-l… |
| 4 | unit-9ceefa172c31deea | map-19c48590a1b233de | Clean Water Act s.40 | P3 | split | adjacent | Costs, claims, fees and inspectors | Summarize the administrative powers, including cost recovery, claims, appeals, f… | single | section:40 | large (8934) | final-QC-adjudicated | pin | correction | concept-fee concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjud… |
| 5 | unit-d9b1e53de714665c | map-19c48590a1b233de | Clean Water Act s.40 | P3 | split | adjacent | Water classification of a watercourse | Describe the elements of the water-classification regime, including criteria and… | single | section:40 | large (8934) | final-QC-adjudicated | pin | correction | concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix size-l… |
| 6 | unit-1d069dae182e4d4a | map-445b7c242fa7ca8e | Clean Water Act s.13 | P3 | split | adjacent | Response to a possible future significant health risk | Explain when an order may be made for a possible future risk and what the order … | single | section:13 | medium (5551) | final-QC-adjudicated | pin | correction | concept-duty concept-power concept-prohibition definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix si… |
| 7 | unit-ad5f94891873617a | map-445b7c242fa7ca8e | Clean Water Act s.13 | P3 | split | adjacent | Response to a current significant health risk | Describe the required and optional orders where the risk is current, distinguish… | single | section:13 | medium (5551) | final-QC-adjudicated | pin | correction | concept-duty concept-power concept-prohibition definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix si… |
| 8 | unit-e9fe22342cc56c8a | map-445b7c242fa7ca8e | Clean Water Act s.13 | P3 | split | adjacent | Private well notice and application of order provisions | State the private-well notice duty, the liability limitation, and which order pr… | single | section:13 | medium (5551) | final-QC-adjudicated | pin | correction | concept-duty concept-power concept-procedure concept-prohibition definition-context direct-reference focus-single parent-split prov-final-QC-adjudicat… |
| 9 | unit-ea7e4c75c7a425ce | map-445b7c242fa7ca8e | Clean Water Act s.13 | P3 | split | adjacent | No person shall supply water posing a significant health ris… | State the prohibition, the systems and sources it covers, and the exception for … | single | section:13 | medium (5551) | final-QC-adjudicated | pin | correction | concept-duty concept-power concept-prohibition definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix si… |
| 10 | unit-892e38efffb31976 | map-48b1a91a069cabde | Trespass Act s.1 | P2 | split | cadastral | Land, shore and watercourse definitions | Define the land and water feature terms and state the physical boundaries each o… | single | section:1 | medium (4159) | final-QC-adjudicated | pin | correction | concept-deadline definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated size-medium |
| 11 | unit-b176ebe94507fd17 | map-48b1a91a069cabde | Trespass Act s.1 | P2 | split | cadastral | Trespass, actor and enforcement definitions | Define the core offence and enforcement terms and explain who or what each one c… | single | section:1 | medium (4159) | final-QC-adjudicated | pin | correction | concept-deadline definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated size-medium |
| 12 | unit-9aa4dea732c4bc43 | map-52353c0c8b64b6d3 | Crown Lands and Forests Act s.95 | P3 | split | cadastral | Administration, advisory board and fees | Summarize the administrative regulatory subjects, including the Advisory Board, … | single | section:95 | large (6641) | final-QC-adjudicated | pin | correction | concept-duty concept-fee concept-power concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicate… |
| 13 | unit-de14b7aae121ea5a | map-52353c0c8b64b6d3 | Crown Lands and Forests Act s.95 | P3 | split | cadastral | Surveys, tenure and access to Crown Lands | Explain the regulatory subjects concerning surveys, lease classes, rights-of-way… | single | section:95 | large (6641) | final-QC-adjudicated | pin | correction | concept-duty concept-power concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated size-large |
| 14 | unit-df983b36ee36be82 | map-52353c0c8b64b6d3 | Crown Lands and Forests Act s.95 | P3 | split | cadastral | Forest management, harvesting and royalties | Describe how regulations may govern forest management agreements, audits and pen… | single | section:95 | large (6641) | final-QC-adjudicated | pin | correction | concept-duty concept-fee concept-power concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicate… |
| 15 | unit-2f3e7edff1d80df7 | map-7c48e28797b91624 | Registry Act s.66 | P3 | standalone | core | Retaining registry office fees and the dismissal penalty | State who is barred from retaining registry office fees and the penalty for a vi… | single | section:66 | small (449) | final-QC-adjudicated | pin | correction | concept-duty concept-fee concept-power definition-context focus-single parent-standalone prov-final-QC-adjudicated repealed-mix size-small |
| 16 | unit-15fa5c5ac251dfa1 | map-8860d90d22aae7ed | Public Health Act s.68 | P4 | split | adjacent | Health regions, inspectors and notifiable disease regulation… | Summarize the regulatory subjects for health regions, inspectors, notifiable dis… | single | section:68 | large (8585) | final-QC-adjudicated | pin | correction | concept-fee concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix size-large |
| 17 | unit-6a94737b69e069ce | map-8860d90d22aae7ed | Public Health Act s.68 | P4 | split | adjacent | Water supply, water circulation and sewage regulations | Describe the regulatory subjects for water supply and circulation systems and on… | single | section:68 | large (8585) | final-QC-adjudicated | pin | correction | concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix size-large |
| 18 | unit-fdccd69202d3a203 | map-8860d90d22aae7ed | Public Health Act s.68 | P4 | split | adjacent | Food premises and food safety regulations | Summarize the regulatory subjects for food premises, food handling, food standar… | single | section:68 | large (8585) | final-QC-adjudicated | pin | correction | concept-regulation-power definition-context direct-reference focus-single parent-split prov-final-QC-adjudicated repealed-mix size-large |
| 19 | unit-ade0ea76fa6d04ef | map-d1fadd2dfd0ce395 | Aquaculture Act s.90 | P3 | split | adjacent | Incorporation by reference and application mechanics | Explain how an aquaculture regulation may incorporate standards by reference and… | single | section:90 | medium (4785) | final-QC-adjudicated | pin | correction | concept-duty concept-fee concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-f… |
| 20 | unit-dc58323956b9fd42 | map-d1fadd2dfd0ce395 | Aquaculture Act s.90 | P3 | split | adjacent | Aquaculture regulatory subjects | Summarize the range of aquaculture regulatory subjects and identify the key inst… | single | section:90 | medium (4785) | final-QC-adjudicated | pin | correction | broad-group-risk concept-duty concept-fee concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-single pa… |
| 21 | unit-047b933c1567c5dd | map-7ae41a2728f7e83b | Assessment Act s.15.3 | P2 | split | cadastral | Phased assessment calculation formula | Recall the four-year phased assessment formula: year-one base valuation plus pre… | single | section:15.3 | large (6460) | retry-promoted | retry | retry | concept-enumeration concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-retry-promoted size-… |
| 22 | unit-2e7e67eb0f35fe35 | map-1fa5a6239a1f7144 | Community Planning Act s.1 | P1 | split | cadastral | Definition of "development" | Identify the four categories of activity that constitute "development" under s. … | single | section:1 | large (6578) | retry-promoted | retry | retry | concept-enumeration concept-regulation-power definition-context direct-reference focus-single parent-split prov-retry-promoted repealed-mix size-large |
| 23 | unit-019c765ae138d8b5 | map-56bae66370b899b1 | Community Planning Act s.75 | P1 | split | cadastral | Facilities requirements and development-officer approval con… | Recall the facilities a by-law may require, the two-part approval condition in (… | single | section:75 | large (6532) | retry-promoted | retry | retry | concept-duty concept-enumeration concept-fee concept-filing concept-power definition-context direct-reference focus-single parent-split prov-retry-pro… |
| 24 | unit-143fc780953799e6 | map-33a01d563229d6dd | Gas Distribution Act, 1999 s.52 | P3 | split | adjacent | Rate-setting prohibition and Board authority | Recall the prohibition on distributor charges without a Board order, the Board's… | single | section:52 | medium (2653) | human-adjudicated | retry | retry | concept-duty concept-enumeration concept-fee concept-power concept-procedure concept-prohibition concept-regulation-power definition-context focus-sin… |
| 25 | unit-2eedbe7a21cb2c32 | map-208559fbf2dbeffa | Mining Act s.68 | P2 | split | adjacent | Boundary survey requirement and exception for previously sur… | State the boundary-survey requirement for a mining lease (survey per sections 90… | single | section:68 | medium (5872) | human-adjudicated | retry | retry | concept-duty concept-enumeration concept-filing concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-spl… |
| 26 | unit-023c1a4ddb31e2c5 | map-1c37c940368bec16 | Municipalities Act s.100 | P2 | split | cadastral | Licence fee on conviction deemed part of fine | Explain that on conviction for unlicensed activity under a by-law, the judge may… | single | section:100 | small (1970) | retry-promoted | retry | retry | concept-duty concept-fee concept-legal-effect concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-singl… |
| 27 | unit-5fadda40929f11f0 | map-59704851a9e697bf | Occupational Health and Safety Act s.9 | P2 | split | adjacent | Specific operational duties of the employer | Recall the employer's specific duties under section 9(2), including maintaining … | single | section:9 | medium (3286) | human-adjudicated | retry | retry/regression | concept-duty concept-enumeration concept-regulation-power definition-context focus-single parent-split prov-human-adjudicated size-medium |
| 28 | unit-5d2a9f36002162d0 | map-6c9e861025a7bfa4 | Property Act s.44 | P1 | standalone | cadastral | Mortgagee's Statutory Powers under Deed Mortgage (s.44) | Recall the mortgagee's statutory powers of sale and fire insurance, their trigge… | single | section:44 | medium (2217) | retry-promoted | retry | retry | concept-duty concept-enumeration concept-fee concept-legal-effect concept-power definition-context direct-reference focus-single parent-standalone pro… |
| 29 | unit-c7dc47a1735eb69d | map-845a5dc610f4fb39 | Registry Act s.44 | P2 | split | core | Out-of-Province Instrument Execution and Certification | Identify the persons authorized to take out-of-province acknowledgments and proo… | single | section:44 | medium (3623) | retry-promoted | retry | retry | concept-duty concept-fee definition-context focus-single parent-split prov-retry-promoted repealed-mix size-medium |
| 30 | unit-09121fea0dce567b | map-324db09e5f0e12de | Boundaries Confirmation Act s.10 | P2 | split | core | Hearing parties and notice of hearing | Identify the categories of parties to a hearing under subsection 10(4) and the r… | single | section:10 | medium (2232) | original | anchor | regression | concept-deadline concept-duty concept-enumeration concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-s… |
| 31 | unit-e60f2ed653e5363a | map-8b1cf0e7aa43d3bc | Surveys Act s.1 | P2 | standalone | core | Definitions in the Surveys Act | State the Act's defined meanings for surveyor, legal monument, coordinate monume… | single | section:1 | small (676) | original | anchor | regression | definition-context direct-reference focus-single parent-standalone prov-original size-small |
| 32 | unit-21c62d64fd32c92f | map-921478a7044024bd | Land Titles Act s.18 | P1 | split | core | Cancelling and issuing certificates of registered ownership | Recall the triggering registration events under subsection (5) and the registrar… | single | section:18 | medium (3564) | original | anchor | regression | concept-duty concept-enumeration concept-fee concept-filing definition-context direct-reference focus-single parent-split prov-original repealed-mix s… |
| 33 | unit-806dcd5f7b8ca4e8 | map-17219353deb3fd8b | Registry Act s.19 | P1 | split | core | Protective registration period for wills | State the registration timeframes for a will depending on whether the testator d… | single | section:19 | medium (3151) | original | anchor | regression | concept-duty concept-filing concept-legal-effect definition-context focus-single parent-split prov-original repealed-mix size-medium |
| 34 | unit-24d4ce03d041f274 | map-ed3f74e6ccd6099c | REGULATION 95-166 s.3 | P1 | split | core | Surveyor's Report Required Contents | Identify the four required components of the surveyor's report under paragraph 3… | single | section:3 | medium (2675) | original | anchor | regression | concept-duty concept-legal-effect concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-origin… |
| 35 | unit-00066425d3dd3645 | map-33ecdfe080193d4f | Community Planning Act s.125 | P2 | split | cadastral | Zoning regulation effect and deemed powers (s.125(8)–(9)) | Identify who acts as development officer under a zoning regulation and which spe… | single | section:125 | large (11628) | original | anchor | regression | concept-fee concept-legal-effect concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-spli… |
| 36 | unit-79f54c297756d4aa | map-e10048dceb53e1e7 | New Brunswick Land Surveyors Act, 1986 s.26 | P1 | standalone | core | Offence and penalties for unregistered practice as a land su… | State who is subject to section 26, the four prohibited acts in (a)–(d), and the… | single | section:26 | small (1060) | recovered | fill-coverage |  | concept-filing definition-context focus-single parent-standalone prov-recovered size-small |
| 37 | unit-a795aa5cbc9d3ee6 | map-732a1274562ce704 | New Brunswick Land Surveyors Act, 1986 s.16(2)/17(1) | P2 | combine | core | Practice by partnerships, associations of persons, and corpo… | Identify which entities may be permitted to practice land surveying and the Coun… | multiple | section:16(2),section:17(1) | small (398) | original | fill-coverage |  | combine definition-context focus-multiple multi-source parent-combine prov-original size-small |
| 38 | unit-02657c4c14328d82 | map-7581d56f4d904234 | Registry Act s.43 | P3 | standalone | core | Sufficient evidence of due execution: court and corporate se… | Recall the evidentiary requirements for a court-sealed instrument (seal alone su… | single | section:43 | small (1193) | original | fill-priority |  | concept-filing definition-context focus-single parent-standalone prov-original size-small |
| 39 | unit-009ff72aba3f0d45 | map-45d0804200b86c22 | Association of New Brunswick Land Surveyors Bylaws s.6.5.1/6… | P4 | combine | core | Legislative Review Committee: Establishment, Responsibilitie… | Recall that the Legislative Review Committee must have at least two members, its… | multiple | section:6.5.1,section:6.5.2 | small (657) | original | fill-priority |  | combine concept-duty definition-context focus-multiple multi-source parent-combine prov-original size-small |
| 40 | unit-0070dd224c8bb7a5 | map-998845fa0f9ac720 | Land Titles Act s.80 | P1 | split | core | Registration and assurance fees payable to the registrar | State the fees the registrar must receive before acting, the additional assuranc… | single | section:80 | medium (3079) | original | fill-priority |  | concept-duty concept-fee concept-filing concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-… |
| 41 | unit-0167053e440a24d5 | map-17a5d43b18134aae | Registry Act s.36 | P2 | standalone | core | Prohibitions on parties and witness requirement for affidavi… | State the two things a party to an instrument is prohibited from doing in the ex… | single | section:36 | small (552) | original | fill-priority |  | concept-duty concept-procedure definition-context focus-single parent-standalone prov-original size-small |
| 42 | unit-02dbce06a699d0b3 | map-0a6a8b4749036fee | Registry Act s.42 | P3 | standalone | core | No separate verification of seal or signing officer required… | State the circumstances under which no proof verifying the seal or the signature… | single | section:42 | small (501) | original | fill-priority |  | concept-filing focus-single parent-standalone prov-original size-small |
| 43 | unit-022c7285b5e97c06 | map-de33ef5221c93b71 | New Brunswick Land Surveyors Act, 1986 s.11(3) | P4 | standalone | core | AGM Election Terms and Council Replacement Mechanism | State the term lengths for the Association's officers and executive council memb… | single | section:11(3) | small (501) | original | fill-priority |  | concept-duty definition-context focus-single parent-standalone prov-original size-small |
| 44 | unit-03718a2726419ffc | map-998845fa0f9ac720 | Land Titles Act s.80 | P1 | split | core | Accounting for received monies and indemnification funding | Identify the registrar's duty to account for monies received and the two-tier fu… | single | section:80 | medium (3079) | original | fill-priority |  | concept-duty concept-fee concept-filing concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-split prov-… |
| 45 | unit-00786855a793bc06 | map-99a4d4ea287cc40e | Crown Lands and Forests Act s.71.2 | P2 | split | cadastral | Minister's enforcement entry and compliance actions | Identify the conditions triggering the Minister's enforcement entry, the scope o… | single | section:71.2 | medium (3662) | original | fill-priority |  | concept-enumeration concept-legal-effect concept-regulation-power definition-context direct-reference focus-single parent-split prov-original size-med… |
| 46 | unit-0445d8337e77a7c6 | map-f8234a7a5d8e8f08 | New Brunswick Land Surveyors Act, 1986 s.24(1) | P3 | standalone | core | Parties to Discipline Committee Proceedings | State who are the parties to proceedings before the Discipline Committee under t… | single | section:24(1) | small (191) | original | fill-priority |  | definition-context focus-single parent-standalone prov-original size-small |
| 47 | unit-057a72bc46425aef | map-fbf4d5014cd592ac | Municipalities Act s.184 | P4 | standalone | cadastral | Municipal power to enter public beach development agreements | Identify the permissive power section 184 gives a municipality to enter agreemen… | single | section:184 | small (120) | original | fill-priority |  | concept-power definition-context focus-single parent-standalone prov-original size-small |
| 48 | unit-0421d4fe4b51ed92 | map-1d9736bd2c01e88f | Boundaries Confirmation Act s.1 | P1 | standalone | core | Boundaries Confirmation Act – Defined Terms | Recall the statutory definitions of boundary, monument, parcel, surveyor, applic… | single | section:1 | medium (2187) | original | fill-priority |  | broad-group-risk concept-enumeration concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-single parent-… |
| 49 | unit-00cb6e97353458dc | map-6292ef0055044003 | Assessment Act s.28 | P2 | standalone | cadastral | Local government or other taxing authority appeal to the Boa… | Identify the trigger event, the 21-day deadline, and the scope of a local govern… | single | section:28 | small (560) | original | fill-priority |  | concept-deadline definition-context direct-reference focus-single parent-standalone prov-original size-small |
| 50 | unit-046240c47aa8f95b | map-2ddab4acd8b9726d | Registry Act s.13.2 | P3 | standalone | core | Electronic Information Storage System Equivalence Rules | Recall the rules under section 13.2 by which an electronic information storage s… | single | section:13.2 | small (1899) | original | fill-priority |  | concept-duty concept-legal-effect concept-regulation-power definition-context focus-single parent-standalone prov-original size-small |
| 51 | unit-09ba9569396ef78b | map-79f0cf7fcf4e7e2d | Municipalities Act s.140 | P4 | standalone | cadastral | Clerk's duty to endorse precept on assessment roll | State the clerk's duty to endorse a precept on the assessment roll and identify … | single | section:140 | small (155) | original | fill-priority |  | concept-duty concept-regulation-power definition-context focus-single parent-standalone prov-original size-small |
| 52 | unit-04cf30345017df39 | map-6f3493bf2052b252 | REGULATION 95-166 s.6 | P1 | split | core | General Hearing Procedure Rights | Identify the evidence, cross-examination, and counsel-representation rights avai… | single | section:6 | small (885) | original | fill-priority |  | broad-group-risk concept-duty concept-filing concept-procedure concept-regulation-power definition-context focus-single parent-split prov-original siz… |
| 53 | unit-010c9353d8180812 | map-285dd6b255a2a5dd | Expropriation Act s.31 | P2 | split | cadastral | Court power to consolidate proceedings | State the two conditions the Court must be satisfied with before exercising its … | single | section:31 | medium (2193) | original | fill-priority |  | concept-duty concept-power definition-context direct-reference focus-single parent-split prov-original size-medium |
| 54 | unit-06587c365a55bf49 | map-d58e8838004da028 | Land Titles Act s.7 | P4 | standalone | core | Seal of office requirement | Identify who is required to have a seal of office under the Land Titles Act and … | single | section:7 | small (199) | original | fill-priority |  | concept-duty definition-context focus-single parent-standalone prov-original size-small |
| 55 | unit-00100b7505527849 | map-6a05ab870be51872 | Expropriation Act s.5 | P1 | split | cadastral | Compensation for damage caused by entry | Recall the obligation of a person entering under s. 5(1) to make full compensati… | single | section:5 | small (1670) | original | fill-priority |  | concept-duty concept-power concept-procedure definition-context focus-single parent-split prov-original size-small |
| 56 | unit-02c520678fcbb6c2 | map-5b05b76871256470 | Registry Act s.65 | P2 | standalone | core | Fee payment as precondition to compulsory registration | State the condition that must be satisfied before the registrar can be compelled… | single | section:65 | small (163) | original | fill-priority |  | concept-duty concept-fee concept-filing concept-prohibition definition-context focus-single parent-standalone prov-original size-small |
| 57 | unit-043b932fc33b70cc | map-267e60d22e5467cd | Condominium Property Act s.6 | P1 | split | cadastral | Division of units into classes | Explain how a declaration may divide units into two or more classes and the effe… | single | section:6 | medium (3307) | original | fill-priority |  | concept-duty concept-enumeration concept-legal-effect concept-procedure concept-regulation-power definition-context direct-reference focus-single pare… |
| 58 | unit-03de3fc357cb57a5 | map-f426ebbd626257e0 | REGULATION 83-130 s.19.4 | P2 | standalone | core | Abbreviated judgment requirement for mixed-content judgment … | State when an abbreviated judgment issued under the Rules of Court must be annex… | single | section:19.4 | small (419) | original | fill-priority |  | broad-group-risk concept-duty concept-filing concept-procedure concept-regulation-power definition-context focus-single parent-standalone prov-origina… |
| 59 | unit-0449049d27b547c9 | map-3bbdc581fd0daa33 | Community Planning Act s.88 | P1 | split | cadastral | Factors for Advisory Committee or Regional Service Commissio… | List the four categories of factors an advisory committee or regional service co… | single | section:88 | medium (3449) | original | fill-priority |  | concept-duty concept-enumeration concept-filing concept-prohibition definition-context direct-reference focus-single parent-split prov-original size-m… |
| 60 | unit-049d27943f637422 | map-460ae38c7b732209 | REGULATION 83-130 s.SCHEDULE D | P2 | split | core | Payment Default, Forfeiture, and Bankruptcy Triggers | Recall the lessor's right to pay a defaulted amount and recover it as rent with … | single | schedule:schedule-d | large (13563) | original | fill-priority |  | concept-duty concept-prohibition concept-regulation-power definition-context focus-single parent-split prov-original size-large |
| 61 | unit-05d777e3d32ca761 | map-fd9321585990ed84 | Expropriation Act s.17 | P1 | split | cadastral | Officer's costs direction to expropriating authority | State the circumstances under which the Officer may direct a costs payment, the … | single | section:17 | medium (3244) | original | fill-priority |  | concept-duty concept-enumeration concept-filing concept-power concept-procedure concept-regulation-power definition-context direct-reference focus-sin… |
| 62 | unit-05aad567930a651b | map-5ea4684f006291d9 | Land Titles Act s.74 | P2 | standalone | core | Award of indemnity: Registrar General determination, conditi… | Recall the Registrar General's power to determine and award indemnity subject to… | single | section:74 | small (767) | original | fill-priority |  | broad-group-risk concept-power concept-procedure definition-context focus-single parent-standalone prov-original size-small |
| 63 | unit-07fded70d557bb42 | map-0ec8abfa2d5f299b | Expropriation Act s.10 | P1 | split | cadastral | Duty to arrange public hearing and effect of withdrawal of a… | State the conditions under which the Officer must arrange a public hearing for a… | single | section:10 | medium (3938) | original | fill-priority |  | concept-deadline concept-duty concept-filing concept-legal-effect concept-procedure concept-prohibition concept-regulation-power definition-context di… |
| 64 | unit-05e06222bdb9d406 | map-460ae38c7b732209 | REGULATION 83-130 s.SCHEDULE D | P2 | split | core | Transfer Restrictions and End-of-Lease Obligations | Recall the consent requirement (not to be unreasonably withheld) for assignment … | single | schedule:schedule-d | large (13563) | original | fill-priority |  | concept-duty concept-prohibition concept-regulation-power definition-context focus-single parent-split prov-original size-large |
| 65 | unit-08d0057dc07a46d5 | map-298e24e3ce6fbc17 | Community Planning Act s.84 | P1 | split | cadastral | Required contents of a subdivision plan | Identify the items a subdivision plan must set out under s. 84(3) and the bounda… | single | section:84 | medium (5198) | original | fill-priority |  | concept-duty concept-enumeration concept-filing concept-procedure definition-context direct-reference focus-single parent-split prov-original size-med… |
| 66 | unit-064dc209bd43e63c | map-7407f66d1a12e248 | Association of New Brunswick Land Surveyors Bylaws s.2.2.2 | P2 | standalone | core | Reapplication after resignation in good standing or classifi… | Identify the reapplication procedure available to a previously registered survey… | single | section:2.2.2 | small (175) | original | fill-priority |  | concept-procedure concept-regulation-power focus-single parent-standalone prov-original size-small |
| 67 | unit-092be74ad4e22fc6 | map-2c4459d4c8917a78 | Community Planning Act s.96 | P1 | split | cadastral | Mandatory contents of the incentive or bonus zoning by-law | List the four mandatory elements that an incentive or bonus zoning agreement by-… | single | section:96 | medium (3290) | original | fill-priority |  | concept-deadline concept-duty concept-enumeration concept-legal-effect concept-procedure concept-regulation-power definition-context direct-reference … |
| 68 | unit-07144e70868a71ec | map-964b5866d3b841db | Registry Act s.26 | P2 | standalone | core | Registration of probated and sealed will documents without f… | Identify which probate-related documents may be registered in a county registry … | single | section:26 | small (1261) | original | fill-priority |  | concept-duty concept-filing concept-legal-effect definition-context focus-single parent-standalone prov-original size-small |
| 69 | unit-0c0bbda20e7199b5 | map-486e6189da2b84e9 | Condominium Property Act s.44 | P1 | split | cadastral | Consent threshold and Director's correction power for descri… | Recall the 60% common-element consent threshold for amending a registered descri… | single | section:44 | small (1477) | original | fill-priority |  | concept-deadline concept-duty concept-enumeration concept-fee concept-filing concept-legal-effect concept-power concept-procedure definition-context d… |
| 70 | unit-07fa6fc1208594ca | map-d5572eace39dcd1d | New Brunswick Land Surveyors Act, 1986 s.18(2) | P2 | standalone | core | Conditions for entering a name in the register | State the two conditions in section 18(2) that must be met before a name may be … | single | section:18(2) | small (216) | original | fill-priority |  | concept-duty definition-context focus-single parent-standalone prov-original size-small |
| 71 | unit-0de35b1dafe93ecb | map-5cb84fb8436e4444 | Expropriation Act s.37 | P1 | split | cadastral | Additional 5% compensation for Lieutenant-Governor in Counci… | State the additional compensation the expropriating authority must pay when the … | single | section:37 | medium (2770) | original | fill-priority |  | concept-deadline concept-duty concept-filing concept-legal-effect concept-prohibition concept-regulation-power definition-context direct-reference foc… |
| 72 | unit-08f6d682936a16dc | map-fa6ff1eacf5c5aa1 | New Brunswick Land Surveyors Act, 1986 s.12(2) | P2 | standalone | core | Composition and term of the Board of Examiners | State the composition of the Board of Examiners, the appointing body, the initia… | single | section:12(2) | small (194) | original | fill-priority |  | concept-duty definition-context focus-single parent-standalone prov-original size-small |
| 73 | unit-0f35a3d73578f1dc | map-d2c5c2910af871b4 | Easements Act s.1 | P1 | standalone | cadastral | Prescriptive protection for claims to profits or benefits (3… | State the 30-year and 60-year prescriptive thresholds for a claim to a profit or… | single | section:1 | small (885) | original | fill-priority |  | concept-duty concept-legal-effect focus-single parent-standalone prov-original size-small |
| 74 | unit-01074d54d55e4fde | map-c82c87d6ebfdd492 | Evidence Act s.50 | P2 | split | adjacent | Pre-offer notice requirements and adverse-party protections | Identify the notice, copy, inspection, and naming obligations the offering party… | single | section:50 | medium (2030) | original | fill-priority |  | concept-duty concept-legal-effect definition-context focus-single parent-split prov-original size-medium |
| 75 | unit-04e2ecadf458dfc2 | map-d24505862b4066d9 | Land Titles Act s.73 | P1 | standalone | core | Indemnification on rectification – entitlement, exceptions, … | Recall the four categories of damage that trigger the right to indemnification, … | single | section:73 | small (1903) | original | fill-priority |  | concept-duty concept-enumeration concept-legal-effect concept-power definition-context focus-single parent-standalone prov-original size-small |
| 76 | unit-01114cfaf3709c7d | map-270ca8083fd27233 | Property Act s.38.1 | P2 | split | cadastral | Grounds for court-ordered mortgage discharge | Identify the circumstances under which the court may order payment into court an… | single | section:38.1 | medium (2405) | original | fill-priority |  | concept-duty concept-power concept-procedure definition-context focus-single parent-split prov-original size-medium |
| 77 | unit-38731a2761d264ad | map-d3c96ee92cf49d6f | REGULATION 80-159 s.6 | P1 | split | adjacent | Block Size Limits and Crescent/Cul-de-Sac Exception | State the maximum and minimum block length, the minimum block depth, and the con… | single | section:6 | medium (2033) | original | fill-priority |  | concept-duty concept-prohibition concept-regulation-power definition-context focus-single parent-split prov-original size-medium |
| 78 | unit-098b09224e6386c2 | map-ec01df68e68fdc5b | Land Titles Act s.40 | P2 | split | core | Non-severance of joint tenancy by judgment registration | State that registration of a judgment against registered land does not have the … | single | section:40 | small (1451) | original | fill-priority |  | concept-duty concept-enumeration concept-filing concept-legal-effect concept-procedure concept-prohibition concept-regulation-power definition-context… |
| 79 | unit-0ff46d399379a99b | map-67b0b4e5f3e4fd8e | Expropriation Act s.1 | P1 | split | cadastral | Injurious affection – taking and non-taking scenarios | Distinguish the elements of injurious affection in a partial-taking scenario fro… | single | section:1 | medium (4236) | original | fill-priority |  | concept-deadline concept-regulation-power definition-context direct-reference focus-single parent-split prov-original repealed-mix size-medium |
| 80 | unit-01093fbff98ef4eb | map-fb12fe325a229e35 | Executors and Trustees Act s.14 | P2 | standalone | adjacent | Effect of discovering a later or valid will on prior acts an… | State that acts done under a prior grant remain valid when a later or valid will… | single | section:14 | small (1584) | original | fill-priority |  | concept-duty concept-legal-effect concept-power focus-single parent-standalone prov-original size-small |

## Run layout

- Run dir: `study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4`
- Batch size: 8
- Batch count: 10
- Batch sizes: {"8":10}
- run.json SHA-256: `28070b348becdc4fa921f3b168501427fc1c141487e5e56b384c8e3565807210`
- unit-job-report.json SHA-256: `c34123ceb5dcabff473c73ab79a72f72c7dd6c080c9ae0121abb243f8a6f1457`

| Batch file | SHA-256 |
| --- | --- |
| jobs/batch-001.jobs.jsonl | `1ac12b4ad36b83b1ece9991be0a372a4653e1bfcec848c9ad45c9302c9b7a8b9` |
| jobs/batch-002.jobs.jsonl | `10806fb78b80932cb0f9fedad42b4fd310ef373fecf46a1369ed673cc1a1b83a` |
| jobs/batch-003.jobs.jsonl | `fd5bdf43488199afe3439a324b83cc2ccf5adf66b192804462795248d32adfd0` |
| jobs/batch-004.jobs.jsonl | `54954b5ee02471ccbdc2977a2a09878c563e58564c545f04ef5bfbe9ab2f39f7` |
| jobs/batch-005.jobs.jsonl | `58eef9121b317d5d0b95c940639c8e78d6aa773c922649605f237d9d06a722a7` |
| jobs/batch-006.jobs.jsonl | `d831930a579cb23490a3d1c6d228153a7e10669a863f204730b2981a450288dc` |
| jobs/batch-007.jobs.jsonl | `76c3c364fc2c165df5246a0882b6aa387d232ffe70da91d14b8d76ffe2dbc1ce` |
| jobs/batch-008.jobs.jsonl | `db039aac5bb11995d6d4849c55a9cef9fdcd1e8c56c227e856c85d56687cd85f` |
| jobs/batch-009.jobs.jsonl | `53d3b897e02c273873c0b9561f496bc1a8c647babe5ed9eaf04a960ccf54bda5` |
| jobs/batch-010.jobs.jsonl | `cd61445429f05cba567553e1a6809575519d9c5bfbc63ee468c6fe35fe0801b5` |

## Input artifacts

| Artifact | SHA-256 |
| --- | --- |
| Preflight run.json | `9c95152b5ca687a5fe6a1628d909930b3fa7e8f31b9a1a1a9acd5c3bbcea79e3` |
| Preflight batch digest | `263c44df1d0a5b88658cb38187cf7c0db3270c21cdf4af3b42fb5755882bac07` |
| Corpus package (`study-content/packages/nb-sit-statute-corpus.content-package.json`) | `ae93a1e75b814dd0463e065a5f8b3eeb9e035adc9054d442fab132cfdaa4b56b` |
| Frozen proposals | `b2726e8eae321a8d3a104520def8f0ab20abcf925ffdc1f4f2949ed0c7ff194e` |
| Frozen results | `c38147c5605dcd62a2cb42b963b7fe402de7cba538d5cda4a040a56b066d3a69` |

## Validation

- Rewritten jobs checked: 80
- Validation issues: 0
- none

