/**
 * Data collection for the local Study Map run auditor.
 *
 * Reads one local-model run directory (results jsonl, per-job provenance,
 * local-failures attempt records) plus a comparison set and the base run's
 * jobs, and produces one deterministic `JobAuditRecord` per selected job.
 *
 * Failure files store `issues` as `"CODE: message"` strings; some validators
 * emit objects `{ code, severity, message }`. `normalizeIssue` accepts both.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { categoryForJob, structuralStrataForJob } from './studyAiMapStrata';

export type NormalizedIssue = {
  code: string;
  severity: 'error' | 'warning' | 'unspecified';
  message: string;
};

export type AttemptRecord = {
  attempt: number;
  issueCodes: string[];
  issues: NormalizedIssue[];
  timestamp?: string;
  rawHash?: string;
};

export type JobAuditRecord = {
  jobId: string;
  documentId: string | null;
  categories: string[];
  structuralStrata: string[];
  result: AiStudyMapResult | null;
  attempts: AttemptRecord[];
  totalAttempts: number;
  accepted: boolean;
  firstTryAccepted: boolean;
  retryIntroducedDifferentError: boolean;
  repeatedIdenticalError: boolean;
  permanentFailureAttempt: AttemptRecord | null;
  provenance: { modelId?: string; attempt?: number; structuredOutputMode?: string } | null;
};

export type ComparisonSetJob = {
  v2JobId: string;
  document?: { documentId?: string };
  v1JobId?: string | null;
  v1KnownGoodResultLocation?: string | null;
  v1ResultIdentity?: string | null;
  complexityCategory?: string[];
  structuralStrata?: string[];
};

export type ComparisonSet = {
  baseRunId?: string;
  v2RunId?: string;
  seed?: string;
  size?: number;
  sampleSha256?: string;
  jobs: ComparisonSetJob[];
};

export const normalizeIssue = (entry: unknown): NormalizedIssue => {
  if (typeof entry === 'string') {
    const sep = entry.indexOf(': ');
    const code = sep >= 0 ? entry.slice(0, sep) : entry;
    return { code, severity: 'unspecified', message: sep >= 0 ? entry.slice(sep + 2) : '' };
  }
  if (typeof entry === 'object' && entry !== null) {
    const record = entry as Record<string, unknown>;
    if (typeof record.code === 'string') {
      const severity =
        record.severity === 'warning' || record.severity === 'error'
          ? record.severity
          : 'unspecified';
      return {
        code: record.code,
        severity,
        message: typeof record.message === 'string' ? record.message : '',
      };
    }
  }
  return { code: String(entry), severity: 'unspecified', message: '' };
};

const readJsonSafe = (path: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const attemptNumber = (file: string): number | null => {
  const match = /attempt-(\d+)\.validation\.json$/.exec(file);
  return match ? Number(match[1]) : null;
};

/**
 * Collect one audit record per selected job. `resultsByJob` maps jobId to the
 * LAST accepted result line (duplicates are reported as integrity problems by
 * the caller). Returns the records plus raw material for metrics.
 */
export const collectJobAuditRecords = (args: {
  comparisonSet: ComparisonSet;
  baseJobs: Map<string, AiStudyMapJob>;
  resultsByJob: Map<string, AiStudyMapResult>;
  resultRunId: string;
  attemptsByJob: Map<string, AttemptRecord[]>;
}): { records: JobAuditRecord[]; problems: string[] } => {
  const problems: string[] = [];
  const seen = new Set<string>();
  const records: JobAuditRecord[] = [];
  for (const setJob of args.comparisonSet.jobs) {
    const jobId = setJob.v2JobId;
    if (seen.has(jobId)) {
      problems.push(`duplicate job in comparison set: ${jobId}`);
      continue;
    }
    seen.add(jobId);
    const job = args.baseJobs.get(jobId);
    const result = args.resultsByJob.get(jobId) ?? null;
    const expectedFingerprint = job?.authoringInputFingerprint;
    if (
      result !== null &&
      expectedFingerprint !== undefined &&
      typeof result.authoringInputFingerprint === 'string' &&
      result.authoringInputFingerprint !== expectedFingerprint
    ) {
      problems.push(`result authoringInputFingerprint mismatch for ${jobId}`);
    }
    const attempts = [...(args.attemptsByJob.get(jobId) ?? [])].sort((a, b) => a.attempt - b.attempt);
    const codeSignatures = attempts.map((attempt) => [...attempt.issueCodes].sort().join('|'));
    let retryIntroducedDifferentError = false;
    let repeatedIdenticalError = false;
    for (let i = 1; i < codeSignatures.length; i += 1) {
      if (codeSignatures[i] !== codeSignatures[i - 1]) retryIntroducedDifferentError = true;
      if (codeSignatures[i] === codeSignatures[i - 1] && codeSignatures[i] !== '') repeatedIdenticalError = true;
    }
    const totalAttempts = attempts.length + (result !== null ? 1 : 0);
    records.push({
      jobId,
      documentId: job?.document.documentId ?? setJob.document?.documentId ?? null,
      categories: job ? categoryForJob(job) : [...(setJob.complexityCategory ?? [])],
      structuralStrata: job ? structuralStrataForJob(job) : [...(setJob.structuralStrata ?? [])],
      result,
      attempts,
      totalAttempts,
      accepted: result !== null,
      firstTryAccepted: result !== null && attempts.length === 0,
      retryIntroducedDifferentError,
      repeatedIdenticalError,
      permanentFailureAttempt: result === null && attempts.length > 0 ? attempts[attempts.length - 1] : null,
      provenance: null,
    });
  }
  const selectedIds = new Set(args.comparisonSet.jobs.map((entry) => entry.v2JobId));
  for (const jobId of args.resultsByJob.keys()) {
    if (!selectedIds.has(jobId)) {
      problems.push(`run result for unexpected job (not in comparison set): ${jobId}`);
    }
  }
  for (const jobId of args.attemptsByJob.keys()) {
    if (!selectedIds.has(jobId)) {
      problems.push(`run failure record for unexpected job (not in comparison set): ${jobId}`);
    }
  }
  return { records, problems };
};

