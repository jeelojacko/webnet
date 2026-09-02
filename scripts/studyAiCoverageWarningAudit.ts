/**
 * V4 coverage-warning audit CLI (deterministic, no AI, no provider calls).
 *
 * Audits every accepted proposal of the frozen calibration-80 Unit run for
 * the two canonical-revalidation coverage warnings:
 *
 *   APPROVED_FOCUS_NOT_COVERED    (49 instances)
 *   UNCOVERED_SUBSTANTIVE_SOURCE  (37 instances)
 *   total                         86
 *
 * The checkers' predicates are mirrored (not imported) by
 * src/study/ai/studyAiUnitCoverageAudit.ts; each instance is classified
 * A / B / C (A = real defect worth diagnosing, B = false positive under a
 * raw predicate recompute — expected 0, C = duplicate presentation of an
 * omission that UNCOVERED_SUBSTANTIVE_SOURCE already presents) and given a
 * deterministic substantive-coverage assessment. FAILS CLOSED (nonzero
 * exit) when the recomputed totals diverge from the known-correct universe.
 *
 * All outputs are byte-deterministic: fixed dateTag/generatedAt, stable
 * (jobId, code, sourceKey, label) instance ordering, LF line endings, one
 * trailing newline — a second identical run is byte-identical.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAuditInputs } from '../src/study/ai/studyAiUnitCalibrationAudit.load';
import { sourceComponentsForProposal } from '../src/study/ai/studyAiUnitSourceComponents';
import {
  APPROVED_FOCUS_NOT_COVERED,
  UNCOVERED_SUBSTANTIVE_SOURCE,
  buildCoverageInstanceRows,
} from '../src/study/ai/studyAiUnitCoverageAudit';
import type {
  CoverageAuditInstanceRow,
  CoverageWarningCode,
} from '../src/study/ai/studyAiUnitCoverageAudit';

const DATE_TAG = '20260902';
const GENERATED_AT = '2026-09-02T00:00:00.000Z';
const AUDIT_KIND = 'unit-v4-coverage-warning-audit';
const EXPECTED_APPROVED_FOCUS_NOT_COVERED = 49;
const EXPECTED_UNCOVERED_SUBSTANTIVE_SOURCE = 37;
const EXPECTED_PROPOSALS = 80;

const DEFAULT_RUN_DIR = 'study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4';
const DEFAULT_PACKAGE_PATH = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const DEFAULT_REPORTS_DIR = 'reports';
const DEFAULT_SELECTION_REPORT = 'unit-calibration-80-20260902.json';

const AUDIT_JSON_NAME = `unit-v4-coverage-warning-audit-${DATE_TAG}.json`;
const AUDIT_MD_NAME = `unit-v4-coverage-warning-audit-${DATE_TAG}.md`;

/** Audit row with the run jobId attached (results are keyed by proposalId == jobId). */
type AuditRow = CoverageAuditInstanceRow & { jobId: string };

type CliOptions = {
  runDir: string;
  reportsDir: string;
  selectionReport: string;
  packagePath: string;
};

const CLI_HELP = `studyAiCoverageWarningAudit.ts — deterministic V4 coverage-warning audit

Usage:
  npx tsx scripts/studyAiCoverageWarningAudit.ts [options]

Options:
  --run-dir <dir>          Run dir to audit (default study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4)
  --reports-dir <dir>      Where the selection report lives and artifacts are written (default reports)
  --selection-report <path>  Selection report path (default <reports-dir>/unit-calibration-80-20260902.json)
  --package-path <path>    Corpus content package (default study-content/packages/nb-sit-statute-corpus.content-package.json)
  --help                   Show this help

Read-only against the run dir; writes unit-v4-coverage-warning-audit-20260902.json and .md
into the reports dir. No provider calls; fails closed (nonzero exit) if the recomputed
warning totals diverge from the known-correct universe (49 APPROVED_FOCUS_NOT_COVERED,
37 UNCOVERED_SUBSTANTIVE_SOURCE). Deterministic: a second identical run is byte-identical.`;

