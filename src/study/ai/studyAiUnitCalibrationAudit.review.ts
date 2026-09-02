/**
 * Human-review and companion documents for the calibration-80 audit.
 *
 * Pure builders over the loaded inputs + per-job records: the risk-ordered
 * human review doc (every selected unit once, category then jobId), the
 * regression-anchors companion (the 7 frozen anchor targets resolved to unit
 * jobIds) and the final-QC companion (the 20 correction units grouped under
 * their 8 correction parents). No IO, no wall clock, no RNG.
 */
import type {
  AuditLoadedInputs,
  CalibrationSelectionDoc,
  FinalQcDoc,
  FinalQcParent,
  JobAuditRecord,
  RegressionAnchorsDoc,
  ReviewDoc,
  ReviewSourceContext,
  ReviewUnitEntry,
  UnitJobOutcomeStatus,
} from './studyAiUnitCalibrationAudit.types';
import {
  AUDIT_DATE_TAG,
  AUDIT_GENERATED_AT,
  AUDIT_SCHEMA_VERSION,
} from './studyAiUnitCalibrationAudit.types';
import { countBy, riskCategoryFor, riskReasonFor } from './studyAiUnitCalibrationAudit.utils';

/* ------------------------------------------------------------------ *
 * Risk ordering                                                     *
 * ------------------------------------------------------------------ */

const riskOf = (
  record: JobAuditRecord,
  anchorIds: Set<string>,
  retryIds: Set<string>,
): { categoryIndex: ReviewUnitEntry['categoryIndex']; categoryLabel: string; categoryReason: string } => {
  const risk = riskCategoryFor(record, {
    inAnchorTargets: anchorIds.has(record.jobId),
    inRetryTargets: retryIds.has(record.jobId),
  });
  return {
    categoryIndex: risk.index,
    categoryLabel: risk.label,
    categoryReason: riskReasonFor(record, risk),
  };
};

/* ------------------------------------------------------------------ *
 * Human review doc                                                  *
 * ------------------------------------------------------------------ */

const selectionRecordOf = (
  selection: CalibrationSelectionDoc,
  jobId: string,
): CalibrationSelectionDoc['jobs'][number] | undefined =>
  selection.jobs.find((record) => record.unitJobId === jobId);

const sourceContextOf = (
  inputs: AuditLoadedInputs,
  record: JobAuditRecord,
): ReviewSourceContext => {
  const job = inputs.jobsByJobId.get(record.jobId);
  const selection = selectionRecordOf(inputs.selection, record.jobId);
  const approved = job?.approvedGroup;
  const exactText = job?.exactSourceText ?? '';
  const operativeText = job?.operativeSourceText ?? '';
  const flags = job?.contentFlagsBySourceKey ?? {};
  const containsRepealed = Object.values(flags).some(
    (entry) => entry?.containsRepealedSubprovision === true,
  );
  const statuses = Object.values(job?.sourceStatuses ?? {});
  const mixedLive = statuses.includes('current') &&
    (statuses.includes('repealed') || statuses.includes('historical'));
  return {
    documentTitle: selection?.documentTitle ?? job?.document.title ?? 'unknown',
    documentId: job?.document.documentId ?? null,
    sections: selection?.sections ?? [],
    groupTitle: approved?.titleSuggestion ?? '',
    groupGoal: approved?.approximateLearningGoal ?? '',
    sourceKeys: approved?.sourceKeys ?? record.result?.sourceKeys ?? [],
    focus: (approved?.focusSelections ?? []).map((focus) => ({
      sourceKey: focus.sourceKey,
      childLabels: [...(focus.childLabels ?? [])],
    })),
    exactSourceTextLength: exactText ? exactText.length : null,
    operativeSourceTextLength: operativeText ? operativeText.length : null,
    exactSourcePreview: exactText
      ? `${exactText.slice(0, 140)}${exactText.length > 140 ? '…' : ''}`
      : '',
    containsRepealedSubprovision: containsRepealed,
    mixedLiveRepealed: mixedLive,
    tags: [...(selection?.tags ?? [])],
  };
};

