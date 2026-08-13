import { createHash } from 'node:crypto';
import type { NbLawContentPackage, NbLawDocumentComponent } from '../src/study/content/nbLawTypes';
import type {
  AiConfidence,
  AiStudyDisposition,
  AiStudyMapJob,
  AiStudyMapProposal,
  AiStudyMapResult,
  AiValidationIssue,
} from '../src/study/ai/studyAiTypes';

export type MapBatchPolicy = {
  maxJobsPerBatch: number;
  maxInputCharactersPerBatch: number;
};

export type MapBatch = {
  batchNumber: number;
  jobs: AiStudyMapJob[];
  estimatedInputCharacters: number;
  oversized: boolean;
};

export type MapRunStatus = {
  runId: string;
  expectedJobs: number;
  resultLines: number;
  completed: number;
  missing: number;
  malformed: number;
  stale: number;
  duplicate: number;
  invalid: number;
};

export const FULL_CORPUS_STRATEGY_VERSION = 'full-corpus-v1-size-batched';

export const DEFAULT_FULL_CORPUS_BATCH_POLICY: MapBatchPolicy = {
  maxJobsPerBatch: 18,
  maxInputCharactersPerBatch: 120_000,
};

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

const countBy = <T extends string>(values: T[]): Record<T, number> =>
  values.reduce<Record<T, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);

const documentKind = (documentType: string): 'act' | 'regulation' | 'bylaw' =>
  documentType === 'regulation' ? 'regulation' : documentType === 'bylaw' ? 'bylaw' : 'act';

const isDefinitionsComponent = (component: NbLawDocumentComponent): boolean =>
  /\bdefinitions?\b/i.test(`${component.label} ${component.heading ?? ''}`) || /["“][^"”]+["”]\s+means\b/i.test(component.text);

const exclusionReason = (component: NbLawDocumentComponent): string | undefined => {
  if (component.componentType === 'section') return undefined;
  if (component.componentType === 'schedule') return 'schedule-or-form-excluded-from-map-reasoning';
  return `${component.componentType}-excluded-from-map-reasoning`;
};

const estimatedJobInputCharacters = (job: AiStudyMapJob): number =>
  job.target.exactSourceText.length +
  job.target.operativeSourceText.length +
  (job.context.previous?.text.length ?? 0) +
  (job.context.next?.text.length ?? 0) +
  (job.context.relevantDefinitions ?? []).reduce((sum, context) => sum + context.text.length, 0) +
  (job.context.directlyReferencedProvisions ?? []).reduce((sum, context) => sum + context.text.length, 0);

export const batchMapJobsByEstimatedSize = (
  jobs: AiStudyMapJob[],
  policy: MapBatchPolicy = DEFAULT_FULL_CORPUS_BATCH_POLICY,
): MapBatch[] => {
  const batches: MapBatch[] = [];
  let current: AiStudyMapJob[] = [];
  let currentSize = 0;
  const flush = () => {
    if (current.length === 0) return;
    batches.push({
      batchNumber: batches.length + 1,
      jobs: current,
      estimatedInputCharacters: currentSize,
      oversized: false,
    });
    current = [];
    currentSize = 0;
  };
  jobs.forEach((job) => {
    const jobSize = estimatedJobInputCharacters(job);
    if (jobSize > policy.maxInputCharactersPerBatch) {
      flush();
      batches.push({
        batchNumber: batches.length + 1,
        jobs: [job],
        estimatedInputCharacters: jobSize,
        oversized: true,
      });
      return;
    }
    if (
      current.length >= policy.maxJobsPerBatch ||
      (current.length > 0 && currentSize + jobSize > policy.maxInputCharactersPerBatch)
    ) {
      flush();
    }
    current.push(job);
    currentSize += jobSize;
  });
  flush();
  return batches;
};

export const buildCorpusInventoryReport = (pkg: NbLawContentPackage, jobs: AiStudyMapJob[]) => {
  const excluded = pkg.documents.flatMap((document) =>
    document.components.flatMap((component) => {
      const reason = exclusionReason(component);
      return reason
        ? [{
            documentId: document.id,
            documentType: documentKind(document.documentType),
            sourceKey: component.sourceKey,
            label: component.label,
            componentType: component.componentType,
            reason,
            characters: component.text.length,
          }]
        : [];
    }),
  );
  const components = pkg.documents.flatMap((document) =>
    document.components.map((component) => ({
      documentId: document.id,
      documentType: documentKind(document.documentType),
      componentType: component.componentType,
      sourceKey: component.sourceKey,
      label: component.label,
      heading: component.heading,
      characters: component.text.length,
      definitions: isDefinitionsComponent(component),
    })),
  );
  const jobsByDocument = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.document.documentId] = (acc[job.document.documentId] ?? 0) + 1;
    return acc;
  }, {});
  const jobsByType = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.document.type] = (acc[job.document.type] ?? 0) + 1;
    return acc;
  }, {});
  return {
    schemaVersion: 1,
    packageId: pkg.id,
    manifestId: pkg.manifestId,
    corpusContentHash: hashText(JSON.stringify(pkg.sourceHashes)),
    legalDocuments: pkg.documents.length,
    documentTypes: countBy(pkg.documents.map((document) => documentKind(document.documentType))),
    totalSourceComponents: components.length,
    totalEligibleMapJobs: jobs.length,
    totalExcludedComponents: excluded.length,
    exclusionsByReason: countBy(excluded.map((entry) => entry.reason)),
    jobsByDocument,
    jobsByType,
    componentTypes: countBy(components.map((entry) => entry.componentType)),
    sections: components.filter((component) => component.componentType === 'section').length,
    subsections: pkg.documents.reduce(
      (sum, document) =>
        sum +
        document.components.reduce(
          (inner, component) =>
            inner + ('subsections' in component ? (component.subsections?.length ?? 0) : 0),
          0,
        ),
      0,
    ),
    definitionSections: components.filter((component) => component.componentType === 'section' && component.definitions).length,
    schedulesAndForms: components.filter((component) => component.componentType !== 'section').length,
    administrativeOrNonSubstantiveSections: jobs.filter((job) =>
      job.target.contentFlags?.citationOnly ||
      job.target.contentFlags?.commencementOnly ||
      job.target.contentFlags?.repealOnly,
    ).length,
    totalSourceCharacters: components.reduce((sum, component) => sum + component.characters, 0),
    largestJobsBySourceSize: jobs
      .map((job) => ({
        jobId: job.jobId,
        documentId: job.document.documentId,
        sourceKey: job.target.sourceKeys[0],
        label: job.target.sectionLabels[0],
        heading: job.target.heading,
        exactCharacters: job.target.approximateInputSize.exactCharacters,
        estimatedInputCharacters: estimatedJobInputCharacters(job),
      }))
      .sort((left, right) => right.estimatedInputCharacters - left.estimatedInputCharacters)
      .slice(0, 25),
    excludedComponents: excluded,
  };
};

