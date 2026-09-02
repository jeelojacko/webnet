/**
 * Tests for `validateAiUnitAuthoringJob` (frozen unit-job validator).
 *
 * A synthetic corpus package + frozen proposal/group produce a golden job via
 * the shared `buildUnitAuthoringJob`; the golden job must validate clean.
 * Each corruption class must then produce its expected issue code.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  NbLawContentPackage,
  NbLawNormalizedDocument,
} from '../../src/study/content/nbLawTypes';
import type {
  AiProposedSourceGroup,
  AiStudyMapProposal,
  AiUnitAuthoringJob,
} from '../../src/study/ai/studyAiTypes';
import { buildUnitAuthoringJob, hashText } from '../../src/study/ai/studyAiUnitJobPrep';
import {
  normalizeGroundingText,
  validateAiUnitAuthoringJob,
  type AiUnitAuthoringValidationContext,
} from '../../src/study/ai/studyAiUnitJobValidation';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const sectionComponent = (
  label: string,
  text: string,
  subsectionTexts: Record<string, string> = {},
): NbLawContentPackage['documents'][number]['components'][number] => ({
  id: `section-${label}`,
  sourceKey: `section:${label}`,
  componentType: 'section',
  label,
  text,
  subsections: Object.entries(subsectionTexts).map(([subsectionLabel, subsectionText]) => ({
    id: `section-${label}-${subsectionLabel}`,
    sourceKey: `section:${label}(${subsectionLabel.slice(label.length + 1)})`,
    label: subsectionLabel,
    text: subsectionText,
    contentHash: sha256(subsectionText),
  })),
  contentHash: sha256(text),
});

const SECTION_1_TEXT = [
  '1(1)In this Act, "land surveyor" means a person registered under the Land Surveyors Act.',
  '1(2)A land surveyor may enter land to carry out a survey for the purpose of this Act.',
].join('\n');
const SECTION_2_TEXT =
  '2(1)A survey plan shall be filed with the Director.\n2(2)The plan shall show every monument set.';

const DOC_A: NbLawNormalizedDocument = {
  schemaVersion: 1,
  id: 'doc-synthetic-act-a',
  officialTitle: 'Synthetic Boundaries Act',
  documentType: 'act' as const,
  sourceUrl: 'https://example.invalid/sba',
  fetchDate: '2026-09-02',
  contentHash: sha256('doc-a'),
  tableOfContents: [],
  components: [
    sectionComponent('1', SECTION_1_TEXT, {
      '1(1)': 'In this Act, "land surveyor" means a person registered under the Land Surveyors Act.',
      '1(2)': 'A land surveyor may enter land to carry out a survey for the purpose of this Act.',
    }),
    sectionComponent('2', SECTION_2_TEXT),
  ],
  sections: [],
  notes: [],
};

const buildPackage = (documents: NbLawContentPackage['documents']): NbLawContentPackage => ({
  schemaVersion: 1,
  id: 'synthetic-corpus-20260902',
  manifestId: 'synthetic-corpus-20260902',
  createdAt: '2026-09-02T00:00:00.000Z',
  documents,
  relationships: [],
  sourceHashes: Object.fromEntries(
    documents.map((document) => [document.id, document.contentHash]),
  ),
});

const PACKAGE = buildPackage([DOC_A]);
const CORPUS_HASH = hashText(JSON.stringify(PACKAGE.sourceHashes));
const MAP_RUN_ID = 'synth-map-run-frozen-full-20260902';
const UNIT_RUN_ID = 'ai-units-synth-validation-v4';

const buildProposal = (
  groups: AiProposedSourceGroup[],
  overrides: Partial<AiStudyMapProposal> = {},
): AiStudyMapProposal => ({
  id: 'synth-map-run:map-synthetic-a',
  schemaVersion: 1,
  runId: 'synth-map-run',
  jobId: 'map-synthetic-a',
  corpusContentHash: CORPUS_HASH,
  document: { documentId: DOC_A.id, title: DOC_A.officialTitle, type: 'act' },
  targetSourceKeys: ['section:1'],
  targetSectionLabels: ['1'],
  disposition: 'standalone',
  confidence: 'high',
  reason: 'Focused surveyor registration scope.',
  suggestedPriority: 'P2',
  proposedGroups: groups,
  warnings: [],
  conflictCodes: [],
  reviewStatus: 'validated',
  validationStatus: 'valid',
  validationMessages: [],
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
});

const buildGoldenGroup = (): AiProposedSourceGroup => ({
  groupId: 'g1',
  titleSuggestion: 'Land surveyor duties and entry powers',
  sourceKeys: ['section:1'],
  focusSelections: [
    {
      sourceKey: 'section:1',
      childLabels: ['1(1)'],
      definedTerms: ['land surveyor'],
      evidenceText: ['registered under the Land Surveyors Act'],
    },
  ],
  reason: 'Focused on the surveyor definition and entry duty.',
  approximateLearningGoal: 'Recall who may enter land to survey and why.',
});

const buildCombineGroup = (): AiProposedSourceGroup => ({
  groupId: 'gc',
  titleSuggestion: 'Surveyor entry and plan filing',
  sourceKeys: ['section:1', 'section:2'],
  focusSelections: [
    {
      sourceKey: 'section:1',
      childLabels: ['1(1)'],
      definedTerms: ['land surveyor'],
      evidenceText: ['registered under the Land Surveyors Act'],
    },
    {
      sourceKey: 'section:2',
      childLabels: ['2(1)'],
      evidenceText: ['filed with the Director'],
    },
  ],
  reason: 'Combined surveyor entry and plan-filing scope.',
  approximateLearningGoal: 'Recall entry powers and filing duties together.',
});

const ctxFor = (proposal: AiStudyMapProposal): AiUnitAuthoringValidationContext => ({
  run: {
    runId: UNIT_RUN_ID,
    jobType: 'unit-authoring',
    providerKind: 'local-openai-compatible',
    promptSpecVersion: 'unit-authoring-v4',
  },
  sourceMapRunId: MAP_RUN_ID,
  proposal,
  groupIndex: 0,
  package: PACKAGE,
  corpusContentHash: CORPUS_HASH,
});

const buildGoldenJob = (proposal: AiStudyMapProposal, group: AiProposedSourceGroup): AiUnitAuthoringJob =>
  buildUnitAuthoringJob({
    proposal,
    group,
    package: PACKAGE,
    runId: UNIT_RUN_ID,
    promptSpecVersion: 'unit-authoring-v4',
    corpusContentHash: CORPUS_HASH,
    sourceMapRunId: MAP_RUN_ID,
    withFrozenPriority: true,
    frozenPriority: proposal.suggestedPriority ?? undefined,
  });

/** Recompute inputHash after a deliberate payload tamper. */
const retag = (job: AiUnitAuthoringJob): AiUnitAuthoringJob => ({
  ...job,
  inputHash: hashText(JSON.stringify({ ...job, inputHash: '' })),
});

