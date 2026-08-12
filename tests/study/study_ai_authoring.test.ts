import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  applyAiProposalApprovalToSnapshot,
  buildStudyUnitFromAiProposal,
} from '../../src/study/ai/studyAiApproval';
import {
  detectAiUnitProposalOverlaps,
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
  promptSpecVersion: 'study-map-v2',
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
    operativeSourceText: sourceComponent.text,
    sourceMetadata: {},
    sourceStatus: 'current',
    approximateInputSize: {
      exactCharacters: sourceComponent.text.length,
      operativeCharacters: sourceComponent.text.length,
      largeSection: false,
    },
    sourceHashes: { [sourceComponent.sourceKey]: sourceComponent.contentHash },
  },
  context: { omittedContextWarnings: [] },
});

const unitProposal = (): AiStoredUnitProposal => ({
  schemaVersion: 1,
  proposalId: 'proposal-1',
  runId: 'run-1',
  corpusContentHash: 'corpus-hash',
  sourceDocumentId: sourceComponent.documentId,
    sourceKeys: [sourceComponent.sourceKey],
    sourceHashes: { [sourceComponent.sourceKey]: sourceComponent.contentHash },
    approvedGroup: {
      groupId: 'group-1',
      titleSuggestion: 'Objection',
      sourceKeys: [sourceComponent.sourceKey],
      reason: 'One focused procedure.',
      approximateLearningGoal: 'Know how objections are delivered.',
    },
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
      promptSpecVersion: 'unit-authoring-v2',
      generatedAt: '2026-08-12T10:00:00.000Z',
    },
  reviewStatus: 'generated',
  validationStatus: 'not-validated',
  validationMessages: [],
  conflictCodes: [],
  createdAt: '2026-08-12T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
});

