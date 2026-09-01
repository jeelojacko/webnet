/**
 * Hermetic tests for the deterministic post-QC review bundles
 * (scripts/studyAiPostQcReviewBundles.ts + Markdown renderer). Synthetic
 * audit/jobs/results only — no corpus, no run directory, no model calls.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiSuggestedPriority,
  AiStudyMapJob,
  AiStudyMapResult,
} from '../../src/study/ai/studyAiTypes';
import {
  BROAD_HIGH_RISK_PINS,
  buildAdjacentP1Bundle,
  buildBroadGroupBundle,
  sha256Hex,
  type AdjacentP1BundleRow,
  type BundleBuildInput,
  type BroadGroupBundleRow,
} from '../../scripts/studyAiPostQcReviewBundles';
import {
  renderAdjacentP1BundleMd,
  renderBroadGroupBundleMd,
} from '../../scripts/studyAiPostQcReviewBundlesMarkdown';
import type {
  BroadStandaloneRow,
  LargeSplitRow,
  P1Row,
  PostQcSemanticAudit,
} from '../../scripts/studyAiAuditPostProductionSemantics';

/* ---------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------- */

const makeJob = (
  jobId: string,
  documentId: string,
  sectionLabel: string,
  exactSourceText: string,
): AiStudyMapJob => ({
  schemaVersion: 1,
  jobId,
  runId: 'run-test',
  promptSpecVersion: 'study-map-v3',
  corpusContentHash: 'corpus-hash',
  inputHash: 'input-hash',
  document: { documentId, title: `Title of ${documentId}`, type: 'act' },
  target: {
    sourceKeys: [`${documentId}:section:${sectionLabel}`],
    sectionLabels: [sectionLabel],
    sourceMetadata: {},
    sourceStatus: 'current',
    sourceHashes: {},
    exactSourceText,
    operativeSourceText: exactSourceText,
    approximateInputSize: {
      exactCharacters: exactSourceText.length,
      operativeCharacters: exactSourceText.length,
      largeSection: false,
    },
  },
  context: {},
});

const makeResult = (
  jobId: string,
  priority?: AiSuggestedPriority | null,
): AiStudyMapResult => ({
  schemaVersion: 1,
  jobId,
  runId: 'run-test',
  corpusContentHash: 'corpus-hash',
  disposition: 'standalone',
  confidence: 'high',
  reason: `Reason for ${jobId}.`,
  suggestedPriority: priority,
  proposedGroups: [
    {
      groupId: 'g1',
      titleSuggestion: 'Group One',
      sourceKeys: [],
      focusSelections: [
        {
          sourceKey: 'doc-x:section:1',
          childLabels: ['1', '1.1'],
          definedTerms: ['surveyor'],
          evidenceText: ['The source sentence.'],
        },
      ],
      reason: 'r',
      approximateLearningGoal: 'Understand the provision.',
    },
  ],
  warnings: [],
});

const p1Row = (
  jobId: string,
  documentId: string,
  bucket: P1Row['relevanceBucket'],
): P1Row => ({
  jobId,
  documentId,
  title: `Title of ${documentId}`,
  sectionLabel: '5',
  operativeCharacters: 120,
  disposition: 'standalone',
  confidence: 'high',
  reason: 'P1 reason.',
  groupTitles: ['Group One'],
  evidenceTextEntries: 1,
  warnings: [],
  inBalancedSet: true,
  balancedStratum: 'priority-p1',
  balancedOrigin: 'original',
  requiredRetryInBalancedSet: false,
  provenance: 'original',
  failureAttempts: 0,
  relevanceBucket: bucket,
});

const broadRow = (jobId: string, triggers: string[], operativeCharacters: number): BroadStandaloneRow => ({
  jobId,
  documentId: 'doc-aquaculture-act',
  title: 'Title of doc-aquaculture-act',
  sectionLabel: '90',
  operativeCharacters,
  groupTitles: ['Aquaculture Overview'],
  learningGoal: 'Understand aquaculture.',
  evidenceTextEntries: 2,
  childLabelCount: 4,
  paragraphLabelLineCount: 3,
  warnings: [],
  triggers,
  provenance: 'recovered',
  failureAttempts: 1,
});

