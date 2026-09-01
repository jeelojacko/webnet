#!/usr/bin/env tsx
/**
 * Post-QC Study Map semantic review — decision validation + preview CLI.
 *
 * Validates a human-authored review-decision file (see
 * study-content/ai/review/post-qc-map-review-decision.template.json) against
 * an accepted run and previews its effect. Deterministic, no model
 * inference, and never modifies canonical results: it only writes an
 * optional preview JSON report.
 *
 * Decision classes:
 *   no-change                     priority kept AND grouping kept
 *   priority-only-adjudicable     grouping unchanged, priority P1-P4 changed
 *   requires-corrected-map-result grouping changed / awaiting human review —
 *                                 requires a complete corrected Map result
 *                                 artifact (same path as study:ai:adjudicate-result)
 *   invalid                       parse/classification problem (listed in issues)
 *
 * Usage:
 *   npx tsx scripts/studyAiReviewMapPostQc.ts --run <runId> \
 *     --decisions <decision-file.json> [--dry-run] [--out <preview.json>]
 *
 * Exit codes: 0 = all decisions valid; 1 = issues found or bad arguments.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  classifyMapReviewDecisions,
  parseMapReviewDecisionFile,
  REVIEW_DECISION_TYPE,
  REVIEW_DECISION_SCHEMA_VERSION,
  type ClassifiedDecision,
  type ReviewPriority,
} from '../src/study/ai/studyAiReviewDecision';
import { RUNS_DIR } from './studyAiLocalMapAuthor';
import { loadResults } from './studyAiAuditPostProductionSemantics';

const HELP = `Post-QC Study Map review decision validator / preview.

Usage:
  npx tsx scripts/studyAiReviewMapPostQc.ts --run <runId> \\
    --decisions <decision-file.json> [--dry-run] [--out <preview.json>]

  --run <runId>            production run id (decision file runId must match)
  --decisions <file>       review-decision JSON file to validate
  --dry-run                print the preview to stdout; write no files
  --out <path>             preview output path (default: <run>/reports/review-decision-preview.json)

The canonical results are never modified by this tool.
`;

const parseArgs = (argv: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') {
      out.dryRun = '1';
    } else if (key === 'help' || key === 'h') {
      out.help = '1';
    } else {
      out[key] = argv[i + 1];
      i += 1;
    }
  }
  return out;
};


const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help !== undefined) {
    process.stdout.write(HELP);
    return;
  }
  const runId = args.run;
  const decisionsPath = args.decisions;
  if (!runId || !decisionsPath) {
    process.stdout.write(HELP);
    process.exitCode = 1;
    return;
  }
  const runDir = join(RUNS_DIR, runId);
  if (!existsSync(runDir)) {
    console.error(`run directory not found: ${runDir}`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(decisionsPath)) {
    console.error(`decision file not found: ${resolve(decisionsPath)}`);
    process.exitCode = 1;
    return;
  }

  let parsed: unknown;
  try {
    const text = readFileSync(decisionsPath, 'utf8').replace(/^\uFEFF/, '');
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(`cannot parse decision file: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const { file, issues: parseIssues } = parseMapReviewDecisionFile(parsed);
  const allIssues = [...parseIssues];

  const results = loadResults(runDir);
  const currentPriorities = new Map<string, ReviewPriority | null>();
  for (const result of results) {
    if (currentPriorities.has(result.jobId)) continue;
    currentPriorities.set(
      result.jobId,
      (result.suggestedPriority ?? null) as ReviewPriority | null,
    );
  }

  const classif: ClassifiedDecision[] =
    file !== null ? classifyMapReviewDecisions(file, currentPriorities).classifications : [];
  if (file !== null) {
    if (file.runId !== runId) {
      allIssues.push({
        jobId: null,
        code: 'run-mismatch',
        message: `decision file runId '${file.runId}' does not match --run '${runId}'`,
      });
    }
    allIssues.push(...classifyMapReviewDecisions(file, currentPriorities).issues);
  }

  const counts: Record<ClassifiedDecision['classification'], number> = {
    'no-change': 0,
    'priority-only-adjudicable': 0,
    'requires-corrected-map-result': 0,
    invalid: 0,
  };
  for (const c of classif) counts[c.classification] += 1;

  const preview = {
    schemaVersion: REVIEW_DECISION_SCHEMA_VERSION,
    kind: 'review-decision-preview',
    reviewType: REVIEW_DECISION_TYPE,
    runId,
    decisionFile: resolve(decisionsPath),
    note: 'Preview only — canonical Map results are never modified by this tool.',
    decisionsTotal: classif.length,
    counts,
    issueCount: allIssues.length,
    issues: allIssues,
    classifications: classif,
  };
  const previewText = `${JSON.stringify(preview, null, 2)}\n`;

  if (args.dryRun) {
    process.stdout.write(previewText);
    process.exitCode = allIssues.length > 0 ? 1 : 0;
    return;
  }

  const outPath = args.out ?? join(runDir, 'reports', 'review-decision-preview.json');
  writeFileSync(outPath, previewText);
  console.log(`wrote ${resolve(outPath)}`);
  console.log(
    `decisions=${classif.length} no-change=${counts['no-change']} ` +
      `priority-only=${counts['priority-only-adjudicable']} ` +
      `requires-corrected-map-result=${counts['requires-corrected-map-result']} ` +
      `invalid=${counts.invalid} issues=${allIssues.length}`,
  );
  if (allIssues.length > 0) {
    for (const issue of allIssues) {
      console.error(`ISSUE [${issue.code}] ${issue.jobId ?? '(file)'}: ${issue.message}`);
    }
    process.exitCode = 1;
  }
};

if (process.argv[1]?.endsWith('studyAiReviewMapPostQc.ts')) main();
