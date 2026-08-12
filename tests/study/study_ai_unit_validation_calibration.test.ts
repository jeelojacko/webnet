import { describe, expect, it } from 'vitest';
import { validateAiStudyUnitProposal } from '../../src/study/ai/studyAiValidation';
import type { AiStudyUnitProposal } from '../../src/study/ai/studyAiTypes';
import type { ImportedLegalComponent } from '../../src/study/studyTypes';

const component = ({
  sourceKey,
  label,
  text,
  subsections,
}: {
  sourceKey: string;
  label: string;
  text: string;
  subsections?: ImportedLegalComponent['subsections'];
}): ImportedLegalComponent => ({
  documentId: 'doc-test',
  id: sourceKey.replace(/[^a-z0-9]+/gi, '-'),
  sourceKey,
  componentType: 'section',
  label,
  text,
  contentHash: `hash-${sourceKey}`,
  subsections,
  extractionStatus: 'complete',
});

const proposalFor = ({
  source,
  answer,
  evidence,
  question = 'What is the rule?',
  promptSpecVersion = 'unit-authoring-v4',
  warnings = [],
}: {
  source: ImportedLegalComponent;
  answer: string;
  evidence: string;
  question?: string;
  promptSpecVersion?: string;
  warnings?: string[];
}): AiStudyUnitProposal => ({
  schemaVersion: 1,
  proposalId: 'proposal-calibration',
  runId: 'run-calibration',
  corpusContentHash: 'corpus-hash',
  sourceDocumentId: source.documentId,
  sourceKeys: [source.sourceKey],
  sourceHashes: { [source.sourceKey]: source.contentHash },
  approvedGroup: {
    groupId: 'group-1',
    titleSuggestion: 'Focused rule',
    sourceKeys: [source.sourceKey],
    focusSelections: [{ sourceKey: source.sourceKey, childLabels: source.subsections?.map((entry) => entry.label) }],
    reason: 'Focused rule.',
    approximateLearningGoal: 'Recall the focused rule.',
  },
  title: 'Focused rule',
  mainQuestion: question,
  studySummary: answer,
  objectives: [
    {
      id: 'obj-1',
      type: 'procedure',
      objective: 'Recall the rule.',
      guidedQuestion: question,
      studyAnswer: answer,
      required: true,
      sourceKeys: [source.sourceKey],
      evidence: [{ sourceKey: source.sourceKey, evidenceText: evidence }],
      confidence: 'high',
    },
  ],
  confidence: 'high',
  warnings,
  generationMetadata: {
    providerKind: 'external-codex',
    promptSpecVersion,
    generatedAt: '2026-08-12T10:00:00.000Z',
  },
});

const codesFor = (proposal: AiStudyUnitProposal, sourceComponents: ImportedLegalComponent[]): string[] =>
  validateAiStudyUnitProposal({ proposal, sourceComponents }).issues.map((issue) => issue.code);