const largeSplitRow = (jobId: string): LargeSplitRow => ({
  jobId,
  documentId: 'doc-aquaculture-act',
  title: 'Title of doc-aquaculture-act',
  sectionLabel: '91',
  operativeCharacters: 4000,
  groupCount: 5,
});

const makeAudit = (): PostQcSemanticAudit => ({
  schemaVersion: 1,
  kind: 'post-qc-semantic-audit',
  runId: 'run-test',
  dateTag: '20260101',
  inputs: {
    expectedJobCount: 3,
    acceptedResultCount: 3,
    zeroGroupResultCount: 0,
    groupResultCount: 3,
    localFailuresJobCount: 0,
  },
  guards: {
    staticGeographicExcluded: 0,
    repealMetadataExcluded: 0,
    fullyRepealedExcluded: 0,
    consequentialAmendmentExcluded: 0,
    scannedZeroGroupTotal: 0,
  },
  pinnedAnchors: [],
  allPinnedAnchorsFound: false,
  suspects: [],
  p1: {
    total: 3,
    byBucket: {
      'core-surveying-licensing': 1,
      'cadastral-property-registration-planning': 1,
      'adjacent-general-law': 1,
    },
    rows: [
      p1Row('map-3000000000000001', 'doc-surveys-act', 'core-surveying-licensing'),
      p1Row('map-3000000000000002', 'doc-expropriation-act', 'cadastral-property-registration-planning'),
      p1Row('map-3000000000000003', 'doc-mining-act', 'adjacent-general-law'),
    ],
  },
  broad: {
    pinnedAnchorJobId: 'map-d1fadd2dfd0ce395',
    triggerDefinitions: {},
    standaloneSuspects: [
      broadRow('map-3000000000000004', ['BROAD_MULTI_TOPIC', 'LONG_ENUMERATION', 'MANY_CHILDREN', 'REPEATED_PARAGRAPH_LABELS'], 7000),
      broadRow('map-d1fadd2dfd0ce395', ['BROAD_MULTI_TOPIC'], 5000),
      broadRow('map-3000000000000005', ['BROAD_MULTI_TOPIC'], 2000),
    ],
    largeSplitResults: [largeSplitRow('map-3000000000000006')],
  },
  retryAccounting: null,
});

const makeInput = (): BundleBuildInput => {
  const audit = makeAudit();
  const jobs = [
    makeJob('map-3000000000000001', 'doc-surveys-act', '5', '5Survey text.'),
    makeJob('map-3000000000000002', 'doc-expropriation-act', '5', '5Expropriation text.'),
    makeJob('map-3000000000000003', 'doc-mining-act', '5', '5Mining text.'),
    makeJob('map-3000000000000004', 'doc-aquaculture-act', '90', '90Aquaculture text.'),
    makeJob('map-d1fadd2dfd0ce395', 'doc-aquaculture-act', '90', '90Aquaculture anchor text.'),
    makeJob('map-3000000000000005', 'doc-aquaculture-act', '92', '92More aquaculture text.'),
  ];
  return {
    runId: 'run-test',
    dateTag: '20260101',
    audit,
    jobsById: new Map(jobs.map((j) => [j.jobId, j])),
    resultsById: new Map(jobs.map((j) => [j.jobId, makeResult(j.jobId, 'P1')])),
    balancedSet: null,
    sourceAudit: 'post-qc-semantic-audit-20260101.json',
  };
};

/* ---------------------------------------------------------------------
 * Adjacent P1 bundle
 * ------------------------------------------------------------------- */

