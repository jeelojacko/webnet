/**
 * Reconstruct and validate the effective calibration-80 cohort:
 *   43 original hardened-valid V5 results (cal80-v5 run)
 * + 37 remediation1 replacements (incl. 1 human-adjudicated row)
 * = 80 units, each re-validated with the full unit-authoring-v5 fidelity gate.
 *
 * Fail-closed: exits non-zero unless 80/80 rows validate with 0 error-severity
 * issues and none of the hard V5 fidelity codes are present.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AiStudyUnitProposal } from '../src/study/ai/studyAiTypes';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import { sourceComponentsForProposal } from '../src/study/ai/studyAiUnitSourceComponents';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';
import { RUNS_DIR, readJson, readJsonl } from '../scripts/studyAiLocalMapAuthor';

const RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v5';
const REMEDIATION_RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v5-remediation1';
const PACKAGE = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const INVALIDATION_REPORT = 'reports/unit-v5-post-human-qc-revalidation-20260902.json';
const STAMP = '20260903';

const HARD_V5_CODES = [
  'SOURCE_COVERAGE_MISSING_SELECTED_LABEL',
  'SOURCE_COVERAGE_EXTRA_LABEL',
  'UNCOVERED_SUBSTANTIVE_SOURCE',
  'APPROVED_FOCUS_NOT_COVERED',
  'POLARITY_REVERSAL',
  'LEGAL_MODALITY_REVERSAL',
  'EVIDENCE_NOT_EXACT_VERBATIM',
  'CONTEXT_REF_LEAKAGE',
  'UNSUPPORTED_LEGAL_EFFECT',
] as const;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const fail = (message: string): never => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

type UnitCheck = {
  proposalId: string;
  source: 'original-v5' | 'remediation1';
  humanAdjudicated: boolean;
  accepted: boolean;
  errorCodes: string[];
  hardErrorCodes: string[];
  warningCount: number;
  title: string;
  suggestedPriority: string;
  corpusContentHash: string;
};

const main = (): void => {
  const pkg = readJson<NbLawContentPackage>(PACKAGE);
  const invalidation = readJson<{ units: Array<{ proposalId: string; errorCodes: string[] }> }>(INVALIDATION_REPORT);
  const invalidIds = new Set(invalidation.units.map((u) => u.proposalId));
  if (invalidIds.size !== 37) fail(`expected 37 invalidated units, found ${invalidIds.size}`);

  const originalRows = readJsonl<AiStudyUnitProposal>(
    join(RUNS_DIR, RUN_ID, 'results', 'local-unit.results.jsonl'),
  );
  const remediationRows = readJsonl<AiStudyUnitProposal>(
    join(RUNS_DIR, REMEDIATION_RUN_ID, 'results', 'local-unit.results.jsonl'),
  );
  if (originalRows.length !== 80) fail(`expected 80 original rows, found ${originalRows.length}`);
  if (remediationRows.length !== 37) fail(`expected 37 remediation rows, found ${remediationRows.length}`);

  const remediIds = new Set(remediationRows.map((r) => r.proposalId));
  for (const id of invalidIds) {
    if (!remediIds.has(id)) fail(`invalidated unit ${id} has no remediation1 result row`);
  }
  for (const id of remediIds) {
    if (!invalidIds.has(id)) fail(`remediation row ${id} is not an invalidated unit`);
  }

  const chosen: Array<{ proposal: AiStudyUnitProposal; source: 'original-v5' | 'remediation1' }> = [
    ...originalRows.filter((r) => !invalidIds.has(r.proposalId)).map((proposal) => ({ proposal, source: 'original-v5' as const })),
    ...remediationRows.map((proposal) => ({ proposal, source: 'remediation1' as const })),
  ];
  if (chosen.length !== 80) fail(`expected 80 effective rows, got ${chosen.length}`);
  const seen = new Set<string>();
  for (const { proposal } of chosen) {
    if (seen.has(proposal.proposalId)) fail(`duplicate proposalId in effective cohort: ${proposal.proposalId}`);
    seen.add(proposal.proposalId);
  }

  const checks: UnitCheck[] = [];
  let unresolved = 0;
  for (const { proposal, source } of chosen) {
    const report = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: sourceComponentsForProposal(pkg, proposal.sourceDocumentId, proposal.sourceKeys),
      corpusContentHash: proposal.corpusContentHash,
    });
    const errors = report.issues.filter((i) => i.severity === 'error');
    const warnings = report.issues.filter((i) => i.severity === 'warning');
    const errorCodes = report.issues.map((i) => i.code);
    const hardErrorCodes = errorCodes.filter((c) => (HARD_V5_CODES as readonly string[]).includes(c));
    if (errors.length > 0) unresolved += 1;
    checks.push({
      proposalId: proposal.proposalId,
      source,
      humanAdjudicated: Boolean(proposal.generationMetadata?.humanAdjudication),
      accepted: errors.length === 0,
      errorCodes,
      hardErrorCodes,
      warningCount: warnings.length,
      title: proposal.title,
      suggestedPriority: proposal.suggestedPriority ?? 'null',
      corpusContentHash: proposal.corpusContentHash,
    });
  }

  const accepted = checks.filter((c) => c.accepted).length;
  const hardErrors = checks.reduce((n, c) => n + c.hardErrorCodes.length, 0);
  const humanAdjudicatedCount = checks.filter((c) => c.humanAdjudicated).length;
  const perCode: Record<string, number> = {};
  for (const c of checks) for (const code of c.errorCodes) perCode[code] = (perCode[code] ?? 0) + 1;

  const summary = {
    schemaVersion: 1,
    stamp: STAMP,
    originalRunId: RUN_ID,
    remediationRunId: REMEDIATION_RUN_ID,
    packagePath: PACKAGE,
    cohortSize: checks.length,
    originalValidRetained: checks.filter((c) => c.source === 'original-v5').length,
    remediationReplacements: checks.filter((c) => c.source === 'remediation1').length,
    humanAdjudicatedUnits: humanAdjudicatedCount,
    accepted,
    unresolved,
    hardV5FidelityErrors: hardErrors,
    perCode,
    gate: {
      cohortSize80: checks.length === 80,
      accepted80: accepted === 80,
      zeroUnresolved: unresolved === 0,
      zeroHardV5Errors: hardErrors === 0,
    },
    checks,
  };

  const passed = summary.gate.cohortSize80 && summary.gate.accepted80 && summary.gate.zeroUnresolved && summary.gate.zeroHardV5Errors;
  const json = JSON.stringify(summary, null, 2);
  const markdown = [
    `# Effective Calibration-80 — V5 Validation (${STAMP})`,
    '',
    `Reconstructed cohort: **${summary.originalValidRetained}** originally valid V5 results from \`${RUN_ID}\` + **${summary.remediationReplacements}** remediation1 replacements (run \`${REMEDIATION_RUN_ID}\`, including **${humanAdjudicatedCount}** human-adjudicated unit).`,
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Cohort size | ${checks.length} |`,
    `| Accepted (0 error-severity issues) | ${accepted} |`,
    `| Hard V5 fidelity errors | ${hardErrors} |`,
    `| Unresolved units | ${unresolved} |`,
    `| Gate ${passed ? 'PASSED' : 'FAILED'} | ${passed} |`,
    '',
    ...(passed ? [] : ['**GATE FAILED** — see per-unit checks below.', '']),
    `## Per-unit checks`,
    '',
    `| proposalId | source | title | priority | issues | hard V5 errors | warnings |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...checks
      .slice()
      .sort((a, b) => a.proposalId.localeCompare(b.proposalId))
      .map((c) => `| ${c.proposalId}${c.humanAdjudicated ? ' (human)' : ''} | ${c.source} | ${c.title} | ${c.suggestedPriority} | ${c.errorCodes.length} | ${c.hardErrorCodes.length} | ${c.warningCount} |`),
    '',
    `JSON SHA-256: \`${sha256(json)}\``,
    '',
  ].join('\n');

  const jsonPath = `reports/unit-calibration-80-effective-v5-${STAMP}.json`;
  const mdPath = `reports/unit-calibration-80-effective-v5-${STAMP}.md`;
  writeFileSync(jsonPath, json + '\n');
  writeFileSync(mdPath, markdown);
  console.log(
    `effective cal80: cohort=${checks.length} accepted=${accepted} unresolved=${unresolved} hardErrors=${hardErrors} humanAdjudicated=${humanAdjudicatedCount}`,
  );
  console.log(`reports: ${jsonPath} (sha256 ${sha256(json).slice(0, 16)}…), ${mdPath}`);
  if (!passed) process.exit(1);
};

main();
