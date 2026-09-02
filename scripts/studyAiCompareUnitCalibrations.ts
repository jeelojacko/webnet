/**
 * V4/V5 calibration comparison CLI (WV5, deterministic, no AI).
 *
 * Loads the frozen V4 + V5 sibling calibration-80 runs through the
 * authoritative crosswalk (reports/unit-calibration-v4-v5-crosswalk-20260902.json),
 * revalidates every accepted proposal with the canonical validator, and
 * writes four byte-deterministic artifacts under the reports dir:
 *
 *   unit-calibration-v4-v5-comparison-20260902.json        machine comparison
 *   unit-calibration-v4-v5-comparison-20260902.md          concise companion
 *   unit-calibration-v4-v5-human-review-20260902.json      80-row risk-ordered review
 *   unit-calibration-v4-v5-human-review-20260902.md        tiered human-readable review
 *
 * Fails closed (nonzero exit, no artifacts) on any integrity violation:
 * crosswalk must hold exactly 80 rows with strict seq order; each run must
 * contain all 80 of its crosswalk-side job ids; any missing job id is named.
 * No provider calls, no wall clock (fixed 20260902 identity), no RNG — a
 * second identical run produces byte-identical files.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCompareDocs } from '../src/study/ai/studyAiUnitCalibrationCompare';
import { renderComparisonMarkdown, renderCompareHumanReviewMarkdown } from '../src/study/ai/studyAiUnitCalibrationCompare.markdown';
import {
  defaultComparePaths,
  loadCompareContext,
  type CompareLoadPaths,
} from '../src/study/ai/studyAiUnitCalibrationCompare.load';

const DATE_TAG = '20260902';
const DEFAULT_REPORTS_DIR = 'reports';

export const COMPARISON_JSON_NAME = `unit-calibration-v4-v5-comparison-${DATE_TAG}.json`;
export const COMPARISON_MD_NAME = `unit-calibration-v4-v5-comparison-${DATE_TAG}.md`;
export const HUMAN_REVIEW_JSON_NAME = `unit-calibration-v4-v5-human-review-${DATE_TAG}.json`;
export const HUMAN_REVIEW_MD_NAME = `unit-calibration-v4-v5-human-review-${DATE_TAG}.md`;

export type CompareCliOptions = {
  reportsDir?: string;
  v4RunDir?: string;
  v5RunDir?: string;
  crosswalk?: string;
  v4Review?: string;
  package?: string;
  specV4?: string;
  specV5?: string;
};

export const COMPARE_CLI_HELP = `studyAiCompareUnitCalibrations.ts — deterministic V4/V5 calibration comparison

Usage:
  npx tsx scripts/studyAiCompareUnitCalibrations.ts [options]

Options:
  --reports-dir <dir>  Where artifacts are written (default reports)
  --v4-run-dir <dir>   V4 run dir (default study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4)
  --v5-run-dir <dir>   V5 run dir (default study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v5)
  --crosswalk <path>   Crosswalk report (default reports/unit-calibration-v4-v5-crosswalk-20260902.json)
  --v4-review <path>   V4 human-review artifact (default reports/unit-calibration-80-human-review-20260902.json)
  --package <path>     Corpus content package (default study-content/packages/nb-sit-statute-corpus.content-package.json)
  --spec-v4 <path>     unit-authoring-v4 spec file
  --spec-v5 <path>     unit-authoring-v5 spec file
  --help               Show this help

Read-only against the run dirs; writes the four comparison artifacts into the
reports dir. Fails closed on crosswalk/run integrity violations (crosswalk
must have exactly 80 rows; every crosswalk job id must exist in its run's
jobs). Deterministic: generatedAt 2026-09-02T00:00:00.000Z, seq-stable
ordering, SHA-256 input digests embedded, so a second identical run produces
byte-identical files.`;

const parseOptions = (rawArgs: string[]): CompareCliOptions => {
  const valueOf = (name: string): string | undefined => {
    const at = rawArgs.indexOf(`--${name}`);
    return at >= 0 ? rawArgs[at + 1] : undefined;
  };
  const reportsDir = valueOf('reports-dir') ?? DEFAULT_REPORTS_DIR;
  const defaults = defaultComparePaths(reportsDir);
  return {
    reportsDir,
    v4RunDir: valueOf('v4-run-dir') ?? defaults.v4RunDir,
    v5RunDir: valueOf('v5-run-dir') ?? defaults.v5RunDir,
    crosswalk: valueOf('crosswalk') ?? defaults.crosswalkPath,
    v4Review: valueOf('v4-review') ?? defaults.v4ReviewPath,
    package: valueOf('package') ?? defaults.packagePath,
    specV4: valueOf('spec-v4') ?? defaults.specV4Path ?? undefined,
    specV5: valueOf('spec-v5') ?? defaults.specV5Path ?? undefined,
  };
};

const jsonl = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

export const writeCompareArtifacts = (options: CompareCliOptions): string[] => {
  const reportsDir = resolve(options.reportsDir ?? DEFAULT_REPORTS_DIR);
  const paths: CompareLoadPaths = {
    v4RunDir: resolve(options.v4RunDir ?? defaultComparePaths(reportsDir).v4RunDir),
    v5RunDir: resolve(options.v5RunDir ?? defaultComparePaths(reportsDir).v5RunDir),
    crosswalkPath: resolve(options.crosswalk ?? defaultComparePaths(reportsDir).crosswalkPath),
    v4ReviewPath: resolve(options.v4Review ?? defaultComparePaths(reportsDir).v4ReviewPath),
    selectionReportPath: resolve(defaultComparePaths(reportsDir).selectionReportPath),
    packagePath: resolve(options.package ?? defaultComparePaths(reportsDir).packagePath),
    specV4Path: options.specV4 ? resolve(options.specV4) : null,
    specV5Path: options.specV5 ? resolve(options.specV5) : null,
  };
  const context = loadCompareContext(paths);
  const docs = buildCompareDocs(context);
  const reconciliation = docs.comparison.warnings.v4CoverageReconciliation;
  if (!reconciliation.matched) {
    throw new Error(
      `Comparison integrity failure: V4 coverage-warning recompute diverged from the frozen prior ` +
        `audit (expected ${reconciliation.expected.APPROVED_FOCUS_NOT_COVERED} APPROVED_FOCUS_NOT_COVERED / ` +
        `${reconciliation.expected.UNCOVERED_SUBSTANTIVE_SOURCE} UNCOVERED_SUBSTANTIVE_SOURCE; recomputed ` +
        `${reconciliation.recomputed.APPROVED_FOCUS_NOT_COVERED} / ` +
        `${reconciliation.recomputed.UNCOVERED_SUBSTANTIVE_SOURCE}). No artifacts were written.`,
    );
  }
  const artifactPaths = [
    join(reportsDir, COMPARISON_JSON_NAME),
    join(reportsDir, COMPARISON_MD_NAME),
    join(reportsDir, HUMAN_REVIEW_JSON_NAME),
    join(reportsDir, HUMAN_REVIEW_MD_NAME),
  ];
  jsonl(artifactPaths[0], docs.comparison);
  writeFileSync(artifactPaths[1], renderComparisonMarkdown(docs.comparison), 'utf8');
  jsonl(artifactPaths[2], docs.humanReview);
  writeFileSync(artifactPaths[3], renderCompareHumanReviewMarkdown(docs.humanReview), 'utf8');
  return artifactPaths;
};

const main = (): void => {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    process.stdout.write(`${COMPARE_CLI_HELP.trimEnd()}\n`);
    return;
  }
  try {
    const options = parseOptions(rawArgs);
    const artifactPaths = writeCompareArtifacts(options);
    process.stdout.write('Wrote V4/V5 comparison artifacts:\n');
    artifactPaths.forEach((path) => process.stdout.write(`  ${path}\n`));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
};

if (process.argv[1]?.endsWith('.ts')) {
  main();
}

export const __studyAiCompareUnitCalibrationsTest = {
  parseOptions,
  writeCompareArtifacts,
  COMPARE_CLI_HELP,
  COMPARISON_JSON_NAME,
  COMPARISON_MD_NAME,
  HUMAN_REVIEW_JSON_NAME,
  HUMAN_REVIEW_MD_NAME,
};
