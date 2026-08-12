# Study AI Authoring

Phase 4B.1 supports the first real provider-neutral AI authoring pilot. It prepares and evaluates a bounded Study Map and Unit Authoring sample; it does not process the full corpus automatically.

AI output is an authoring aid only. The official legal source remains immutable authority, and approved AI content keeps source links, source hashes, and provenance.

## Architecture

AI authoring remains provider-neutral:

- `external-codex`
- `external-chatgpt`
- `manual-import`
- future `openai-api`

No OpenAI API key, browser secret, billing integration, or ChatGPT cookie integration is required.

The two-stage workflow is:

1. Study Map planning recommends source dispositions and educational groupings.
2. Unit Authoring writes source-grounded learning objectives, guided questions, concise study answers, evidence, and coverage for an approved Map group.

## Prompt Specs

The original v1 prompt specs remain under `study-content/ai/specs/` for reproducibility.

New jobs default to:

- `study-map-v2`
- `unit-authoring-v2`

Every job records `promptSpecVersion`, and the deterministic `inputHash` includes that prompt version. A result with the wrong prompt spec is stale/invalid for that job.

Study Map v2 explicitly treats the ANBLS corpus as exam scope, tells the model that source text is data, forbids external legal research/memory, preserves official source scope, and gives concrete criteria for `standalone`, `combine`, `split`, `reference-only`, `skip`, and `needs-human-review`.

Unit Authoring v2 explicitly treats authoring as educational work, requires natural specific questions, concise legally faithful answers, actor/modality/numeric fidelity, approved-group scope, evidence grounding, inference separation, and objective-level source coverage.

## Source Input

AI jobs distinguish:

- `exactSourceText`: complete authoritative representation for provenance/verification.
- `operativeSourceText`: substantive provision text used for planning/authoring.
- `sourceMetadata`: amendment history, consolidation notes, citation metadata, and cleaning warnings.

Job preparation does not alter authoritative `legalComponents`. It only cleans the AI job input so amendment history, consolidation notes, and obvious metadata are not treated as operative law.

Jobs also record `sourceStatus` as `current`, `repealed`, or `historical` when detectable. Repealed material is not automatically skipped; the Map proposal remains reviewable.

## Context

Study Map and Unit Authoring jobs can include bounded context:

- previous section
- next section
- relevant definitions
- directly referenced provisions
- omitted context warnings

Definition and cross-reference resolution is deterministic and first-level only. It does not recursively expand references and does not send whole definitions sections merely because one defined term appears.

Unit Authoring v2 distinguishes the approved authoring source group from context for understanding only. Substantive objectives must ground to approved-group source keys.

## Study Map Review

The Study Authoring page has separate `Runs`, `Study Map`, and `Unit Proposals` views.

Study Map review shows document identity, section/citation labels, heading, operative source text, disposition, confidence, reason, priority, proposed groups, warnings, and conflict codes.

Available Map actions:

- Approve Map
- Edit
- Defer
- Reject
- Mark for Regeneration

Editable Map fields include disposition, priority, group title, group source keys, and approximate learning goal. Users can add groups. Skip and reference-only recommendations are visible and can be approved or changed before approval.

For the Phase 4B.1 pilot, each Map proposal can also record:

- `pilotEvaluation`: `good-as-is`, `minor-edit`, `major-edit`, or `wrong`
- `pilotEvaluationNotes`

These fields are pilot metadata only. They do not change normal Study state or FSRS scheduling.

`prepare-units` only uses Map proposals that are approved, valid or warning-valid, non-conflicted, and not skip/reference-only. Validated but unapproved Map proposals do not create Unit Authoring jobs.

## Unit Proposal Review

The Unit Proposal review UI shows official source keys and available source text beside AI content. It shows title, main question, summary, objectives, guided questions, study answers, evidence, warnings, and source coverage.

Minimum editor controls include:

- title edit
- main question edit
- summary edit
- objective add
- objective delete
- objective reorder
- objective text edit
- guided question edit
- study answer edit
- proposal defer
- proposal reject
- validate
- approve

Approval creates normal Study records only after explicit review. It never overwrites existing StudyUnits automatically and does not create attempts or FSRS history.

For the Phase 4B.1 pilot, each Unit Proposal can also record:

- overall `pilotEvaluation`: `excellent`, `good`, `needs-minor-edit`, `needs-major-edit`, or `reject`
- optional per-area evaluations for main question, learning objectives, guided questions, study answers, source coverage, grounding, and Study-unit grouping
- `pilotEvaluationNotes`

These fields are stored with the proposal artifact and remain separate from approved StudyUnits.

## Validation

Blocking errors include:

- schema invalid
- source document mismatch
- stale corpus/hash
- changed source hash
- missing evidence source
- evidence text not found
- authoring source scope mismatch
- no substantive objective
- empty required question or answer

