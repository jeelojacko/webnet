import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LSAEngine } from './engine/adjust';
import { normalizeInlineDirective } from './engine/parse';
import type { ParseCompatibilityDiagnostic, ParseOptions } from './types';

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

interface ProjectCheckResult {
  project: LegacyCorpusProject;
  snapshot: LegacyCorpusProjectSnapshot;
  silentDirectiveDrops: UnknownInlineDirectiveCandidate[];
  failures: string[];
}

interface HarnessRunSummary extends LegacyCorpusBaselineFile {
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

interface HarnessCliArgs {
  manifestPath: string;
  manifestPathForSummary: string;
  summaryJsonPath?: string;
  summaryTextPath?: string;
  baselinePath?: string;
  writeBaselinePath?: string;
}

const DEFAULT_MANIFEST_PATH = path.resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'legacy_compatibility_corpus_phase1.json',
);
const DEFAULT_BASELINE_PATH = path.resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'legacy_compatibility_corpus_phase1_baseline.json',
);

const normalizePath = (value: string): string => value.replace(/\\/g, '/');
const toPortablePath = (value: string): string => {
  const rel = path.relative(process.cwd(), value);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return normalizePath(rel);
  }
  return normalizePath(value);
};

const trimInlineCommentAndDescription = (line: string): string => {
  const hash = line.indexOf('#');
  const quote = line.indexOf("'");
  let cut = -1;
  if (hash >= 0) cut = hash;
  if (quote >= 0) cut = cut >= 0 ? Math.min(cut, quote) : quote;
  return (cut >= 0 ? line.slice(0, cut) : line).trim();
};

const parseSucceeded = (parseState: ParseOptions | undefined): boolean => {
  const includeErrorCount = parseState?.includeErrors?.length ?? 0;
  const parseErrorCount =
    parseState?.parseCompatibilityDiagnostics?.filter((diag) => diag.severity === 'error').length ??
    0;
  return includeErrorCount === 0 && parseErrorCount === 0;
};

const createIncludeResolver = (inputPath: string, includeCache: Map<string, string>) => {
  return ({ includePath, parentSourceFile }: { includePath: string; parentSourceFile?: string }) => {
    const baseFile =
      parentSourceFile && parentSourceFile !== '<input>' ? parentSourceFile : inputPath;
    const resolved = path.resolve(path.dirname(baseFile), includePath);
    const normalized = normalizePath(resolved);
    try {
      const cached = includeCache.get(normalized);
      if (cached != null) {
        return { sourceFile: normalized, content: cached };
      }
      const content = readFileSync(resolved, 'utf-8');
      includeCache.set(normalized, content);
      return { sourceFile: normalized, content };
    } catch {
      return null;
    }
  };
};

const buildSourceFileMap = (
  inputPath: string,
  inputText: string,
  includeCache: Map<string, string>,
): Map<string, string> => {
  const sourceFiles = new Map<string, string>();
  sourceFiles.set(normalizePath(inputPath), inputText);
  for (const [sourceFile, content] of includeCache.entries()) {
    sourceFiles.set(normalizePath(sourceFile), content);
  }
  return sourceFiles;
};

export const collectUnknownInlineDirectiveCandidates = (
  sourceFiles: Map<string, string>,
  abbreviationMode: ParseOptions['directiveAbbreviationMode'] = 'unique-prefix',
): UnknownInlineDirectiveCandidate[] => {
  const candidates: UnknownInlineDirectiveCandidate[] = [];
  for (const [sourceFile, content] of sourceFiles.entries()) {
    const lines = content.split('\n');
    lines.forEach((rawLine, index) => {
      const line = trimInlineCommentAndDescription(rawLine);
      if (!line || (!line.startsWith('.') && !line.startsWith('/'))) {
        return;
      }
      const token = line.split(/\s+/)[0] ?? '';
      const normalized = normalizeInlineDirective(token, abbreviationMode);
      if (normalized.unknown || normalized.ambiguous) {
        candidates.push({
          sourceFile: normalizePath(sourceFile),
          line: index + 1,
          token,
          reason: normalized.ambiguous ? 'ambiguous' : 'unknown',
        });
      }
    });
  }
  return candidates;
};