/** Load accepted results for a run directory: one jsonl file per batch. */
export const loadRunResults = (runDir: string): {
  resultsByJob: Map<string, AiStudyMapResult>;
  lines: number;
  malformed: string[];
  duplicates: string[];
} => {
  const resultsDir = join(runDir, 'results');
  const resultsByJob = new Map<string, AiStudyMapResult>();
  const malformed: string[] = [];
  const duplicates: string[] = [];
  let lines = 0;
  if (!existsSync(resultsDir)) return { resultsByJob, lines, malformed, duplicates };
  const files = readdirSync(resultsDir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort();
  for (const file of files) {
    const raw = readFileSync(join(resultsDir, file), 'utf8');
    raw.split(/\r?\n/).forEach((line, index) => {
      const stripped = index === 0 ? line.replace(/^\uFEFF/, '') : line;
      if (!stripped.trim()) return;
      line = stripped;
      lines += 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformed.push(`${basename(file)}:${index + 1}`);
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { jobId?: unknown }).jobId !== 'string') {
        malformed.push(`${basename(file)}:${index + 1}`);
        return;
      }
      const result = parsed as AiStudyMapResult;
      if (resultsByJob.has(result.jobId)) duplicates.push(result.jobId);
      resultsByJob.set(result.jobId, result);
    });
  }
  return { resultsByJob, lines, malformed, duplicates };
};

/** Load local-failures attempt records for a run directory. */
export const loadRunAttempts = (runDir: string): {
  attemptsByJob: Map<string, AttemptRecord[]>;
  malformed: string[];
} => {
  const failuresDir = join(runDir, 'local-failures');
  const attemptsByJob = new Map<string, AttemptRecord[]>();
  const malformed: string[] = [];
  if (!existsSync(failuresDir)) return { attemptsByJob, malformed };
  for (const jobId of readdirSync(failuresDir, { withFileTypes: true })) {
    if (!jobId.isDirectory()) continue;
    const jobDir = join(failuresDir, jobId.name);
    const files = readdirSync(jobDir).sort();
    const attempts: AttemptRecord[] = [];
    for (const file of files) {
      const attempt = attemptNumber(file);
      if (attempt === null) continue;
      const data = readJsonSafe(join(jobDir, file));
      if (data === null) {
        malformed.push(join(jobId.name, file));
        continue;
      }
      const issues = Array.isArray(data.issues) ? data.issues.map(normalizeIssue) : [];
      attempts.push({
        attempt,
        issueCodes: issues.map((issue) => issue.code),
        issues,
        timestamp: typeof data.timestamp === 'string' ? data.timestamp : undefined,
        rawHash: typeof data.rawHash === 'string' ? data.rawHash : undefined,
      });
    }
    if (attempts.length > 0) attemptsByJob.set(jobId.name, attempts.sort((a, b) => a.attempt - b.attempt));
  }
  return { attemptsByJob, malformed };
};

export const loadProvenanceSummary = (runDir: string, jobId: string): JobAuditRecord['provenance'] => {
  const path = join(runDir, 'results', `${jobId}.provenance.json`);
  if (!existsSync(path)) return null;
  const data = readJsonSafe(path);
  if (!data) return null;
  return {
    modelId: typeof data.modelId === 'string' ? data.modelId : undefined,
    attempt: typeof data.attempt === 'number' ? data.attempt : undefined,
    structuredOutputMode: typeof data.structuredOutputMode === 'string' ? data.structuredOutputMode : undefined,
  };
};

export const resolveRunDir = (runId: string, runsDir: string): string =>
  isAbsolute(runId) ? runId : join(runsDir, runId);
