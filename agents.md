# Agents Guide - WebNet (Star*Net-style LSA clone)

## Project Context
- Goal: browser-based clone of MicroSurvey Star*Net performing mixed-observation least-squares adjustment (TS distances/angles, GNSS baselines, leveling dH) with control points, error ellipses, residuals, and basic outlier cues.
- Current behavior (TypeScript): parses Star*Net-like text blocks (instrument library, control, D/A/G/L observations), runs iterative XYH adjustment with custom matrix math, reports SEUW/DOF, adjusted coordinates, error ellipses, residual tables sorted by |StdRes|, and a processing log. UI has a resizable input pane and report pane with dark Tailwind styling and a seeded 10-point demo dataset.

## Tech Stack
- Runtime: Node 18+ (ESM). Bundler: Vite 7.
- UI: React 19.2 (hooks), TailwindCSS 3.4 (classes in TSX, base in src/index.css), Lucide icons.
- Language: TypeScript 5 (strict), TSX entrypoints.
- Tooling: ESLint 9 (flat config), PostCSS + Autoprefixer, no Prettier yet, no tests yet.
- Dependencies: "react", "react-dom", "lucide-react".
- Dev deps: Vite/React plugin, ESLint + react-hooks/refresh plugins, Tailwind/PostCSS, TypeScript.
- Optional improvements: add Vitest for matrix/parser/engine coverage; consider a small linear algebra lib (e.g., ml-matrix) or a Web Worker/WASM path if networks grow; keep Vite or move to Next.js only if routing/server needs appear (currently unnecessary).

## Code Style
- TypeScript/React with functional components and hooks; prefer pure helpers and small components (UI still mostly single file).
- Naming: camelCase for vars/functions; UPPER_SNAKE for constants; React components PascalCase.
- Formatting: 2-space indent, semicolons present; Tailwind utility classes for styling (avoid inline styles).
- Lint: ESLint recommended + react-hooks + react-refresh; `no-unused-vars` ignores leading-cap vars. Keep TS strict; avoid `any`—prefer typed helpers and shared types.
- Data/units: calculations assume meters/radians internally; UI unit toggle is display-only. Keep angle conversions via `dmsToRad`/`radToDmsStr`; keep observations and station keys as strings.

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
  - Types: src/types.ts for stations, observations, instruments, results.
- Math helpers: src/engine/matrix.ts (zeros/transpose/multiply/inv), src/engine/angles.ts (RAD/DEG/SEC, dms helpers).
- Parser: src/engine/parse.ts ingests Star*Net-like text into typed stations/observations/instruments.
- Engine: src/engine/adjust.ts (LSAEngine) builds A/L/P, normals N=(A^T P A), iterates corrections, computes SEUW/DOF, residuals, ellipses, sH, logs.
- UI: src/App.tsx (shell) manages input/settings/layout; presentational components in src/components (InputPane, ReportView, MapView).
- Tests: Vitest specs in /tests (angles, matrix, parser, engine) with fixtures in /tests/fixtures.
- CI: GitHub Actions workflow (.github/workflows/ci.yml) runs lint, vitest (--runInBand), and build on pushes/PRs to main.
- Data flow: user edits textarea -> handleRun instantiates LSAEngine with settings -> solve() mutates stations/observations -> result stored in state -> ReportView renders tables.

## Suggested Next Steps
- Editable obs tables: implemented (values/weights with overrides and re-run).
- True computational unit conversion (ft/m): implemented; engine normalizes feet inputs before solving.
- Performance: guards added for poor conditioning and residual spikes; consider a Web Worker offload for large networks.

## Todo
- See TODO.md for the current checklist (completed and planned items).

## Process Note
- Update TODO.md, README.md, and agents.md after every batch of updates.
- After each batch of updates, run:
  - `npm install`
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - Then `git add .`, `git commit -m "<short description>"`, `git push -u origin main`.
- If any command errors, fix the issues and rerun the full sequence until all commands succeed before pushing.
