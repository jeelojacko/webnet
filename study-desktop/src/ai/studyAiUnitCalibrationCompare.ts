/**
 * Deterministic V4/V5 calibration comparison + side-by-side human review
 * (WV5 brief). Pure builders over a loaded `CompareContext` (see
 * `.load.ts` for file IO + integrity gates); no provider calls, no wall
 * clock, no RNG. Produces the machine comparison document and the 80-row
 * risk-ordered human review document used by
 * scripts/studyAiCompareUnitCalibrations.ts.
 *
 * Wording/identity conventions follow the calibration-80 audit artifacts:
 * fixed 20260902 dateTag/generatedAt, crosswalk-seq ordering, warning codes
 * and authoring-status keys verbatim.
 */
import type { NbLawContentPackage } from '../content/nbLawTypes';
import { sourceComponentsForProposal } from './studyAiUnitSourceComponents';
import { validateAiStudyUnitProposal } from './studyAiValidation';
import type { AiStudyUnitProposal } from './studyAiTypes';
import type {
  AnchorComparisonRow,
  CompareContext,
  CompareDocs,
  CompareHumanReviewDoc,
  ComparePerRunSection,
  CompareReviewRow,
  CompareReviewV5Side,
  CompareRow,
  CompareSideRow,
  CompareValidationRun,
  ComparisonDoc,
  NamedSubsetRows,
  OcrCaseSection,
  QuestionLengthStats,
  RevisionConsistencySection,
  StatusTransitionMatrix,
  WarningHistogramSection,
} from './studyAiUnitCalibrationCompare.types';
import {
  COMPARE_DATE_TAG,
  COMPARE_GENERATED_AT,
  COMPARE_SCHEMA_VERSION,
} from './studyAiUnitCalibrationCompare.types';
import {
  authoringStatusKeyOf,
  anchorVerdictOf,
  countBy,
  evidenceUnionHasString,
  greaterThanCount,
  meanLengthChars,
  objectiveIdsCarryingString,
  revisionConsistencyBucketsOf,
  sideRowOf,
  sortedNumericCountTable,
  sortedUnique,
  statusTransitionMatrixOf,
  tierIndexOf,
} from './studyAiUnitCalibrationCompare.utils';

/** Default OCR probe row: the v4 job whose id ends with this suffix. */
export const OCR_V4_JOB_ID_SUFFIX = '07fa6fc1208594ca';

export const CANONICAL_COVERAGE_WARNING_EXPECTED = {
  APPROVED_FOCUS_NOT_COVERED: 49,
  UNCOVERED_SUBSTANTIVE_SOURCE: 37,
} as const;

/* ------------------------------------------------------------------ *
 * Canonical revalidation (mirrors the audit's re-run exactly)        *
 * ------------------------------------------------------------------ */

