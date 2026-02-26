# Agents Guide - WebNet (industry-standard-style LSA clone)

## Project Context

- Goal: browser-based clone of industry-standard software performing mixed-observation least-squares adjustment (TS distances/angles, GNSS baselines, leveling dH) with control points, error ellipses, residuals, and basic outlier cues.
- Current behavior (TypeScript): parses industry-standard-style text blocks (instrument library with EDM const/ppm, HZ/VA precision, centering errors, control, D/A/G/L/B/V/M/BM/TB/T/TE/DB/DN/DM/DE/SS observations + inline options .UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.MAPSCALE/.CURVREF/.REFRACTION/.VRED/.LWEIGHT/.NORMALIZE/.END/.LONSIGN/.I/.EDM/.CENTERING/.ADDC/.DEBUG/.AMODE/.TSCORR/.ROBUST/.ALIAS/.PRISM/.ROTATION/.AUTOSIDESHOT, C/E/CH/PH/EH records with per-component `!/*`fixity where lone`\*`remains legacy-fixed with warning, and std err tokens; inline`#`comments /`'Description`trimmed; P/PH lat/long projected to local EN via first P origin; D/M/BM/DV capture HI/HT and delta mode, DV/M in delta-mode emit distance+dH; DV/BM/M slope emit zeniths with face-2 weighting and derived stds; 2D M lines accept sigma tokens after distance without forced zenith; EDM mode supports additive/propagated; GNSS supports per-component sigmas with optional EN correlation; centering can be disabled via`.CENTERING OFF`and explicitly-entered sigmas only inflate when`.ADDC ON`; debug logging includes per-obs w in rad/deg plus a step check (`wnew ≈ w − A·dx`); 3D runs auto-hold heights for stations with no vertical-sensitive observations; non-sideshot observations auto-create missing station records with default approximate coordinates; `A`records support explicit`.AMODE`control and stricter AUTO classification;`.TSCORR`adds setup/set-scoped TS angular correlation weighting with configurable rho and diagnostics;`.ROBUST`adds iterative Huber downweighting with per-iteration stats and top-downweighted rows; `.ALIAS` supports explicit mappings and PREFIX/SUFFIX/ADDITIVE rules, then canonicalizes station/observation IDs before unknown building; `.PRISM` parses global/set prism state with unit-safe diagnostics, attaches scoped correction metadata used by distance modeling and zenith weighting paths, and now annotates correction source+magnitude in report/export/listing adjusted-observation rows; `.ROTATION` now parses cumulative plan-rotation state (DD/DMS compatible, wrap-normalized) and applies it to azimuth-bearing observations (`B`, `BM`, `A` in `DIR` mode, and `SS AZ=`) for downstream modeling, with plan-rotation diagnostics in report/export/processing-summary/industry-listing outputs; .LWEIGHT applied for leveling weights with ft lengths converted to km; bearings/zeniths solved; DB/DN direction sets ingest raw circle readings, reduce face-paired shots by target (with reduced sigmas), track reduction-quality metrics (raw max residual, face-pair delta, per-face spread), emit structured direction reject diagnostics, and solve per-set orientation parameters with raw-vs-reduced diagnostics; map mode now supports grid scale reduction for horizontal distances; optional curvature/refraction vertical reduction is supported via`.CURVREF`/`.REFRACTION`+`.VRED CURVREF`; sideshots support optional explicit azimuth tokens (`AZ=`/`@`) and setup-based horizontal-angle tokens (`HZ=`/`HA=`/`ANG=`) tied to current backsight, are excluded from adjustment with occupy/backsight validation, and emitted in a post-adjust section with computed coordinate/precision (including azimuth source) where available; mixed-face traverse/direction shots rejected when .NORMALIZE OFF; TE closure legs log residuals/misclosure vectors/geometry when available), warns when `.ORDER` is missing (defaults to EN), normalizes to meters/radians, runs iterative adjustment (2D mode drops height parameters and skips vertical obs), logs basic network diagnostics for under-observed stations plus per-direction-set prefit/residual summaries, direction-target repeatability diagnostics (raw spread/raw-max residual/face-pair delta/per-face spread, face balance, local-test/MDB, suspect scoring), multi-set direction repeatability trends by occupy-target (cross-set range/RMS and suspect ranking), setup summaries with setup-level suspect metrics (RMS/Max standardized residuals, local-test fail counts, worst-observation traceability), and expanded traverse closure diagnostics (ratio/ppm/angular/vertical checks, threshold pass-warn flags, per-loop severity ranking and suspect cues), applies overrides/exclusions, applies weighted coordinate/elevation control constraints from station std errors, reports SEUW/DOF plus normal-matrix condition diagnostics, standardized residuals (Qvv), redundancy numbers, chi-square test with 95% critical bounds and variance-factor interval, local-test outcomes with MDB values, point precision (σN/σE/σH + ellipse azimuth), relative precision between unknown points, adjusted coordinates, error ellipses, residual diagnostics summaries (|t| bins/local-fail counts/redundancy weakness plus by-type screening), residual tables sorted by |StdRes| with source-line traceability, and a processing log. UI adds automated suspect-impact what-if exclusion scoring (dSEUW/dMax|t|/chi-square change/unknown shift + one-click exclude+rerun), report-header hover tooltips for technical fields (including SEUW/chi-square labels), hover-tooltips for settings controls in an industry-style tabbed Project Options modal, robust-vs-classical top-suspect comparison when robust mode is enabled, dedicated traverse loop/suspect tables, editable observation tables, parse-mode toggles (.DELTA/.MAPMODE/.NORMALIZE/.LWEIGHT/.COORD/.ORDER/.LONSIGN/.AMODE + TS correlation/robust controls) grouped across Project Options tabs (Adjustment/General/Instrument/Listing/Other Files/Special/GPS/Modeling), re-run with exclusions, auto-clears stale exclusions/overrides when input changes between runs (with log note), report navigation tabs for Adjustment Report + Processing Summary + Industry Standard Output + Map/Ellipses, map/ellipse view with wheel zoom + middle-drag pan + middle-double-click reset-to-extents + zoom-aware symbol scaling + full-height viewport usage + zoom-adaptive label readability, export results as text with selectable format (unit-correct WebNet report or industry-style listing), refresh-to-last-run, and seeded demo + TS-per-record example datasets. In parity workflows, angle centering inflation uses a geometry-aware correlated-ray model to better match industry-style stochastic behavior.
- Current behavior also includes `.ORDER` station-triplet token support (`ATFROMTO` / `FROMATTO`), `.UNITS` angle-unit token support (`DMS` / `DD`), direction-set processing mode support (reduced-by-target or raw per-shot), `.ALIAS` parse-state diagnostics (`aliasExplicitCount`, `aliasRuleCount`, `aliasExplicitMappings`, `aliasRuleSummaries`, `aliasTrace`) plus report/export alias-trace sections showing source alias -> canonical references with line/context traceability, run-pinned solve-profile diagnostics surfaced in report/export (profile, direction-set mode, stochastic/reduction switches, industry fallback, angle centering model), explicit default stochastic-model reporting (active instrument EDM/angle/centering defaults + centering/EDM modes), default-sigma usage counts by observation type, a-priori precision scaling fallback for zero/non-positive DOF so radial/non-redundant setups still report non-zero coordinate standard deviations, and Listing File project-options controls that directly configure industry-style output section visibility/sorting/row limits.
- Current behavior also includes an industry-style listing-output readability overhaul: explicit padded column rendering for coordinates/observation tables (no concatenated numeric fields), adjusted-observation sections split by family (Angles, Distances, Directions, Azimuths+Horizontal Distances with relative azimuth confidence), relationship-pair-driven azimuth/relative-ellipse rows (including fixed-to-adjusted station links), and expanded error-propagation output with station and relative 95% ellipse sections; processing-log lines are omitted from industry-style listing output.
- Current behavior also includes Phase 5 listing-format regression coverage (`tests/industry_listing_format.test.ts`) with fixture-locked heading order and row-format/spacing checks to prevent column-concatenation regressions in industry-style output.
- Current behavior also includes parity fixtures/tests for mixed `.ALIAS` scenarios across conventional + GNSS + leveling records (`tests/fixtures/alias_phase4_mixed.dat`) to keep canonical-ID remapping and alias traceability stable across multi-section inputs.
- Current behavior also includes cluster-detection Phases 1-4 diagnostics/workflow: post-adjust cluster candidate detection with deterministic keys (`CL-<n>-<rep>`), linkage mode (`single` or `complete`), and coord-mode-aware tolerances (2D/3D), plus dual-pass solving when approved merges are supplied (`clusterApprovedMerges`: pass-1 detect, pass-2 apply merges) surfaced in report/processing summary/export outputs and run logs, a report-side review/override table where users can approve/reject candidate clusters and choose retained canonical points before rerun, cluster-outcome reporting for applied merges (with per-merge coordinate deltas from retained points) and rejected proposals, a Project Options -> Adjustment cluster-detection ON/OFF toggle, and a top-level report action to revert applied cluster merges.
- Current behavior also includes a full Project Options instrument editor workflow: users can create/select instruments in UI, edit EDM/angle/direction/azimuth/zenith/centering/elevation-difference parameters with unit-aware labels and 2D/3D field gating, and run solves with UI instruments taking precedence over inline `I` rows for matching codes. Precision defaults are now zero when no instrument/obs sigma is provided (no hardcoded 5"/0.005m/0.01m fallbacks).
- Current behavior startup defaults now set run profile to Industry Standard parity, cluster detection to OFF (user-toggle in Project Options -> Adjustment), and seed the project instrument library with `S9` (`Trimble S9 0.5"`) as the default-selected instrument baseline.
- Current behavior also includes Auto-Adjust Phases 1-4 workflow support in Project Options -> Adjustment (default OFF, adjacent to cluster detection toggle): configurable `|t|` threshold, max cycles, and max removals per cycle; candidate selection is local-test aware with redundancy guards and deterministic tie-breaks; per-cycle diagnostics and removed-observation line-trace listings are emitted in logs/report/listing output when enabled; parser/CLI-style parity supports `.AUTOADJUST` and `/AUTOADJUST` directive forms with fixed-fixture regression tests.
- Current behavior also includes automatic sideshot detection Phases 1-4 for non-redundant `M` records: post-adjust redundancy-aware candidate detection with fixed-control target safety exclusion, run-log summaries, report/processing-summary candidate tables, export/listing sections for candidate traceability, and adjusted-observation row annotations (`AUTO-SS` / `[auto-ss]`), plus Project Options/parse-state toggle support (`Auto-Sideshot` UI control and `.AUTOSIDESHOT`/`/AUTOSIDESHOT` parser directives, default ON), with parity regression fixture coverage in `tests/fixtures/auto_sideshot_phase4.dat`.
- Current behavior also includes industry-style weighted statistical summaries computed from per-observation `vTPv` contributions by family (Angles/Directions/Distances/etc.) with industry-style group error-factor normalization (group RMS scaled by `sqrt(totalCount/dof)`), with chi-square bounds surfaced in both error-factor and variance-factor forms in Processing Summary and listing/export views.

## Tech Stack

- Runtime: Node 18+ (ESM). Bundler: Vite 6.
- UI: React 19.2 (hooks), TailwindCSS 3.4 (classes in TSX, base in src/index.css), Lucide icons.
- Language: TypeScript 5 (strict), TSX entrypoints.
- Tooling: ESLint 9 (flat config), Prettier 3 + lint-staged + Husky, Vitest 4, PostCSS + Autoprefixer.
- Dependencies: react, react-dom, lucide-react.
- Dev deps: Vite + @vitejs/plugin-react, ESLint plugins (react, react-hooks, react-refresh), Tailwind/PostCSS, Vitest, TypeScript.
- Optional improvements: Web Worker/WASM path for large networks; keep Vite unless routing/server needs appear.

## Code Style

- TypeScript/React with functional components and hooks; prefer pure helpers and small components.
- Naming: camelCase for vars/functions; UPPER_SNAKE for constants; React components PascalCase.
- Formatting: Prettier defaults (2-space, semicolons); Tailwind utility classes for styling (avoid inline styles).
- Lint: ESLint flat config + react-hooks/refresh; `no-unused-vars` allows leading `_` for intentionally unused args. Keep TS strict; avoid `any` - prefer shared types/helpers.
- Data/units: calculations normalize to meters/radians internally; unit conversions (ft <-> m) happen at parse/override/display boundaries. Angle conversions via `dmsToRad`/`radToDmsStr`; keep station/obs ids as strings.

## Commands

```bash
npm install      # install deps
npm run dev      # start Vite dev server
npm run lint     # ESLint over repo
npm run test     # Vitest (watch)
npm run test:run # Vitest (CI/one-shot)
npm run build    # production build
npm run preview  # preview built assets
npm run format   # Prettier write
npm run format:check # Prettier check
```

## Architecture

- Root configs: vite.config.js, tailwind.config.js, postcss.config.js, eslint.config.js, tsconfig.json.
- Entry: src/main.tsx renders <App /> with src/index.css (Tailwind base).
- Styles: src/index.css Tailwind directives + Vite defaults; src/App.css is legacy template (not imported).
- Assets: public/vite.svg, src/assets/react.svg (template).
- Core (TypeScript):
  - Types: src/types.ts for stations, observations, instruments, results, parse options, overrides.
- Math helpers: src/engine/matrix.ts (zeros/transpose/multiply/inv), src/engine/angles.ts (RAD/DEG/SEC, dms helpers).
- Parser: src/engine/parse.ts ingests industry-standard-style text with inline options (.UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.MAPSCALE/.CURVREF/.REFRACTION/.VRED/.END/.AMODE/.TSCORR/.ROBUST/.ALIAS), per-component fixity via `!/*`(lone`\*`legacy-fixed with warning), inline`#`comments /`'Description` trimming, C/E records (fixity/std errs, NE/EN order, ft<->m), D/A/G/L observations with instrument lib lookups (GNSS per-component/correlation support), and returns stations/unknowns/obs/logs. Direction sets are reduced by target (face-paired means + reduced sigmas) when normalization is enabled; alias canonicalization runs before unknown-building.
- Engine: src/engine/adjust.ts (LSAEngine) builds A/L/P, normals N=(A^T P A), iterates corrections, applies overrides/exclusions and unit normalization, computes SEUW/DOF, residuals, ellipses, sH, conditioning/residual warnings, direction-set diagnostics, setup diagnostics, traverse closure ratios, and logs.
- UI: src/App.tsx (shell) manages input/settings/layout; components in src/components (InputPane for edits/upload; ReportView for tables/overrides/exclusions/logs; MapView for plan/ellipse view).
- Tests: Vitest specs in /tests (angles, matrix, parser, engine) with fixtures in /tests/fixtures.
- CI: GitHub Actions workflow (.github/workflows/ci.yml) runs lint, vitest (--runInBand), and build on pushes/PRs to main.
- Data flow: user edits textarea -> handleRun instantiates LSAEngine with settings -> solve() mutates stations/observations -> result stored in state -> ReportView renders tables.

## Suggested Next Steps

- Performance: guards added for poor conditioning and residual spikes; consider a Web Worker offload for large networks.
- Expand test coverage for complex GNSS and leveling networks.
- Follow the Industry Standard v6-v14 parity-gap backlog in `TODO.md` (ordered Conventional -> GPS -> Leveling) for upcoming feature work.
- All parity-gap entries now include phased plans; execute in backlog order, starting with the top conventional items (`.ALIAS`, cluster-detection adjustment mode, Auto-Adjust workflow).

## Todo

- See TODO.md for the current checklist.
- Documentation and Examples have been added (User Guide, Demo Data).

## Process Note

- Update TODO.md, README.md, and agents.md after every batch of updates.
- Commit and push to GitHub after every completed batch of improvements.
- After each batch of updates, run:
  - `npm install`
  - `npm run lint`
  - `npm run test`
  - `npm run build`.
- If any command errors, fix the issues and rerun the full sequence until all commands succeed before pushing.
