import { afterAll, describe, expect, it } from 'vitest';
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
  promptSpecVersion: 'study-map-v3',
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
    contentFlags: { containsRepealedSubprovision: false, repealOnly: false },
    approximateInputSize: {
      exactCharacters: sourceComponent.text.length,
      operativeCharacters: sourceComponent.text.length,
      largeSection: false,
    },
    sourceFocusOptions: [
      {
        sourceKey: sourceComponent.sourceKey,
        label: sourceComponent.label,
        childLabels: sourceComponent.subsections?.map((subsection) => subsection.label),
      },
    ],
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
    focusSelections: [{ sourceKey: sourceComponent.sourceKey, evidenceText: ['written objection'] }],
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
    promptSpecVersion: 'unit-authoring-v3',
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

afterAll(() => {
  [
    'ai-test-jsonl-robustness',
    'ai-test-phase-4b1-sampling',
    'ai-test-phase-4b11-targeted',
    'ai-test-phase-4b12-grounding',
    'ai-test-phase-4b13-units',
    'ai-test-pilot-report',
  ].forEach((runId) => {
    rmSync(join('study-content', 'ai', 'runs', runId), { recursive: true, force: true });
  });
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

  it('rejects malformed priority values and warning codes leaked into reason', () => {
    const job = mapJob();
    const result = (reason: string, suggestedPriority: string): AiStudyMapResult => ({
      schemaVersion: 1,
      jobId: job.jobId,
      runId: job.runId,
      corpusContentHash: job.corpusContentHash,
      inputHash: job.inputHash,
      promptSpecVersion: job.promptSpecVersion,
      disposition: 'reference-only',
      confidence: 'medium',
      reason,
      suggestedPriority: suggestedPriority as AiStudyMapResult['suggestedPriority'],
      proposedGroups: [],
      warnings: ['REFERENCE_ONLY_RECOMMENDED'],
    });

    [
      'VERY_SHORT_REFERENCE_ONLY',
      'SHORT_CONTEXT_REFERENCE_ONLY',
      'COMMENCEMENT_OR_CITATION_REFERENCE_ONLY',
    ].forEach((reason) => {
      const report = validateAiStudyMapResult(
        result(reason, 'The provision is short contextual material and likely better located than memorized.'),
        job,
      );
      const codes = report.issues.map((issue) => issue.code);
      expect(report.valid).toBe(false);
      expect(codes).toContain('INVALID_SUGGESTED_PRIORITY');
      expect(codes).toContain('WARNING_CODE_IN_REASON');
    });
  });

  it('blocks Study Map focus evidence sourced only from next context', () => {
    const job = {
      ...mapJob(),
      target: {
        ...mapJob().target,
        sourceKeys: ['section:18'],
        sectionLabels: ['18'],
        exactSourceText: '18(9) The registrar shall notify the presenter of rejection.',
        operativeSourceText: '18(9) The registrar shall notify the presenter of rejection.',
        sourceHashes: { 'section:18': 'hash-section-18' },
        sourceFocusOptions: [{ sourceKey: 'section:18', label: '18', childLabels: ['18(9)'] }],
      },
      context: {
        next: {
          sourceKey: 'section:19',
          sectionLabel: '19',
          text: '19 Priority is determined according to registration date and time.',
          operativeText: '19 Priority is determined according to registration date and time.',
          sourceHash: 'hash-section-19',
          contextRole: 'next' as const,
        },
        omittedContextWarnings: [],
      },
    };
    const result: AiStudyMapResult = {
      schemaVersion: 1,
      jobId: job.jobId,
      runId: job.runId,
      corpusContentHash: job.corpusContentHash,
      inputHash: job.inputHash,
      promptSpecVersion: job.promptSpecVersion,
      disposition: 'standalone',
      confidence: 'high',
      reason: 'Priority timing is the key effect.',
      proposedGroups: [
        {
          groupId: 'group-1',
          titleSuggestion: 'Registration priority and timing',
          sourceKeys: ['section:18'],
          focusSelections: [
            {
              sourceKey: 'section:18',
              childLabels: ['18(9)'],
              evidenceText: ['registration date and time'],
            },
          ],
          reason: 'Priority is determined by timing.',
          approximateLearningGoal: 'Recall registration priority and timing.',
        },
      ],
      warnings: [],
    };
    const report = validateAiStudyMapResult(result, job);
    const codes = report.issues.map((issue) => issue.code);

    expect(report.valid).toBe(false);
    expect(codes).toContain('FOCUS_EVIDENCE_NOT_IN_SOURCE');
    expect(codes).toContain('GROUP_TOPIC_NOT_GROUNDED');
  });

  it('blocks Study Map topics sourced only from previous context', () => {
    const job = {
      ...mapJob(),
      target: {
        ...mapJob().target,
        sourceKeys: ['section:125'],
        sectionLabels: ['125'],
        exactSourceText: '125 Regulations may prescribe the effect of development approvals.',
        operativeSourceText: '125 Regulations may prescribe the effect of development approvals.',
        sourceHashes: { 'section:125': 'hash-section-125' },
        sourceFocusOptions: [{ sourceKey: 'section:125', label: '125' }],
      },
      context: {
        previous: {
          sourceKey: 'section:124',
          sectionLabel: '124',
          text: '124 Regulations may establish appeal procedures.',
          operativeText: '124 Regulations may establish appeal procedures.',
          sourceHash: 'hash-section-124',
          contextRole: 'previous' as const,
        },
        omittedContextWarnings: [],
      },
    };
    const result: AiStudyMapResult = {
      schemaVersion: 1,
      jobId: job.jobId,
      runId: job.runId,
      corpusContentHash: job.corpusContentHash,
      inputHash: job.inputHash,
      promptSpecVersion: job.promptSpecVersion,
      disposition: 'standalone',
      confidence: 'high',
      reason: 'Appeal procedure topic.',
      proposedGroups: [
        {
          groupId: 'group-1',
          titleSuggestion: 'Appeal procedure',
          sourceKeys: ['section:125'],
          focusSelections: [{ sourceKey: 'section:125', evidenceText: ['development approvals'] }],
          reason: 'Appeals are the main administrative process.',
          approximateLearningGoal: 'Recall appeal procedures.',
        },
      ],
      warnings: [],
    };

    expect(validateAiStudyMapResult(result, job).issues.map((issue) => issue.code)).toContain(
      'GROUP_TOPIC_NOT_GROUNDED',
    );
  });

  it('allows target-grounded Study Map paraphrase and evidence', () => {
    const job = {
      ...mapJob(),
      target: {
        ...mapJob().target,
        sourceKeys: ['section:18'],
        sectionLabels: ['18'],
        exactSourceText: '18(9) The registrar shall notify the presenter of rejection.',
        operativeSourceText: '18(9) The registrar shall notify the presenter of rejection.',
        sourceHashes: { 'section:18': 'hash-section-18' },
        sourceFocusOptions: [{ sourceKey: 'section:18', label: '18', childLabels: ['18(9)'] }],
      },
      context: {
        next: {
          sourceKey: 'section:19',
          sectionLabel: '19',
          text: '19 Priority is determined according to registration date and time.',
          operativeText: '19 Priority is determined according to registration date and time.',
          sourceHash: 'hash-section-19',
          contextRole: 'next' as const,
        },
        omittedContextWarnings: [],
      },
    };
    const result: AiStudyMapResult = {
      schemaVersion: 1,
      jobId: job.jobId,
      runId: job.runId,
      corpusContentHash: job.corpusContentHash,
      inputHash: job.inputHash,
      promptSpecVersion: job.promptSpecVersion,
      disposition: 'standalone',
      confidence: 'high',
      reason: 'Notification after rejection is the target rule.',
      proposedGroups: [
        {
          groupId: 'group-1',
          titleSuggestion: 'Notification after rejection',
          sourceKeys: ['section:18'],
          focusSelections: [{ sourceKey: 'section:18', childLabels: ['18(9)'], evidenceText: ['notify the presenter of rejection'] }],
          reason: 'The target requires the registrar to notify the presenter.',
          approximateLearningGoal: 'Recall who must be notified after rejection.',
        },
      ],
      warnings: [],
    };

    expect(validateAiStudyMapResult(result, job).valid).toBe(true);
  });

  it('allows evidence from explicitly included combine sources but not omitted context', () => {
    const job = {
      ...mapJob(),
      target: {
        ...mapJob().target,
        sourceKeys: ['section:10'],
        sectionLabels: ['10'],
        exactSourceText: '10 A registrar shall give notice.',
        operativeSourceText: '10 A registrar shall give notice.',
        sourceHashes: { 'section:10': 'hash-section-10' },
        sourceFocusOptions: [{ sourceKey: 'section:10', label: '10' }],
      },
      context: {
        next: {
          sourceKey: 'section:11',
          sectionLabel: '11',
          text: '11 A presenter may request reasons.',
          operativeText: '11 A presenter may request reasons.',
          sourceHash: 'hash-section-11',
          contextRole: 'next' as const,
        },
        directlyReferencedProvisions: [
          {
            sourceKey: 'section:12',
            sectionLabel: '12',
            text: '12 Priority follows registration time.',
            operativeText: '12 Priority follows registration time.',
            sourceHash: 'hash-section-12',
            contextRole: 'direct-reference' as const,
          },
        ],
        omittedContextWarnings: [],
      },
    };
    const result: AiStudyMapResult = {
      schemaVersion: 1,
      jobId: job.jobId,
      runId: job.runId,
      corpusContentHash: job.corpusContentHash,
      inputHash: job.inputHash,
      promptSpecVersion: job.promptSpecVersion,
      disposition: 'combine',
      confidence: 'high',
      reason: 'Notice and reasons fit together.',
      proposedGroups: [
        {
          groupId: 'group-1',
          titleSuggestion: 'Notice and reasons',
          sourceKeys: ['section:10', 'section:11'],
          focusSelections: [
            { sourceKey: 'section:10', evidenceText: ['give notice'] },
            { sourceKey: 'section:11', evidenceText: ['request reasons'] },
          ],
          reason: 'The included sources cover notice and reasons.',
          approximateLearningGoal: 'Recall notice and reasons.',
        },
      ],
      warnings: [],
    };
    expect(validateAiStudyMapResult(result, job).valid).toBe(true);

    result.proposedGroups[0] = {
      ...result.proposedGroups[0],
      titleSuggestion: 'Notice, reasons, and priority',
      reason: 'Priority follows registration time too.',
      approximateLearningGoal: 'Recall notice, reasons, and priority.',
    };
    expect(validateAiStudyMapResult(result, job).issues.map((issue) => issue.code)).toContain(
      'GROUP_TOPIC_NOT_GROUNDED',
    );
  });

  it('blocks child labels and defined terms absent from the focus source', () => {
    const job = {
      ...mapJob(),
      target: {
        ...mapJob().target,
        sourceKeys: ['section:1'],
        sectionLabels: ['1'],
        exactSourceText: '"coordinate monument" means a brass, bronze or aluminum cap or plate.',
        operativeSourceText: '"coordinate monument" means a brass, bronze or aluminum cap or plate.',
        sourceHashes: { 'section:1': 'hash-section-1' },
        sourceFocusOptions: [
          {
            sourceKey: 'section:1',
            label: '1',
            childLabels: ['1(1)'],
            definedTerms: ['coordinate monument'],
          },
        ],
      },
    };
    const result: AiStudyMapResult = {
      schemaVersion: 1,
      jobId: job.jobId,
      runId: job.runId,
      corpusContentHash: job.corpusContentHash,
      inputHash: job.inputHash,
      promptSpecVersion: job.promptSpecVersion,
      disposition: 'split',
      confidence: 'high',
      reason: 'Definition grouping.',
      proposedGroups: [
        {
          groupId: 'group-1',
          titleSuggestion: 'Director definition',
          sourceKeys: ['section:1'],
          focusSelections: [
            {
              sourceKey: 'section:1',
              childLabels: ['1(2)'],
              definedTerms: ['Director'],
              evidenceText: ['coordinate monument means a brass'],
            },
          ],
          reason: 'Director definition.',
          approximateLearningGoal: 'Recall the Director definition.',
        },
      ],
      warnings: [],
    };
    const codes = validateAiStudyMapResult(result, job).issues.map((issue) => issue.code);

    expect(codes).toContain('FOCUS_CHILD_LABEL_NOT_IN_SOURCE');
    expect(codes).toContain('DEFINED_TERM_NOT_IN_FOCUS_SOURCE');
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
          focusSelections: sourceKeys.map((sourceKey) => ({ sourceKey })),
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

  it('does not treat split siblings with distinct source focus as conflicts', () => {
    const job = mapJob();
    const result: AiStudyMapResult = {
      schemaVersion: 1,
      jobId: 'map-1',
      runId: 'run-1',
      corpusContentHash: 'corpus-hash',
      inputHash: 'input-hash',
      promptSpecVersion: 'study-map-v3',
      disposition: 'split',
      confidence: 'medium',
      reason: 'Distinct source focus.',
      suggestedPriority: 'P1',
      proposedGroups: [
        {
          groupId: 'group-1',
          titleSuggestion: 'Objection delivery',
          sourceKeys: ['section:10'],
          focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(1)'] }],
          reason: 'Focuses on delivery.',
          approximateLearningGoal: 'Recall objection delivery.',
        },
        {
          groupId: 'group-2',
          titleSuggestion: 'Hearing notice',
          sourceKeys: ['section:10'],
          focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(2)'] }],
          reason: 'Focuses on hearing notice.',
          approximateLearningGoal: 'Recall hearing notice.',
        },
      ],
      warnings: [],
    };

    const proposals = reconcileAiStudyMapProposals([mapResultToProposal({ result, job })]);

    expect(proposals[0]?.conflictCodes).toEqual([]);
  });

  it('keeps v3 prompt specs focused on critical hardening requirements', () => {
    expect(existsSync('study-content/ai/specs/study-map-v3.md')).toBe(true);
    expect(existsSync('study-content/ai/specs/unit-authoring-v3.md')).toBe(true);
    const mapSpec = readFileSync('study-content/ai/specs/study-map-v3.md', 'utf8');
    const unitSpec = readFileSync('study-content/ai/specs/unit-authoring-v3.md', 'utf8');

    expect(mapSpec).toContain('AI model must make educational/content decisions');
    expect(mapSpec).toContain('source text as data');
    expect(mapSpec).toContain('focusSelections');
    expect(mapSpec).toContain('standalone');
    expect(mapSpec).toContain('combine');
    expect(mapSpec).toContain('split');
    expect(mapSpec).toContain('Allowed confidence values');
    expect(unitSpec).toContain('educational content authoring');
    expect(unitSpec).toContain('approvedGroup');
    expect(unitSpec).toContain('Never convert `may` into `must`');
    expect(unitSpec).toContain('deadline');
    expect(unitSpec).toContain('evidence');
    expect(unitSpec).toContain('CONTEXT FOR UNDERSTANDING ONLY');
  });

  it('flags source scope, numeric, modality, actor, and coverage warnings', () => {
    const proposal = unitProposal();
    proposal.sourceKeys = ['section:10', 'section:11'];
    proposal.approvedGroup = {
      ...proposal.approvedGroup!,
      focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(1)', '10(2)'] }],
    };
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
              focusSelections: [{ sourceKey: 'section:10', evidenceText: ['written objection'] }],
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
  }, 30000);

  it('applies Phase 4B.1 required cases to the 100-job representative pilot sample', () => {
    const runId = 'ai-test-phase-4b1-sampling';
    const runDir = join('study-content', 'ai', 'runs', runId);
    rmSync(runDir, { recursive: true, force: true });

    execFileSync(
      'npx',
      [
        'tsx',
        'scripts/studyAiAuthoring.ts',
        'prepare-map',
        '--run',
        runId,
        '--sample',
        '100',
        '--seed',
        '42',
        '--strategy',
        'representative',
      ],
      {
        stdio: 'pipe',
        shell: process.platform === 'win32',
      },
    );
    const report = JSON.parse(
      readFileSync(join(runDir, 'reports', 'sampling-report.json'), 'utf8'),
    ) as {
      phase4b1RequiredIncludesApplied: boolean;
      selectedJobs: number;
      documentDistribution: Record<string, number>;
    };
    const jobs = readFileSync(join(runDir, 'jobs', 'batch-001.jobs.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as AiStudyMapJob);
    const allJobs = [
      ...jobs,
      ...readFileSync(join(runDir, 'jobs', 'batch-002.jobs.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as AiStudyMapJob),
      ...readFileSync(join(runDir, 'jobs', 'batch-003.jobs.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as AiStudyMapJob),
      ...readFileSync(join(runDir, 'jobs', 'batch-004.jobs.jsonl'), 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as AiStudyMapJob),
    ];
    const includeKeys = new Set(
      allJobs.map((job) => `${job.document.documentId}:${job.target.sectionLabels[0]}`),
    );

    expect(report.phase4b1RequiredIncludesApplied).toBe(true);
    expect(report.selectedJobs).toBe(100);
    expect(allJobs.filter((job) => job.document.type === 'regulation').length).toBeGreaterThanOrEqual(8);
    expect(includeKeys).toContain('doc-boundaries-confirmation-act:10');
    expect(includeKeys).toContain('doc-surveys-act:14');
    expect(includeKeys).toContain('doc-community-planning-act:125');
    expect(includeKeys).toContain('doc-land-titles-act:83');
    expect(includeKeys).toContain('doc-registry-act:19');
  }, 30000);

  it('prepares the Phase 4B.1.1 targeted v3 sample with current whole-section status for mixed repeals', () => {
    const runId = 'ai-test-phase-4b11-targeted';
    const runDir = join('study-content', 'ai', 'runs', runId);
    rmSync(runDir, { recursive: true, force: true });

    execFileSync(
      'npx',
      [
        'tsx',
        'scripts/studyAiAuthoring.ts',
        'prepare-map',
        '--run',
        runId,
        '--strategy',
        'phase-4b1.1-targeted',
        '--batch-size',
        '8',
      ],
      {
        stdio: 'pipe',
        shell: process.platform === 'win32',
      },
    );
    const report = JSON.parse(
      readFileSync(join(runDir, 'reports', 'sampling-report.json'), 'utf8'),
    ) as {
      selectedJobs: number;
      strategyVersion: string;
    };
    const allJobs = ['batch-001.jobs.jsonl', 'batch-002.jobs.jsonl', 'batch-003.jobs.jsonl']
      .flatMap((file) =>
        readFileSync(join(runDir, 'jobs', file), 'utf8')
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line) as AiStudyMapJob),
      );
    const landTitles18 = allJobs.find(
      (job) => job.document.documentId === 'doc-land-titles-act' && job.target.sectionLabels[0] === '18',
    );
    const repealOnly = allJobs.find((job) => job.target.contentFlags?.repealOnly);

    expect(report.selectedJobs).toBe(24);
    expect(report.strategyVersion).toBe('phase-4b1.1-targeted-v1');
    expect(allJobs[0]?.promptSpecVersion).toBe('study-map-v3');
    expect(landTitles18?.target.sourceStatus).toBe('current');
    expect(landTitles18?.target.contentFlags?.containsRepealedSubprovision).toBe(true);
    expect(repealOnly?.target.sourceStatus).toBe('repealed');
  }, 30000);

  it('prepares the Phase 4B.1.2 grounding sample with citation-only metadata separated from commencement', () => {
    const runId = 'ai-test-phase-4b12-grounding';
    const runDir = join('study-content', 'ai', 'runs', runId);
    rmSync(runDir, { recursive: true, force: true });

    execFileSync(
      'npx',
      [
        'tsx',
        'scripts/studyAiAuthoring.ts',
        'prepare-map',
        '--run',
        runId,
        '--strategy',
        'phase-4b1.2-grounding',
        '--batch-size',
        '9',
      ],
      {
        stdio: 'pipe',
        shell: process.platform === 'win32',
      },
    );
    const report = JSON.parse(
      readFileSync(join(runDir, 'reports', 'sampling-report.json'), 'utf8'),
    ) as {
      selectedJobs: number;
      strategyVersion: string;
    };
    const jobs = readFileSync(join(runDir, 'jobs', 'batch-001.jobs.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as AiStudyMapJob);
    const citationRule = jobs.find(
      (job) => job.document.documentId === 'reg-surveys-84-76' && job.target.sectionLabels[0] === '1',
    );

    expect(report.selectedJobs).toBe(9);
    expect(report.strategyVersion).toBe('phase-4b1.2-grounding-v1');
    expect(citationRule?.target.contentFlags?.citationOnly).toBe(true);
    expect(citationRule?.target.contentFlags?.commencementOnly).toBe(false);
  }, 30000);

  it('prepares exactly 16 Phase 4B.1.3 Unit Authoring v3 pilot jobs', () => {
    const runId = 'ai-test-phase-4b13-units';
    const runDir = join('study-content', 'ai', 'runs', runId);
    rmSync(runDir, { recursive: true, force: true });

    execFileSync(
      'npx',
      [
        'tsx',
        'scripts/studyAiAuthoring.ts',
        'prepare-units',
        '--run',
        'ai-map-4b12-grounding-s9-v1',
        '--unit-run',
        runId,
        '--strategy',
        'phase-4b1.3-unit-pilot',
        '--batch-size',
        '8',
      ],
      {
        stdio: 'pipe',
        shell: process.platform === 'win32',
      },
    );
    const report = JSON.parse(
      readFileSync(join(runDir, 'reports', 'unit-job-report.json'), 'utf8'),
    ) as {
      jobs: number;
      selectedGroups: Array<{
        title: string;
        promptSpecVersion: string;
        inputHash: string;
        focusSelections: Array<{ childLabels?: string[]; definedTerms?: string[] }>;
      }>;
    };
    const batchFiles = ['batch-001.jobs.jsonl', 'batch-002.jobs.jsonl'];
    const jobs = batchFiles.flatMap((file) =>
      readFileSync(join(runDir, 'jobs', file), 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line)),
    );

    expect(report.jobs).toBe(16);
    expect(jobs).toHaveLength(16);
    expect(jobs.every((job) => job.promptSpecVersion === 'unit-authoring-v3')).toBe(true);
    expect(jobs.every((job) => job.inputHash && job.sourceHashes && job.approvedGroup.focusSelections.length > 0)).toBe(true);
    expect(jobs.some((job) => job.approvedGroup.titleSuggestion === 'Subdivision public-purpose land, money, procedure, summary, and filing rules')).toBe(true);
    expect(report.selectedGroups.every((group) => group.promptSpecVersion === 'unit-authoring-v3')).toBe(true);
    expect(report.selectedGroups.some((group) => group.focusSelections.some((selection) => selection.definedTerms?.includes('surveyor')))).toBe(true);
  }, 30000);

  it('writes Phase 4B.1 pilot audit reports with evaluation counts', () => {
    const runId = 'ai-test-pilot-report';
    const runDir = join('study-content', 'ai', 'runs', runId);
    rmSync(runDir, { recursive: true, force: true });
    mkdirSync(join(runDir, 'reports'), { recursive: true });
    const mapProposal = {
      ...mapResultToProposal({
        job: mapJob(),
        result: {
          schemaVersion: 1,
          jobId: 'map-1',
          runId,
          corpusContentHash: 'corpus-hash',
          inputHash: 'input-hash',
          promptSpecVersion: 'study-map-v3',
          disposition: 'standalone',
          confidence: 'high',
          reason: 'Focused procedure.',
          proposedGroups: [
            {
              groupId: 'group-1',
              titleSuggestion: 'Objection',
              sourceKeys: ['section:10'],
              focusSelections: [{ sourceKey: 'section:10', evidenceText: ['written objection'] }],
              reason: 'Focused.',
              approximateLearningGoal: 'Know objection delivery.',
            },
          ],
          warnings: [],
        },
      }),
      runId,
      pilotEvaluation: 'good-as-is',
    };
    const proposal = {
      ...unitProposal(),
      runId,
      sourceHashes: { [sourceComponent.sourceKey]: sourceComponent.contentHash },
      pilotEvaluation: 'good',
      pilotEvaluationNotes: 'Useful concise answer.',
    };
    writeFileSync(join(runDir, 'reports', 'map-proposals.json'), JSON.stringify([mapProposal], null, 2));
    writeFileSync(join(runDir, 'reports', 'unit-proposals.json'), JSON.stringify([proposal], null, 2));

    execFileSync(
      'npx',
      ['tsx', 'scripts/studyAiAuthoring.ts', 'pilot-report', '--run', runId, '--unit-run', runId],
      {
        stdio: 'pipe',
        shell: process.platform === 'win32',
      },
    );
    const audit = JSON.parse(
      readFileSync(join(runDir, 'reports', 'pilot-authoring-audit.json'), 'utf8'),
    ) as {
      map: { pilotEvaluationCounts: Record<string, number> };
      units: { evaluationCounts: Record<string, number> };
      proposals: Array<{ pilotEvaluation?: string; deterministicComparison: { available?: boolean } }>;
    };

    expect(audit.map.pilotEvaluationCounts['good-as-is']).toBe(1);
    expect(audit.units.evaluationCounts.good).toBe(1);
    expect(audit.proposals[0]?.pilotEvaluation).toBe('good');
    expect(existsSync(join(runDir, 'reports', 'pilot-authoring-audit.md'))).toBe(true);
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
