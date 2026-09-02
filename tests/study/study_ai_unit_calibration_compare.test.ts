/**
 * Tests for the deterministic V4/V5 calibration comparison + side-by-side
 * human review (WV5).
 *
 * Layers:
 *  - pure unit tests: the contradictory-phrase detector (the five V5 phrases,
 *    case-insensitive), revision-consistency flags, the six-tier risk
 *    ordering (one crafted job per tier), side-row classification and the
 *    transition matrix 'no-accepted-result' handling;
 *  - an end-to-end comparison over TEMP-DIR synthetic fixtures (two 3-job
 *    runs + a 3-row crosswalk + a V4 human-review artifact) asserting matrix
 *    counts, tier assignment, missing-V5-result handling, OCR outcome,
 *    byte-determinism across two full load+build passes, and the loader's
 *    fail-closed naming of a missing crosswalk job id.
 *
 * No provider calls, no wall clock, no network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiStudyUnitProposal, AiUnitAuthoringJob } from '../../src/study/ai/studyAiTypes';
import type { UnitAttemptRecord } from '../../src/study/ai/studyAiUnitCalibrationAudit.types';
import type { NbLawContentPackage, NbLawNormalizedDocument, NbLawSection } from '../../src/study/content/nbLawTypes';
import { buildCompareDocs } from '../../src/study/ai/studyAiUnitCalibrationCompare';
import type { CompareContext } from '../../src/study/ai/studyAiUnitCalibrationCompare.types';
import { renderComparisonMarkdown, renderCompareHumanReviewMarkdown } from '../../src/study/ai/studyAiUnitCalibrationCompare.markdown';
import { loadCompareContext } from '../../src/study/ai/studyAiUnitCalibrationCompare.load';
import {
  CONTRADICTORY_REVISION_PHRASES,
  authoringStatusKeyOf,
  contradictoryPhraseHit,
  countBy,
  revisionConsistencyBucketsOf,
  sideRowOf,
  statusTransitionMatrixOf,
  tierIndexOf,
  type CompareTierInput,
} from '../../src/study/ai/studyAiUnitCalibrationCompare.utils';
import { OCR_TARGET_STRINGS } from '../../src/study/ai/studyAiUnitCalibrationCompare.types';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const tempRoots: string[] = [];
afterEach(() => {
  tempRoots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  tempRoots.length = 0;
});

const writeText = (path: string, text: string): void => {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, text);
};

const noopValidation = (): ReturnType<NonNullable<CompareContext['validate']>> => ({
  status: 'valid',
  issueCodes: [],
  errorCodes: [],
  warningCodes: [],
  errorCount: 0,
  warningCount: 0,
});

/* ------------------------------------------------------------------ *
 * Pure detectors and classifiers                                     *
 * ------------------------------------------------------------------ */

describe('contradictoryPhraseHit (case-insensitive, 5 phrases)', () => {
  it('hits each of the five V5 contradictory phrases verbatim', () => {
    expect(CONTRADICTORY_REVISION_PHRASES).toHaveLength(5);
    for (const phrase of CONTRADICTORY_REVISION_PHRASES) {
      expect(contradictoryPhraseHit(`Because ${phrase} for this group.`)).toBe(phrase);
    }
  });

  it('matches case-insensitively and across whitespace', () => {
    expect(contradictoryPhraseHit('NO REVISION NEEDED')).toBe('no revision needed');
    expect(contradictoryPhraseHit('No Further Revision   Is Required now')).toBe(
      'no further revision is required',
    );
    expect(contradictoryPhraseHit('CURRENT GROUPING IS APPROPRIATE.')).toBe(
      'current grouping is appropriate',
    );
  });

  it('returns null for a source-grounded revision reason', () => {
    expect(
      contradictoryPhraseHit(
        'The approved focus joins two disjoint propositions that cannot form one coherent unit.',
      ),
    ).toBeNull();
  });
});

