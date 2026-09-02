/**
 * Deterministic post-inference audit of the frozen calibration-80 Unit
 * Authoring V4 run.
 *
 * Orchestrates the split modules into the four machine documents:
 *  - `.jobs.ts`  per-job outcome records (identity + canonical validation)
 *  - `.review.ts` human review + regression anchors + final QC companions
 *  - `.load.ts`  deterministic file IO + SHA-256 capture
 *  - `.utils.ts` risk classifier, coverage flags, pure counting
 *  - `.markdown.ts` the four Markdown renderers
 *
 * No provider calls, no wall clock, no randomness: every list is ordered by
 * jobId; `generatedAt` is the fixed 20260902 identity.
 */
import { detectAiUnitProposalOverlaps } from './studyAiValidation';
import type { AiStudyUnitProposal } from './studyAiTypes';
import type {
  AuditBundle,
  AuditDoc,
  AuditLoadedInputs,
  CountTable,
  FinalQcParent,
  GapAccounting,
  JobAuditRecord,
  PriorityGapRow,
  UnitAuditError,
  UnitAuditFinding,
  UnitJobOutcomeStatus,
} from './studyAiUnitCalibrationAudit.types';
import {
  AUDIT_DATE_TAG,
  AUDIT_GENERATED_AT,
  AUDIT_SCHEMA_VERSION,
} from './studyAiUnitCalibrationAudit.types';
import { countBy, sortedUnique } from './studyAiUnitCalibrationAudit.utils';
import { buildRecords } from './studyAiUnitCalibrationAudit.jobs';
import {
  buildFinalQcDoc,
  buildRegressionAnchorsDoc,
  buildReviewDoc,
} from './studyAiUnitCalibrationAudit.review';

/* ------------------------------------------------------------------ *
 * Gap accounting                                                     *
 * ------------------------------------------------------------------ */

/**
 * Pure per-priority reconciliation: `items` are the per-job statuses, keyed
 * against the frozen selection distribution target. Exported for tests.
 */
export const gapRowsFor = (
  target: Record<string, number>,
  items: Array<{ priority: string; status: UnitJobOutcomeStatus }>,
): PriorityGapRow[] => {
  const priorities = sortedUnique([...Object.keys(target), ...items.map((item) => item.priority)]);
  return priorities.map((priority) => {
    const selected = items.filter((item) => item.priority === priority);
    const count = (status: UnitJobOutcomeStatus): number =>
      selected.filter((item) => item.status === status).length;
    return {
      priority,
      target: target[priority] ?? 0,
      selected: selected.length,
      accepted: count('accepted'),
      semanticFailed: count('semantic-failed'),
      providerIncomplete: count('provider-incomplete'),
      nothing: count('nothing'),
      gap: (target[priority] ?? 0) - selected.length,
    };
  });
};

const buildGap = (
  inputs: AuditLoadedInputs,
  records: JobAuditRecord[],
): GapAccounting => {
  const distributionTarget = inputs.selection.distributions?.priority?.target ?? {};
  const rows = gapRowsFor(
    distributionTarget,
    records.map((record) => ({
      priority: record.frozenPriority ?? 'null',
      status: record.status,
    })),
  );
  const exact = rows.every((row) => row.selected === row.target && row.gap === 0);
  return {
    priority: {
      target: distributionTarget,
      rows,
      exact,
      note:
        'Per priority the frozen selection distribution must equal the number of selected job ' +
        'rows found in the run (accepted + semanticFailed + providerIncomplete + nothing); a ' +
        'nonzero gap means a selected job has no row at all (never attempted).',
    },
  };
};

/* ------------------------------------------------------------------ *
 * Histograms / validation summary                                   *
 * ------------------------------------------------------------------ */

const buildValidationSummary = (records: JobAuditRecord[]) => {
  const revalidated = records.filter((record) => record.validation.status !== 'not-revalidated');
  const issueCodeCounts: CountTable = {};
  const severity = { error: 0, warning: 0 };
  for (const record of revalidated) {
    severity.error += record.validation.errorCount;
    severity.warning += record.validation.warningCount;
    for (const code of record.validation.issueCodes) {
      issueCodeCounts[code] = (issueCodeCounts[code] ?? 0) + 1;
    }
  }
  return {
    revalidated: revalidated.length,
    valid: revalidated.filter((record) => record.validation.status === 'valid').length,
    warnings: revalidated.filter((record) => record.validation.status === 'warnings').length,
    invalid: revalidated.filter((record) => record.validation.status === 'invalid').length,
    issueCodeCounts,
    issueSeverityCounts: severity,
    notRevalidated: records.length - revalidated.length,
  };
};