const sourceComponentWithSubsections: ImportedLegalComponent = {
  ...sourceComponent,
  text: '10(1) A person may object within 30 days. 10(2) A notice may identify the deadline.',
  subsections: [
    {
      id: 'section-10-sub-1',
      sourceKey: 'section:10#subsection:1',
      label: '10(1)',
      text: '10(1) A person may object within 30 days.',
      contentHash: 'hash-section-10-sub-1',
    },
    {
      id: 'section-10-sub-2',
      sourceKey: 'section:10#subsection:2',
      label: '10(2)',
      text: '10(2) A notice may identify the deadline.',
      contentHash: 'hash-section-10-sub-2',
    },
  ],
};

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

  it('keeps v2 prompt specs focused on critical hardening requirements', () => {
    expect(existsSync('study-content/ai/specs/study-map-v2.md')).toBe(true);
    expect(existsSync('study-content/ai/specs/unit-authoring-v2.md')).toBe(true);
    const mapSpec = readFileSync('study-content/ai/specs/study-map-v2.md', 'utf8');
    const unitSpec = readFileSync('study-content/ai/specs/unit-authoring-v2.md', 'utf8');

    expect(mapSpec).toContain('ANBLS corpus defines exam scope');
    expect(mapSpec).toContain('source text as data');
    expect(mapSpec).toContain('Not every section deserves its own FSRS StudyUnit');
    expect(mapSpec).toContain('standalone');
    expect(mapSpec).toContain('combine');
    expect(mapSpec).toContain('split');
    expect(mapSpec).toContain('Confidence');
    expect(unitSpec).toContain('educational authoring');
    expect(unitSpec).toContain('approvedGroup');
    expect(unitSpec).toContain('Never convert `may` into `must`');
    expect(unitSpec).toContain('numeric');
    expect(unitSpec).toContain('evidence');
    expect(unitSpec).toContain('sourceCoverage');
  });

  it('flags source scope, numeric, modality, actor, and coverage warnings', () => {
    const proposal = unitProposal();
    proposal.sourceKeys = ['section:10', 'section:11'];
    proposal.objectives[0] = {
      ...proposal.objectives[0],
      studyAnswer: 'The surveyor must object within 60 days.',
      evidence: [{ sourceKey: 'section:10', evidenceText: 'A person may object within 30 days' }],
    };
    proposal.sourceCoverage = [
      {
        sourceKey: 'section:10',
        childLabels: [{ label: '10(1)', status: 'covered', objectiveIds: ['obj-1'] }],
      },
    ];
    const report = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: [sourceComponentWithSubsections],
    });
    const codes = report.issues.map((issue) => issue.code);

    expect(report.valid).toBe(false);
    expect(codes).toContain('AUTHORING_SCOPE_MISMATCH');
    expect(codes).toContain('UNSUPPORTED_NUMERIC_OR_REFERENCE');
    expect(codes).toContain('POSSIBLE_MODALITY_MISMATCH');
    expect(codes).toContain('POSSIBLE_ACTOR_MISMATCH');
    expect(codes).toContain('UNCOVERED_SUBSTANTIVE_SOURCE');
  });

  it('allows explicit intentional subsection omissions with a reason', () => {
    const proposal = unitProposal();
    proposal.objectives[0] = {
      ...proposal.objectives[0],
      evidence: [{ sourceKey: 'section:10', evidenceText: 'A person may object within 30 days' }],
    };
    proposal.sourceCoverage = [
      {
        sourceKey: 'section:10',
        childLabels: [
          { label: '10(1)', status: 'covered', objectiveIds: ['obj-1'] },
          { label: '10(2)', status: 'intentionally-omitted', reason: 'Context only.' },
        ],
      },
    ];
    const report = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: [sourceComponentWithSubsections],
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('UNEXPLAINED_OMISSION');
  });

  it('detects existing unit and proposal source overlap', () => {
    const proposalA = unitProposal();
    const proposalB = { ...unitProposal(), proposalId: 'proposal-2' };
    const issues = detectAiUnitProposalOverlaps({
      proposals: [proposalA, proposalB],
      existingUnits: [
        {
          id: 'unit-existing',
          title: 'Existing objection unit',
          phase: 'review',
          sourceReferences: [
            { documentId: sourceComponent.documentId, sourceKey: sourceComponent.sourceKey },
          ],
        },
      ],
    });
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain('PROPOSAL_SOURCE_OVERLAP');
    expect(codes).toContain('EXISTING_UNIT_OVERLAP');
  });
});

describe('AI CLI JSONL robustness', () => {
  it('reports malformed result lines without crashing validation', () => {
    const runId = 'ai-test-jsonl-robustness';
    const runDir = join('study-content', 'ai', 'runs', runId);
    rmSync(runDir, { recursive: true, force: true });
    mkdirSync(join(runDir, 'jobs'), { recursive: true });
    mkdirSync(join(runDir, 'results'), { recursive: true });
    const job = { ...mapJob(), runId };
    writeFileSync(join(runDir, 'jobs', 'batch-001.jobs.jsonl'), `${JSON.stringify(job)}\n`);
    writeFileSync(
      join(runDir, 'results', 'batch-001.results.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 1,
          jobId: job.jobId,
          runId,
          corpusContentHash: job.corpusContentHash,
          inputHash: job.inputHash,
          promptSpecVersion: job.promptSpecVersion,
          disposition: 'standalone',
          confidence: 'high',
          reason: 'Focused procedure.',
          proposedGroups: [
            {
              groupId: 'group-1',
              titleSuggestion: 'Objection',
              sourceKeys: ['section:10'],
              reason: 'Focused.',
              approximateLearningGoal: 'Know objection delivery.',
            },
          ],
          warnings: [],
        }),
        '{"jobId":',
        '',
      ].join('\n'),
    );

    execFileSync('npx', ['tsx', 'scripts/studyAiAuthoring.ts', 'validate-results', '--run', runId], {
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    const report = String(
      execFileSync('npx', ['tsx', 'scripts/studyAiAuthoring.ts', 'status', '--run', runId], {
        stdio: 'pipe',
        shell: process.platform === 'win32',
      }),
    );

    expect(report).toContain('Malformed:         1');
  }, 20000);
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