export const canonicalValidateProposal = (
  packageDoc: NbLawContentPackage,
  proposal: AiStudyUnitProposal,
): CompareValidationRun => {
  try {
    const sourceComponents = sourceComponentsForProposal(
      packageDoc,
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
    const errorCodes = errors.map((issue) => issue.code).sort();
    const warningCodes = warnings.map((issue) => issue.code).sort();
    return {
      status: errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warnings' : 'valid',
      issueCodes: [...errorCodes, ...warningCodes],
      errorCodes,
      warningCodes,
      errorCount: errors.length,
      warningCount: warnings.length,
    };
  } catch {
    return {
      status: 'invalid',
      issueCodes: ['PROPOSAL_VALIDATION_CRASH'],
      errorCodes: ['PROPOSAL_VALIDATION_CRASH'],
      warningCodes: [],
      errorCount: 1,
      warningCount: 0,
    };
  }
};

/* ------------------------------------------------------------------ *
 * Unified rows (crosswalk seq order)                                *
 * ------------------------------------------------------------------ */

const sideFactsOf = (
  context: CompareContext,
  key: 'v4' | 'v5',
  jobId: string,
): CompareSideRow => {
  const run = context[key === 'v4' ? 'v4Run' : 'v5Run'];
  if (!run.jobsByJobId.has(jobId)) {
    throw new Error(`Comparison integrity failure: ${key} run has no job payload for ${jobId}.`);
  }
  const proposal = run.resultsByProposalId.get(jobId);
  const attempts = run.attemptsByJobId.get(jobId) ?? [];
  const validation = proposal === undefined ? null : context.validate(proposal);
  return sideRowOf(proposal, attempts, validation);
};

const namedFlagsOf = (context: CompareContext, v4JobId: string) => ({
  finalQc: context.membership.finalQcIds.includes(v4JobId),
  anchor: context.membership.anchorIds.includes(v4JobId),
  retry: context.membership.retryIds.includes(v4JobId),
  repealedMix: context.membership.repealedMixIds.includes(v4JobId),
});

const isNamed = (named: CompareRow['named']): boolean =>
  named.finalQc || named.anchor || named.retry || named.repealedMix;

/** One unified row per crosswalk row, in crosswalk seq order. */
export const buildComparisonRows = (context: CompareContext): CompareRow[] =>
  context.crosswalkRows.map((crosswalk) => ({
    seq: crosswalk.seq,
    proposalId: crosswalk.proposalId,
    groupId: crosswalk.groupId,
    v4JobId: crosswalk.v4JobId,
    v5JobId: crosswalk.v5JobId,
    documentIds: [...crosswalk.documentIds],
    titleSuggestion: crosswalk.titleSuggestion,
    frozenMapPriority: crosswalk.frozenMapPriority,
    named: namedFlagsOf(context, crosswalk.v4JobId),
    v4: sideFactsOf(context, 'v4', crosswalk.v4JobId),
    v5: sideFactsOf(context, 'v5', crosswalk.v5JobId),
  }));

/* ------------------------------------------------------------------ *
 * Per-run section                                                   *
 * ------------------------------------------------------------------ */

const perRunSectionOf = (
  context: CompareContext,
  rows: CompareRow[],
  key: 'v4' | 'v5',
): ComparePerRunSection => {
  const run = key === 'v4' ? context.v4Run : context.v5Run;
  const countOutcome = (outcome: CompareSideRow['outcome']): number =>
    rows.filter((row) => row[key].outcome === outcome).length;
  let worstRetryJob: ComparePerRunSection['worstRetryJob'] = null;
  for (const row of rows) {
    const rejected = row[key].rejectedAttemptFiles;
    if (rejected > 0 && (worstRetryJob === null || rejected > worstRetryJob.rejectedAttemptFiles)) {
      worstRetryJob = {
        jobId: key === 'v4' ? row.v4JobId : row.v5JobId,
        rejectedAttemptFiles: rejected,
      };
    }
  }
  return {
    runId: run.runId,
    model: run.model,
    endpoint: run.endpoint,
    concurrency: run.concurrency,
    promptSpecVersion: run.promptSpecVersion,
    specSha256: run.specSha256,
    jobsTotal: rows.length,
    accepted: countOutcome('accepted'),
    semanticFailed: countOutcome('semantic-failed'),
    providerIncomplete: countOutcome('provider-incomplete'),
    nothing: countOutcome('nothing'),
    totalRejectedAttemptFiles: rows.reduce(
      (total, row) => total + row[key].rejectedAttemptFiles,
      0,
    ),
    rejectedSemanticAttempts: rows.reduce(
      (total, row) => total + row[key].rejectedSemanticAttempts,
      0,
    ),
    providerAttempts: rows.reduce((total, row) => total + row[key].providerAttempts, 0),
    worstRetryJob,
  };
};

/* ------------------------------------------------------------------ *
 * Question / objective statistics                                   *
 * ------------------------------------------------------------------ */

const questionStatsOf = (rows: CompareRow[], key: 'v4' | 'v5'): QuestionLengthStats => {
  const mainLengths: number[] = [];
  const guidedLengths: number[] = [];
  for (const row of rows) {
    const proposal = row[key].proposal;
    if (proposal === undefined) continue;
    mainLengths.push((proposal.mainQuestion ?? '').length);
    for (const objective of proposal.objectives ?? []) {
      guidedLengths.push((objective.guidedQuestion ?? '').length);
    }
  }
  return {
    count: mainLengths.length,
    meanLengthChars: meanLengthChars(mainLengths),
    overMain180: greaterThanCount(mainLengths, 180),
    overMain240: greaterThanCount(mainLengths, 240),
    overGuided160: greaterThanCount(guidedLengths, 160),
    overGuided220: greaterThanCount(guidedLengths, 220),
  };
};

const objectiveHistogramOf = (rows: CompareRow[], key: 'v4' | 'v5') => {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const proposal = row[key].proposal;
    if (proposal === undefined) continue;
    const countKey = String(proposal.objectives?.length ?? 0);
    counts[countKey] = (counts[countKey] ?? 0) + 1;
  }
  return sortedNumericCountTable(counts);
};

