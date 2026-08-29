# Local Study Map Authoring

This workflow is for a later phase when a local OpenAI-compatible server is available. It has not been run during Phase 4C.1.3.

## Setup

1. Start LM Studio on the home machine.
2. Load the desired local model.
3. Start LM Studio's OpenAI-compatible server.
4. Get the exact model ID from the LM Studio UI or:

```bash
curl http://127.0.0.1:1234/v1/models
```

1. Set local configuration:

```bash
set STUDY_AI_BASE_URL=http://127.0.0.1:1234/v1
set STUDY_AI_MODEL=<model-id-from-lm-studio>
```

`STUDY_AI_API_KEY` is optional for local endpoints and is not written to artifacts.

## Comparison Set Only

Run only the prepared comparison set first:

```bash
npm run study:ai:local-map -- --run ai-map-4c12-full-corpus-v2 --comparison-set study-content/ai/runs/ai-map-4c12-full-corpus-v2/reports/local-model-comparison-set.json --resume
```

Validate outputs:

```bash
npm run study:ai:validate-results -- --run ai-map-4c12-full-corpus-v2
```

Generate a single-job side-by-side comparison report for human review with:

```bash
npm run study:ai:local-compare -- --job <job-json> --known-good <v1-result-json> --local <local-result-json> --out <comparison-report-json>
```

Generate the deterministic whole-comparison-set batch report with:

```bash
npm run study:ai:local-compare -- \
  --comparison-set study-content/ai/runs/ai-map-4c12-full-corpus-v2/reports/local-model-comparison-set.json \
  --local-results study-content/ai/runs/ai-map-4c12-full-corpus-v2/results/local-map.results.jsonl \
  --v2-run ai-map-4c12-full-corpus-v2 \
  --v1-run ai-map-4c1-full-corpus-v1 \
  --out study-content/ai/runs/ai-map-4c12-full-corpus-v2/reports/local-model-comparison-report.json
```

Batch mode resolves each comparison-set job from the V2 run `jobs/*.jobs.jsonl` files, the known-good V1 result from the entry's `v1KnownGoodResultLocation` matched by `jobId`, and the local result from the local results JSONL matched by `jobId`. Jobs without a local result are reported as `local` status `missing-or-rejected`; jobs missing from the V2 run are reported as status `v2-job-missing`. The report includes per-job deterministic structure/validation facts (disposition, confidence, suggested priority, schema validity, validation issues, context leakage, group/child-label coverage, mismatch and candidate flags) plus aggregate counts and rates over the comparison set. The top-level report includes `comparisonSetSize`, `knownGoodFound`, `localAcceptedFound`, `localMissingOrRejected`, `dispositionExactMatch`, `suggestedPriorityExactMatch` (with `bothPresent`), `groupCountExactMatch`, `childLabelCoverageExactMatch`, `contextLeakageJobCount`, `localInvalidCount`, `falseSkipCandidates`, `falseIncludeCandidates`, and `perJob`. It makes no model calls, never repairs or rewrites results, and never changes which local results are accepted.

Human review must compare local output against the authoritative source, known-good V1 output, and Study Map V3 requirements. Schema validity alone is not approval.

## Stratified 200-job validation sample and run audit

A larger, reproducible comparison set for validating local-model output is built by the seeded stratified sampler (no model calls):

```bash
npx tsx scripts/studyAiBuildStratifiedMapSample.ts \
  --run ai-map-4c12-full-corpus-v2 \
  --size 200 \
  --seed 20260828 \
  --out study-content/ai/runs/ai-map-4c12-full-corpus-v2/reports/stratified-200-seed-20260828.json
```

Behavior: per-document quotas are automatic (`floor(size/docs)` plus remainder distributed in documentId order; `--per-document N` overrides as a base quota); shortfalls are redistributed round-robin to documents with headroom; selection within a document is coverage-first (jobs adding new complexity/structural strata are taken before rank fill); the sample SHA-256 fingerprints the selected job list, and the JSON/MD are byte-identical for the same seed. Every job carries its V1 known-good mapping (`v1JobId`, `v1KnownGoodResultLocation`, `v1ResultIdentity`) computed from document + source keys + section labels. Coverage of the multi-label complexity categories and structural strata (both defined in `scripts/studyAiMapStrata.ts`) is recorded, and any corpus stratum with zero selected jobs is written to `unmetCoverageNotes`.

After a local run completes, audit it deterministically against the comparison set:

```bash
npx tsx scripts/studyAiAuditMapRun.ts \
  --run <local-run-id> \
  --comparison-set <comparison-set.json> \
  --review-size 40
```

