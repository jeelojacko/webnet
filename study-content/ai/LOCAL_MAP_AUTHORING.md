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

5. Set local configuration:

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

## Full Regeneration Later

Only after human approval of the comparison set, run the full regeneration queue:

```bash
npm run study:ai:local-map -- --run ai-map-4c12-full-corpus-v2 --resume
```

Use `--resume` after interruptions. Never manually copy rejected generations into canonical `.results.jsonl` files. Rejected attempts stay under `local-failures/` with raw response and validation provenance.

## Runner Behavior

- Uses one model request per Study Map job.
- Defaults to concurrency `1`.
- Requires strict JSON Schema structured output in production mode.
- Fails closed if the provider rejects structured output.
- Retries each failed job up to two times after the initial attempt by default.
- Skips already accepted jobs on resume and rewrites canonical JSONL atomically to avoid duplicate lines.
- Stores non-secret provenance for accepted and rejected attempts.