describe('revision-consistency flags (target zero under the V5 contract)', () => {
  const proposalFor = (
    overrides: Partial<AiStudyUnitProposal>,
  ): AiStudyUnitProposal =>
    ({
      schemaVersion: 1,
      proposalId: 'p-1',
      runId: 'run-v5',
      corpusContentHash: 'corpus',
      sourceDocumentId: 'doc-a',
      sourceKeys: ['section:1'],
      sourceHashes: { 'section:1': 'h' },
      title: 't',
      mainQuestion: 'What is the rule?',
      studySummary: 'summary',
      objectives: [],
      confidence: 'high',
      warnings: [],
      generationMetadata: {
        providerKind: 'local-openai-compatible',
        promptSpecVersion: 'unit-authoring-v5',
        sourceJobId: 'p-1',
      },
      ...overrides,
    }) as AiStudyUnitProposal;

  const rowFor = (proposal: AiStudyUnitProposal | undefined) => ({
    seq: 1,
    v5JobId: proposal?.proposalId ?? 'p-1',
    v5: sideRowOf(proposal, [], noopValidation()),
  });

  it('flags generated + broad warning and generated + suggestion', () => {
    const broad = rowFor(
      proposalFor({ authoringStatus: 'generated', warnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'] }),
    );
    const suggestion = rowFor(
      proposalFor({
        authoringStatus: 'generated',
        mapRevisionSuggestion: {
          reason: 'split is advisory',
          proposedGroups: [
            { title: 'a', sourceKeys: ['section:1'], focusSelections: [], approximateLearningGoal: 'g' },
            { title: 'b', sourceKeys: ['section:1'], focusSelections: [], approximateLearningGoal: 'g' },
          ],
        },
      }),
    );
    const buckets = revisionConsistencyBucketsOf([broad, suggestion]);
    expect(buckets.generatedWithBroadWarning.count).toBe(1);
    expect(buckets.generatedWithBroadWarning.jobIds).toEqual(['p-1']);
    expect(buckets.generatedWithSuggestion.count).toBe(1);
    expect(buckets.generatedWithSuggestion.jobIds).toEqual(['p-1']);
  });

  it('flags needs-map-revision missing warning / suggestion / with contradictory reason', () => {
    const withoutWarning = rowFor(
      proposalFor({ authoringStatus: 'needs-map-revision', warnings: [] }),
    );
    const withoutSuggestion = rowFor(
      proposalFor({
        authoringStatus: 'needs-map-revision',
        warnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'],
      }),
    );
    const contradictory = rowFor(
      proposalFor({
        authoringStatus: 'needs-map-revision',
        warnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'],
        mapRevisionSuggestion: {
          reason: 'No revision needed; current grouping is appropriate.',
          proposedGroups: [
            { title: 'a', sourceKeys: ['section:1'], focusSelections: [], approximateLearningGoal: 'g' },
            { title: 'b', sourceKeys: ['section:1'], focusSelections: [], approximateLearningGoal: 'g' },
          ],
        },
      }),
    );
    const buckets = revisionConsistencyBucketsOf([withoutWarning, withoutSuggestion, contradictory]);
    expect(buckets.needsRevisionWithoutBroadWarning.count).toBe(1);
    // The no-warning row is also missing its suggestion, so two rows flag this bucket.
    expect(buckets.needsRevisionWithoutSuggestion.count).toBe(2);
    expect(buckets.needsRevisionWithContradictoryReason.count).toBe(1);
    expect(buckets.needsRevisionWithContradictoryReason.jobIds).toEqual(['p-1']);
  });

  it('keeps a clean generated proposal and a compliant needs-map-revision proposal unflagged', () => {
    const clean = rowFor(proposalFor({ authoringStatus: 'generated' }));
    const compliant = rowFor(
      proposalFor({
        authoringStatus: 'needs-map-revision',
        warnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'],
        mapRevisionSuggestion: {
          reason: 'The approved focus joins two disjoint propositions that cannot form one unit.',
          proposedGroups: [
            { title: 'a', sourceKeys: ['section:1'], focusSelections: [], approximateLearningGoal: 'g' },
            { title: 'b', sourceKeys: ['section:1'], focusSelections: [], approximateLearningGoal: 'g' },
          ],
        },
      }),
    );
    const buckets = revisionConsistencyBucketsOf([clean, compliant]);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.count).toBe(0);
    }
  });
});

describe('tierIndexOf (one crafted job per tier)', () => {
  const base = (overrides: Partial<CompareTierInput> = {}): CompareTierInput => ({
    v5Accepted: true,
    v5AuthoringStatus: 'generated',
    v4AuthoringStatus: 'generated',
    v4Warnings: [],
    v5Warnings: [],
    named: false,
    ...overrides,
  });

  it('assigns tiers 1..6 by first matching rule', () => {
    expect(tierIndexOf(base({ v5Accepted: false }))).toBe(1);
    expect(tierIndexOf(base({ v5AuthoringStatus: 'needs-map-revision' }))).toBe(2);
    expect(
      tierIndexOf(base({ v4AuthoringStatus: 'needs-map-revision', v5AuthoringStatus: 'generated' })),
    ).toBe(3);
    expect(tierIndexOf(base({ v5Warnings: ['a', 'b', 'c'] }))).toBe(4);
    expect(tierIndexOf(base({ v5Warnings: ['a', 'b'], v4Warnings: [] }))).toBe(4);
    expect(tierIndexOf(base({ named: true }))).toBe(5);
    expect(tierIndexOf(base())).toBe(6);
  });

  it('keeps a job at its earliest matching tier', () => {
    const stacked = base({
      v5Accepted: false,
      v5AuthoringStatus: 'needs-map-revision',
      v4AuthoringStatus: 'generated',
      named: true,
    });
    expect(tierIndexOf(stacked)).toBe(1);
    expect(tierIndexOf({ ...base({ v5AuthoringStatus: 'needs-map-revision' }), named: true })).toBe(2);
  });
});

