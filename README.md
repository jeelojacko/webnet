# WebNet (industry-standard-style LSA)

Browser-based least-squares adjustment for mixed survey observations (TS distances/angles, GNSS baselines, leveling dH) inspired by industry-standard software.

## Quick Start

```bash
npm install
npm run dev
# npm run lint
# npm run test       # vitest watch
# npm run test:run   # vitest one-shot
# npm run test:cov   # vitest coverage
# npm run build
```

## Project Docs

- **User Guide**: [docs/USER_GUIDE.md](docs/USER_GUIDE.md) - **Start Here!**
- Agent guide: agents.md (context, stack, commands, architecture, next steps)
- Todo list: TODO.md (current roadmap and completed items)

## Examples

- A comprehensive example file is available at [public/examples/industry_demo.dat](public/examples/industry_demo.dat). You can load this file into WebNet to explore supported features.
- Total-station focused examples are available in `public/examples/`:
  - `ts_d_distances.dat` (D)
  - `ts_a_angles.dat` (A)
  - `ts_b_bearings.dat` (B)
  - `ts_v_verticals_delta.dat` (V in `.DELTA ON`)
  - `ts_dv_distance_vertical.dat` (DV)
  - `ts_m_measurements.dat` (M)
  - `ts_bm_bearing_measurements.dat` (BM)
  - `ts_traverse_tb_t_te.dat` (TB/T/TE traverse)
  - `ts_direction_sets_db_dn_dm_de.dat` (DB/DN/DM/DE direction set)
  - `ts_sideshots_ss.dat` (SS: legacy, `AZ=`, and `HZ=` modes)
  - `ts_triangulation_trilateration_2d.dat` (industry-standard-style combined triangulation/trilateration 2D network)
  - `ts_all_combined.dat` (all TS observation families in one adjustment)

## Status

