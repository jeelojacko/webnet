/**
 * Calibration-80 Unit Authoring result audit CLI.
 *
 * Deterministic post-inference audit of the frozen local-Qwen
 * calibration-80 run (no provider calls). Reads the run dir (jobs, accepted
 * results, per-job provenance, local-failures attempt artifacts, provider
 * events, run metadata), the calibration selection report, the corpus package
 * and the unit-authoring-v4 spec; revalidates every accepted proposal with
 * the canonical validator; then writes six artifacts under the reports dir:
 *
 *   unit-calibration-80-result-audit-20260902.json       machine-readable audit
 *   unit-calibration-80-result-audit-20260902.md         concise companion
 *   unit-calibration-80-human-review-20260902.json       full 80-unit review data
 *   unit-calibration-80-human-review-20260902.md         risk-ordered sections
 *   unit-calibration-80-regression-anchors-20260902.md   the 7 anchors
 *   unit-calibration-80-final-qc-20260902.md             the 20 corrections / 8 parents
 *
 * Every artifact uses the fixed generatedAt 2026-09-02T00:00:00.000Z, stable
 * jobId ordering and SHA-256 input digests, so a second run is byte-identical.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAuditInputs } from '../src/study/ai/studyAiUnitCalibrationAudit.load';
import { buildAuditDocs } from '../src/study/ai/studyAiUnitCalibrationAudit';
import {
  renderAllMarkdown,
} from '../src/study/ai/studyAiUnitCalibrationAudit.markdown';

const DEFAULT_RUN_DIR =
  'study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4';
const DEFAULT_PACKAGE =
  'study-content/packages/nb-sit-statute-corpus.content-package.json';
const DEFAULT_REPORTS_DIR = 'reports';

export type AuditCliOptions = {
  runDirRoot?: string;
  reportsDir?: string;
  packagePath?: string;
};

export const AUDIT_CLI_HELP = `studyAiAuditUnitCalibration.ts — Calibration-80 Unit Authoring result audit

Usage:
  npx tsx scripts/studyAiAuditUnitCalibration.ts [--run-dir-root <dir>] [--reports-dir <dir>] [--package <path>]

Options:
  --run-dir-root <dir>   Run dir to audit (default study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4)
  --reports-dir <dir>    Where the selection report lives and artifacts are written (default reports)
  --package <path>       Corpus content package (default study-content/packages/nb-sit-statute-corpus.content-package.json)
  --help                 Show this help

Read-only against the run dir; never writes into it. Deterministic outputs:
generatedAt 2026-09-02T00:00:00.000Z, jobId-stable ordering, SHA-256 input
digests embedded, so a second identical run produces byte-identical files.`;

const parseOptions = (rawArgs: string[]): AuditCliOptions => {
  const valueOf = (name: string): string | undefined => {
    const at = rawArgs.indexOf(`--${name}`);
    return at >= 0 ? rawArgs[at + 1] : undefined;
  };
  return {
    runDirRoot: valueOf('run-dir-root') ?? DEFAULT_RUN_DIR,
    reportsDir: valueOf('reports-dir') ?? DEFAULT_REPORTS_DIR,
    packagePath: valueOf('package') ?? DEFAULT_PACKAGE,
  };
};

const jsonl = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value, null, 2));

export const writeAuditArtifacts = (options: AuditCliOptions): string[] => {
  const reportsDir = resolve(options.reportsDir ?? DEFAULT_REPORTS_DIR);
  const selectionReportPath = join(
    reportsDir,
    'unit-calibration-80-20260902.json',
  );
  const runDir = resolve(options.runDirRoot ?? DEFAULT_RUN_DIR);
  const packagePath = resolve(options.packagePath ?? DEFAULT_PACKAGE);
  const inputs = loadAuditInputs({
    runDir,
    selectionReportPath,
    packagePath,
    specPath: 'study-content/ai/specs/unit-authoring-v4.md',
  });
  const bundle = buildAuditDocs(inputs);
  const markdown = renderAllMarkdown(bundle);
  const artifactPaths = [
    join(reportsDir, 'unit-calibration-80-result-audit-20260902.json'),
    join(reportsDir, 'unit-calibration-80-result-audit-20260902.md'),
    join(reportsDir, 'unit-calibration-80-human-review-20260902.json'),
    join(reportsDir, 'unit-calibration-80-human-review-20260902.md'),
    join(reportsDir, 'unit-calibration-80-regression-anchors-20260902.md'),
    join(reportsDir, 'unit-calibration-80-final-qc-20260902.md'),
  ];
  jsonl(artifactPaths[0], bundle.audit);
  writeFileSync(artifactPaths[1], markdown.auditMd);
  jsonl(artifactPaths[2], bundle.review);
  writeFileSync(artifactPaths[3], markdown.humanReviewMd);
  writeFileSync(artifactPaths[4], markdown.regressionAnchorsMd);
  writeFileSync(artifactPaths[5], markdown.finalQcMd);
  return artifactPaths;
};

const main = (): void => {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(AUDIT_CLI_HELP.trimEnd());
    return;
  }
  const options = parseOptions(rawArgs);
  const artifactPaths = writeAuditArtifacts(options);
  console.log('Wrote audit artifacts:');
  artifactPaths.forEach((path) => console.log(`  ${path}`));
};

if (process.argv[1]?.endsWith('.ts')) {
  main();
}

export const __studyAiAuditUnitCalibrationTest = {
  parseOptions,
  writeAuditArtifacts,
  AUDIT_CLI_HELP,
};