describe('side classification + transition matrix pseudo-status', () => {
  it('classifies accepted vs provider-incomplete vs semantic-failed vs nothing', () => {
    const proposal: AiStudyUnitProposal = {
      schemaVersion: 1,
      proposalId: 'unit-a',
      runId: 'run',
      corpusContentHash: 'c',
      sourceDocumentId: 'doc-a',
      sourceKeys: ['section:1'],
      sourceHashes: {},
      title: 't',
      mainQuestion: 'q',
      studySummary: 's',
      objectives: [],
      confidence: 'high',
      warnings: [],
      authoringStatus: 'generated',
      generationMetadata: { providerKind: 'local-openai-compatible', promptSpecVersion: 'unit-authoring-v5', generatedAt: '2026-09-02T00:00:00.000Z' },
    };
    const accepted = sideRowOf(proposal, [], noopValidation());
    expect(accepted.outcome).toBe('accepted');
    expect(accepted.attemptCount).toBe(1);
    const provider = sideRowOf(undefined, [{ attempt: 1, kind: 'provider', issueCodes: [], issues: [] }], null);
    expect(provider.outcome).toBe('provider-incomplete');
    const semantic = sideRowOf(
      undefined,
      [
        { attempt: 1, kind: 'semantic', issueCodes: ['EVIDENCE_NOT_FOUND'], issues: [] },
        { attempt: 2, kind: 'semantic', issueCodes: ['EVIDENCE_NOT_FOUND'], issues: [] },
      ],
      null,
    );
    expect(semantic.outcome).toBe('semantic-failed');
    expect(semantic.attemptCount).toBe(2);
    expect(sideRowOf(undefined, [], null).outcome).toBe('nothing');
  });

  it('adds a no-accepted-result matrix column only when a v5 result is missing', () => {
    const generated = (side: { authoringStatus: string }) =>
      sideRowOf(
        { proposalId: 'p', authoringStatus: side.authoringStatus } as AiStudyUnitProposal,
        [],
        noopValidation(),
      );
    const missing = sideRowOf(undefined, [], null);
    const matrix = statusTransitionMatrixOf([
      { v4: generated({ authoringStatus: 'generated' }), v5: generated({ authoringStatus: 'generated' }) },
      { v4: generated({ authoringStatus: 'needs-map-revision' }), v5: missing },
    ]);
    expect(matrix.v5Statuses).toEqual(['generated', 'no-accepted-result']);
    expect(matrix.counts['needs-map-revision']['no-accepted-result']).toBe(1);
    expect(matrix.total).toBe(2);
    expect(authoringStatusKeyOf(missing)).toBe('no-accepted-result');
  });
});

/* ------------------------------------------------------------------ *
 * In-memory six-row context -> full doc build                        *
 * ------------------------------------------------------------------ */

const makeProposal = (
  jobId: string,
  runId: string,
  opts: {
    status?: 'generated' | 'needs-map-revision';
    warnings?: string[];
    mainLength?: number;
    guidedLengths?: number[];
    suggestion?: { reason: string; titles: string[] };
  } = {},
): AiStudyUnitProposal => {
  const main = `Q${jobId} ${'m'.repeat(Math.max(0, (opts.mainLength ?? 40) - (2 + jobId.length)))}`;
  return {
    title: `Title ${jobId}`,
    mainQuestion: main,
    studySummary: `Summary ${jobId}`,
    objectives: (opts.guidedLengths ?? [50]).map((length, index) => ({
      id: `${jobId}-obj-${index + 1}`,
      type: 'duty',
      objective: `Objective ${jobId}-${index + 1}`,
      guidedQuestion: `G${index + 1} ${'g'.repeat(Math.max(0, length - 3))}`,
      studyAnswer: 'The registrar shall comply.',
      required: true,
      sourceKeys: ['section:1'],
      evidence: [{ sourceKey: 'section:1', evidenceText: 'The registrar shall comply.' }],
      confidence: 'high',
    })),
    confidence: 'high',
    warnings: opts.warnings ?? [],
    schemaVersion: 1,
    proposalId: jobId,
    runId,
    corpusContentHash: 'corpus',
    sourceDocumentId: 'doc-a',
    sourceKeys: ['section:1'],
    sourceHashes: { 'section:1': sha256('The registrar shall comply.') },
    approvedGroup: {
      groupId: `g-${jobId}`,
      titleSuggestion: `Group ${jobId}`,
      sourceKeys: ['section:1'],
      focusSelections: [],
      reason: 'r',
      approximateLearningGoal: 'g',
    },
    mapDisposition: 'standalone',
    authoringStatus: opts.status ?? 'generated',
    suggestedPriority: 'P3',
    mapRevisionSuggestion:
      opts.suggestion === undefined
        ? undefined
        : {
            reason: opts.suggestion.reason,
            proposedGroups: opts.suggestion.titles.map((title) => ({
              title,
              sourceKeys: ['section:1'],
              focusSelections: [],
              approximateLearningGoal: 'g',
            })),
          },
    generationMetadata: {
      providerKind: 'local-openai-compatible',
      promptSpecVersion: runId.includes('v5') ? 'unit-authoring-v5' : 'unit-authoring-v4',
      generatedAt: '2026-09-02T00:00:00.000Z',
      sourceJobId: jobId,
      sourceJobInputHash: `input-${jobId}`,
    },
  };
};

const dummyJob = (jobId: string, exactSourceText = ''): AiUnitAuthoringJob =>
  ({
    schemaVersion: 1,
    jobId,
    runId: 'run',
    promptSpecVersion: 'unit-authoring-v4',
    sourceMapRunId: 'map',
    sourceMapProposalId: `map:${jobId}`,
    corpusContentHash: 'corpus',
    inputHash: `input-${jobId}`,
    document: { documentId: 'doc-a', title: 'Synthetic Act', type: 'act' },
    approvedGroup: {
      groupId: `g-${jobId}`,
      titleSuggestion: `Group ${jobId}`,
      sourceKeys: ['section:1'],
      focusSelections: [],
      reason: 'r',
      approximateLearningGoal: 'g',
    },
    mapDisposition: 'standalone',
    mapReason: 'r',
    approximateLearningGoal: 'g',
    group: {
      groupId: `g-${jobId}`,
      titleSuggestion: `Group ${jobId}`,
      sourceKeys: ['section:1'],
      focusSelections: [],
      reason: 'r',
      approximateLearningGoal: 'g',
    },
    sourceHashes: {},
    exactSourceText,
    operativeSourceText: '',
    sourceMetadata: {},
    context: {},
  }) as AiUnitAuthoringJob;

