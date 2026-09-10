/**
 * Deterministic aggregation + report content for the frozen unit preflight.
 *
 * Owns the distribution/layout helpers that summarize a prepared run (priority,
 * disposition, document, provenance, source count, focus styles, size buckets,
 * combine/multi-source, batch layout with per-file SHA-256s) plus the tracked
 * `reports/unit-authoring-preflight-<dateTag>.{json,md}` builders. Pure logic:
 * no provider calls, no wall-clock output. The orchestration in
 * `studyAiUnitPreflight.ts` calls `summarizeJobDistributions` /
 * `inspectPreparedRunLayout`; the CLI renders the report.
 */
import type { AiUnitAuthoringJob } from './studyAiTypes';
import type { ProvenanceClass } from './studyAiUnitInventory';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_DIR_REL, sha256File } from './studyAiMapFreezeGate';
import type { FrozenUnitPreflightSuccess } from './studyAiUnitPreflight';

/* ------------------------------------------------------------------ *
 * Distributions                                                       *
 * ------------------------------------------------------------------ */

export type UnitPreflightDistributions = {
  priority: Record<string, number>;
  disposition: Record<string, number>;
  document: Record<string, number>;
  parentProvenance: Record<ProvenanceClass, number>;
  sourceCount: Record<string, number>;
  focusSelectionCount: Record<string, number>;
  evidenceTextPassages: number;
  sizeBuckets: Record<string, number>;
  combine: { combineJobs: number; multiSourceJobs: number; maxSourceKeys: number };
};

/** Exact source-character size buckets for unit authoring jobs. */
export const SIZE_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number | null }> = [
  { label: '<2,000', min: 0, max: 1999 },
  { label: '2,000-5,999', min: 2000, max: 5999 },
  { label: '6,000-14,999', min: 6000, max: 14999 },
  { label: '>=15,000', min: 15000, max: null },
];

const bucketOf = (characters: number): string => {
  const bucket = SIZE_BUCKETS.find(
    (entry) => characters >= entry.min && (entry.max === null || characters <= entry.max),
  );
  return bucket?.label ?? '>=15,000';
};

const countUp = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export const summarizeJobDistributions = (
  jobs: AiUnitAuthoringJob[],
  provenanceByJobId: Map<string, ProvenanceClass>,
): UnitPreflightDistributions => {
  const priority: Record<string, number> = {};
  const disposition: Record<string, number> = {};
  const document: Record<string, number> = {};
  const sourceCount: Record<string, number> = {};
  const focusSelectionCount: Record<string, number> = {};
  const sizeBuckets: Record<string, number> = {};
  const parentProvenance: Record<ProvenanceClass, number> = {
    'final-QC-adjudicated': 0,
    'human-adjudicated': 0,
    'retry-promoted': 0,
    recovered: 0,
    original: 0,
  };
  let evidenceTextPassages = 0;
  let combineJobs = 0;
  let multiSourceJobs = 0;
  let maxSourceKeys = 0;
  for (const job of jobs) {
    const group = job.approvedGroup;
    countUp(priority, job.frozenMapPriority ?? 'null');
    countUp(disposition, job.mapDisposition);
    countUp(document, job.document.documentId);
    const provenance = provenanceByJobId.get(job.sourceMapProposalId);
    countUp(parentProvenance, provenance ?? 'original');
    const sourceKeys = group.sourceKeys.length;
    countUp(sourceCount, sourceKeys >= 3 ? '3+' : String(sourceKeys));
    const focusCount = group.focusSelections.length;
    countUp(focusSelectionCount, focusCount >= 3 ? '3+' : String(focusCount));
    evidenceTextPassages += group.focusSelections.reduce(
      (total, focus) => total + (focus.evidenceText?.length ?? 0),
      0,
    );
    countUp(sizeBuckets, bucketOf(job.exactSourceText.length));
    if (job.mapDisposition === 'combine') combineJobs += 1;
    if (sourceKeys > 1) multiSourceJobs += 1;
    maxSourceKeys = Math.max(maxSourceKeys, sourceKeys);
  }
  return {
    priority,
    disposition,
    document,
    parentProvenance,
    sourceCount,
    focusSelectionCount,
    evidenceTextPassages,
    sizeBuckets,
    combine: { combineJobs, multiSourceJobs, maxSourceKeys },
  };
};

