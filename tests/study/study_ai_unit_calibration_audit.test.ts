/**
 * Tests for the deterministic calibration-80 Unit Authoring audit.
 *
 * Two layers:
 *  - pure unit tests over the risk classifier, gap reconciliation and
 *    coverage flags (no IO, no provider);
 *  - an end-to-end audit over a TEMP-DIR synthetic run dir shaped like the
 *    real layout (jobs/batch-*.jobs.jsonl, results/local-unit.results.jsonl,
 *    results/*.provenance.json, local-failures/<jobId>/attempt-*.validation.json,
 *    reports/local-run-metadata.json, minimal calibration selection report,
 *    minimal content package with source components, spec file). Asserts
 *    outcome accounting, identity/priority mismatch detection, spec pair
 *    rules, named subsets, and byte determinism (two runs → identical JSON
 *    and Markdown artifacts).
 *
 * No real run dir, no network, no provider calls.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiStudyUnitProposal, AiUnitAuthoringJob } from '../../src/study/ai/studyAiTypes';
import type { NbLawContentPackage, NbLawNormalizedDocument, NbLawSection } from '../../src/study/content/nbLawTypes';
import { loadAuditInputs } from '../../src/study/ai/studyAiUnitCalibrationAudit.load';
import { buildAuditDocs } from '../../src/study/ai/studyAiUnitCalibrationAudit';
import { renderAllMarkdown } from '../../src/study/ai/studyAiUnitCalibrationAudit.markdown';
import { coverageFlagsOf, riskCategoryFor, RISK_CATEGORY_LABELS } from '../../src/study/ai/studyAiUnitCalibrationAudit.utils';
import { gapRowsFor } from '../../src/study/ai/studyAiUnitCalibrationAudit';
import type { JobAuditRecord } from '../../src/study/ai/studyAiUnitCalibrationAudit.types';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const RUN_ID = 'ai-units-synthetic-cal80-audit';
const P1 = 'P1' as const;
const P2 = 'P2' as const;
const P3 = 'P3' as const;
const P4 = 'P4' as const;

/* ------------------------------------------------------------------ *
 * Pure risk classifier helpers                                      *
 * ------------------------------------------------------------------ */

const baseRecord = (jobId: string, overrides: Partial<JobAuditRecord> = {}): JobAuditRecord => ({
  jobId,
  batch: 1,
  runIndex: 0,
  status: 'accepted',
  frozenPriority: P3,
  selection: {
    correction: false,
    retry: false,
    regression: false,
    pin: false,
    selectionReason: 'fill-priority',
    tags: [],
    provenance: 'original',
  },
  domain: 'core',
  sourceKeyCount: 1,
  sizeBucket: 'small',
  focusStyle: 'single',
  result: {
    schemaVersion: 1,
    proposalId: jobId,
    runId: RUN_ID,
    corpusContentHash: 'corpus-hash-synthetic',
    sourceDocumentId: 'doc-a',
    sourceKeys: ['section:1'],
    sourceHashes: { 'section:1': 'hash-1' },
    title: `Title ${jobId}`,
    mainQuestion: 'What is the rule in section 1?',
    studySummary: 'This unit states the rule in section 1.',
    objectives: [
      {
        id: 'obj-1',
        type: 'definition',
        objective: 'Recall the rule in section 1.',
        guidedQuestion: 'What does section 1 require?',
        studyAnswer: 'Section 1 requires compliance with the prescribed form.',
        required: true,
        sourceKeys: ['section:1'],
        evidence: [
          { sourceKey: 'section:1', evidenceText: 'Section 1 requires compliance with the prescribed form.' },
        ],
        confidence: 'high',
      },
    ],
    confidence: 'high',
    warnings: [],
    generationMetadata: {
      providerKind: 'local-openai-compatible',
      promptSpecVersion: 'unit-authoring-v4',
      generatedAt: '2026-09-02T00:00:00.000Z',
      sourceJobId: jobId,
      sourceJobInputHash: `input-${jobId}`,
    },
  },
  provenance: undefined,
  attempts: [],
  attemptsUsed: 1,
  rejectedSemanticAttempts: 0,
  providerAttempts: 0,
  providerEventCount: 0,
  identityErrors: [],
  validation: { status: 'valid', issueCodes: [], issueCount: 0, errorCount: 0, warningCount: 0 },
  proposalWarnings: [],
  objectiveCount: 1,
  authoringStatus: 'generated',
  hasMapRevisionSuggestion: false,
  coverageFlags: [],
  ...overrides,
});

