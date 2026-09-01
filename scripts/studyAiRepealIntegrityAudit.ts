/**
 * Deterministic, model-free integrity audit and repair for whole-source
 * repeal metadata on prepared Study Map jobs.
 *
 * Every prepared target that currently carries `sourceStatus: 'repealed'` or
 * `contentFlags.repealOnly: true` is reclassified with the strict line-based
 * repeal-only classifier:
 *
 *   - confirmed-whole-repeal      no substantive live text remains
 *   - mixed-live-and-repealed     operative text coexists with repeal stubs
 *   - ambiguous-needs-review      unparseable trailing content (fail closed)
 *
 * `sourceStatus`/`contentFlags` are also recomputed for ALL jobs (the strict
 * detector can newly detect whole-repealed components that the legacy
 * detector missed), and every job whose stored metadata would change is
 * reported with before/after values and the recomputed `inputHash` /
 * `authoringInputFingerprint`.
 *
 * Invariant check (fail closed): every stored job's `inputHash` and
 * `authoringInputFingerprint` must be reproducible from its stored content;
 * any mismatch aborts the audit before any report-dependent repair.
 *
 * `--repair` atomically rewrites the jobs/*.jobs.jsonl files for changed
 * jobs only: `target.sourceStatus`/`target.contentFlags` are recomputed,
 * `inputHash`/`authoringInputFingerprint` are recomputed, and `jobId` plus
 * every other field — and every unchanged job line — are preserved
 * byte-for-byte. Repaired files are verified by re-reading and re-checking
 * the identity invariants.
 *
 * This tool never calls a model and does not touch result rows. Accepted
 * results whose job identity changed become stale (INPUT_HASH_MISMATCH) and
 * must be re-based through the deterministic adjudication workflow.
 *
 * Usage:
 *   npx tsx scripts/studyAiRepealIntegrityAudit.ts [--run <runId>]
 *     [--repair] [--report-dir <dir>] [--report-date <YYYYMMDD>]
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  __studyAiAuthoringTest,
  classifyRepealOnly,
} from './studyAiAuthoring';
import { authoringInputFingerprint } from './studyAiFingerprint';
import { canonicalJson } from '../src/study/ai/studyAiResultContract';

const RUNS_DIR = 'study-content/ai/runs';
const DEFAULT_RUN = 'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342';
const EXCERPT_LIMIT = 220;

type ContentFlags = Record<string, boolean>;

type StoredJob = {
  jobId: string;
  runId: string;
  inputHash: string;
  authoringInputFingerprint: string;
  document: Record<string, unknown>;
  target: {
    sectionLabels: string[];
    heading?: string;
    exactSourceText: string;
    sourceStatus: 'current' | 'repealed' | 'historical';
    contentFlags: ContentFlags;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type JobFileEntry = {
  file: string;
  originalLines: string[];
  jobs: StoredJob[];
};

type AuditClassification =
  | 'confirmed-whole-repeal'
  | 'mixed-live-and-repealed'
  | 'ambiguous-needs-review';

type ChangedJob = {
  jobId: string;
  documentTitle: string;
  sectionLabels: string;
  heading: string | null;
  oldFlagged: boolean;
  auditClassification: AuditClassification | null;
  excerpt: string | null;
  before: {
    sourceStatus: string;
    contentFlags: ContentFlags;
    inputHash: string;
    authoringInputFingerprint: string;
  };
  after: {
    sourceStatus: string;
    contentFlags: ContentFlags;
    inputHash: string;
    authoringInputFingerprint: string;
  };
  resultRow: 'accepted-row-present-needs-rebase' | 'no-result-row';
};

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const sourceStatusFromComponent = __studyAiAuthoringTest.sourceStatusFromComponent;
const contentFlagsFromComponent = __studyAiAuthoringTest.contentFlagsFromComponent;

/** Base object exactly as buildMapJob hashes it: inputHash blanked, fingerprint absent. */
const baseOf = (job: StoredJob): Record<string, unknown> => {
  const { authoringInputFingerprint: _omitted, ...rest } = job;
  return { ...rest, inputHash: '' };
};

