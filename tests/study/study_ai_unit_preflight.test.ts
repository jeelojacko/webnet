/**
 * Tests for `runFrozenUnitPreflight` (frozen unit preflight).
 *
 * Synthetic fixtures exercise a full mini frozen run (2 corpus documents;
 * standalone 1-group, split 2-group, combine 2-source group, skip result) and
 * assert exact expected job counts and identity sets. A freeze-gate failure
 * aborts the preflight before anything is written. A real-data test (skipped
 * when the gitignored canonical run or package is absent) asserts the brief
 * guarantees on the actual frozen run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapProposal, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import type {
  NbLawContentPackage,
  NbLawNormalizedDocument,
} from '../../src/study/content/nbLawTypes';
import {
  FROZEN_MAP_RUN_ABBREV_ID,
  FROZEN_MAP_RUN_ID,
  canonicalRunDir,
} from '../../src/study/ai/studyAiMapFreezeGate';
import { hashText } from '../../src/study/ai/studyAiUnitJobPrep';
import {
  FROZEN_UNIT_PREFLIGHT_RUN_ID,
  runFrozenUnitPreflight,
} from '../../src/study/ai/studyAiUnitPreflight';
import {
  createFrozenRunFixture,
  makeGroup,
  makeJob,
  makeProposal,
  makeResult,
  sha256Of,
  writeFreezeReport,
  writeJobs,
  writeJsonFile,
  writeProposals,
  writeResultsJsonl,
  writeTextFile,
  type FrozenRunFixture,
} from './study_ai_frozen_fixtures';

const CORPUS_HASH = 'corpus-hash-preflight';
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

/* ------------------------------------------------------------------ *
 * Synthetic mini frozen run                                          *
 * ------------------------------------------------------------------ */

const sha256 = (value: string): string => sha256Of(value);

const docA: NbLawNormalizedDocument = {
  schemaVersion: 1,
  id: 'doc-preflight-act-a',
  officialTitle: 'Preflight Synthetic Act',
  documentType: 'act' as const,
  sourceUrl: 'https://example.invalid/psa',
  fetchDate: '2026-09-02',
  contentHash: sha256('doc-preflight-act-a'),
  tableOfContents: [],
  components: [
    {
      id: 'section-1',
      sourceKey: 'section:1',
      componentType: 'section' as const,
      label: '1',
      text: '1(1)A surveyor shall certify the plan before filing.\n1(2)The certificate shall name the surveyor.',
      subsections: [],
      contentHash: sha256('section:1'),
    },
    {
      id: 'section-2',
      sourceKey: 'section:2',
      componentType: 'section' as const,
      label: '2',
      text: '2(1)A plan shall be registered in the registry office.\n2(2)Monuments shall be set at the corners.',
      subsections: [],
      contentHash: sha256('section:2'),
    },
    {
      id: 'section-3',
      sourceKey: 'section:3',
      componentType: 'section' as const,
      label: '3',
      text: '3 The Minister may issue guidelines respecting survey plans.',
      subsections: [],
      contentHash: sha256('section:3'),
    },
    {
      id: 'section-4',
      sourceKey: 'section:4',
      componentType: 'section' as const,
      label: '4',
      text: '4 Guidelines issued under section 3 shall be published.',
      subsections: [],
      contentHash: sha256('section:4'),
    },
  ],
  sections: [],
  notes: [],
};

const docB: NbLawNormalizedDocument = {
  schemaVersion: 1,
  id: 'doc-preflight-reg-b',
  officialTitle: 'Preflight Synthetic Regulation',
  documentType: 'regulation' as const,
  sourceUrl: 'https://example.invalid/psr',
  fetchDate: '2026-09-02',
  contentHash: sha256('doc-preflight-reg-b'),
  tableOfContents: [],
  components: [
    {
      id: 'section-5',
      sourceKey: 'section:5',
      componentType: 'section' as const,
      label: '5',
      text: '5 A person shall not obstruct a surveyor in the execution of duties.',
      subsections: [],
      contentHash: sha256('section:5'),
    },
  ],
  sections: [],
  notes: [],
};

const corpusPackage = (): NbLawContentPackage => ({
  schemaVersion: 1,
  id: 'preflight-synthetic-corpus-20260902',
  manifestId: 'preflight-synthetic-corpus-20260902',
  createdAt: '2026-09-02T00:00:00.000Z',
  documents: [docA, docB],
  relationships: [],
  sourceHashes: {
    [docA.id]: sha256('doc-preflight-act-a'),
    [docB.id]: sha256('doc-preflight-reg-b'),
  },
});

/**
 * Build the standard synthetic preflight fixture: 4 canonical rows —
 * standalone (P2, 1 group), split (P3, 2 groups), combine (P1, 1 group with
 * 2 sources), skip (null, 0 groups). Writes results/proposals/jobs/decision/
 * freeze report/corpus package. Expects exactly 4 unit jobs.
 */