const buildDistributions = (inputs: AuditLoadedInputs, records: JobAuditRecord[]) => {
  const accepted = records.filter((record) => record.result !== undefined);
  const objectiveCounts: CountTable = {};
  for (const record of accepted) {
    const key = String(record.objectiveCount);
    objectiveCounts[key] = (objectiveCounts[key] ?? 0) + 1;
  }
  const attemptsUsed: CountTable = {};
  for (const record of records) {
    const key = String(record.attemptsUsed);
    attemptsUsed[key] = (attemptsUsed[key] ?? 0) + 1;
  }
  const issueCodesAcrossAttempts: CountTable = {};
  for (const record of records) {
    for (const attempt of record.attempts) {
      for (const code of attempt.issueCodes) {
        issueCodesAcrossAttempts[code] = (issueCodesAcrossAttempts[code] ?? 0) + 1;
      }
    }
  }
  const providerEventRefs: CountTable = {};
  for (const record of records) {
    const key = String(record.providerEventCount);
    providerEventRefs[key] = (providerEventRefs[key] ?? 0) + 1;
  }
  return {
    authoringStatus: countBy(accepted.map((record) => record.authoringStatus ?? 'unknown')),
    suggestedPriority: countBy(
      accepted.map((record) => record.result?.suggestedPriority ?? 'unknown'),
    ),
    confidence: countBy(accepted.map((record) => record.result?.confidence ?? 'unknown')),
    warnings: countBy(accepted.flatMap((record) => record.proposalWarnings)),
    objectives: objectiveCounts,
    sevenPlusObjectives: accepted
      .filter((record) => record.objectiveCount >= 7)
      .map((record) => record.jobId)
      .sort(),
    domains: countBy(records.map((record) => record.domain)),
    focusStyles: countBy(records.map((record) => record.focusStyle || 'unknown')),
    mapDisposition: countBy(
      accepted.map((record) => record.result?.mapDisposition ?? 'unknown'),
    ),
    parentKind: countBy(
      records.map((record) => record.selection.parentKind ?? 'standalone'),
    ),
    sourceCounts: countBy(
      records.map((record) => {
        const n = record.sourceKeyCount;
        if (n >= 3) return '3+';
        if (n === 2) return '2';
        return '1';
      }),
    ),
    sizeBuckets: countBy(records.map((record) => record.sizeBucket || 'unknown')),
    provenance: countBy(records.map((record) => record.selection.provenance)),
    attemptsUsed,
    issueCodesAcrossAttempts,
    providerEventReferences: providerEventRefs,
  };
};

/* ------------------------------------------------------------------ *
 * Findings (spec pair rules; counted data, not audit errors)        *
 * ------------------------------------------------------------------ */