const componentFor = (job: StoredJob) => ({
  text: job.target.exactSourceText,
  heading: job.target.heading,
});

/** Body text with a leading embedded heading stripped (mirrors componentBodyText). */
const bodyTextFor = (job: StoredJob): string => {
  const text = job.target.exactSourceText.trim();
  const heading = job.target.heading?.trim();
  if (heading && text.startsWith(heading)) return text.slice(heading.length).trim();
  return text;
};

const OUTCOME_TO_CLASSIFICATION: Record<string, AuditClassification> = {
  whole: 'confirmed-whole-repeal',
  mixed: 'mixed-live-and-repealed',
  ambiguous: 'ambiguous-needs-review',
};

const excerptOf = (text: string): string =>
  text.length <= EXCERPT_LIMIT ? text : `${text.slice(0, EXCERPT_LIMIT)}…`;

const batchFilesFor = (runDir: string): string[] => {
  const manifest = JSON.parse(
    readFileSync(join(runDir, 'reports', 'batch-manifest.json'), 'utf8'),
  ) as { batchCount: number };
  return Array.from({ length: manifest.batchCount }, (_, index) =>
    join(runDir, 'jobs', `batch-${String(index + 1).padStart(3, '0')}.jobs.jsonl`),
  );
};

const loadJobFiles = (runDir: string): JobFileEntry[] =>
  batchFilesFor(runDir).map((file) => {
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    // Trailing newline: drop the final empty element, remember file ended with newline.
    const hadTrailingNewline = lines[lines.length - 1] === '';
    if (hadTrailingNewline) lines.pop();
    const jobs = lines.map((line) => JSON.parse(line) as StoredJob);
    const lineByJob = new Map(jobs.map((job, index) => [job.jobId, index]));
    for (const job of jobs) {
      if (!lineByJob.has(job.jobId)) throw new Error(`duplicate jobId ${job.jobId} in ${file}`);
    }
    return { file, originalLines: lines, jobs };
  });

const verifyInvariants = (jobs: StoredJob[]): string[] => {
  const violations: string[] = [];
  for (const job of jobs) {
    const recomputedInputHash = sha256(canonicalJson(baseOf(job)));
    const recomputedFingerprint = authoringInputFingerprint(job);
    if (recomputedInputHash !== job.inputHash) {
      violations.push(`${job.jobId}: inputHash not reproducible from stored content`);
    }
    if (recomputedFingerprint !== job.authoringInputFingerprint) {
      violations.push(`${job.jobId}: authoringInputFingerprint not reproducible from stored content`);
    }
  }
  return violations;
};

type JobAudit = {
  job: StoredJob;
  oldFlagged: boolean;
  auditClassification: AuditClassification | null;
  newStatus: 'current' | 'repealed' | 'historical';
  newFlags: ContentFlags;
  changed: boolean;
  newInputHash: string;
  newFingerprint: string;
};

const auditJob = (job: StoredJob): JobAudit => {
  const component = componentFor(job);
  const oldFlagged =
    job.target.sourceStatus === 'repealed' || Boolean(job.target.contentFlags?.repealOnly);
  const body = bodyTextFor(job);
  const outcome = classifyRepealOnly(body).outcome;
  const newStatus = sourceStatusFromComponent(component);
  const newFlags = contentFlagsFromComponent(component);
  const changed =
    newStatus !== job.target.sourceStatus ||
    canonicalJson(newFlags) !== canonicalJson(job.target.contentFlags);
  const repaired: StoredJob = {
    ...job,
    target: { ...job.target, sourceStatus: newStatus, contentFlags: newFlags },
  };
  return {
    job,
    oldFlagged,
    auditClassification: oldFlagged ? OUTCOME_TO_CLASSIFICATION[outcome] : null,
    newStatus,
    newFlags,
    changed,
    newInputHash: sha256(canonicalJson(baseOf(repaired))),
    newFingerprint: authoringInputFingerprint(repaired),
  };
};