/* ------------------------------------------------------------------ *
 * Run layout                                                          *
 * ------------------------------------------------------------------ */

export type PreparedRunLayoutFile = { file: string; sha256: string };

export type PreparedRunLayout = {
  runDir: string;
  batchSize: number;
  batchCount: number;
  batchSizes: Record<string, number>;
  batchFiles: PreparedRunLayoutFile[];
  runJsonSha256: string | null;
  unitJobReportSha256: string | null;
};

export const inspectPreparedRunLayout = (
  runDir: string,
  batchSize: number,
  jobCount: number,
): PreparedRunLayout => {
  const jobsDir = join(runDir, 'jobs');
  const batchFiles = existsSync(jobsDir)
    ? readdirSync(jobsDir)
        .filter((file) => file.endsWith('.jobs.jsonl'))
        .sort()
        .map((file) => ({
          file: `jobs/${file}`,
          sha256: sha256File(join(jobsDir, file)) ?? '',
        }))
    : [];
  const fullBatches = jobCount === 0 ? 0 : Math.floor(jobCount / batchSize);
  const remainder = jobCount === 0 ? 0 : jobCount % batchSize;
  const batchSizes: Record<string, number> = {};
  if (fullBatches > 0) batchSizes[String(batchSize)] = fullBatches;
  if (remainder > 0) batchSizes[String(remainder)] = 1;
  return {
    runDir,
    batchSize,
    batchCount: batchFiles.length,
    batchSizes,
    batchFiles,
    runJsonSha256: sha256File(join(runDir, 'run.json')),
    unitJobReportSha256: sha256File(join(runDir, 'reports', 'unit-job-report.json')),
  };
};

/* ------------------------------------------------------------------ *
 * Report JSON                                                         *
 * ------------------------------------------------------------------ */

export type UnitAuthoringPreflightReport = {
  schemaVersion: 1;
  kind: 'frozen-unit-authoring-preflight';
  dateTag: string;
  runId: string;
  generatedAt: string;
  promptSpecVersion: string;
  sourceMapRunId: string;
  frozenSourceIdentity: {
    freezeReportPath: string;
    freezeReportSha256: string | null;
    canonicalResultsSha256: string | null;
    mapProposalsSha256: string | null;
    corpusPackagePath: string;
    corpusPackageSha256: string | null;
    corpusPackageId: string | null;
    corpusContentHash: string;
  };
  counts: Record<string, number>;
  eligibility: Record<string, unknown>;
  gate: Record<string, unknown>;
  equivalence: Record<string, unknown>;
  validator: Record<string, unknown>;
  cardinality: Record<string, unknown>;
  distributions: Record<string, unknown>;
  runLayout: Record<string, unknown>;
  referencedReports: {
    inventoryReportFiles: Array<{ file: string; sha256: string | null }>;
  };
};

const sortedCounts = (counts: Record<string, number>): Record<string, number> => {
  const entries = Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1));
  return Object.fromEntries(entries);
};

