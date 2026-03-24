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