const reviewUnitOf = (
  inputs: AuditLoadedInputs,
  record: JobAuditRecord,
  risk: { categoryIndex: ReviewUnitEntry['categoryIndex']; categoryLabel: string; categoryReason: string },
): Omit<ReviewUnitEntry, 'rank'> => {
  const proposal = record.result;
  const provenance = record.provenance;
  const objectives = (proposal?.objectives ?? []).map((objective) => ({
    id: objective.id,
    type: objective.type,
    objective: objective.objective,
    evidenceCount: objective.evidence?.length ?? 0,
    confidence: objective.confidence,
    sourceKeys: [...(objective.sourceKeys ?? [])],
    evidence: (objective.evidence ?? []).map((evidence) => ({
      sourceKey: evidence.sourceKey,
      evidenceText: evidence.evidenceText,
    })),
  }));
  return {
    categoryIndex: risk.categoryIndex,
    categoryLabel: risk.categoryLabel,
    categoryReason: risk.categoryReason,
    jobId: record.jobId,
    batch: record.batch,
    runIndex: record.runIndex,
    status: record.status,
    domain: record.domain,
    sourceContext: sourceContextOf(inputs, record),
    generated:
      proposal === undefined
        ? null
        : {
            title: proposal.title,
            mainQuestion: proposal.mainQuestion,
            studySummary: proposal.studySummary,
            objectives,
            objectiveCount: proposal.objectives?.length ?? 0,
            confidence: proposal.confidence,
            warnings: [...(proposal.warnings ?? [])],
            authoringStatus: proposal.authoringStatus ?? null,
            mapRevisionSuggestion: {
              present: proposal.mapRevisionSuggestion !== undefined,
              reason: proposal.mapRevisionSuggestion?.reason ?? '',
              proposedGroupCount: proposal.mapRevisionSuggestion?.proposedGroups?.length ?? 0,
            },
          },
    validation: {
      status: record.validation.status,
      issueCodes: [...record.validation.issueCodes].sort(),
      issueCount: record.validation.issueCount,
      errorCount: record.validation.errorCount,
      warningCount: record.validation.warningCount,
    },
    attempts: {
      attemptsUsed: record.attemptsUsed,
      rejectedSemanticAttempts: record.rejectedSemanticAttempts,
      providerAttempts: record.providerAttempts,
      providerEventCount: record.providerEventCount,
      perAttempt: record.attempts.map((attempt) => ({
        attempt: attempt.attempt,
        kind: attempt.kind,
        issueCodes: [...attempt.issueCodes].sort(),
        issues: attempt.issues.map((issue) => ({ code: issue.code, message: issue.message })),
        timestamp: attempt.timestamp ?? null,
      })),
    },
    provenance:
      provenance === undefined
        ? null
        : {
            modelId: provenance.modelId ?? null,
            attempt: provenance.attempt ?? null,
            structuredOutputMode: provenance.structuredOutputMode ?? null,
            timestamp: provenance.timestamp ?? null,
            rawHash: provenance.rawHash ?? null,
            sourceJobInputHash: provenance.sourceJobInputHash ?? null,
          },
    identityErrors: [...record.identityErrors],
  };
};

const anchorTargetIds = (inputs: AuditLoadedInputs): Set<string> =>
  new Set(
    inputs.selection.anchorTargetCoverage
      .map((entry) => entry.unitJobId)
      .filter((id): id is string => id !== null),
  );

const retryTargetIds = (inputs: AuditLoadedInputs): Set<string> =>
  new Set(
    inputs.selection.retryTargetCoverage
      .map((entry) => entry.unitJobId)
      .filter((id): id is string => id !== null),
  );