const parseOptions = (rawArgs: string[]): CliOptions => {
  const valueOf = (name: string): string | undefined => {
    const at = rawArgs.indexOf(`--${name}`);
    return at >= 0 ? rawArgs[at + 1] : undefined;
  };
  const reportsDir = valueOf('reports-dir') ?? DEFAULT_REPORTS_DIR;
  return {
    runDir: valueOf('run-dir') ?? DEFAULT_RUN_DIR,
    reportsDir,
    selectionReport: valueOf('selection-report') ?? join(reportsDir, DEFAULT_SELECTION_REPORT),
    packagePath: valueOf('package-path') ?? DEFAULT_PACKAGE_PATH,
  };
};

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedInstances = (rows: AuditRow[]): AuditRow[] =>
  [...rows].sort((a, b) => {
    let order = compareStrings(a.jobId, b.jobId);
    if (order !== 0) return order;
    order = compareStrings(a.code, b.code);
    if (order !== 0) return order;
    order = compareStrings(a.sourceKey, b.sourceKey);
    if (order !== 0) return order;
    return compareStrings(a.label, b.label);
  });

type CodeTotals = { APPROVED_FOCUS_NOT_COVERED: number; UNCOVERED_SUBSTANTIVE_SOURCE: number; total: number };
type ClassTotals = { A: number; B: number; C: number };
type PerJobCount = { total: number; APPROVED_FOCUS_NOT_COVERED: number; UNCOVERED_SUBSTANTIVE_SOURCE: number };

const emptyCodeTotals = (): CodeTotals => ({
  APPROVED_FOCUS_NOT_COVERED: 0,
  UNCOVERED_SUBSTANTIVE_SOURCE: 0,
  total: 0,
});

const tallyRows = (rows: AuditRow[]): {
  actualTotals: CodeTotals;
  classificationTotals: ClassTotals;
  perCodeClassification: Record<CoverageWarningCode, ClassTotals>;
  perJob: Map<string, PerJobCount>;
} => {
  const actualTotals = emptyCodeTotals();
  const classificationTotals: ClassTotals = { A: 0, B: 0, C: 0 };
  const perCodeClassification: Record<CoverageWarningCode, ClassTotals> = {
    APPROVED_FOCUS_NOT_COVERED: { A: 0, B: 0, C: 0 },
    UNCOVERED_SUBSTANTIVE_SOURCE: { A: 0, B: 0, C: 0 },
  };
  const perJob = new Map<string, PerJobCount>();
  for (const row of rows) {
    actualTotals[row.code] += 1;
    actualTotals.total += 1;
    classificationTotals[row.classification] += 1;
    perCodeClassification[row.code][row.classification] += 1;
    const job = perJob.get(row.jobId) ?? { total: 0, APPROVED_FOCUS_NOT_COVERED: 0, UNCOVERED_SUBSTANTIVE_SOURCE: 0 };
    job.total += 1;
    job[row.code] += 1;
    perJob.set(row.jobId, job);
  }
  return { actualTotals, classificationTotals, perCodeClassification, perJob };
};

/* ------------------------------------------------------------------ *
 * Audit document assembly                                           *
 * ------------------------------------------------------------------ */

type AuditDoc = {
  audit: string;
  dateTag: string;
  generatedAt: string;
  runId: string;
  runSha256: string;
  proposalsAudited: number;
  expectedTotals: CodeTotals;
  actualTotals: CodeTotals;
  classificationTotals: ClassTotals;
  perCodeClassification: Record<CoverageWarningCode, ClassTotals>;
  instances: AuditRow[];
};

const buildAuditDoc = (
  runId: string,
  runSha256: string,
  proposalsAudited: number,
  rows: AuditRow[],
): AuditDoc => {
  const { actualTotals, classificationTotals, perCodeClassification } = tallyRows(rows);
  return {
    audit: AUDIT_KIND,
    dateTag: DATE_TAG,
    generatedAt: GENERATED_AT,
    runId,
    runSha256,
    proposalsAudited,
    expectedTotals: {
      APPROVED_FOCUS_NOT_COVERED: EXPECTED_APPROVED_FOCUS_NOT_COVERED,
      UNCOVERED_SUBSTANTIVE_SOURCE: EXPECTED_UNCOVERED_SUBSTANTIVE_SOURCE,
      total: EXPECTED_APPROVED_FOCUS_NOT_COVERED + EXPECTED_UNCOVERED_SUBSTANTIVE_SOURCE,
    },
    actualTotals,
    classificationTotals,
    perCodeClassification,
    instances: sortedInstances(rows),
  };
};

