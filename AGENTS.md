# AGENTS.md - WebNet

## Project

WebNet is a browser-based least-squares adjustment application for mixed survey observations. It emphasizes industry-style workflows, deterministic output, parity validation, and browser-first usability.

## Read these first

- `README.md` for setup and user-facing project overview.
- `TODO.md` for the active implementation checklist.
- `docs/ARCHITECTURE.md` for module layout and data flow.
- `docs/CURRENT_BEHAVIOR.md` for the maintained feature inventory and parity/status notes.
- `docs/PARITY_WORKFLOW.md` for parity-sensitive validation rules and reference-diff expectations.
- `docs/IMPORT_WORKFLOW.md` for external-import and staged-review behavior.

## Repo-wide rules

- Keep calculations normalized to meters and radians internally.
- Perform unit conversion only at parse, override, import/export, or display boundaries.
- Keep station IDs and observation IDs as strings.
- Prefer strict TypeScript types and shared helpers over `any`.
- Preserve deterministic ordering in reports, listings, exports, diagnostics, and fixture-backed outputs.
- Keep file paths cross-platform portable: no Windows reserved device basenames (CON/PRN/AUX/NUL/COM1-9/LPT1-9, extension does not exempt), no forbidden chars (< > : " \\ | ? *), no trailing space/dot, no case-only-distinct paths. Run `npm run check:portable-paths` before adding/renaming files; prefer descriptive fixture names (e.g. station_aux.06o).
- Avoid changing output wording, row inclusion, ordering, or rounding unless the task requires it and regression coverage is updated.

## TypeScript file structure rules

- Keep files small and focused:
  - Target 150-400 lines per normal `.ts` or `.tsx` file.
  - Treat 600 lines as a warning.
  - Do not allow regular source files over 900 lines unless there is a clear reason.
  - Files over 1,200 lines must be split before adding more functionality.
  - Generated files, vendor files, migrations, and large test fixtures are exempt, but they must be clearly marked.
- Keep functions small:
  - Target 10-40 lines per function.
  - Treat 75 lines as a warning.
  - Do not allow a function over 120 lines unless it is simple, linear, and hard to split cleanly.
  - If a function has multiple phases, extract named helper functions.
  - If a function has deep branching, extract each branch into a named function.
- Create a new file when:
  - A file contains more than one major responsibility.
  - A component has large helper functions, hooks, types, constants, or data transforms mixed into it.
  - A utility section is used by more than one file.
  - Types/interfaces take up a significant section and are reused elsewhere.
  - A file is approaching 600 lines and new functionality is being added.
  - A function or component needs several private helpers.
  - The file is becoming hard to scan from top to bottom.
- Prefer this structure:
  - `ComponentName.tsx` for the main component.
  - `ComponentName.types.ts` for exported types.
  - `ComponentName.utils.ts` for pure helper functions.
  - `ComponentName.hooks.ts` for custom hooks.
  - `ComponentName.constants.ts` for constants/config.
  - `ComponentName.test.ts` or `.tsx` for tests.
  - `index.ts` only for exports, not implementation.
- React component rules:
  - Keep the main component mostly focused on rendering and wiring.
  - Move complex state logic into custom hooks.
  - Move data formatting/mapping into utility functions.
  - Move large child UI sections into child components.
  - Do not keep several large components in one file.
- Refactoring rule:
  - Before adding new code to a file over 600 lines, first look for a clean split.
  - Before adding new code to a function over 75 lines, first extract helper functions.
  - Never solve a feature by appending hundreds of lines to an already-large file unless explicitly instructed.
- Complexity rules:
  - Avoid more than 3 levels of nesting.
  - Avoid long `if/else if/else` chains; prefer maps, strategy objects, or extracted functions when appropriate.
  - Avoid functions with more than 5 parameters; use a typed options object instead.
  - Name extracted functions clearly so the parent function reads like a high-level workflow.
- Do not split files just for the sake of splitting:
  - A new file should have a clear responsibility.
  - Avoid creating tiny one-function files unless the function is reused or conceptually important.
  - Prefer cohesive modules over excessive fragmentation.
- When modifying existing code:
  - Preserve public APIs unless asked to change them.
  - Split large files gradually and safely.
  - Keep related tests updated.
  - Do not introduce circular imports.
  - Do not create vague files like `helpers.ts`, `misc.ts`, or `utils2.ts`; use specific names.

## Architecture routing

- Parser and solver core behavior lives under `src/engine/`.
- UI shell, report, map, modal, and operator workflows live under `src/components/` and `src/hooks/`.
- Fixture-backed behavioral contracts live under `tests/`.
- When a task is about current supported behavior, parity notes, or staged workflows, consult `docs/` first before inferring from scattered test names.

## Naming and wording

- Use generic wording such as `industry standard software` or `industry software` unless exact naming is required for file-format or interoperability behavior.
- Keep `manual/` local-only. Do not commit `manual/` contents.

## Commands

Run `npm install` only when dependencies or the lockfile changed.

Tests are tiered. The authoritative manifest is `scripts/testTiers.ts`; the
rulebook is `docs/TEST_TIERS.md`. Validation hierarchy (see also Process
below and `docs/TEST_TIERS.md`; do not duplicate the full policy here):

- WHILE EDITING: LSP diagnostics + focused/affected tests.
- COMMIT: Husky owns lint + typecheck (do not run them manually first).
- PRE-PR: `npm run test:agent` once.
- PRODUCTION CHANGE: `npm run build` when relevant.
- SPECIALTY: `test:wasm`, `parity:industry-reference`, `wasm:build`/
  `cpp:test`, `test:release`, manual `test:evidence` only when the scope
  requires them.
- FINAL: exact-head CI is authoritative.

Escalations are not routine. Reach for `test:wasm`, `parity:industry-reference`,
`wasm:build`/`cpp:test`, `test:release`, or the manual-only `test:evidence` only
when the change is engine/worker/WASM/parity/release-sensitive, and see
`docs/TEST_TIERS.md` for the exact route. `test:full`/`test:run` is the
literal-everything command, never a routine completion gate.

Tier rules: membership is semantic (what a test proves), never runtime-based. A
new test expected to take >~10 s for stress, evidence, repeated real-WASM
sessions, browser certification, or performance must be classified in
`scripts/testTiers.ts` (WASM or evidence tier; long campaigns under
`tests/evidence/`) instead of silently joining the agent tier. CI path
classification is fail-closed: unknown changes receive numerical
certification. Read `tests/AGENTS.md` for the decision tree.

## Done when

- Relevant focused tests are added or updated.
- Lint, typecheck, tests, and build pass.
- `TODO.md`, `README.md`, and the relevant docs/AGENTS files are updated when workflow, architecture, or user-visible behavior changed.
- If parser, solver, listing, export, import, or parity behavior changed, update the matching document under `docs/`. Keeping them organized.

## README rule

- Keep `README.md` focused on onboarding and navigation:
  - what the project is
  - how to run it
  - how to validate it
  - where the main docs live
  - the major supported workflows at a high level
- Update `README.md` only when user-facing setup, commands, major workflows, examples, exports, or top-level documentation links change.
- Do not add batch-by-batch implementation logs or detailed parity/import/architecture notes to `README.md`.
- Put detailed implementation status in `docs/CURRENT_BEHAVIOR.md`, parity-specific rules in `docs/PARITY_WORKFLOW.md`, import details in `docs/IMPORT_WORKFLOW.md`, and module/data-flow notes in `docs/ARCHITECTURE.md`.

## Process

- Before starting a batch, record the planned scope in `TODO.md`; keep it accurate during and after.
- After the batch, update `TODO.md`, `README.md`, and the relevant docs/AGENTS files if behavior or workflow changed.
- Husky owns `lint` + `typecheck` at commit; do not run them manually immediately before committing.
- Run `npm run test:agent` once before opening a PR; use focused tests while iterating.
- Exact-head CI is authoritative. Do not pre-empt it with routine `test:wasm`, parity, `npm audit`, `test:full`, or retired legacy suites.
- Run `npm audit` only when dependencies or the lockfile change.
- Commit and push after each completed batch; do not leave finished batches unpushed.
- Evidence for an ordinary feature = focused tests + PR body. Commit screenshots only for a long-term visual contract.
- For parity-sensitive work, do not keep changes that worsen the reference diff unless fixture, test, and doc updates clearly justify it.

## Keep this file small

- Put feature inventories, phased rollout notes, parity details, and long behavior histories in `docs/`, not here.
- Add nested `AGENTS.md` files only where local rules genuinely differ from repo-wide rules.

## Pi-local routing

Pi-specific tool, subagent, and orchestration routing lives in
`.pi/APPEND_SYSTEM.md`.