- Core adjustment engine is in TypeScript modules under `src/engine` with React UI composed from `src/App.tsx` + `src/components`.
- Lint/build/test pass in CI; formatting via Prettier/lint-staged.
- Dev tooling audit upgrade applied: Vite `6.4.1`, Vitest `4.0.18`, and esbuild `0.25.12` (current `npm audit` clean).
- Parser: industry-standard-style inline options (.UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.MAPSCALE/.CURVREF/.REFRACTION/.VRED/.LWEIGHT/.NORMALIZE/.END/.LONSIGN/.I/.EDM/.CENTERING/.ADDC/.DEBUG/.AMODE/.TSCORR/.ROBUST/.ALIAS/.PRISM/.ROTATION/.LOSTSTATIONS/.QFIX/.AUTOSIDESHOT) plus C/E/CH/PH/EH and D/A/G/L/B/V/M/BM/TB/T/TE/DB/DN/DM/DE/SS records with per-component `!/*` fixity (`_` remains legacy-fixed when used alone, with warning), std errs (numeric/&/!/_), HI/HT capture, bearings/zeniths, inline `#` comments and `'Description` trimming, and ft<->m normalization (P/PH lat/long projected to local EN using first P as origin; .LWEIGHT applied as fallback for leveling with ft lengths converted to km; DV/M delta-mode emit distance+dH; DV/BM/M slope mode emit zeniths with face-2 weighting and derived stds; 2D `M` records now accept angle/dist sigma tokens without forcing a vertical token; distances use additive/propagated EDM modes; GNSS supports per-component sigmas with optional EN correlation; centering inflation can be disabled via `.CENTERING OFF` and explicit sigmas only inflate when `.ADDC ON`; debug logging includes per-obs w in rad/deg plus a `wnew ≈ w − A·dx` step check; `A` interpretation can be forced via `.AMODE` and AUTO mode now uses stricter classification tolerance; `.TSCORR` configures TS angular correlation blocks by setup/set scope with rho coefficient; `.ROBUST HUBER k` enables iterative robust downweighting; `.ALIAS` supports explicit alias maps plus PREFIX/SUFFIX/ADDITIVE rules, canonicalizes station and observation IDs before unknown construction, and records alias trace metadata (`aliasExplicitMappings`, `aliasRuleSummaries`, `aliasTrace`) used in report/listing exports; `.PRISM` now parses global/set-scope prism offset state with unit-safe diagnostics, applies scoped per-observation correction metadata in distance/vertical weighting paths, and annotates correction source+magnitude in report/export/listing adjusted-observation rows; `.ROTATION` now parses cumulative plan-rotation state (DD/DMS compatible, wrap-normalized) and applies it to azimuth-bearing observations (`B`, `BM`, `A` in `DIR` mode, and `SS AZ=`) for downstream modeling, with plan-rotation diagnostics in report/export/processing-summary/industry-listing outputs; `.LOSTSTATIONS` now tags station IDs as lost, persists station metadata flags through solve results, surfaces them in run/report/listing diagnostics, and supports project-option visibility toggles to show/hide lost stations in map, listing, and export outputs; `.QFIX` now supports inline fixed-sigma overrides (`.QFIX` or `/QFIX`) for linear and angular `!` sigma tokens, drives weighting with configurable constants instead of hard-coded fixed sigmas, and reports active constants in solve-profile/report/export/listing outputs; 3D runs automatically hold heights for stations that have no vertical-sensitive observations; non-sideshot observation references now auto-create missing stations with default approximate coordinates when no `C/P/E` record exists; sideshots support optional explicit azimuth tokens (`AZ=`/`@`) plus setup-based horizontal angle tokens (`HZ=`/`HA=`/`ANG=`) tied to current backsight, are excluded from adjustment with occupy/backsight validation, then reported post-adjust as computed coordinate/precision; mixed-face traverse/direction shots rejected when .NORMALIZE OFF; TE legs log closure residuals/misclosure vectors/geometry when available). Direction sets (DB/DN/DM) now keep raw circle readings internally, reduce face pairs by target into set means with reduced sigmas, track pair-delta/per-face spread/raw-max residual metrics, and emit structured reject diagnostics (line/set/record/expected-vs-actual face) while still solving per-set orientation parameters. Header toggles expose coord/order/delta/map/normalize/.LWEIGHT/lon-sign defaults; see TODO.md for remaining codes to support. Parser now warns when `.ORDER` is missing (defaults to EN).
- Parser: `.ORDER` now accepts angle triplet order tokens (`ATFROMTO`/`FROMATTO`) and `.UNITS` now accepts angle-unit tokens (`DMS`/`DD`) for survey angle parsing.
- Parser: direction sets now support explicit processing mode (`directionSetMode`): default reduced-by-target behavior or raw-per-shot direction equations (no target reduction) for Industry Standard-style parity workflows.
- Parity tests: `.ALIAS` now has mixed-network phase coverage with conventional + GNSS + leveling alias remap fixtures (`tests/fixtures/alias_phase4_mixed.dat`) to verify canonical IDs and traceability across multi-section inputs.
- Cluster detection (Phases 1-4): post-adjust candidate detection is available with deterministic cluster keys, selectable linkage mode (`single`/`complete`), and 2D/3D tolerances; dual-pass solving runs pass-1 detection plus pass-2 approved-merge aliasing (`clusterApprovedMerges`) with reproducible pass diagnostics; report UI includes a cluster review/override table to approve/reject candidates and select retained canonical point IDs before rerun; reporting includes cluster outcome sections (applied merges, per-merge coordinate deltas from retained points, and rejected proposals) across report, processing summary, and listing/export outputs. Project Options -> Adjustment now includes a cluster-detection ON/OFF toggle, and the report header includes a top-level `Revert cluster merges` action.
- Auto-adjust workflow (Phases 1-4): Project Options -> Adjustment includes an `Auto-Adjust` toggle (default OFF, next to Cluster Detection) plus controls for `|t|` threshold, max cycles, and max removals/cycle; candidate selection is local-test aware with redundancy guards and deterministic tie-breaks, run/report/listing outputs include per-cycle diagnostics plus removed-observation line traceability, and parser/CLI-style command parity is supported via `.AUTOADJUST` and `/AUTOADJUST` directives with fixed-fixture regression coverage.
- Auto-sideshot detection (Phases 1-4): Project Options -> Adjustment now includes an `Auto-Sideshot` toggle (default ON) and parser command parity via `.AUTOSIDESHOT`/`/AUTOSIDESHOT`; when enabled, solver computes redundancy-aware candidate detection for non-redundant `M` records (with fixed-control target safety exclusion), emits run-log diagnostics, surfaces candidate tables in report/summary/export/listing outputs, annotates adjusted-observation rows with auto-sideshot markers (`AUTO-SS` / `[auto-ss]`), and is covered by parity fixture tests (`tests/fixtures/auto_sideshot_phase4.dat`).
- Instrument modeling: Project Options -> Instrument now manages an editable project instrument library (including New Instrument creation) with unit-aware fields for EDM/angle/direction/azimuth, centering (horizontal + vertical), zenith, and elevation-difference constants/ppm; 3D-only fields are disabled in 2D mode.
- Instrument defaults: when no precision values are provided by instrument or observation, parser defaults now remain zero (no hardcoded 5"/0.005m/0.01m fallbacks), and UI-provided project instruments are applied during parsing/adjustment with precedence over inline `I` rows of the same code.
- Engine: honors 2D mode by solving only XY, skipping vertical observations (lev/zenith) with a log note.
- Engine: logs basic network diagnostics (e.g., unknown stations with no observations or direction-only targets observed from a single occupy).
- Engine: reports standardized residuals (Qvv-based), redundancy numbers, chi-square test with 95% critical bounds + variance-factor interval, per-type residual summaries, local-test outcomes + MDB values, weighted control-coordinate constraints (from coordinate std errors), normal-matrix condition diagnostics, point precision (σN/σE/σH + ellipse azimuth), and relative precision between unknown points.
- Engine: when DOF is zero/non-positive, point precision now uses a-priori variance-factor scaling (`sigma0^2 = 1`) so radial/non-redundant setups still produce non-zero coordinate standard deviations/ellipses.
- Engine: angular centering inflation now uses a geometry-aware model for turned angles (includes ray-distance correlation via included-angle cosine term), improving Industry Standard stochastic parity for classical TS networks.
- Engine: reports per-direction-set prefit summary (mean/RMS/max in arcseconds) based on initial coordinates.
- Engine: reports direction-set diagnostics (raw/reduced counts, face balance, orientation quality, face-pair deltas, raw-max residual quality), setup summaries by occupy station, setup-level suspect metrics (RMS/Max standardized residuals, local-test fail counts, worst observation trace), and traverse diagnostics including closure ratio when geometry permits.
- Engine: reports direction-target repeatability diagnostics (raw spread, raw-max residual, face-pair delta, per-face spreads, local-test/MDB cues, ranked suspect score) to help isolate weak sets/targets inside direction workflows.
- Engine: reports multi-set direction repeatability trends by occupy-target (cross-set residual range/RMS, spread trends, face-balance counts, ranked suspects) to highlight unstable targets across repeated setups.
- Engine: reports residual-quality diagnostics for blunder screening (|t| distribution bins, local-test fail totals, redundancy weakness counts, worst-observation traceability, and by-type screening stats).
- Engine: supports TS angular correlated weighting blocks (`.TSCORR`) by setup/set scope and includes correlation diagnostics (groups, equation/pair counts, mean off-diagonal weight) in report/export/logs.
- Engine: supports robust Huber reweighting (`.ROBUST`) with per-iteration downweight diagnostics and top downweighted rows in logs/report/export.
- Engine: traverse diagnostics now include linear ppm, angular/vertical closure checks, configurable threshold pass/warn flags, and ranked per-loop closure severity for faster traverse QA.
- UI/Report: includes automated suspect impact analysis that runs what-if exclusion trials for top suspects and ranks expected impact (dSEUW, dMax|t|, chi-square change, max coordinate shift), with one-click exclude + re-run.
- UI/Report: when robust mode is enabled, includes side-by-side robust vs classical top-suspect ranking comparison.
- UI/Report: traverse section now includes ranked closure loops and a dedicated “Traverse Closure Suspects” table.
- UI/Report: direction workflow now includes richer reduction-quality columns (RawMax, PairDelta, F1/F2 spreads) plus a dedicated “Direction Reject Diagnostics” table for skipped shots.
- UI/Report: includes a dedicated residual diagnostics section summarizing global outlier/redundancy health and a by-type screening table for faster QA triage.
- UI/Report: column headers now include hover tooltips for technical metrics, adjustment summary cards include SEUW/chi-square tooltip explanations, and solver controls are exposed through an industry-style tabbed Project Options modal (with placeholders for upcoming industry option families).
- UI/Run state: when the input text changes between runs, stale exclusion/override edits are auto-cleared before solving (with a processing-log note) so prior dataset edits cannot contaminate new files; loading a new file also clears active exclusions/overrides.
- Engine: applies map-scale reduction to horizontal distances when map mode is active, and supports optional zenith curvature/refraction corrections (`.CURVREF`/`.REFRACTION` + `.VRED CURVREF`).
- Engine: computes post-adjusted sideshot coordinate/precision rows from excluded SS observations; azimuth source is tracked (`explicit`, `setup`, or `target`) and when azimuth cannot be derived, the limitation is reported explicitly.
- Defaults: coord=3D, order=EN, lon sign=west-negative, delta mode slope (zenith), map mode off, normalize on.
- Startup defaults: run profile=`industry-parity`, cluster detection=`OFF` (toggle in Project Options -> Adjustment), and default project instrument `S9` (`Trimble S9 0.5"` stochastic baseline values).
- UX: .dat upload, export results as text (unit-correct, source-line traceable, sorted by |StdRes| with top suspects), refresh to last-run input, exclusion toggles with re-run, editable obs values/weights, true unit conversion (ft/m), industry-style Project Options modal with tabbed settings (Adjustment/General/Instrument/Listing/Other Files/Special/GPS/Modeling) including mapped TS reduction controls, interactive map/ellipse view with wheel zoom, middle-button pan, middle-double-click reset-to-extents, zoom-aware symbol scaling, full-height map viewport usage, and zoom-adaptive label readability.
- UX: report navigation now includes a dedicated `Processing Summary` tab with industry-style monospaced run output (load/check flow, iteration lines, per-type error-factor summary, chi-square pass/fail line, profile flags, elapsed time, and processing notes from the run log).
- UX/Parity: per-type statistical summaries now use weighted residual contributions (`vTPv`) by observation family with industry-style error-factor normalization (group RMS scaled to global DOF), and chi-square bounds are surfaced in both error-factor form and variance-factor form for direct industry-style comparison.
- UX: report navigation now includes a dedicated `Industry Standard Output` tab showing an industry-style listing text view, and export supports format selection (`WebNet` or `industry-style`) before saving `.txt` output.
- UX: industry-style output now uses explicit padded column tables (readable N/E and observation columns), splits adjusted-observation output into dedicated Angle/Distance/Direction/Azimuth+HD sections, drives azimuth/relative-ellipse rows from observation relationship pairs (including fixed-to-adjusted links), and expands error propagation with station and relative 95% ellipse sections; the processing-log block is omitted from industry-style listing output.
- UX: settings now include an Industry Standard parity profile that forces classical solving, raw direction-set adjustment, and industry-like default instrument precision fallback when files omit explicit instrument assignments.
- UI/Report: includes a dedicated solve-profile diagnostics section (run-pinned parity/reduction/stochastic settings) and mirrors the same checklist in exported `.txt` reports.
- UI/Report/Export: solve-profile diagnostics now include active default stochastic model details (instrument EDM/angle/centering defaults, EDM mode, centering-inflation mode) plus default-sigma usage counts by observation type.
- Performance guards added (conditioning/residual warnings); see TODO.md for any future worker offload ideas.
- Parity: `tests/fixtures/industry_parity_phase2.dat` + `tests/fixtures/industry_parity_phase2_expected.json` + `tests/ts_parity.test.ts` pin industry-style benchmark behavior (raw directions + classical weighting + industry default instrument fallback) for summary metrics, selected coordinates, and residual signatures.
- Listing format regression: `tests/industry_listing_format.test.ts` + `tests/fixtures/industry_listing_phase5_expected_headings.json` lock industry-style output section order, key headings, spacing separation, and representative relative-ellipse row formats.
- Parity planning: TODO now includes an Industry Standard gap list prioritized by workflow impact (Conventional first, then GPS, then Leveling).
- Parity planning: every item in the Industry Standard gap list now includes phased implementation steps for execution sequencing and milestone tracking.