/* ------------------------------------------------------------------ *
 * Warnings section (canonical-validation warning codes)             *
 * ------------------------------------------------------------------ */

const warningsSectionOf = (rows: CompareRow[]): WarningHistogramSection => {
  const v4ByCode: Record<string, number> = {};
  const v5ByCode: Record<string, number> = {};
  for (const row of rows) {
    for (const code of row.v4.validation?.warningCodes ?? [])
      v4ByCode[code] = (v4ByCode[code] ?? 0) + 1;
    for (const code of row.v5.validation?.warningCodes ?? [])
      v5ByCode[code] = (v5ByCode[code] ?? 0) + 1;
  }
  const codes = sortedUnique([...Object.keys(v4ByCode), ...Object.keys(v5ByCode)]);
  const orderedV4: Record<string, number> = {};
  const orderedV5: Record<string, number> = {};
  for (const code of codes) {
    if (v4ByCode[code] !== undefined) orderedV4[code] = v4ByCode[code];
    if (v5ByCode[code] !== undefined) orderedV5[code] = v5ByCode[code];
  }
  const v4Total = rows.reduce((total, row) => total + (row.v4.validation?.warningCount ?? 0), 0);
  const v5Total = rows.reduce((total, row) => total + (row.v5.validation?.warningCount ?? 0), 0);
  const approved = orderedV4['APPROVED_FOCUS_NOT_COVERED'] ?? 0;
  const uncovered = orderedV4['UNCOVERED_SUBSTANTIVE_SOURCE'] ?? 0;
  const recomputed = {
    APPROVED_FOCUS_NOT_COVERED: approved,
    UNCOVERED_SUBSTANTIVE_SOURCE: uncovered,
    total: approved + uncovered,
  };
  const expected = {
    APPROVED_FOCUS_NOT_COVERED: CANONICAL_COVERAGE_WARNING_EXPECTED.APPROVED_FOCUS_NOT_COVERED,
    UNCOVERED_SUBSTANTIVE_SOURCE: CANONICAL_COVERAGE_WARNING_EXPECTED.UNCOVERED_SUBSTANTIVE_SOURCE,
    total:
      CANONICAL_COVERAGE_WARNING_EXPECTED.APPROVED_FOCUS_NOT_COVERED +
      CANONICAL_COVERAGE_WARNING_EXPECTED.UNCOVERED_SUBSTANTIVE_SOURCE,
  };
  return {
    codes,
    v4: orderedV4,
    v5: orderedV5,
    v4Total,
    v5Total,
    v4CoverageReconciliation: {
      expected,
      recomputed,
      matched: recomputed.total === expected.total,
      note:
        'V4 canonical-revalidation warning instances for the two coverage codes, recomputed over the ' +
        'accepted V4 proposals; must match the frozen prior audit (49 APPROVED_FOCUS_NOT_COVERED / ' +
        '37 UNCOVERED_SUBSTANTIVE_SOURCE = 86).',
    },
  };
};

/* ------------------------------------------------------------------ *
 * Matrix / revision consistency / anchors / subsets                 *
 * ------------------------------------------------------------------ */

const matrixOf = (rows: CompareRow[]): StatusTransitionMatrix =>
  statusTransitionMatrixOf(rows.map((row) => ({ v4: row.v4, v5: row.v5 })));

const revisionConsistencyOf = (rows: CompareRow[]): RevisionConsistencySection =>
  revisionConsistencyBucketsOf(
    rows.map((row) => ({ seq: row.seq, v5JobId: row.v5JobId, v5: row.v5 })),
  );

const anchorsOf = (rows: CompareRow[]): AnchorComparisonRow[] =>
  rows
    .filter((row) => row.named.anchor)
    .map((row) => ({
      seq: row.seq,
      v4JobId: row.v4JobId,
      v5JobId: row.v5JobId,
      v4Status: row.v4.authoringStatus,
      v5Status: row.v5.authoringStatus,
      v4Warnings: [...(row.v4.proposal?.warnings ?? [])].sort(),
      v5Warnings: [...(row.v5.proposal?.warnings ?? [])].sort(),
      verdict: anchorVerdictOf(
        row.v4.authoringStatus,
        row.v5.authoringStatus,
        row.v4.proposal?.warnings ?? [],
        row.v5.proposal?.warnings ?? [],
      ),
    }));

