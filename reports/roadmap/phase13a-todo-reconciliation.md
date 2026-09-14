# Phase 13A — TODO.md reconciliation

Branch: `feat/post-gnss-roadmap-audit` · Baseline: `c1b60f2f` (origin/main, PR #63 merge).
Read-only audit; this report freezes findings. Checkbox/annotation fixes applied separately as small doc-only edits.

## 1. Open checkboxes with stale DONE framing, plus superseded entries left open by design

| TODO.md location | Item | Own STATUS text | Evidence it is complete |
|---|---|---|---|
| Line 2 | Phase 12J.6 modern Wettzell covariance calibration | "STATUS: DONE 2026-09-14" | Decision REVIEW-ONLY recorded; no further work pending |
| Line 8 (`- [ ] Phase 12I.1 free-network MVP` region; exact line ~18) | Phase 12I.1 free-network static-GNSS MVP | "STATUS (2026-09-13): DONE" | `src/engine/gnssFreeNetwork.ts` + 48/48 agent tests + 12I.2 UI on top |
| Line ~24 | Phase 12F.2 R2B evidence runner | "DONE (this batch)" | `src/engine/gnssBlockStatistics.ts`, `scripts/gnss/gnssR2BEvidence.ts`, `reports/gnss/phase12f2-r2b.{json,md}` |
| Line ~27 | Phase 12F.2 block API | "§§3-4, 9-10, 28 DONE" | `solve_sparse_selected_covariance_blocks` + binding + `gnssSelectedBlockQuery.ts`, cpp 8/8 |
| Line ~31 | Phase 12E0 GVX 1.0 intake prep | Deliverables delivered, but entry ends "TBC intake checklist 1-10 PENDING" | Left OPEN with SUPERSEDED-BY-12E.2/12E.3/12G annotation (§2) |
| Line ~36 | Phase 12A baseline architecture | No DONE status; contract consumed by 12B | Left OPEN with SUPERSEDED-BY-12B annotation (§2) |
| Line ~8 (12J.9 entry) | Phase 12J.9 session review | "STATUS: MERGED 2026-09-14 as 58d7cbed" | Merged; checkbox still open |
| 12J.10 entry | Phase 12J.10 final hardening | `[x]` checked but text says "PR #63 open" | PR #63 MERGED 2026-09-14 as `c1b60f2f`; text stale |

Fix applied: flip stale `[ ]` → `[x]`; annotate 12J.10 line "PR #63 MERGED".

## 2. Superseded phase recommendations

- **12E0 "TBC intake checklist 1-10 PENDING"** (`TODO.md` ~line 31; `reports/gnss/phase12e0-gvx-prep.md` checklist): superseded by 12E.2 (`reports/gnss/phase12e-tbc-commercial-parity.md`, parity 1/4) and 12E.3 (setup-uncertainty production). The checklist is closed as evidence; remaining TBC gap is parity quality (gates F/I FAIL), not intake.
- **12I.1 "Recommended MVP-B" / "design only, not implemented"** (`reports/gnss/phase12i0-free-network-architecture.md` §§22, 33, 39): implemented in `src/engine/gnssFreeNetwork.ts` + 12I.2 UI. NOT superseded: §§26–28 native free-network deferral (R2B never admitted for free networks — still current, `gnssMultifileProject.ts:503` skips standalone preflight path).
- **`docs/gnss/GVX_IMPORT.md:1` header** "Phase 12E0 prep … vendor-neutral standards prep only … no TBC parity claim": GVX intake is production (AppShell routing, multifile intake). Header stale as prep framing; keep the partial-parity caveat (TBC parity is 1/4).
- **`docs/gnss/raw-static-worker-mvp.md` ANTEX deferral** ("No safe RTKLIB-side ANTEX consumption path proven"): superseded by 12J.10 for the raw-**session** path (63/63 byte-identical full-vs-subset). Still true for the single-baseline path (`GnssRawBaselinePanel.tsx` has no ANTEX input → `CALIBRATION_UNAVAILABLE`).
- **`src/engine/gnssBaselineCsvImport.ts:11`** defers TBC column profile to "12E work" while 12E.0–12E.3 are complete: phase label stale (seam itself still unimplemented).

## 3. Duplicate / ordering defects

- **Duplicate 12F.2**: two distinct open entries share title "Phase 12F.2" and branch `feat/gnss-native-batched-selected-covariance` (evidence-runner entry ~line 24; block-API entry ~line 27). Recommend retitle 12F.2a (evidence runner) / 12F.2b (block API) on next TODO touch; not renamed here to preserve anchors.
- **Ordering inversion**: 12I.2 (`[x]`, line ~17) listed before its prerequisite 12I.1 (`[ ]`, line ~18).
- **Placeholder**: `TODO.md:951` — open item "add planned improvements to todo list in phased implementations before starting on imlementation [sic]"; meta-backlog residue with no scope.

## 4. Contradictions vs current code

- **Multifile flag**: `TODO.md` 12H.1 entry (~line 20) records "enforced DEFAULT-OFF gate"; 12H.2 (`TODO.md:2204`) flipped to default-ON (`src/engine/gnssMultifileFlag.ts:7` `let gnssMultifileEnabled = true`). Historical entries disagree with each other; code + `docs/ARCHITECTURE.md` agree (DEFAULT-ON with kill switch). No code change needed; historical text left intact.
- **Native-route framing**: `docs/CURRENT_BEHAVIOR.md:11` ("Dense TypeScript … remains the production default") and `:208` ("Experimental sparse Phase 7B evidence"), `docs/ARCHITECTURE.md:117` ("production covariance remains TypeScript"), `cpp/README.md:5` ("experimental and test-injected only"), `docs/CPP_WASM_ENGINE.md:224` ("not wired to routing") contradict live default-ON routes (`adjustmentSparseAutoRoute.ts:65`, `preanalysisSparseAutoRoute.ts:83`, `adjustmentNativeFullQxxAutoRoute.ts:74`, `gnssBaselineNativeR2BRoute.ts:87`). Doc refresh is genuine open backlog (not fixed in 13A beyond this record).
- **CAD seams**: `docs/ARCHITECTURE.md` "Where to add new work" routes Survey CAD to "planned `src/engine/cad/`" — that directory holds 130 shipped modules. Stale pointer.
- **Overstated multifile-GNSS claim**: `docs/CURRENT_BEHAVIOR.md:110` and `docs/gnss/STATIC_GNSS_WORKFLOW.md:38` say named-project runs compose automatically / DEFAULT ON. Engine + flag + tests exist (`gnssMultifileProject.ts`, `gnssMultifileDefaultOn.test.ts`), but **zero production callers** import `gnssMultifileProject`/`parseGnssProjectSources`/`runGnssMultifileProjectSolve` outside `src/engine/gnssMultifile*` (verified by repo grep 2026-09-14). Wording is unverified/overstated until UI/hook wiring lands.

## 5. Genuinely open backlog (not stale)

Doc-refresh of native-route framing; GNSS multifile product wiring; TBC parity gates F/I; calibrated raw covariance (frozen REVIEW_ONLY); PPP/PPK/RTK; T01/DAT decoding; multi-GNSS widening; terrestrial CSV import; LandXML/DXF import; SHP/GPKG; Trimble Access CSV; linework/feature-code pipeline; drafting output (sheets/PDF/DXF export); legal parcel model; COGO transforms/resection/best-fit; custom CRS/epoch propagation; IGG/Danish robust. Scored in the main audit report.