describe('AI Unit Authoring validation calibration', () => {
  it('normalizes relative subsection references against decimal and whole-number sections', () => {
    const source = component({
      sourceKey: 'section:18',
      label: '18',
      text: '18(2) The instrument shall be examined, subject to subsection (4). 18(4) The registrar may reject an instrument.',
      subsections: [
        {
          id: 's18-2',
          sourceKey: 'section:18#subsection:2',
          label: '18(2)',
          text: '18(2) The instrument shall be examined, subject to subsection (4).',
          contentHash: 'hash-s18-2',
        },
        {
          id: 's18-4',
          sourceKey: 'section:18#subsection:4',
          label: '18(4)',
          text: '18(4) The registrar may reject an instrument.',
          contentHash: 'hash-s18-4',
        },
      ],
    });
    const proposal = proposalFor({
      source,
      answer: 'The instrument is examined subject to subsection 18(4).',
      evidence: 'subject to subsection (4)',
    });

    expect(codesFor(proposal, [source])).not.toContain('UNSUPPORTED_NUMERIC_OR_REFERENCE');
  });

  it('keeps decimal section numbers intact and does not treat reference integers as quantities', () => {
    const source = component({
      sourceKey: 'section:49.1',
      label: '49.1',
      text: '49.1(1) "regulator" means a regulator. 49.1(2) A regulator may assist the Board.',
    });
    const proposal = proposalFor({
      source,
      answer: 'For section 49.1, a regulator may assist the Board.',
      evidence: 'A regulator may assist the Board',
    });

    expect(codesFor(proposal, [source])).not.toContain('UNSUPPORTED_NUMERIC_OR_REFERENCE');
  });

  it('still catches true modality, prohibition, deadline, actor, and reference drift', () => {
    const maySource = component({ sourceKey: 'section:3', label: '3', text: '3 The Registrar General may waive the requirement.' });
    expect(codesFor(proposalFor({ source: maySource, answer: 'The Registrar General must waive the requirement.', evidence: maySource.text }), [maySource])).toContain('POSSIBLE_MODALITY_MISMATCH');

    const prohibitionSource = component({ sourceKey: 'section:18', label: '18', text: '18 The registrar shall not reject the instrument.' });
    expect(codesFor(proposalFor({ source: prohibitionSource, answer: 'The registrar may reject the instrument.', evidence: prohibitionSource.text }), [prohibitionSource])).toContain('POSSIBLE_MODALITY_MISMATCH');

    const deadlineSource = component({ sourceKey: 'section:10', label: '10', text: '10 A person shall file within thirty days.' });
    expect(codesFor(proposalFor({ source: deadlineSource, answer: 'A person shall file within sixty days.', evidence: deadlineSource.text }), [deadlineSource])).toContain('UNSUPPORTED_NUMERIC_OR_REFERENCE');

    const actorSource = component({ sourceKey: 'section:11', label: '11', text: '11 The Registrar General shall file the notice.' });
    expect(codesFor(proposalFor({ source: actorSource, answer: 'The surveyor shall file the notice.', evidence: actorSource.text }), [actorSource])).toContain('POSSIBLE_ACTOR_MISMATCH');

    const refSource = component({ sourceKey: 'section:18', label: '18', text: '18 A notice refers to subsection 18(4).' });
    expect(codesFor(proposalFor({ source: refSource, answer: 'A notice refers to subsection 18(5).', evidence: refSource.text }), [refSource])).toContain('UNSUPPORTED_NUMERIC_OR_REFERENCE');
  });

  it('warns about incomplete evidence separately when the full focus supports the answer', () => {
    const source = component({
      sourceKey: 'section:3',
      label: '3',
      text: '3(3) An application shall be accompanied by field notes, a surveyor report, registered instruments, owner mailing addresses, consents, waivers, and any requested abstract of title.',
    });
    const proposal = proposalFor({
      source,
      answer: 'The application must include field notes, a surveyor report, registered instruments, owner mailing addresses, consents, waivers, and any requested abstract of title.',
      evidence: 'shall be accompanied by',
    });
    const codes = codesFor(proposal, [source]);

    expect(codes).toContain('EVIDENCE_INCOMPLETE_FOR_ANSWER');
    expect(codes).not.toContain('ANSWER_EXTENDS_BEYOND_EVIDENCE');
  });

  it('rejects context-only evidence under the source boundary rule', () => {
    const source = component({ sourceKey: 'section:18', label: '18', text: '18 The registrar shall notify the presenter.' });
    const proposal = proposalFor({
      source,
      answer: 'Priority follows registration time.',
      evidence: 'Priority follows registration time',
    });
    proposal.objectives[0].evidence = [{ sourceKey: 'section:19', evidenceText: 'Priority follows registration time' }];

    expect(codesFor(proposal, [source])).toContain('UNIT_CONTEXT_LEAKAGE');
  });

  it('requires v4 broad-group proposals to include map revision feedback', () => {
    const source = component({ sourceKey: 'section:125', label: '125', text: '125(10) A regulation may provide for public-purpose land. 125(12) Land vested in the Crown shall be held for public purposes. 125(16) The Director shall file a copy of each regulation.' });
    const broad = proposalFor({
      source,
      answer: 'The broad group spans regulation content, Crown land rules, and filing duties.',
      evidence: source.text,
      warnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'],
    });
    expect(codesFor(broad, [source])).toContain('MAP_REVISION_SUGGESTION_REQUIRED');

    broad.authoringStatus = 'needs-map-revision';
    broad.mapRevisionSuggestion = {
      reason: 'The approved focus spans distinct educational topics.',
      proposedGroups: [
        {
          title: 'Subdivision regulation content',
          sourceKeys: ['section:125'],
          focusSelections: [{ sourceKey: 'section:125', childLabels: ['125(10)'] }],
          approximateLearningGoal: 'Recall subdivision regulation-making content.',
        },
        {
          title: 'Public-purpose land and filing rules',
          sourceKeys: ['section:125'],
          focusSelections: [{ sourceKey: 'section:125', childLabels: ['125(12)', '125(16)'] }],
          approximateLearningGoal: 'Recall Crown land and filing duties.',
        },
      ],
    };

    expect(codesFor(broad, [source])).not.toContain('MAP_REVISION_SUGGESTION_REQUIRED');
  });
});