export const findSilentDirectiveDrops = (
  candidates: UnknownInlineDirectiveCandidate[],
  diagnostics: ParseCompatibilityDiagnostic[],
): UnknownInlineDirectiveCandidate[] => {
  const inlineRejected = new Set(
    diagnostics
      .filter((diag) => diag.code === 'STRICT_REJECTED' && diag.recordType === 'INLINE')
      .map((diag) => `${normalizePath(diag.sourceFile ?? '<input>')}:${diag.line}`),
  );
  return candidates.filter(
    (candidate) => !inlineRejected.has(`${normalizePath(candidate.sourceFile)}:${candidate.line}`),
  );
};

const loadManifest = (manifestPath: string): LegacyCorpusManifest => {
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as LegacyCorpusManifest;
};

const loadBaseline = (baselinePath: string): LegacyCorpusBaselineFile => {
  const raw = readFileSync(baselinePath, 'utf-8');
  return JSON.parse(raw) as LegacyCorpusBaselineFile;
};

const writeTextFile = (filePath: string, content: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
};

const writeJsonFile = (filePath: string, value: unknown): void => {
  writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const compareSummaryProjectsToBaseline = (
  projects: LegacyCorpusProjectSnapshot[],
  baselineProjects: LegacyCorpusProjectSnapshot[],
): string[] => {
  const mismatches: string[] = [];
  const currentById = new Map(projects.map((project) => [project.id, project]));
  const baselineById = new Map(baselineProjects.map((project) => [project.id, project]));
  const allIds = new Set([...currentById.keys(), ...baselineById.keys()]);
  const sortableIds = [...allIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const comparableKeys: Array<keyof LegacyCorpusProjectSnapshot> = [
    'profile',
    'parseMode',
    'runMode',
    'expectedParseSuccess',
    'expectedRunSuccess',
    'parseSuccess',
    'runSuccess',
    'stationCount',
    'observationCount',
    'includeErrorCount',
    'parseErrorDiagnosticCount',
    'strictRejectCount',
    'rewriteSuggestionCount',
    'ambiguousCount',
    'legacyFallbackCount',
    'runModeDiagnosticCodes',
    'silentDirectiveDropCount',
  ];

  sortableIds.forEach((id) => {
    const current = currentById.get(id);
    const baseline = baselineById.get(id);
    if (!current) {
      mismatches.push(`baseline project missing in current run: ${id}`);
      return;
    }
    if (!baseline) {
      mismatches.push(`new project not present in baseline: ${id}`);
      return;
    }
    comparableKeys.forEach((key) => {
      const currentValue = current[key];
      const baselineValue = baseline[key];
      const equal =
        Array.isArray(currentValue) || Array.isArray(baselineValue)
          ? JSON.stringify(currentValue) === JSON.stringify(baselineValue)
          : currentValue === baselineValue;
      if (!equal) {
        mismatches.push(
          `baseline mismatch ${id}.${key}: expected=${JSON.stringify(baselineValue)} actual=${JSON.stringify(currentValue)}`,
        );
      }
    });
  });
  return mismatches;
};

const parseArgs = (argv: string[]): HarnessCliArgs => {
  let manifestPath = DEFAULT_MANIFEST_PATH;
  let summaryJsonPath: string | undefined;
  let summaryTextPath: string | undefined;
  let baselinePath: string | undefined;
  let writeBaselinePath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --manifest');
      }
      manifestPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--summary-json') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --summary-json');
      }
      summaryJsonPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--summary-text') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --summary-text');
      }
      summaryTextPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --baseline');
      }
      baselinePath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--write-baseline') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --write-baseline');
      }
      writeBaselinePath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--ci') {
      baselinePath = DEFAULT_BASELINE_PATH;
      summaryJsonPath = path.resolve(process.cwd(), 'artifacts', 'legacy-corpus', 'summary.json');
      summaryTextPath = path.resolve(process.cwd(), 'artifacts', 'legacy-corpus', 'summary.txt');
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error('help');
    }
    throw new Error(`Unknown option "${arg}"`);
  }

  return {
    manifestPath,
    manifestPathForSummary: toPortablePath(manifestPath),
    summaryJsonPath,
    summaryTextPath,
    baselinePath,
    writeBaselinePath,
  };
};

