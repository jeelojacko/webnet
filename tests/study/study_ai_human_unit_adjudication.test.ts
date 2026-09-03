import { describe, expect, it } from 'vitest';
import type { AiStudyUnitProposal, AiUnitAuthoringJob } from '../../src/study/ai/studyAiTypes';
import {
  FORBIDDEN_FINAL_CODES,
  HUMAN_EDITABLE_UNIT_FIELDS,
  adjudicationGateIssues,
  applyHumanCorrection,
  attemptIdentityIssues,
  buildHumanAdjudicatedProposal,
  existingResultsIssues,
  type HumanUnitAdjudicationCorrection,
} from '../../scripts/studyAiHumanUnitAdjudication';
import { hashText } from '../../scripts/studyAiLocalMapAuthor';

const RUN_ID = 'ai-units-test-remediation1';
const JOB_ID = 'unit-762098496a0f61e2';
const SOURCE_KEY = 'section:80';
const TEXT_80 = '80(7) The registrar shall keep a correct account of all monies received.';

const job: AiUnitAuthoringJob = {
  schemaVersion: 1,
  jobId: JOB_ID,
  runId: RUN_ID,
  promptSpecVersion: 'unit-authoring-v5',
  sourceMapRunId: 'ai-map-test',
  sourceMapProposalId: 'ai-map-test:map-1',
  corpusContentHash: 'd20b72deaffb8063e0425b730ea5a3a35075e54007e0c0a67df711ddaa970721',
  frozenMapPriority: 'P1',
  inputHash: '121a2df4096870641b699910d9799d1ffe6316891edf7752feb3e7f9975da372',
  document: { documentId: 'doc-land-titles-act', title: 'Land Titles Act', citation: 'L.T.A.', type: 'act' },
  approvedGroup: {
    groupId: 's80-accounting-indemnity',
    titleSuggestion: 'Accounting for received monies and indemnification funding',
    sourceKeys: [SOURCE_KEY],
    focusSelections: [{ sourceKey: SOURCE_KEY, childLabels: ['80(7)'] }],
    reason: 'The registrar accounting duty.',
    approximateLearningGoal: 'Identify the registrar accounting duty.',
  },
  mapDisposition: 'split',
  mapReason: 'Distinct financial-administration concept.',
  approximateLearningGoal: 'Identify the registrar accounting duty.',
  group: {
    groupId: 's80-accounting-indemnity',
    titleSuggestion: 'Accounting for received monies and indemnification funding',
    sourceKeys: [SOURCE_KEY],
    focusSelections: [{ sourceKey: SOURCE_KEY, childLabels: ['80(7)'] }],
    reason: 'The registrar accounting duty.',
    approximateLearningGoal: 'Identify the registrar accounting duty.',
  },
  sourceHashes: { [SOURCE_KEY]: hashText(TEXT_80) },
  sourceStatuses: { [SOURCE_KEY]: 'current' },
  contentFlagsBySourceKey: { [SOURCE_KEY]: {} },
  exactSourceText: TEXT_80,
  operativeSourceText: TEXT_80,
  sourceMetadata: {},
  context: { omittedContextWarnings: [] },
};

const correction: HumanUnitAdjudicationCorrection = {
  schemaVersion: 1,
  kind: 'human-unit-adjudication',
  runId: RUN_ID,
  jobId: JOB_ID,
  sourceAttempt: 9,
  frozenPriority: 'P1',
  method: 'human-remediation',
  reason: 'Model repeatedly omitted selected 80(8)/80(9) sourceCoverage labels.',
  changedFields: ['sourceCoverage'],
  replacement: {
    sourceCoverage: [
      {
        sourceKey: SOURCE_KEY,
        childLabels: [
          { label: '80(7)', status: 'covered', objectiveIds: ['obj-accounting-duty'] },
        ],
      },
    ],
  },
};

const RAW = {
  title: 'Accounting for received monies and indemnification funding',
  mainQuestion: 'What accounting duty does the registrar owe?',
  studySummary: 'The registrar keeps a correct account of monies received.',
  objectives: [],
  relatedSourceKeys: [],
  studyNotes: [],
  sourceCoverage: [{ sourceKey: SOURCE_KEY }],
  authoringStatus: 'generated',
  confidence: 'high',
  warnings: [],
};