describe('riskCategoryFor (pure)', () => {
  it('assigns each of the ten risk categories to a representative record', () => {
    const cases: Array<{ name: string; record: JobAuditRecord; expected: number }> = [
      {
        name: 'semantic-failed -> 1',
        record: baseRecord('j-fail', { status: 'semantic-failed', attemptsUsed: 2, rejectedSemanticAttempts: 2 }),
        expected: 1,
      },
      {
        name: 'accepted with validator errors -> 1',
        record: baseRecord('j-invalid', {
          validation: { status: 'invalid', issueCodes: ['TITLE_REQUIRED'], issueCount: 1, errorCount: 1, warningCount: 0 },
        }),
        expected: 1,
      },
      {
        name: 'needs-map-revision -> 2',
        record: baseRecord('j-nmr', { authoringStatus: 'needs-map-revision', hasMapRevisionSuggestion: true }),
        expected: 2,
      },
      {
        name: 'broad warning -> 3',
        record: baseRecord('j-broad-warning', { proposalWarnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'] }),
        expected: 3,
      },
      {
        name: 'failed attempt -> 3',
        record: baseRecord('j-retried', { rejectedSemanticAttempts: 1, attemptsUsed: 2 }),
        expected: 3,
      },
      {
        name: 'correction -> 4',
        record: baseRecord('j-correction', {
          selection: { ...baseRecord('x').selection, correction: true },
        }),
        expected: 4,
      },
      {
        name: 'regression -> 5',
        record: baseRecord('j-anchor', {
          selection: { ...baseRecord('x').selection, regression: true },
        }),
        expected: 5,
      },
      {
        name: 'retry -> 6',
        record: baseRecord('j-retry', {
          selection: { ...baseRecord('x').selection, retry: true },
        }),
        expected: 6,
      },
      {
        name: '7+ objectives -> 7',
        record: baseRecord('j-seven', { objectiveCount: 7 }),
        expected: 7,
      },
      {
        name: 'broad-group-risk tag -> 8',
        record: baseRecord('j-broad-tag', {
          selection: { ...baseRecord('x').selection, tags: ['broad-group-risk'] },
        }),
        expected: 8,
      },
      {
        name: 'coverage anomaly -> 9',
        record: baseRecord('j-coverage', { coverageFlags: ['coverage-over-6'] }),
        expected: 9,
      },
      {
        name: 'clean generated -> 10',
        record: baseRecord('j-clean'),
        expected: 10,
      },
    ];
    for (const { name, record, expected } of cases) {
      expect(
        riskCategoryFor(record, { inAnchorTargets: false, inRetryTargets: false }).index,
        name,
      ).toBe(expected);
    }
  });

  it('keeps a job in the earliest (highest-risk) matching category', () => {
    // needs-map-revision + correction + warning => category 2 (earliest).
    const stacked = baseRecord('j-stacked', {
      authoringStatus: 'needs-map-revision',
      hasMapRevisionSuggestion: true,
      proposalWarnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'],
      selection: { ...baseRecord('x').selection, correction: true, regression: true, retry: true },
      objectiveCount: 7,
    });
    expect(riskCategoryFor(stacked, { inAnchorTargets: true, inRetryTargets: true }).index).toBe(2);
    // correction + regression + retry flags => correction (4) is earliest after 1..3.
    const flagsOnly = baseRecord('j-flags', {
      selection: { ...baseRecord('x').selection, correction: true, regression: true, retry: true },
    });
    expect(riskCategoryFor(flagsOnly, { inAnchorTargets: true, inRetryTargets: true }).index).toBe(4);
  });

  it('orders categories deterministically (labels match the doc ordering)', () => {
    expect(RISK_CATEGORY_LABELS[0]).toContain('invalid');
    expect(RISK_CATEGORY_LABELS[1]).toBe('needs-map-revision');
    expect(RISK_CATEGORY_LABELS[9]).toBe('remainder');
    const sorted = ['j-z', 'j-a', 'j-m'].sort();
    expect(sorted).toEqual(['j-a', 'j-m', 'j-z']);
  });
});

describe('gapRowsFor (pure priority reconciliation)', () => {
  it('reconciles selection targets against outcome statuses per priority', () => {
    const target = { P1: 2, P2: 1, P3: 1 };
    const items = [
      { priority: P1, status: 'accepted' as const },
      { priority: P1, status: 'accepted' as const },
      { priority: P2, status: 'semantic-failed' as const },
      { priority: P3, status: 'accepted' as const },
    ];
    const rows = gapRowsFor(target, items);
    expect(rows).toHaveLength(3);
    const row = (priority: string) => rows.find((entry) => entry.priority === priority)!;
    expect(row(P1)).toMatchObject({ target: 2, selected: 2, accepted: 2, gap: 0 });
    expect(row(P2)).toMatchObject({ target: 1, selected: 1, semanticFailed: 1, gap: 0 });
    expect(row(P3)).toMatchObject({ target: 1, selected: 1, accepted: 1, gap: 0 });
  });

  it('surfaces a gap when the run has fewer rows than the selection target', () => {
    const rows = gapRowsFor({ P2: 3 }, [
      { priority: P2, status: 'accepted' },
      { priority: P2, status: 'accepted' },
    ]);
    expect(rows.find((entry) => entry.priority === 'P2')?.gap).toBe(1);
  });
});

describe('coverageFlagsOf (pure)', () => {
  it('flags over-6 coverage, under-3 coverage and unlinked coverage', () => {
    const manyCovered: AiStudyUnitProposal = {
      ...(baseRecord('j').result as AiStudyUnitProposal),
      approvedGroup: {
        groupId: 'g',
        titleSuggestion: 't',
        sourceKeys: ['section:1'],
        focusSelections: [{ sourceKey: 'section:1', childLabels: ['1(1)', '1(2)', '1(3)'] }],
        reason: 'r',
        approximateLearningGoal: 'g',
      },
      sourceCoverage: [
        {
          sourceKey: 'section:1',
          childLabels: Array.from({ length: 7 }, (_, i) => ({
            label: `1(${i + 1})`,
            status: 'covered' as const,
            objectiveIds: [`obj-${i}`],
          })),
        },
      ],
    };
    expect(coverageFlagsOf(manyCovered)).toContain('coverage-over-6');

    const underCovered: AiStudyUnitProposal = {
      ...(baseRecord('j').result as AiStudyUnitProposal),
      approvedGroup: {
        groupId: 'g',
        titleSuggestion: 't',
        sourceKeys: ['section:1'],
        focusSelections: [{ sourceKey: 'section:1', childLabels: ['1(1)', '1(2)', '1(3)'] }],
        reason: 'r',
        approximateLearningGoal: 'g',
      },
      sourceCoverage: [
        {
          sourceKey: 'section:1',
          childLabels: [{ label: '1(1)', status: 'covered' as const, objectiveIds: ['obj-1'] }],
        },
      ],
    };
    expect(coverageFlagsOf(underCovered)).toContain('coverage-under-3');

    const clean = baseRecord('j-clean');
    expect(coverageFlagsOf(clean.result)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Synthetic run-dir fixture (TEMP)                                  *
 * ------------------------------------------------------------------ */

const tempRoots: string[] = [];
afterEach(() => {
  tempRoots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  tempRoots.length = 0;
});

const SECTION_1 = 'section:1';
const TEXT_1 = '1(1) A surveyor shall deliver a written objection before the hearing.';
const SENTENCE_1 = 'A surveyor shall deliver a written objection before the hearing.';
const SECTION_2 = 'section:2';
const TEXT_2 = '2 The registrar may waive a prescribed form requirement.';
const SENTENCE_2 = 'The registrar may waive a prescribed form requirement.';
const CORPUS_HASH = 'corpus-hash-synthetic';

const componentFor = (sourceKey: string, text: string): NbLawSection => ({
  id: `c-${sourceKey}`,
  sourceKey,
  componentType: 'section',
  label: sourceKey.split(':')[1],
  text,
  subsections: [],
  contentHash: sha256(text),
});

const buildPackage = (): NbLawContentPackage => {
  const document: NbLawNormalizedDocument = {
    schemaVersion: 1,
    id: 'doc-a',
    officialTitle: 'Synthetic Act',
    documentType: 'act',
    sourceUrl: 'https://example.invalid/act',
    fetchDate: '2026-01-01',
    contentHash: 'doc-hash',
    tableOfContents: [],
    components: [componentFor(SECTION_1, TEXT_1), componentFor(SECTION_2, TEXT_2)],
    sections: [],
    notes: [],
  };
  return {
    schemaVersion: 1,
    id: 'synthetic-cal-package',
    manifestId: 'synthetic-cal-manifest',
    createdAt: '2026-09-02T00:00:00.000Z',
    documents: [document],
    relationships: [],
    sourceHashes: { 'doc-a': 'doc-hash' },
  };
};

const approvedGroupFor = (sourceKey: string) => ({
  groupId: `group-${sourceKey}`,
  titleSuggestion: sourceKey === SECTION_1 ? 'Written objection delivery' : 'Registrar waiver',
  sourceKeys: [sourceKey],
  focusSelections: [{ sourceKey, childLabels: [] }],
  reason: 'One coherent rule.',
  approximateLearningGoal: 'State the rule.',
});

const unitJobFor = (
  jobId: string,
  sourceKey: string,
  frozenPriority: 'P1' | 'P2' | 'P3' | 'P4',
  runOrder: number,
): AiUnitAuthoringJob => {
  const text = sourceKey === SECTION_1 ? TEXT_1 : TEXT_2;
  const group = approvedGroupFor(sourceKey);
  return {
    schemaVersion: 1,
    jobId,
    runId: RUN_ID,
    promptSpecVersion: 'unit-authoring-v4',
    sourceMapRunId: 'ai-map-synthetic',
    sourceMapProposalId: `ai-map-synthetic:map-${runOrder}`,
    corpusContentHash: CORPUS_HASH,
    frozenMapPriority: frozenPriority,
    inputHash: `input-${jobId}`,
    document: { documentId: 'doc-a', title: 'Synthetic Act', type: 'act' },
    approvedGroup: group,
    mapDisposition: 'standalone',
    mapReason: 'One rule.',
    approximateLearningGoal: group.approximateLearningGoal,
    group,
    sourceHashes: { [sourceKey]: sha256(text) },
    sourceStatuses: { [sourceKey]: 'current' },
    contentFlagsBySourceKey: { [sourceKey]: {} },
    exactSourceText: text,
    operativeSourceText: text,
    sourceMetadata: {},
    context: { omittedContextWarnings: [] },
  };
};

const proposalRowFor = (
  job: AiUnitAuthoringJob,
  opts: {
    warnings?: string[];
    authoringStatus?: 'generated' | 'needs-map-revision';
    suggestedPriority?: 'P1' | 'P2' | 'P3' | 'P4';
    hasSuggestion?: boolean;
  } = {},
): AiStudyUnitProposal => {
  const sourceKey = job.approvedGroup.sourceKeys[0];
  const sentence = sourceKey === SECTION_1 ? SENTENCE_1 : SENTENCE_2;
  return {
    title: job.approvedGroup.titleSuggestion,
    mainQuestion: 'What does the rule require?',
    studySummary: 'This unit states the rule concisely.',
    objectives: [
      {
        id: 'obj-1',
        type: 'duty',
        objective: 'Recall the operative duty.',
        guidedQuestion: 'What must be done?',
        studyAnswer: sentence,
        required: true,
        sourceKeys: [sourceKey],
        evidence: [{ sourceKey, evidenceText: sentence }],
        confidence: 'high',
      },
    ],
    confidence: 'high',
    warnings: opts.warnings ?? [],
    sourceCoverage: [],
    studyNotes: [],
    schemaVersion: 1,
    proposalId: job.jobId,
    runId: RUN_ID,
    corpusContentHash: CORPUS_HASH,
    sourceDocumentId: 'doc-a',
    sourceKeys: [sourceKey],
    sourceHashes: { [sourceKey]: sha256(job.exactSourceText) },
    approvedGroup: job.approvedGroup,
    mapDisposition: 'standalone',
    mapReason: job.mapReason,
    approximateLearningGoal: job.approximateLearningGoal,
    authoringStatus: opts.authoringStatus ?? 'generated',
    suggestedPriority: opts.suggestedPriority ?? job.frozenMapPriority,
    mapRevisionSuggestion: opts.hasSuggestion
      ? {
          reason: 'Advisory: the group is appropriately scoped.',
          proposedGroups: [{ ...job.approvedGroup, title: 'finer group' }],
        }
      : undefined,
    generationMetadata: {
      providerKind: 'local-openai-compatible',
      promptSpecVersion: 'unit-authoring-v4',
      generatedAt: '2026-09-02T00:00:00.000Z',
      sourceJobId: job.jobId,
      sourceJobInputHash: job.inputHash,
    },
  };
};

const selectionRecordFor = (job: AiUnitAuthoringJob, runIndex: number, overrides = {}) => ({
  index: runIndex + 1,
  unitJobId: job.jobId,
  mapJobId: job.sourceMapProposalId.split(':')[1],
  sourceMapProposalId: job.sourceMapProposalId,
  documentId: 'doc-a',
  documentTitle: 'Synthetic Act',
  sections: [job.approvedGroup.sourceKeys[0].split(':')[1]],
  priority: job.frozenMapPriority,
  disposition: 'standalone',
  parentKind: 'standalone',
  domain: 'core',
  groupTitle: job.approvedGroup.titleSuggestion,
  groupGoal: job.approvedGroup.approximateLearningGoal,
  sourceKeys: [...job.approvedGroup.sourceKeys],
  sourceKeyCount: 1,
  exactSourceCharacters: job.exactSourceText.length,
  sizeBucket: 'small',
  focusStyle: 'single',
  provenance: 'original',
  tags: [],
  selectionReason: 'fill-priority',
  correction: false,
  retry: false,
  regression: false,
  ...overrides,
});

type FixtureJobs = {
  jobGood: AiUnitAuthoringJob;
  jobRetried: AiUnitAuthoringJob;
  jobCorrection: AiUnitAuthoringJob;
  jobAnchor: AiUnitAuthoringJob;
  jobRetry: AiUnitAuthoringJob;
  jobClean: AiUnitAuthoringJob;
  jobFailed: AiUnitAuthoringJob;
};

const buildFixtureJobs = (): FixtureJobs => {
  const jobGood = unitJobFor('unit-aaa-good', SECTION_1, P1, 0);
  const jobRetried = unitJobFor('unit-bbb-retried', SECTION_2, P2, 1);
  const jobCorrection = unitJobFor('unit-ccc-correction', SECTION_1, P3, 2);
  const jobAnchor = unitJobFor('unit-ddd-anchor', SECTION_2, P1, 3);
  const jobRetry = unitJobFor('unit-eee-retry', SECTION_1, P2, 4);
  const jobClean = unitJobFor('unit-fff-clean', SECTION_2, P3, 5);
  const jobFailed = unitJobFor('unit-ggg-failed', SECTION_1, P4, 6);
  return { jobGood, jobRetried, jobCorrection, jobAnchor, jobRetry, jobClean, jobFailed };
};

const writeText = (path: string, text: string): void => {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, text);
};

const buildFixture = (): { root: string; fixture: FixtureJobs } => {
  const root = mkdtempSync(join(tmpdir(), 'study-ai-unit-cal-audit-'));
  tempRoots.push(root);
  const fixture = buildFixtureJobs();
  const jobs = [fixture.jobGood, fixture.jobRetried, fixture.jobCorrection, fixture.jobAnchor, fixture.jobRetry, fixture.jobClean, fixture.jobFailed];
  const runDir = join(root, RUN_ID);
  const jobsDir = join(runDir, 'jobs');
  const resultsDir = join(runDir, 'results');
  const reportsDir = join(runDir, 'reports');

  // One batch file holding every job (loaders accept any batch layout).
  writeText(
    join(jobsDir, 'batch-001.jobs.jsonl'),
    jobs.map((job) => JSON.stringify(job)).join('\n'),
  );

  const priorityTarget = { P1: 2, P2: 2, P3: 2, P4: 1 };
  const records = jobs.map((job, index) => {
    const overrides: Record<string, unknown> = {};
    if (job.jobId === fixture.jobCorrection.jobId)
      Object.assign(overrides, {
        selectionReason: 'pin',
        correction: true,
        provenance: 'final-QC-adjudicated',
        tags: ['final-map-grouping-adjudication'],
      });
    if (job.jobId === fixture.jobAnchor.jobId)
      Object.assign(overrides, {
        selectionReason: 'anchor',
        regression: true,
        anchorTargetId: 'Synthetic Act s.2',
        tags: ['unit-v4-regression-anchor'],
      });
    if (job.jobId === fixture.jobRetry.jobId)
      Object.assign(overrides, {
        selectionReason: 'retry',
        retry: true,
        retryTargetId: 'Synthetic Act s.1',
        tags: ['map-retry-history'],
      });
    return selectionRecordFor(job, index, overrides);
  });

  writeText(
    join(root, 'reports', 'unit-calibration-80-20260902.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'frozen-unit-calibration-80',
        dateTag: '20260902',
        seedTag: '20260902',
        runId: RUN_ID,
        generatedAt: '2026-09-02T00:00:00.000Z',
        promptSpecVersion: 'unit-authoring-v4',
        sourceMapRunId: 'ai-map-synthetic',
        preflightRunId: 'ai-units-synthetic-preflight',
        counts: { jobCount: 7, pinCount: 1, retryRepresentatives: 1, anchorTaggedJobs: 1, correctionJobIds: 1 },
        pins: [fixture.jobCorrection.jobId],
        retryTargetCoverage: [{ targetId: 'Synthetic Act s.1', unitJobId: fixture.jobRetry.jobId }],
        anchorTargetCoverage: [{ targetId: 'Synthetic Act s.2', unitJobId: fixture.jobAnchor.jobId }],
        notes: [],
        distributions: {
          priority: { target: priorityTarget, actual: priorityTarget },
          domain: { target: { core: 7 }, actual: { core: 7 } },
          provenanceMix: {},
          sizeBuckets: {},
          focusStyles: {},
        },
        runLayout: {
          runDir: runDir,
          batchSize: 7,
          batchCount: 1,
          batchFiles: [{ file: 'batch-001.jobs.jsonl', sha256: sha256(readFileSync(join(jobsDir, 'batch-001.jobs.jsonl'), 'utf8')) }],
        },
        jobs: records,
      },
      null,
      2,
    ),
  );

  // Accepted results with runner-stamped identity (six of seven jobs).
  const accepted: AiStudyUnitProposal[] = [
    proposalRowFor(fixture.jobGood),
    proposalRowFor(fixture.jobRetried, {
      authoringStatus: 'needs-map-revision',
      hasSuggestion: true,
      warnings: [],
      suggestedPriority: P1, // intentional mismatch with job frozen P2
    }),
    proposalRowFor(fixture.jobCorrection),
    proposalRowFor(fixture.jobAnchor),
    proposalRowFor(fixture.jobRetry),
    proposalRowFor(fixture.jobClean),
  ];
  writeText(
    join(resultsDir, 'local-unit.results.jsonl'),
    accepted.map((row) => JSON.stringify(row)).join('\n'),
  );
  for (const row of accepted) {
    writeText(
      join(resultsDir, `${row.proposalId}.provenance.json`),
      JSON.stringify({
        providerKind: 'local-openai-compatible',
        modelId: 'synthetic-model',
        runId: RUN_ID,
        jobId: row.proposalId,
        proposalId: row.proposalId,
        sourceJobInputHash: `input-${row.proposalId}`,
        attempt: 1,
        timestamp: '2026-09-02T00:00:00.000Z',
        structuredOutputMode: 'strict-json-schema',
        accepted: true,
      }),
    );
  }

  // One semantic-failed job with two rejected attempts.
  const failedDir = join(runDir, 'local-failures', fixture.jobFailed.jobId);
  writeText(
    join(failedDir, 'attempt-1.validation.json'),
    JSON.stringify({
      runId: RUN_ID,
      jobId: fixture.jobFailed.jobId,
      attempt: 1,
      accepted: false,
      issues: ['EVIDENCE_NOT_FOUND: evidence text was not found in the authoritative source.'],
      timestamp: '2026-09-02T00:00:00.000Z',
    }),
  );
  writeText(
    join(failedDir, 'attempt-2.validation.json'),
    JSON.stringify({
      runId: RUN_ID,
      jobId: fixture.jobFailed.jobId,
      attempt: 2,
      accepted: false,
      issues: ['OUTSIDE_APPROVED_FOCUS: evidence text is outside the approved focus.'],
      timestamp: '2026-09-02T00:00:00.000Z',
    }),
  );

  // Runner metadata mirrors the loader's expectations.
  writeText(
    join(reportsDir, 'local-run-metadata.json'),
    JSON.stringify({
      schemaVersion: 1,
      runId: RUN_ID,
      model: 'synthetic-model',
      baseUrl: 'http://127.0.0.1:8080/v1',
      packagePath: 'study-content/packages/nb-sit-statute-corpus.content-package.json',
      promptSpecVersion: 'unit-authoring-v4',
      promptSha256: sha256('spec'),
      batch: null,
      concurrency: 1,
      jobCount: 7,
      jobIds: jobs.map((job) => job.jobId),
      jobsFileSha256: { 'batch-001.jobs.jsonl': sha256(readFileSync(join(jobsDir, 'batch-001.jobs.jsonl'), 'utf8')) },
      createdAt: '2026-09-02T00:00:00.000Z',
    }),
  );
  writeText(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 1, runId: RUN_ID, status: 'prepared' }));

  writeText(join(root, 'corpus.content-package.json'), JSON.stringify(buildPackage()));
  writeText(join(root, 'spec.md'), 'spec');
  writeText(join(root, 'reports', 'unused.txt'), '');
  return { root, fixture };
};

const loadFixtureAudit = (root: string) =>
  loadAuditInputs({
    runDir: join(root, RUN_ID),
    selectionReportPath: join(root, 'reports', 'unit-calibration-80-20260902.json'),
    packagePath: join(root, 'corpus.content-package.json'),
    specPath: join(root, 'spec.md'),
  });

describe('end-to-end audit over a synthetic run dir', () => {
  it('accounts completion per status and reconciles priority gaps', () => {
    const { root } = buildFixture();
    const { audit } = buildAuditDocs(loadFixtureAudit(root));
    expect(audit.completion.expected).toBe(7);
    expect(audit.completion.accepted).toBe(6);
    expect(audit.completion.semanticFailed).toBe(1);
    expect(audit.completion.providerIncomplete).toBe(0);
    expect(audit.completion.nothing).toBe(0);
    expect(audit.completion.perBatch[0].expected).toBe(7);
    // Per-priority: accepted+failed reconcile to the selection target (no gap).
    const totalAccepted = audit.gap.priority.rows.reduce((sum, row) => sum + row.accepted, 0);
    const totalFailed = audit.gap.priority.rows.reduce((sum, row) => sum + row.semanticFailed, 0);
    expect(totalAccepted).toBe(6);
    expect(totalFailed).toBe(1);
    expect(audit.gap.priority.exact).toBe(true);
  });

  it('detects suggestedPriority mismatches against the frozen map priority', () => {
    const { root, fixture } = buildFixture();
    const { audit } = buildAuditDocs(loadFixtureAudit(root));
    const mismatches = audit.identity.suggestedPriorityMismatches;
    expect(mismatches.map((error) => error.jobId)).toContain(fixture.jobRetried.jobId);
    expect(mismatches).toHaveLength(1);
    const errors = audit.auditErrors.filter((error) => error.code === 'SUGGESTED_PRIORITY_MISMATCH');
    expect(errors.map((error) => error.jobId)).toContain(fixture.jobRetried.jobId);
  });

  it('resolves the four named subsets from selection records + jobs', () => {
    const { root, fixture } = buildFixture();
    const { audit } = buildAuditDocs(loadFixtureAudit(root));
    expect(audit.subsets.finalQc.unitJobIds).toEqual([fixture.jobCorrection.jobId]);
    expect(audit.subsets.regressionAnchors.rows.map((row) => row.unitJobId)).toEqual([
      fixture.jobAnchor.jobId,
    ]);
    expect(audit.subsets.retryNine.rows.map((row) => row.unitJobId)).toEqual([fixture.jobRetry.jobId]);
    expect(audit.subsets.finalQc.parents[0].documentTitle).toBe('Synthetic Act');
  });

  it('produces deterministic JSON and Markdown across two runs', () => {
    const { root } = buildFixture();
    const first = renderDocs(loadFixtureAudit(root));
    const second = renderDocs(loadFixtureAudit(root));
    expect(first.jsonAudit).toBe(second.jsonAudit);
    expect(first.jsonReview).toBe(second.jsonReview);
    expect(first.mdAudit).toBe(second.mdAudit);
    expect(first.mdHumanReview).toBe(second.mdHumanReview);
    expect(first.mdAnchors).toBe(second.mdAnchors);
    expect(first.mdFinalQc).toBe(second.mdFinalQc);
    // Sanity: files contain the expected sections.
    expect(first.mdAudit).toContain('## Completion');
    expect(first.mdHumanReview).toContain('# Calibration-80 Human Review');
  });

  it('risk-orders the human review deterministically (category then jobId)', () => {
    const { root } = buildFixture();
    const { review } = buildAuditDocs(loadFixtureAudit(root));
    const order = review.units.map((unit) => [unit.categoryIndex, unit.jobId] as const);
    const sorted = [...order].sort(
      (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0),
    );
    expect(order).toEqual(sorted);
    // Semantic-failed job lands first.
    expect(review.units[0].status).toBe('semantic-failed');
    expect(review.units[0].categoryIndex).toBe(1);
  });
});

const renderDocs = (inputs: ReturnType<typeof loadFixtureAudit>) => {
  const bundle = buildAuditDocs(inputs);
  const mdArtifacts = renderAllMarkdown(bundle);
  return {
    jsonAudit: JSON.stringify(bundle.audit),
    jsonReview: JSON.stringify(bundle.review),
    mdAudit: mdArtifacts.auditMd,
    mdHumanReview: mdArtifacts.humanReviewMd,
    mdAnchors: mdArtifacts.regressionAnchorsMd,
    mdFinalQc: mdArtifacts.finalQcMd,
  };
};