const sixRowContext = (): CompareContext => {
  const rows = [
    { v4: 'v4-one', v5: 'v5-one' },
    { v4: 'v4-two', v5: 'v5-two' },
    { v4: 'v4-three', v5: 'v5-three' },
    { v4: 'v4-four', v5: 'v5-four' },
    { v4: 'v4-five', v5: 'v5-five' },
    { v4: 'v4-suffix7', v5: 'v5-six' },
  ];
  const byJob = new Map<string, AiUnitAuthoringJob>();
  const attempts = new Map<string, UnitAttemptRecord[]>();
  for (const row of rows) {
    byJob.set(row.v4, dummyJob(row.v4, ''));
    byJob.set(row.v5, dummyJob(row.v5, ''));
  }
  // OCR probe job: its v4 payload carries both OCR artifacts verbatim.
  byJob.set(
    'v4-suffix7',
    dummyJob(
      'v4-suffix7',
      `registered under the ${OCR_TARGET_STRINGS[0]} unless ${OCR_TARGET_STRINGS[1]} is satisfied.`,
    ),
  );
  const v4RunId = 'run-v4-synthetic';
  const v5RunId = 'run-v5-synthetic';
  const v4Results = new Map<string, AiStudyUnitProposal>();
  const v5Results = new Map<string, AiStudyUnitProposal>();

  // tier1: v5 missing (no accepted result).
  v4Results.set('v4-one', makeProposal('v4-one', v4RunId, { status: 'needs-map-revision' }));
  attempts.set('v5-one', [
    { attempt: 1, kind: 'provider', issueCodes: [], issues: [] },
  ]);
  // tier2: v5 needs-map-revision (compliant, no flags).
  v4Results.set('v4-two', makeProposal('v4-two', v4RunId, { status: 'generated' }));
  v5Results.set(
    'v5-two',
    makeProposal('v5-two', v5RunId, {
      status: 'needs-map-revision',
      warnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'],
      suggestion: {
        reason: 'The approved focus joins two disjoint propositions that cannot form one unit.',
        titles: ['finer a', 'finer b'],
      },
    }),
  );
  // tier3: status change.
  v4Results.set('v4-three', makeProposal('v4-three', v4RunId, { status: 'needs-map-revision' }));
  v5Results.set('v5-three', makeProposal('v5-three', v5RunId, { status: 'generated' }));
  // tier4: warning-heavy.
  v4Results.set('v4-four', makeProposal('v4-four', v4RunId, { status: 'generated' }));
  v5Results.set('v5-four', makeProposal('v5-four', v5RunId, { warnings: ['A', 'B', 'C'] }));
  // tier5: named subset member, otherwise clean.
  v4Results.set('v4-five', makeProposal('v4-five', v4RunId, { status: 'generated' }));
  v5Results.set('v5-five', makeProposal('v5-five', v5RunId, { status: 'generated' }));
  // tier6: remainder + OCR probe row (over-target question lengths live here).
  v4Results.set(
    'v4-suffix7',
    makeProposal('v4-suffix7', v4RunId, {
      status: 'generated',
      mainLength: 250,
      guidedLengths: [100, 230],
      warnings: ['OUTSIDE_APPROVED_FOCUS'],
    }),
  );
  v5Results.set(
    'v5-six',
    makeProposal('v5-six', v5RunId, { status: 'generated', mainLength: 190, guidedLengths: [165] }),
  );
  // OCR strings in the v5 OCR evidence union (one objective each).
  const ocrProposal = v5Results.get('v5-six')!;
  ocrProposal.objectives = [
    {
      ...ocrProposal.objectives[0],
      id: 'obj-a',
      guidedQuestion: 'g'.repeat(165),
      evidence: [{ sourceKey: 'section:1', evidenceText: `by the ${OCR_TARGET_STRINGS[0]} rule` }],
    },
    {
      ...ocrProposal.objectives[0],
      id: 'obj-b',
      guidedQuestion: 'OCR objective b',
      evidence: [{ sourceKey: 'section:1', evidenceText: `the ${OCR_TARGET_STRINGS[1]} decides` }],
    },
  ];
  const crosswalkRows = rows.map((row, index) => ({
    seq: index + 1,
    proposalId: `map:${row.v4}`,
    groupId: `g-${row.v4}`,
    v4JobId: row.v4,
    v5JobId: row.v5,
    jobIdChanged: true,
    documentIds: ['section:1'],
    titleSuggestion: `Group ${row.v4}`,
    frozenMapPriority: 'P3',
  }));
  return {
    cohortSize: 6,
    v4Run: {
      runId: v4RunId,
      model: 'synthetic',
      endpoint: 'http://127.0.0.1:8080/v1',
      concurrency: 1,
      promptSpecVersion: 'unit-authoring-v4',
      specSha256: sha256('spec-v4'),
      jobsByJobId: byJob,
      attemptsByJobId: attempts,
      resultsByProposalId: v4Results,
    },
    v5Run: {
      runId: v5RunId,
      model: 'synthetic',
      endpoint: 'http://127.0.0.1:8080/v1',
      concurrency: 1,
      promptSpecVersion: 'unit-authoring-v5',
      specSha256: sha256('spec-v5'),
      jobsByJobId: byJob,
      attemptsByJobId: attempts,
      resultsByProposalId: v5Results,
    },
    crosswalkRows,
    membership: {
      finalQcIds: ['v4-five'],
      anchorIds: ['v4-one'],
      retryIds: ['v4-five'],
      repealedMixIds: ['v4-five'],
    },
    specShas: { v4: sha256('spec-v4'), v5: sha256('spec-v5') },
    crosswalkSha256: sha256('crosswalk'),
    ocrTargetStrings: [...OCR_TARGET_STRINGS],
    ocrV4JobIdSuffix: 'suffix7',
    validate: noopValidation,
  };
};