const buildMiniFixture = (): { fixture: FrozenRunFixture; rows: AiStudyMapResult[]; proposals: AiStudyMapProposal[] } => {
  const fixture = track(createFrozenRunFixture(FROZEN_MAP_RUN_ID));

  const jobSpecs: Array<{ jobId: string; documentId: string; documentTitle: string; sourceKeys: string[]; labels: string[] }> = [
    { jobId: 'map-std-aa', documentId: docA.id, documentTitle: docA.officialTitle, sourceKeys: ['section:1'], labels: ['1'] },
    { jobId: 'map-split-bb', documentId: docA.id, documentTitle: docA.officialTitle, sourceKeys: ['section:2'], labels: ['2'] },
    { jobId: 'map-comb-cc', documentId: docA.id, documentTitle: docA.officialTitle, sourceKeys: ['section:3', 'section:4'], labels: ['3', '4'] },
    { jobId: 'map-skip-dd', documentId: docB.id, documentTitle: docB.officialTitle, sourceKeys: ['section:5'], labels: ['5'] },
  ];
  const jobs: AiStudyMapJob[] = jobSpecs.map((spec) => {
    const job = makeJob({
      jobId: spec.jobId,
      runId: FROZEN_MAP_RUN_ABBREV_ID,
      documentId: spec.documentId,
      documentTitle: spec.documentTitle,
      sectionKey: spec.sourceKeys[0],
      sectionLabel: spec.labels[0],
      corpusContentHash: CORPUS_HASH,
    });
    // Multi-section targets (combine) span every target sourceKey/label.
    return { ...job, target: { ...job.target, sourceKeys: [...spec.sourceKeys], sectionLabels: [...spec.labels] } };
  });
  writeJobs(fixture.runDir, jobs);
  const jobByJobId = new Map(jobs.map((job) => [job.jobId, job]));

  const makeGroupFor = (
    groupId: string,
    sourceKeys: string[],
    evidenceText: string[],
  ): AiStudyMapResult['proposedGroups'][number] =>
    makeGroup({
      groupId,
      sourceKeys,
      evidenceText,
      reason: `Reason for ${groupId}`,
      learningGoal: `Learning goal for ${groupId}`,
      title: `Title for ${groupId}`,
    });

  const rows: AiStudyMapResult[] = [
    makeResult({
      jobId: 'map-std-aa',
      runId: FROZEN_MAP_RUN_ABBREV_ID,
      corpusContentHash: CORPUS_HASH,
      disposition: 'standalone',
      suggestedPriority: 'P2',
      proposedGroups: [
        makeGroupFor('g1', ['section:1'], ['A surveyor shall certify the plan before filing']),
      ],
    }),
    makeResult({
      jobId: 'map-split-bb',
      runId: FROZEN_MAP_RUN_ABBREV_ID,
      corpusContentHash: CORPUS_HASH,
      disposition: 'split',
      suggestedPriority: 'P3',
      proposedGroups: [
        makeGroupFor('g1', ['section:2'], []),
        makeGroupFor('g2', ['section:2'], []),
      ],
    }),
    makeResult({
      jobId: 'map-comb-cc',
      runId: FROZEN_MAP_RUN_ABBREV_ID,
      corpusContentHash: CORPUS_HASH,
      disposition: 'combine',
      suggestedPriority: 'P1',
      proposedGroups: [
        makeGroup({
          groupId: 'gc',
          sourceKeys: ['section:3', 'section:4'],
          title: 'Guidelines for survey plans',
          reason: 'Guideline issuance and publication together.',
          learningGoal: 'Recall guideline issuance and publication duties.',
        }),
      ],
    }),
    makeResult({
      jobId: 'map-skip-dd',
      runId: FROZEN_MAP_RUN_ABBREV_ID,
      corpusContentHash: CORPUS_HASH,
      disposition: 'skip',
      suggestedPriority: null,
      proposedGroups: [],
    }),
  ];
  writeResultsJsonl(fixture.runDir, rows);
  const proposals: AiStudyMapProposal[] = rows.map((row) => {
    const job = jobByJobId.get(row.jobId);
    if (!job) throw new Error(`missing job ${row.jobId}`);
    return makeProposal(row, job);
  });
  writeProposals(fixture.runDir, proposals);
  writeJsonFile(fixture.corpusPackagePath, corpusPackage());
  writeTextFile(fixture.decisionFilePath, DECISION_TEXT);
  writeFreezeReport(
    fixture,
    {
      runId: FROZEN_MAP_RUN_ID,
      resultRows: 4,
      priorityDistribution: { P1: 1, P2: 1, P3: 1, null: 1 },
      groupingJobIds: [],
    },
    DECISION_TEXT,
    `${JSON.stringify(proposals, null, 2)}\n`,
  );
  return { fixture, rows, proposals };
};

const miniOptions = (fixture: FrozenRunFixture) => ({
  freezeReportPath: fixture.freezeReportPath,
  runDir: fixture.runDir,
  decisionFilePath: fixture.decisionFilePath,
  corpusPackagePath: fixture.corpusPackagePath,
  runDirRoot: fixture.root,
  expectedResultRows: 4,
  expectedPriorityDistribution: { P1: 1, P2: 1, P3: 1, null: 1 },
  groupingCorrectionJobIds: [],
});