describe('human unit adjudication gates', () => {
  describe('applyHumanCorrection', () => {
    it('applies the replacement verbatim and merges over the raw payload', () => {
      const result = applyHumanCorrection(RAW, correction);
      expect(result.issues).toEqual([]);
      expect(result.corrected?.sourceCoverage).toEqual(correction.replacement.sourceCoverage);
      expect(result.corrected?.title).toBe(RAW.title);
    });

    it('rejects runner-owned identity fields', () => {
      const bad = {
        ...correction,
        changedFields: ['suggestedPriority'],
        replacement: { suggestedPriority: 'P4' },
      };
      const result = applyHumanCorrection(RAW, bad);
      expect(result.corrected).toBeUndefined();
      expect(result.issues.join(' ')).toContain('CORRECTION_FIELD_NOT_ALLOWED');
    });

    it('rejects a replacement key missing from changedFields', () => {
      const bad = {
        ...correction,
        replacement: { sourceCoverage: correction.replacement.sourceCoverage, warnings: ['x'] },
      };
      const result = applyHumanCorrection(RAW, bad);
      expect(result.corrected).toBeUndefined();
      expect(result.issues.join(' ')).toContain('CORRECTION_FIELD_UNLISTED');
    });

    it('rejects a changedFields entry with no replacement value', () => {
      const bad = {
        ...correction,
        changedFields: ['sourceCoverage', 'title'],
      };
      const result = applyHumanCorrection(RAW, bad);
      expect(result.corrected).toBeUndefined();
      expect(result.issues.join(' ')).toContain('CORRECTION_FIELD_UNREPLACED');
    });
  });

  describe('attemptIdentityIssues', () => {
    const matchingValidation = {
      jobId: JOB_ID,
      proposalId: JOB_ID,
      runId: RUN_ID,
      sourceJobInputHash: job.inputHash,
      sourceHashes: { [SOURCE_KEY]: hashText(TEXT_80) },
      accepted: false,
    };

    it('passes when every identity field matches and the attempt is the latest rejected one', () => {
      expect(attemptIdentityIssues(matchingValidation, job, 9, 9)).toEqual([]);
    });

    it('detects a sourceJobInputHash mismatch', () => {
      const issues = attemptIdentityIssues(
        { ...matchingValidation, sourceJobInputHash: 'wrong-hash' },
        job,
        9,
        9,
      );
      expect(issues.join(' ')).toContain('ATTEMPT_SOURCE_JOB_INPUT_HASH_MISMATCH');
    });

    it('detects an accepted attempt and a non-latest attempt', () => {
      expect(attemptIdentityIssues({ ...matchingValidation, accepted: true }, job, 9, 9).join(' ')).toContain(
        'ATTEMPT_NOT_REJECTED',
      );
      expect(attemptIdentityIssues(matchingValidation, job, 8, 9).join(' ')).toContain('ATTEMPT_NOT_LATEST');
    });
  });

  describe('existingResultsIssues', () => {
    const jobsById = new Map<string, AiUnitAuthoringJob>([[JOB_ID, job]]);
    const rowFor = (overrides: Record<string, unknown> = {}): AiStudyUnitProposal =>
      ({
        schemaVersion: 1,
        proposalId: JOB_ID,
        runId: RUN_ID,
        corpusContentHash: job.corpusContentHash,
        suggestedPriority: job.frozenMapPriority,
        generationMetadata: { sourceJobInputHash: job.inputHash },
        ...overrides,
      }) as unknown as AiStudyUnitProposal;

    it('passes for a consistent single accepted row', () => {
      expect(existingResultsIssues([rowFor()], jobsById)).toEqual([]);
    });

    it('detects duplicate proposalIds and rows without a job', () => {
      const issues = existingResultsIssues([rowFor(), rowFor()], jobsById).join(' ');
      expect(issues).toContain('DUPLICATE_ACCEPTED_RESULT');
      const orphan = rowFor({ proposalId: 'unit-unknown' });
      expect(existingResultsIssues([orphan], jobsById).join(' ')).toContain('RESULT_WITHOUT_JOB');
    });

    it('detects priority, corpus hash, run, and input-hash mismatches', () => {
      const single = (row: AiStudyUnitProposal): string[] => existingResultsIssues([row], jobsById);
      expect(single(rowFor({ suggestedPriority: 'P4' })).join(' ')).toContain('RESULT_PRIORITY_MISMATCH');
      expect(single(rowFor({ corpusContentHash: 'wrong' })).join(' ')).toContain('RESULT_CORPUS_HASH_MISMATCH');
      expect(single(rowFor({ runId: 'other-run' })).join(' ')).toContain('RESULT_RUN_MISMATCH');
      expect(single(rowFor({ generationMetadata: { sourceJobInputHash: 'wrong' } })).join(' ')).toContain(
        'RESULT_INPUT_HASH_MISMATCH',
      );
    });
  });

  describe('adjudicationGateIssues', () => {
    const run = { runId: RUN_ID, corpusContentHash: '5dc991611b320de87981ba35ded9a99f0951569e732e2bacb35c6d21b3c7e3a1', jobType: 'unit-authoring' };

    it('passes with a matching run, job, correction, and no existing row', () => {
      expect(adjudicationGateIssues({ run, job, rows: [], correction })).toEqual([]);
    });

    it('rejects a non-unit-authoring run and a runId mismatch', () => {
      expect(adjudicationGateIssues({ run: { ...run, jobType: 'study-map' }, job, rows: [], correction }).join(' ')).toContain(
        'RUN_NOT_UNIT_AUTHORING',
      );
      expect(adjudicationGateIssues({ run: { ...run, runId: 'other' }, job, rows: [], correction }).join(' ')).toContain(
        'RUN_ID_MISMATCH',
      );
    });

    it('rejects a missing job without continuing job comparisons', () => {
      const issues = adjudicationGateIssues({ run, job: undefined, rows: [], correction });
      expect(issues.join(' ')).toContain('JOB_NOT_FOUND');
    });

    it('rejects a missing run corpus hash, a priority mismatch, and a duplicate accepted row', () => {
      expect(
        adjudicationGateIssues({ run: { ...run, corpusContentHash: undefined }, job, rows: [], correction }).join(
          ' ',
        ),
      ).toContain('RUN_CORPUS_HASH_MISSING');
      expect(
        adjudicationGateIssues({ run, job, rows: [], correction: { ...correction, frozenPriority: 'P4' } }).join(' '),
      ).toContain('FROZEN_PRIORITY_MISMATCH');
      const existing = [{ proposalId: JOB_ID }] as unknown as AiStudyUnitProposal[];
      expect(adjudicationGateIssues({ run, job, rows: existing, correction }).join(' ')).toContain(
        'DUPLICATE_ACCEPTED_RESULT',
      );
    });
  });

  describe('buildHumanAdjudicatedProposal', () => {
    it('stamps runner identity and embeds the human-adjudication provenance block', () => {
      const proposal = buildHumanAdjudicatedProposal(RAW, job, correction, '2026-09-03T00:00:00.000Z', 0);
      expect(proposal.proposalId).toBe(JOB_ID);
      expect(proposal.runId).toBe(RUN_ID);
      expect(proposal.corpusContentHash).toBe(job.corpusContentHash);
      expect(proposal.suggestedPriority).toBe('P1');
      expect(proposal.sourceCoverage).toEqual(correction.replacement.sourceCoverage);
      expect(proposal.generationMetadata?.humanAdjudication).toEqual({
        method: 'human-remediation',
        reason: correction.reason,
        changedFields: ['sourceCoverage'],
        sourceAttempt: 9,
        modelInferenceUsed: false,
        validatorErrorCount: 0,
        validatorWarningCount: 0,
        adjudicatedAt: '2026-09-03T00:00:00.000Z',
      });
      expect(proposal.generationMetadata?.sourceJobInputHash).toBe(job.inputHash);
    });

    it('throws before building when the correction is invalid', () => {
      const bad = { ...correction, changedFields: ['suggestedPriority'], replacement: { suggestedPriority: 'P4' } };
      expect(() => buildHumanAdjudicatedProposal(RAW, job, bad, '2026-09-03T00:00:00.000Z', 0)).toThrow(
        /CORRECTION_FIELD_NOT_ALLOWED/,
      );
    });
  });

  describe('gate constants', () => {
    it('restricts human-editable fields to model-output fields', () => {
      expect(HUMAN_EDITABLE_UNIT_FIELDS).toContain('sourceCoverage');
      expect(HUMAN_EDITABLE_UNIT_FIELDS).not.toContain('suggestedPriority');
      expect(HUMAN_EDITABLE_UNIT_FIELDS).not.toContain('corpusContentHash');
      expect(HUMAN_EDITABLE_UNIT_FIELDS).not.toContain('generationMetadata');
    });

    it('requires the hard V5 fidelity codes to be zero', () => {
      expect(FORBIDDEN_FINAL_CODES).toEqual(
        expect.arrayContaining([
          'SOURCE_COVERAGE_MISSING_SELECTED_LABEL',
          'SOURCE_COVERAGE_EXTRA_LABEL',
          'UNCOVERED_SUBSTANTIVE_SOURCE',
          'APPROVED_FOCUS_NOT_COVERED',
          'POLARITY_REVERSAL',
          'LEGAL_MODALITY_REVERSAL',
          'EVIDENCE_NOT_EXACT_VERBATIM',
          'CONTEXT_REF_LEAKAGE',
          'UNSUPPORTED_LEGAL_EFFECT',
        ]),
      );
    });
  });
});
