# Exam Prep — Recognition quality audit

Deterministic mechanical audit of the frozen Recognition cue pool. Generated from the bundled curriculum manifest — no corpus revalidation, no content changes.

- curriculumId: `nb-sit-statute-exam-curriculum-v1`
- manifest contentHash: `434703f0a6de470095a5d0ad9fc6d1bb9534b15d58b1ab2b47460bba8a88952a`
- cues audited: 317 (expected 317)

## Summary

| Flag | Cues |
| --- | --- |
| duplicate cue instances (shared with another task) | 32 |
| duplicate cues across different expected units | 32 |
| very short (<=5 chars) | 10 |
| short NAV cues (<=3 words) | 114 |
| generic legal noun cue (exact normalized match) | 3 |
| long (>=80 chars) | 2 |
| expected across multiple documents | 119 |

## Per-cue audit

| Task id | Unit | Weight | Cue # | Chars | Words | Docs | Flags | Cue text |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recognition:A-NBLS-01:1 | A-NBLS-01 | high | 1 | 65 | 10 | 1 | ok | statute governing the practice of land surveying in New Brunswick |
| recognition:A-NBLS-01:2 | A-NBLS-01 | high | 2 | 55 | 6 | 1 | ok | professional/Association regulation of a surveying body |
| recognition:A-NBLS-06:1 | A-NBLS-06 | medium | 1 | 30 | 3 | 1 | ok | unauthorized practice offences |
| recognition:A-NBLS-06:2 | A-NBLS-06 | medium | 2 | 48 | 7 | 1 | ok | field access and property authority in surveying |
| recognition:A-BYL-01:1 | A-BYL-01 | high | 1 | 84 | 7 | 1 | >=80 chars | professional-association internal governance (membership, Council, committees, fees) |
| recognition:A-BYL-01:2 | A-BYL-01 | high | 2 | 50 | 7 | 1 | ok | bylaw part-numbered structure (e.g. 2.1, 3.1, 6.5) |
| recognition:A-BYL-04:1 | A-BYL-04 | medium | 1 | 47 | 6 | 1 | ok | governance bodies of a professional association |
| recognition:A-BYL-04:2 | A-BYL-04 | medium | 2 | 23 | 2 | 1 | ok | committee jurisdictions |
| recognition:A-SURV-01:1 | A-SURV-01 | high | 1 | 60 | 8 | 1 | ok | provincial statute on land surveying standards and monuments |
| recognition:A-SURV-01:2 | A-SURV-01 | high | 2 | 46 | 7 | 1 | ok | coordinate survey system / Director of Surveys |
| recognition:A-SURV-05:1 | A-SURV-05 | medium | 1 | 34 | 5 | 1 | ok | survey entry onto private property |
| recognition:A-SURV-05:2 | A-SURV-05 | medium | 2 | 44 | 6 | 1 | ok | offences and penalties in surveying statutes |
| recognition:A-BCA-01:1 | A-BCA-01 | high | 1 | 51 | 6 | 1 | ok | statute confirming disputed or uncertain boundaries |
| recognition:A-BCA-01:2 | A-BCA-01 | high | 2 | 57 | 5 | 1 | ok | application/objection/hearing process for land boundaries |
| recognition:A-CPA-01:1 | A-CPA-01 | medium | 1 | 38 | 3 | 1 | ok | provincial planning/zoning legislation |
| recognition:A-CPA-01:2 | A-CPA-01 | medium | 2 | 57 | 6 | 1 | ok | provincial-planning authority / regional planning context |
| recognition:A-CPA-02:1 | A-CPA-02 | medium | 1 | 36 | 5 | 1 | ok | zoning by-law / development controls |
| recognition:A-CPA-02:2 | A-CPA-02 | medium | 2 | 56 | 8 | 1 | ok | variances (minor variances / exemptions) in planning law |
| recognition:A-CPA-06:1 | A-CPA-06 | medium | 1 | 45 | 5 | 1 | ok | planning decision appeals (board/appeal body) |
| recognition:A-CPA-06:2 | A-CPA-06 | medium | 2 | 44 | 6 | 1 | ok | enforcement of planning and zoning decisions |
| recognition:A-REG-01:1 | A-REG-01 | high | 1 | 50 | 7 | 1 | ok | deeds-based / registry system of land registration |
| recognition:A-REG-01:2 | A-REG-01 | high | 2 | 58 | 7 | 1 | ok | registry office, registrar and registration of instruments |
| recognition:A-REG-04:1 | A-REG-04 | high | 1 | 86 | 10 | 1 | >=80 chars | registered land records beyond conveyances (plans, Crown grants, mortgages, judgments) |
| recognition:A-REG-05:1 | A-REG-05 | medium | 1 | 56 | 8 | 1 | ok | digital or digitally scanned instruments in the registry |
| recognition:A-REG-05:2 | A-REG-05 | medium | 2 | 54 | 5 | 1 | ok | subscriber/agreement pathway for electronic submission |
| recognition:A-REG-06:1 | A-REG-06 | medium | 1 | 42 | 5 | 1 | ok | registrar / registry office administration |
| recognition:A-REG-06:2 | A-REG-06 | medium | 2 | 26 | 4 | 1 | ok | official searches and fees |
| recognition:A-REGR-01:1 | A-REGR-01 | low | 1 | 45 | 5 | 1 | ok | formatting standards for registry instruments |
| recognition:A-REGR-01:2 | A-REGR-01 | low | 2 | 44 | 6 | 1 | ok | instrument size, margins and paper standards |
| recognition:A-LTA-01:1 | A-LTA-01 | high | 1 | 56 | 9 | 1 | ok | land titles / title insurance style registration of land |
| recognition:A-LTA-01:2 | A-LTA-01 | high | 2 | 40 | 6 | 1 | ok | Registrar General and the title register |
| recognition:A-LTA-03:1 | A-LTA-03 | high | 1 | 70 | 7 | 1 | ok | registered interests: transfers, easements, mortgages, leases, caveats |
| recognition:A-LTA-04:1 | A-LTA-04 | medium | 1 | 39 | 3 | 1 | ok | parcel consolidation/division mechanics |
| recognition:A-LTA-04:2 | A-LTA-04 | medium | 2 | 48 | 5 | 1 | ok | registration on death, expropriation, bankruptcy |
| recognition:A-LTA-07:1 | A-LTA-07 | medium | 1 | 58 | 6 | 1 | ok | supporting provisions: affidavits, records and regulations |
| recognition:A-LTR-03:1 | A-LTR-03 | medium | 1 | 49 | 7 | 1 | ok | land titles forms and schedules (fees, covenants) |
| recognition:B-AGRI-01:1 | B-AGRI-01 | medium | 1 | 28 | 3 | 1 | ok | registered agricultural land |
| recognition:B-AGRI-01:2 | B-AGRI-01 | medium | 2 | 36 | 4 | 1 | ok | agricultural land owners association |
| recognition:B-AGRI-01:3 | B-AGRI-01 | medium | 3 | 26 | 2 | 1 | ok | agricultural-land drainage |
| recognition:B-AGRI-01:4 | B-AGRI-01 | medium | 4 | 35 | 3 | 1 | ok | Ministerial land-use recommendation |
| recognition:B-CWA-01:1 | B-CWA-01 | medium | 1 | 11 | 1 | 1 | cross-unit duplicate cue of recognition:NAV-10:4 | watercourse |
| recognition:B-CWA-01:2 | B-CWA-01 | medium | 2 | 7 | 1 | 1 | cross-unit duplicate cue of recognition:NAV-10:3 | wetland |
| recognition:B-CWA-01:3 | B-CWA-01 | medium | 3 | 9 | 1 | 1 | ok | watershed |
| recognition:B-CWA-01:4 | B-CWA-01 | medium | 4 | 7 | 1 | 1 | ok | aquifer |
| recognition:B-CWA-01:5 | B-CWA-01 | medium | 5 | 12 | 2 | 1 | ok | water supply |
| recognition:B-CWA-01:6 | B-CWA-01 | medium | 6 | 4 | 1 | 1 | <=5 chars | well |
| recognition:B-CWA-01:7 | B-CWA-01 | medium | 7 | 18 | 2 | 1 | ok | drainage diversion |
| recognition:B-CWA-01:8 | B-CWA-01 | medium | 8 | 29 | 3 | 1 | ok | watercourse alteration permit |
| recognition:B-CLF-01:1 | B-CLF-01 | high | 1 | 10 | 2 | 1 | cross-unit duplicate cue of recognition:NAV-06:1 | Crown land |
| recognition:B-CLF-01:2 | B-CLF-01 | high | 2 | 11 | 2 | 1 | cross-unit duplicate cue of recognition:NAV-06:2, recognition:NAV-08:8, recognition:NAV-11:3 | Crown grant |
| recognition:B-CLF-01:3 | B-CLF-01 | high | 3 | 13 | 1 | 1 | ok | lease/licence |
| recognition:B-CLF-01:4 | B-CLF-01 | high | 4 | 37 | 4 | 1 | ok | right-of-way/easement over Crown land |
| recognition:B-CLF-01:5 | B-CLF-01 | high | 5 | 27 | 4 | 1 | ok | survey bordering Crown land |
| recognition:B-EVID-01:1 | B-EVID-01 | medium | 1 | 14 | 2 | 1 | ok | expert opinion |
| recognition:B-EVID-01:2 | B-EVID-01 | medium | 2 | 23 | 5 | 1 | ok | map or plan in evidence |
| recognition:B-EVID-01:3 | B-EVID-01 | medium | 3 | 16 | 3 | 1 | ok | record of survey |
| recognition:B-EVID-01:4 | B-EVID-01 | medium | 4 | 23 | 3 | 1 | ok | certified public record |
| recognition:B-EVID-01:5 | B-EVID-01 | medium | 5 | 26 | 2 | 1 | ok | electronic/business record |
| recognition:B-EVID-01:6 | B-EVID-01 | medium | 6 | 29 | 4 | 1 | ok | registered instrument or will |
| recognition:B-HWY-01:1 | B-HWY-01 | high | 1 | 16 | 2 | 1 | cross-unit duplicate cue of recognition:NAV-02:7 | highway boundary |
| recognition:B-HWY-01:2 | B-HWY-01 | high | 2 | 20 | 2 | 1 | ok | highway right-of-way |
| recognition:B-HWY-01:3 | B-HWY-01 | high | 3 | 19 | 2 | 1 | ok | highway designation |
| recognition:B-HWY-01:4 | B-HWY-01 | high | 4 | 25 | 2 | 1 | ok | controlled-access highway |
| recognition:B-HWY-01:5 | B-HWY-01 | high | 5 | 27 | 2 | 1 | ok | road closure/discontinuance |
| recognition:B-HWY-01:6 | B-HWY-01 | high | 6 | 16 | 2 | 1 | ok | development area |
| recognition:B-HWY-01:7 | B-HWY-01 | high | 7 | 17 | 3 | 1 | ok | access to highway |
| recognition:B-PW-01:1 | B-PW-01 | medium | 1 | 11 | 2 | 1 | cross-unit duplicate cue of recognition:NAV-07:5 | public work |
| recognition:B-PW-01:2 | B-PW-01 | medium | 2 | 23 | 2 | 1 | ok | government survey/entry |
| recognition:B-PW-01:3 | B-PW-01 | medium | 3 | 19 | 3 | 1 | ok | designation of land |
| recognition:B-PW-01:4 | B-PW-01 | medium | 4 | 28 | 3 | 1 | ok | public-work development area |
| recognition:B-PW-01:5 | B-PW-01 | medium | 5 | 12 | 1 | 1 | cross-unit duplicate cue of recognition:NAV-07:9 | compensation |
| recognition:C-AQUA-01:1 | C-AQUA-01 | low | 1 | 16 | 2 | 1 | ok | aquaculture site |
| recognition:C-AQUA-01:2 | C-AQUA-01 | low | 2 | 16 | 2 | 1 | ok | aquaculture land |
| recognition:C-AQUA-01:3 | C-AQUA-01 | low | 3 | 17 | 2 | 1 | ok | aquaculture lease |
| recognition:C-AQUA-01:4 | C-AQUA-01 | low | 4 | 29 | 4 | 1 | ok | aquaculture permit or licence |
| recognition:C-AQUA-01:5 | C-AQUA-01 | low | 5 | 27 | 3 | 1 | ok | aquaculture management area |
| recognition:C-ARCH-01:1 | C-ARCH-01 | medium | 1 | 25 | 3 | 1 | ok | historical public records |
| recognition:C-ARCH-01:2 | C-ARCH-01 | medium | 2 | 20 | 2 | 1 | ok | Provincial Archivist |
| recognition:C-ARCH-01:3 | C-ARCH-01 | medium | 3 | 37 | 5 | 1 | ok | public inspection of archival records |
| recognition:C-ARCH-01:4 | C-ARCH-01 | medium | 4 | 34 | 5 | 1 | ok | certified copies of public records |
| recognition:C-ARCH-01:5 | C-ARCH-01 | medium | 5 | 16 | 2 | 1 | ok | records schedule |
| recognition:C-BSHALE-01:1 | C-BSHALE-01 | low | 1 | 16 | 2 | 1 | cross-unit duplicate cue of recognition:NAV-06:8 | bituminous shale |
| recognition:C-BSHALE-01:2 | C-BSHALE-01 | low | 2 | 17 | 3 | 1 | ok | licence to search |
| recognition:C-BSHALE-01:3 | C-BSHALE-01 | low | 3 | 18 | 2 | 1 | ok | development permit |
| recognition:C-BSHALE-01:4 | C-BSHALE-01 | low | 4 | 22 | 3 | 1 | ok | bituminous shale lease |
| recognition:C-BSHALE-01:5 | C-BSHALE-01 | low | 5 | 32 | 6 | 1 | ok | right of entry for resource work |
| recognition:C-CEA-01:1 | C-CEA-01 | medium | 1 | 29 | 3 | 1 | ok | contaminated site designation |
| recognition:C-CEA-01:2 | C-CEA-01 | medium | 2 | 19 | 2 | 1 | ok | environmental order |
| recognition:C-CEA-01:3 | C-CEA-01 | medium | 3 | 24 | 4 | 1 | ok | release of a contaminant |
| recognition:C-CEA-01:4 | C-CEA-01 | medium | 4 | 36 | 5 | 1 | ok | wetland or coastal designation order |
| recognition:C-CEA-01:5 | C-CEA-01 | medium | 5 | 36 | 6 | 1 | ok | lien on land for environmental costs |
| recognition:C-CGR-01:1 | C-CGR-01 | medium | 1 | 22 | 3 | 1 | ok | historical Crown grant |
| recognition:C-CGR-01:2 | C-CGR-01 | medium | 2 | 9 | 1 | 1 | ok | quit-rent |
| recognition:C-CGR-01:3 | C-CGR-01 | medium | 3 | 22 | 4 | 1 | ok | restriction in a grant |
| recognition:C-CGR-01:4 | C-CGR-01 | medium | 4 | 40 | 6 | 1 | ok | release and waiver of grant restrictions |
| recognition:C-CGR-01:5 | C-CGR-01 | medium | 5 | 42 | 7 | 1 | ok | title research on old Crown grant language |
| recognition:C-DOE-01:1 | C-DOE-01 | medium | 1 | 36 | 6 | 1 | ok | devolution of real property on death |
| recognition:C-DOE-01:2 | C-DOE-01 | medium | 2 | 23 | 2 | 1 | ok | personal representative |
| recognition:C-DOE-01:3 | C-DOE-01 | medium | 3 | 43 | 6 | 1 | ok | executor or administrator dealing with land |
| recognition:C-DOE-01:4 | C-DOE-01 | medium | 4 | 22 | 4 | 1 | ok | registration of a will |
| recognition:C-DOE-01:5 | C-DOE-01 | medium | 5 | 9 | 1 | 1 | ok | intestacy |
| recognition:C-ETA-01:1 | C-ETA-01 | low | 1 | 17 | 2 | 1 | ok | electronic record |
| recognition:C-ETA-01:2 | C-ETA-01 | low | 2 | 20 | 2 | 1 | ok | electronic signature |
| recognition:C-ETA-01:3 | C-ETA-01 | low | 3 | 22 | 3 | 1 | ok | information in writing |
| recognition:C-ETA-01:4 | C-ETA-01 | low | 4 | 19 | 2 | 1 | ok | electronic original |
| recognition:C-ETA-01:5 | C-ETA-01 | low | 5 | 35 | 4 | 1 | ok | retention of electronic information |
| recognition:C-ESCH-01:1 | C-ESCH-01 | low | 1 | 7 | 1 | 1 | ok | escheat |
| recognition:C-ESCH-01:2 | C-ESCH-01 | low | 2 | 10 | 1 | 1 | ok | forfeiture |
| recognition:C-ESCH-01:3 | C-ESCH-01 | low | 3 | 24 | 5 | 1 | ok | land vested in the Crown |
| recognition:C-ESCH-01:4 | C-ESCH-01 | low | 4 | 24 | 4 | 1 | ok | grant of escheated lands |
| recognition:C-ESCH-01:5 | C-ESCH-01 | low | 5 | 22 | 3 | 1 | ok | relief from forfeiture |
| recognition:C-ETRUST-01:1 | C-ETRUST-01 | medium | 1 | 23 | 3 | 1 | ok | executor selling realty |
| recognition:C-ETRUST-01:2 | C-ETRUST-01 | medium | 2 | 28 | 3 | 1 | ok | administrator selling realty |
| recognition:C-ETRUST-01:3 | C-ETRUST-01 | medium | 3 | 34 | 7 | 1 | ok | sale of realty to satisfy a legacy |
| recognition:C-ETRUST-01:4 | C-ETRUST-01 | medium | 4 | 25 | 4 | 1 | ok | mortgage of estate realty |
| recognition:C-ETRUST-01:5 | C-ETRUST-01 | medium | 5 | 32 | 5 | 1 | ok | purchaser dealing with an estate |
| recognition:C-GAS-01:1 | C-GAS-01 | low | 1 | 23 | 3 | 1 | ok | gas distribution system |
| recognition:C-GAS-01:2 | C-GAS-01 | low | 2 | 25 | 3 | 1 | ok | gas distributor franchise |
| recognition:C-GAS-01:3 | C-GAS-01 | low | 3 | 36 | 5 | 1 | ok | underground storage facility for gas |
| recognition:C-GAS-01:4 | C-GAS-01 | low | 4 | 39 | 6 | 1 | ok | safety and inspection of gas facilities |
| recognition:C-GAS-01:5 | C-GAS-01 | low | 5 | 35 | 7 | 1 | ok | disposal or merger of a gas utility |
| recognition:C-MAR-01:1 | C-MAR-01 | medium | 1 | 12 | 2 | 1 | ok | marital home |
| recognition:C-MAR-01:2 | C-MAR-01 | medium | 2 | 27 | 4 | 1 | ok | spousal right to possession |
| recognition:C-MAR-01:3 | C-MAR-01 | medium | 3 | 28 | 4 | 1 | ok | division of marital property |
| recognition:C-MAR-01:4 | C-MAR-01 | medium | 4 | 40 | 5 | 1 | ok | registration of a marital-property order |
| recognition:C-MAR-01:5 | C-MAR-01 | medium | 5 | 5 | 1 | 1 | <=5 chars | dower |
| recognition:C-METRIC-01:1 | C-METRIC-01 | low | 1 | 17 | 2 | 1 | ok | metric conversion |
| recognition:C-METRIC-01:2 | C-METRIC-01 | low | 2 | 24 | 4 | 1 | ok | Canadian system of units |
| recognition:C-METRIC-01:3 | C-METRIC-01 | low | 3 | 34 | 5 | 1 | ok | International System of Units (SI) |
| recognition:C-METRIC-01:4 | C-METRIC-01 | low | 4 | 36 | 4 | 1 | ok | instrument designated for conversion |
| recognition:C-OHS-01:1 | C-OHS-01 | medium | 1 | 34 | 5 | 1 | ok | worksite safety policy and program |
| recognition:C-OHS-01:2 | C-OHS-01 | medium | 2 | 28 | 4 | 1 | ok | employer and employee duties |
| recognition:C-OHS-01:3 | C-OHS-01 | medium | 3 | 30 | 5 | 1 | ok | right to refuse dangerous work |
| recognition:C-OHS-01:4 | C-OHS-01 | medium | 4 | 26 | 3 | 1 | ok | reassignment after refusal |
| recognition:C-OHS-01:5 | C-OHS-01 | medium | 5 | 32 | 3 | 1 | ok | discriminatory action prohibited |
| recognition:C-OMIN-01:1 | C-OMIN-01 | medium | 1 | 40 | 6 | 1 | ok | mineral ownership separate from the soil |
| recognition:C-OMIN-01:2 | C-OMIN-01 | medium | 2 | 28 | 4 | 1 | ok | minerals beneath the surface |
| recognition:C-OMIN-01:3 | C-OMIN-01 | medium | 3 | 42 | 5 | 1 | ok | order declaring minerals separate property |
| recognition:C-OMIN-01:4 | C-OMIN-01 | medium | 4 | 29 | 4 | 1 | ok | Crown land mineral agreements |
| recognition:C-PARK-01:1 | C-PARK-01 | low | 1 | 15 | 2 | 1 | ok | provincial park |
| recognition:C-PARK-01:2 | C-PARK-01 | low | 2 | 49 | 8 | 1 | ok | lease, licence, privilege or concession in a park |
| recognition:C-PARK-01:3 | C-PARK-01 | low | 3 | 29 | 6 | 1 | ok | use or occupancy of park land |
| recognition:C-PARK-01:4 | C-PARK-01 | low | 4 | 10 | 2 | 1 | ok | park roads |
| recognition:C-PARK-01:5 | C-PARK-01 | low | 5 | 30 | 5 | 1 | ok | prospecting or mining in parks |
| recognition:C-PROB-01:1 | C-PROB-01 | low | 1 | 7 | 1 | 1 | ok | probate |
| recognition:C-PROB-01:2 | C-PROB-01 | low | 2 | 25 | 3 | 1 | ok | letters of administration |
| recognition:C-PROB-01:3 | C-PROB-01 | low | 3 | 16 | 3 | 1 | ok | grant of probate |
| recognition:C-PROB-01:4 | C-PROB-01 | low | 4 | 14 | 2 | 1 | ok | estate records |
| recognition:C-PROB-01:5 | C-PROB-01 | low | 5 | 6 | 1 | 1 | ok | caveat |
| recognition:C-PH-01:1 | C-PH-01 | medium | 1 | 30 | 4 | 1 | ok | on-site sewage disposal system |
| recognition:C-PH-01:2 | C-PH-01 | medium | 2 | 28 | 4 | 1 | ok | design and location approval |
| recognition:C-PH-01:3 | C-PH-01 | medium | 3 | 25 | 3 | 1 | ok | certificate of compliance |
| recognition:C-PH-01:4 | C-PH-01 | medium | 4 | 19 | 3 | 1 | ok | public water supply |
| recognition:C-PH-01:5 | C-PH-01 | medium | 5 | 30 | 5 | 1 | ok | rights of entry and inspection |
| recognition:C-EUB-01:1 | C-EUB-01 | low | 1 | 26 | 4 | 1 | ok | Energy and Utilities Board |
| recognition:C-EUB-01:2 | C-EUB-01 | low | 2 | 14 | 2 | 1 | ok | public utility |
| recognition:C-EUB-01:3 | C-EUB-01 | low | 3 | 8 | 1 | 1 | ok | pipeline |
| recognition:C-EUB-01:4 | C-EUB-01 | low | 4 | 22 | 4 | 1 | ok | Board hearing or order |
| recognition:C-EUB-01:5 | C-EUB-01 | low | 5 | 25 | 3 | 1 | ok | utility service territory |
| recognition:C-SNB-01:1 | C-SNB-01 | medium | 1 | 21 | 3 | 1 | ok | Service New Brunswick |
| recognition:C-SNB-01:2 | C-SNB-01 | medium | 2 | 32 | 3 | 1 | ok | geographic information standards |
| recognition:C-SNB-01:3 | C-SNB-01 | medium | 3 | 28 | 3 | 1 | ok | property assessment services |
| recognition:C-SNB-01:4 | C-SNB-01 | medium | 4 | 26 | 3 | 1 | ok | approved parcel identifier |
| recognition:C-SNB-01:5 | C-SNB-01 | medium | 5 | 29 | 4 | 1 | ok | real property transfer notice |
| recognition:C-UGS-01:1 | C-UGS-01 | medium | 1 | 28 | 3 | 1 | ok | underground storage facility |
| recognition:C-UGS-01:2 | C-UGS-01 | medium | 2 | 24 | 3 | 1 | ok | underground storage site |
| recognition:C-UGS-01:3 | C-UGS-01 | medium | 3 | 13 | 2 | 1 | ok | storage lease |
| recognition:C-UGS-01:4 | C-UGS-01 | medium | 4 | 27 | 3 | 1 | ok | storage exploration licence |
| recognition:C-UGS-01:5 | C-UGS-01 | medium | 5 | 33 | 5 | 1 | ok | land description by survey system |
| recognition:C-WILLS-01:1 | C-WILLS-01 | low | 1 | 4 | 1 | 1 | cross-unit duplicate cue of recognition:NAV-08:7, <=5 chars | will |
| recognition:C-WILLS-01:2 | C-WILLS-01 | low | 2 | 41 | 5 | 1 | ok | testamentary disposition of real property |
| recognition:C-WILLS-01:3 | C-WILLS-01 | low | 3 | 6 | 1 | 1 | ok | devise |
| recognition:C-WILLS-01:4 | C-WILLS-01 | low | 4 | 9 | 1 | 1 | ok | ademption |
| recognition:C-WILLS-01:5 | C-WILLS-01 | low | 5 | 29 | 6 | 1 | ok | validity and effect of a will |
| recognition:D-APA-01:1 | D-APA-01 | low | 1 | 34 | 6 | 1 | ok | assignment of property by a debtor |
| recognition:D-APA-01:2 | D-APA-01 | low | 2 | 26 | 3 | 1 | ok | preference among creditors |
| recognition:D-APA-01:3 | D-APA-01 | low | 3 | 16 | 2 | 1 | ok | valid assignment |
| recognition:D-APA-01:4 | D-APA-01 | low | 4 | 26 | 3 | 1 | ok | Bankruptcy Act interaction |
| recognition:D-MUNI-01:1 | D-MUNI-01 | low | 1 | 14 | 1 | 1 | ok | municipalities |
| recognition:D-MUNI-01:2 | D-MUNI-01 | low | 2 | 23 | 2 | 1 | ok | municipal incorporation |
| recognition:D-MUNI-01:3 | D-MUNI-01 | low | 3 | 30 | 3 | 1 | ok | historical municipal documents |
| recognition:D-MUNI-01:4 | D-MUNI-01 | low | 4 | 36 | 6 | 1 | ok | old municipal plans or title records |
| recognition:D-OLA-01:1 | D-OLA-01 | low | 1 | 18 | 2 | 1 | ok | official languages |
| recognition:D-OLA-01:2 | D-OLA-01 | low | 2 | 18 | 2 | 1 | ok | official documents |
| recognition:D-OLA-01:3 | D-OLA-01 | low | 3 | 48 | 8 | 1 | ok | documents published under an Act of the Province |
| recognition:D-OLA-01:4 | D-OLA-01 | low | 4 | 43 | 4 | 1 | ok | communications with government institutions |
| recognition:D-PBNR-01:1 | D-PBNR-01 | low | 1 | 23 | 2 | 1 | ok | partnership certificate |
| recognition:D-PBNR-01:2 | D-PBNR-01 | low | 2 | 24 | 3 | 1 | ok | registered business name |
| recognition:D-PBNR-01:3 | D-PBNR-01 | low | 3 | 24 | 3 | 1 | ok | register of certificates |
| recognition:D-PBNR-01:4 | D-PBNR-01 | low | 4 | 23 | 3 | 1 | ok | partnership owning land |
| recognition:D-PRA-01:1 | D-PRA-01 | low | 1 | 14 | 2 | 1 | ok | public records |
| recognition:D-PRA-01:2 | D-PRA-01 | low | 2 | 27 | 5 | 1 | ok | records vested in the Crown |
| recognition:D-PRA-01:3 | D-PRA-01 | low | 3 | 38 | 5 | 1 | ok | wrongful withholding of public records |
| recognition:D-PRA-01:4 | D-PRA-01 | low | 4 | 18 | 3 | 1 | ok | old public records |
| recognition:D-RPTR-01:1 | D-RPTR-01 | low | 1 | 31 | 4 | 1 | ok | residential property tax credit |
| recognition:D-RPTR-01:2 | D-RPTR-01 | low | 2 | 19 | 2 | 1 | ok | principal residence |
| recognition:D-RPTR-01:3 | D-RPTR-01 | low | 3 | 19 | 4 | 1 | ok | one credit per year |
| recognition:D-RPTR-01:4 | D-RPTR-01 | low | 4 | 38 | 7 | 1 | ok | review and appeal of a credit decision |
| recognition:NAV-01:1 | NAV-01 | high | 1 | 4 | 1 | 2 | cross-unit duplicate cue of recognition:NAV-08:1, <=5 chars, <=3-word NAV cue, generic legal noun cue, expected across 2 documents | deed |
| recognition:NAV-01:2 | NAV-01 | high | 2 | 21 | 2 | 2 | <=3-word NAV cue, expected across 2 documents | registered instrument |
| recognition:NAV-01:3 | NAV-01 | high | 3 | 15 | 2 | 2 | <=3-word NAV cue, expected across 2 documents | registry office |
| recognition:NAV-01:4 | NAV-01 | high | 4 | 14 | 2 | 2 | <=3-word NAV cue, expected across 2 documents | title register |
| recognition:NAV-01:5 | NAV-01 | high | 5 | 35 | 4 | 2 | expected across 2 documents | certificate of registered ownership |
| recognition:NAV-01:6 | NAV-01 | high | 6 | 3 | 1 | 2 | <=5 chars, <=3-word NAV cue, expected across 2 documents | PID |
| recognition:NAV-01:7 | NAV-01 | high | 7 | 8 | 1 | 2 | <=3-word NAV cue, expected across 2 documents | priority |
| recognition:NAV-01:8 | NAV-01 | high | 8 | 16 | 2 | 2 | <=3-word NAV cue, expected across 2 documents | registered owner |
| recognition:NAV-01:9 | NAV-01 | high | 9 | 13 | 1 | 2 | <=3-word NAV cue, expected across 2 documents | rectification |
| recognition:NAV-01:10 | NAV-01 | high | 10 | 18 | 2 | 2 | <=3-word NAV cue, expected across 2 documents | registration error |
| recognition:NAV-02:1 | NAV-02 | high | 1 | 29 | 3 | 9 | <=3-word NAV cue, expected across 9 documents | conflicting deed descriptions |
| recognition:NAV-02:2 | NAV-02 | high | 2 | 17 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | conflicting plans |
| recognition:NAV-02:3 | NAV-02 | high | 3 | 13 | 2 | 9 | cross-unit duplicate cue of recognition:NAV-04:4, <=3-word NAV cue, expected across 9 documents | lost monument |
| recognition:NAV-02:4 | NAV-02 | high | 4 | 34 | 4 | 9 | expected across 9 documents | occupation inconsistent with title |
| recognition:NAV-02:5 | NAV-02 | high | 5 | 18 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | uncertain boundary |
| recognition:NAV-02:6 | NAV-02 | high | 6 | 17 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | disputed boundary |
| recognition:NAV-02:7 | NAV-02 | high | 7 | 16 | 2 | 9 | cross-unit duplicate cue of recognition:B-HWY-01:1, <=3-word NAV cue, expected across 9 documents | highway boundary |
| recognition:NAV-02:8 | NAV-02 | high | 8 | 14 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | Crown boundary |
| recognition:NAV-02:9 | NAV-02 | high | 9 | 19 | 3 | 9 | <=3-word NAV cue, expected across 9 documents | old survey evidence |
| recognition:NAV-03:1 | NAV-03 | high | 1 | 17 | 3 | 7 | <=3-word NAV cue, expected across 7 documents | creating new lots |
| recognition:NAV-03:2 | NAV-03 | high | 2 | 18 | 3 | 7 | <=3-word NAV cue, expected across 7 documents | splitting a parcel |
| recognition:NAV-03:3 | NAV-03 | high | 3 | 26 | 3 | 7 | <=3-word NAV cue, expected across 7 documents | tentative subdivision plan |
| recognition:NAV-03:4 | NAV-03 | high | 4 | 21 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | subdivision exemption |
| recognition:NAV-03:5 | NAV-03 | high | 5 | 19 | 2 | 7 | cross-unit duplicate cue of recognition:NAV-12:12, <=3-word NAV cue, expected across 7 documents | development officer |
| recognition:NAV-03:6 | NAV-03 | high | 6 | 10 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | new street |
| recognition:NAV-03:7 | NAV-03 | high | 7 | 7 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | new PID |
| recognition:NAV-03:8 | NAV-03 | high | 8 | 23 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | subdivision-plan filing |
| recognition:NAV-04:1 | NAV-04 | high | 1 | 24 | 3 | 6 | <=3-word NAV cue, expected across 6 documents | setting survey monuments |
| recognition:NAV-04:2 | NAV-04 | high | 2 | 22 | 3 | 6 | <=3-word NAV cue, expected across 6 documents | integrated survey area |
| recognition:NAV-04:3 | NAV-04 | high | 3 | 19 | 2 | 6 | cross-unit duplicate cue of recognition:NAV-09:7, <=3-word NAV cue, expected across 6 documents | coordinate monument |
| recognition:NAV-04:4 | NAV-04 | high | 4 | 13 | 2 | 6 | cross-unit duplicate cue of recognition:NAV-02:3, <=3-word NAV cue, expected across 6 documents | lost monument |
| recognition:NAV-04:5 | NAV-04 | high | 5 | 11 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | Survey Plan |
| recognition:NAV-04:6 | NAV-04 | high | 6 | 13 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | surveyor seal |
| recognition:NAV-04:7 | NAV-04 | high | 7 | 15 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | plan validation |
| recognition:NAV-04:8 | NAV-04 | high | 8 | 11 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | plan filing |
| recognition:NAV-05:1 | NAV-05 | high | 1 | 12 | 1 | 6 | <=3-word NAV cue, expected across 6 documents | right-of-way |
| recognition:NAV-05:2 | NAV-05 | high | 2 | 6 | 1 | 6 | <=3-word NAV cue, expected across 6 documents | access |
| recognition:NAV-05:3 | NAV-05 | high | 3 | 8 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | long use |
| recognition:NAV-05:4 | NAV-05 | high | 4 | 12 | 1 | 6 | <=3-word NAV cue, expected across 6 documents | prescription |
| recognition:NAV-05:5 | NAV-05 | high | 5 | 16 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | utility corridor |
| recognition:NAV-05:6 | NAV-05 | high | 6 | 21 | 2 | 6 | cross-unit duplicate cue of recognition:NAV-10:8, <=3-word NAV cue, expected across 6 documents | conservation easement |
| recognition:NAV-05:7 | NAV-05 | high | 7 | 14 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | Crown easement |
| recognition:NAV-05:8 | NAV-05 | high | 8 | 19 | 2 | 6 | <=3-word NAV cue, expected across 6 documents | unregistered access |
| recognition:NAV-06:1 | NAV-06 | medium | 1 | 10 | 2 | 9 | cross-unit duplicate cue of recognition:B-CLF-01:1, <=3-word NAV cue, expected across 9 documents | Crown land |
| recognition:NAV-06:2 | NAV-06 | medium | 2 | 11 | 2 | 9 | cross-unit duplicate cue of recognition:B-CLF-01:2, recognition:NAV-08:8, recognition:NAV-11:3, <=3-word NAV cue, expected across 9 documents | Crown grant |
| recognition:NAV-06:3 | NAV-06 | medium | 3 | 13 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | mineral claim |
| recognition:NAV-06:4 | NAV-06 | medium | 4 | 12 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | mining lease |
| recognition:NAV-06:5 | NAV-06 | medium | 5 | 11 | 3 | 9 | <=3-word NAV cue, expected across 9 documents | oil and gas |
| recognition:NAV-06:6 | NAV-06 | medium | 6 | 12 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | quarry lease |
| recognition:NAV-06:7 | NAV-06 | medium | 7 | 4 | 1 | 9 | <=5 chars, <=3-word NAV cue, expected across 9 documents | peat |
| recognition:NAV-06:8 | NAV-06 | medium | 8 | 16 | 2 | 9 | cross-unit duplicate cue of recognition:C-BSHALE-01:1, <=3-word NAV cue, expected across 9 documents | bituminous shale |
| recognition:NAV-06:9 | NAV-06 | medium | 9 | 19 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | underground storage |
| recognition:NAV-06:10 | NAV-06 | medium | 10 | 15 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | resource survey |
| recognition:NAV-06:11 | NAV-06 | medium | 11 | 17 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | mineral ownership |
| recognition:NAV-07:1 | NAV-07 | high | 1 | 34 | 4 | 8 | expected across 8 documents | surveyor entering private property |
| recognition:NAV-07:2 | NAV-07 | high | 2 | 22 | 3 | 8 | <=3-word NAV cue, expected across 8 documents | government survey crew |
| recognition:NAV-07:3 | NAV-07 | high | 3 | 7 | 1 | 8 | <=3-word NAV cue, expected across 8 documents | borings |
| recognition:NAV-07:4 | NAV-07 | high | 4 | 9 | 2 | 8 | <=3-word NAV cue, expected across 8 documents | test pits |
| recognition:NAV-07:5 | NAV-07 | high | 5 | 11 | 2 | 8 | cross-unit duplicate cue of recognition:B-PW-01:1, <=3-word NAV cue, expected across 8 documents | public work |
| recognition:NAV-07:6 | NAV-07 | high | 6 | 13 | 1 | 8 | cross-unit duplicate cue of recognition:NAV-08:10, <=3-word NAV cue, expected across 8 documents | expropriation |
| recognition:NAV-07:7 | NAV-07 | high | 7 | 19 | 2 | 8 | <=3-word NAV cue, expected across 8 documents | highway acquisition |
| recognition:NAV-07:8 | NAV-07 | high | 8 | 10 | 1 | 8 | <=3-word NAV cue, expected across 8 documents | possession |
| recognition:NAV-07:9 | NAV-07 | high | 9 | 12 | 1 | 8 | cross-unit duplicate cue of recognition:B-PW-01:5, <=3-word NAV cue, expected across 8 documents | compensation |
| recognition:NAV-07:10 | NAV-07 | high | 10 | 22 | 2 | 8 | <=3-word NAV cue, expected across 8 documents | resource-company entry |
| recognition:NAV-08:1 | NAV-08 | high | 1 | 4 | 1 | 12 | cross-unit duplicate cue of recognition:NAV-01:1, <=5 chars, <=3-word NAV cue, generic legal noun cue, expected across 12 documents | deed |
| recognition:NAV-08:2 | NAV-08 | high | 2 | 8 | 1 | 12 | <=3-word NAV cue, generic legal noun cue, expected across 12 documents | transfer |
| recognition:NAV-08:3 | NAV-08 | high | 3 | 4 | 1 | 12 | <=5 chars, <=3-word NAV cue, expected across 12 documents | sale |
| recognition:NAV-08:4 | NAV-08 | high | 4 | 6 | 1 | 12 | <=3-word NAV cue, expected across 12 documents | estate |
| recognition:NAV-08:5 | NAV-08 | high | 5 | 14 | 3 | 12 | <=3-word NAV cue, expected across 12 documents | death of owner |
| recognition:NAV-08:6 | NAV-08 | high | 6 | 8 | 1 | 12 | <=3-word NAV cue, expected across 12 documents | executor |
| recognition:NAV-08:7 | NAV-08 | high | 7 | 4 | 1 | 12 | cross-unit duplicate cue of recognition:C-WILLS-01:1, <=5 chars, <=3-word NAV cue, expected across 12 documents | will |
| recognition:NAV-08:8 | NAV-08 | high | 8 | 11 | 2 | 12 | cross-unit duplicate cue of recognition:B-CLF-01:2, recognition:NAV-06:2, recognition:NAV-11:3, <=3-word NAV cue, expected across 12 documents | Crown grant |
| recognition:NAV-08:9 | NAV-08 | high | 9 | 16 | 2 | 12 | <=3-word NAV cue, expected across 12 documents | marital property |
| recognition:NAV-08:10 | NAV-08 | high | 10 | 13 | 1 | 12 | cross-unit duplicate cue of recognition:NAV-07:6, <=3-word NAV cue, expected across 12 documents | expropriation |
| recognition:NAV-08:11 | NAV-08 | high | 11 | 16 | 2 | 12 | <=3-word NAV cue, expected across 12 documents | parcel severance |
| recognition:NAV-08:12 | NAV-08 | high | 12 | 12 | 2 | 12 | <=3-word NAV cue, expected across 12 documents | transfer tax |
| recognition:NAV-09:1 | NAV-09 | medium | 1 | 16 | 2 | 4 | <=3-word NAV cue, expected across 4 documents | air-space parcel |
| recognition:NAV-09:2 | NAV-09 | medium | 2 | 26 | 2 | 4 | <=3-word NAV cue, expected across 4 documents | three-dimensional boundary |
| recognition:NAV-09:3 | NAV-09 | medium | 3 | 9 | 1 | 4 | <=3-word NAV cue, expected across 4 documents | elevation |
| recognition:NAV-09:4 | NAV-09 | medium | 4 | 23 | 2 | 4 | <=3-word NAV cue, expected across 4 documents | condominium description |
| recognition:NAV-09:5 | NAV-09 | medium | 5 | 15 | 2 | 4 | <=3-word NAV cue, expected across 4 documents | common elements |
| recognition:NAV-09:6 | NAV-09 | medium | 6 | 21 | 2 | 4 | <=3-word NAV cue, expected across 4 documents | bare-land condominium |
| recognition:NAV-09:7 | NAV-09 | medium | 7 | 19 | 2 | 4 | cross-unit duplicate cue of recognition:NAV-04:3, <=3-word NAV cue, expected across 4 documents | coordinate monument |
| recognition:NAV-09:8 | NAV-09 | medium | 8 | 13 | 2 | 4 | <=3-word NAV cue, expected across 4 documents | unit boundary |
| recognition:NAV-10:1 | NAV-10 | medium | 1 | 6 | 1 | 9 | <=3-word NAV cue, expected across 9 documents | zoning |
| recognition:NAV-10:2 | NAV-10 | medium | 2 | 23 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | subdivision restriction |
| recognition:NAV-10:3 | NAV-10 | medium | 3 | 7 | 1 | 9 | cross-unit duplicate cue of recognition:B-CWA-01:2, <=3-word NAV cue, expected across 9 documents | wetland |
| recognition:NAV-10:4 | NAV-10 | medium | 4 | 11 | 1 | 9 | cross-unit duplicate cue of recognition:B-CWA-01:1, <=3-word NAV cue, expected across 9 documents | watercourse |
| recognition:NAV-10:5 | NAV-10 | medium | 5 | 17 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | contaminated site |
| recognition:NAV-10:6 | NAV-10 | medium | 6 | 12 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | coastal area |
| recognition:NAV-10:7 | NAV-10 | medium | 7 | 22 | 3 | 9 | <=3-word NAV cue, expected across 9 documents | protected natural area |
| recognition:NAV-10:8 | NAV-10 | medium | 8 | 21 | 2 | 9 | cross-unit duplicate cue of recognition:NAV-05:6, <=3-word NAV cue, expected across 9 documents | conservation easement |
| recognition:NAV-10:9 | NAV-10 | medium | 9 | 13 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | septic system |
| recognition:NAV-10:10 | NAV-10 | medium | 10 | 9 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | park land |
| recognition:NAV-10:11 | NAV-10 | medium | 11 | 17 | 2 | 9 | <=3-word NAV cue, expected across 9 documents | agricultural land |
| recognition:NAV-11:1 | NAV-11 | high | 1 | 8 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | old deed |
| recognition:NAV-11:2 | NAV-11 | high | 2 | 15 | 3 | 7 | <=3-word NAV cue, expected across 7 documents | old survey plan |
| recognition:NAV-11:3 | NAV-11 | high | 3 | 11 | 2 | 7 | cross-unit duplicate cue of recognition:B-CLF-01:2, recognition:NAV-06:2, recognition:NAV-08:8, <=3-word NAV cue, expected across 7 documents | Crown grant |
| recognition:NAV-11:4 | NAV-11 | high | 4 | 15 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | registered will |
| recognition:NAV-11:5 | NAV-11 | high | 5 | 14 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | certified copy |
| recognition:NAV-11:6 | NAV-11 | high | 6 | 15 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | archival record |
| recognition:NAV-11:7 | NAV-11 | high | 7 | 13 | 2 | 7 | <=3-word NAV cue, expected across 7 documents | public record |
| recognition:NAV-11:8 | NAV-11 | high | 8 | 26 | 3 | 7 | <=3-word NAV cue, expected across 7 documents | historic boundary evidence |
| recognition:NAV-11:9 | NAV-11 | high | 9 | 21 | 3 | 7 | <=3-word NAV cue, expected across 7 documents | old Registry document |
| recognition:NAV-12:1 | NAV-12 | high | 1 | 12 | 2 | 10 | <=3-word NAV cue, expected across 10 documents | who approves |
| recognition:NAV-12:2 | NAV-12 | high | 2 | 11 | 2 | 10 | <=3-word NAV cue, expected across 10 documents | who decides |
| recognition:NAV-12:3 | NAV-12 | high | 3 | 13 | 3 | 10 | <=3-word NAV cue, expected across 10 documents | who may order |
| recognition:NAV-12:4 | NAV-12 | high | 4 | 22 | 4 | 10 | expected across 10 documents | who hears an objection |
| recognition:NAV-12:5 | NAV-12 | high | 5 | 19 | 4 | 10 | expected across 10 documents | who hears an appeal |
| recognition:NAV-12:6 | NAV-12 | high | 6 | 15 | 3 | 10 | <=3-word NAV cue, expected across 10 documents | who may rectify |
| recognition:NAV-12:7 | NAV-12 | high | 7 | 13 | 2 | 10 | <=3-word NAV cue, expected across 10 documents | who certifies |
| recognition:NAV-12:8 | NAV-12 | high | 8 | 9 | 1 | 10 | <=3-word NAV cue, expected across 10 documents | Registrar |
| recognition:NAV-12:9 | NAV-12 | high | 9 | 15 | 2 | 10 | <=3-word NAV cue, expected across 10 documents | Chief Registrar |
| recognition:NAV-12:10 | NAV-12 | high | 10 | 17 | 2 | 10 | <=3-word NAV cue, expected across 10 documents | Registrar General |
| recognition:NAV-12:11 | NAV-12 | high | 11 | 19 | 3 | 10 | <=3-word NAV cue, expected across 10 documents | Director of Surveys |
| recognition:NAV-12:12 | NAV-12 | high | 12 | 19 | 2 | 10 | cross-unit duplicate cue of recognition:NAV-03:5, <=3-word NAV cue, expected across 10 documents | development officer |
| recognition:NAV-12:13 | NAV-12 | high | 13 | 8 | 1 | 10 | <=3-word NAV cue, expected across 10 documents | Minister |
| recognition:NAV-12:14 | NAV-12 | high | 14 | 5 | 1 | 10 | <=5 chars, <=3-word NAV cue, expected across 10 documents | Board |
| recognition:NAV-12:15 | NAV-12 | high | 15 | 13 | 2 | 10 | <=3-word NAV cue, expected across 10 documents | ANBLS Council |

A-SURV-03 carries no recognition cue, so it is absent from this pool (by design, noted in the Recall audit).
