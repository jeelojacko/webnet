import { readFileSync } from 'node:fs';
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

interface ProjectCheckResult {
  project: LegacyCorpusProject;
  parseSuccess: boolean;
  runSuccess: boolean;
  silentDirectiveDrops: UnknownInlineDirectiveCandidate[];
  missingRequiredDiagnostics: string[];
  failures: string[];
}

interface HarnessRunSummary {
  manifestPath: string;
  projectCount: number;
  passedCount: number;
  failedCount: number;
  projectResults: ProjectCheckResult[];
}

const DEFAULT_MANIFEST_PATH = path.resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'legacy_compatibility_corpus_phase1.json',
);

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

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
  const requiredDiagnostics = project.expected.requiredDiagnostics ?? [];
  const runDiagCodes = new Set(
    (parseState?.runModeCompatibilityDiagnostics ?? []).map((diag) => diag.code),
  );
  const missingRequiredDiagnostics = requiredDiagnostics.filter((code) => !runDiagCodes.has(code));

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
  }
  if (missingRequiredDiagnostics.length > 0) {
    failures.push(`missing required diagnostics: ${missingRequiredDiagnostics.join(', ')}`);
  }

  return {
    project,
    parseSuccess,
    runSuccess,
    silentDirectiveDrops,
    missingRequiredDiagnostics,
    failures,
  };
};

const loadManifest = (manifestPath: string): LegacyCorpusManifest => {
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as LegacyCorpusManifest;
};

const parseArgs = (argv: string[]): { manifestPath: string } => {
  let manifestPath = DEFAULT_MANIFEST_PATH;
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
    if (arg === '--help' || arg === '-h') {
      throw new Error('help');
    }
    throw new Error(`Unknown option "${arg}"`);
  }
  return { manifestPath };
};

const renderSummary = (summary: HarnessRunSummary): string => {
  const lines: string[] = [];
  lines.push('Legacy compatibility corpus harness');
  lines.push(`Manifest: ${summary.manifestPath}`);
  lines.push(`Projects: ${summary.projectCount}`);
  summary.projectResults.forEach((projectResult) => {
    if (projectResult.failures.length === 0) {
      lines.push(
        `PASS ${projectResult.project.id} (parse=${projectResult.parseSuccess}, run=${projectResult.runSuccess}, silentDrops=0)`,
      );
      return;
    }
    lines.push(`FAIL ${projectResult.project.id}`);
    projectResult.failures.forEach((failure) => lines.push(`  - ${failure}`));
    projectResult.silentDirectiveDrops.forEach((drop) =>
      lines.push(`  - silent-drop at ${drop.sourceFile}:${drop.line} token=${drop.token}`),
    );
  });
  lines.push(
    `Legacy corpus harness summary: passed=${summary.passedCount} failed=${summary.failedCount}`,
  );
  return lines.join('\n');
};

export const runLegacyCorpusHarness = (argv: string[] = []): number => {
  let manifestPath: string;
  try {
    manifestPath = parseArgs(argv).manifestPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'help') {
      process.stdout.write(
        'Usage: npm run corpus:legacy [-- --manifest <path/to/legacy_compatibility_corpus.json>]\n',
      );
      return 0;
    }
    process.stderr.write(
      `Legacy corpus harness argument error: ${message}\nUsage: npm run corpus:legacy [-- --manifest <path>]\n`,
    );
    return 2;
  }

  let manifest: LegacyCorpusManifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to load legacy corpus manifest "${manifestPath}": ${message}\n`);
    return 2;
  }

  const projectResults = manifest.projects.map((project) => runProjectChecks(project));
  const failedCount = projectResults.filter((result) => result.failures.length > 0).length;
  const passedCount = projectResults.length - failedCount;
  const summary: HarnessRunSummary = {
    manifestPath,
    projectCount: projectResults.length,
    passedCount,
    failedCount,
    projectResults,
  };
  process.stdout.write(`${renderSummary(summary)}\n`);
  return failedCount === 0 ? 0 : 1;
};

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisPath = path.resolve(fileURLToPath(import.meta.url));
if (entryPath && entryPath === thisPath) {
  process.exit(runLegacyCorpusHarness(process.argv.slice(2)));
}