export const buildBatchManifest = (batches: MapBatch[], policy: MapBatchPolicy) => ({
  schemaVersion: 1,
  strategyVersion: FULL_CORPUS_STRATEGY_VERSION,
  policy,
  batchCount: batches.length,
  totalJobs: batches.reduce((sum, batch) => sum + batch.jobs.length, 0),
  oversizedBatchCount: batches.filter((batch) => batch.oversized).length,
  batches: batches.map((batch) => ({
    batchNumber: batch.batchNumber,
    file: `batch-${String(batch.batchNumber).padStart(3, '0')}.jobs.jsonl`,
    jobs: batch.jobs.length,
    estimatedInputCharacters: batch.estimatedInputCharacters,
    oversized: batch.oversized,
    jobIds: batch.jobs.map((job) => job.jobId),
  })),
});

export const buildRunStatusReport = ({
  runId,
  jobs,
  results,
  malformed,
  invalidJobIds,
  staleJobIds,
}: {
  runId: string;
  jobs: AiStudyMapJob[];
  results: AiStudyMapResult[];
  malformed: unknown[];
  invalidJobIds: string[];
  staleJobIds: string[];
}): MapRunStatus => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  results.forEach((result) => {
    if (seen.has(result.jobId)) duplicates.add(result.jobId);
    seen.add(result.jobId);
  });
  const completed = new Set(
    results
      .map((result) => result.jobId)
      .filter((jobId) => jobs.some((job) => job.jobId === jobId) && !invalidJobIds.includes(jobId) && !staleJobIds.includes(jobId)),
  );
  return {
    runId,
    expectedJobs: jobs.length,
    resultLines: results.length,
    completed: completed.size,
    missing: jobs.length - completed.size,
    malformed: malformed.length,
    stale: new Set(staleJobIds).size,
    duplicate: duplicates.size,
    invalid: new Set(invalidJobIds).size,
  };
};