const resultRowJobIds = (runDir: string): Set<string> => {
  const path = join(runDir, 'results', 'local-map.results.jsonl');
  const ids = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    ids.add((JSON.parse(line) as { jobId: string }).jobId);
  }
  return ids;
};

const toChangedJob = (
  audit: JobAudit,
  resultIds: Set<string>,
  documentTitle: string,
): ChangedJob => {
  const body = bodyTextFor(audit.job);
  return {
    jobId: audit.job.jobId,
    documentTitle,
    sectionLabels: audit.job.target.sectionLabels.join('; '),
    heading: audit.job.target.heading ?? null,
    oldFlagged: audit.oldFlagged,
    auditClassification:
      audit.auditClassification ??
      (audit.newStatus === 'repealed' ? 'confirmed-whole-repeal' : null),
    excerpt: audit.oldFlagged || audit.changed ? excerptOf(body) : null,
    before: {
      sourceStatus: audit.job.target.sourceStatus,
      contentFlags: audit.job.target.contentFlags,
      inputHash: audit.job.inputHash,
      authoringInputFingerprint: audit.job.authoringInputFingerprint,
    },
    after: {
      sourceStatus: audit.newStatus,
      contentFlags: audit.newFlags,
      inputHash: audit.newInputHash,
      authoringInputFingerprint: audit.newFingerprint,
    },
    resultRow: resultIds.has(audit.job.jobId)
      ? 'accepted-row-present-needs-rebase'
      : 'no-result-row',
  };
};

/**
 * Rewrite the batch files for the changed jobs only. Returns the list of
 * rewritten file paths; unchanged lines are preserved byte-for-byte.
 */
const repairJobFiles = (
  entries: JobFileEntry[],
  changed: Map<string, JobAudit>,
): string[] => {
  const rewritten: string[] = [];
  for (const entry of entries) {
    let changedInFile = false;
    const newLines = entry.originalLines.map((line, index) => {
      const job = entry.jobs[index];
      const audit = changed.get(job.jobId);
      if (!audit) return line;
      changedInFile = true;
      const repaired: StoredJob = {
        ...job,
        target: { ...job.target, sourceStatus: audit.newStatus, contentFlags: audit.newFlags },
        inputHash: audit.newInputHash,
        authoringInputFingerprint: audit.newFingerprint,
      };
      return JSON.stringify(repaired);
    });
    if (!changedInFile) continue;
    const tmp = `${entry.file}.tmp-${process.pid}`;
    writeFileSync(tmp, newLines.join('\n') + '\n');
    renameSync(tmp, entry.file);
    rewritten.push(entry.file);
  }
  return rewritten;
};

/** Re-read repaired files and re-verify every invariant before the report is finalized. */
const verifyRepair = (entries: JobFileEntry[], expectedTotal: number): string[] => {
  const errors: string[] = [];
  let total = 0;
  for (const entry of entries) {
    const raw = readFileSync(entry.file, 'utf8');
    const lines = raw.split('\n');
    if (lines[lines.length - 1] !== '') {
      errors.push(`${entry.file}: missing trailing newline after repair`);
      continue;
    }
    lines.pop();
    if (lines.length !== entry.originalLines.length) {
      errors.push(
        `${entry.file}: line count changed (${entry.originalLines.length} -> ${lines.length})`,
      );
      continue;
    }
    total += lines.length;
    lines.forEach((line, index) => {
      const original = entry.originalLines[index];
      if (line === original) return;
      const job = JSON.parse(line) as StoredJob;
      const recomputedInputHash = sha256(canonicalJson(baseOf(job)));
      const recomputedFingerprint = authoringInputFingerprint(job);
      if (recomputedInputHash !== job.inputHash) {
        errors.push(`${job.jobId} (repaired): inputHash mismatch after repair`);
      }
      if (recomputedFingerprint !== job.authoringInputFingerprint) {
        errors.push(`${job.jobId} (repaired): fingerprint mismatch after repair`);
      }
    });
  }
  if (total !== expectedTotal) errors.push(`total job count changed: ${expectedTotal} -> ${total}`);
  return errors;
};

