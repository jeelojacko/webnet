/**
 * Deterministic file IO + SHA-256 capture for the calibration-80 audit.
 *
 * Loads a frozen local-unit run dir (jobs, accepted results, per-job
 * provenance, local-failures attempt artifacts, provider events, run.json),
 * the calibration selection report, the corpus content package and the
 * authoring spec. Every loader sorts file iteration and preserves the
 * canonical row order (local-unit.results.jsonl is append-only in run
 * order). All digests are sha256 over file bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { NbLawContentPackage } from '../content/nbLawTypes';
import type {
  AiStudyUnitProposal,
  AiUnitAuthoringJob,
} from './studyAiTypes';
import type {
  AuditLoadedInputs,
  CalibrationSelectionDoc,
  LocalUnitRunMetadata,
  UnitAttemptKind,
  UnitAttemptRecord,
  UnitProvenance,
  UnitProviderEvent,
} from './studyAiUnitCalibrationAudit.types';

export const sha256Text = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const sha256File = (filePath: string): string | null => {
  try {
    return sha256Text(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const readJsonFile = <T>(filePath: string): T => JSON.parse(readFileSync(filePath, 'utf8')) as T;

const readJsonLines = <T>(filePath: string): T[] =>
  existsSync(filePath)
    ? readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as T)
    : [];

const stripBom = (value: string): string => (value.charCodeAt(0) === 0xfeff ? value.slice(1) : value);

const numericAttempt = (fileName: string): number | null => {
  const match = /^attempt-(\d+)\.validation\.json$/.exec(fileName);
  return match ? Number(match[1]) : null;
};

const attemptKindOf = (record: Record<string, unknown>): UnitAttemptKind =>
  record.failureKind === 'transport/provider' || record.failureCode !== undefined
    ? 'provider'
    : 'semantic';

const issuesFrom = (record: Record<string, unknown>): Array<{ code: string; message: string }> => {
  const issues = record.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const sep = entry.indexOf(': ');
    if (sep < 0) return [{ code: entry, message: '' }];
    return [{ code: entry.slice(0, sep), message: entry.slice(sep + 2) }];
  });
};

const loadBatchJobs = (
  jobsDir: string,
): { jobs: AiUnitAuthoringJob[]; batchByJobId: Map<string, number>; jobOrder: string[] } => {
  const jobs: AiUnitAuthoringJob[] = [];
  const batchByJobId = new Map<string, number>();
  const jobOrder: string[] = [];
  const files = readdirSync(jobsDir)
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort();
  files.forEach((file, batchIndex) => {
    const batchNumber = batchIndex + 1;
    for (const job of readJsonLines<AiUnitAuthoringJob>(join(jobsDir, file))) {
      jobs.push(job);
      batchByJobId.set(job.jobId, batchNumber);
      jobOrder.push(job.jobId);
    }
  });
  return { jobs, batchByJobId, jobOrder };
};

/** Read local-failures/<jobId>/attempt-*.validation.json artifacts, sorted by attempt number. */
const loadAttemptsFor = (failureJobDir: string): UnitAttemptRecord[] => {
  if (!existsSync(failureJobDir)) return [];
  const records: UnitAttemptRecord[] = [];
  for (const file of readdirSync(failureJobDir).sort()) {
    const attempt = numericAttempt(file);
    if (attempt === null) continue;
    const parsed: unknown = readJsonFile<unknown>(join(failureJobDir, file));
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    const issues = issuesFrom(record);
    const kind = attemptKindOf(record);
    records.push({
      attempt,
      kind,
      issueCodes: issues.map((issue) => issue.code),
      issues,
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
      rawHash: typeof record.rawHash === 'string' ? record.rawHash : undefined,
    });
  }
  return records.sort((a, b) => a.attempt - b.attempt);
};

const loadProviderEvents = (reportsDir: string): { events: UnitProviderEvent[]; present: boolean } => {
  const path = join(reportsDir, 'provider-events.jsonl');
  if (!existsSync(path)) return { events: [], present: false };
  const events: UnitProviderEvent[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const clean = stripBom(line);
    if (!clean.trim()) continue;
    const parsed: unknown = JSON.parse(clean);
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    if (typeof record.runId !== 'string' || typeof record.jobId !== 'string') continue;
    events.push({
      runId: record.runId,
      jobId: record.jobId,
      semanticAttempt: Number(record.semanticAttempt ?? 0),
      providerAttempt: Number(record.providerAttempt ?? 0),
      timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
      code: typeof record.code === 'string' ? record.code : String(record.code ?? ''),
      message: typeof record.message === 'string' ? record.message : '',
      httpStatus: typeof record.httpStatus === 'number' ? record.httpStatus : undefined,
      recovered: record.recovered === true,
      waitedMs: typeof record.waitedMs === 'number' ? record.waitedMs : undefined,
      runAborted: record.runAborted === true,
    });
  }
  return { events, present: true };
};