describe('buildCompareDocs over a crafted six-row context', () => {
  it('assigns exactly one row to each of the six risk tiers and orders by tier then seq', () => {
    const docs = buildCompareDocs(sixRowContext());
    const human = docs.humanReview;
    expect(human.rows).toHaveLength(6);
    expect(human.summary.tierCounts).toEqual(countBy(['1', '2', '3', '4', '5', '6']));
    const tierOf = (seq: number): number => human.rows.find((row) => row.seq === seq)!.tier;
    expect([1, 2, 3, 4, 5, 6].map(tierOf)).toEqual([1, 2, 3, 4, 5, 6]);
    const ordered = [...human.rows].sort((a, b) => a.tier - b.tier || a.seq - b.seq);
    expect(human.rows.map((row) => [row.tier, row.seq])).toEqual(
      ordered.map((row) => [row.tier, row.seq]),
    );
    // Tier markers visible on the rows themselves.
    const row1 = human.rows.find((row) => row.tier === 1)!;
    expect(row1.v5.outcome).toBe('provider-incomplete');
    const row2 = human.rows.find((row) => row.tier === 2)!;
    expect(row2.v5.authoringStatus).toBe('needs-map-revision');
    expect(row2.v5.mapRevisionSuggestion?.proposedGroupTitles).toEqual(['finer a', 'finer b']);
  });

  it('reports transition matrix counts and a no-accepted-result column', () => {
    const comparison = buildCompareDocs(sixRowContext()).comparison;
    const matrix = comparison.statusTransitionMatrix;
    expect(matrix.v5Statuses).toContain('no-accepted-result');
    expect(matrix.counts['needs-map-revision']['no-accepted-result']).toBe(1);
    expect(matrix.counts['generated']['generated']).toBe(3);
    expect(matrix.counts['needs-map-revision']['generated']).toBe(1);
    expect(matrix.counts['generated']['needs-map-revision']).toBe(1);
    expect(matrix.total).toBe(6);
    expect(matrix.v5Statuses).toEqual([
      'generated',
      'needs-map-revision',
      'no-accepted-result',
    ]);
  });

  it('keeps V5 revision consistency empty for the crafted compliant data', () => {
    const revision = buildCompareDocs(sixRowContext()).comparison.revisionConsistencyV5;
    for (const bucket of Object.values(revision)) expect(bucket.count).toBe(0);
  });

  it('counts over-target question lengths on crafted lengths', () => {
    const questions = buildCompareDocs(sixRowContext()).comparison.questions;
    // v4: main 40/40/40/40/40/250 → over180 1, over240 1;
    //     guided v4: 50 each row1-5, row6 has 100 & 230 → over160 1, over220 1.
    expect(questions.v4.overMain180).toBe(1);
    expect(questions.v4.overMain240).toBe(1);
    expect(questions.v4.overGuided160).toBe(1);
    expect(questions.v4.overGuided220).toBe(1);
    // v5: main 190 only on row6 (missing row1, others 40) → over180 1, over240 0;
    //     guided 165 (row6) → over160 1.
    expect(questions.v5.overMain180).toBe(1);
    expect(questions.v5.overMain240).toBe(0);
    expect(questions.v5.overGuided160).toBe(1);
    expect(questions.v5.overGuided220).toBe(0);
  });

  it('resolves the OCR triple and per-string v5 objective ids', () => {
    const docs = buildCompareDocs(sixRowContext());
    const ocr = docs.comparison.ocrCase;
    expect(ocr.v4JobId).toBe('v4-suffix7');
    expect(ocr.v5JobId).toBe('v5-six');
    expect(ocr.byLaws).toMatchObject({
      v4JobExactSourceText: true,
      v4EvidenceUnion: false,
      v5EvidenceUnion: true,
      v5ObjectiveIds: ['obj-a'],
    });
    expect(ocr.registrar).toMatchObject({
      v4JobExactSourceText: true,
      v4EvidenceUnion: false,
      v5EvidenceUnion: true,
      v5ObjectiveIds: ['obj-b'],
    });
    expect(docs.humanReview.summary.ocrCase).toEqual({
      v4JobExactSourceText: true,
      v4EvidenceUnion: false,
      v5EvidenceUnion: true,
    });
  });

  it('produces byte-identical JSON and Markdown on repeated builds', () => {
    const first = buildCompareDocs(sixRowContext());
    const second = buildCompareDocs(sixRowContext());
    expect(JSON.stringify(first.comparison)).toBe(JSON.stringify(second.comparison));
    expect(JSON.stringify(first.humanReview)).toBe(JSON.stringify(second.humanReview));
    expect(renderComparisonMarkdown(first.comparison)).toBe(
      renderComparisonMarkdown(second.comparison),
    );
    expect(renderCompareHumanReviewMarkdown(first.humanReview)).toBe(
      renderCompareHumanReviewMarkdown(second.humanReview),
    );
    // Documents carry the machine-required sections.
    expect(renderComparisonMarkdown(first.comparison)).toContain('## Status transition matrix');
    expect(renderCompareHumanReviewMarkdown(first.humanReview)).toContain('## Tier 6 — remainder');
  });
});

