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
import { join } from 'node:path';
import {
  auditMapProposalEquivalence,
  verifyFrozenStudyMap,
} from '../src/study/ai/studyAiMapFreezeGate';
import {
  buildFrozenMapGroupInventory,
  writeFrozenMapGroupInventory,
} from '../src/study/ai/studyAiUnitInventory';

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

const usage = (): string =>
  [
    'Usage: npx tsx scripts/studyUnitBridge.ts <command>',
    '',
    'Commands:',
    '  verify-freeze   run freeze gate + map/proposal/job equivalence audit (exit 1 on failure)',
    '  inventory       build frozen-map unit group inventory and write reports',
  ].join('\n');

const main = (): void => {
  const command = process.argv[2];
  let exitCode: number;
  if (command === 'verify-freeze') exitCode = commandVerifyFreeze();
  else if (command === 'inventory') exitCode = commandInventory();
  else {
    process.stderr.write(`${usage()}\n`);
    exitCode = EXIT_USAGE;
  }
  process.exitCode = exitCode;
};

main();