/** Risk-ordered review doc: category index asc, then jobId asc (stable). */
export const buildReviewDoc = (
  inputs: AuditLoadedInputs,
  records: JobAuditRecord[],
): ReviewDoc => {
  const anchorIds = anchorTargetIds(inputs);
  const retryIds = retryTargetIds(inputs);
  const entries = records.map((record) => {
    const risk = riskOf(record, anchorIds, retryIds);
    return reviewUnitOf(inputs, record, risk);
  });
  const ordered = [...entries].sort(
    (a, b) =>
      a.categoryIndex - b.categoryIndex || (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0),
  );
  const ranked = ordered.map((unit, index) => ({ ...unit, rank: index + 1 }));
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    kind: 'unit-calibration-human-review',
    dateTag: AUDIT_DATE_TAG,
    runId: inputs.metadata.runId,
    generatedAt: AUDIT_GENERATED_AT,
    promptSpecVersion: inputs.metadata.promptSpecVersion,
    total: ranked.length,
    categoryCounts: countBy(ranked.map((unit) => String(unit.categoryIndex))),
    units: ranked,
  };
};

/* ------------------------------------------------------------------ *
 * Regression anchors + final QC companion docs                      *
 * ------------------------------------------------------------------ */

const outcomeOf = (records: JobAuditRecord[], jobId: string | null): UnitJobOutcomeStatus =>
  jobId ? (records.find((record) => record.jobId === jobId)?.status ?? 'nothing') : 'nothing';

export const buildRegressionAnchorsDoc = (
  inputs: AuditLoadedInputs,
  records: JobAuditRecord[],
): RegressionAnchorsDoc => ({
  schemaVersion: AUDIT_SCHEMA_VERSION,
  kind: 'unit-calibration-regression-anchors',
  dateTag: AUDIT_DATE_TAG,
  runId: inputs.metadata.runId,
  generatedAt: AUDIT_GENERATED_AT,
  total: inputs.selection.anchorTargetCoverage.length,
  anchors: inputs.selection.anchorTargetCoverage.map((entry) => {
    const record = entry.unitJobId
      ? records.find((candidate) => candidate.jobId === entry.unitJobId)
      : undefined;
    return {
      targetId: entry.targetId,
      unitJobId: entry.unitJobId ?? null,
      resolved: entry.unitJobId !== null,
      outcome: outcomeOf(records, entry.unitJobId),
      priority: record?.frozenPriority ?? null,
      authoringStatus: record?.authoringStatus ?? null,
      warnings: record?.proposalWarnings ?? [],
      objectiveCount: record?.objectiveCount ?? 0,
      title: record?.result?.title ?? '',
    };
  }),
});

export const buildFinalQcDoc = (
  inputs: AuditLoadedInputs,
  records: JobAuditRecord[],
  parents: FinalQcParent[],
): FinalQcDoc => ({
  schemaVersion: AUDIT_SCHEMA_VERSION,
  kind: 'unit-calibration-final-qc',
  dateTag: AUDIT_DATE_TAG,
  runId: inputs.metadata.runId,
  generatedAt: AUDIT_GENERATED_AT,
  total: parents.reduce((total, parent) => total + parent.count, 0),
  parents: parents.map((parent) => ({
    parentId: parent.parentId,
    mapJobId: parent.mapJobId,
    documentTitle: parent.documentTitle,
    sections: [...parent.sections],
    count: parent.count,
    units: parent.unitJobIds
      .map((jobId) => {
        const record = records.find((candidate) => candidate.jobId === jobId);
        if (!record) return null;
        return {
          jobId,
          status: record.status,
          authoringStatus: record.authoringStatus,
          suggestedPriority: record.frozenPriority,
          warnings: record.proposalWarnings,
          objectiveCount: record.objectiveCount,
          title: record.result?.title ?? '',
          oneLineSummary: record.result?.studySummary ?? '',
        };
      })
      .filter((unit): unit is NonNullable<typeof unit> => unit !== null),
  })),
});