const expectedJobIdsFor = (proposals: AiStudyMapProposal[]): string[] =>
  proposals.flatMap((proposal) =>
    proposal.proposedGroups.map(
      (group) =>
        `unit-${hashText(
          JSON.stringify({
            mapRunId: FROZEN_MAP_RUN_ID,
            proposalId: proposal.id,
            groupId: group.groupId,
            promptSpecVersion: 'unit-authoring-v4',
            sourceKeys: group.sourceKeys,
          }),
        ).slice(0, 16)}`,
    ),
  );

describe('runFrozenUnitPreflight (synthetic mini run)', () => {
  it('builds exactly the expected jobs with the expected identity set', () => {
    const { fixture, proposals } = buildMiniFixture();
    const result = runFrozenUnitPreflight(miniOptions(fixture));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts).toEqual({
      totalResults: 4,
      groupedResults: 3,
      zeroGroupResults: 1,
      proposedGroups: 4,
      expectedJobs: 4,
      jobs: 4,
    });
    expect(result.bypasses.groupedProposals).toBe(3);
    expect(result.bypasses.eligibleProposals).toBe(3);
    expect(result.bypasses.zeroJobDispositions).toEqual({ skip: 1 });
    expect(result.validation.issuesTotal).toBe(0);
    expect(result.validation.checkedJobs).toBe(4);
    expect(result.distributions.priority).toEqual({ P1: 1, P2: 1, P3: 2 });
    expect(result.distributions.disposition).toEqual({ standalone: 1, split: 2, combine: 1 });
    expect(result.distributions.sourceCount).toEqual({ '1': 3, '2': 1 });
    expect(result.distributions.combine).toEqual({ combineJobs: 1, multiSourceJobs: 1, maxSourceKeys: 2 });
    const actualJobIds = result.jobs.map((job) => job.jobId).sort();
    expect(actualJobIds).toEqual(expectedJobIdsFor(proposals).sort());
    expect(new Set(actualJobIds).size).toBe(4);
    expect(result.layout.batchCount).toBe(1);
    expect(existsSync(join(fixture.root, FROZEN_UNIT_PREFLIGHT_RUN_ID, 'run.json'))).toBe(true);
    expect(
      existsSync(
        join(fixture.root, FROZEN_UNIT_PREFLIGHT_RUN_ID, 'jobs', 'batch-001.jobs.jsonl'),
      ),
    ).toBe(true);
  });

  it('aborts fail-closed on a freeze-gate failure and writes no run', () => {
    const { fixture } = buildMiniFixture();
    writeTextFile(fixture.freezeReportPath, 'not json at all');
    const result = runFrozenUnitPreflight(miniOptions(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('gate');
    expect(result.issues.join('\n')).toContain('FREEZE_REPORT_UNREADABLE');
    expect(existsSync(join(fixture.root, FROZEN_UNIT_PREFLIGHT_RUN_ID))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Real data (skip when the gitignored canonical run is absent)        *
 * ------------------------------------------------------------------ */

const realRunDir = canonicalRunDir(FROZEN_MAP_RUN_ID);
const realPackage = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const realDataPresent =
  existsSync(realRunDir) &&
  existsSync(join(realRunDir, 'reports', 'map-proposals.json')) &&
  existsSync(realPackage);

describe.skipIf(!realDataPresent)('frozen canonical run preflight (real data)', () => {
  it('builds 4,251 jobs with the frozen priority distribution and a clean validation', { timeout: 300000 }, () => {
    const result = runFrozenUnitPreflight();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts.totalResults).toBe(3692);
    expect(result.counts.groupedResults).toBe(2971);
    expect(result.counts.zeroGroupResults).toBe(721);
    expect(result.counts.proposedGroups).toBe(4251);
    expect(result.counts.jobs).toBe(4251);
    expect(result.distributions.priority).toEqual({ P1: 382, P2: 2236, P3: 1312, P4: 321 });
    expect(result.validation.issuesTotal).toBe(0);
    expect(result.cardinality.everyProposalGroupOnce).toBe(true);
    expect(result.cardinality.uniqueJobIds).toBe(4251);
    console.log(
      `[real-data] preflight ok; jobs=${result.counts.jobs} expected=${result.counts.expectedJobs} ` +
        `priority=${JSON.stringify(result.distributions.priority)} validationIssues=0 ` +
        `batchFiles=${result.layout.batchCount} bypasses=${JSON.stringify({
          needsReview: result.bypasses.needsReviewAccepted,
          conflicts: result.bypasses.conflictCodedAccepted,
        })}`,
    );
    expect(
      existsSync(
        join('study-content', 'ai', 'runs', FROZEN_UNIT_PREFLIGHT_RUN_ID, 'run.json'),
      ),
    ).toBe(true);
  });
});
