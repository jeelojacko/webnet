import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStoredUnitProposal, AiStudyUnitProposal, AiValidationIssue } from '../src/study/ai/studyAiTypes';

const RUN_ID = 'ai-units-4b21-expanded-s48-v4fix';
const OLD_RUN_ID = 'ai-units-4b2-expanded-s48-v4';
const V3_RUN_ID = 'ai-units-4b13-pilot-s16-v3';
const RUN_DIR = join('study-content', 'ai', 'runs', RUN_ID);
const OLD_RUN_DIR = join('study-content', 'ai', 'runs', OLD_RUN_ID);
const V3_RUN_DIR = join('study-content', 'ai', 'runs', V3_RUN_ID);
const REPORTS_DIR = join(RUN_DIR, 'reports');

type ValidationReport = {
  proposals: number;
  valid: number;
  warningValid: number;
  invalid: number;
  issues: Array<AiValidationIssue & { proposalId: string }>;
};

const EDUCATIONAL_CODES = [
  'GENERIC_MAIN_QUESTION',
  'GENERIC_GUIDED_QUESTION',
  'ANSWER_APPEARS_TRUNCATED',
  'DEFINITION_ANSWER_MISSING_TERM_MEANING',
  'DUPLICATE_NONRESPONSIVE_ANSWER',
  'MAP_REVISION_UNSUPPORTED_CONCEPT',
] as const;

const LEGAL_FIDELITY_CODES = [
  'EVIDENCE_INCOMPLETE_FOR_ANSWER',
  'ANSWER_EXTENDS_BEYOND_EVIDENCE',
  'POSSIBLE_ACTOR_MISMATCH',
  'POSSIBLE_MODALITY_MISMATCH',
  'UNSUPPORTED_NUMERIC_OR_REFERENCE',
  'QUALIFIER_LOSS',
  'UNIT_CONTEXT_LEAKAGE',
  'OUTSIDE_APPROVED_FOCUS',
] as const;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const readJsonlDetailed = <T>(dir: string): { rows: T[]; malformed: number; lineCount: number } => {
  if (!existsSync(dir)) return { rows: [], malformed: 0, lineCount: 0 };
  let malformed = 0;
  let lineCount = 0;
  const rows: T[] = [];
  readdirSync(dir)
    .filter((file) => file.endsWith('.results.jsonl'))
    .sort()
    .forEach((file) => {
      readFileSync(join(dir, file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .forEach((line) => {
          lineCount += 1;
          try {
            rows.push(JSON.parse(line) as T);
          } catch {
            malformed += 1;
          }
        });
    });
  return { rows, malformed, lineCount };
};

const countBy = (values: string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

const countCodes = (
  issues: Array<AiValidationIssue & { proposalId: string }>,
  codes: readonly string[],
): Record<string, number> =>
  Object.fromEntries(codes.map((code) => [code, issues.filter((issue) => issue.code === code).length]));

const jobKey = (proposal: AiStudyUnitProposal): string =>
  proposal.generationMetadata.sourceJobId ?? proposal.proposalId;

const focusKey = (proposal: AiStudyUnitProposal): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        document: proposal.sourceDocumentId,
        sourceKeys: proposal.sourceKeys,
        focusSelections: proposal.approvedGroup?.focusSelections ?? [],
      }),
    )
    .digest('hex');

const definitionControls = (proposals: AiStoredUnitProposal[]) =>
  proposals
    .map((proposal) => ({
      proposal,
      terms: (proposal.approvedGroup?.focusSelections ?? []).flatMap((selection) => selection.definedTerms ?? []),
    }))
    .filter((entry) => entry.terms.length > 0)
    .map(({ proposal, terms }) => ({
      proposalId: proposal.proposalId,
      documentId: proposal.sourceDocumentId,
      title: proposal.title,
      terms,
      validationStatus: proposal.validationStatus,
      missingMeaningWarnings: proposal.validationMessages.filter(
        (code) => code === 'DEFINITION_ANSWER_MISSING_TERM_MEANING',
      ).length,
      mainQuestion: proposal.mainQuestion,
      guidedQuestions: proposal.objectives.map((objective) => objective.guidedQuestion),
      answers: proposal.objectives.map((objective) => objective.studyAnswer),
    }));

const broadGroups = (proposals: AiStoredUnitProposal[]) =>
  proposals
    .filter((proposal) => proposal.warnings.includes('MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'))
    .map((proposal) => ({
      proposalId: proposal.proposalId,
      documentId: proposal.sourceDocumentId,
      title: proposal.title,
      validationStatus: proposal.validationStatus,
      authoringStatus: proposal.authoringStatus,
      validationMessages: proposal.validationMessages,
      mapRevisionSuggestion: proposal.mapRevisionSuggestion,
    }));