/* ------------------------------------------------------------------ *
 * Markdown rendering                                                *
 * ------------------------------------------------------------------ */

const md = (lines: string[]): string => `${lines.join('\n')}\n`;

const sanitizeCell = (value: string): string => value.replace(/[|\r\n]/g, ' ').trim();

const renderTable = (header: string[], rows: string[][]): string[] => {
  const body: string[] = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  rows.forEach((row) => body.push(`| ${row.join(' | ')} |`));
  return body;
};

const classificationRow = (
  row: AuditRow,
): string[] => [
  row.jobId,
  row.code,
  sanitizeCell(row.sourceKey),
  sanitizeCell(row.label),
  row.twin.present ? row.twin.code : '—',
  row.objectiveIds.length > 0 ? row.objectiveIds.join(', ') : '',
  sanitizeCell(row.classificationBasis),
];

const renderClassificationSection = (
  title: string,
  rows: AuditRow[],
): string[] => {
  const lines = [`## ${title}`, ''];
  if (rows.length === 0) {
    lines.push('_No instances in this classification._', '');
    return lines;
  }
  lines.push(
    ...renderTable(
      ['jobId', 'code', 'sourceKey', 'label', 'twin', 'objectiveIds', 'basis'],
      rows.map((row) => classificationRow(row)),
    ),
    '',
  );
  return lines;
};

const renderMarkdown = (doc: AuditDoc, perJob: Map<string, PerJobCount>): string => {
  const lines: string[] = [];
  lines.push(
    `# ${AUDIT_KIND} (${doc.dateTag})`,
    '',
    `run: ${doc.runId}`,
    `run.json sha256: ${doc.runSha256}`,
    `proposals audited: ${doc.proposalsAudited}`,
    `generatedAt: ${doc.generatedAt}`,
    '',
    `Expected totals: APPROVED_FOCUS_NOT_COVERED ${doc.expectedTotals.APPROVED_FOCUS_NOT_COVERED}, ` +
      `UNCOVERED_SUBSTANTIVE_SOURCE ${doc.expectedTotals.UNCOVERED_SUBSTANTIVE_SOURCE}, ` +
      `total ${doc.expectedTotals.total}.`,
    `Actual totals: APPROVED_FOCUS_NOT_COVERED ${doc.actualTotals.APPROVED_FOCUS_NOT_COVERED}, ` +
      `UNCOVERED_SUBSTANTIVE_SOURCE ${doc.actualTotals.UNCOVERED_SUBSTANTIVE_SOURCE}, ` +
      `total ${doc.actualTotals.total}.`,
    `Classification totals: A ${doc.classificationTotals.A}, B ${doc.classificationTotals.B}, ` +
      `C ${doc.classificationTotals.C} (A + B + C = ${doc.classificationTotals.A + doc.classificationTotals.B + doc.classificationTotals.C}).`,
    '',
    '## Per-code classification',
    '',
  );
  lines.push(
    ...renderTable(
      ['code', 'A', 'B', 'C', 'total'],
      (Object.keys(doc.perCodeClassification) as CoverageWarningCode[]).map((code) => [
        code,
        String(doc.perCodeClassification[code].A),
        String(doc.perCodeClassification[code].B),
        String(doc.perCodeClassification[code].C),
        String(doc.perCodeClassification[code].A + doc.perCodeClassification[code].B + doc.perCodeClassification[code].C),
      ]),
    ),
    '',
    '## Per-job warning counts',
    '',
  );
  const jobRows = Array.from(perJob.entries())
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([jobId, counts]) => [
      jobId,
      String(counts.total),
      String(counts.APPROVED_FOCUS_NOT_COVERED),
      String(counts.UNCOVERED_SUBSTANTIVE_SOURCE),
    ]);
  lines.push(...renderTable(['jobId', 'total', 'APPROVED_FOCUS_NOT_COVERED', 'UNCOVERED_SUBSTANTIVE_SOURCE'], jobRows), '');
  lines.push(...renderClassificationSection('A — real coverage defect worth diagnosing', doc.instances.filter((row) => row.classification === 'A')));
  lines.push(...renderClassificationSection('B — false positive (raw predicate recompute says no warning)', doc.instances.filter((row) => row.classification === 'B')));
  lines.push(...renderClassificationSection('C — duplicate presentation (same omission also flagged as UNCOVERED_SUBSTANTIVE_SOURCE)', doc.instances.filter((row) => row.classification === 'C')));
  return md(lines);
};

