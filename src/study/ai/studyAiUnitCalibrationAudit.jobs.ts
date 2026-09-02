/**
 * Per-job outcome records for the calibration-80 audit.
 *
 * Turns the loaded run inputs into one `JobAuditRecord` per selected job:
 * outcome classification (accepted | semantic-failed | provider-incomplete |
 * nothing), runner identity checks (proposalId/jobId bijection, runId,
 * corpusContentHash, sourceDocumentId, sourceKeys/sourceHashes echo,
 * generationMetadata echo, suggestedPriority vs frozenMapPriority) and the
 * canonical validator re-run for accepted proposals. Pure + deterministic;
 * the canonical ordering is jobId ascending.
 */
import { sourceComponentsForProposal } from './studyAiUnitSourceComponents';
import { classifyDomainByDocumentTitle } from './studyAiUnitCalibrationFeatures';
import { validateAiStudyUnitProposal } from './studyAiValidation';
import type { AiStudyUnitProposal, AiUnitAuthoringJob } from './studyAiTypes';
import type {
  AuditLoadedInputs,
  CalibrationSelectionDoc,
  JobAuditRecord,
  UnitAttemptRecord,
  UnitAuditError,
  UnitJobOutcomeStatus,
  UnitValidationRun,
} from './studyAiUnitCalibrationAudit.types';
import { coverageFlagsOf, sortedUnique } from './studyAiUnitCalibrationAudit.utils';

/* ------------------------------------------------------------------ *
 * Canonical validator re-run                                        *
 * ------------------------------------------------------------------ */

/** Byte-identical to `commandValidateUnitProposals` in scripts/studyAiAuthoring.ts. */
const revalidateProposal = (
  inputs: AuditLoadedInputs,
  proposal: AiStudyUnitProposal,
): UnitValidationRun => {
  try {
    const sourceComponents = sourceComponentsForProposal(
      inputs.package,
      proposal.sourceDocumentId,
      proposal.sourceKeys,
    );
    const report = validateAiStudyUnitProposal({
      proposal,
      sourceComponents,
      corpusContentHash: proposal.corpusContentHash,
    });
    const errors = report.issues.filter((issue) => issue.severity === 'error');
    const warnings = report.issues.filter((issue) => issue.severity === 'warning');
    return {
      status: errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warnings' : 'valid',
      issueCodes: report.issues.map((issue) => issue.code),
      issueCount: report.issues.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    };
  } catch {
    return {
      status: 'invalid',
      issueCodes: ['PROPOSAL_VALIDATION_CRASH'],
      issueCount: 1,
      errorCount: 1,
      warningCount: 0,
    };
  }
};

/* ------------------------------------------------------------------ *
 * Identity checks (hard audit errors)                               *
 * ------------------------------------------------------------------ */

const groupSourceHashesOf = (job: AiUnitAuthoringJob): Record<string, string> => {
  const approved = new Set(job.approvedGroup.sourceKeys);
  return Object.fromEntries(
    Object.entries(job.sourceHashes ?? {}).filter(([key]) => approved.has(key)),
  );
};

const sameSet = (left: string[], right: string[]): boolean => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return JSON.stringify(a) === JSON.stringify(b);
};

const identityErrorsFor = (
  inputs: AuditLoadedInputs,
  job: AiUnitAuthoringJob,
  proposal: AiStudyUnitProposal,
): UnitAuditError[] => {
  const errors: UnitAuditError[] = [];
  const fail = (code: string, message: string): void => {
    errors.push({ code, jobId: job.jobId, message });
  };
  if (proposal.proposalId !== job.jobId)
    fail('PROPOSAL_ID_MISMATCH', `proposalId ${proposal.proposalId} !== jobId ${job.jobId}`);
  if (proposal.runId !== inputs.metadata.runId)
    fail('RUN_ID_MISMATCH', `runId ${proposal.runId} !== ${inputs.metadata.runId}`);
  if (proposal.corpusContentHash !== job.corpusContentHash)
    fail('CORPUS_CONTENT_HASH_MISMATCH', 'proposal corpusContentHash differs from job');
  if (proposal.sourceDocumentId !== job.document.documentId)
    fail('DOCUMENT_MISMATCH', `proposal sourceDocumentId ${proposal.sourceDocumentId} !== ${job.document.documentId}`);
  if (!sameSet(proposal.sourceKeys, job.approvedGroup.sourceKeys))
    fail('SOURCE_KEYS_MISMATCH', 'proposal sourceKeys differ from approved group');
  const expected = groupSourceHashesOf(job);
  const actual = proposal.sourceHashes ?? {};
  const allKeys = sortedUnique([...Object.keys(expected), ...Object.keys(actual)]);
  const hashDiff = allKeys.some((key) => expected[key] !== actual[key]);
  if (hashDiff)
    fail('SOURCE_HASHES_MISMATCH', 'proposal sourceHashes differ from job group source hashes');
  const meta = proposal.generationMetadata;
  if (meta.sourceJobId !== job.jobId)
    fail('GEN_SOURCE_JOB_ID_MISMATCH', `generationMetadata.sourceJobId ${String(meta.sourceJobId)} !== jobId`);
  if (meta.sourceJobInputHash !== job.inputHash)
    fail('GEN_INPUT_HASH_MISMATCH', 'generationMetadata.sourceJobInputHash differs from job.inputHash');
  if (meta.promptSpecVersion !== inputs.metadata.promptSpecVersion)
    fail('GEN_PROMPT_SPEC_MISMATCH', 'generationMetadata.promptSpecVersion differs from run metadata');
  if (meta.providerKind !== 'local-openai-compatible')
    fail('GEN_PROVIDER_KIND_MISMATCH', `generationMetadata.providerKind ${String(meta.providerKind)}`);
  if (proposal.suggestedPriority !== job.frozenMapPriority)
    fail(
      'SUGGESTED_PRIORITY_MISMATCH',
      `suggestedPriority ${String(proposal.suggestedPriority)} !== frozenMapPriority ${String(job.frozenMapPriority)}`,
    );
  return errors;
};

