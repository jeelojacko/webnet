# Phase 17A — End-to-End Survey Workflow Readiness Audit

- Branch: `feat/end-to-end-survey-workflow-readiness-audit`
- Baseline: origin/main `592524ca` (PR #85 merge)
- Date: 2026-09-17
- Scope: AUDIT / EVIDENCE ONLY. No production feature work, no numerical-method
  changes, no solver-routing changes, no redesign. Phase 14/15/16 campaigns kept closed.
- Method: 6 scout tracks + baseline worker + E2E trace worker + independent reviewer gate.
- Verdict: reviewer GO 15/15. Recommended next phase: **GO-17B-DATA-INTEGRITY**.

## 1. Baseline validation

Environment: node v26.8.1, npm 11.19.0.

| Command | Result |
|---|---|
| `npm run lint` | PASS (0 errors, 2 pre-existing unused-disable warnings) |
| `npm run typecheck` | PASS (`tsc --noEmit` clean) |
| `npm run test:agent` | 4237/4241 — 3 failures, all pre-existing study-desktop calibration (`study_ai_unit_calibration`, `..._v5`, `study_ai_unit_preflight`), documented in TODO.md |
| `npm run build` | PASS (~9s, chunk-size warning only, pre-existing) |
| `npm run test:wasm` | PASS (12 files / 74 tests) |
| `npm run parity:industry-reference` | PASS (25 tests) |

Test inventory: ~497 Vitest files under `tests/` + 121 under `study-desktop/tests/`
(~618 total), 14 Playwright specs in `tests-browser/`. Tiers per `scripts/testTiers.ts`:
EVIDENCE 48, RELEASE 3, WASM 12, AGENT = FULL − 63.

## 2. Capability map

| Area | Status | Key evidence |
|---|---|---|
| A. Data import | PRODUCTION | `src/engine/importers.ts`, `src/engine/terrestrialCsvImport.ts`, `src/components/ImportReviewModal.tsx`, `src/hooks/useImportReviewWorkflow.ts` |
| B. Project management | PRODUCTION | `src/engine/projectFile.ts` (manifest-first `webnet-project` v5), `src/hooks/useProjectFileWorkflow.ts` |
| C. Coordinate systems | PRODUCTION | `src/engine/crsCatalog.ts` + provincial/SPCS parts, `src/engine/geodesyProjection.ts`, `AdjustmentCoordinateSystemCard.tsx` |
| D. Adjustment | PRODUCTION | `src/engine/runSession.ts`, `solveEngine.ts`, `adjustSolveWorkflow.ts`, worker/WASM routes |
| E. Statistical/QC | PRODUCTION | local-test / reliability / external-reliability / stochastic / systematic-pattern policies, `QcOverviewSection.tsx` |
| F. GNSS | PRODUCTION (mixed maturity) | `gnssBaselineAdjust.ts`, `gnssFreeNetwork.ts`, `GnssWorkspaceModal.tsx`; raw via prebuilt `public/rtklib-rnx2rtkp.wasm` |
| G. COGO | PRODUCTION | `src/engine/cad/cadCogo*.ts`, `SurveyCadCogoPanel.tsx` |
| H. Parcels | PRODUCTION | `src/engine/cad/cadCogoParcel*.ts` (~25 modules), `SurveyCadParcelLayoutPanel.tsx` |
| I. Alignment | PRODUCTION | `src/engine/cad/cadAlignment*.ts`, ALIGN/STA commands |
| J. Field-to-Finish | PRODUCTION | `src/engine/fieldToFinish/` (12 modules), `SurveyCadFieldToFinishPanel.tsx` |
| K. Drafting | PRODUCTION | `cadSheets.ts`, `cadLabelEngine.ts`, `cadPdfExport.ts`, `SurveyCadPreview.tsx` |
| L. Reports | PRODUCTION | `ReportView.tsx` + ~60 `report/` sections, `industryListing*.ts` (~40) |
| M. Exports | PRODUCTION | `exportFormats.ts`, `adjustedPointsExport.ts`, CAD `exportCenter.ts` (svg/pdf/dxf-r12/dxf-r2000/landxml/wncad/catalog) |
| N. Persistence/recovery | PRODUCTION (limits, see §7) | `projectStorage.ts` (IndexedDB), `projectStorageOpfs.ts`, `useWorkspaceRecovery.ts` (1.5 MB cap), `cadPersistence.ts` (.wncad v2) |
| O. Large-job/browser op | PARTIAL | sparse worker route default ON but ≤64 unknowns (`adjustmentSparseAutoRoute.ts`); hard caps (`preanalysisSparseAutoRouteCaps.ts`); `sparseProductionEligibility.ts` test-only, explicitly unwired |

Hidden (not reachable from app shell): `src/dev/*` harnesses, co-located `/study` app,
headless CLI (`src/cli.ts`, `npm run adjust:cli`). Opt-in/default-off: 3D map, Review
Queue, Run Comparison panels. No dead production modules identified.

## 3. Terrestrial job trace (E2E)

Fixture: `tests/fixtures/industry_standard_reference_case.dat` (STAR*NET-style DAT:
fixed control, traverse, faceset redundancy, sideshot spurs; 16 stations / 162 obs /
dof 134, converged=true). Cross-check: `triangulation_trilateration_2d.dat` (6/26/18,
converged).

import/parse PASS → adjust PASS → QC PASS (per-obs stdRes + redundancy; healthy net =
0 obs |stdRes|>3) → LOO CONDITIONAL (suspect-gated, cap 3 — healthy net yields 0
candidates, which reads as "missing QC") → F2F/drafting PASS only if linked
(`applySuccessfulAdjustmentRunToDrawing`, `src/engine/fieldToFinish/linkedRerunSync.ts`;
unlinked drawing returns unchanged = manual step) → export CSV PASS (deterministic,
N-E sorted) → save/reopen PASS (project-file serialize/parse round-trip).

Breakage: revised input never auto-produces revised deliverable (full manual re-chain).

## 4. Mixed GNSS + terrestrial trace (E2E)

Fixtures: `gps_network_sideshot_phase3.dat` (2 stn/3 obs/dof 1, converged),
`industry_case_gnss_input.txt` (projected CRS, 7/15/27, converged),
`industry_case_combined_input.txt` (43 stn / 1617 obs / dof 1302, **converged=false** —
needs setup/weight triage, not a regression).

Exporter runs even on `success=false` (engine API has no fail-closed gate; UI guard is
`canExport` on run state). `AdjustmentResult` carries no CRS/frame/ellipsoid/epoch
fields — frame provenance lives in input/parse settings, operator must track it.
Phase 12 terminal decisions untouched.

## 5. Import audit

| Input | Key finding |
|---|---|
| Native DAT / project files | Full records + per-line sourceFile/sourceLine (`parseIncludes.ts`); `#` comments skipped untraced; duplicate `C`/`P` silently overwrites (`parseControlRecords.ts`); `.UNITS`/`.ORDER`/`.CRS` reset per file |
| JobXML/JXL | Points/setups/rounds/raw circles preserved; **deleted shots dropped with no trace** (`jobXmlImporter/measurements.ts`); **no unit handling** |
| RW5 / FieldGenius / DBX / Trimble report | Preserved with line-stamped warnings; **no unit handling in any** |
| OPUS | Single control station; covariance as corrEN only; `trace: []` |
| Terrestrial CSV | Units param supported but registry path defaults `'m'` (`terrestrialCsvImport.ts`); missing elevation ⇒ silent `heightM: 0`; CRS recorded, never transformed |
| GNSS GVX / native BL / CSV | Fail-closed frame/epoch/ellipsoid; dup baseline ID = hard error (good) |
| LandXML | CAD/COGO only, never observations; CRS metadata-only; spirals warn+skip |
| FXL / catalog | Issues carry severity+message only, **no source line** |
| F2F point CSV | Units hard-coded `'m'` (`SurveyCadFieldToFinishPanel.tsx`) |

Highest-risk class: a feet-based raw file is silently read as metres after `.UNITS M`
is forced (`importReview.ts`, `sharedDataset.ts`).

## 6. Round-trip matrix

LOSSLESS: raw-GNSS baseline JSON; GNSS multifile settings bag; LandXML CAD geometry
(within export precision). EXPECTED-LOSSY (bounded/documented): imported dataset →
WebNet text; staged review → text (drops per-record source lines + feature codes);
GNSS BL serialize (SIGCORR→COV comment, ENU one-way); `.wnproj` v1–v5 (sanitizers).
UNEXPECTED-LOSS / unusable: composed multifile GNSS `provenance: []` ⇒ serializer
emits **zero BL/COV lines** (latent); adjusted-points CSV (`P,N,E,Z,D` header) is **not
reimportable** (no `p`/`d` aliases in detector; transformed variant appends duplicate
rows); report/listing exports have **no importer**.

## 7. Multi-file workflow

Composition deterministic (`sortProjectFiles`, enabled-only). Per-file parser-state
reset: units/CRS/order/deltaMode/coordMode/geoid do not carry across files; setups
cannot span files (safe, silently splits direction sets). Station-name collision =
silent last-wins (only class-mismatch and alias-merge-beyond-1e-6 warn). No
terrestrial duplicate-observation detector (GNSS has indexed LEGITIMATE/POSSIBLE/
STRONG/REVERSED classifier with STRONG cross-source run block). Reimport of a revised
file **appends a copy** (`buildFileNameCopy`, `src/hooks/projectWorkflowUtils.ts` —
note: scout cited `src/engine/` path, corrected) ⇒ old + revised both enabled,
terrestrial silently double-counts (GNSS warns POSSIBLE_DUPLICATE).

## 8. Source traceability

Model keeps `sourceLine` + `sourceFile` (`typesObservations.ts`, stamped at parse,
survives into result). Observations & residuals CSV carries both (best output).
Report text: bare `Line`, no file. Industry listing: `File:Line` column **hard-coded
to `1:`** (`industryListingClassicFormatters.ts`, verified `return \`1:${sourceLine}\``
/ `` `1:${displayLine}` ``) — wrong for every observation from file 2+. Display-line
map is file-1-only. Committed staged-review text keeps only `# SOURCE` headers ⇒
file/line/setup linkage lost after commit.

## 9. Persistence / recovery

Backends: named projects = IndexedDB + OPFS; crash-draft = localStorage
`webnet.workspace-recovery.v1` (250 ms debounce, **1.5 MB cap**); GNSS multifile config
= per-project localStorage key; CAD = `.wncad` file only, no autosave.

Not persisted in named-project autosave or portable project: CAD drawing/drafting/
COGO/parcels (`surveyCad` omitted from manifest write; `buildProjectDomainPayload`
omits; `buildSurveyCadSidecarText` has **no production caller** — tests only),
saved-run snapshots (open passes `[]`), F2F active catalog (workspace React state
only). Recovery snapshot explicitly resets exclusions and warns results not restored.
After reopen the user must: rerun adjustment, reload CAD (unless `.wncad` saved),
re-decide exclusions/overrides/clusters, re-pick comparison baseline.

Autosave granularity (proven): 60 s debounce with stale-write reconciliation — but the
250 ms draft is **disabled while a named project is open**, so a crash inside the
60 s window loses edits exactly when most work is at risk.

## 10. Stale-result safety (fail-safe matters more than convenience)

`RunFreshness` (`appStateTypes.ts`) computed in `useAppRunWorkspaceReview.ts:189-204`
— verified **zero consumers in `src/components`** (only definition, hook, defaults,
tests). Editing obs/weights/control changes input fingerprint with no visible warning
and **does not block export**: `canExport={!!result}` (`src/components/app/AppShell.tsx:129`;
toolbar disables on `!canExport`, `AppToolbar.tsx:222-223`); `useExportWorkflow`
gates only on `if (!result || !runDiagnostics) return;` (`:130`) / `if (!result)
return;` (`:216`) — never consults freshness. `toggleExclude` is a bare id-set toggle
(`useAdjustmentWorkflow.ts:257`) — no rerun, no stale flag (verified). Settings/CRS/
instrument/policy changes do banner via `pendingRunSettingDiffs` + toolbar badge.
New import fully resets run state (safe). F2F catalog edits stamp stale + banner
(CAD side guarded). GNSS multifile has fingerprint-based `stale` flag + banner.

## 11. Undo / reversibility

CAD engine: unlimited session-only undo/redo; all entity/F2F/parcel ops via
`runCadCommand`; history reset on external authoritative update (rerun sync explicitly
not undoable). CONFIRMED: exclude-rerun, cluster apply/revert, import apply, source
delete, project delete. Reversible: exclusion toggle, overrides, cluster decisions.
UNCLEAR: obs/station "deletion" is textarea editing (browser undo only); opening
another drawing/project replaces state with no unsaved-changes prompt. IRREVERSIBLE:
delete project/file, reopen after lost autosave window. Undo correctly out of scope
for 17A.

## 12. Adjustment workflow UX

`blockingReasons` computed (`useAppRunWorkspaceReview.ts:180-188`) but **no component
consumes it**; the only visible gate is "≥1 checked project file" in the input
sidebar. Non-convergence = status card, no remediation hints. Hard failures
(e.g. singular matrix) set `pipelineState.error` but that field is **never rendered**
(toolbar shows generic 'Failed'). No pre-run "0 fixed stations" indicator; FIXED vs
CTRL is tooltip-only with no legend. Datum hard-fail explanation lives in
`solve-profile-diagnostics`, collapsed by default. Free-network LOO shifts show
per-row "unavailable" with no aggregate banner. Native full-Qxx eligibility reasons
collected, never surfaced. Preanalysis-vs-formal distinction is handled correctly
(predicted-precision wording, σ0²=1.0, LOCAL TESTING/RELIABILITY suppressed).

## 13. QC workflow

QC Overview card → LOO Exclude + Re-run = 3 actions. Row Evidence block (residual /
stdRes / local / redundancy / MDB / coord effect) is good; source-line link jumps to
input editor (leaves report, must return). Dead ends: selected obs not in LOO top
list; non-`ok` LOO rows disable Exclude; free-network shifts unavailable. **Review
Queue and Run Comparison panels are OFF by default** (Project Options → General) —
the purpose-built triage surface is hidden; QC must start from the report card.
`WorkspaceReviewActions` (prev/next suspect, jump-to-input) sits below tabs, easy to
miss.

## 14. CRS workflow

Assign = Project Options → Adjustment → Coordinate System; grid-scale/convergence
overrides = Project Options → GPS → Advanced (split navigation, both default OFF).
UI wording "Measured / Grid / Ellipsoidal" vs engine/report "ground" for the same
concept. "Override" labeling + default-OFF invites assuming grid-ground handling is
automatic when it is not. Terrestrial-CSV `options.crs` recorded, never set by any
caller/UI (always "caller-assigned, no transform"). LandXML CRS explicitly
metadata-only. Import Review shows no CRS/units metadata. Report labels
`LOCAL` / `GRID (<crsId>)`; listing prints `crsLabel || crsId || 'Local'`. **No export
path emits a CRS label**; adjusted-points export config buried under Other Files.
Invalid/unknown CRS silently falls back to default (`crsCatalog.ts`) with a datum
warning — no hard failure, risk of silently wrong CRS.

## 15. Terminology / discoverability / dead paths

Splits: observation/measurement, station/point, control/fixed, exclusion/inactive,
residual/correction, grid/ground (evidence in §14 + Import Review `M`=measurement
labels, FIXED/CTRL/ADJ badges, "Use" checkbox vs "(setup inactive)" vs "Exclude MTA
Obs"). Duplicates: "Save Drawing As" ≡ "Export Drawing" (same handler);
"Industry Standard Output" tab ≡ listing export; "Adjustment Report" tab ≡ text
export. Dead: forced `solveProfile='industry-parity'` with read-only UI row; Study
via full-page nav; `sparseProductionEligibility.ts` unwired by design.

## 16. F2F workflow

Pipeline `buildFieldToFinishPayload → applyFieldToFinishPayload → commit`
(`cadGeneration.ts`, `regeneration.ts:86`) is sound: deterministic code matching,
unknown codes preserved on F2F-UNMAPPED + warned, malformed linework never guessed,
deterministic label deconfliction. Gaps: production payload hard-codes
`removeEntityIds: []`; **`previewFieldToFinishRegen` / `applyFieldToFinishRegen`
verified to have no production callers** (only `src/dev/` + internal call at
`regeneration.ts:190`) — deleting a source code never removes stale linework in-app.
`markFieldToFinishManualOverride` / `detachFieldToFinishEntity` are dev-harness-only;
properties panel renders F2F state read-only ⇒ editing a GENERATED entity keeps
provenance GENERATED and the next rerun **silently overwrites** it (MANUAL_CONFLICT
unreachable in production). Only production feeder is a pasted CSV textarea —
project's own parsed coded points cannot be pushed in. **Catalog import has zero
callers** (verified: only definition at `catalogIo.ts:127`; export is surfaced) —
a previously exported catalog cannot be reloaded, blocking FXL-derived catalogs.

## 17. COGO / parcel / drafting

COGO (inverse, area, traverse, curves, offset, batch) records `CadCogoComputation`
with provenance and txt/csv/md reports — but has **no path into adjustment input**,
and the traverse draft's own angular/Bowditch/transit balance is a second,
unrelated "adjustment" notion. Parcel create/split/auto-layout/diagnostics present;
closure stored static at create/split with **no area-conservation check**; editing a
referenced point's x/y moves parcel geometry while stored area/perimeter/closure and
rendered labels keep old values (live overlay recomputes — two numbers on screen).
Drafting auto-builds from result on first open (no manual copy); model-space geometry
is associative in-CAD; **sheet annotations freeze vertex arrays** (`cadLabelEngine.ts`)
with no authoring UI — preview-only sheets.

## 18. Adjustment → drafting staleness (critical)

| Content | After re-adjust | Class |
|---|---|---|
| Linked F2F GENERATED points / linework / anchored labels | move in place, stable ids | ASSOCIATIVE |
| MANUAL_OVERRIDE / topology drift | stamped + banner, no silent regen | STALE-WITH-WARNING (partly unreachable, §16) |
| Parcels (geometry + stored metrics), parcel labels | never touched by sync | SILENTLY-STALE |
| Non-F2F drawing (first-open snapshot, ellipses) | no re-sync path; manual re-import | SILENTLY-STALE |
| Draft sheet labels | frozen `autoValue` | SILENTLY-STALE |

Worst case: `Import Adjusted Points` after a linked F2F commit **removes every**
`survey-point`/label/ellipse whose stationId is in the result — including F2F
GENERATED points — while keeping `fieldToFinishLink` and F2F linework; the next
rerun diffs zero deltas and reports CURRENT on stale geometry. No warning.

## 19. Data ownership

Authoritative: raw obs + adjusted stations = run result/project session (append-only
history); CAD geometry = `surveyCadState`; parcel = entity fields; catalog =
workspace state. Drift copies: result.stations vs up-to-three CAD `pt:<station>`
variants (only linked-F2F reconciled); parcel stored-vs-live metrics; catalog
provenance referencing a session-only catalog; `line.sourceObservationIds` dangling
after reruns.

## 20. Exports / deliverable

Per-format inventory (sources, units, precision, guards) in §21 of the working
report: adjusted-points CSV (no CRS, `toFixed(4)` / geodetic 9dp, transform validated
only), residuals CSV (per-row units, no guard), GeoJSON (no CRS, projected metres —
RFC 7946 violation), text report / industry listing (text/preset), network LandXML
(**no `<CoordinateSystem>`**, precision hard-coded industry-standard), QA bundle
(inherits all), CAD Export Center (CRS code path exists at `landxmlCad.ts:483-485`
but never populated — no `crs` producer anywhere), portable `.wnproj`/zip.

Deliverable = 6–8 discrete export actions across **two different export UIs** (toolbar
dropdown vs Export Center), each re-deriving coordinates; filenames share no stem
(`webnet-*`+date vs drawing name vs project name); QA bundle = N separate browser
downloads (may prompt/block → silent partial bundle); no shared metadata block
anywhere.

## 21. Error recovery / autosave

Malformed import / bad project file: errors shown, no state mutation (good). Singular
network: non-fatal result + diagnostics (good). Invalid CRS: silent fallback (risk).
Worker death without a protocol message: run promise pends forever — **no
`worker.onerror`/`onmessageerror` handler**; no React ErrorBoundary anywhere (render
crash blanks app; reload + draft recovery is the only path). Export errors caught +
noticed.

## 22. Large-job / UI-blocking / mobile / a11y

Solve runs on worker with superseded-run suppression (good). Main-thread blockers:
import parse + review-model build (one tick), portable save/zip, export
serialization, F2F regen, draft `JSON.stringify` + `localStorage.setItem`, report
"Show all" unbounded render (tables windowed, not virtualized). Input editor is
line-windowed (good). Mobile: **NOT TARGETED** (desktop `fixed inset-0 flex` shell,
viewport meta only, no PWA) — recommend stating explicitly. A11y: only GNSS modals
declare dialog semantics; main modals lack role/focus-trap; report rows mouse-only
(data reachable, row action not); notices lack live regions; Esc handling CAD/map/
GNSS only.

## 23. Surveyor-error hazards (ranked, safety first)

1. Stale-result export (§10). 2. Settings/units mismatch against stale result on
   export. 3. CRS-less machine artifacts + GeoJSON misplacement. 4. Dead CAD-LandXML
   CRS plumbing. 5. Grid/ground ambiguity. 6. Transform-section CSV mixing. 7. Hidden
   exclusions (React-state-only, no manifest in exports). 8. Silent auto-clear of
   exclusions/overrides on input change (transient notice only). 9. Duplicate-import
   double-count. 10. N-download bundles. (F2F/drafting staleness mitigated by banners
   except the §18 worst case.)

## 24. Corpus / action counts

A. clean terrestrial COVERED; B. blunder PARTIAL (paths covered, no canonical
clean/blunder pair pin); C. mixed GNSS COVERED; D. multi-file COVERED (flag-gated);
E. F2F topo COVERED; F. parcel COVERED CAD-side only; G. large PARTIAL by tier policy
(true-large belongs in evidence tier). Clicks: import→adjust 2; bad-obs→source 2–3;
adjust→draft 1–2 linked else manual; draft→export 2; revised→deliverable 4–5.

## 25. Top 10 product gaps (by workflow impact, safety first)

1. Stale/failed-solve export unguarded — SAFETY / LOW effort, LOW regression risk
   (gate on `runFreshness`/`success`, stamp run-id/input-hash into artifacts).
2. Adj→draft silent staleness + destructive adjusted-points import — SAFETY / MEDIUM
   (non-destructive import, parcel/annotation staleness marking, rerun drift check).
3. Silent import unit handling — SAFETY / MEDIUM (per-format unit prompts, kill the
   silent `'m'` defaults, surface units in Import Review).
4. Reimport double-count + silent station last-wins — SAFETY / MEDIUM (replace-not-
   copy reimport, terrestrial dup detection mirroring GNSS, dup-control warning).
5. CRS-silent exports + silent CRS fallback — SAFETY / LOW-MED (shared metadata
   block, `<CoordinateSystem>` + GeoJSON CRS handling, hard-fail or hard-warn
   unknown CRS).
6. CAD/saved-run persistence gaps + 60s blind window — BLOCKER / MEDIUM (persist
   surveyCad + saved runs + catalog in named/portable; close the draft-disabled gap).
7. F2F overwrite + no production regen + catalog import/persist — BLOCKER / MEDIUM
   (wire preview+confirm REGENERATE, UI override/detach, expose importCatalog,
   persist catalog, project→F2F point bridge).
8. Listing hard-coded `1:` file ordinal — CORRECTNESS / LOW (derive from
   `obs.sourceFile`, populate display-line map for all files).
9. 6–8-step deliverable, no zip, inconsistent stems — FRICTION / LOW-MED (zip QA
   bundle, unify stems, shared metadata).
10. Hidden blocking reasons/errors, Review Queue off by default, datum buried —
    FRICTION-DISCOVERABILITY / LOW (surface computed reasons, promote triage,
    auto-expand diagnostics on hard-fail with hints).

No composite score (per mission §37).

## 26. Recommended Phase 17B

**GO-17B-DATA-INTEGRITY** — stale-result / dependency integrity. Bounded scope:
export freshness + success gating; surface computed `runFreshness`/`blockingReasons`/
`pipelineState.error`; non-destructive adjusted-points import; parcel/annotation
staleness marking + open-time drift check; listing file ordinal fix; exclusion sets
staleness. Chosen for highest user value / risk reduction (fail-safe over
convenience), not ease. It dominates another solver optimization at this maturity:
silent-corruption and wrong-deliverable fixes beat marginal precision gains.

## 27. Reviewer gate

Independent reviewer: 15/15 GO, 0 fix rounds, no reviewer-made fixes. Conditions for
17B kickoff carried into this report: refreshed file cites (see §28) and the 3 known
study-desktop calibration failures treated as pre-existing.

## 28. Cite-verification notes (post-reviewer refresh)

All finding paths re-verified 2026-09-17 against HEAD `59604098` (== `592524ca`
production content + TODO.md line): `src/components/app/AppShell.tsx:129`,
`src/components/AppToolbar.tsx:222-223`, `src/hooks/useExportWorkflow.ts:130,216`,
`src/hooks/useAppRunWorkspaceReview.ts:180-210`, `src/appStateTypes.ts:136`,
`src/hooks/useAdjustmentWorkflow.ts:257` (bare toggle), `src/engine/fieldToFinish/
linkedRerunSync.ts`, `regeneration.ts:101,184,190` (no production callers outside
`src/dev/`), `src/engine/cad/cadAdjustedPointsImport.ts` (stationId-set removal),
`src/engine/industryListingClassicFormatters.ts` (`` `1:${sourceLine}` `` /
`` `1:${displayLine}` ``), `src/engine/terrestrialCsvImport.ts` (`?? 'm'`),
`src/hooks/projectWorkflowUtils.ts` (**corrected** — scout cited `src/engine/`
prefix, actual file lives in `src/hooks/`), `src/engine/fieldToFinish/catalogIo.ts:127`
(importCatalog definition; zero non-test callers verified). Line numbers are
approximate (±5); file paths exact.

## 29. Final decision

**GO-17B-DATA-INTEGRITY**