Warnings include:

- low confidence
- generic or duplicate questions
- existing StudyUnit overlap
- AI proposal source overlap
- unsupported numeric or legal-reference token
- possible modality mismatch
- possible actor mismatch
- uncovered substantive subsection
- unexplained omission
- answer appears to extend beyond evidence

Warnings remain approvable after explicit review.

## Coverage

Unit proposals may include `sourceCoverage` entries keyed by sourceKey. Child labels can be marked:

- `covered`
- `context-only`
- `intentionally-omitted`
- `not-assessed`

An unexplained omitted or missing child label produces a warning. An intentional omission with a reason remains visible but is not blocking.

## Overlap

Validation compares proposals by `documentId + sourceKey`.

`EXISTING_UNIT_OVERLAP` warns when a proposal overlaps an existing StudyUnit. The warning includes the existing unit title and phase where available. Approval remains explicit and never modifies existing FSRS state.

`PROPOSAL_SOURCE_OVERLAP` warns when two imported AI Unit Proposals cover the same source in the same review set.

## Representative Sampling

`--strategy representative` uses deterministic stratified sampling for a fixed corpus hash, seed, sample size, and strategy version.

The sampler considers document type, document diversity, provision length, detectable legal-rule categories, large/problem-case markers, and optional manual includes.

When the requested command is the Phase 4B.1 pilot shape:

```bash
npm run study:ai:prepare-map -- --sample 100 --seed 42 --strategy representative
```

the sampler automatically applies the required golden Study Map cases from the pilot plan, including Boundaries Confirmation Act sections 10 and 16, Surveys Act sections 1, 3, 8, and 14, Community Planning Act sections 83 and 125, Land Titles Act sections 1, 18, and 83, selected Registry Act filing/passive-effect provisions, and representative regulation provisions. It also tops up regulation representation to at least eight regulation provisions when the representative sample would otherwise under-sample regulations. Use `--skip-phase-4b1-includes` only for non-pilot sampling experiments.

Example:

```bash
npm run study:ai:prepare-map -- --sample 100 --seed 42 --strategy representative --include doc-boundaries-confirmation-act:10,doc-surveys-act:8
```

Reports are written to:

```text
study-content/ai/runs/<run-id>/reports/sampling-report.json
study-content/ai/runs/<run-id>/reports/sampling-report.md
```

The report records sample size, seed, strategy version, Acts/Regulations represented, document distribution, category counts, selected job IDs, and selection reasons.

## External Codex Workflow

Generated `CODEX_INSTRUCTIONS.md` tells the external agent to:

- process only requested job files
- not edit application source code
- not edit prompt/spec/schema files
- not browse or use external legal sources
- not use legal memory
- preserve `jobId`, `runId`, `inputHash`, `corpusContentHash`, and `promptSpecVersion`
- write only JSONL result files
- use one JSON object per line
- avoid Markdown fences and commentary
- resume by skipping already completed valid jobIds
- never rewrite valid result lines unless explicitly told to regenerate them

## JSONL Recovery

Result JSONL is parsed line by line. Malformed or partial lines produce `MALFORMED_JSONL_LINE` reporting with file, line number, raw line hash, and parse error. Validation continues with other lines, and malformed lines do not count as completed.

`study:ai:status` distinguishes:

- Jobs
- Result lines
- Valid completed
- Invalid
- Malformed
- Stale
- Remaining
- Duplicate results

## Commands

```bash
npm run study:ai:prepare-map -- --sample 120 --seed 42 --strategy representative
npm run study:ai:status -- --run <run-id>
npm run study:ai:validate-results -- --run <run-id>
npm run study:ai:prepare-units -- --run <map-run-id>
npm run study:ai:validate-unit-proposals -- --proposals path/to/unit-proposals.json
npm run study:ai:pilot-report -- --run <map-run-id> --unit-run <unit-run-id>
```

These commands prepare, validate, and report on artifacts only. They do not call an AI API, do not browse, and do not mass-approve AI StudyUnits.

## Phase 4B.1 Pilot Reports

`pilot-report` reads reviewed Map proposals and optional Unit Proposals, then writes:

```text
study-content/ai/runs/<run-id>/reports/pilot-authoring-audit.json
study-content/ai/runs/<run-id>/reports/pilot-authoring-audit.md
```

The JSON audit includes Map disposition/confidence/evaluation counts, conflict/context warning counts, Unit Proposal evaluation and validation warning counts, source text, AI questions/answers/evidence, coverage, validation warnings, deterministic comparison output where available, and pilot evaluation fields.

The report is evaluation-only. It does not decide whether AI authoring is ready for scale and does not start full-corpus generation.