const proposalStatus = (proposal: AiStudyMapProposal): 'valid' | 'warning-valid' | 'invalid' => {
  if (proposal.validationStatus === 'invalid') return 'invalid';
  if (proposal.validationStatus === 'warnings' || proposal.conflictCodes.length > 0 || proposal.warnings.length > 0) {
    return 'warning-valid';
  }
  return 'valid';
};

const issueCountByCode = (issues: AiValidationIssue[]): Record<string, number> =>
  countBy(issues.map((issue) => issue.code));

export const buildMapValidationReport = ({
  runId,
  status,
  proposals,
  issues,
}: {
  runId: string;
  status: MapRunStatus;
  proposals: AiStudyMapProposal[];
  issues: AiValidationIssue[];
}) => ({
  schemaVersion: 1,
  runId,
  status,
  proposalStatusCounts: countBy(proposals.map(proposalStatus)),
  dispositionCounts: countBy(proposals.map((proposal) => proposal.disposition)),
  confidenceCounts: countBy(proposals.map((proposal) => proposal.confidence)),
  conflictCounts: countBy(proposals.flatMap((proposal) => proposal.conflictCodes)),
  validationIssueCounts: issueCountByCode(issues),
  groundingWarnings: issues.filter((issue) => /GROUND|EVIDENCE|FOCUS|SOURCE|HASH|LEAKAGE|TERM|CHILD/.test(issue.code)).length,
  contextLeakage: issues.filter((issue) => /LEAKAGE|CONTEXT|OUTSIDE/.test(issue.code)).length,
  definedTermGroundingFailures: issues.filter((issue) => issue.code === 'DEFINED_TERM_NOT_IN_FOCUS_SOURCE').length,
  childLabelGroundingFailures: issues.filter((issue) => issue.code.includes('CHILD_LABEL')).length,
  evidenceGroundingFailures: issues.filter((issue) => issue.code.includes('EVIDENCE')).length,
  sourceHashFailures: issues.filter((issue) => issue.code.includes('HASH')).length,
});

const focusSize = (proposal: AiStudyMapProposal): number =>
  proposal.proposedGroups.reduce(
    (sum, group) =>
      sum +
      group.focusSelections.reduce(
        (inner, selection) =>
          inner +
          (selection.childLabels?.length ?? 0) +
          (selection.definedTerms?.length ?? 0) +
          (selection.evidenceText?.length ?? 0),
        0,
      ),
    0,
  );

const broadRiskCodes = (proposal: AiStudyMapProposal): string[] => {
  const codes: string[] = [];
  if (focusSize(proposal) >= 10) codes.push('LARGE_FOCUS_SELECTION_COUNT');
  if ((proposal.operativeSourceText?.length ?? 0) >= 8_000) codes.push('LARGE_SOURCE_CHARACTER_SPAN');
  if (proposal.proposedGroups.some((group) => group.sourceKeys.length >= 4)) codes.push('MANY_SOURCE_KEYS_IN_GROUP');
  const text = `${proposal.reason} ${proposal.proposedGroups.map((group) => `${group.titleSuggestion} ${group.approximateLearningGoal}`).join(' ')}`;
  const modalities = ['shall', 'may', 'shall not', 'must', 'deemed'].filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
  if (modalities.length >= 3) codes.push('MANY_MODALITY_SIGNALS');
  if (proposal.proposedGroups.length >= 5) codes.push('MANY_PROPOSED_GROUPS');
  return codes;
};

