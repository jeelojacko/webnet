/**
 * Tests for the frozen-map freeze gate and map/proposal/job equivalence audit.
 *
 * Synthetic tests exercise fail-closed behavior with small temp frozen-run
 * fixtures. A real-data test (skipped when the gitignored canonical run or the
 * decision file is absent) runs the gate + audit over the actual frozen run
 * and asserts only the brief-guaranteed facts, printing the actual counts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapProposal, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import {
  FROZEN_GROUPING_CORRECTION_JOB_IDS,
  FROZEN_MAP_RUN_ID,
  FROZEN_PRIORITY_DISTRIBUTION,
  FROZEN_RESULT_ROW_COUNT,
  auditMapProposalEquivalence,
  canonicalRunDir,
  verifyFrozenStudyMap,
} from '../../src/study/ai/studyAiMapFreezeGate';
import {
  createFrozenRunFixture,
  makeDispositionGroups,
  makeJob,
  makeProposal,
  makeResult,
  writeFreezeReport,
  writeJobs,
  writeResultsJsonl,
  writeTextFile,
  type FrozenRunFixture,
} from './study_ai_frozen_fixtures';

const SYNTH_RUN_ID = 'synth-run';
const DECISION_TEXT = '{"decisions":[]}\n';

let fixtures: FrozenRunFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures) fixture.cleanup();
  fixtures = [];
});

const track = (fixture: FrozenRunFixture): FrozenRunFixture => {
  fixtures.push(fixture);
  return fixture;
};

const gateOptionsFor = (fixture: FrozenRunFixture) => ({
  freezeReportPath: fixture.freezeReportPath,
  runDir: fixture.runDir,
  decisionFilePath: fixture.decisionFilePath,
  expectedRunId: SYNTH_RUN_ID,
  expectedResultRows: 3,
  expectedPriorityDistribution: { P2: 1, P3: 1, null: 1 },
  groupingCorrectionJobIds: ['map-split-aa'],
});

const jobById = (jobs: AiStudyMapJob[]): Map<string, AiStudyMapJob> =>
  new Map(jobs.map((job) => [job.jobId, job]));

/**
 * Standard synthetic fixture: 3 jobs / 3 rows — split (P3, 2 groups),
 * standalone (P2, 1 group), skip (null, 0 groups). Proposals file and freeze
 * report are written to match. Returns everything callers need to corrupt.
 */
const buildStandardFixture = () => {
  const fixture = track(createFrozenRunFixture(SYNTH_RUN_ID));
  const jobs = [
    makeJob({
      jobId: 'map-split-aa',
      runId: SYNTH_RUN_ID,
      documentId: 'doc-a',
      documentTitle: 'Act A',
      sectionKey: 'section:1',
      sectionLabel: '1',
    }),
    makeJob({
      jobId: 'map-std-bb',
      runId: SYNTH_RUN_ID,
      documentId: 'doc-a',
      documentTitle: 'Act A',
      sectionKey: 'section:2',
      sectionLabel: '2',
    }),
    makeJob({
      jobId: 'map-skip-cc',
      runId: SYNTH_RUN_ID,
      documentId: 'doc-b',
      documentTitle: 'Act B',
      sectionKey: 'section:1',
      sectionLabel: '1',
    }),
  ];
  writeJobs(fixture.runDir, jobs);
  const byJob = jobById(jobs);
  const rows: AiStudyMapResult[] = [
    makeResult({
      jobId: 'map-split-aa',
      runId: SYNTH_RUN_ID,
      disposition: 'split',
      suggestedPriority: 'P3',
      proposedGroups: makeDispositionGroups('split', 2),
    }),
    makeResult({
      jobId: 'map-std-bb',
      runId: SYNTH_RUN_ID,
      disposition: 'standalone',
      suggestedPriority: 'P2',
      proposedGroups: makeDispositionGroups('standalone', 1),
    }),
    makeResult({
      jobId: 'map-skip-cc',
      runId: SYNTH_RUN_ID,
      disposition: 'skip',
      suggestedPriority: null,
      proposedGroups: [],
    }),
  ];
  writeResultsJsonl(fixture.runDir, rows);
  const proposals: AiStudyMapProposal[] = rows.map((row) => {
    const job = byJob.get(row.jobId);
    if (!job) throw new Error(`missing job ${row.jobId}`);
    return makeProposal(row, job);
  });
  const proposalsText = `${JSON.stringify(proposals, null, 2)}\n`;
  writeTextFile(join(fixture.runDir, 'reports', 'map-proposals.json'), proposalsText);
  writeTextFile(fixture.decisionFilePath, DECISION_TEXT);
  writeFreezeReport(
    fixture,
    {
      runId: SYNTH_RUN_ID,
      resultRows: 3,
      priorityDistribution: { P2: 1, P3: 1, null: 1 },
      groupingJobIds: ['map-split-aa'],
    },
    DECISION_TEXT,
    proposalsText,
  );
  return { fixture, jobs, rows, proposals };
};