export type UnitCalibrationAuditPaths = {
  /** Run dir containing jobs/, results/, local-failures/, reports/, run.json. */
  runDir: string;
  /** reports/unit-calibration-80-20260902.json */
  selectionReportPath: string;
  /** Corpus content package. */
  packagePath: string;
  /** unit-authoring-v4 spec (sha only). */
  specPath: string | null;
};

/**
 * Load every input the audit needs. Deterministic given the on-disk state:
 * sorted reads, file-byte digests, no wall clock. Throws on hard structural
 * problems (missing run.json, no selection report, malformed JSON lines).
 */
export const loadAuditInputs = (paths: UnitCalibrationAuditPaths): AuditLoadedInputs => {
  const runDir = paths.runDir;
  const jobsDir = join(runDir, 'jobs');
  const resultsDir = join(runDir, 'results');
  const failuresDir = join(runDir, 'local-failures');
  const reportsDir = join(runDir, 'reports');
  const resultsPath = join(resultsDir, 'local-unit.results.jsonl');

  const runJsonSha256 = sha256File(join(runDir, 'run.json')) ?? '';
  const metadata = readJsonFile<LocalUnitRunMetadata>(join(reportsDir, 'local-run-metadata.json'));
  const metadataSha256 = sha256File(join(reportsDir, 'local-run-metadata.json')) ?? '';
  const resultsJsonlSha256 = sha256File(resultsPath) ?? '';
  const selection = readJsonFile<CalibrationSelectionDoc>(paths.selectionReportPath);
  const selectionSha256 = sha256File(paths.selectionReportPath) ?? '';
  const contentPackage = readJsonFile<NbLawContentPackage>(paths.packagePath);
  const packageSha256 = sha256File(paths.packagePath) ?? '';
  const specSha256 = paths.specPath ? sha256File(paths.specPath) : null;

  const jobsByJobId = new Map<string, AiUnitAuthoringJob>();
  const batchJobs = loadBatchJobs(jobsDir);
  for (const job of batchJobs.jobs) jobsByJobId.set(job.jobId, job);
  const batchByJobId = batchJobs.batchByJobId;
  const jobOrder = batchJobs.jobOrder;

  const batchSha256 = readdirSync(jobsDir)
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .map((file) => ({ file: basename(file), sha256: sha256File(join(jobsDir, file)) ?? '' }));

  const resultsByProposalId = new Map<string, AiStudyUnitProposal>();
  if (existsSync(resultsPath)) {
    const results = readJsonLines<AiStudyUnitProposal>(resultsPath);
    for (const result of results) resultsByProposalId.set(result.proposalId, result);
  }

  const provenanceByJobId = new Map<string, UnitProvenance>();
  if (existsSync(resultsDir)) {
    for (const file of readdirSync(resultsDir).sort()) {
      const match = /^(.+)\.provenance\.json$/.exec(file);
      if (!match) continue;
      const provenance = readJsonFile<UnitProvenance>(join(resultsDir, file));
      provenanceByJobId.set(match[1], provenance);
    }
  }

  const attemptsByJobId = new Map<string, UnitAttemptRecord[]>();
  if (existsSync(failuresDir)) {
    for (const entry of readdirSync(failuresDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const attempts = loadAttemptsFor(join(failuresDir, entry.name));
      if (attempts.length > 0) attemptsByJobId.set(entry.name, attempts);
    }
  }

  const provider = loadProviderEvents(reportsDir);

  return {
    runDirPath: runDir,
    selectionReportPath: paths.selectionReportPath,
    packagePath: paths.packagePath,
    specPath: paths.specPath,
    metadata,
    metadataSha256,
    runJsonSha256,
    resultsJsonlSha256,
    selection,
    selectionSha256,
    package: contentPackage,
    packageSha256,
    specSha256,
    batchSha256,
    jobOrder,
    batchByJobId,
    jobsByJobId,
    resultsByProposalId,
    provenanceByJobId,
    attemptsByJobId,
    providerEvents: provider.events,
    providerEventsPresent: provider.present,
  };
};
