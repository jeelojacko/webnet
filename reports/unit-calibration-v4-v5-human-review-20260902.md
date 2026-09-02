# Calibration V4/V5 Human Review — 20260902

V4 run: `ai-units-2026-09-02-frozen-map-cal80-v4` · V5 run: `ai-units-2026-09-02-frozen-map-cal80-v5` · 80 jobs · generated at `2026-09-02T00:00:00.000Z`

Risk-ordered deterministic review. Tiers (first match wins; ties by crosswalk seq):
1. v5-failure (no accepted V5 result / provider-incomplete)
2. v5-needs-revision (V5 authoringStatus needs-map-revision)
3. status-change (V4 and V5 authoringStatus differ)
4. warning-heavy (V5 warning count ≥ 3, or ≥ V4 + 2)
5. named (anchors / final-QC / retry / repealed-mix subset member)
6. remainder

## Summary

Status transitions (v4 → v5): generated -> generated 45 · needs-map-revision -> generated 35

V5 revision-consistency buckets (target zero): generatedWithBroadWarning 0 · generatedWithSuggestion 0 · needsRevisionWithContradictoryReason 0 · needsRevisionWithoutBroadWarning 0 · needsRevisionWithoutSuggestion 0

OCR artifacts present — v4 job exactSourceText: true · v4 evidence union: true · v5 evidence union: true

Tier counts: T3 35 · T5 17 · T6 28

## Tier 1 — v5-failure (0)

_no rows_

## Tier 2 — v5-needs-revision (0)

_no rows_

## Tier 3 — status-change (35)