/* ------------------------------------------------------------------ *
 * E2E over temp-dir synthetic runs (loader + builders)              *
 * ------------------------------------------------------------------ */

const SOURCE_1 = '1 A surveyor shall deliver a written objection.';
const SENTENCE_1 = 'A surveyor shall deliver a written objection.';
const SOURCE_2 = '2 The registrar may waive a prescribed form requirement.';
const SENTENCE_2 = 'The registrar may waive a prescribed form requirement.';

const componentFor = (sourceKey: string, text: string): NbLawSection => ({
  id: `c-${sourceKey}`,
  sourceKey,
  componentType: 'section',
  label: sourceKey.split(':')[1],
  text,
  subsections: [],
  contentHash: sha256(text),
});

const buildFixturePackage = (): NbLawContentPackage => {
  const document: NbLawNormalizedDocument = {
    schemaVersion: 1,
    id: 'doc-a',
    officialTitle: 'Synthetic Act',
    documentType: 'act',
    sourceUrl: 'https://example.invalid/act',
    fetchDate: '2026-01-01',
    contentHash: 'doc-hash',
    tableOfContents: [],
    components: [componentFor('section:1', SOURCE_1), componentFor('section:2', SOURCE_2)],
    sections: [],
    notes: [],
  };
  return {
    schemaVersion: 1,
    id: 'synthetic-compare-package',
    manifestId: 'synthetic-compare-manifest',
    createdAt: '2026-09-02T00:00:00.000Z',
    documents: [document],
    relationships: [],
    sourceHashes: { 'doc-a': 'doc-hash' },
  };
};

const fixtureJob = (jobId: string, runId: string, sourceKey: string): AiUnitAuthoringJob => {
  const text = sourceKey === 'section:1' ? SOURCE_1 : SOURCE_2;
  const approvedGroup = {
    groupId: `g-${jobId}`,
    titleSuggestion: `Group ${jobId}`,
    sourceKeys: [sourceKey],
    focusSelections: [{ sourceKey, childLabels: [] }],
    reason: 'r',
    approximateLearningGoal: 'g',
  };
  return {
    schemaVersion: 1,
    jobId,
    runId,
    promptSpecVersion: runId.includes('v5') ? 'unit-authoring-v5' : 'unit-authoring-v4',
    sourceMapRunId: 'map',
    sourceMapProposalId: `map:${jobId}`,
    corpusContentHash: 'corpus',
    frozenMapPriority: 'P3',
    inputHash: `input-${jobId}`,
    document: { documentId: 'doc-a', title: 'Synthetic Act', type: 'act' },
    approvedGroup,
    mapDisposition: 'standalone',
    mapReason: 'r',
    approximateLearningGoal: 'g',
    group: approvedGroup,
    sourceHashes: { [sourceKey]: sha256(text) },
    sourceStatuses: { [sourceKey]: 'current' },
    contentFlagsBySourceKey: { [sourceKey]: {} },
    exactSourceText: text,
    operativeSourceText: text,
    sourceMetadata: {},
    context: {},
  };
};

const fixtureProposal = (
  job: AiUnitAuthoringJob,
  opts: { status?: 'generated' | 'needs-map-revision'; warnings?: string[] } = {},
): AiStudyUnitProposal => {
  const sourceKey = job.approvedGroup.sourceKeys[0];
  const sentence = sourceKey === 'section:1' ? SENTENCE_1 : SENTENCE_2;
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
    runId: job.runId,
    corpusContentHash: 'corpus',
    sourceDocumentId: 'doc-a',
    sourceKeys: [sourceKey],
    sourceHashes: { [sourceKey]: sha256(job.exactSourceText) },
    approvedGroup: job.approvedGroup,
    mapDisposition: 'standalone',
    mapReason: job.mapReason,
    approximateLearningGoal: job.approximateLearningGoal,
    authoringStatus: opts.status ?? 'generated',
    suggestedPriority: 'P3',
    generationMetadata: {
      providerKind: 'local-openai-compatible',
      promptSpecVersion: job.promptSpecVersion,
      generatedAt: '2026-09-02T00:00:00.000Z',
      sourceJobId: job.jobId,
      sourceJobInputHash: job.inputHash,
    },
  };
};