const issueCodes = (result: { issues: Array<{ code: string }> }): string[] =>
  result.issues.map((issue) => issue.code);

describe('verifyFrozenStudyMap (synthetic fixtures)', () => {
  it('verifies clean when every cross-file fact matches', () => {
    const { fixture, rows } = buildStandardFixture();
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.runId).toBe(SYNTH_RUN_ID);
    expect(result.resultRows).toBe(3);
    expect(result.priorityRecount).toEqual({ P2: 1, P3: 1, null: 1 });
    expect(result.invalidRowIds).toEqual([]);
    expect(result.groupingCorrectionJobIds).toEqual(['map-split-aa']);
    expect(result.decisionFileSha256).toBe(result.recordedDecisionFileSha256);
    expect(result.proposalsSha256).toBe(result.recordedProposalsSha256);
    expect(result.canonicalResultsSha256).toBeTruthy();
    expect(rows.length).toBe(3);
  });

  it('fails closed on a wrong freeze-report runId', () => {
    const { fixture } = buildStandardFixture();
    writeFreezeReport(
      fixture,
      {
        runId: 'some-other-run',
        resultRows: 3,
        priorityDistribution: { P2: 1, P3: 1, null: 1 },
        groupingJobIds: ['map-split-aa'],
      },
      DECISION_TEXT,
      `${JSON.stringify([], null, 2)}\n`,
    );
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('RUN_ID_MISMATCH');
  });

  it('fails closed when the decision file does not hash to the recorded value', () => {
    const { fixture } = buildStandardFixture();
    writeFileSync(fixture.decisionFilePath, '{"decisions":[{"jobId":"x"}]}\n');
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('DECISION_SHA_MISMATCH');
  });

  it('fails closed when map-proposals.json does not hash to the recorded value', () => {
    const { fixture } = buildStandardFixture();
    writeFreezeReport(
      fixture,
      {
        runId: SYNTH_RUN_ID,
        resultRows: 3,
        priorityDistribution: { P2: 1, P3: 1, null: 1 },
        groupingJobIds: ['map-split-aa'],
        proposalsSha256: '0'.repeat(64),
      },
      DECISION_TEXT,
      `${JSON.stringify([], null, 2)}\n`,
    );
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('PROPOSALS_SHA_MISMATCH');
  });

  it('fails closed on a wrong recorded result-row count', () => {
    const { fixture } = buildStandardFixture();
    writeFreezeReport(
      fixture,
      {
        runId: SYNTH_RUN_ID,
        resultRows: 99,
        priorityDistribution: { P2: 1, P3: 1, null: 1 },
        groupingJobIds: ['map-split-aa'],
      },
      DECISION_TEXT,
      `${JSON.stringify([], null, 2)}\n`,
    );
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('RESULT_ROWS_MISMATCH');
  });

  it('fails closed on a recorded invalid-row count above zero', () => {
    const { fixture } = buildStandardFixture();
    writeFreezeReport(
      fixture,
      {
        runId: SYNTH_RUN_ID,
        resultRows: 3,
        priorityDistribution: { P2: 1, P3: 1, null: 1 },
        groupingJobIds: ['map-split-aa'],
        resultRowsInvalid: 2,
      },
      DECISION_TEXT,
      `${JSON.stringify([], null, 2)}\n`,
    );
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('INVALID_ROWS_MISMATCH');
  });

  it('fails closed when the priority recount differs from the recorded distribution', () => {
    const { fixture } = buildStandardFixture();
    writeFreezeReport(
      fixture,
      {
        runId: SYNTH_RUN_ID,
        resultRows: 3,
        priorityDistribution: { P1: 1, P2: 1, P3: 1 },
        groupingJobIds: ['map-split-aa'],
      },
      DECISION_TEXT,
      `${JSON.stringify([], null, 2)}\n`,
    );
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('PRIORITY_DISTRIBUTION_MISMATCH');
  });

  it('fails closed on groupingCorrections with the wrong jobIds', () => {
    const { fixture } = buildStandardFixture();
    writeFreezeReport(
      fixture,
      {
        runId: SYNTH_RUN_ID,
        resultRows: 3,
        priorityDistribution: { P2: 1, P3: 1, null: 1 },
        groupingJobIds: ['map-someone-else'],
      },
      DECISION_TEXT,
      `${JSON.stringify([], null, 2)}\n`,
    );
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('GROUPING_CORRECTIONS_MISMATCH');
  });

  it('fails closed when a canonical row violates the priority/group contract', () => {
    const { fixture, rows } = buildStandardFixture();
    rows[0] = {
      ...rows[0],
      disposition: 'split',
      suggestedPriority: null,
      proposedGroups: makeDispositionGroups('split', 2),
    };
    writeResultsJsonl(fixture.runDir, rows);
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('INVALID_RESULT_ROWS');
    expect(result.invalidRowIds.length).toBe(1);
  });

  it('fails closed when the freeze report is unreadable', () => {
    const { fixture } = buildStandardFixture();
    writeTextFile(fixture.freezeReportPath, 'not json');
    const result = verifyFrozenStudyMap(gateOptionsFor(fixture));
    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain('FREEZE_REPORT_UNREADABLE');
  });
});