| seq | v4JobId | v5JobId | docs | P | v4 → v5 status | warn v4/v5 | att v4/v5 | title |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| 3 | `unit-02c1922ab2c2961a` | `unit-5ba258431f90f343` | section:40 | P3 | needs-map-revision → generated | 0/0 | 1/2 | Release, handling and disposal of contaminants and waste… |
| 4 | `unit-9ceefa172c31deea` | `unit-fcc8bb2c8653b95d` | section:40 | P3 | needs-map-revision → generated | 1/0 | 1/2 | Costs, claims, fees and inspectors |
| 6 | `unit-1d069dae182e4d4a` | `unit-332a2ef669d3f464` | section:13 | P3 | needs-map-revision → generated | 1/0 | 1/6 | Response to a possible future significant health risk |
| 9 | `unit-ea7e4c75c7a425ce` | `unit-79cacfaeddf74f82` | section:13 | P3 | needs-map-revision → generated | 0/0 | 1/2 | No person shall supply water posing a significant health… |
| 10 | `unit-892e38efffb31976` | `unit-6480451b3fe42be2` | section:1 | P2 | needs-map-revision → generated | 1/0 | 1/2 | Land, shore and watercourse definitions |
| 11 | `unit-b176ebe94507fd17` | `unit-c562d9132d24d3e6` | section:1 | P2 | needs-map-revision → generated | 0/0 | 1/2 | Trespass, actor and enforcement definitions |
| 15 | `unit-2f3e7edff1d80df7` | `unit-6e340018655584a7` | section:66 | P3 | needs-map-revision → generated | 0/0 | 1/1 | Retaining registry office fees and the dismissal penalty |
| 16 | `unit-15fa5c5ac251dfa1` | `unit-d0fd18f6457af793` | section:68 | P4 | needs-map-revision → generated | 1/0 | 1/1 | Health regions, inspectors and notifiable disease regula… |
| 17 | `unit-6a94737b69e069ce` | `unit-e944b3a49f4b9bac` | section:68 | P4 | needs-map-revision → generated | 1/0 | 2/2 | Water supply, water circulation and sewage regulations |
| 20 | `unit-dc58323956b9fd42` | `unit-f91b57371792a0bb` | section:90 | P3 | needs-map-revision → generated | 1/0 | 2/1 | Aquaculture regulatory subjects |
| 21 | `unit-047b933c1567c5dd` | `unit-ab80c5ba40812a83` | section:15.3 | P2 | needs-map-revision → generated | 0/0 | 1/2 | Phased assessment calculation formula |
| 23 | `unit-019c765ae138d8b5` | `unit-1778139a242e733a` | section:75 | P1 | needs-map-revision → generated | 1/0 | 1/2 | Facilities requirements and development-officer approval… |
| 26 | `unit-023c1a4ddb31e2c5` | `unit-9444b4424f6fa00b` | section:100 | P2 | needs-map-revision → generated | 0/0 | 1/2 | Licence fee on conviction deemed part of fine |
| 27 | `unit-5fadda40929f11f0` | `unit-99bdb6cd6f15f777` | section:9 | P2 | needs-map-revision → generated | 1/0 | 2/3 | Specific operational duties of the employer |
| 28 | `unit-5d2a9f36002162d0` | `unit-71e27c24590d3242` | section:44 | P1 | needs-map-revision → generated | 1/0 | 1/2 | Mortgagee's Statutory Powers under Deed Mortgage (s.44) |
| 29 | `unit-c7dc47a1735eb69d` | `unit-90ab6499b6928ad2` | section:44 | P2 | needs-map-revision → generated | 0/0 | 1/1 | Out-of-Province Instrument Execution and Certification |
| 31 | `unit-e60f2ed653e5363a` | `unit-c9285cd7f533a2ab` | section:1 | P2 | needs-map-revision → generated | 0/0 | 1/2 | Definitions in the Surveys Act |
| 32 | `unit-21c62d64fd32c92f` | `unit-5eefb3ed8c3ce251` | section:18 | P1 | needs-map-revision → generated | 1/0 | 1/2 | Cancelling and issuing certificates of registered owners… |
| 35 | `unit-00066425d3dd3645` | `unit-dc047ee16ef0e408` | section:125 | P2 | needs-map-revision → generated | 0/0 | 1/2 | Zoning regulation effect and deemed powers (s.125(8)–(9)… |
| 36 | `unit-79f54c297756d4aa` | `unit-331f33e0d3cf5b61` | section:26 | P1 | needs-map-revision → generated | 0/0 | 2/3 | Offence and penalties for unregistered practice as a lan… |
| 39 | `unit-009ff72aba3f0d45` | `unit-aef7b1dd69abc34d` | section:6.5.1, section:6.5.2 | P4 | needs-map-revision → generated | 0/0 | 2/1 | Legislative Review Committee: Establishment, Responsibil… |
| 40 | `unit-0070dd224c8bb7a5` | `unit-29643f0abdec17e2` | section:80 | P1 | needs-map-revision → generated | 0/0 | 1/1 | Registration and assurance fees payable to the registrar |
| 41 | `unit-0167053e440a24d5` | `unit-06c54db68969cc17` | section:36 | P2 | needs-map-revision → generated | 2/0 | 1/1 | Prohibitions on parties and witness requirement for affi… |
| 46 | `unit-0445d8337e77a7c6` | `unit-d6fe427cdddb2678` | section:24(1) | P3 | needs-map-revision → generated | 0/0 | 2/2 | Parties to Discipline Committee Proceedings |
| 48 | `unit-0421d4fe4b51ed92` | `unit-f821944f8d8fad87` | section:1 | P1 | needs-map-revision → generated | 1/0 | 1/2 | Boundaries Confirmation Act – Defined Terms |
| 49 | `unit-00cb6e97353458dc` | `unit-c1d2d8aa37da6862` | section:28 | P2 | needs-map-revision → generated | 0/0 | 2/3 | Local government or other taxing authority appeal to the… |
| 50 | `unit-046240c47aa8f95b` | `unit-10ea21c46affc7c5` | section:13.2 | P3 | needs-map-revision → generated | 0/0 | 1/2 | Electronic Information Storage System Equivalence Rules |
| 54 | `unit-06587c365a55bf49` | `unit-373539bbe31a52a0` | section:7 | P4 | needs-map-revision → generated | 0/0 | 1/2 | Seal of office requirement |
| 56 | `unit-02c520678fcbb6c2` | `unit-6f829d029f76db6e` | section:65 | P2 | needs-map-revision → generated | 0/0 | 1/1 | Fee payment as precondition to compulsory registration |
| 57 | `unit-043b932fc33b70cc` | `unit-a8250bc79883184c` | section:6 | P1 | needs-map-revision → generated | 1/0 | 1/2 | Division of units into classes |
| 59 | `unit-0449049d27b547c9` | `unit-46404e08436c89a4` | section:88 | P1 | needs-map-revision → generated | 1/0 | 1/1 | Factors for Advisory Committee or Regional Service Commi… |
| 61 | `unit-05d777e3d32ca761` | `unit-2588ae34a152982f` | section:17 | P1 | needs-map-revision → generated | 1/0 | 1/2 | Officer's costs direction to expropriating authority |
| 67 | `unit-092be74ad4e22fc6` | `unit-857a98ccd36e41e4` | section:96 | P1 | needs-map-revision → generated | 0/0 | 1/1 | Mandatory contents of the incentive or bonus zoning by-l… |
| 70 | `unit-07fa6fc1208594ca` | `unit-0344f31b1107b2dc` | section:18(2) | P2 | needs-map-revision → generated | 0/0 | 5/2 | Conditions for entering a name in the register |
| 71 | `unit-0de35b1dafe93ecb` | `unit-25db06191c729425` | section:37 | P1 | needs-map-revision → generated | 0/0 | 1/2 | Additional 5% compensation for Lieutenant-Governor in Co… |

### T3 · seq 3 — Release, handling and disposal of contaminants and wastes

v4 `unit-02c1922ab2c2961a` → v5 `unit-5ba258431f90f343` · docs section:40 · P P3
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: Under the Clean Water Act, what matters may the Lieutenant-Governor in Council regulate under section 40 concerning the release and handling of contaminants and wastes in water, the withdrawal and use…
v5 main question: What may the Lieutenant-Governor in Council regulate under Clean Water Act s. 40 concerning contaminants in water, the withdrawal and use of water, and standards for measuring contaminants?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED, warning:ANSWER_APPEARS_TRUNCATED, warning:ANSWER_APPEARS_TRUNCATED

### T3 · seq 4 — Costs, claims, fees and inspectors

v4 `unit-9ceefa172c31deea` → v5 `unit-fcc8bb2c8653b95d` · docs section:40 · P P3
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: Under the Clean Water Act, what administrative matters may the Lieutenant-Governor in Council address by regulation under section 40 with respect to cost recovery, the handling of claims, fees on regi…
v5 main question: Under section 40 of the Clean Water Act, what matters may the Lieutenant-Governor in Council regulate concerning cost recovery, claims, registration and permit fees, and the duties of inspectors and a…
v5 validation: none

### T3 · seq 6 — Response to a possible future significant health risk

v4 `unit-1d069dae182e4d4a` → v5 `unit-332a2ef669d3f464` · docs section:13 · P P3
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 6
v4 main question: What may the Minister or the Minister of Health do under s. 13(5) of the Clean Water Act where water may in the circumstances pose a significant health risk in the future, and what must any resulting …
v5 main question: When water may pose a future significant health risk, what order may a Minister make under the Clean Water Act and what must it ensure?
v5 validation: warning:POSSIBLE_MODALITY_MISMATCH, warning:POSSIBLE_MODALITY_MISMATCH

### T3 · seq 9 — No person shall supply water posing a significant health risk

v4 `unit-ea7e4c75c7a425ce` → v5 `unit-79cacfaeddf74f82` · docs section:13 · P P3
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under s.13(2) of the Clean Water Act, what conduct is prohibited with respect to water that poses a significant health risk, which water sources are covered by the prohibition, and which source is exc…
v5 main question: What does the Clean Water Act prohibit regarding the supply of water that poses a significant health risk, and what exception does it provide?
v5 validation: none

### T3 · seq 10 — Land, shore and watercourse definitions

v4 `unit-892e38efffb31976` → v5 `unit-6480451b3fe42be2` · docs section:1 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: How does the Trespass Act define the land and water features—forest land, freshwater and saltwater marshes, lake and ocean shore areas, sand dunes, and watercourses—that determine where the Act's prot…
v5 main question: What physical features and boundaries do the Trespass Act's definitions of forest land, freshwater marsh, saltwater marsh, lake shore area, ocean shore area, sand dune, and watercourse each establish?
v5 validation: none

### T3 · seq 11 — Trespass, actor and enforcement definitions

v4 `unit-b176ebe94507fd17` → v5 `unit-c562d9132d24d3e6` · docs section:1 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: What are the Trespass Act's definitions of trespass, premises, authorized person, driver, motor vehicle, and peace officer, and what does each term cover?
v5 main question: How does the Trespass Act define trespass, and what categories does it assign to premises, authorized persons, drivers, motor vehicles, and peace officers?
v5 validation: none

### T3 · seq 15 — Retaining registry office fees and the dismissal penalty

v4 `unit-2f3e7edff1d80df7` → v5 `unit-6e340018655584a7` · docs section:66 · P P3
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: Under section 66 of the Registry Act, which registry office personnel are barred from retaining for their own use fees received for work done or information furnished in connection with the registry o…
v5 main question: Who is barred from retaining registry office fees for personal use, and what penalty applies for a violation?
v5 validation: none

### T3 · seq 16 — Health regions, inspectors and notifiable disease regulations

v4 `unit-15fa5c5ac251dfa1` → v5 `unit-d0fd18f6457af793` · docs section:68 · P P4
v4: accepted · authoringStatus needs-map-revision · warnings OUTSIDE_APPROVED_FOCUS · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v4 main question: Under section 68 of the Public Health Act, what may the Lieutenant-Governor in Council prescribe by regulation regarding the duties and functions of inspectors, the reporting and control of notifiable…
v5 main question: What four regulatory subjects does Public Health Act section 68 allow the Lieutenant-Governor in Council to address by regulation?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED

### T3 · seq 17 — Water supply, water circulation and sewage regulations

v4 `unit-6a94737b69e069ce` → v5 `unit-e944b3a49f4b9bac` · docs section:68 · P P4
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 4 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: What water and sewage-related subjects may the Lieutenant-Governor in Council address by regulation under the Public Health Act?
v5 main question: What water supply, water circulation and sewage matters may the Lieutenant-Governor in Council address by regulation under section 68 of the Public Health Act?
v5 validation: none

### T3 · seq 20 — Aquaculture regulatory subjects

v4 `unit-dc58323956b9fd42` → v5 `unit-f91b57371792a0bb` · docs section:90 · P P3
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 4 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v4 main question: What may the Lieutenant-Governor in Council regulate under the Aquaculture Act regarding exemptions, aquaculture product standards, containment, and reportable conditions?
v5 main question: What regulatory subjects may the Lieutenant-Governor in Council address in regulations under Aquaculture Act s. 90(1), and what residual power does paragraph (jj) confer?
v5 validation: none

### T3 · seq 21 — Phased assessment calculation formula

v4 `unit-047b933c1567c5dd` → v5 `unit-ab80c5ba40812a83` · docs section:15.3 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: How is the assessment on a heritage property calculated in each of the four years following the base year under section 15.3(2) of the Assessment Act?
v5 main question: How is the assessment on a heritage property calculated over the four years following the base year under section 15.3(2) of the Assessment Act?
v5 validation: none

### T3 · seq 23 — Facilities requirements and development-officer approval conditions

v4 `unit-019c765ae138d8b5` → v5 `unit-1778139a242e733a` · docs section:75 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: Under a Community Planning Act subdivision by-law, what facilities may a council require of a person subdividing land, what two-part condition in the council's opinion gates the development officer's …
v5 main question: What facilities may a subdivision by-law require, and what conditions and refusal grounds may it impose on the development officer's approval of a subdivision plan?
v5 validation: none

### T3 · seq 26 — Licence fee on conviction deemed part of fine

v4 `unit-023c1a4ddb31e2c5` → v5 `unit-9444b4424f6fa00b` · docs section:100 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: When a person is convicted of doing something without a by-law licence, what may the judge of the Provincial Court order regarding the uncollected licence fee, and what is the legal character of that …
v5 main question: Under the Municipalities Act, what may a Provincial Court judge order when a person is convicted of acting without a licence required by a by-law, and how is that fee treated legally?
v5 validation: none

### T3 · seq 27 — Specific operational duties of the employer

v4 `unit-5fadda40929f11f0` → v5 `unit-99bdb6cd6f15f777` · docs section:9 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 5 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 3
v4 main question: What specific operational duties must an employer fulfill under the Occupational Health and Safety Act regarding workplace maintenance and inspection, hazard communication and employee education, supe…
v5 main question: What specific operational duties does section 9(2) of the Occupational Health and Safety Act impose on an employer, and how does the preamble to that subsection qualify its relationship to the general…
v5 validation: none

### T3 · seq 28 — Mortgagee's Statutory Powers under Deed Mortgage (s.44)

v4 `unit-5d2a9f36002162d0` → v5 `unit-71e27c24590d3242` · docs section:44 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: What powers of sale and fire insurance does the Property Act give a mortgagee under a deed mortgage, when may each be exercised, and how may the mortgage deed vary those powers?
v5 main question: What statutory powers does a mortgagee receive where the mortgage is made by deed under s. 44 of the Property Act, and how may the mortgage deed vary or limit those powers?
v5 validation: none

### T3 · seq 29 — Out-of-Province Instrument Execution and Certification

v4 `unit-c7dc47a1735eb69d` → v5 `unit-90ab6499b6928ad2` · docs section:44 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: Under the Registry Act, who is authorized to take acknowledgments and proofs of instrument execution out of the Province of New Brunswick, and what certification or authentication requirements attach …
v5 main question: Who may take an acknowledgment or proof of an instrument's execution out of the Province under the Registry Act, and what certification or authentication is required for each?
v5 validation: warning:UNSUPPORTED_NUMERIC_OR_REFERENCE, warning:UNSUPPORTED_NUMERIC_OR_REFERENCE

### T3 · seq 31 — Definitions in the Surveys Act

v4 `unit-e60f2ed653e5363a` → v5 `unit-c9285cd7f533a2ab` · docs section:1 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: What do the Surveys Act define as a surveyor, a survey, a legal monument, a corner, a coordinate monument, and a coordinate survey system?
v5 main question: State the meaning the Surveys Act assigns to each of the six defined terms: surveyor, legal monument, coordinate monument, coordinate survey system, corner, and survey.
v5 validation: none

### T3 · seq 32 — Cancelling and issuing certificates of registered ownership

v4 `unit-21c62d64fd32c92f` → v5 `unit-5eefb3ed8c3ce251` · docs section:18 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under section 18(5) of the Land Titles Act, what is the registrar's duty to cancel and reissue a certificate of registered ownership when a specified registration event occurs, and how does that duty …
v5 main question: Under section 18(5) of the Land Titles Act, what registration events trigger the registrar's duty to cancel and reissue a certificate of registered ownership, and what is that duty?
v5 validation: warning:UNSUPPORTED_NUMERIC_OR_REFERENCE

### T3 · seq 35 — Zoning regulation effect and deemed powers (s.125(8)–(9))

v4 `unit-00066425d3dd3645` → v5 `unit-dc047ee16ef0e408` · docs section:125 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: When a planning regulation under section 125 of the Community Planning Act is in effect, who acts as development officer, and what zoning powers—relating to particular land uses, proposed uses and var…
v5 main question: Under s.125(8) and (9), who is the development officer when a planning regulation is in effect, and what zoning powers are deemed vested in or may be vested in the regional service commission?
v5 validation: none

### T3 · seq 36 — Offence and penalties for unregistered practice as a land surveyor (s. 26)

v4 `unit-79f54c297756d4aa` → v5 `unit-331f33e0d3cf5b61` · docs section:26 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 3
v4 main question: What acts constitute an offence for a person not registered as a land surveyor under the New Brunswick Land Surveyors Act, 1986, and what tiered penalties does the Act prescribe?
v5 main question: What four acts constitute an offence under section 26 of the New Brunswick Land Surveyors Act, and what penalties apply for a first and a subsequent offence?
v5 validation: none

### T3 · seq 39 — Legislative Review Committee: Establishment, Responsibilities, and Annual Report

v4 `unit-009ff72aba3f0d45` → v5 `unit-aef7b1dd69abc34d` · docs section:6.5.1, section:6.5.2 · P P4
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v4 main question: What is the composition of the Legislative Review Committee, what are its three responsibilities, and by what date must it submit its annual report to the Executive Council under the ANBLS Bylaws?
v5 main question: What are the composition, three enumerated responsibilities, and annual reporting deadline of the Legislative Review Committee under the ANBLS Bylaws?
v5 validation: warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED

### T3 · seq 40 — Registration and assurance fees payable to the registrar

v4 `unit-0070dd224c8bb7a5` → v5 `unit-29643f0abdec17e2` · docs section:80 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v4 main question: Under the Land Titles Act, what prescribed fee must the registrar receive before registering an instrument or performing a duty, what additional assurance fee is required for indemnification claims, a…
v5 main question: What fees must be paid to the registrar under section 80 of the Land Titles Act, and when is the assurance fee not payable?
v5 validation: none

### T3 · seq 41 — Prohibitions on parties and witness requirement for affidavits of execution

v4 `unit-0167053e440a24d5` → v5 `unit-06c54db68969cc17` · docs section:36 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT, OUTSIDE_APPROVED_FOCUS · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v4 main question: Under section 36 of the Registry Act, what two things is a party to an instrument prohibited from doing in the execution and acknowledgment process, what must a witness have done before an affidavit o…
v5 main question: What is a party to an instrument prohibited from doing, and what must a witness have done before an affidavit or proof of execution may be taken from them?
v5 validation: warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:UNCOVERED_SUBSTANTIVE_SOURCE, warning:UNCOVERED_SUBSTANTIVE_SOURCE, warning:UNCOVERED_SUBSTANTIVE_SOURCE

### T3 · seq 46 — Parties to Discipline Committee Proceedings

v4 `unit-0445d8337e77a7c6` → v5 `unit-d6fe427cdddb2678` · docs section:24(1) · P P3
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 1 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 2
v4 main question: Under the New Brunswick Land Surveyors Act, who are the parties to proceedings before the Discipline Committee?
v5 main question: Who are the parties to proceedings before the Discipline Committee under the Land Surveyors Act?
v5 validation: none

### T3 · seq 48 — Boundaries Confirmation Act – Defined Terms

v4 `unit-0421d4fe4b51ed92` → v5 `unit-f821944f8d8fad87` · docs section:1 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: Under the Boundaries Confirmation Act, what do the terms boundary, parcel, monument, surveyor, applicant, Registrar General, and Deputy Registrar General mean, and how are the air space terms, plan of…
v5 main question: How does section 1 of the Boundaries Confirmation Act define the surveying terms, statutory actors, and cross-referenced instruments that govern the boundaries confirmation process?
v5 validation: none

### T3 · seq 49 — Local government or other taxing authority appeal to the Board (s. 28)

v4 `unit-00cb6e97353458dc` → v5 `unit-c1d2d8aa37da6862` · docs section:28 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 2 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 3
v4 main question: After the Director mails a notice to a local government or other taxing authority under subsection 25(5) of the Assessment Act, what may the authority do in response, within what time, and for what sc…
v5 main question: What are the trigger, deadline, and scope of a local government's or other taxing authority's right to appeal an assessment to the Board under section 28 of the Assessment Act?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED, warning:ANSWER_APPEARS_TRUNCATED

### T3 · seq 50 — Electronic Information Storage System Equivalence Rules

v4 `unit-046240c47aa8f95b` → v5 `unit-10ea21c46affc7c5` · docs section:13.2 · P P3
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: Under section 13.2 of the Registry Act, how is a requirement to make an entry in the registry book deemed to be met when the instrument or document is kept in an electronic information storage system,…
v5 main question: What rules does section 13.2 of the Registry Act establish for satisfying registry-book entry requirements through an electronic information storage system?
v5 validation: warning:UNSUPPORTED_NUMERIC_OR_REFERENCE

### T3 · seq 54 — Seal of office requirement

v4 `unit-06587c365a55bf49` → v5 `unit-373539bbe31a52a0` · docs section:7 · P P4
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 2
v4 main question: Under the Land Titles Act, who is required to hold a seal of office and which body must approve the form of that seal?
v5 main question: Under the Land Titles Act, who is required to have a seal of office, and what body must approve the form of that seal?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED, warning:ANSWER_APPEARS_TRUNCATED, warning:APPROVED_FOCUS_NOT_COVERED

### T3 · seq 56 — Fee payment as precondition to compulsory registration

v4 `unit-02c520678fcbb6c2` → v5 `unit-6f829d029f76db6e` · docs section:65 · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v4 main question: What condition must be satisfied before a registrar can be compelled to register an instrument under the Registry Act?
v5 main question: What condition must be satisfied before the registrar can be compelled to register an instrument under the Registry Act?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED, warning:ANSWER_APPEARS_TRUNCATED

### T3 · seq 57 — Division of units into classes

v4 `unit-043b932fc33b70cc` → v5 `unit-a8250bc79883184c` · docs section:6 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: How may a condominium declaration divide its units into classes, and what flexibility does that division give the declaration in structuring and applying its subsection (2) provisions?
v5 main question: What may a declaration provide about dividing units into classes, and what flexibility does class division create for applying subsection (2) provisions?
v5 validation: none

### T3 · seq 59 — Factors for Advisory Committee or Regional Service Commission Street Location Recommendation

v4 `unit-0449049d27b547c9` → v5 `unit-46404e08436c89a4` · docs section:88 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: What four categories of factors must an advisory committee or regional service commission give consideration to when recommending street locations under section 88 of the Community Planning Act?
v5 main question: When recommending street locations under s.88(4)(a), what four categories of factors must an advisory committee or regional service commission consider under the Community Planning Act?
v5 validation: none

### T3 · seq 61 — Officer's costs direction to expropriating authority

v4 `unit-05d777e3d32ca761` → v5 `unit-2588ae34a152982f` · docs section:17 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: In the Expropriation Act, what costs may the Officer direct an expropriating authority to pay a landowner who appeared on a hearing of objection, and what obligation does the expropriating authority b…
v5 main question: What costs direction may the Officer make to an expropriating authority for a landowner who appeared at a hearing of objection, and what are the amount cap and payment obligation?
v5 validation: none

### T3 · seq 67 — Mandatory contents of the incentive or bonus zoning by-law

v4 `unit-092be74ad4e22fc6` → v5 `unit-857a98ccd36e41e4` · docs section:96 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v4 main question: What four matters must an incentive or bonus zoning agreement by-law identify or set out under the Community Planning Act?
v5 main question: What four matters must an incentive or bonus zoning agreement by-law address under section 96(2) of the Community Planning Act?
v5 validation: none

### T3 · seq 70 — Conditions for entering a name in the register

v4 `unit-07fa6fc1208594ca` → v5 `unit-0344f31b1107b2dc` · docs section:18(2) · P P2
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 1 · attempts 5
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under the New Brunswick Land Surveyors Act, what conditions must be met before a name may be entered in the land surveyors' register?
v5 main question: What two conditions must be met before a name may be entered in the land surveyors' register under section 18(2) of the New Brunswick Land Surveyors Act?
v5 validation: none

### T3 · seq 71 — Additional 5% compensation for Lieutenant-Governor in Council-ordered surrender of possession

v4 `unit-0de35b1dafe93ecb` → v5 `unit-25db06191c729425` · docs section:37 · P P1
v4: accepted · authoringStatus needs-map-revision · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: What additional compensation must the expropriating authority pay an owner in occupation when the Lieutenant-Governor in Council orders surrender of physical possession of expropriated land under subs…
v5 main question: What additional compensation must the expropriating authority pay when the Lieutenant-Governor in Council orders an owner to surrender physical possession of expropriated land under section 37(4) of t…
v5 validation: none

## Tier 4 — warning-heavy (0)

_no rows_

## Tier 5 — named (17)

| seq | v4JobId | v5JobId | docs | P | v4 → v5 status | warn v4/v5 | att v4/v5 | title |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| 1 | `unit-40730d04faf14076` | `unit-e3f6eb223f9c6b22` | section:71 | P3 | generated → generated | 0/0 | 1/2 | Instrument form requirements and registrar acceptance di… |
| 2 | `unit-f1d3de4004dd0d17` | `unit-f463819104abd315` | section:71 | P3 | generated → generated | 0/0 | 2/1 | Registry administration regulation-making power (s. 71(1… |
| 5 | `unit-d9b1e53de714665c` | `unit-d4b1280dd51c16a3` | section:40 | P3 | generated → generated | 0/0 | 1/2 | Water classification of a watercourse |
| 7 | `unit-ad5f94891873617a` | `unit-6f65dea4a13630e9` | section:13 | P3 | generated → generated | 0/0 | 2/2 | Response to a current significant health risk |
| 8 | `unit-e9fe22342cc56c8a` | `unit-44a5e5a34f069c1d` | section:13 | P3 | generated → generated | 0/0 | 1/2 | Private well notice and application of order provisions |
| 12 | `unit-9aa4dea732c4bc43` | `unit-db1eb97629092cb5` | section:95 | P3 | generated → generated | 0/0 | 1/1 | Administration, advisory board and fees |
| 13 | `unit-de14b7aae121ea5a` | `unit-9ff278807624e3ae` | section:95 | P3 | generated → generated | 0/0 | 1/2 | Surveys, tenure and access to Crown Lands |
| 14 | `unit-df983b36ee36be82` | `unit-23337f055c22b192` | section:95 | P3 | generated → generated | 0/0 | 1/1 | Forest management, harvesting and royalties |
| 18 | `unit-fdccd69202d3a203` | `unit-d1742361c5ae3778` | section:68 | P4 | generated → generated | 0/0 | 1/2 | Food premises and food safety regulations |
| 19 | `unit-ade0ea76fa6d04ef` | `unit-bc439b485e0a8ce3` | section:90 | P3 | generated → generated | 0/0 | 1/3 | Incorporation by reference and application mechanics |
| 22 | `unit-2e7e67eb0f35fe35` | `unit-3e12091103f6ec16` | section:1 | P1 | generated → generated | 0/0 | 1/2 | Definition of "development" |
| 24 | `unit-143fc780953799e6` | `unit-aca8067647cbf88f` | section:52 | P3 | generated → generated | 0/0 | 1/2 | Rate-setting prohibition and Board authority |
| 25 | `unit-2eedbe7a21cb2c32` | `unit-da8aeea638cab3fd` | section:68 | P2 | generated → generated | 0/0 | 1/1 | Boundary survey requirement and exception for previously… |
| 30 | `unit-09121fea0dce567b` | `unit-addc04e113bb4ae1` | section:10 | P2 | generated → generated | 0/0 | 1/2 | Hearing parties and notice of hearing |
| 33 | `unit-806dcd5f7b8ca4e8` | `unit-bfebe45a58764cbf` | section:19 | P1 | generated → generated | 0/0 | 1/3 | Protective registration period for wills |
| 34 | `unit-24d4ce03d041f274` | `unit-061b46bb0538188c` | section:3 | P1 | generated → generated | 0/0 | 1/2 | Surveyor's Report Required Contents |
| 79 | `unit-0ff46d399379a99b` | `unit-c3d97c72d0c68c39` | section:1 | P1 | generated → generated | 0/0 | 1/1 | Injurious affection – taking and non-taking scenarios |

### T5 · seq 1 — Instrument form requirements and registrar acceptance discretion (ss. 71(2)-(3))

v4 `unit-40730d04faf14076` → v5 `unit-e3f6eb223f9c6b22` · docs section:71 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under the Registry Act, what matters may the Lieutenant-Governor in Council regulate about the form of registrable instruments, and under what condition may a registrar accept an instrument that does …
v5 main question: What may the Lieutenant-Governor in Council regulate about the form of registrable instruments, and under what condition may a registrar still accept a non-compliant instrument?
v5 validation: none

### T5 · seq 2 — Registry administration regulation-making power (s. 71(1))

v4 `unit-f1d3de4004dd0d17` → v5 `unit-f463819104abd315` · docs section:71 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v4 main question: For which aspects of registry office administration may the Lieutenant-Governor in Council make regulations under s. 71(1) of the Registry Act?
v5 main question: What matters may the Lieutenant-Governor in Council regulate for the administration of the registry office under section 71(1) of the Registry Act?
v5 validation: warning:UNSUPPORTED_NUMERIC_OR_REFERENCE

### T5 · seq 5 — Water classification of a watercourse

v4 `unit-d9b1e53de714665c` → v5 `unit-d4b1280dd51c16a3` · docs section:40 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: What regulatory matters may the Lieutenant-Governor in Council address by regulation to establish and operate a water classification system for watercourses?
v5 main question: What may the Lieutenant-Governor in Council regulate under the Clean Water Act to establish and operate a water classification system for watercourses?
v5 validation: none

### T5 · seq 7 — Response to a current significant health risk

v4 `unit-ad5f94891873617a` → v5 `unit-6f65dea4a13630e9` · docs section:13 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: Under the Clean Water Act, what orders must the Minister or the Minister of Health make, and what may they order the owner to do, when a contaminant makes water in a well or supply system a significan…
v5 main question: What orders must or may be made under Clean Water Act sections 13(3) and 13(4) when water poses a current significant health risk at the source or at the point of consumption?
v5 validation: none

### T5 · seq 8 — Private well notice and application of order provisions

v4 `unit-e9fe22342cc56c8a` → v5 `unit-44a5e5a34f069c1d` · docs section:13 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: What notice must the Minister of Health give the owner of a private well that poses a significant health risk, what liability protection follows from that notice, and which order-provision sections ap…
v5 main question: What notice must the Minister of Health give to a private well owner who faces a significant health risk, what liability limitation follows, and which order sections apply to an order made under secti…
v5 validation: none

### T5 · seq 12 — Administration, advisory board and fees

v4 `unit-9aa4dea732c4bc43` → v5 `unit-db1eb97629092cb5` · docs section:95 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v4 main question: What may the Lieutenant-Governor in Council regulate under the Crown Lands and Forests Act in respect of the Advisory Board's duties and procedures, the conduct of public auctions, calls for tenders a…
v5 main question: What may the Lieutenant-Governor in Council regulate under section 95 regarding the Advisory Board, public auctions and tenders, fees for Crown instruments, and the general administration of the Act?
v5 validation: none

### T5 · seq 13 — Surveys, tenure and access to Crown Lands

v4 `unit-de14b7aae121ea5a` → v5 `unit-9ff278807624e3ae` · docs section:95 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: What may the Lieutenant-Governor in Council regulate under section 95(1) of the Crown Lands and Forests Act with respect to surveys of Crown Lands, classes of leases, rights-of-way or easements, and p…
v5 main question: What regulatory matters concerning surveys, lease classes, rights-of-way, and access to Crown Lands may the Lieutenant-Governor in Council address under section 95 of the Crown Lands and Forests Act?
v5 validation: none

### T5 · seq 14 — Forest management, harvesting and royalties

v4 `unit-df983b36ee36be82` → v5 `unit-23337f055c22b192` · docs section:95 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v4 main question: Under section 95 of the Crown Lands and Forests Act, what may the Lieutenant-Governor in Council regulate concerning the manner and form of forest management instruments, the harvesting and removal of…
v5 main question: What forest management, harvesting, and royalty matters may the Lieutenant-Governor in Council regulate under section 95, and when may a royalty regulation operate retroactively?
v5 validation: none

### T5 · seq 18 — Food premises and food safety regulations

v4 `unit-fdccd69202d3a203` → v5 `unit-d1742361c5ae3778` · docs section:68 · P P4
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: What regulatory subjects may the Lieutenant-Governor in Council address through regulations under section 68 of the Public Health Act regarding food premises, food handling, food standards, and food l…
v5 main question: What matters relating to food premises and food safety may the Lieutenant-Governor in Council regulate under section 68?
v5 validation: none

### T5 · seq 19 — Incorporation by reference and application mechanics

v4 `unit-ade0ea76fa6d04ef` → v5 `unit-bc439b485e0a8ce3` · docs section:90 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 3
v4 main question: How may a regulation under the Aquaculture Act incorporate external codes or standards, vary its application to different persons, matters, or activities, and limit its scope as to time, place, or spe…
v5 main question: How may an aquaculture regulation incorporate external standards by reference, and how may its application be varied by person, matter, time, or place under section 90 of the Aquaculture Act?
v5 validation: none

### T5 · seq 22 — Definition of "development"

v4 `unit-2e7e67eb0f35fe35` → v5 `unit-3e12091103f6ec16` · docs section:1 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under the Community Planning Act, what activities constitute "development," and what specific exclusions apply to utility infrastructure and Pipeline Act pipelines?
v5 main question: What are the four categories of activity that constitute "development" under section 1(1) of the Community Planning Act, and what specific exclusions and exceptions apply?
v5 validation: warning:DEFINITION_ANSWER_MISSING_TERM_MEANING, warning:UNSUPPORTED_NUMERIC_OR_REFERENCE

### T5 · seq 24 — Rate-setting prohibition and Board authority

v4 `unit-143fc780953799e6` → v5 `unit-aca8067647cbf88f` · docs section:52 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 5 · attempts 2
v4 main question: How does the Gas Distribution Act restrict gas distributor charges and define the Board's power to approve, fix, or substitute gas distribution rates?
v5 main question: Under the Gas Distribution Act, what must a gas distributor do before charging for distribution, and what rate-setting powers does the Board hold over distributors and their customers?
v5 validation: none

### T5 · seq 25 — Boundary survey requirement and exception for previously surveyed boundaries

v4 `unit-2eedbe7a21cb2c32` → v5 `unit-da8aeea638cab3fd` · docs section:68 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: What boundary-survey condition must be satisfied before the Minister can grant a mining lease, and how does a previously approved and filed survey change the obligation?
v5 main question: What boundary-survey condition must be met before a mining lease can be granted, and when is a new survey of those boundaries not required?
v5 validation: none

### T5 · seq 30 — Hearing parties and notice of hearing

v4 `unit-09121fea0dce567b` → v5 `unit-addc04e113bb4ae1` · docs section:10 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: In a boundary confirmation hearing under the Boundaries Confirmation Act, who are the parties to the hearing, whom must the Registrar General send the notice of hearing to, and what information must t…
v5 main question: Under the Boundaries Confirmation Act, who are the parties to a section 10 hearing and what must the Registrar General's notice of hearing contain?
v5 validation: warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:UNCOVERED_SUBSTANTIVE_SOURCE, warning:UNCOVERED_SUBSTANTIVE_SOURCE, warning:UNCOVERED_SUBSTANTIVE_SOURCE

### T5 · seq 33 — Protective registration period for wills

v4 `unit-806dcd5f7b8ca4e8` → v5 `unit-bfebe45a58764cbf` · docs section:19 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 3
v4 main question: How long does the Registry Act allow for registering a will depending on where the testator died, and what validity does registration within that period confer as against subsequent parties?
v5 main question: What timeframes does s.19(5) of the Registry Act set for registering a will depending on the testator's place of death, and what is the effect of timely registration?
v5 validation: none

### T5 · seq 34 — Surveyor's Report Required Contents

v4 `unit-24d4ce03d041f274` → v5 `unit-061b46bb0538188c` · docs section:3 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: What four components must a surveyor's report contain when submitted with a boundary confirmation application under REGULATION 95-166?
v5 main question: What four elements must a surveyor's report contain under section 3(4) of Regulation 95-166?
v5 validation: none

### T5 · seq 79 — Injurious affection – taking and non-taking scenarios

v4 `unit-0ff46d399379a99b` → v5 `unit-c3d97c72d0c68c39` · docs section:1 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v4 main question: Under the Expropriation Act, what are the two distinct scenarios that constitute 'injurious affection' to land, and under what circumstances is part of an owner's land deemed to have been taken for pu…
v5 main question: What elements constitute injurious affection under the Expropriation Act in the taking and non-taking scenarios, and when is part of an owner's land deemed taken?
v5 validation: warning:DEFINITION_ANSWER_MISSING_TERM_MEANING

## Tier 6 — remainder (28)

| seq | v4JobId | v5JobId | docs | P | v4 → v5 status | warn v4/v5 | att v4/v5 | title |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| 37 | `unit-a795aa5cbc9d3ee6` | `unit-4a0b1236f21e2add` | section:16(2), section:17(1) | P2 | generated → generated | 0/0 | 1/2 | Practice by partnerships, associations of persons, and c… |
| 38 | `unit-02657c4c14328d82` | `unit-051f5db2729fd7b5` | section:43 | P3 | generated → generated | 0/0 | 1/2 | Sufficient evidence of due execution: court and corporat… |
| 42 | `unit-02dbce06a699d0b3` | `unit-c42303371eff91ee` | section:42 | P3 | generated → generated | 0/0 | 1/2 | No separate verification of seal or signing officer requ… |
| 43 | `unit-022c7285b5e97c06` | `unit-7071b6becf15d8dd` | section:11(3) | P4 | generated → generated | 0/0 | 2/3 | AGM Election Terms and Council Replacement Mechanism |
| 44 | `unit-03718a2726419ffc` | `unit-762098496a0f61e2` | section:80 | P1 | generated → generated | 0/0 | 1/1 | Accounting for received monies and indemnification fundi… |
| 45 | `unit-00786855a793bc06` | `unit-d5879f27382ec6c0` | section:71.2 | P2 | generated → generated | 0/0 | 1/2 | Minister's enforcement entry and compliance actions |
| 47 | `unit-057a72bc46425aef` | `unit-7558538d3d98f4ec` | section:184 | P4 | generated → generated | 0/0 | 1/2 | Municipal power to enter public beach development agreem… |
| 51 | `unit-09ba9569396ef78b` | `unit-672a50b20e2100c7` | section:140 | P4 | generated → generated | 0/0 | 1/2 | Clerk's duty to endorse precept on assessment roll |
| 52 | `unit-04cf30345017df39` | `unit-2b35539363c4ca36` | section:6 | P1 | generated → generated | 0/0 | 1/1 | General Hearing Procedure Rights |
| 53 | `unit-010c9353d8180812` | `unit-43ca148646a95bb4` | section:31 | P2 | generated → generated | 0/0 | 1/1 | Court power to consolidate proceedings |
| 55 | `unit-00100b7505527849` | `unit-35ce7d7fd6dd7714` | section:5 | P1 | generated → generated | 0/0 | 1/2 | Compensation for damage caused by entry |
| 58 | `unit-03de3fc357cb57a5` | `unit-edcb2e0c1740d2e0` | section:19.4 | P2 | generated → generated | 0/0 | 1/3 | Abbreviated judgment requirement for mixed-content judgm… |
| 60 | `unit-049d27943f637422` | `unit-4a8d142480162fe3` | schedule:schedule-d | P2 | generated → generated | 0/0 | 1/1 | Payment Default, Forfeiture, and Bankruptcy Triggers |
| 62 | `unit-05aad567930a651b` | `unit-10af6382f13ceccb` | section:74 | P2 | generated → generated | 0/0 | 1/1 | Award of indemnity: Registrar General determination, con… |
| 63 | `unit-07fded70d557bb42` | `unit-1eb95397b16fee29` | section:10 | P1 | generated → generated | 0/0 | 1/2 | Duty to arrange public hearing and effect of withdrawal … |
| 64 | `unit-05e06222bdb9d406` | `unit-4a5095dd82b864af` | schedule:schedule-d | P2 | generated → generated | 0/0 | 1/2 | Transfer Restrictions and End-of-Lease Obligations |
| 65 | `unit-08d0057dc07a46d5` | `unit-819e6b3baa157e85` | section:84 | P1 | generated → generated | 0/0 | 1/2 | Required contents of a subdivision plan |
| 66 | `unit-064dc209bd43e63c` | `unit-9b9c904f7abb2dd1` | section:2.2.2 | P2 | generated → generated | 0/0 | 1/2 | Reapplication after resignation in good standing or clas… |
| 68 | `unit-07144e70868a71ec` | `unit-7e2875b9ce2c697e` | section:26 | P2 | generated → generated | 0/0 | 1/2 | Registration of probated and sealed will documents witho… |
| 69 | `unit-0c0bbda20e7199b5` | `unit-3b4bf8fc454f19b9` | section:44 | P1 | generated → generated | 0/0 | 1/2 | Consent threshold and Director's correction power for de… |
| 72 | `unit-08f6d682936a16dc` | `unit-5abf688ab972bffc` | section:12(2) | P2 | generated → generated | 0/0 | 2/2 | Composition and term of the Board of Examiners |
| 73 | `unit-0f35a3d73578f1dc` | `unit-9bdb6067e6efb48a` | section:1 | P1 | generated → generated | 0/0 | 1/2 | Prescriptive protection for claims to profits or benefit… |
| 74 | `unit-01074d54d55e4fde` | `unit-80309b578879a269` | section:50 | P2 | generated → generated | 0/0 | 1/1 | Pre-offer notice requirements and adverse-party protecti… |
| 75 | `unit-04e2ecadf458dfc2` | `unit-433e77a5dad8ceb1` | section:73 | P1 | generated → generated | 0/0 | 1/2 | Indemnification on rectification – entitlement, exceptio… |
| 76 | `unit-01114cfaf3709c7d` | `unit-14777ad1e4786447` | section:38.1 | P2 | generated → generated | 0/0 | 1/1 | Grounds for court-ordered mortgage discharge |
| 77 | `unit-38731a2761d264ad` | `unit-cbd8f515a08077d2` | section:6 | P1 | generated → generated | 0/0 | 1/2 | Block Size Limits and Crescent/Cul-de-Sac Exception |
| 78 | `unit-098b09224e6386c2` | `unit-7131c6fd16823e70` | section:40 | P2 | generated → generated | 0/0 | 1/2 | Non-severance of joint tenancy by judgment registration |
| 80 | `unit-01093fbff98ef4eb` | `unit-1a102fb69ea9b08b` | section:14 | P2 | generated → generated | 0/0 | 1/2 | Effect of discovering a later or valid will on prior act… |

### T6 · seq 37 — Practice by partnerships, associations of persons, and corporations

v4 `unit-a795aa5cbc9d3ee6` → v5 `unit-4a0b1236f21e2add` · docs section:16(2), section:17(1) · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: What types of non-individual entities may be permitted to practice land surveying under the New Brunswick Land Surveyors Act, and what may Council authorize members of the Association to do with respe…
v5 main question: Under the New Brunswick Land Surveyors Act, which non-individual entities may practice land surveying, and what role does the Council play in authorizing them?
v5 validation: none

### T6 · seq 38 — Sufficient evidence of due execution: court and corporate seals

v4 `unit-02657c4c14328d82` → v5 `unit-051f5db2729fd7b5` · docs section:43 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: For the purpose of registration, what constitutes sufficient evidence of due execution when an instrument bears the seal of a court of record or the seal of a corporation, and what carve-out does the …
v5 main question: What evidence suffices to prove due execution for registration when an instrument bears a court of record seal or a corporate seal, and what carve-out applies to sheriff's conveyances?
v5 validation: none

### T6 · seq 42 — No separate verification of seal or signing officer required for registration

v4 `unit-02dbce06a699d0b3` → v5 `unit-c42303371eff91ee` · docs section:42 · P P3
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: For the purpose of registration under the Registry Act, what verification of a seal or of the signature and office of the person before whom an acknowledgment or affidavit is made is not required, and…
v5 main question: What does the Registry Act dispense with regarding proof of seal and verification of the signing officer for registration of acknowledgments and affidavits?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED

### T6 · seq 43 — AGM Election Terms and Council Replacement Mechanism

v4 `unit-022c7285b5e97c06` → v5 `unit-7071b6becf15d8dd` · docs section:11(3) · P P4
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 3
v4 main question: What terms of office apply to the officers and executive council members of the Association of New Brunswick Land Surveyors elected at the annual general meeting, and how are replacement members elect…
v5 main question: At the AGM of the Association of New Brunswick Land Surveyors, what terms are prescribed for elected officers and executive council members, and how are replacement council members elected?
v5 validation: none

### T6 · seq 44 — Accounting for received monies and indemnification funding

v4 `unit-03718a2726419ffc` → v5 `unit-762098496a0f61e2` · docs section:80 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v4 main question: What accounting and remittance duty does the Land Titles Act impose on each registrar regarding monies received, and from which sources must indemnification payments be made when the dedicated fund is…
v5 main question: What accounting and payment duty does section 80(7) of the Land Titles Act impose on each registrar, and from what sources are indemnification payments made under subsections 80(8) and 80(9)?
v5 validation: none

### T6 · seq 45 — Minister's enforcement entry and compliance actions

v4 `unit-00786855a793bc06` → v5 `unit-d5879f27382ec6c0` · docs section:71.2 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: What enforcement entry powers and specific compliance actions does the Minister have under section 71.2 of the Crown Lands and Forests Act when a person fails to comply with an order to comply?
v5 main question: What enforcement power and specific actions does the Minister have under the Crown Lands and Forests Act when a person fails or refuses to comply with an order to comply?
v5 validation: none

### T6 · seq 47 — Municipal power to enter public beach development agreements

v4 `unit-057a72bc46425aef` → v5 `unit-7558538d3d98f4ec` · docs section:184 · P P4
v4: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 2
v4 main question: Under section 184 of the Municipalities Act, what agreement-making power does a municipality have regarding the development of a public beach, and with whom may it exercise that power?
v5 main question: What may a municipality do under section 184 of the Municipalities Act regarding public beach development?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED, warning:ANSWER_APPEARS_TRUNCATED

### T6 · seq 51 — Clerk's duty to endorse precept on assessment roll

v4 `unit-09ba9569396ef78b` → v5 `unit-672a50b20e2100c7` · docs section:140 · P P4
v4: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 2
v4 main question: Under the Municipalities Act, what must the clerk do with the precept on the assessment roll, and what determines the form of that precept?
v5 main question: Under section 140 of the Municipalities Act, what must the clerk endorse on the local improvement assessment roll, and what determines the required form?
v5 validation: warning:ANSWER_APPEARS_TRUNCATED, warning:ANSWER_APPEARS_TRUNCATED

### T6 · seq 52 — General Hearing Procedure Rights

v4 `unit-04cf30345017df39` → v5 `unit-2b35539363c4ca36` · docs section:6 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: What rights do the Registrar General and other parties have to introduce evidence, cross-examine witnesses, and be represented by counsel at a boundary confirmation hearing under Regulation 95-166?
v5 main question: What evidence, cross-examination, and counsel-representation rights do the Registrar General and parties have at a boundary confirmation hearing under Regulation 95-166?
v5 validation: none

### T6 · seq 53 — Court power to consolidate proceedings

v4 `unit-010c9353d8180812` → v5 `unit-43ca148646a95bb4` · docs section:31 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: Under the Expropriation Act, what may the Court do with proceedings, and what two conditions must it be of the opinion are met before doing so?
v5 main question: Under section 31(4) of the Expropriation Act, what may the Court do with any proceedings, and what two opinions must it hold before exercising that power?
v5 validation: warning:POSSIBLE_MODALITY_MISMATCH

### T6 · seq 55 — Compensation for damage caused by entry

v4 `unit-00100b7505527849` → v5 `unit-35ce7d7fd6dd7714` · docs section:5 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: What compensation duty does the Expropriation Act impose on a person who enters land under the section 5(1) entry power?
v5 main question: What compensation duty does Expropriation Act s. 5(3) impose on a person who enters land under s. 5(1), and what is the scope of damages covered?
v5 validation: none

### T6 · seq 58 — Abbreviated judgment requirement for mixed-content judgment registrations

v4 `unit-03de3fc357cb57a5` → v5 `unit-edcb2e0c1740d2e0` · docs section:19.4 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 3
v4 main question: When a section 40 registration application involves a judgment that partly affects an interest in or title to land or requires payment of money and partly does not, what form must the annexed judgment…
v5 main question: What form must a mixed-content judgment take when annexed to a section 40 registration application under regulation 83-130, s. 19.4?
v5 validation: none

### T6 · seq 60 — Payment Default, Forfeiture, and Bankruptcy Triggers

v4 `unit-049d27943f637422` → v5 `unit-4a8d142480162fe3` · docs schedule:schedule-d · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: What may the lessor do under Schedule D when the lessee is in payment default, and what events accelerate four months' rent and allow the lessor to forfeit and re-enter the demised premises?
v5 main question: What may a lessor recover from a lessee in payment default under Schedule D, and which events make four months' rent immediately due with forfeiture and re-entry rights?
v5 validation: warning:UNSUPPORTED_NUMERIC_OR_REFERENCE

### T6 · seq 62 — Award of indemnity: Registrar General determination, conditions, and court fallback

v4 `unit-05aad567930a651b` → v5 `unit-10af6382f13ceccb` · docs section:74 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v4 main question: Under section 74 of the Land Titles Act, what may the Registrar General do upon a claimant's application, what conditions limit an indemnity award, and what recourse does the claimant have if no award…
v5 main question: What are the Registrar General's powers under section 74 of the Land Titles Act, and when may a claimant apply to the court for an indemnity award?
v5 validation: warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:UNCOVERED_SUBSTANTIVE_SOURCE, warning:UNCOVERED_SUBSTANTIVE_SOURCE

### T6 · seq 63 — Duty to arrange public hearing and effect of withdrawal of all objections

v4 `unit-07fded70d557bb42` → v5 `unit-1eb95397b16fee29` · docs section:10 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under section 10 of the Expropriation Act, what conditions require the Officer to arrange a public hearing for a proposed expropriation, and what is the effect on that hearing when every satisfied not…
v5 main question: When must the Officer arrange a public hearing for a proposed expropriation, and what must the Officer do when all satisfied objections are withdrawn after a hearing has been arranged?
v5 validation: none

### T6 · seq 64 — Transfer Restrictions and End-of-Lease Obligations

v4 `unit-05e06222bdb9d406` → v5 `unit-4a5095dd82b864af` · docs schedule:schedule-d · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: Under Schedule D of Regulation 83-130, what consent must a lessee obtain before assigning or subletting the demised premises, what possession must the lessee deliver at the end of the lease, on what t…
v5 main question: What do Schedule D's statutory lease covenants require regarding the lessee's transfer of the demised premises, delivery of vacant possession, the lessor's entry to show the premises, and removal of f…
v5 validation: none

### T6 · seq 65 — Required contents of a subdivision plan

v4 `unit-08d0057dc07a46d5` → v5 `unit-819e6b3baa157e85` · docs section:84 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 5 · attempts 2
v4 main question: What items must a subdivision plan set out under the Community Planning Act, and what boundary measurements are required for streets and parcels?
v5 main question: What items must a subdivision plan set out under s. 84(3), and what boundary data must be shown for circular curves under s. 84(4)?
v5 validation: warning:UNSUPPORTED_NUMERIC_OR_REFERENCE, warning:UNSUPPORTED_NUMERIC_OR_REFERENCE, warning:UNSUPPORTED_NUMERIC_OR_REFERENCE, warning:UNSUPPORTED_NUMERIC_OR_REFERENCE, warning:UNSUPPORTED_NUMERIC_OR_REFERENCE, warning:UNSUPPORTED_NUMERIC_OR_REFERENCE

### T6 · seq 66 — Reapplication after resignation in good standing or classification change

v4 `unit-064dc209bd43e63c` → v5 `unit-9b9c904f7abb2dd1` · docs section:2.2.2 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under the Association of New Brunswick Land Surveyors Bylaws, what reapplication pathway is available to a previously registered surveyor who has resigned in good standing or changed classification?
v5 main question: Under section 2.2.2 of the ANBLS Bylaws, what conditions allow a previously registered surveyor to reapply, and what procedure governs the reapplication?
v5 validation: warning:POSSIBLE_MODALITY_MISMATCH

### T6 · seq 68 — Registration of probated and sealed will documents without further proof

v4 `unit-07144e70868a71ec` → v5 `unit-7e2875b9ce2c697e` · docs section:26 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Which probate-related documents may be registered in a New Brunswick county registry office without further proof under section 26 of the Registry Act, and what sealing condition must be satisfied for…
v5 main question: Under section 26 of the Registry Act, what probate-related documents may be registered in a county registry office without further proof, and what sealing condition applies to foreign probate document…
v5 validation: none

### T6 · seq 69 — Consent threshold and Director's correction power for description amendments

v4 `unit-0c0bbda20e7199b5` → v5 `unit-3b4bf8fc454f19b9` · docs section:44 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: What consent is required to amend a registered condominium description, and how does the Director's independent power to correct clerical errors bypass that requirement and the normal registration-sub…
v5 main question: How does the Condominium Property Act regulate the consent required to amend a registered description, and what independent correction power does the Director hold?
v5 validation: none

### T6 · seq 72 — Composition and term of the Board of Examiners

v4 `unit-08f6d682936a16dc` → v5 `unit-5abf688ab972bffc` · docs section:12(2) · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 2
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: Under the New Brunswick Land Surveyors Act, how is the Board of Examiners constituted, who appoints its additional members, and what term and reappointment rules apply to those members?
v5 main question: What are the composition, appointing authority, term of office, and reappointment rules for the Board of Examiners under section 12(2) of the New Brunswick Land Surveyors Act?
v5 validation: none

### T6 · seq 73 — Prescriptive protection for claims to profits or benefits (30-year and 60-year thresholds)

v4 `unit-0f35a3d73578f1dc` → v5 `unit-9bdb6067e6efb48a` · docs section:1 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: How does section 1 of the Easements Act protect a claim to a profit or benefit taken or enjoyed from Crown or privately owned land, and at what durations of uninterrupted enjoyment does that protectio…
v5 main question: What thresholds of uninterrupted taking and enjoyment protect a claim to a profit or benefit from Crown or private land under the Easements Act, and what limits attach to each threshold?
v5 validation: none

### T6 · seq 74 — Pre-offer notice requirements and adverse-party protections

v4 `unit-01074d54d55e4fde` → v5 `unit-80309b578879a269` · docs section:50 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 1
v4 main question: Under section 50 of the Evidence Act, what procedural steps must the offering party complete before tendering a written report or finding of facts, and what protection does the adverse party retain if…
v5 main question: Under s. 50(2), what pre-offer notice and disclosure duties apply to a party tendering an expert report in evidence, and what cross-examination and unavailability rights does s. 50(3) give the adverse…
v5 validation: warning:APPROVED_FOCUS_NOT_COVERED, warning:APPROVED_FOCUS_NOT_COVERED, warning:POSSIBLE_MODALITY_MISMATCH, warning:POSSIBLE_MODALITY_MISMATCH, warning:UNCOVERED_SUBSTANTIVE_SOURCE, warning:UNCOVERED_SUBSTANTIVE_SOURCE

### T6 · seq 75 — Indemnification on rectification – entitlement, exceptions, and forged dispositions

v4 `unit-04e2ecadf458dfc2` → v5 `unit-433e77a5dad8ceb1` · docs section:73 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 4 · attempts 2
v4 main question: Under section 73 of the Land Titles Act, what categories of damage entitle a person to indemnification, in which six cases is indemnification withheld, and how does the Act treat a good-faith purchase…
v5 main question: Under Land Titles Act s.73, what damage triggers the right to indemnification, what six exceptions limit it, and how does the s.73(2) deeming rule apply to a forged disposition?
v5 validation: none

### T6 · seq 76 — Grounds for court-ordered mortgage discharge

v4 `unit-01114cfaf3709c7d` → v5 `unit-14777ad1e4786447` · docs section:38.1 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v4 main question: Under what circumstances may a court, on application, permit payment into court and order a mortgage discharged under Property Act s. 38.1, and what distinct grounds apply where all money due on the m…
v5 main question: Under what circumstances may a court order a mortgage discharged, whether the mortgagor seeks to redeem or the money due has already been paid?
v5 validation: none

### T6 · seq 77 — Block Size Limits and Crescent/Cul-de-Sac Exception

v4 `unit-38731a2761d264ad` → v5 `unit-cbd8f515a08077d2` · docs section:6 · P P1
v4: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 2 · attempts 2
v4 main question: What are the required length range and minimum depth for a block in a proposed subdivision under Regulation 80-159, and under what conditions may a block exceed the maximum length?
v5 main question: What length and depth limits apply to a block under section 6 of Regulation 80-159, and when may a block exceed the maximum length?
v5 validation: none

### T6 · seq 78 — Non-severance of joint tenancy by judgment registration

v4 `unit-098b09224e6386c2` → v5 `unit-7131c6fd16823e70` · docs section:40 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 1 · attempts 2
v4 main question: Under the Land Titles Act, what is the effect of registering a judgment on a joint tenancy?
v5 main question: What does the Land Titles Act provide about the effect of registering a judgment on a joint tenancy in registered land?
v5 validation: none

### T6 · seq 80 — Effect of discovering a later or valid will on prior acts and recovery rights

v4 `unit-01093fbff98ef4eb` → v5 `unit-1a102fb69ea9b08b` · docs section:14 · P P2
v4: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 1
v5: accepted · authoringStatus generated · warnings — · objectives 3 · attempts 2
v4 main question: Under the Executors and Trustees Act, when a court has admitted a will to probate or made a grant of administration and it later appears that a different or superseding will existed or that the probat…
v5 main question: When a later or valid will is discovered after a grant of probate or administration, what is the legal effect on prior acts and what may the new personal representative recover under section 14 of the…
v5 validation: none