const buildFindings = (records: JobAuditRecord[]): UnitAuditFinding[] => {
  const findings = new Map<string, UnitAuditFinding>();
  const add = (code: string, note: string, jobId: string): void => {
    const existing = findings.get(code);
    if (existing) {
      existing.count += 1;
      existing.jobIds.push(jobId);
    } else findings.set(code, { code, count: 1, jobIds: [jobId], note });
  };
  for (const record of records) {
    const proposal = record.result;
    if (proposal === undefined) continue;
    const status = proposal.authoringStatus;
    const hasSuggestion = proposal.mapRevisionSuggestion !== undefined;
    const hasBroadWarning = proposal.warnings?.includes('MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT');
    if (status === 'needs-map-revision' && !hasSuggestion)
      add(
        'NEEDS_MAP_REVISION_WITHOUT_SUGGESTION',
        'authoringStatus needs-map-revision but mapRevisionSuggestion absent (spec pair rule).',
        record.jobId,
      );
    if (status === 'needs-map-revision' && !hasBroadWarning)
      add(
        'NEEDS_MAP_REVISION_WITHOUT_BROAD_WARNING',
        'authoringStatus needs-map-revision but MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT warning absent.',
        record.jobId,
      );
    if (status === 'generated' && hasSuggestion)
      add(
        'ADVISORY_MAP_REVISION_SUGGESTION_ON_GENERATED',
        'mapRevisionSuggestion present on a generated-status proposal (advisory; expected data).',
        record.jobId,
      );
  }
  return [...findings.values()]
    .map((finding) => ({ ...finding, jobIds: [...finding.jobIds].sort() }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
};

/* ------------------------------------------------------------------ *
 * Subsets                                                            *
 * ------------------------------------------------------------------ */

const finalQcParentsOf = (
  inputs: AuditLoadedInputs,
): { count: number; parents: FinalQcParent[] } => {
  const corrections = inputs.selection.jobs.filter((record) => record.correction);
  const byParent = new Map<string, FinalQcParent>();
  for (const record of corrections) {
    const existing = byParent.get(record.mapJobId);
    if (existing) {
      existing.unitJobIds.push(record.unitJobId);
      existing.count += 1;
      continue;
    }
    byParent.set(record.mapJobId, {
      parentId: record.mapJobId,
      mapJobId: record.mapJobId,
      documentTitle: record.documentTitle,
      sections: [...record.sections],
      unitJobIds: [record.unitJobId],
      count: 1,
    });
  }
  const parents = [...byParent.values()]
    .map((parent) => ({ ...parent, unitJobIds: [...parent.unitJobIds].sort() }))
    .sort((a, b) => (a.mapJobId < b.mapJobId ? -1 : a.mapJobId > b.mapJobId ? 1 : 0));
  return { count: corrections.length, parents };
};

const containsRepealedSubprovisionOf = (
  inputs: AuditLoadedInputs,
  records: JobAuditRecord[],
): { count: number; unitJobIds: string[] } => {
  const flagged: string[] = [];
  for (const record of records) {
    const job = inputs.jobsByJobId.get(record.jobId);
    const flags = job?.contentFlagsBySourceKey ?? {};
    const hit = Object.values(flags).some(
      (entry) => entry?.containsRepealedSubprovision === true,
    );
    if (hit) flagged.push(record.jobId);
  }
  return { count: flagged.length, unitJobIds: flagged.sort() };
};

/* ------------------------------------------------------------------ *
 * Audit document assembly                                           *
 * ------------------------------------------------------------------ */

const overlapsDiagnostics = (records: JobAuditRecord[]) => {
  const proposals = records
    .filter((record) => record.result !== undefined)
    .map((record) => record.result as AiStudyUnitProposal);
  const issues = detectAiUnitProposalOverlaps({
    proposals,
    existingUnits: [],
  }).filter((issue) => issue.code === 'PROPOSAL_SOURCE_OVERLAP');
  return {
    checked: proposals.length,
    sourceOverlaps: issues.length,
    jobsWithOverlap: sortedUnique(issues.map((issue) => issue.proposalId ?? '')),
  };
};

export const buildAuditDocs = (inputs: AuditLoadedInputs): AuditBundle => {
  const records = buildRecords(inputs);
  const gap = buildGap(inputs, records);
  const findings = buildFindings(records);
  const identityErrors = records.flatMap((record) => record.identityErrors);
  const accepted = records.filter((record) => record.status === 'accepted');
  const semanticFailed = records.filter((record) => record.status === 'semantic-failed');
  const providerIncomplete = records.filter((record) => record.status === 'provider-incomplete');
  const nothing = records.filter((record) => record.status === 'nothing');
  const fqc = finalQcParentsOf(inputs);

  // Integrity: any accepted result whose proposalId is not in the selection.
  const expectedIds = new Set(inputs.jobOrder);
  for (const jobId of [...inputs.resultsByProposalId.keys()].sort()) {
    if (!expectedIds.has(jobId))
      identityErrors.push({
        code: 'UNEXPECTED_RESULT_JOB',
        jobId,
        message: 'accepted result belongs to a job outside the frozen selection',
      });
  }

  const batchNumbers = sortedUnique(records.map((record) => String(record.batch))).sort(
    (a, b) => Number(a) - Number(b),
  );
  const perBatch = batchNumbers.map((batchKey) => {
    const batch = Number(batchKey);
    const batchRecords = records.filter((record) => record.batch === batch);
    return {
      batch,
      expected: batchRecords.length,
      accepted: batchRecords.filter((record) => record.status === 'accepted').length,
      semanticFailed: batchRecords.filter((record) => record.status === 'semantic-failed').length,
      providerIncomplete: batchRecords.filter(
        (record) => record.status === 'provider-incomplete',
      ).length,
      nothing: batchRecords.filter((record) => record.status === 'nothing').length,
    };
  });

  const audit: AuditDoc = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    kind: 'unit-calibration-result-audit',
    dateTag: AUDIT_DATE_TAG,
    runId: inputs.metadata.runId,
    generatedAt: AUDIT_GENERATED_AT,
    promptSpecVersion: inputs.metadata.promptSpecVersion,
    sourceMapRunId: inputs.selection.sourceMapRunId,
    inputs: {
      runDirPath: inputs.runDirPath,
      selectionReportPath: inputs.selectionReportPath,
      selectionReportSha256: inputs.selectionSha256,
      runJsonSha256: inputs.runJsonSha256,
      metadataSha256: inputs.metadataSha256,
      resultsJsonlSha256: inputs.resultsJsonlSha256,
      packageSha256: inputs.packageSha256,
      specSha256: inputs.specSha256,
      batchFiles: inputs.batchSha256,
      jobsFileSha256FromMetadata: inputs.metadata.jobsFileSha256,
      metadataJobIdsMatchSelection:
        JSON.stringify(inputs.metadata.jobIds) ===
        JSON.stringify(inputs.selection.jobs.map((record) => record.unitJobId)),
      metadataJobCount: inputs.metadata.jobCount,
      selectionJobCount: inputs.selection.jobs.length,
    },
    completion: {
      expected: records.length,
      accepted: accepted.length,
      semanticFailed: semanticFailed.length,
      providerIncomplete: providerIncomplete.length,
      nothing: nothing.length,
      perBatch,
    },
    gap,
    auditErrors: identityErrors,
    auditFindings: findings,
    identity: {
      checkedProposals: accepted.length,
      errors: identityErrors,
      suggestedPriorityMatches: accepted.filter(
        (record) => record.result?.suggestedPriority === record.frozenPriority,
      ).length,
      suggestedPriorityMismatches: identityErrors.filter(
        (error) => error.code === 'SUGGESTED_PRIORITY_MISMATCH',
      ),
    },
    validation: buildValidationSummary(records),
    overlaps: overlapsDiagnostics(records),
    distributions: buildDistributions(inputs, records),
    perJob: records.map((record) => ({
      jobId: record.jobId,
      batch: record.batch,
      runIndex: record.runIndex,
      status: record.status,
      priority: record.frozenPriority,
      authoringStatus: record.authoringStatus,
      suggestedPriority: record.result?.suggestedPriority ?? null,
      objectiveCount: record.objectiveCount,
      validationStatus: record.validation.status,
      issueCodes: [...record.validation.issueCodes].sort(),
      rejectedSemanticAttempts: record.rejectedSemanticAttempts,
      attemptsUsed: record.attemptsUsed,
      providerEventCount: record.providerEventCount,
      identityErrorCount: record.identityErrors.length,
    })),
    subsets: {
      finalQc: {
        count: fqc.count,
        parents: fqc.parents,
        unitJobIds: [...fqc.parents.flatMap((parent) => parent.unitJobIds)].sort(),
      },
      regressionAnchors: {
        count: inputs.selection.anchorTargetCoverage.length,
        rows: inputs.selection.anchorTargetCoverage.map((entry) => {
          const outcome: UnitJobOutcomeStatus = entry.unitJobId
            ? (records.find((record) => record.jobId === entry.unitJobId)?.status ?? 'nothing')
            : 'nothing';
          return {
            targetId: entry.targetId,
            unitJobId: entry.unitJobId ?? '',
            note: entry.note,
            outcome,
          };
        }),
      },
      retryNine: {
        count: inputs.selection.retryTargetCoverage.length,
        rows: inputs.selection.retryTargetCoverage.map((entry) => {
          const outcome: UnitJobOutcomeStatus = entry.unitJobId
            ? (records.find((record) => record.jobId === entry.unitJobId)?.status ?? 'nothing')
            : 'nothing';
          return {
            targetId: entry.targetId,
            unitJobId: entry.unitJobId ?? '',
            note: entry.note,
            outcome,
          };
        }),
      },
      containsRepealedSubprovision: containsRepealedSubprovisionOf(inputs, records),
    },
  };

  const review = buildReviewDoc(inputs, records);
  const regressionAnchors = buildRegressionAnchorsDoc(inputs, records);
  const finalQc = buildFinalQcDoc(inputs, records, fqc.parents);
  return { audit, review, regressionAnchors, finalQc, records };
};

export type { UnitAuditError };
