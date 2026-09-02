/**
 * Study Unit Bridge CLI — frozen Study Map → unit authoring bridge commands.
 *
 * Current commands:
 *   verify-freeze  — runs the freeze gate + map/proposal/job equivalence audit
 *                    against the canonical frozen Study Map run; deterministic
 *                    JSON summary; exit 1 on any failure or mismatch.
 *   inventory      — builds the frozen-map unit group inventory and writes
 *                    `reports/frozen-map-unit-group-inventory-<dateTag>.json`
 *                    + `.md`; prints a summary.
 *
 * Later bridge tasks add more commands (preflight, calibrate, …). The
 * dispatcher stays trivial; all logic lives in `src/study/ai/`.
 *
 * Deterministic by design: no wall-clock timestamps anywhere.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  auditMapProposalEquivalence,
  sha256File,
  verifyFrozenStudyMap,
} from '../src/study/ai/studyAiMapFreezeGate';
import {
  buildFrozenMapGroupInventory,
  writeFrozenMapGroupInventory,
} from '../src/study/ai/studyAiUnitInventory';
import {
  runFrozenUnitPreflight,
  unitAuthoringReportVersionTag,
  type FrozenUnitPreflightOptions,
} from '../src/study/ai/studyAiUnitPreflight';
import {
  buildUnitAuthoringPreflightReport,
  renderUnitAuthoringPreflightReportMd,
} from '../src/study/ai/studyAiUnitPreflightReport';
import {
  buildCal80V5Run,
  type BuildCal80V5RunOptions,
} from '../src/study/ai/studyAiUnitCalibrationV5';
import { renderV4V5CrosswalkReportMd } from '../src/study/ai/studyAiUnitCalibrationV5Report';
import {
  runUnitCalibration80,
  type RunUnitCalibration80Options,
} from '../src/study/ai/studyAiUnitCalibrationRun';
import {
  buildCalibrationLaunchManifest,
  buildUnitCalibration80Report,
  renderUnitCalibration80ReportMd,
  renderUnitCalibration80ReviewPackMd,
} from '../src/study/ai/studyAiUnitCalibrationReport';

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

const commandVerifyFreeze = (): number => {
  const verification = verifyFrozenStudyMap();
  const audit = auditMapProposalEquivalence();
  const summary = {
    command: 'verify-freeze',
    ok: verification.ok && audit.totalMismatches === 0,
    gate: {
      ok: verification.ok,
      runId: verification.runId,
      resultRows: verification.resultRows,
      invalidRowIds: verification.invalidRowIds.length,
      groupingCorrectionJobIds: verification.groupingCorrectionJobIds.length,
      decisionFileSha256: verification.decisionFileSha256,
      proposalsSha256: verification.proposalsSha256,
      canonicalResultsSha256: verification.canonicalResultsSha256,
      priorityRecount: verification.priorityRecount,
      issues: verification.issues,
    },
    equivalence: {
      checked: audit.checked,
      totalMismatches: audit.totalMismatches,
      mismatches: audit.mismatches,
    },
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary.ok ? EXIT_OK : EXIT_FAILURE;
};

const commandInventory = (): number => {
  const inventory = buildFrozenMapGroupInventory();
  const dateTag = inventory.dateTag;
  const jsonPath = join('reports', `frozen-map-unit-group-inventory-${dateTag}.json`);
  const mdPath = join('reports', `frozen-map-unit-group-inventory-${dateTag}.md`);
  writeFrozenMapGroupInventory(inventory, jsonPath, mdPath);
  const summary = {
    command: 'inventory',
    wroteJson: jsonPath,
    wroteMd: mdPath,
    sourceMapRunId: inventory.sourceMapRunId,
    freezeReportSha256: inventory.freezeReportSha256,
    canonicalResultsSha256: inventory.canonicalResultsSha256,
    proposalsSha256: inventory.proposalsSha256,
    summary: inventory.summary,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return EXIT_OK;
};

const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const writeText = (path: string, value: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
};

const commandPreflight = (options: Record<string, string>): number => {
  const preflightOptions: FrozenUnitPreflightOptions = {};
  if (options['run-dir-root']) preflightOptions.runDirRoot = options['run-dir-root'];
  if (options['run-id']) preflightOptions.runId = options['run-id'];
  if (options['spec-version']) preflightOptions.promptSpecVersion = options['spec-version'];
  const reportsDir = options['reports-dir'] ?? 'reports';
  const result = runFrozenUnitPreflight(preflightOptions);
  if (!result.ok) {
    const summary = {
      command: 'preflight',
      ok: false,
      stage: result.stage,
      issues: result.issues,
      ...('detail' in result && result.stage === 'validation'
        ? { checkedJobs: (result.detail as { checkedJobs?: number }).checkedJobs }
        : {}),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return EXIT_FAILURE;
  }
  const report = buildUnitAuthoringPreflightReport(result);
  const versionTag = unitAuthoringReportVersionTag(report.promptSpecVersion);
  const reportTag = versionTag === '' ? '' : `-${versionTag}`;
  const jsonPath = join(reportsDir, `unit-authoring-preflight${reportTag}-${report.dateTag}.json`);
  const mdPath = join(reportsDir, `unit-authoring-preflight${reportTag}-${report.dateTag}.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderUnitAuthoringPreflightReportMd(report));
  const summary = {
    command: 'preflight',
    ok: true,
    runId: result.runId,
    counts: result.counts,
    distributions: {
      priority: result.distributions.priority,
      disposition: result.distributions.disposition,
      parentProvenance: result.distributions.parentProvenance,
      sourceCount: result.distributions.sourceCount,
      sizeBuckets: result.distributions.sizeBuckets,
    },
    eligibility: {
      groupedProposals: result.bypasses.groupedProposals,
      eligibleProposals: result.bypasses.eligibleProposals,
      needsReviewAccepted: result.bypasses.needsReviewAccepted,
      conflictCodedAccepted: result.bypasses.conflictCodedAccepted,
    },
    gate: { ok: result.gate.ok, issues: result.gate.issues.length },
    equivalence: { checked: result.equivalence.checked, mismatches: result.equivalence.totalMismatches },
    validation: { checkedJobs: result.validation.checkedJobs, issues: result.validation.issuesTotal },
    cardinality: result.cardinality,
    batchFiles: result.layout.batchCount,
    wroteRunDir: result.runDir,
    wroteJson: jsonPath,
    wroteMd: mdPath,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return EXIT_OK;
};

const commandCalibrate = (options: Record<string, string>): number => {
  const calibrationOptions: RunUnitCalibration80Options = {};
  if (options['run-dir-root']) calibrationOptions.runDirRoot = options['run-dir-root'];
  const reportsDir = options['reports-dir'] ?? 'reports';
  const result = runUnitCalibration80(calibrationOptions);
  if (!result.ok) {
    const summary = {
      command: 'calibrate',
      ok: false,
      stage: result.stage,
      issues: result.issues,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return EXIT_FAILURE;
  }
  const report = buildUnitCalibration80Report(result);
  const jsonPath = join(reportsDir, `unit-calibration-80-${report.dateTag}.json`);
  const mdPath = join(reportsDir, `unit-calibration-80-${report.dateTag}.md`);
  const reviewPackPath = join(reportsDir, `unit-calibration-80-review-pack-${report.dateTag}.md`);
  const manifestPath = join(reportsDir, `unit-calibration-80-launch-manifest-${report.dateTag}.json`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderUnitCalibration80ReportMd(report));
  writeText(reviewPackPath, renderUnitCalibration80ReviewPackMd(report));
  const manifest = buildCalibrationLaunchManifest(result, {
    selectionReportJsonPath: jsonPath,
    selectionReportJsonSha256: sha256File(jsonPath),
    reviewPackPath,
    reviewPackSha256: sha256File(reviewPackPath),
  });
  writeJson(manifestPath, manifest);
  const summary = {
    command: 'calibrate',
    ok: true,
    runId: result.runId,
    counts: result.counts,
    priority: result.priority,
    domain: result.domain,
    provenanceMix: result.provenanceMix,
    sizeBuckets: result.sizeBuckets,
    featureCoverage: result.featureCoverage,
    validation: result.validation,
    wroteRunDir: result.runDir,
    wroteJson: jsonPath,
    wroteMd: mdPath,
    wroteReviewPack: reviewPackPath,
    wroteManifest: manifestPath,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return EXIT_OK;
};

const commandCalibrateV5 = (options: Record<string, string>): number => {
  const reportsDir = options['reports-dir'] ?? 'reports';
  const calibrationOptions: BuildCal80V5RunOptions = {};
  if (options['v4-run-dir']) calibrationOptions.v4RunDir = options['v4-run-dir'];
  if (options['v5-preflight-run-dir'])
    calibrationOptions.v5PreflightRunDir = options['v5-preflight-run-dir'];
  if (options['run-dir-root']) calibrationOptions.runDirRoot = options['run-dir-root'];
  if (options['run-id']) calibrationOptions.runId = options['run-id'];
  try {
    const result = buildCal80V5Run(calibrationOptions);
    const crosswalk = result.crosswalk;
    const jsonPath = join(reportsDir, `unit-calibration-v4-v5-crosswalk-${crosswalk.dateTag}.json`);
    const mdPath = join(reportsDir, `unit-calibration-v4-v5-crosswalk-${crosswalk.dateTag}.md`);
    writeJson(jsonPath, crosswalk);
    writeText(mdPath, renderV4V5CrosswalkReportMd(crosswalk));
    const summary = {
      command: 'calibrate-v5',
      ok: true,
      runId: result.runId,
      v4RunId: result.v4RunId,
      v5PreflightRunId: result.v5PreflightRunId,
      sourceMapRunId: result.sourceMapRunId,
      promptSpecVersion: result.promptSpecVersion,
      dateTag: result.dateTag,
      batchSize: result.batchSize,
      cohort: result.cohort,
      priority: result.priorityDistribution,
      specShas: result.specShas,
      validation: result.validation,
      runLayout: {
        batchCount: result.layout.batchCount,
        batchSizes: result.layout.batchSizes,
        runJsonSha256: result.layout.runJsonSha256,
        unitJobReportSha256: result.layout.unitJobReportSha256,
      },
      wroteRunDir: result.runDir,
      wroteJson: jsonPath,
      wroteMd: mdPath,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return EXIT_OK;
  } catch (error) {
    const summary = {
      command: 'calibrate-v5',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return EXIT_FAILURE;
  }
};

const usage = (): string =>
  [
    'Usage: npx tsx scripts/studyUnitBridge.ts <command> [options]',
    '',
    'Commands:',
    '  verify-freeze   run freeze gate + map/proposal/job equivalence audit (exit 1 on failure)',
    '  inventory       build frozen-map unit group inventory and write reports',
    '  preflight       run the frozen unit-authoring preflight (gate, eligibility, build,',
    '                  validate) and write the prepared run + deterministic reports',
    '  calibrate       select the deterministic calibration-80 from the preflight jobs,',
    '                  write the sibling prepared run (batch size 8) + reports',
    '  calibrate-v5    build the cal80-v5 sibling run from the cal80-v4 cohort + v5',
    '                  preflight jobs and write the prepared run + V4/V5 crosswalk reports',
    '',
    'Options (preflight / calibrate / calibrate-v5):',
    '  --run-dir-root <dir>        root for the prepared run directory (default study-content/ai/runs)',
    '  --reports-dir <dir>         report output directory (default reports)',
    '',
    'Options (preflight):',
    '  --spec-version <version>    unit authoring prompt spec version (default unit-authoring-v4;',
    '                              e.g. unit-authoring-v5 emits unit-authoring-preflight-v5-<dateTag>.*)',
    '  --run-id <runId>            prepared run id (default ai-units-2026-09-02-frozen-map-v4-preflight)',
    '',
    'Options (calibrate-v5):',
    '  --v4-run-dir <dir>          cal80-v4 run dir (default study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4)',
    '  --v5-preflight-run-dir <dir> v5 preflight run dir (default study-content/ai/runs/ai-units-2026-09-02-frozen-map-v5-preflight)',
    '  --run-id <runId>            sibling run id (default ai-units-2026-09-02-frozen-map-cal80-v5)',
  ].join('\n');

const parseOptions = (args: readonly string[]): { command: string; options: Record<string, string> } => {
  const options: Record<string, string> = {};
  let command = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      options[key] = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (command === '') command = arg;
  }
  return { command, options };
};

const main = (): void => {
  const { command, options } = parseOptions(process.argv.slice(2));
  let exitCode: number;
  if (command === 'verify-freeze') exitCode = commandVerifyFreeze();
  else if (command === 'inventory') exitCode = commandInventory();
  else if (command === 'preflight') exitCode = commandPreflight(options);
  else if (command === 'calibrate') exitCode = commandCalibrate(options);
  else if (command === 'calibrate-v5') exitCode = commandCalibrateV5(options);
  else {
    process.stderr.write(`${usage()}\n`);
    exitCode = EXIT_USAGE;
  }
  process.exitCode = exitCode;
};

main();
