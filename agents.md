# Agents Guide - WebNet (Star*Net-style LSA clone)

## Project Context
- Goal: browser-based clone of MicroSurvey Star*Net performing mixed-observation least-squares adjustment (TS distances/angles, GNSS baselines, leveling dH) with control points, error ellipses, residuals, and basic outlier cues.
- Current behavior (TypeScript): parses Star*Net-style text blocks (instrument library with EDM const/ppm, HZ/VA precision, centering errors, control, D/A/G/L/B/V/M/BM/TB/T/TE/DB/DN/DM/DE/SS observations + inline options .UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.MAPSCALE/.CURVREF/.REFRACTION/.VRED/.LWEIGHT/.NORMALIZE/.END/.LONSIGN/.I/.EDM/.CENTERING/.ADDC/.DEBUG/.AMODE, C/E/CH/PH/EH records with per-component `!/*` fixity where lone `*` remains legacy-fixed with warning, and std err tokens; inline `#` comments / `'Description` trimmed; P/PH lat/long projected to local EN via first P origin; D/M/BM/DV capture HI/HT and delta mode, DV/M in delta-mode emit distance+dH; DV/BM/M slope emit zeniths with face-2 weighting and derived stds; EDM mode supports additive/propagated; GNSS supports per-component sigmas with optional EN correlation; centering can be disabled via `.CENTERING OFF` and explicitly-entered sigmas only inflate when `.ADDC ON`; debug logging includes per-obs w in rad/deg plus a step check (`wnew ≈ w − A·dx`); 3D runs auto-hold heights for stations with no vertical-sensitive observations; `A` records support explicit `.AMODE` control and stricter AUTO classification; .LWEIGHT applied for leveling weights with ft lengths converted to km; bearings/zeniths solved; DB/DN direction sets ingest raw circle readings, reduce face-paired shots by target (with reduced sigmas), and solve per-set orientation parameters with raw-vs-reduced diagnostics; map mode now supports grid scale reduction for horizontal distances; optional curvature/refraction vertical reduction is supported via `.CURVREF`/`.REFRACTION` + `.VRED CURVREF`; sideshots support optional explicit azimuth tokens (`AZ=`/`@`) and setup-based horizontal-angle tokens (`HZ=`/`HA=`/`ANG=`) tied to current backsight, are excluded from adjustment with occupy/backsight validation, and emitted in a post-adjust section with computed coordinate/precision (including azimuth source) where available; mixed-face traverse/direction shots rejected when .NORMALIZE OFF; TE closure legs log residuals/misclosure vectors/geometry when available), warns when `.ORDER` is missing (defaults to EN), normalizes to meters/radians, runs iterative adjustment (2D mode drops height parameters and skips vertical obs), logs basic network diagnostics for under-observed stations plus per-direction-set prefit/residual summaries, direction-target repeatability diagnostics (raw spread, face balance, local-test/MDB, suspect scoring), multi-set direction repeatability trends by occupy-target (cross-set range/RMS and suspect ranking), setup summaries with setup-level suspect metrics (RMS/Max standardized residuals, local-test fail counts, worst-observation traceability), and traverse closure diagnostics/ratios, applies overrides/exclusions, applies weighted coordinate/elevation control constraints from station std errors, reports SEUW/DOF plus normal-matrix condition diagnostics, standardized residuals (Qvv), redundancy numbers, chi-square test with 95% critical bounds and variance-factor interval, local-test outcomes with MDB values, point precision (σN/σE/σH + ellipse azimuth), relative precision between unknown points, adjusted coordinates, error ellipses, residual tables sorted by |StdRes| with source-line traceability, and a processing log. UI adds automated suspect-impact what-if exclusion scoring (dSEUW/dMax|t|/chi-square change/unknown shift + one-click exclude+rerun), report-header hover tooltips for technical fields (including SEUW/chi-square labels), hover-tooltips for all settings controls in the settings dropdown, editable observation tables, parse-mode toggles (.DELTA/.MAPMODE/.NORMALIZE/.LWEIGHT/.COORD/.ORDER/.LONSIGN/.AMODE) housed in a settings dropdown, re-run with exclusions, map/ellipse view, export results as text (unit-correct, sorted, top suspects), refresh-to-last-run, and seeded demo + TS-per-record example datasets.

## Tech Stack
- Runtime: Node 18+ (ESM). Bundler: Vite 7.
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
- Parser: src/engine/parse.ts ingests Star*Net-style text with inline options (.UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.MAPSCALE/.CURVREF/.REFRACTION/.VRED/.END/.AMODE), per-component fixity via `!/*` (lone `*` legacy-fixed with warning), inline `#` comments / `'Description` trimming, C/E records (fixity/std errs, NE/EN order, ft<->m), D/A/G/L observations with instrument lib lookups (GNSS per-component/correlation support), and returns stations/unknowns/obs/logs. Direction sets are reduced by target (face-paired means + reduced sigmas) when normalization is enabled.
- Engine: src/engine/adjust.ts (LSAEngine) builds A/L/P, normals N=(A^T P A), iterates corrections, applies overrides/exclusions and unit normalization, computes SEUW/DOF, residuals, ellipses, sH, conditioning/residual warnings, direction-set diagnostics, setup diagnostics, traverse closure ratios, and logs.
- UI: src/App.tsx (shell) manages input/settings/layout; components in src/components (InputPane for edits/upload; ReportView for tables/overrides/exclusions/logs; MapView for plan/ellipse view).
- Tests: Vitest specs in /tests (angles, matrix, parser, engine) with fixtures in /tests/fixtures.
- CI: GitHub Actions workflow (.github/workflows/ci.yml) runs lint, vitest (--runInBand), and build on pushes/PRs to main.
- Data flow: user edits textarea -> handleRun instantiates LSAEngine with settings -> solve() mutates stations/observations -> result stored in state -> ReportView renders tables.

## Suggested Next Steps
- Performance: guards added for poor conditioning and residual spikes; consider a Web Worker offload for large networks.
- Expand test coverage for complex GNSS and leveling networks.

## Todo
- See TODO.md for the current checklist.
- Documentation and Examples have been added (User Guide, Demo Data).

## Process Note
- Update TODO.md, README.md, and agents.md after every batch of updates.
- After each batch of updates, run:
  - `npm install`
  - `npm run lint`
  - `npm run test`
  - `npm run build`.
- If any command errors, fix the issues and rerun the full sequence until all commands succeed before pushing.