const renderSummary = (summary: HarnessRunSummary): string => {
  const lines: string[] = [];
  lines.push('Legacy compatibility corpus harness');
  lines.push(`Manifest: ${summary.manifestPath}`);
  lines.push(`Projects: ${summary.projectCount}`);
  summary.projectFailures.forEach((projectFailure) => {
    lines.push(`FAIL ${projectFailure.id}`);
    projectFailure.failures.forEach((failure) => lines.push(`  - ${failure}`));
  });
  summary.projects.forEach((snapshot) => {
    if (summary.projectFailures.some((failure) => failure.id === snapshot.id)) return;
    lines.push(
      `PASS ${snapshot.id} (parse=${snapshot.parseSuccess}, run=${snapshot.runSuccess}, silentDrops=${snapshot.silentDirectiveDropCount})`,
    );
  });
  if (summary.baselineComparison) {
    if (summary.baselineComparison.mismatchCount === 0) {
      lines.push(`Baseline compare: PASS (${summary.baselineComparison.baselinePath})`);
    } else {
      lines.push(
        `Baseline compare: FAIL (${summary.baselineComparison.mismatchCount} mismatches)`,
      );
      summary.baselineComparison.mismatches.forEach((message) => lines.push(`  - ${message}`));
    }
  }
  lines.push(
    `Legacy corpus harness summary: projectFailures=${summary.projectFailureCount} baselineMismatches=${summary.baselineMismatchCount} gateFailed=${summary.gateFailed}`,
  );
  return lines.join('\n');
};

const runProjectChecks = (project: LegacyCorpusProject): ProjectCheckResult => {
  const inputPath = path.resolve(process.cwd(), project.inputPath);
  const input = readFileSync(inputPath, 'utf-8');
  const includeCache = new Map<string, string>();
  const parseOptions: Partial<ParseOptions> = {
    runMode: project.runMode,
    preanalysisMode: project.runMode === 'preanalysis',
    parseCompatibilityMode: project.parseMode,
    parseModeMigrated: project.parseMode === 'strict',
    sourceFile: normalizePath(inputPath),
    includeResolver: createIncludeResolver(normalizePath(inputPath), includeCache),
  };

  if (project.profile === 'industry-parity') {
    parseOptions.directionSetMode = 'raw';
    parseOptions.robustMode = 'none';
    parseOptions.tsCorrelationEnabled = false;
    parseOptions.tsCorrelationRho = 0;
  }

  const result = new LSAEngine({
    input,
    maxIterations: 15,
    parseOptions,
  }).solve();

  const parseState = result.parseState;
  const parseSuccess = parseSucceeded(parseState);
  const runSuccess = result.success;
  const sourceFiles = buildSourceFileMap(inputPath, input, includeCache);
  const unknownInlineCandidates = collectUnknownInlineDirectiveCandidates(
    sourceFiles,
    parseOptions.directiveAbbreviationMode ?? 'unique-prefix',
  );
  const silentDirectiveDrops = findSilentDirectiveDrops(
    unknownInlineCandidates,
    parseState?.parseCompatibilityDiagnostics ?? [],
  );
  const runModeDiagnosticCodes = [
    ...new Set((parseState?.runModeCompatibilityDiagnostics ?? []).map((diag) => diag.code)),
  ].sort();
  const requiredDiagnostics = project.expected.requiredDiagnostics ?? [];
  const missingRequiredDiagnostics = requiredDiagnostics.filter(
    (code) => !runModeDiagnosticCodes.includes(code),
  );

  const failures: string[] = [];
  if (parseSuccess !== project.expected.parseSuccess) {
    failures.push(
      `parse-success mismatch: expected=${project.expected.parseSuccess} actual=${parseSuccess}`,
    );
  }
  if (runSuccess !== project.expected.runSuccess) {
    failures.push(
      `run-success mismatch: expected=${project.expected.runSuccess} actual=${runSuccess}`,
    );
  }
  if (silentDirectiveDrops.length > 0) {
    failures.push(
      `silent directive drops detected (${silentDirectiveDrops.length}) for unknown/ambiguous inline options`,
    );
    silentDirectiveDrops.forEach((drop) => {
      failures.push(`silent-drop at ${drop.sourceFile}:${drop.line} token=${drop.token}`);
    });
  }
  if (missingRequiredDiagnostics.length > 0) {
    failures.push(`missing required diagnostics: ${missingRequiredDiagnostics.join(', ')}`);
  }

  const snapshot: LegacyCorpusProjectSnapshot = {
    id: project.id,
    profile: project.profile,
    parseMode: project.parseMode,
    runMode: project.runMode,
    expectedParseSuccess: project.expected.parseSuccess,
    expectedRunSuccess: project.expected.runSuccess,
    parseSuccess,
    runSuccess,
    stationCount: Object.keys(result.stations).length,
    observationCount: result.observations.length,
    includeErrorCount: parseState?.includeErrors?.length ?? 0,
    parseErrorDiagnosticCount:
      parseState?.parseCompatibilityDiagnostics?.filter((diag) => diag.severity === 'error').length ??
      0,
    strictRejectCount: parseState?.strictRejectCount ?? 0,
    rewriteSuggestionCount: parseState?.rewriteSuggestionCount ?? 0,
    ambiguousCount: parseState?.ambiguousCount ?? 0,
    legacyFallbackCount: parseState?.legacyFallbackCount ?? 0,
    runModeDiagnosticCodes,
    silentDirectiveDropCount: silentDirectiveDrops.length,
  };

  return {
    project,
    snapshot,
    silentDirectiveDrops,
    failures,
  };
};

