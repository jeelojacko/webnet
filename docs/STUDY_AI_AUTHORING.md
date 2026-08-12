# Study AI Authoring

Phase 4B.0 adds AI-assisted authoring infrastructure for the Study module.

AI output is an authoring aid only. The official legal source remains the immutable authority, and approved AI content keeps source links, source hashes, and provenance.

## Architecture

AI authoring is provider-neutral. The shared proposal schemas support:

- `external-codex`
- `external-chatgpt`
- `openai-api`
- `manual-import`

The initial workflow uses external files so no OpenAI API account, API key, browser secret, or ChatGPT cookie integration is required.

The two stages are:

1. Study Map planning: source provisions are recommended as `standalone`, `combine`, `split`, `reference-only`, `skip`, or `needs-human-review`.
2. Unit authoring: approved source groups become proposals with a main recall question, learning objectives, guided questions, concise AI-authored study answers, and grounding evidence.

## Files

AI runtime/spec files live under:

```text
study-content/ai/
  specs/
  runs/<run-id>/
    run.json
    CODEX_INSTRUCTIONS.md
    jobs/*.jobs.jsonl
    results/*.results.jsonl
    reports/
```

The application source owns the schema and validation code under `src/study/ai/`.

## Commands

Prepare a Study Map run from the full NB SIT package:

```bash
npm run study:ai:prepare-map -- --sample 120 --seed 42 --strategy representative
```

Check a run:

```bash
npm run study:ai:status -- --run <run-id>
```

Validate returned map results:

```bash
npm run study:ai:validate-results -- --run <run-id>
```

Prepare unit-authoring jobs from validated map proposals:

```bash
npm run study:ai:prepare-units -- --run <map-run-id>
```

Validate unit proposal JSON:

```bash
npm run study:ai:validate-unit-proposals -- --proposals path/to/unit-proposals.json
```

## Codex Workflow

After preparing a run, open Codex in the WebNet repository and use the generated `CODEX_INSTRUCTIONS.md`.

Typical instruction:

```text
Process batch-001 using study-content/ai/specs/study-map-v1.md.
Write only the requested results file.
Do not modify application source code.
Do not use external legal research.
```

Results are JSONL. Each line is validated as untrusted input.

## Grounding

For every objective:

- `sourceKey` must exist.
- source hash must match the proposal source version.
- evidence text must appear in the authoritative source after whitespace normalization.
- evidence document identity must match the proposal document.

Validation can emit errors such as `SOURCE_KEY_NOT_FOUND`, `SOURCE_HASH_CHANGED`, `EVIDENCE_NOT_FOUND`, `DOCUMENT_MISMATCH`, and `STALE_PROPOSAL`.

Question-quality checks also flag duplicate, empty, overlong, generic, or repeated questions.

## Browser Review

The Study sidebar includes `Authoring`.

The Authoring page supports:

- importing AI authoring JSON artifacts;
- reviewing run/map/unit proposal counts;
- editing proposed title, main question, study summary, objectives, guided questions, and study answers;
- viewing grounding evidence separately from AI study answers;
- validating a proposal before approval;
- approving one proposal into one normal StudyUnit.

Approval creates normal Study records:

- proposal title -> `StudyUnit.title`
- main question -> guided `StudyPrompt.question`
- study summary -> `StudyUnit.editableSummary`
- objective guided questions -> `StudyRubricItem.prompt`
- objective study answers -> `StudyRubricItem.referenceAnswer`
- source keys/hashes -> Study source references

Approval does not create attempts or FSRS progress beyond the normal initial StudyUnit progress row. AI proposals are not included in the Library search index until approved.

## Import/Export

Study export/import preserves:

- authoring runs
- Study Map proposals
- unit proposals
- review and validation statuses
- validation messages
- proposal approval provenance

Imported proposals remain proposals. They do not create FSRS cards, attempts, or scheduled reviews until explicitly approved into StudyUnits.

## Future API Provider

A future Node-side `openai-api` runner can consume the same jobs and write the same result files. API credentials must stay server/CLI-side and must not be bundled into browser code.
