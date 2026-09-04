# WebNet

WebNet is a browser-based least-squares adjustment app for mixed survey observations. It supports total station, GNSS, and leveling workflows in a browser-first UI with reporting, QA review, mapping, and exports.

## Prerequisites

- Install the current Node.js LTS release. `npm` is included with Node.js.
- Use a terminal that can run `npm` commands.

## Get It Running

1. Clone or download this repository.
2. Open a terminal in the repository root.
3. Install dependencies:

```bash
npm install
```

4. Start the development app:

```bash
npm run dev
```

5. Open the local Vite URL shown in the terminal.
   Usually this is `http://localhost:5173`.
   The study module is available at `http://localhost:5173/study`.

Successful startup looks like:

- the terminal shows a local development URL
- the browser opens the WebNet app shell
- the toolbar shows `Project Options`, `Survey CAD`, `Study`, and `Adjust`
- the workspace tabs are available, and `Map & Ellipses` can be opened before the first run to load input points for planning-map work

## Recommended First Steps

- Read [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for the full beginner walkthrough.
- Start with [public/examples/mixed_grid_tutorial.dat](public/examples/mixed_grid_tutorial.dat) for a reproducible mixed TS + GNSS + leveling adjustment on a Canada-first projected grid CRS.
- Use [public/examples/preanalysis_network_plan.dat](public/examples/preanalysis_network_plan.dat) for predicted-precision / planning mode.
  In preanalysis mode, the report can now recommend added repeated setup sets plus obstacle-aware synthetic brace, promoted-setup, synthetic-setup, and cross-tie scenarios near weak geometry, and estimate how many added scenarios are needed to reach an optional planning threshold. The 2D `Map & Ellipses` tab can be used before the first run to load raw input points, show an OSM basemap, auto-fetch OSM building/wooded obstacle footprints for georeferenced runs near the measured network bounds, and store user-drawn or edited blocked polygons that feed back into the planner.
- Use [public/examples/nb double stereo.dat](public/examples/nb%20double%20stereo.dat) for a projected-grid total station example focused on TS workflow only.
- Keep [public/examples/industry_demo.dat](public/examples/industry_demo.dat) as a broader legacy/general sample, not the recommended first tutorial dataset.
- In `Project Options -> Project Files`, use `Example Projects` to open the built-in `Pre-analysis`, `Combined`, or `Combined (split files)` project workspaces.
- Portable project exports use sanitized project names for `.wnproj` files and keep UI theme local. Survey CAD drawings are saved separately as `.wncad` files.

## Validate

Run the standard repo checks before finishing a batch:

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

The Git pre-commit hook runs `npm run lint` and `npm run typecheck` by default. Set `WEBNET_PRECOMMIT_FULL=1` when you want the hook to also run `npm run test:run`; completed batches should still run the full validation list above before commit.

Parity-sensitive work also requires:

```bash
npm run parity:industry-reference
```

Synthetic CRS validation remains separate:

```bash
npm run harness:crs:synthetic
```

For browser-only map interaction and OSM-basemap profiling regressions, there is also a focused Chromium harness:

```bash
npx playwright install
npm run test:map-browser
```

## Main Docs

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) - beginner install-to-adjustment guide
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - module layout and data flow
- [docs/CURRENT_BEHAVIOR.md](docs/CURRENT_BEHAVIOR.md) - maintained feature inventory and current workflow contract
- [docs/IMPORT_WORKFLOW.md](docs/IMPORT_WORKFLOW.md) - staged import and reconciliation workflow
- [docs/PARITY_WORKFLOW.md](docs/PARITY_WORKFLOW.md) - parity-sensitive validation workflow
- [docs/STUDY_MODULE.md](docs/STUDY_MODULE.md) - local-first statute and survey-law study module
- [docs/STUDY_AI_AUTHORING.md](docs/STUDY_AI_AUTHORING.md) - provider-neutral AI Study authoring workflow and validation
- [docs/STUDY_CONTENT_PIPELINE.md](docs/STUDY_CONTENT_PIPELINE.md) - official NB Study content ingestion commands, reports, and corpus scope rules
- [docs/INLINE_OPTION_APPLICATION_MATRIX.md](docs/INLINE_OPTION_APPLICATION_MATRIX.md) - inline option application reference
- [docs/run-semantics.md](docs/run-semantics.md) - ordered checked-file project run rules
- [docs/webnet-survey-cad-master-plan.md](docs/webnet-survey-cad-master-plan.md) - Survey CAD architecture and phased roadmap
- [docs/webnet-survey-cad-todo.md](docs/webnet-survey-cad-todo.md) - Survey CAD phased implementation checklist
- [TODO.md](TODO.md) - active implementation checklist

