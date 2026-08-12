import { describe, expect, it } from 'vitest';
import {
  applyAiProposalApprovalToSnapshot,
  buildStudyUnitFromAiProposal,
} from '../../src/study/ai/studyAiApproval';
import {
  mapResultToProposal,
  reconcileAiStudyMapProposals,
  validateAiStudyMapJob,
  validateAiStudyMapResult,
  validateAiStudyUnitProposal,
} from '../../src/study/ai/studyAiValidation';
import type {
  AiStoredUnitProposal,
  AiStudyMapJob,
  AiStudyMapResult,
} from '../../src/study/ai/studyAiTypes';
import { exportStudyData, parseStudyImport } from '../../src/study/studyExportImport';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { ImportedLegalComponent } from '../../src/study/studyTypes';

const sourceComponent: ImportedLegalComponent = {
  documentId: 'doc-boundaries-confirmation-act',
  id: 'section-10',
  sourceKey: 'section:10',
  componentType: 'section',
  label: '10',
  heading: 'Objection',
  text: '10 A person may deliver a written objection to the Registrar General before the deadline in the notice.',
  contentHash: 'hash-section-10',
  extractionStatus: 'complete',
};

const mapJob = (): AiStudyMapJob => ({
  schemaVersion: 1,
  jobId: 'map-1',
  runId: 'run-1',
  corpusContentHash: 'corpus-hash',
  inputHash: 'input-hash',
  document: {
    documentId: sourceComponent.documentId,
    title: 'Boundaries Confirmation Act',
    citation: 'B-7.1',
    type: 'act',
  },
  target: {
    sourceKeys: [sourceComponent.sourceKey],
    sectionLabels: [sourceComponent.label],
    heading: sourceComponent.heading,
    exactSourceText: sourceComponent.text,
    sourceHashes: { [sourceComponent.sourceKey]: sourceComponent.contentHash },
  },
  context: {},
});

const unitProposal = (): AiStoredUnitProposal => ({
  schemaVersion: 1,
  proposalId: 'proposal-1',
  runId: 'run-1',
  corpusContentHash: 'corpus-hash',
  sourceDocumentId: sourceComponent.documentId,
  sourceKeys: [sourceComponent.sourceKey],
  sourceHashes: { [sourceComponent.sourceKey]: sourceComponent.contentHash },
  title: 'Objection and hearing process',
  mainQuestion: 'How does the objection process work under section 10?',
  studySummary: 'A person can object in writing before the notice deadline.',
  objectives: [
    {
      id: 'obj-1',
      type: 'filing',
      objective: 'Know how an objection is submitted.',
      guidedQuestion: 'How must an objection be submitted?',
      studyAnswer:
        'The objection must be written and delivered to the Registrar General before the notice deadline.',
      required: true,
      sourceKeys: [sourceComponent.sourceKey],
      evidence: [
        {
          sourceKey: sourceComponent.sourceKey,
          evidenceText: 'written objection to the Registrar General before the deadline',
        },
      ],
      confidence: 'high',
    },
  ],
  confidence: 'high',
  warnings: [],
  generationMetadata: {
    providerKind: 'external-codex',
    promptSpecVersion: 'unit-authoring-v1',
    generatedAt: '2026-08-12T10:00:00.000Z',
  },
  reviewStatus: 'generated',
  validationStatus: 'not-validated',
  validationMessages: [],
  conflictCodes: [],
  createdAt: '2026-08-12T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
});

describe('AI authoring schemas and validation', () => {
  it('accepts a valid Study Map job and rejects an invalid disposition', () => {
    expect(validateAiStudyMapJob(mapJob()).valid).toBe(true);
    const result = {
      schemaVersion: 1,
      jobId: 'map-1',
      runId: 'run-1',
      corpusContentHash: 'corpus-hash',
      inputHash: 'input-hash',
      disposition: 'bad',
      confidence: 'high',
      reason: 'Useful study source.',
      proposedGroups: [],
      warnings: [],
    };

    expect(validateAiStudyMapResult(result, mapJob()).issues[0]?.code).toBe(
      'INVALID_DISPOSITION',
    );
  });

  it('validates grounding evidence against authoritative source text', () => {
    expect(
      validateAiStudyUnitProposal({
        proposal: unitProposal(),
        sourceComponents: [sourceComponent],
      }).valid,
    ).toBe(true);

    const stale = unitProposal();
    stale.sourceHashes[sourceComponent.sourceKey] = 'old-hash';
    const report = validateAiStudyUnitProposal({
      proposal: stale,
      sourceComponents: [sourceComponent],
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('SOURCE_HASH_CHANGED');
  });

  it('flags conflicting overlapping Study Map groups deterministically', () => {
    const result = (jobId: string, sourceKeys: string[]): AiStudyMapResult => ({
      schemaVersion: 1,
      jobId,
      runId: 'run-1',
      corpusContentHash: 'corpus-hash',
      disposition: 'combine',
      confidence: 'medium',
      reason: 'Combine adjacent rules.',
      proposedGroups: [
        {
          groupId: `group-${jobId}`,
          titleSuggestion: 'Combined rule',
          sourceKeys,
          reason: 'Related provisions.',
          approximateLearningGoal: 'Understand the combined workflow.',
        },
      ],
      warnings: [],
    });
    const job = mapJob();
    const proposals = reconcileAiStudyMapProposals([
      mapResultToProposal({ result: result('map-1', ['section:10', 'section:11']), job }),
      mapResultToProposal({
        result: result('map-2', ['section:11']),
        job: { ...job, jobId: 'map-2' },
      }),
    ]);

    expect(proposals.every((proposal) => proposal.conflictCodes.includes('MAP_CONFLICT'))).toBe(
      true,
    );
  });
});

describe('AI proposal lifecycle and StudyUnit mapping', () => {
  it('maps an approved AI proposal to one normal StudyUnit without attempts', () => {
    const built = buildStudyUnitFromAiProposal({
      proposal: unitProposal(),
      sourceComponents: [sourceComponent],
      existingUnitIds: new Set(),
      nowIso: '2026-08-12T11:00:00.000Z',
    });

    expect(built.unit.generationOrigin).toBe('ai');
    expect(built.unit.referenceAnswerOrigin).toBe('ai-source-grounded');
    expect(built.prompt.question).toBe('How does the objection process work under section 10?');
    expect(built.rubrics[0]?.prompt).toBe('How must an objection be submitted?');
    expect(built.progress.unitId).toBe(built.unit.id);
  });

  it('approves proposals in snapshot form and export/import preserves proposal history', () => {
    const seed = createSeedStudyData('2026-08-12T10:00:00.000Z');
    const proposal = unitProposal();
    const snapshot = {
      ...seed,
      aiUnitProposals: [proposal],
    };

    const approved = applyAiProposalApprovalToSnapshot({
      snapshot,
      proposal,
      sourceComponents: [sourceComponent],
      nowIso: '2026-08-12T11:00:00.000Z',
    });
    const restored = parseStudyImport(exportStudyData(approved, '2026-08-12T12:00:00.000Z'));

    expect(approved.units).toHaveLength(seed.units.length + 1);
    expect(approved.aiUnitProposals[0]?.reviewStatus).toBe('approved');
    expect(approved.attempts).toHaveLength(0);
    expect(restored.aiUnitProposals[0]?.approvedUnitId).toBe(
      approved.aiUnitProposals[0]?.approvedUnitId,
    );
    expect(restored.units.at(-1)?.aiAuthoring?.proposalId).toBe(proposal.proposalId);
  });
});