const writeReport = (
  reportDir: string,
  date: string,
  report: Record<string, unknown>,
): { jsonPath: string; mdPath: string } => {
  const jsonPath = join(reportDir, `repeal-metadata-integrity-${date}.json`);
  const mdPath = join(reportDir, `repeal-metadata-integrity-${date}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(mdPath, renderMarkdown(report));
  return { jsonPath, mdPath };
};

const renderMarkdown = (report: Record<string, unknown>): string => {
  const r = report as {
    runId: string;
    generatedAt: string;
    totals: {
      jobsTotal: number;
      oldFlagged: number;
      'confirmed-whole-repeal': number;
      'mixed-live-and-repealed': number;
      'ambiguous-needs-review': number;
      changedJobs: number;
    };
    invariants: { checkedJobs: number; violations: string[] };
    changedJobs: ChangedJob[];
    repair: null | { filesRewritten: string[]; verificationErrors: string[] };
  };
  const lines: string[] = [
    `# Repeal Metadata Integrity Audit — ${r.runId}`,
    '',
    `Generated: ${r.generatedAt}`,
    '',
    '## Totals',
    '',
    `- Jobs checked: ${r.totals.jobsTotal}`,
    `- Previously flagged (sourceStatus=repealed or repealOnly): ${r.totals.oldFlagged}`,
    `- confirmed-whole-repeal: ${r.totals['confirmed-whole-repeal']}`,
    `- mixed-live-and-repealed: ${r.totals['mixed-live-and-repealed']}`,
    `- ambiguous-needs-review: ${r.totals['ambiguous-needs-review']}`, 
    `- Jobs with changed metadata: ${r.totals.changedJobs}`,
    `- Invariant check (inputHash + fingerprint reproducible): ${
      r.invariants.violations.length === 0 ? `PASS (${r.invariants.checkedJobs} jobs)` : 'FAIL'
    }`,
    '',
  ];
  if (r.invariants.violations.length > 0) {
    lines.push('Invariant violations:');
    for (const violation of r.invariants.violations) lines.push(`- ${violation}`);
    lines.push('');
  }
  lines.push('## Changed jobs', '');
  for (const job of r.changedJobs) {
    lines.push(
      `### ${job.jobId} — ${job.documentTitle} · ${job.sectionLabels}`,
      '',
      `- Classification: ${job.auditClassification ?? 'newly-detected-whole-repeal'}`,
      `- sourceStatus: ${job.before.sourceStatus} → ${job.after.sourceStatus}`,
      `- repealOnly: ${job.before.contentFlags.repealOnly} → ${job.after.contentFlags.repealOnly}`,
      `- containsRepealedSubprovision: ${job.before.contentFlags.containsRepealedSubprovision} → ${job.after.contentFlags.containsRepealedSubprovision}`,
      `- inputHash: \`${job.before.inputHash}\` → \`${job.after.inputHash}\``,
      `- authoringInputFingerprint: \`${job.before.authoringInputFingerprint}\` → \`${job.after.authoringInputFingerprint}\``,
      `- Result impact: ${job.resultRow}`,
      '',
    );
  }
  if (r.repair) {
    lines.push('## Repair', '', `Files rewritten: ${r.repair.filesRewritten.length}`, '');
    if (r.repair.verificationErrors.length > 0) {
      lines.push('Verification errors:');
      for (const error of r.repair.verificationErrors) lines.push(`- ${error}`);
    } else {
      lines.push('Post-repair verification: PASS');
    }
    lines.push('');
  }
  return lines.join('\n');
};