describe('auditMapProposalEquivalence (synthetic fixtures)', () => {
  const auditOptionsFor = (fixture: FrozenRunFixture) => ({
    runDir: fixture.runDir,
    runId: SYNTH_RUN_ID,
  });

  it('joins every row to its proposal and job with zero mismatches', () => {
    const { fixture } = buildStandardFixture();
    const audit = auditMapProposalEquivalence(auditOptionsFor(fixture));
    expect(audit.checked).toBe(3);
    expect(audit.totalMismatches).toBe(0);
    expect(audit.mismatches).toEqual([]);
  });

  it('flags a grouped row whose proposal semantic fields diverge', () => {
    const { fixture, proposals } = buildStandardFixture();
    const mutated = proposals.map((proposal) =>
      proposal.jobId === 'map-split-aa'
        ? { ...proposal, reason: 'tampered reason' }
        : proposal,
    );
    writeTextFile(
      join(fixture.runDir, 'reports', 'map-proposals.json'),
      `${JSON.stringify(mutated, null, 2)}\n`,
    );
    const audit = auditMapProposalEquivalence(auditOptionsFor(fixture));
    expect(audit.totalMismatches).toBe(1);
    expect(audit.mismatches[0]).toMatchObject({ jobId: 'map-split-aa', kind: 'SEMANTIC_MISMATCH' });
  });

  it('flags a zero-group row whose proposal carries a priority or groups', () => {
    const { fixture, proposals } = buildStandardFixture();
    const mutated = proposals.map((proposal) =>
      proposal.jobId === 'map-skip-cc'
        ? { ...proposal, suggestedPriority: 'P2', proposedGroups: makeDispositionGroups('skip', 1) }
        : proposal,
    );
    writeTextFile(
      join(fixture.runDir, 'reports', 'map-proposals.json'),
      `${JSON.stringify(mutated, null, 2)}\n`,
    );
    const audit = auditMapProposalEquivalence(auditOptionsFor(fixture));
    expect(audit.totalMismatches).toBe(2);
    const kinds = audit.mismatches.map((mismatch) => mismatch.kind).sort();
    expect(kinds).toEqual(['ZERO_GROUP_MISMATCH', 'ZERO_GROUP_PRIORITY_MISMATCH']);
  });

  it('reports an orphan result row with no proposal', () => {
    const { fixture, rows } = buildStandardFixture();
    writeTextFile(join(fixture.runDir, 'reports', 'map-proposals.json'), `${JSON.stringify([], null, 2)}\n`);
    const audit = auditMapProposalEquivalence(auditOptionsFor(fixture));
    expect(rows.length).toBe(3);
    expect(audit.checked).toBe(3);
    expect(audit.totalMismatches).toBe(3);
    expect(audit.mismatches.every((mismatch) => mismatch.kind === 'ORPHAN_PROPOSAL')).toBe(true);
  });

  it('flags identity drift in the proposal target section labels', () => {
    const { fixture, proposals } = buildStandardFixture();
    const mutated = proposals.map((proposal) =>
      proposal.jobId === 'map-std-bb'
        ? { ...proposal, targetSectionLabels: ['9'] }
        : proposal,
    );
    writeTextFile(
      join(fixture.runDir, 'reports', 'map-proposals.json'),
      `${JSON.stringify(mutated, null, 2)}\n`,
    );
    const audit = auditMapProposalEquivalence(auditOptionsFor(fixture));
    expect(audit.totalMismatches).toBe(1);
    expect(audit.mismatches[0]).toMatchObject({ jobId: 'map-std-bb', kind: 'SECTION_LABELS_MISMATCH' });
  });
});