const expectIssueCode = (issues: string[], code: string): void => {
  expect(issues.join('\n')).toContain(code);
};

describe('validateAiUnitAuthoringJob — golden frozen jobs validate clean', () => {
  it('accepts a standalone frozen job built by the shared builder', () => {
    const proposal = buildProposal([buildGoldenGroup()]);
    const job = buildGoldenJob(proposal, proposal.proposedGroups[0]);
    expect(validateAiUnitAuthoringJob(job, ctxFor(proposal))).toEqual([]);
  });

  it('accepts a combine (multi-source) frozen job with every source kept', () => {
    const group = buildCombineGroup();
    const proposal = buildProposal([group], {
      id: 'synth-map-run:map-combine-a',
      jobId: 'map-combine-a',
      targetSourceKeys: ['section:1', 'section:2'],
      targetSectionLabels: ['1', '2'],
      disposition: 'combine',
      reason: 'Combined surveyor entry and plan-filing scope.',
    });
    const job = buildGoldenJob(proposal, group);
    expect(job.approvedGroup.sourceKeys).toEqual(['section:1', 'section:2']);
    expect(validateAiUnitAuthoringJob(job, ctxFor(proposal))).toEqual([]);
  });
});

describe('validateAiUnitAuthoringJob — corruption classes fail closed', () => {
  it('flags a tampered approvedGroup (job-level drift from the proposal)', () => {
    const proposal = buildProposal([buildGoldenGroup()]);
    const job = buildGoldenJob(proposal, proposal.proposedGroups[0]);
    const tampered = retag({
      ...job,
      approvedGroup: { ...job.approvedGroup, titleSuggestion: 'TAMPERED' },
    });
    expectIssueCode(validateAiUnitAuthoringJob(tampered, ctxFor(proposal)), 'APPROVED_GROUP_MISMATCH');
  });

  it('flags a wrong jobId', () => {
    const proposal = buildProposal([buildGoldenGroup()]);
    const job = buildGoldenJob(proposal, proposal.proposedGroups[0]);
    expectIssueCode(
      validateAiUnitAuthoringJob({ ...job, jobId: 'unit-0000000000000000' }, ctxFor(proposal)),
      'JOB_ID_MISMATCH',
    );
  });

  it('flags a wrong inputHash', () => {
    const proposal = buildProposal([buildGoldenGroup()]);
    const job = buildGoldenJob(proposal, proposal.proposedGroups[0]);
    expectIssueCode(
      validateAiUnitAuthoringJob({ ...job, inputHash: 'x'.repeat(64) }, ctxFor(proposal)),
      'INPUT_HASH_MISMATCH',
    );
  });

  it('flags a dropped source (sourceHashes missing a combine sourceKey)', () => {
    const group = buildCombineGroup();
    const proposal = buildProposal([group], {
      id: 'synth-map-run:map-combine-b',
      jobId: 'map-combine-b',
      targetSourceKeys: ['section:1', 'section:2'],
      disposition: 'combine',
    });
    const job = buildGoldenJob(proposal, group);
    const dropped = retag({ ...job, sourceHashes: { 'section:1': job.sourceHashes['section:1'] } });
    expectIssueCode(validateAiUnitAuthoringJob(dropped, ctxFor(proposal)), 'SOURCE_KEY_SET_MISMATCH');
  });

  it('flags a corpus contentHash mismatch on a resolved source', () => {
    const proposal = buildProposal([buildGoldenGroup()]);
    const job = buildGoldenJob(proposal, proposal.proposedGroups[0]);
    const tampered = retag({ ...job, sourceHashes: { 'section:1': '0'.repeat(64) } });
    expectIssueCode(validateAiUnitAuthoringJob(tampered, ctxFor(proposal)), 'SOURCE_HASH_MISMATCH');
  });

  it('flags evidence text not grounded in the exact source union', () => {
    const group = buildGoldenGroup();
    group.focusSelections[0] = {
      ...group.focusSelections[0],
      evidenceText: ['registered under the Land Regulators Act'],
    };
    const proposal = buildProposal([group]);
    const job = buildGoldenJob(proposal, group);
    expectIssueCode(validateAiUnitAuthoringJob(job, ctxFor(proposal)), 'FOCUS_EVIDENCE_NOT_GROUNDED');
  });

  it('flags a focus selection whose sourceKey is not an authoring source', () => {
    const group = buildGoldenGroup();
    group.focusSelections[0] = {
      sourceKey: 'section:99',
      childLabels: ['1(1)'],
      definedTerms: ['land surveyor'],
      evidenceText: ['registered under the Land Surveyors Act'],
    };
    const proposal = buildProposal([group]);
    const job = buildGoldenJob(proposal, group);
    expectIssueCode(validateAiUnitAuthoringJob(job, ctxFor(proposal)), 'FOCUS_SOURCE_NOT_IN_GROUP');
  });

  it('flags an invalid childLabel on a source that advertises structural children', () => {
    const group = buildGoldenGroup();
    group.focusSelections[0] = { ...group.focusSelections[0], childLabels: ['1(99)'] };
    const proposal = buildProposal([group]);
    const job = buildGoldenJob(proposal, group);
    expectIssueCode(validateAiUnitAuthoringJob(job, ctxFor(proposal)), 'FOCUS_CHILD_LABEL_INVALID');
  });

  it('flags an invalid definedTerm that the source does not define', () => {
    const group = buildGoldenGroup();
    group.focusSelections[0] = { ...group.focusSelections[0], definedTerms: ['watercourse'] };
    const proposal = buildProposal([group]);
    const job = buildGoldenJob(proposal, group);
    expectIssueCode(validateAiUnitAuthoringJob(job, ctxFor(proposal)), 'FOCUS_DEFINED_TERM_INVALID');
  });

  it('flags a frozenMapPriority that differs from the frozen proposal', () => {
    const proposal = buildProposal([buildGoldenGroup()]);
    const job = buildGoldenJob(proposal, proposal.proposedGroups[0]);
    const tampered = retag({ ...job, frozenMapPriority: 'P4' });
    expectIssueCode(validateAiUnitAuthoringJob(tampered, ctxFor(proposal)), 'FROZEN_PRIORITY_MISMATCH');
  });

  it('flags a missing frozenMapPriority on a frozen job', () => {
    const proposal = buildProposal([buildGoldenGroup()]);
    const job = buildGoldenJob(proposal, proposal.proposedGroups[0]);
    const copy = { ...job };
    delete (copy as { frozenMapPriority?: unknown }).frozenMapPriority;
    const tampered = retag(copy);
    expectIssueCode(validateAiUnitAuthoringJob(tampered, ctxFor(proposal)), 'FROZEN_PRIORITY_MISSING');
  });

  it('flags a zero-source group via the zero-group protection', () => {
    const emptyGroup: AiProposedSourceGroup = {
      groupId: 'g0',
      titleSuggestion: 'Empty',
      sourceKeys: [],
      focusSelections: [],
      reason: 'Empty group.',
      approximateLearningGoal: '',
    };
    const proposal = buildProposal([emptyGroup], {
      id: 'synth-map-run:map-empty',
      jobId: 'map-empty',
      reason: 'Empty group.',
    });
    // The shared builder refuses zero-source groups; construct the job
    // directly so the validator's defensive zero-source protection runs.
    const job = retag({
      schemaVersion: 1,
      jobId: `unit-${hashText(
        JSON.stringify({
          mapRunId: MAP_RUN_ID,
          proposalId: proposal.id,
          groupId: emptyGroup.groupId,
          promptSpecVersion: 'unit-authoring-v4',
          sourceKeys: [],
        }),
      ).slice(0, 16)}`,
      runId: UNIT_RUN_ID,
      promptSpecVersion: 'unit-authoring-v4',
      sourceMapRunId: MAP_RUN_ID,
      sourceMapProposalId: proposal.id,
      corpusContentHash: CORPUS_HASH,
      frozenMapPriority: 'P2' as const,
      inputHash: '',
      document: proposal.document,
      approvedGroup: emptyGroup,
      mapDisposition: 'standalone',
      mapReason: proposal.reason,
      approximateLearningGoal: '',
      group: emptyGroup,
      sourceHashes: {},
      sourceStatuses: {},
      contentFlagsBySourceKey: {},
      exactSourceText: '',
      operativeSourceText: '',
      sourceMetadata: {},
      context: { relatedSourceKeys: ['section:1'], warnings: [] },
    } as AiUnitAuthoringJob);
    expectIssueCode(validateAiUnitAuthoringJob(job, ctxFor(proposal)), 'ZERO_SOURCE_GROUP');
  });
});

describe('normalizeGroundingText', () => {
  it('collapses whitespace, quote glyphs, dashes, ellipsis markers, and accents', () => {
    // Accents are stripped symmetrically on both sides of a comparison.
    expect(normalizeGroundingText('A ‘café’—plan … X')).toBe('acafplanx');
    expect(normalizeGroundingText('a cafe plan x')).toBe('acafeplanx');
    expect(normalizeGroundingText("King’s Bench ‘decision’")).toBe('kingsbenchdecision');
    expect(normalizeGroundingText('by - laws')).toBe('bylaws');
  });
});