/* ------------------------------------------------------------------ *
 * Entry point                                                       *
 * ------------------------------------------------------------------ */

export const runCoverageWarningAudit = (options: CliOptions): string[] => {
  const reportsDir = resolve(options.reportsDir);
  const runDir = resolve(options.runDir);
  const packagePath = resolve(options.packagePath);
  const selectionReportPath = resolve(options.selectionReport);
  const inputs = loadAuditInputs({
    runDir,
    selectionReportPath,
    packagePath,
    specPath: null,
  });
  const proposals = Array.from(inputs.resultsByProposalId.values());
  if (proposals.length !== EXPECTED_PROPOSALS) {
    throw new Error(
      `Coverage-warning audit FAILED: expected ${EXPECTED_PROPOSALS} accepted proposals in ` +
        `local-unit.results.jsonl but loaded ${proposals.length}.`,
    );
  }
  const rows: AuditRow[] = [];
  for (const proposal of proposals) {
    const components = sourceComponentsForProposal(inputs.package, proposal.sourceDocumentId, proposal.sourceKeys);
    buildCoverageInstanceRows(proposal, components).forEach((row) => {
      rows.push({ jobId: proposal.proposalId, ...row });
    });
  }
  const { actualTotals, perJob } = tallyRows(rows);
  const actualApproved = actualTotals.APPROVED_FOCUS_NOT_COVERED;
  const actualUncovered = actualTotals.UNCOVERED_SUBSTANTIVE_SOURCE;
  if (
    actualApproved !== EXPECTED_APPROVED_FOCUS_NOT_COVERED ||
    actualUncovered !== EXPECTED_UNCOVERED_SUBSTANTIVE_SOURCE
  ) {
    throw new Error(
      `Coverage-warning audit FAILED: recomputed totals diverge from the known-correct universe ` +
        `(expected APPROVED_FOCUS_NOT_COVERED ${EXPECTED_APPROVED_FOCUS_NOT_COVERED}, ` +
        `UNCOVERED_SUBSTANTIVE_SOURCE ${EXPECTED_UNCOVERED_SUBSTANTIVE_SOURCE}; got ` +
        `${actualApproved} / ${actualUncovered}). The predicate mirror or the inputs are wrong.`,
    );
  }
  const doc = buildAuditDoc(inputs.metadata.runId, inputs.runJsonSha256, proposals.length, rows);
  const jsonPath = join(reportsDir, AUDIT_JSON_NAME);
  const mdPath = join(reportsDir, AUDIT_MD_NAME);
  writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderMarkdown(doc, perJob), 'utf8');
  return [jsonPath, mdPath];
};

const main = (): void => {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    process.stdout.write(`${CLI_HELP.trimEnd()}\n`);
    return;
  }
  try {
    const options = parseOptions(rawArgs);
    const artifactPaths = runCoverageWarningAudit(options);
    process.stdout.write('Wrote coverage-warning audit artifacts:\n');
    artifactPaths.forEach((path) => process.stdout.write(`  ${path}\n`));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
};

if (process.argv[1]?.endsWith('.ts')) {
  main();
}

export const __studyAiCoverageWarningAuditTest = {
  parseOptions,
  buildAuditDoc,
  renderMarkdown,
  tallyRows,
  AUDIT_JSON_NAME,
  AUDIT_MD_NAME,
  CLI_HELP,
};