/* ------------------------------------------------------------------ *
 * Per-job outcome records                                           *
 * ------------------------------------------------------------------ */

const selectionRecordOf = (
  selection: CalibrationSelectionDoc,
  jobId: string,
): CalibrationSelectionDoc['jobs'][number] | undefined =>
  selection.jobs.find((record) => record.unitJobId === jobId);

const statusOf = (
  result: AiStudyUnitProposal | undefined,
  attempts: UnitAttemptRecord[],
): UnitJobOutcomeStatus => {
  if (result !== undefined) return 'accepted';
  if (attempts.some((attempt) => attempt.kind === 'semantic')) return 'semantic-failed';
  if (attempts.length > 0) return 'provider-incomplete';
  return 'nothing';
};

const semanticFailures = (attempts: UnitAttemptRecord[]): number =>
  attempts.filter((attempt) => attempt.kind === 'semantic').length;

const buildJobRecord = (
  inputs: AuditLoadedInputs,
  jobId: string,
  runIndex: number,
  batch: number,
): JobAuditRecord => {
  const selection = selectionRecordOf(inputs.selection, jobId);
  const job = inputs.jobsByJobId.get(jobId);
  const result = inputs.resultsByProposalId.get(jobId);
  const attempts = (inputs.attemptsByJobId.get(jobId) ?? []).sort(
    (a, b) => a.attempt - b.attempt,
  );
  const status = statusOf(result, attempts);
  const record: JobAuditRecord = {
    jobId,
    batch,
    runIndex,
    status,
    frozenPriority: job?.frozenMapPriority ?? selection?.priority ?? null,
    selection: {
      correction: selection?.correction ?? false,
      retry: selection?.retry ?? false,
      regression: selection?.regression ?? false,
      pin: (selection?.selectionReason ?? '') === 'pin',
      selectionReason: selection?.selectionReason ?? 'unknown',
      anchorTargetId: selection?.anchorTargetId,
      retryTargetId: selection?.retryTargetId,
      tags: selection?.tags ?? [],
      provenance: selection?.provenance ?? 'unknown',
      parentKind: selection?.parentKind ?? undefined,
    },
    domain: selection?.domain ?? (job ? classifyDomainByDocumentTitle(job.document.title) : 'unknown'),
    sourceKeyCount: job?.approvedGroup.sourceKeys.length ?? result?.sourceKeys.length ?? 0,
    sizeBucket: selection?.sizeBucket ?? '',
    focusStyle: selection?.focusStyle ?? 'unknown',
    result,
    provenance: inputs.provenanceByJobId.get(jobId),
    attempts,
    attemptsUsed: status === 'accepted' ? semanticFailures(attempts) + 1 : attempts.length,
    rejectedSemanticAttempts: semanticFailures(attempts),
    providerAttempts: attempts.filter((attempt) => attempt.kind === 'provider').length,
    providerEventCount: inputs.providerEvents.filter((event) => event.jobId === jobId).length,
    identityErrors: [],
    validation: {
      status: 'not-revalidated',
      issueCodes: [],
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
    },
    proposalWarnings: result?.warnings ?? [],
    objectiveCount: result?.objectives?.length ?? 0,
    authoringStatus: result?.authoringStatus ?? null,
    hasMapRevisionSuggestion: result?.mapRevisionSuggestion !== undefined,
    coverageFlags: coverageFlagsOf(result),
  };
  if (status === 'accepted' && result !== undefined) {
    record.validation = revalidateProposal(inputs, result);
    if (job === undefined)
      record.identityErrors.push({
        code: 'JOB_PAYLOAD_MISSING',
        jobId,
        message: 'accepted result has no matching run job payload',
      });
    else record.identityErrors = identityErrorsFor(inputs, job, result);
  }
  return record;
};

/**
 * One record per selected job, ordered by jobId ascending. Uses the run's
 * batch-file order for the run index and appends any selection jobs missing
 * from the batch files so every frozen selection job is accounted once.
 */
export const buildRecords = (inputs: AuditLoadedInputs): JobAuditRecord[] => {
  const byBatch = inputs.batchByJobId;
  const records: JobAuditRecord[] = [];
  const seen = new Set<string>();
  inputs.jobOrder.forEach((jobId, runIndex) => {
    records.push(buildJobRecord(inputs, jobId, runIndex, byBatch.get(jobId) ?? 0));
    seen.add(jobId);
  });
  for (const jobId of inputs.selection.jobs.map((record) => record.unitJobId).sort()) {
    if (seen.has(jobId)) continue;
    records.push(buildJobRecord(inputs, jobId, records.length, 0));
  }
  return records.sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
};