type Options = { run: string; repair: boolean; reportDir: string; reportDate: string };

const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    run: DEFAULT_RUN,
    repair: false,
    reportDir: 'reports',
    reportDate: '20260901',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run') options.run = argv[++i];
    else if (arg === '--repair') options.repair = true;
    else if (arg === '--report-dir') options.reportDir = argv[++i];
    else if (arg === '--report-date') options.reportDate = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const runDir = resolve(RUNS_DIR, options.run);

  const entries = loadJobFiles(runDir);
  const allJobs = entries.flatMap((entry) => entry.jobs);
  const violations = verifyInvariants(allJobs);
  if (violations.length > 0) {
    console.error('Invariant check failed — aborting (no files modified):');
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
  }

  const audited = allJobs.map(auditJob);
  const flagged = audited.filter((audit) => audit.oldFlagged);
  const counts: Record<AuditClassification, number> = {
    'confirmed-whole-repeal': 0,
    'mixed-live-and-repealed': 0,
    'ambiguous-needs-review': 0,
  };
  for (const audit of flagged) {
    if (audit.auditClassification) counts[audit.auditClassification] += 1;
  }

  if (counts['ambiguous-needs-review'] > 0) {
    console.error('Ambiguous repeal texts detected — refusing to continue:');
    for (const audit of flagged) {
      if (audit.auditClassification === 'ambiguous-needs-review') {
        console.error(`  ${audit.job.jobId}: ${excerptOf(bodyTextFor(audit.job))}`);
      }
    }
    process.exit(1);
  }

  const resultIds = resultRowJobIds(runDir);
  const changedAudits = audited.filter((audit) => audit.changed);
  const changed = new Map(changedAudits.map((audit) => [audit.job.jobId, audit]));
  const changedJobs: ChangedJob[] = changedAudits.map((audit) =>
    toChangedJob(
      audit,
      resultIds,
      String(audit.job.document?.title ?? audit.job.document?.sourceKey ?? 'unknown'),
    ),
  );

  let repairResult: Record<string, unknown> | null = null;
  if (options.repair) {
    const filesRewritten = repairJobFiles(entries, changed);
    const verificationErrors = verifyRepair(entries, allJobs.length);
    repairResult = { applied: true, filesRewritten, verificationErrors };
    if (verificationErrors.length > 0) {
      console.error('Post-repair verification failed:');
      for (const error of verificationErrors) console.error(`  ${error}`);
      process.exit(1);
    }
  }

  const report = {
    schemaVersion: 1,
    kind: 'repeal-metadata-integrity-audit',
    runId: options.run,
    generatedAt: new Date().toISOString(),
    classifier: 'strict-line-based classifyRepealOnly (whole/mixed/ambiguous)',
    totals: {
      jobsTotal: allJobs.length,
      oldFlagged: flagged.length,
      'confirmed-whole-repeal': counts['confirmed-whole-repeal'],
      'mixed-live-and-repealed': counts['mixed-live-and-repealed'],
      'ambiguous-needs-review': counts['ambiguous-needs-review'],
      changedJobs: changedJobs.length,
    },
    invariants: { checkedJobs: allJobs.length, violations },
    changedJobs,
    repair: repairResult,
  };

  const { jsonPath, mdPath } = writeReport(
    resolve(options.reportDir),
    options.reportDate,
    report,
  );

  console.log(
    JSON.stringify(
      {
        run: options.run,
        totals: report.totals,
        changedJobs: changedJobs.map((job) => job.jobId),
        repair: repairResult,
        report: { jsonPath, mdPath },
      },
      null,
      2,
    ),
  );
};

if (process.argv[1]?.endsWith('studyAiRepealIntegrityAudit.ts')) {
  main();
}
