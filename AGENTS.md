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
Run after each completed batch:
- `npm install`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

For parity-sensitive work, also run:
- `npm run parity:industry-reference`

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

- Before starting a batch, record the planned scope in `TODO.md`.
- During the batch, keep `TODO.md` accurate.
- After the batch, update `TODO.md`, `README.md`, and the relevant docs/AGENTS files if behavior or workflow changed.
- Before commit/push, run the required validation commands and fix failures before proceeding.
- Commit and push after each completed batch; do not leave finished batches unpushed.
- For parity-sensitive work, do not keep changes that worsen the reference diff unless fixture, test, and doc updates clearly justify it.

## Keep this file small
- Put feature inventories, phased rollout notes, parity details, and long behavior histories in `docs/`, not here.
- Add nested `AGENTS.md` files only where local rules genuinely differ from repo-wide rules.
## Local Qwen Long-Run Policy

For Qwen scout/worker runs:

- A "needs attention: no observed activity for 120s" signal is not by itself a failure.
- Inspect subagent status before interrupting.
- If the child is in compaction or llama.cpp is actively generating, continue waiting.
- Allow up to 8 minutes for a local compaction pass before treating it as stalled.
- Only stop immediately for an actual provider error, context overflow, malformed result, process failure, or repeated length failure.

For worker edits:

- Prefer incremental edit/patch operations.
- Do not rewrite an existing large file in a single write tool call.
- Keep individual write/edit payloads bounded.
- Do not spend large output budgets restating source code or reasoning.
