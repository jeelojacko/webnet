import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { ParseOptions } from './types';
import { runProjectChecks } from './legacyCorpusProjectChecks';
import {
  compareSummaryProjectsToBaseline,
  loadBaseline,
  loadManifest,
  parseArgs,
  renderSummary,
  toPortablePath,
  writeJsonFile,
  writeTextFile,
} from './legacyCorpusHarnessSupport';

export {
  collectUnknownInlineDirectiveCandidates,
  findSilentDirectiveDrops,
} from './legacyCorpusProjectChecks';
export { compareSummaryProjectsToBaseline } from './legacyCorpusHarnessSupport';

type SolveProfile = 'webnet' | 'industry-parity';

export interface LegacyCorpusProject {
  id: string;
  inputPath: string;
  profile: SolveProfile;
  parseMode: 'legacy' | 'strict';
  runMode: NonNullable<ParseOptions['runMode']>;
  expected: {
    parseSuccess: boolean;
    runSuccess: boolean;
    requiredDiagnostics?: string[];
  };
  tags?: string[];
}

export interface LegacyCorpusManifest {
  version: number;
  description: string;
  projects: LegacyCorpusProject[];
}

export interface UnknownInlineDirectiveCandidate {
  sourceFile: string;
  line: number;
  token: string;
  reason: 'unknown' | 'ambiguous';
}

export interface LegacyCorpusProjectSnapshot {
  id: string;
  profile: SolveProfile;
  parseMode: LegacyCorpusProject['parseMode'];
  runMode: LegacyCorpusProject['runMode'];
  expectedParseSuccess: boolean;
  expectedRunSuccess: boolean;
  parseSuccess: boolean;
  runSuccess: boolean;
  stationCount: number;
  observationCount: number;
  includeErrorCount: number;
  parseErrorDiagnosticCount: number;
  strictRejectCount: number;
  rewriteSuggestionCount: number;
  ambiguousCount: number;
  legacyFallbackCount: number;
  runModeDiagnosticCodes: string[];
  silentDirectiveDropCount: number;
}

export interface LegacyCorpusBaselineFile {
  schemaVersion: 1;
  manifestPath: string;
  projectCount: number;
  projects: LegacyCorpusProjectSnapshot[];
}

export interface HarnessRunSummary extends LegacyCorpusBaselineFile {
  generatedAt: string;
  projectFailureCount: number;
  baselineMismatchCount: number;
  gateFailed: boolean;
  projectFailures: Array<{
    id: string;
    failures: string[];
  }>;
  baselineComparison?: {
    baselinePath: string;
    mismatchCount: number;
    mismatches: string[];
  };
}

export interface HarnessCliArgs {
  manifestPath: string;
  manifestPathForSummary: string;
  summaryJsonPath?: string;
  summaryTextPath?: string;
  baselinePath?: string;
  writeBaselinePath?: string;
}

const printUsage = (): void => {
  process.stdout.write(
    [
      'Usage: npm run corpus:legacy [-- [options]]',
      '',
      'Options:',
      '  --manifest <path>        Corpus manifest path',
      '  --summary-json <path>    Write JSON summary file',
      '  --summary-text <path>    Write text summary file',
      '  --baseline <path>        Compare current run against baseline snapshot',
      '  --write-baseline <path>  Write baseline snapshot from current run',
      '  --ci                     Use CI defaults (baseline + artifact outputs)',
    ].join('\n') + '\n',
  );
};

const resolveArgs = (argv: string[]): HarnessCliArgs | number => {
  try {
    return parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'help') {
      printUsage();
      return 0;
    }
    process.stderr.write(
      `Legacy corpus harness argument error: ${message}\nUse --help for usage.\n`,
    );
    return 2;
  }
};

const buildBaselineComparison = (
  args: HarnessCliArgs,
  snapshots: LegacyCorpusProjectSnapshot[],
): HarnessRunSummary['baselineComparison'] => {
  if (!args.baselinePath) return undefined;
  try {
    const baseline = loadBaseline(args.baselinePath);
    const mismatches = compareSummaryProjectsToBaseline(snapshots, baseline.projects);
    return {
      baselinePath: toPortablePath(args.baselinePath),
      mismatchCount: mismatches.length,
      mismatches,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      baselinePath: toPortablePath(args.baselinePath),
      mismatchCount: 1,
      mismatches: [`failed to load/compare baseline: ${message}`],
    };
  }
};

const writeSummaryOutputs = (
  args: HarnessCliArgs,
  summary: HarnessRunSummary,
  summaryText: string,
): number | null => {
  if (args.summaryTextPath) {
    try {
      writeTextFile(args.summaryTextPath, summaryText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to write summary text "${args.summaryTextPath}": ${message}\n`);
      return 2;
    }
  }

  if (args.summaryJsonPath) {
    try {
      writeJsonFile(args.summaryJsonPath, summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to write summary JSON "${args.summaryJsonPath}": ${message}\n`);
      return 2;
    }
  }

  if (args.writeBaselinePath) {
    try {
      const baseline: LegacyCorpusBaselineFile = {
        schemaVersion: 1,
        manifestPath: args.manifestPathForSummary,
        projectCount: summary.projectCount,
        projects: summary.projects,
      };
      writeJsonFile(args.writeBaselinePath, baseline);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to write baseline "${args.writeBaselinePath}": ${message}\n`);
      return 2;
    }
  }

  return null;
};

export const runLegacyCorpusHarness = (argv: string[] = []): number => {
  const argsOrExitCode = resolveArgs(argv);
  if (typeof argsOrExitCode === 'number') return argsOrExitCode;
  const args = argsOrExitCode;

  let manifest: LegacyCorpusManifest;
  try {
    manifest = loadManifest(args.manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Failed to load legacy corpus manifest "${args.manifestPath}": ${message}\n`,
    );
    return 2;
  }

  const projectResults = manifest.projects.map((project) => runProjectChecks(project));
  const projectFailures = projectResults
    .filter((result) => result.failures.length > 0)
    .map((result) => ({ id: result.project.id, failures: result.failures }));
  const snapshots = projectResults.map((result) => result.snapshot);
  const baselineComparison = buildBaselineComparison(args, snapshots);
  const baselineMismatchCount = baselineComparison?.mismatchCount ?? 0;
  const gateFailed = projectFailures.length > 0 || baselineMismatchCount > 0;
  const summary: HarnessRunSummary = {
    schemaVersion: 1,
    manifestPath: args.manifestPathForSummary,
    projectCount: projectResults.length,
    projects: snapshots,
    generatedAt: new Date().toISOString(),
    projectFailureCount: projectFailures.length,
    baselineMismatchCount,
    gateFailed,
    projectFailures,
    baselineComparison,
  };

  const summaryText = `${renderSummary(summary)}\n`;
  process.stdout.write(summaryText);
  const outputErrorCode = writeSummaryOutputs(args, summary, summaryText);
  if (outputErrorCode != null) return outputErrorCode;
  return gateFailed ? 1 : 0;
};

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisPath = path.resolve(fileURLToPath(import.meta.url));
if (entryPath && entryPath === thisPath) {
  process.exit(runLegacyCorpusHarness(process.argv.slice(2)));
}