const buildFixtureRoot = (): { root: string; v4Ids: string[]; v5Ids: string[] } => {
  const root = mkdtempSync(join(tmpdir(), 'study-ai-unit-cal-compare-'));
  tempRoots.push(root);
  const v4Ids = ['unit-v4-1111', 'unit-v4-2222', 'unit-v4-07fa6fc1208594ca'];
  const v5Ids = ['unit-v5-1111', 'unit-v5-2222', 'unit-v5-3333'];
  const v4RunDir = join(root, 'run-v4');
  const v5RunDir = join(root, 'run-v5');

  const writeRun = (
    runDir: string,
    runId: string,
    specVersion: string,
    jobsById: Map<string, AiUnitAuthoringJob>,
    results: AiStudyUnitProposal[],
  ): void => {
    const jobsDir = join(runDir, 'jobs');
    const resultsDir = join(runDir, 'results');
    const reportsDir = join(runDir, 'reports');
    const jobIds = [...jobsById.keys()];
    writeText(
      join(jobsDir, 'batch-001.jobs.jsonl'),
      jobIds.map((jobId) => JSON.stringify(jobsById.get(jobId))).join('\n'),
    );
    writeText(
      join(resultsDir, 'local-unit.results.jsonl'),
      results.map((row) => JSON.stringify(row)).join('\n'),
    );
    for (const row of results) {
      writeText(
        join(resultsDir, `${row.proposalId}.provenance.json`),
        JSON.stringify({
          providerKind: 'local-openai-compatible',
          modelId: 'synthetic-model',
          runId,
          jobId: row.proposalId,
          proposalId: row.proposalId,
          attempt: 1,
          timestamp: '2026-09-02T00:00:00.000Z',
          accepted: true,
        }),
      );
    }
    writeText(
      join(reportsDir, 'local-run-metadata.json'),
      JSON.stringify({
        schemaVersion: 1,
        runId,
        model: 'synthetic-model',
        baseUrl: 'http://127.0.0.1:8080/v1',
        packagePath: 'package.json',
        promptSpecVersion: specVersion,
        promptSha256: sha256(`spec-${runId}`),
        batch: null,
        concurrency: 1,
        jobCount: jobIds.length,
        jobIds,
        jobsFileSha256: {
          'batch-001.jobs.jsonl': sha256(
            readFileSync(join(jobsDir, 'batch-001.jobs.jsonl'), 'utf8'),
          ),
        },
        createdAt: '2026-09-02T00:00:00.000Z',
      }),
    );
    writeText(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 1, runId, status: 'prepared' }));
  };

  // V4 jobs: all three accepted (third is the OCR probe row with the artifact strings).
  const v4Jobs = new Map<string, AiUnitAuthoringJob>();
  v4Ids.forEach((jobId, index) => {
    const sourceKey = index === 0 ? 'section:1' : 'section:2';
    const job = fixtureJob(jobId, 'run-v4', sourceKey);
    if (index === 2) job.exactSourceText = `by ${OCR_TARGET_STRINGS[0]} unless ${OCR_TARGET_STRINGS[1]} approves`;
    v4Jobs.set(jobId, job);
  });
  const v4Results = [
    fixtureProposal(v4Jobs.get(v4Ids[0])!, { status: 'needs-map-revision' }),
    fixtureProposal(v4Jobs.get(v4Ids[1])!),
    fixtureProposal(v4Jobs.get(v4Ids[2])!, { warnings: ['OUTSIDE_APPROVED_FOCUS'] }),
  ];
  writeRun(v4RunDir, 'run-v4', 'unit-authoring-v4', v4Jobs, v4Results);

  // V5 jobs: all three present; only two accepted (v5-1111 is missing its result).
  const v5Jobs = new Map<string, AiUnitAuthoringJob>();
  v5Ids.forEach((jobId, index) => {
    const sourceKey = index === 0 ? 'section:1' : 'section:2';
    v5Jobs.set(jobId, fixtureJob(jobId, 'run-v5', sourceKey));
  });
  const v5Results = [fixtureProposal(v5Jobs.get(v5Ids[1])!), fixtureProposal(v5Jobs.get(v5Ids[2])!)];
  // OCR probe row (v5 side): carry both artifact strings in the accepted evidence union.
  const ocrV5 = v5Results[1];
  ocrV5.objectives[0].evidence = [
    { sourceKey: 'section:2', evidenceText: `by ${OCR_TARGET_STRINGS[0]} rule` },
    { sourceKey: 'section:2', evidenceText: `the ${OCR_TARGET_STRINGS[1]} decides` },
  ];
  const providerFailureDir = join(v5RunDir, 'local-failures', v5Ids[0]);
  writeText(
    join(providerFailureDir, 'attempt-1.validation.json'),
    JSON.stringify({
      runId: 'run-v5',
      jobId: v5Ids[0],
      attempt: 1,
      accepted: false,
      failureKind: 'transport/provider',
      failureCode: 'PROVIDER_INTERRUPTED',
      issues: [],
      timestamp: '2026-09-02T00:00:00.000Z',
    }),
  );
  writeRun(v5RunDir, 'run-v5', 'unit-authoring-v5', v5Jobs, v5Results);

  // Crosswalk: 3 rows in seq order.
  const crosswalk = {
    report: 'unit-calibration-v4-v5-crosswalk',
    dateTag: '20260902',
    v4RunId: 'run-v4',
    v5RunId: 'run-v5',
    specShas: { v4: sha256('spec'), v5: sha256('spec') },
    cohortSize: 3,
    matched: 3,
    unmatched: 0,
    rows: v4Ids.map((v4JobId, index) => ({
      seq: index + 1,
      proposalId: `map:${v4JobId}`,
      groupId: `g-${v4JobId}`,
      v4JobId,
      v5JobId: v5Ids[index],
      jobIdChanged: true,
      documentIds: ['section:1'],
      titleSuggestion: `Group ${v4JobId}`,
      frozenMapPriority: 'P3',
    })),
  };
  writeText(join(root, 'crosswalk.json'), JSON.stringify(crosswalk, null, 2));
  writeText(join(root, 'package.json'), JSON.stringify(buildFixturePackage()));

  // V4 human-review artifact: 3 units carrying subset tags.
  const reviewDoc = {
    schemaVersion: 1,
    kind: 'unit-calibration-human-review',
    total: 3,
    units: [
      { jobId: v4Ids[0], sourceContext: { tags: ['unit-v4-regression-anchor'] } },
      { jobId: v4Ids[1], sourceContext: { tags: ['final-map-grouping-adjudication'] } },
      { jobId: v4Ids[2], sourceContext: { tags: ['map-retry-history', 'repealed-mix'] } },
    ],
  };
  writeText(join(root, 'review.json'), JSON.stringify(reviewDoc));
  writeText(join(root, 'selection.json'), JSON.stringify({ jobs: [] }));
  writeText(join(root, 'spec-v4.md'), 'spec-v4');
  writeText(join(root, 'spec-v5.md'), 'spec-v5');
  return { root, v4Ids, v5Ids };
};