export const buildUnitAuthoringPreflightReport = (
  result: FrozenUnitPreflightSuccess,
): UnitAuthoringPreflightReport => {
  const inventoryFiles = [
    `reports/frozen-map-unit-group-inventory-${result.dateTag}.json`,
    `reports/frozen-map-unit-group-inventory-${result.dateTag}.md`,
  ];
  return {
    schemaVersion: 1,
    kind: 'frozen-unit-authoring-preflight',
    dateTag: result.dateTag,
    runId: result.runId,
    generatedAt: result.generatedAt,
    promptSpecVersion: result.promptSpecVersion,
    sourceMapRunId: result.sourceMapRunId,
    frozenSourceIdentity: {
      freezeReportPath: result.frozenSourceIdentity.freezeReportPath,
      freezeReportSha256: result.frozenSourceIdentity.freezeReportSha256,
      canonicalResultsSha256: result.frozenSourceIdentity.canonicalResultsSha256,
      mapProposalsSha256: result.frozenSourceIdentity.proposalsSha256,
      corpusPackagePath: result.corpusPackagePath,
      corpusPackageSha256: result.corpusPackageSha256,
      corpusPackageId: result.corpusPackageId,
      corpusContentHash: result.corpusContentHash,
    },
    counts: {
      totalResults: result.counts.totalResults,
      groupedResults: result.counts.groupedResults,
      zeroGroupResults: result.counts.zeroGroupResults,
      proposedGroups: result.counts.proposedGroups,
      expectedJobs: result.counts.expectedJobs,
      jobs: result.counts.jobs,
    },
    eligibility: {
      groupedProposals: result.bypasses.groupedProposals,
      eligibleProposals: result.bypasses.eligibleProposals,
      zeroJobDispositions: sortedCounts(result.bypasses.zeroJobDispositions),
      reviewStatusCounts: sortedCounts(result.bypasses.reviewStatusCounts),
      needsReviewAccepted: result.bypasses.needsReviewAccepted,
      needsReviewAdjudicated: result.bypasses.needsReviewAdjudicated,
      conflictCodedAccepted: result.bypasses.conflictCodedAccepted,
      acceptedConflictJobIds: result.bypasses.acceptedConflictJobIds,
      acceptedNeedsReviewJobIds: result.bypasses.acceptedNeedsReviewJobIds,
      bypassProposalIds: result.bypasses.bypassProposalIds,
    },
    gate: {
      ok: result.gate.ok,
      issues: result.gate.issues,
      resultRows: result.gate.resultRows,
      invalidRowIds: result.gate.invalidRowIds.length,
      priorityRecount: sortedCounts(result.gate.priorityRecount),
      groupingCorrectionJobIds: result.gate.groupingCorrectionJobIds,
      decisionFileSha256: result.gate.decisionFileSha256,
      recordedDecisionFileSha256: result.gate.recordedDecisionFileSha256,
    },
    equivalence: {
      checked: result.equivalence.checked,
      totalMismatches: result.equivalence.totalMismatches,
      mismatches: result.equivalence.mismatches,
    },
    validator: {
      checkedJobs: result.validation.checkedJobs,
      issuesTotal: result.validation.issuesTotal,
      sampleIssues: result.validation.sampleIssues,
    },
    cardinality: {
      expectedMatchesBuilt: result.cardinality.expectedMatchesBuilt,
      uniqueJobIds: result.cardinality.uniqueJobIds,
      uniqueProposalGroupKeys: result.cardinality.uniqueProposalGroupKeys,
      everyProposalGroupOnce: result.cardinality.everyProposalGroupOnce,
      zeroGroupJobs: result.cardinality.zeroGroupJobs,
      nonEligibleProposalJobs: result.cardinality.nonEligibleProposalJobs,
    },
    distributions: {
      priority: sortedCounts(result.distributions.priority),
      disposition: sortedCounts(result.distributions.disposition),
      parentProvenance: sortedCounts(result.distributions.parentProvenance),
      sourceCount: sortedCounts(result.distributions.sourceCount),
      focusSelectionCount: sortedCounts(result.distributions.focusSelectionCount),
      evidenceTextPassages: result.distributions.evidenceTextPassages,
      sizeBuckets: sortedCounts(result.distributions.sizeBuckets),
      document: sortedCounts(result.distributions.document),
      combine: result.distributions.combine,
    },
    runLayout: {
      runDir: `${RUNS_DIR_REL}/${result.runId}`,
      batchSize: result.layout.batchSize,
      batchCount: result.layout.batchCount,
      batchSizes: result.layout.batchSizes,
      batchFiles: result.layout.batchFiles,
      runJsonSha256: result.layout.runJsonSha256,
      unitJobReportSha256: result.layout.unitJobReportSha256,
    },
    referencedReports: {
      inventoryReportFiles: inventoryFiles.map((file) => ({ file, sha256: sha256File(file) })),
    },
  };
};