/* ------------------------------------------------------------------ *
 * Real data (skip when the gitignored canonical run is absent)        *
 * ------------------------------------------------------------------ */

const realRunDir = canonicalRunDir(FROZEN_MAP_RUN_ID);
const realFreezeReport = 'reports/study-map-final-freeze-20260901.json';
const realDecisionFile =
  'temp/study-ai-final-map-review/chatgpt-post-qc-map-review-decisions-FINAL-CANDIDATE.json';
const realDataPresent =
  existsSync(realFreezeReport) &&
  existsSync(join(realRunDir, 'results', 'local-map.results.jsonl')) &&
  existsSync(realDecisionFile);

describe.skipIf(!realDataPresent)('frozen canonical run (real data)', () => {
  it('freeze gate passes and equivalence audit finds zero mismatches', () => {
    const verification = verifyFrozenStudyMap();
    expect(verification.ok).toBe(true);
    expect(verification.issues).toEqual([]);
    expect(verification.resultRows).toBe(FROZEN_RESULT_ROW_COUNT);
    expect(verification.invalidRowIds).toEqual([]);
    expect(verification.priorityRecount).toEqual(FROZEN_PRIORITY_DISTRIBUTION);
    expect(verification.groupingCorrectionJobIds.sort()).toEqual(
      [...FROZEN_GROUPING_CORRECTION_JOB_IDS].sort(),
    );
    expect(verification.decisionFileSha256).toBe(verification.recordedDecisionFileSha256);
    expect(verification.proposalsSha256).toBe(verification.recordedProposalsSha256);

    const audit = auditMapProposalEquivalence();
    expect(audit.checked).toBe(FROZEN_RESULT_ROW_COUNT);
    expect(audit.totalMismatches).toBe(0);
    expect(audit.mismatches).toEqual([]);

    const groupedResults =
      FROZEN_RESULT_ROW_COUNT - (verification.priorityRecount.null ?? 0);
    console.log(
      `[real-data] verify-freeze ok; resultRows=${verification.resultRows} ` +
        `groupedResults=${groupedResults} zeroGroupResults=${verification.priorityRecount.null} ` +
        `invalid=0 mismatches=${audit.totalMismatches}`,
    );
  });
});