export const buildCoverageAuditReport = (pkg: NbLawContentPackage, jobs: AiStudyMapJob[], proposals: AiStudyMapProposal[]) => {
  const proposalByJob = new Map(proposals.map((proposal) => [proposal.jobId, proposal]));
  const jobSourceKeys = new Set(
    jobs.flatMap((job) => job.target.sourceKeys.map((sourceKey) => `${job.document.documentId}::${sourceKey}`)),
  );
  const disposedSourceKeys = new Set(
    proposals.flatMap((proposal) =>
      proposal.targetSourceKeys.map((sourceKey) => `${proposal.document.documentId}::${sourceKey}`),
    ),
  );
  const groupFocusKeys = proposals.flatMap((proposal) =>
    proposal.proposedGroups.flatMap((group) =>
      group.focusSelections.map((selection) => `${proposal.document.documentId}::${selection.sourceKey}::${JSON.stringify(selection)}`),
    ),
  );
  const duplicateFocusGroups = Array.from(
    groupFocusKeys.reduce<Map<string, number>>((acc, key) => acc.set(key, (acc.get(key) ?? 0) + 1), new Map()),
  ).filter(([, count]) => count > 1);
  const documents = pkg.documents.map((document) => {
    const documentJobs = jobs.filter((job) => job.document.documentId === document.id);
    const documentProposals = documentJobs.flatMap((job) => {
      const proposal = proposalByJob.get(job.jobId);
      return proposal ? [proposal] : [];
    });
    return {
      documentId: document.id,
      title: document.officialTitle,
      type: documentKind(document.documentType),
      eligibleSourceSections: documentJobs.length,
      mapJobsProcessed: documentProposals.length,
      substantiveGroupsProposed: documentProposals.reduce((sum, proposal) => sum + proposal.proposedGroups.length, 0),
      definitionGroups: documentProposals.reduce(
        (sum, proposal) =>
          sum + proposal.proposedGroups.filter((group) => group.focusSelections.some((selection) => (selection.definedTerms?.length ?? 0) > 0)).length,
        0,
      ),
      dispositionCounts: countBy(documentProposals.map((proposal) => proposal.disposition)),
      confidenceCounts: countBy(documentProposals.map((proposal) => proposal.confidence)),
      invalidProposals: documentProposals.filter((proposal) => proposal.validationStatus === 'invalid').length,
      unresolvedConflicts: documentProposals.filter((proposal) => proposal.conflictCodes.length > 0).length,
    };
  });
  const broadRisks = proposals
    .map((proposal) => ({ proposalId: proposal.id, jobId: proposal.jobId, documentId: proposal.document.documentId, codes: broadRiskCodes(proposal) }))
    .filter((entry) => entry.codes.length > 0);
  return {
    schemaVersion: 1,
    documents,
    sourceKeysWithNoMapDisposition: Array.from(jobSourceKeys).filter((sourceKey) => !disposedSourceKeys.has(sourceKey)),
    duplicateFocusGroups,
    conflictingGroups: proposals.filter((proposal) => proposal.conflictCodes.length > 0).map((proposal) => ({
      proposalId: proposal.id,
      jobId: proposal.jobId,
      conflicts: proposal.conflictCodes,
    })),
    suspiciouslyEnormousGroups: broadRisks,
    definitionsNotAssigned: proposals
      .filter((proposal) => /\bdefinitions?\b/i.test(`${proposal.targetHeading ?? ''} ${proposal.operativeSourceText ?? ''}`))
      .filter((proposal) => !proposal.proposedGroups.some((group) => group.focusSelections.some((selection) => (selection.definedTerms?.length ?? 0) > 0)))
      .map((proposal) => proposal.id),
  };
};

export const buildReviewQueues = (proposals: AiStudyMapProposal[], status: MapRunStatus) => {
  const blockers = proposals.filter(
    (proposal) =>
      proposal.validationStatus === 'invalid' ||
      proposal.conflictCodes.some((code) => code === 'MAP_CONFLICT') ||
      proposal.validationMessages.some((code) => /HASH|EVIDENCE|FOCUS|LEAKAGE|STALE|MISMATCH|SOURCE/.test(code)),
  );
  const blockerIds = new Set(blockers.map((proposal) => proposal.id));
  const humanAttention = proposals.filter(
    (proposal) =>
      !blockerIds.has(proposal.id) &&
      (proposal.confidence === 'low' ||
        proposal.validationStatus === 'warnings' ||
        proposal.disposition === 'needs-human-review' ||
        proposal.disposition === 'reference-only' ||
        proposal.disposition === 'skip' ||
        broadRiskCodes(proposal).length > 0),
  );
  const attentionIds = new Set(humanAttention.map((proposal) => proposal.id));
  const cleanHighConfidence = proposals.filter(
    (proposal) =>
      !blockerIds.has(proposal.id) &&
      !attentionIds.has(proposal.id) &&
      proposal.confidence === 'high' &&
      proposal.validationStatus === 'valid' &&
      proposal.conflictCodes.length === 0,
  );
  return {
    blockers: {
      status,
      proposals: blockers,
    },
    humanAttention,
    cleanHighConfidence,
  };
};

