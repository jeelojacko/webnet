import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type {
  HarnessCliArgs,
  HarnessRunSummary,
  LegacyCorpusBaselineFile,
  LegacyCorpusManifest,
  LegacyCorpusProjectSnapshot,
} from './legacyCorpusHarness';

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

export const normalizePath = (value: string): string => value.replace(/\\/g, '/');

export const toPortablePath = (value: string): string => {
  const rel = path.relative(process.cwd(), value);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return normalizePath(rel);
  }
  return normalizePath(value);
};

export const loadManifest = (manifestPath: string): LegacyCorpusManifest => {
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as LegacyCorpusManifest;
};

export const loadBaseline = (baselinePath: string): LegacyCorpusBaselineFile => {
  const raw = readFileSync(baselinePath, 'utf-8');
  return JSON.parse(raw) as LegacyCorpusBaselineFile;
};

export const writeTextFile = (filePath: string, content: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
};

export const writeJsonFile = (filePath: string, value: unknown): void => {
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

export const parseArgs = (argv: string[]): HarnessCliArgs => {
  let manifestPath = DEFAULT_MANIFEST_PATH;
  let summaryJsonPath: string | undefined;
  let summaryTextPath: string | undefined;
  let baselinePath: string | undefined;
  let writeBaselinePath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --manifest');
      manifestPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--summary-json') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --summary-json');
      summaryJsonPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--summary-text') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --summary-text');
      summaryTextPath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --baseline');
      baselinePath = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (arg === '--write-baseline') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --write-baseline');
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
    if (arg === '--help' || arg === '-h') throw new Error('help');
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

export const renderSummary = (summary: HarnessRunSummary): string => {
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
      lines.push(`Baseline compare: FAIL (${summary.baselineComparison.mismatchCount} mismatches)`);
      summary.baselineComparison.mismatches.forEach((message) => lines.push(`  - ${message}`));
    }
  }
  lines.push(
    `Legacy corpus harness summary: projectFailures=${summary.projectFailureCount} baselineMismatches=${summary.baselineMismatchCount} gateFailed=${summary.gateFailed}`,
  );
  return lines.join('\n');
};