Writes `reports/map-run-audit.json`, `reports/map-run-audit.md`, `reports/semantic-review-bundle.jsonl`, and `reports/v1-comparable-results.jsonl` (the FULL V1 result rows for every comparable job, so bundle entries can be diffed without opening the legacy V1 run directory) into the audited run directory. Reports reliability (acceptance, semantic-first-try acceptance, semantic-vs-provider recovery, per-error-code failed attempts and per-job recovery rate, retry-introduced-different-error and repeated-identical-error counts), per-stratum acceptance, structure (disposition/confidence/priority mix, group counts, final re-validation issues), concision (word-count stats vs ~40/30/60 thresholds), output-hygiene pattern findings (prompt/calibration/instruction/AI-identity references), and a descriptive V1 comparison (V1 is a pedagogical comparator only, never an accuracy ground truth). The review bundle orders jobs by tier (permanent-failure, semantic-retry, low-confidence, needs-human-review, final-warning, priority-p1, multi-group, configured risk strata, provider-recovery, clean controls) capped by `--review-size`; every entry records `reviewTier`, `reasonSelectedForReview`, semantic/provider attempt counts, and final confidence/warnings.

Reliability separates semantic reliability from provider/transport reliability. `acceptedJobs` is the accepted count; `firstSemanticAttemptAccepted` counts jobs accepted on their first semantic attempt; `acceptedAfterSemanticRetry` counts jobs accepted on a later semantic attempt (genuine semantic recovery); `acceptedAfterProviderRecovery` counts accepted jobs whose attempt history includes at least one provider failure (transport recovery, not semantic recovery); `semanticRetryJobs`/`semanticRecoveryRate` summarize genuine retry recovery. Permanent failures split by origin: `semanticPermanentFailures` (at least one semantic attempt, never converged) and `providerIncompleteJobs` (interrupted before any semantic attempt); each permanently failed job lists `origin` (`none`/`provider`/`semantic`/`mixed`) with semantic vs provider attempt counts. Per-error-code counts and the retry-introduced-different-error / repeated-identical-error comparisons include only semantic attempts, so provider attempts (which carry no semantic error codes) no longer distort error-code recovery statistics or error-transition signatures. When `reports/provider-events.jsonl` exists, the audit embeds it as `providerEvents` in `map-run-audit.json` (runs created before provider telemetry report `olderRunsHaveProviderTelemetry: false`), and the markdown gains a Provider reliability subsection with per-code counts and recovered-vs-aborted totals. The review bundle excludes non-accepted jobs with zero semantic attempts (pure provider-incomplete jobs); semantic and mixed failures remain, and bundle attempts carry `provider` and `providerCode` fields.

Integrity problems (malformed lines, duplicate results, jobs outside the comparison set, base-run gaps, authoring-fingerprint mismatch) fail the audit with a non-zero exit code.

### Resuming the interrupted stratified run

The stratified 200-job local run of 2026-08-28 was interrupted by local provider failures before completion (30 of 200 jobs accepted; every recorded failure artifact is `transport/provider`, mostly connection drops from the local server). Resume it with its original comparison set:

```bash
npm run study:ai:local-map -- \
  --run ai-map-4c12-full-corpus-v2-local-qwen-smaller-106k-strat200-v1-20260828-082317 \
  --model Qwen3.8-27B-UD-IQ4_XS \
  --comparison-set study-content/ai/runs/ai-map-4c12-full-corpus-v2-local-qwen-smaller-106k-strat200-v1-20260828-082317/reports/stratified-200-comparison-set.json \
  --resume
```

The first resumed start creates `reports/local-run-metadata.json` for this pre-existing run; later starts validate against it. Keep the same `--comparison-set` path and model, and re-run the same command after any further interruption.

The accepted results in this run keep the source run's `runId` (`ai-map-4c12-full-corpus-v2`) because its job files were prepared under that run; resume validation compares each result's `runId` against its job file (see `reports/warm-start-note.json`).

### Gate A result and source-text grounding fix (2026-08-28)

The stratified 200-job Gate A run completed at 196/200 accepted with four permanent semantic failures and zero provider-incomplete jobs. Re-validation with the fixed validator (below) cleared two of the four recorded failures as validator false negatives; the other two are genuine model errors that need fresh generation.