/* ------------------------------------------------------------------ *
 * Report markdown                                                     *
 * ------------------------------------------------------------------ */

const renderIdList = (jobIds: string[]): string[] =>
  jobIds.length > 0 ? jobIds.map((jobId) => `- ${jobId}`) : ['- none'];

const renderTable = (title: string, counts: Record<string, number>): string[] => [
  title,
  '',
  '| Key | Count |',
  '| --- | --- |',
  ...Object.keys(counts)
    .sort()
    .map((key) => `| ${key} | ${counts[key]} |`),
];

export const renderUnitAuthoringPreflightReportMd = (
  report: UnitAuthoringPreflightReport,
): string => {
  const dist = report.distributions as Record<string, unknown>;
  const combine = dist.combine as { combineJobs: number; multiSourceJobs: number; maxSourceKeys: number };
  const lines = [
    `# Frozen Map → Unit Authoring Preflight — ${report.dateTag}`,
    '',
    `Run id: \`${report.runId}\``,
    `Prompt spec: \`${report.promptSpecVersion}\``,
    `Source map run: \`${report.sourceMapRunId}\``,
    `Generated at: \`${report.generatedAt}\``,
    '',
    '## Frozen source identity',
    '',
    '| Artifact | SHA-256 |',
    '| --- | --- |',
    `| Freeze report (\`${report.frozenSourceIdentity.freezeReportPath}\`) | \`${report.frozenSourceIdentity.freezeReportSha256 ?? 'unavailable'}\` |`,
    '| Canonical results | ' +
      `\`${report.frozenSourceIdentity.canonicalResultsSha256 ?? 'unavailable'}\` |`,
    '| Map proposals | ' +
      `\`${report.frozenSourceIdentity.mapProposalsSha256 ?? 'unavailable'}\` |`,
    `| Corpus package (\`${report.frozenSourceIdentity.corpusPackagePath}\`) | \`${report.frozenSourceIdentity.corpusPackageSha256 ?? 'unavailable'}\` |`,
    `| Corpus package id | \`${report.frozenSourceIdentity.corpusPackageId ?? 'unavailable'}\` |`,
    `| Corpus content hash | \`${report.frozenSourceIdentity.corpusContentHash}\` |`,
    '',
    '## Counts',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    ...Object.entries(report.counts).map(([key, value]) => `| ${key} | ${String(value)} |`),
    '',
    '## Eligibility',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Grouped proposals | ${report.eligibility.groupedProposals} |`,
    `| Eligible proposals | ${report.eligibility.eligibleProposals} |`,
    `| Needs-review accepted | ${report.eligibility.needsReviewAccepted} (adjudicated: ${report.eligibility.needsReviewAdjudicated}) |`,
    `| Conflict-coded accepted (warning-level frozen rows) | ${report.eligibility.conflictCodedAccepted} |`,
    `| Bypassed proposal ids | ${(report.eligibility.bypassProposalIds as string[]).length} |`,
    '',
    '### Zero-job dispositions',
    '',
    '| Disposition | Proposals |',
    '| --- | --- |',
    ...Object.entries(report.eligibility.zeroJobDispositions as Record<string, number>).map(
      ([key, value]) => `| ${key} | ${value} |`,
    ),
    '',
    '### Review status',
    '',
    '| Review status | Proposals |',
    '| --- | --- |',
    ...Object.entries(report.eligibility.reviewStatusCounts as Record<string, number>).map(
      ([key, value]) => `| ${key} | ${value} |`,
    ),
    '',
    '### Accepted conflict-coded proposals',
    '',
    ...renderIdList(report.eligibility.acceptedConflictJobIds as string[]),
    '',
    '### Accepted needs-review proposals',
    '',
    ...renderIdList(report.eligibility.acceptedNeedsReviewJobIds as string[]),
    '',
    '## Gate and equivalence',
    '',
    `- Freeze gate ok: ${report.gate.ok}`,
    `- Freeze gate issues: ${(report.gate.issues as unknown[]).length}`,
    `- Equivalence checked: ${report.equivalence.checked}`,
    `- Equivalence mismatches: ${report.equivalence.totalMismatches}`,
    '',
    '## Validator and cardinality',
    '',
    `- Jobs validated: ${report.validator.checkedJobs}`,
    `- Validation issues: ${report.validator.issuesTotal}`,
    `- Expected == built: ${report.cardinality.expectedMatchesBuilt}`,
    `- Unique jobIds: ${report.cardinality.uniqueJobIds}`,
    `- Unique (proposalId, groupIndex) keys: ${report.cardinality.uniqueProposalGroupKeys}`,
    `- Every (proposalId, groupIndex) exactly once: ${report.cardinality.everyProposalGroupOnce}`,
    `- Zero-group jobs: ${report.cardinality.zeroGroupJobs}`,
    `- Jobs from non-eligible proposals: ${report.cardinality.nonEligibleProposalJobs}`,
    '',
    ...renderTable('## Priority distribution', dist.priority as Record<string, number>),
    '',
    ...renderTable('## Disposition distribution', dist.disposition as Record<string, number>),
    '',
    ...renderTable('## Parent provenance', dist.parentProvenance as Record<string, number>),
    '',
    ...renderTable('## Source count per job', dist.sourceCount as Record<string, number>),
    '',
    ...renderTable(
      '## Focus selections per job',
      dist.focusSelectionCount as Record<string, number>,
    ),
    '',
    ...renderTable('## Size buckets (exact source characters)', dist.sizeBuckets as Record<string, number>),
    '',
    `## Document distribution (${Object.keys(dist.document as Record<string, number>).length} documents)`,
    '',
    '| documentId | jobs |',
    '| --- | --- |',
    ...Object.entries(dist.document as Record<string, number>).map(
      ([key, value]) => `| ${key} | ${value} |`,
    ),
    '',
    '## Combine / multi-source',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Combine-parent jobs | ${combine.combineJobs} |`,
    `| Multi-source jobs | ${combine.multiSourceJobs} |`,
    `| Max sourceKeys on one job | ${combine.maxSourceKeys} |`,
    '',
    '## Run layout',
    '',
    `- Run dir: \`${report.runLayout.runDir}\``,
    `- Batch size: ${report.runLayout.batchSize}`,
    `- Batch count: ${report.runLayout.batchCount}`,
    `- Batch sizes: ${JSON.stringify(report.runLayout.batchSizes)}`,
    `- run.json SHA-256: \`${report.runLayout.runJsonSha256 ?? 'unavailable'}\``,
    `- unit-job-report.json SHA-256: \`${report.runLayout.unitJobReportSha256 ?? 'unavailable'}\``,
    '',
    '| Batch file | SHA-256 |',
    '| --- | --- |',
    ...(report.runLayout.batchFiles as PreparedRunLayoutFile[]).map(
      (file) => `| ${file.file} | \`${file.sha256}\` |`,
    ),
    '',
    '## Referenced reports',
    '',
    '| File | SHA-256 |',
    '| --- | --- |',
    ...report.referencedReports.inventoryReportFiles.map(
      (file) => `| ${file.file} | \`${file.sha256 ?? 'unavailable'}\` |`,
    ),
    '',
  ];
  return lines.join('\n');
};