export const runLegacyCorpusHarness = (argv: string[] = []): number => {
  let args: HarnessCliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'help') {
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
      return 0;
    }
    process.stderr.write(
      `Legacy corpus harness argument error: ${message}\nUse --help for usage.\n`,
    );
    return 2;
  }

  let manifest: LegacyCorpusManifest;
  try {
    manifest = loadManifest(args.manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to load legacy corpus manifest "${args.manifestPath}": ${message}\n`);
    return 2;
  }

  const projectResults = manifest.projects.map((project) => runProjectChecks(project));
  const projectFailures = projectResults
    .filter((result) => result.failures.length > 0)
    .map((result) => ({
      id: result.project.id,
      failures: result.failures,
    }));

  let baselineComparison:
    | {
        baselinePath: string;
        mismatchCount: number;
        mismatches: string[];
      }
    | undefined;
  if (args.baselinePath) {
    try {
      const baseline = loadBaseline(args.baselinePath);
      const mismatches = compareSummaryProjectsToBaseline(
        projectResults.map((result) => result.snapshot),
        baseline.projects,
      );
      baselineComparison = {
        baselinePath: toPortablePath(args.baselinePath),
        mismatchCount: mismatches.length,
        mismatches,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      baselineComparison = {
        baselinePath: toPortablePath(args.baselinePath),
        mismatchCount: 1,
        mismatches: [`failed to load/compare baseline: ${message}`],
      };
    }
  }

  const baselineMismatchCount = baselineComparison?.mismatchCount ?? 0;
  const gateFailed = projectFailures.length > 0 || baselineMismatchCount > 0;
  const summary: HarnessRunSummary = {
    schemaVersion: 1,
    manifestPath: args.manifestPathForSummary,
    projectCount: projectResults.length,
    projects: projectResults.map((result) => result.snapshot),
    generatedAt: new Date().toISOString(),
    projectFailureCount: projectFailures.length,
    baselineMismatchCount,
    gateFailed,
    projectFailures,
    baselineComparison,
  };

  const summaryText = `${renderSummary(summary)}\n`;
  process.stdout.write(summaryText);

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

  return gateFailed ? 1 : 0;
};

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisPath = path.resolve(fileURLToPath(import.meta.url));
if (entryPath && entryPath === thisPath) {
  process.exit(runLegacyCorpusHarness(process.argv.slice(2)));
}