const sameFocusObservations = (proposals: AiStoredUnitProposal[]) =>
  Object.values(
    proposals.reduce<Record<string, AiStoredUnitProposal[]>>((acc, proposal) => {
      const key = `${proposal.sourceDocumentId}::${proposal.sourceKeys.join('|')}`;
      acc[key] = [...(acc[key] ?? []), proposal];
      return acc;
    }, {}),
  )
    .filter((group) => group.length > 1)
    .map((group) => ({
      count: group.length,
      documentId: group[0]?.sourceDocumentId,
      sourceKeys: group[0]?.sourceKeys,
      exactFocusDuplicateCount: Object.values(
        group.reduce<Record<string, number>>((acc, proposal) => {
          const key = focusKey(proposal);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      ).filter((count) => count > 1).length,
      approvedGroupTitles: group.map((proposal) => proposal.approvedGroup?.titleSuggestion ?? proposal.title),
      proposalIds: group.map((proposal) => proposal.proposalId),
      observation:
        'Prepared same-source/focus-neighborhood jobs produced naturally different wording for distinct approved groups; compare side-by-side in the review artifact rather than requiring identical prose.',
      mainQuestions: group.map((proposal) => proposal.mainQuestion),
    }));

const controlComparisons = (v3: AiStoredUnitProposal[], v4: AiStoredUnitProposal[], oldV4: AiStoredUnitProposal[]) => {
  const v4ByGroup = new Map(v4.map((proposal) => [`${proposal.sourceDocumentId}::${proposal.approvedGroup?.titleSuggestion}`, proposal]));
  const oldByGroup = new Map(oldV4.map((proposal) => [`${proposal.sourceDocumentId}::${proposal.approvedGroup?.titleSuggestion}`, proposal]));
  return v3.flatMap((baseline) => {
    const key = `${baseline.sourceDocumentId}::${baseline.approvedGroup?.titleSuggestion}`;
    const remediated = v4ByGroup.get(key);
    if (!remediated) return [];
    const failed = oldByGroup.get(key);
    return [{
      sourceDocumentId: baseline.sourceDocumentId,
      sourceKeys: baseline.sourceKeys,
      approvedGroup: baseline.approvedGroup?.titleSuggestion,
      v3: {
        proposalId: baseline.proposalId,
        mainQuestion: baseline.mainQuestion,
        guidedQuestions: baseline.objectives.map((objective) => objective.guidedQuestion),
        studyAnswers: baseline.objectives.map((objective) => objective.studyAnswer),
        warnings: baseline.validationMessages,
      },
      failedV4: failed
        ? {
            proposalId: failed.proposalId,
            mainQuestion: failed.mainQuestion,
            guidedQuestions: failed.objectives.map((objective) => objective.guidedQuestion),
            studyAnswers: failed.objectives.map((objective) => objective.studyAnswer),
            warnings: failed.validationMessages,
          }
        : null,
      remediatedV4: {
        proposalId: remediated.proposalId,
        mainQuestion: remediated.mainQuestion,
        guidedQuestions: remediated.objectives.map((objective) => objective.guidedQuestion),
        studyAnswers: remediated.objectives.map((objective) => objective.studyAnswer),
        warnings: remediated.validationMessages,
      },
    }];
  });
};

const main = (): void => {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const validation = readJson<ValidationReport>(join(REPORTS_DIR, 'unit-validation.json'));
  const proposals = readJson<AiStoredUnitProposal[]>(join(REPORTS_DIR, 'unit-proposals.json'));
  const oldValidation = readJson<ValidationReport>(join(OLD_RUN_DIR, 'reports', 'phase-4b21-revalidation-validation.json'));
  const oldProposals = readJson<AiStoredUnitProposal[]>(join(OLD_RUN_DIR, 'reports', 'phase-4b21-revalidation-proposals.json'));
  const v3Proposals = readJson<AiStoredUnitProposal[]>(join(V3_RUN_DIR, 'reports', 'unit-proposals.json'));
  const raw = readJsonlDetailed<AiStudyUnitProposal>(join(RUN_DIR, 'results'));
  const jobs = readdirSync(join(RUN_DIR, 'jobs'))
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .flatMap((file) =>
      readFileSync(join(RUN_DIR, 'jobs', file), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { jobId: string; inputHash: string }),
    );
  const jobsById = new Map(jobs.map((job) => [job.jobId, job]));
  const seen = new Set<string>();
  const duplicate = raw.rows.filter((result) => {
    const id = jobKey(result);
    const isDuplicate = seen.has(id);
    seen.add(id);
    return isDuplicate;
  }).length;
  const stale = raw.rows.filter((result) => {
    const job = jobsById.get(jobKey(result));
    return !job || result.generationMetadata.sourceJobInputHash !== job.inputHash;
  }).length;
  const report = {
    schemaVersion: 1,
    runId: RUN_ID,
    comparisonBaselineRunId: OLD_RUN_ID,
    v3BaselineRunId: V3_RUN_ID,
    generatedAt: new Date().toISOString(),
    provenance: {
      providerKind: 'external-codex',
      genuineExternalPerJobReasoning: true,
      note: 'Raw JSONL was authored by six independent external Codex batch agents, one per prepared job batch; deterministic local Unit prose authoring remained disabled.',
    },
    status: {
      expectedJobs: jobs.length,
      resultLines: raw.lineCount,
      malformed: raw.malformed,
      stale,
      duplicate,
      remaining: jobs.length - new Set(raw.rows.map(jobKey)).size,
    },
    validationTotals: {
      cleanValid: validation.valid,
      warningValid: validation.warningValid,
      invalid: validation.invalid,
      issueCounts: countBy(validation.issues.map((issue) => issue.code)),
      educationalDiagnostics: countCodes(validation.issues, EDUCATIONAL_CODES),
      legalFidelityDiagnostics: countCodes(validation.issues, LEGAL_FIDELITY_CODES),
    },
    confidence: {
      proposals: countBy(proposals.map((proposal) => proposal.confidence)),
      objectives: countBy(proposals.flatMap((proposal) => proposal.objectives.map((objective) => objective.confidence))),
    },
    authoringStatus: countBy(proposals.map((proposal) => proposal.authoringStatus ?? 'generated')),
    definitionControls: definitionControls(proposals),
    broadGroups: broadGroups(proposals),
    sameFocusObservations: sameFocusObservations(proposals),
    oldRunComparison: {
      oldCleanValid: oldValidation.valid,
      oldWarningValid: oldValidation.warningValid,
      oldInvalid: oldValidation.invalid,
      oldIssueCounts: countBy(oldValidation.issues.map((issue) => issue.code)),
      remediatedCleanValid: validation.valid,
      remediatedWarningValid: validation.warningValid,
      remediatedInvalid: validation.invalid,
    },
    v3Controls: controlComparisons(v3Proposals, proposals, oldProposals),
    humanReviewGate:
      'Ready for human educational-quality review only. Do not treat deterministic validation as scale approval.',
    fullCorpusGenerationStarted: false,
  };
  writeFileSync(join(REPORTS_DIR, 'phase-4b21-completion-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(REPORTS_DIR, 'phase-4b21-completion-report.md'),
    [
      '# Phase 4B.2.1 Completion Report',
      '',
      `Run: ${RUN_ID}`,
      `Baseline: ${OLD_RUN_ID}`,
      `Result lines: ${report.status.resultLines} / ${report.status.expectedJobs}`,
      `Malformed: ${report.status.malformed}`,
      `Stale: ${report.status.stale}`,
      `Duplicate: ${report.status.duplicate}`,
      `Clean-valid: ${report.validationTotals.cleanValid}`,
      `Warning-valid: ${report.validationTotals.warningValid}`,
      `Invalid: ${report.validationTotals.invalid}`,
      '',
      '## Educational Diagnostics',
      ...Object.entries(report.validationTotals.educationalDiagnostics).map(([code, count]) => `- ${code}: ${count}`),
      '',
      '## Legal-Fidelity Diagnostics',
      ...Object.entries(report.validationTotals.legalFidelityDiagnostics).map(([code, count]) => `- ${code}: ${count}`),
      '',
      '## Definition Controls',
      ...report.definitionControls.map(
        (entry) =>
          `- ${entry.proposalId}: ${entry.terms.join(', ')}; status ${entry.validationStatus}; missing-meaning warnings ${entry.missingMeaningWarnings}`,
      ),
      '',
      '## Broad Groups',
      ...report.broadGroups.map(
        (entry) =>
          `- ${entry.proposalId}: ${entry.authoringStatus}; suggested groups ${entry.mapRevisionSuggestion?.proposedGroups.length ?? 0}`,
      ),
      '',
      '## Same-Source Consistency',
      ...report.sameFocusObservations.map(
        (entry) =>
          `- ${entry.documentId} ${entry.sourceKeys?.join(', ')}: ${entry.count} related proposals; exact duplicate focus groups ${entry.exactFocusDuplicateCount}`,
      ),
      '',
      '## V3 Control Comparisons',
      ...report.v3Controls.map(
        (entry) =>
          `- ${entry.sourceDocumentId} ${entry.sourceKeys.join(', ')} ${entry.approvedGroup}: V3 "${entry.v3.mainQuestion}" -> remediated V4 "${entry.remediatedV4.mainQuestion}"`,
      ),
      '',
      '## Human Review Gate',
      report.humanReviewGate,
      '',
      'Full-corpus generation: not started.',
      '',
    ].join('\n'),
  );
  console.log(`Wrote Phase 4B.2.1 completion report to ${REPORTS_DIR}`);
};

main();