const namedSubsetRowsOf = (rows: CompareRow[], flag: keyof CompareRow['named']): NamedSubsetRows => {
  const subset = rows.filter((row) => row.named[flag]);
  return {
    count: subset.length,
    rows: subset.map((row) => ({
      seq: row.seq,
      v4JobId: row.v4JobId,
      v5JobId: row.v5JobId,
      v4Status: row.v4.authoringStatus,
      v5Status: row.v5.authoringStatus,
    })),
  };
};

const namedSubsetsOf = (rows: CompareRow[]): ComparisonDoc['namedSubsets'] => ({
  finalQc20: namedSubsetRowsOf(rows, 'finalQc'),
  anchors7: namedSubsetRowsOf(rows, 'anchor'),
  retry9: namedSubsetRowsOf(rows, 'retry'),
  repealedMix16: namedSubsetRowsOf(rows, 'repealedMix'),
});

/* ------------------------------------------------------------------ *
 * OCR case (Land Surveyors Act s.18(2) cohort job)                 *
 * ------------------------------------------------------------------ */

const ocrCaseOf = (context: CompareContext, rows: CompareRow[]): OcrCaseSection => {
  const matches = rows.filter((row) => row.v4JobId.endsWith(context.ocrV4JobIdSuffix));
  if (matches.length !== 1) {
    throw new Error(
      `Comparison integrity failure: expected exactly one crosswalk row with a v4 job id ending ` +
        `'${context.ocrV4JobIdSuffix}' (Land Surveyors Act s.18(2) OCR cohort job) but found ${matches.length}.`,
    );
  }
  const [byLawsTarget, registrarTarget] = context.ocrTargetStrings;
  const row = matches[0];
  const exactSource = context.v4Run.jobsByJobId.get(row.v4JobId)?.exactSourceText ?? '';
  const presenceOf = (target: string) => {
    const v5Proposal = row.v5.proposal;
    return {
      v4JobExactSourceText: exactSource.includes(target),
      v4EvidenceUnion: evidenceUnionHasString(row.v4.proposal, target),
      v5EvidenceUnion: evidenceUnionHasString(v5Proposal, target),
      v5ObjectiveIds:
        v5Proposal === undefined ? [] : objectiveIdsCarryingString(v5Proposal, target),
    };
  };
  return {
    seq: row.seq,
    v4JobId: row.v4JobId,
    v5JobId: row.v5JobId,
    groupId: row.groupId,
    titleSuggestion: row.titleSuggestion,
    byLaws: presenceOf(byLawsTarget),
    registrar: presenceOf(registrarTarget),
  };
};

/* ------------------------------------------------------------------ *
 * Human review (six risk tiers)                                     *
 * ------------------------------------------------------------------ */

const buildHumanReviewRows = (rows: CompareRow[]): CompareReviewRow[] =>
  rows
    .map((row) => {
      const tier = tierIndexOf({
        v5Accepted: row.v5.outcome === 'accepted',
        v5AuthoringStatus: row.v5.authoringStatus,
        v4AuthoringStatus: row.v4.authoringStatus,
        v4Warnings: row.v4.proposal?.warnings ?? [],
        v5Warnings: row.v5.proposal?.warnings ?? [],
        named: isNamed(row.named),
      });
      const v4Proposal = row.v4.proposal;
      const v5Proposal = row.v5.proposal;
      const suggestion = v5Proposal?.mapRevisionSuggestion;
      const validation = row.v5.validation;
      return {
        seq: row.seq,
        tier,
        v4JobId: row.v4JobId,
        v5JobId: row.v5JobId,
        documentIds: [...row.documentIds],
        titleSuggestion: row.titleSuggestion,
        frozenMapPriority: row.frozenMapPriority,
        v4: {
          outcome: row.v4.outcome,
          authoringStatus: row.v4.authoringStatus,
          warnings: [...(v4Proposal?.warnings ?? [])].sort(),
          objectiveCount: v4Proposal?.objectives?.length ?? 0,
          attemptCount: row.v4.attemptCount,
          mainQuestion: v4Proposal?.mainQuestion ?? null,
        },
        v5: {
          outcome: row.v5.outcome,
          authoringStatus: row.v5.authoringStatus,
          warnings: [...(v5Proposal?.warnings ?? [])].sort(),
          objectiveCount: v5Proposal?.objectives?.length ?? 0,
          attemptCount: row.v5.attemptCount,
          mainQuestion: v5Proposal?.mainQuestion ?? null,
          mapRevisionSuggestion:
            suggestion === undefined
              ? null
              : {
                  reason: suggestion.reason,
                  proposedGroupTitles: (suggestion.proposedGroups ?? []).map(
                    (group) => group.title,
                  ),
                },
          validationIssues:
            validation === null
              ? []
              : [
                  ...validation.errorCodes.map((code) => ({ code, severity: 'error' as const })),
                  ...validation.warningCodes.map((code) => ({
                    code,
                    severity: 'warning' as const,
                  })),
                ],
        },
      };
    })
    .sort((a, b) => a.tier - b.tier || a.seq - b.seq);