const loadFixtureContext = (root: string): CompareContext =>
  loadCompareContext({
    v4RunDir: join(root, 'run-v4'),
    v5RunDir: join(root, 'run-v5'),
    crosswalkPath: join(root, 'crosswalk.json'),
    v4ReviewPath: join(root, 'review.json'),
    selectionReportPath: join(root, 'selection.json'),
    packagePath: join(root, 'package.json'),
    specV4Path: join(root, 'spec-v4.md'),
    specV5Path: join(root, 'spec-v5.md'),
    expectedCohortSize: 3,
  });

describe('end-to-end comparison over temp-dir synthetic runs', () => {
  it('loads both runs and reports the transition matrix + missing-result handling', () => {
    const { root, v4Ids, v5Ids } = buildFixtureRoot();
    const context = loadFixtureContext(root);
    expect(context.cohortSize).toBe(3);
    expect(context.v4Run.runId).toBe('run-v4');
    const docs = buildCompareDocs(context);
    const comparison = docs.comparison;
    expect(comparison.perRun.v4.accepted).toBe(3);
    expect(comparison.perRun.v5.accepted).toBe(2);
    expect(comparison.perRun.v5.providerIncomplete).toBe(1);
    // OCR row (third crosswalk row) carries both artifact strings on both sides.
    expect(comparison.ocrCase.v4JobId).toBe(v4Ids[2]);
    expect(comparison.ocrCase.v5JobId).toBe(v5Ids[2]);
    expect(comparison.ocrCase.byLaws.v5EvidenceUnion).toBe(true);
    expect(comparison.ocrCase.registrar.v5EvidenceUnion).toBe(true);
    // Named subsets read from the review artifact tags.
    expect(comparison.namedSubsets.anchors7.rows.map((row) => row.v4JobId)).toEqual([v4Ids[0]]);
    expect(comparison.namedSubsets.finalQc20.rows.map((row) => row.v4JobId)).toEqual([v4Ids[1]]);
    expect(comparison.namedSubsets.repealedMix16.rows.map((row) => row.v4JobId)).toEqual([v4Ids[2]]);
    // Human review tier 1 holds the provider-incomplete v5 job.
    const human = docs.humanReview;
    expect(human.rows.filter((row) => row.tier === 1)).toHaveLength(1);
    expect(human.rows.find((row) => row.tier === 1)!.v4JobId).toBe(v4Ids[0]);
    expect(human.rows.find((row) => row.tier === 1)!.v5.outcome).toBe('provider-incomplete');
  });

  it('fails closed naming a crosswalk job id missing from a run', () => {
    const { root } = buildFixtureRoot();
    const paths = {
      v4RunDir: join(root, 'run-v4'),
      v5RunDir: join(root, 'run-v5'),
      crosswalkPath: join(root, 'crosswalk.json'),
      v4ReviewPath: join(root, 'review.json'),
      selectionReportPath: join(root, 'selection.json'),
      packagePath: join(root, 'package.json'),
      specV4Path: join(root, 'spec-v4.md'),
      specV5Path: join(root, 'spec-v5.md'),
      expectedCohortSize: 3,
    };
    // Rewrite the crosswalk so row 2 references a v5 job that does not exist in the run.
    const crosswalk = JSON.parse(readFileSync(paths.crosswalkPath, 'utf8'));
    crosswalk.rows[1].v5JobId = 'unit-v5-missing';
    writeText(paths.crosswalkPath, JSON.stringify(crosswalk));
    expect(() => loadCompareContext(paths)).toThrow(/unit-v5-missing/);
    expect(() => loadCompareContext(paths)).toThrow(/Comparison integrity failure/);
  });

  it('is byte-identical across two full load + build passes', () => {
    const { root } = buildFixtureRoot();
    const first = buildCompareDocs(loadFixtureContext(root));
    const second = buildCompareDocs(loadFixtureContext(root));
    expect(JSON.stringify(first.comparison)).toBe(JSON.stringify(second.comparison));
    expect(JSON.stringify(first.humanReview)).toBe(JSON.stringify(second.humanReview));
    expect(renderComparisonMarkdown(first.comparison)).toBe(
      renderComparisonMarkdown(second.comparison),
    );
    expect(renderCompareHumanReviewMarkdown(first.humanReview)).toBe(
      renderCompareHumanReviewMarkdown(second.humanReview),
    );
  });
});