const sampleCategories = (proposal: AiStudyMapProposal): string[] => {
  const text = `${proposal.targetHeading ?? ''} ${proposal.operativeSourceText ?? ''}`.toLowerCase();
  const categories: string[] = [proposal.document.type, proposal.confidence, proposal.disposition];
  [
    ['definitions', /\bmeans\b|definitions?/],
    ['duties', /\bshall\b|\bmust\b|required/],
    ['discretionary-powers', /\bmay\b|power|authority/],
    ['prohibitions', /\bshall not\b|\bmust not\b|prohibited/],
    ['deadlines', /\b\d+\s+days?\b|within/],
    ['registration-filing', /file|filing|register|registration|record/],
    ['notices', /notice|notify/],
    ['procedures', /procedure|application|hearing|objection/],
    ['exceptions-qualifiers', /except|unless|subject to|notwithstanding/],
    ['legal-effects', /deemed|binding|conclusive|effect/],
    ['offences-penalties', /offence|penalty|fine/],
    ['regulation-making-powers', /regulation/],
    ['surveying-specific', /survey|surveyor|monument|boundary|plan/],
    ['simple-source', /^.{0,700}$/s],
    ['medium-source', /^.{701,2500}$/s],
    ['complex-source', /^.{2501,}$/s],
  ].forEach(([category, pattern]) => {
    if ((pattern as RegExp).test(text)) categories.push(category as string);
  });
  return categories;
};

export const buildCleanReviewSample = (proposals: AiStudyMapProposal[], targetSize = 120) => {
  const selected = new Map<string, AiStudyMapProposal>();
  const byDocument = new Map<string, AiStudyMapProposal[]>();
  proposals.forEach((proposal) => byDocument.set(proposal.document.documentId, [...(byDocument.get(proposal.document.documentId) ?? []), proposal]));
  Array.from(byDocument.keys()).sort().forEach((documentId) => {
    const pick = byDocument.get(documentId)?.[0];
    if (pick) selected.set(pick.id, pick);
  });
  const byCategory = new Map<string, AiStudyMapProposal[]>();
  proposals.forEach((proposal) => sampleCategories(proposal).forEach((category) => byCategory.set(category, [...(byCategory.get(category) ?? []), proposal])));
  Array.from(byCategory.keys()).sort().forEach((category) => {
    if (selected.size >= targetSize) return;
    const pick = byCategory.get(category)?.find((proposal) => !selected.has(proposal.id));
    if (pick) selected.set(pick.id, pick);
  });
  proposals.forEach((proposal) => {
    if (selected.size < targetSize) selected.set(proposal.id, proposal);
  });
  return Array.from(selected.values()).slice(0, targetSize).map((proposal) => ({
    proposalId: proposal.id,
    officialFocusedSource: proposal.operativeSourceText,
    mapDisposition: proposal.disposition,
    proposedGroups: proposal.proposedGroups,
    focusSelections: proposal.proposedGroups.flatMap((group) => group.focusSelections),
    evidence: proposal.proposedGroups.flatMap((group) => group.focusSelections.flatMap((selection) => selection.evidenceText ?? [])),
    reason: proposal.reason,
    approximateLearningGoal: proposal.proposedGroups.map((group) => group.approximateLearningGoal),
    confidence: proposal.confidence,
    validatorMessages: proposal.validationMessages,
    sampleCategories: sampleCategories(proposal),
  }));
};

export const buildDispositionSummary = (proposals: AiStudyMapProposal[]) => ({
  schemaVersion: 1,
  totalProposals: proposals.length,
  dispositionCounts: countBy(proposals.map((proposal) => proposal.disposition as AiStudyDisposition)),
  confidenceCounts: countBy(proposals.map((proposal) => proposal.confidence as AiConfidence)),
  proposedStudyMapGroupCount: proposals.reduce((sum, proposal) => sum + proposal.proposedGroups.length, 0),
  definitionGroupCount: proposals.reduce(
    (sum, proposal) =>
      sum + proposal.proposedGroups.filter((group) => group.focusSelections.some((selection) => (selection.definedTerms?.length ?? 0) > 0)).length,
    0,
  ),
  broadGroupRiskCount: proposals.filter((proposal) => broadRiskCodes(proposal).length > 0).length,
});