Root cause of the false negatives: `sourceTextByKey` in `src/study/ai/studyAiGrounding.ts` mapped every target `sourceKey` to the full `target.operativeSourceText`, and then context entries could overwrite the same key. A `relevantDefinitions` context entry reusing the target's own `sourceKey` carried only a bounded (~1800 character) excerpt, so evidence beyond that prefix failed `FOCUS_EVIDENCE_NOT_IN_SOURCE` (and long-form `DEFINED_TERM_NOT_IN_FOCUS_SOURCE` patterns failed the same way). Fix: target-owned keys always keep the authoritative full text; context entries only populate keys the target does not already own. A regression test locks the clobber case.

Evidence/defined-term matching is normalized before comparison (`normalizeForPhrase` in `studyAiGrounding.ts`): curly quotes and apostrophes are folded to straight forms, every non-letter/non-number character becomes a single space, whitespace collapses, and the text is trimmed and lowercased. Containment is then checked as a **contiguous whole-token sequence** (`tokensContain`), not as a raw substring: typographic punctuation, apostrophe style, and irregular whitespace are tolerated, but mid-token matches (for example `nit the` inside `unit the`) are rejected, and paraphrases or legally significant omissions still fail grounding. Paraphrase/omission/mid-token rejections are locked by focused tests.

Deterministic re-validation of the four saved final attempts against the fixed validator: the Condominium s.1 and Highway s.44.1 attempts now pass with zero grounding issues; the Ownership of Minerals s.3 attempt still fails with three genuine `FOCUS_EVIDENCE_NOT_IN_SOURCE` citation errors (evidence from 3(1)(a)–(d) cited under child label 3(2)); the Quarriable Substances s.13 attempt still fails with genuine `SPLIT_GROUP_COUNT`/`SUGGESTED_PRIORITY_REQUIRED` structural errors. The historical run directory is immutable; fresh generation for the affected jobs goes through the post-Gate-A regression set below.

### Post-Gate-A regression set

A fixed, named regression population (no sampling, no inference) is built deterministically by `scripts/studyAiBuildRegressionSet.ts`:

```bash
npx tsx scripts/studyAiBuildRegressionSet.ts \
  --base-run ai-map-4c12-full-corpus-v2 \
  --v1-run ai-map-4c1-full-corpus-v1 \
  --out study-content/ai/runs/ai-map-4c12-full-corpus-v2/reports/post-gate-a-regression-set.json
```

The set (order is significant and fingerprinted in `sampleSha256`) contains:

- the four Gate A permanent-failure jobs (Condominium s.1, Highway s.44.1, Ownership of Minerals s.3, Quarriable Substances s.13) — the first two exercise the clobber fix; the latter two require fresh model generation;
- Clean Water Act s.13.1 (11-subsection density) and Limitation of Actions Act s.33 (consequential-amendment handling);
- Devolution of Estates Act s.21 (short provision — source-discipline wording) and Bituminous Shale Act s.27 (dense provision — actor narrowing);
- Regulation 83-130 s.7 (short source — input-boundary/truncation behavior);
- Gas Distribution Act s.4 (source contains the `LGiC` acronym — invented-acronym discipline) plus Gas Distribution Act s.12 as a clean same-document control.

The builder performs no model calls and writes byte-identical JSON for the same base run. To execute it against the local model later, start a fresh run directory prepared from the base corpus and pass this comparison set:

```bash
npm run study:ai:local-map -- \
  --run <new-run-id> \
  --model <local-model-id> \
  --comparison-set study-content/ai/runs/ai-map-4c12-full-corpus-v2/reports/post-gate-a-regression-set.json
```

Audit the result with `scripts/studyAiAuditMapRun.ts --comparison-set <that file>`; the set's `reasonSelected` values (`regression:<label>`) preserve each job's purpose in audit and review-bundle output.

## Full Regeneration Later

Only after human approval of the comparison set, run the full regeneration queue:

```bash
npm run study:ai:local-map -- --run ai-map-4c12-full-corpus-v2 --resume
```

Use `--resume` after interruptions. Never manually copy rejected generations into canonical `.results.jsonl` files. Rejected attempts stay under `local-failures/` with raw response and validation provenance.

## Runner Behavior