describe('buildAdjacentP1Bundle', () => {
  it('keeps only adjacent-general-law rows with full row context', () => {
    const { bundle } = buildAdjacentP1Bundle(makeInput());
    expect(bundle.summary.totalRows).toBe(1);
    const row = bundle.rows[0] as AdjacentP1BundleRow;
    expect(row.jobId).toBe('map-3000000000000003');
    expect(row.documentId).toBe('doc-mining-act');
    expect(row.suggestedPriority).toBe('P1');
    expect(row.provenance).toBe('original');
    expect(row.exactSourceText).toBe('5Mining text.');
    expect(row.focusSelections[0]?.sourceKey).toBe('doc-x:section:1');
    expect(row.groupTitles).toEqual(['Group One']);
  });

  it('is byte-deterministic and self-hashing', () => {
    const a = buildAdjacentP1Bundle(makeInput());
    const b = buildAdjacentP1Bundle(makeInput());
    expect(a.jsonText).toBe(b.jsonText);
    const doc = JSON.parse(a.jsonText);
    const body =
      JSON.stringify(
        { ...doc, summary: { ...doc.summary, jsonSha256: '' } },
        null,
        2,
      ) + '\n';
    expect(doc.summary.jsonSha256).toBe(sha256Hex(body));
  });

  it('renders Markdown with the bundle header and every row', () => {
    const { bundle, mdText } = buildAdjacentP1Bundle(makeInput());
    expect(mdText).toContain('# Post-QC adjacent P1 review — run-test');
    expect(mdText).toContain(bundle.summary.jsonSha256);
    expect(mdText).toContain('map-3000000000000003');
    expect(renderAdjacentP1BundleMd(bundle)).toBe(mdText);
  });
});

/* ---------------------------------------------------------------------
 * Broad-group bundle
 * ------------------------------------------------------------------- */

describe('buildBroadGroupBundle', () => {
  it('covers every standalone suspect and pins high-risk cases', () => {
    const { bundle } = buildBroadGroupBundle(makeInput());
    expect(bundle.summary.totalRows).toBe(3);
    const byId = new Map(bundle.rows.map((r) => [r.jobId, r]));
    const pinned = byId.get('map-d1fadd2dfd0ce395') as BroadGroupBundleRow;
    expect(pinned.highRisk).toBe(true);
    expect(pinned.highRiskReasons.some((r) => r.startsWith('pinned:'))).toBe(true);
    const ruleRow = byId.get('map-3000000000000004') as BroadGroupBundleRow;
    expect(ruleRow.highRisk).toBe(true);
    expect(ruleRow.highRiskReasons.some((r) => r.startsWith('rule:'))).toBe(true);
    expect(bundle.summary.highRiskCount).toBe(2);
  });

  it('flags the rule row for both trigger count and size and attaches comparable splits', () => {
    const { bundle } = buildBroadGroupBundle(makeInput());
    const ruleRow = bundle.rows.find((r) => r.jobId === 'map-3000000000000004');
    expect(ruleRow?.highRiskReasons.length).toBe(2);
    expect(ruleRow?.comparableSplits).toEqual([
      {
        jobId: 'map-3000000000000006',
        sectionLabel: '91',
        groupCount: 5,
        operativeCharacters: 4000,
      },
    ]);
  });

  it('exposes only the pinned jobIds in BROAD_HIGH_RISK_PINS', () => {
    expect(Object.keys(BROAD_HIGH_RISK_PINS).sort()).toEqual([
      'map-10ff468d35d10873',
      'map-48b1a91a069cabde',
      'map-4fc0f66dd77ce286',
      'map-d1fadd2dfd0ce395',
      'map-d747c4a97d7161d3',
    ]);
  });

  it('is byte-deterministic, self-hashing, and renders Markdown with the high-risk table', () => {
    const a = buildBroadGroupBundle(makeInput());
    const b = buildBroadGroupBundle(makeInput());
    expect(a.jsonText).toBe(b.jsonText);
    const doc = JSON.parse(a.jsonText);
    const body =
      JSON.stringify(
        { ...doc, summary: { ...doc.summary, jsonSha256: '' } },
        null,
        2,
      ) + '\n';
    expect(doc.summary.jsonSha256).toBe(sha256Hex(body));
    expect(a.mdText).toContain('# Post-QC broad-group review — run-test');
    expect(a.mdText).toContain('## High-risk subset');
    expect(renderBroadGroupBundleMd(a.bundle)).toBe(a.mdText);
  });
});