const reviewSummaryOf = (
  reviewRows: CompareReviewRow[],
  rows: CompareRow[],
  context: CompareContext,
): CompareHumanReviewDoc['summary'] => {
  const transitions: Record<string, number> = {};
  for (const row of rows) {
    const key = `${authoringStatusKeyOf(row.v4)} -> ${authoringStatusKeyOf(row.v5)}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
  }
  const revision = revisionConsistencyOf(rows);
  const ocr = ocrCaseOf(context, rows);
  return {
    tierCounts: countBy(reviewRows.map((row) => String(row.tier))),
    statusTransitions: transitions,
    revisionConsistency: {
      generatedWithBroadWarning: revision.generatedWithBroadWarning.count,
      generatedWithSuggestion: revision.generatedWithSuggestion.count,
      needsRevisionWithoutBroadWarning: revision.needsRevisionWithoutBroadWarning.count,
      needsRevisionWithoutSuggestion: revision.needsRevisionWithoutSuggestion.count,
      needsRevisionWithContradictoryReason: revision.needsRevisionWithContradictoryReason.count,
    },
    ocrCase: {
      v4JobExactSourceText:
        ocr.byLaws.v4JobExactSourceText && ocr.registrar.v4JobExactSourceText,
      v4EvidenceUnion: ocr.byLaws.v4EvidenceUnion && ocr.registrar.v4EvidenceUnion,
      v5EvidenceUnion: ocr.byLaws.v5EvidenceUnion && ocr.registrar.v5EvidenceUnion,
    },
  };
};

/* ------------------------------------------------------------------ *
 * Document assembly                                                 *
 * ------------------------------------------------------------------ */

export const buildCompareDocs = (context: CompareContext): CompareDocs => {
  const rows = buildComparisonRows(context);
  const comparison: ComparisonDoc = {
    schemaVersion: COMPARE_SCHEMA_VERSION,
    kind: 'unit-calibration-v4-v5-comparison',
    dateTag: COMPARE_DATE_TAG,
    generatedAt: COMPARE_GENERATED_AT,
    cohortSize: context.cohortSize,
    crosswalkSha256: context.crosswalkSha256,
    specShas: { v4: context.specShas.v4, v5: context.specShas.v5 },
    perRun: { v4: perRunSectionOf(context, rows, 'v4'), v5: perRunSectionOf(context, rows, 'v5') },
    statusTransitionMatrix: matrixOf(rows),
    revisionConsistencyV5: revisionConsistencyOf(rows),
    warnings: warningsSectionOf(rows),
    questions: {
      v4: questionStatsOf(rows, 'v4'),
      v5: questionStatsOf(rows, 'v5'),
    },
    objectives: {
      v4: objectiveHistogramOf(rows, 'v4'),
      v5: objectiveHistogramOf(rows, 'v5'),
    },
    anchors: anchorsOf(rows),
    ocrCase: ocrCaseOf(context, rows),
    namedSubsets: namedSubsetsOf(rows),
  };
  // Note: the V4 86-warning coverage reconciliation (`matched`) is asserted
  // fail-closed by the CLI before any artifact is written; the builder only
  // reports the recomputed figures so synthetic fixtures can exercise it.
  const reviewRows = buildHumanReviewRows(rows);
  const humanReview: CompareHumanReviewDoc = {
    schemaVersion: COMPARE_SCHEMA_VERSION,
    kind: 'unit-calibration-v4-v5-human-review',
    dateTag: COMPARE_DATE_TAG,
    generatedAt: COMPARE_GENERATED_AT,
    v4RunId: context.v4Run.runId,
    v5RunId: context.v5Run.runId,
    cohortSize: context.cohortSize,
    summary: reviewSummaryOf(reviewRows, rows, context),
    rows: reviewRows,
  };
  return { comparison, humanReview };
};