- Uses one model request per Study Map job.
- The system prompt is the canonical `study-content/ai/specs/study-map-v3.md` (loaded at run start, fail-closed if missing or empty) plus short runner-specific notes; the runner never carries a separate drifting copy of the Map prompt spec.
- Defaults to concurrency `1`.
- Requires strict JSON Schema structured output in production mode.
- Fails closed and aborts the run if the provider rejects structured output.
- Retries each semantically failed job up to two times after the initial attempt by default. Retry feedback keeps the canonical spec and original job, then appends a bounded JSON-only echo of the previous invalid response, the exact validation issue codes/messages, concise per-code fixes for deterministic requirements (for example `SUGGESTED_PRIORITY_REQUIRED`), an explicit mandatory restatement when the same error repeats, and the instruction to correct the previous response while preserving valid semantic decisions. Priority is never assigned or defaulted deterministically; the model still chooses it.
- Treats provider failures (connection resets, HTTP errors, timeouts, malformed or missing responses) as a separate class from semantic failures: each is classified (`PROVIDER_SOCKET_ERROR`, `PROVIDER_HTTP_ERROR`, `PROVIDER_TIMEOUT`, `PROVIDER_RESPONSE_ERROR`, `PROVIDER_RECOVERY_TIMEOUT`), polled against `GET <base-url>/models` until healthy (defaults: 300000 ms budget, 5000 ms poll; configurable with `--provider-recovery-timeout-ms` and `--provider-recovery-poll-ms`), and retried within the same semantic attempt up to `--max-provider-attempts` (default 3). Provider failures never consume semantic retries.
- Aborts the run (non-zero exit, all accepted results preserved) when the provider is still unhealthy after the recovery budget, exhausts the max provider attempts, or rejects structured output; re-run with `--resume` to continue from the preserved results.
- Skips already accepted jobs on resume and rewrites canonical JSONL atomically to avoid duplicate lines.
- Validates run identity fail-closed on every start: `reports/local-run-metadata.json` (model, comparison-set path/hash, batch job-file hashes; created on first start of a pre-existing run) and accepted-result integrity (no duplicate job IDs, result `runId` matching the job file's prepared `runId` — warm-started run directories keep the source run identity — jobs still present in the selected batch files, matching `authoringInputFingerprint`) must match.
- Appends every provider event to `reports/provider-events.jsonl` and writes numbered per-job `transport/provider` failure artifacts under `local-failures/<jobId>/` alongside semantic validation failures; all JSONL reads in the toolchain are UTF-8 BOM tolerant.
- `-h`/`--help` prints the full flag reference without requiring `--run` or `--model`.
- Stores non-secret provenance for accepted and rejected attempts.

## Skip Critic Execution Layer

`src/study/ai/studyAiSkipCriticExecutor.ts` is a runner-owned execution/provenance layer that wraps the single-attempt `runSkipCriticInference(...)`. It is standalone infrastructure: it is not yet wired into a `study:ai:*` CLI command and does not change the normal author workflow. It exists so Skip Critic runs are durable, resumable, and auditable.

Public API (module entry points):

```ts
runSkipCriticJob(job, options, (transport = fetch), timestamp);
runSkipCriticJobs(jobs, options, (transport = fetch), timestamp);
```

Options extend the runner options (`model`, `baseUrl`, `apiHeaderName`, `timeoutMs`, `apiKey`, `temperature`, `maxTokens`, `requireStructuredOutput`) and add:

- `runsDir` (default `study-content/ai/runs`) — the run directory that owns the critic namespace.
- `maxRetries` (default `2`) — bounded retry policy; total attempts = `maxRetries + 1`. Every attempt is a fresh inference with no repair, applied to both transport/provider failures and invalid model results.

Artifacts live in a critic-only namespace under the run directory so they can never collide with normal Study Map author outputs:

```text
study-content/ai/runs/<run-id>/critic/skip-critic.results.jsonl
study-content/ai/runs/<run-id>/critic/<jobId>.provenance.json
study-content/ai/runs/<run-id>/critic/failures/<jobId>/attempt-<n>.raw.json
study-content/ai/runs/<run-id>/critic/failures/<jobId>/attempt-<n>.validation.json
study-content/ai/runs/<run-id>/critic/<jobId>.terminal-failure.json
```

Resume is fail-safe: a job is skipped only when a stored result row AND a provenance file with `status: "success"` exist, the identity tuple (runId, jobId, corpusContentHash, inputHash, authoringInputFingerprint, promptSpecVersion) matches the current job, and the stored result still validates against the job's permitted evidence. Missing, malformed, identity-mismatched, or terminal-failure state is re-executed. A terminal failure is never reused or reinterpreted as success, and there is no silent fallback to `skip-supported`/`uncertain`. The model-authored `SkipCriticResult` is persisted verbatim with no runner identity, provenance, or attempt fields added to it.

The model is not called in tests: the executor is exercised through a scripted transport over `mkdtempSync` temp directories, and a corrupt/incomplete results file is treated as incomplete state (re-executed and rewritten atomically) rather than success.