## High-Level Workflows

- Edit or load adjustment input in the browser.
- Configure solve settings in `Project Options`.
- Open built-in example projects from `Project Options -> Project Files -> Example Projects`.
- Open `Survey CAD` from the toolbar to work in a standalone CAD drawing. Use the CAD file controls for `New Drawing`, `Open Drawing`, `Save Drawing`, `Export Drawing`, and `Import Adjusted Points`; adjustment projects no longer auto-own CAD state.
- Open `Study` from the toolbar, or visit `/study`, for a separate local-first New Brunswick statute and survey-law study app. Its Manage page can import the generated official NB law content package for offline legal reading, reset local Study data for testing, use worker-backed indexed Library search, source-linked study units with editable answer rubrics and preview mode, deterministic editable study-unit drafts, custom unlinked study units, provider-neutral AI authoring proposals under Authoring, and FSRS-backed due review sessions with non-mutating practice/preview paths, next-review empty-state timing, and persisted latest-rating undo. The separate Exam Curriculum page (`/study/exam-curriculum`) is a read-only open-book exam curriculum with an All / Tier A / Tier B / Tier C / Tier D / Navigation / DRILL filter (157 units: 51 Tier-A, 43 Tier-B, 21 Tier-C orientation, 6 Tier-D awareness, 12 cross-document Navigation routing units, 24 lookup drills), unit metadata with a visible REMEMBER vs LOOK HERE split, multi-document Navigation display, drill fact-pattern/task/answer-key displays with statute-reader deep links, and a dedicated DRILL section, independent of the Study Map and AI-authored units.
- For the Study official NB law pilot content pipeline, use `npm run study:fetch-nb-laws`, `npm run study:normalize-nb-laws`, and `npm run study:build-content-pack`. For the Phase 4A NB SIT statute corpus, use `npm run study:corpus:inventory` first; current fetch succeeds for confirmed `laws.gnb.ca` successors and ANBLS PDFs, while normalize/build intentionally block until the bilingual ANBLS PDFs have reliable English-only extraction selectors. Use `npm run study:audit-generation` to generate developer QA reports for deterministic source-linked study-unit generation. These development commands fetch only manifest-listed official documents when fetching is explicitly run and do not run during normal browser use. For the open-book Exam Curriculum manifest, use `npm run study:exam-curriculum:build`; it deterministically resolves the 157 curated units (51 Tier-A + 43 Tier-B + 21 Tier-C + 6 Tier-D + 12 Navigation + 24 DRILL lookup drills) against the authoritative NB SIT statute corpus package and writes `study-content/exam-curriculum/nb-sit-exam-curriculum-v1.json` plus dated reports under `reports/exam-curriculum/` (with per-tier breakdowns and Tier-A/B/C/D/NAV/DRILL projection hashes and source-coverage-by-document metrics), with no model inference.
- For AI-assisted Study authoring infrastructure, use `npm run study:ai:prepare-map`, `npm run study:ai:prepare-units`, `npm run study:ai:status`, `npm run study:ai:validate-results`, `npm run study:ai:validate-unit-proposals`, and `npm run study:ai:pilot-report`. These commands produce, validate, and report on external JSONL jobs/results under `study-content/ai/`; Study Map jobs default to the v3 source-bounded prompt spec with source-focus and target-source grounding validation, `prepare-map -- --strategy full-corpus` derives the complete size-batched NB SIT Study Map job set and review-report scaffold, Unit Authoring jobs default to v4 approved-focus grounding and evidence-completeness guidance, require approved Study Map proposals before Unit Authoring job prep, do not require an OpenAI API key, and do not run during normal browser use.
- For corrected full-corpus Study Map V2 continuation artifacts, use `npm run study:ai:v2-artifacts` after preparing `ai-map-4c12-full-corpus-v2`. Later local OpenAI-compatible authoring uses `npm run study:ai:local-map`; see [study-content/ai/LOCAL_MAP_AUTHORING.md](study-content/ai/LOCAL_MAP_AUTHORING.md).
- In `Run Mode = Preanalysis`, optionally set a planning accuracy threshold and max added sets, then review obstacle-aware planning recommendations in the report and on the 2D map.
- Run `Adjust`.
- Review results in `Adjustment Report`, `Processing Summary`, `Industry Standard Output`, and `Map & Ellipses`.
- Export adjusted points, CSV, GeoJSON, LandXML, or text outputs from the toolbar/export controls.

## CLI

Run a batch adjustment with:

```bash
npm run adjust:cli -- --input path/to/file.dat
```

Common outputs include summary, JSON, listing, and LandXML. Use the CLI help and the docs above for detailed run-mode guidance.
