import { describe, expect, it } from 'vitest';
import { validateAiStudyUnitProposal } from '../../src/study/ai/studyAiValidation';
import type { AiMapRevisionSuggestion, AiStudyUnitProposal } from '../../src/study/ai/studyAiTypes';
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

  it('allows Marital Property Act 30(3) to reference subsection 27(3)', () => {
    const source = component({
      sourceKey: 'section:30',
      label: '30',
      text: '30(3) Subsection 27(3) and paragraph 23(1)(d) apply with the necessary modifications.',
      subsections: [
        {
          id: 's30-3',
          sourceKey: 'section:30#subsection:3',
          label: '30(3)',
          text: '30(3) Subsection 27(3) and paragraph 23(1)(d) apply with the necessary modifications.',
          contentHash: 'hash-s30-3',
        },
      ],
    });
    const proposal = proposalFor({
      source,
      answer: 'Subsection 27(3) and paragraph 23(1)(d) apply with the necessary modifications.',
      evidence: source.subsections?.[0]?.text ?? source.text,
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

  it('detects mid-token and literal-ellipsis clipping in answers and evidence', () => {
    const source = component({
      sourceKey: 'section:125',
      label: '125',
      text: '125(3) Subject to subsections (4) and (7), the Lieutenant-Governor in Council may designate an area for the application of a regulation.',
    });

    expect(codesFor(proposalFor({ source, answer: 'ubject to subsections (4) and (7), the Lieutenant-Governor in Council may designate an area...', evidence: 'ubject to subsections (4) and (7)' }), [source])).toContain('ANSWER_APPEARS_TRUNCATED');
    expect(codesFor(proposalFor({ source, answer: 'Subject to subsections (4) and (7), the Lieutenant-Governor in Council may designate an', evidence: 'Subject to subsections (4) and (7), the Lieutenant-Governor in Council may designate an' }), [source])).toContain('ANSWER_APPEARS_TRUNCATED');
  });

  it('detects normalized generic main and guided question templates', () => {
    const source = component({ sourceKey: 'section:10', label: '10', text: '10 A person may deliver an objection.' });
    const proposal = proposalFor({
      source,
      answer: 'A person may deliver an objection.',
      evidence: source.text,
      question: 'What does 10 require or allow for Objection delivery?',
    });
    proposal.mainQuestion = 'What should a learner remember about Objection delivery?';
    proposal.approvedGroup!.titleSuggestion = 'Objection delivery';

    const codes = codesFor(proposal, [source]);

    expect(codes).toContain('GENERIC_MAIN_QUESTION');
    expect(codes).toContain('GENERIC_GUIDED_QUESTION');
  });

  it('rejects definition answers that return only the definitions preamble', () => {
    const source = component({
      sourceKey: 'section:1',
      label: '1',
      text: 'Definitions 1 The following definitions apply in this Act. "coordinate monument" means a brass, bronze or aluminum cap or plate established and maintained in accordance with section 3.',
    });
    const proposal = proposalFor({
      source,
      answer: 'Definitions 1 The following definitions apply in this Act.',
      evidence: 'Definitions 1 The following definitions apply in this Act.',
      question: 'What does coordinate monument mean for Surveys Act?',
    });
    proposal.objectives[0].type = 'definition';
    proposal.approvedGroup!.focusSelections = [{ sourceKey: source.sourceKey, definedTerms: ['coordinate monument'] }];

    expect(codesFor(proposal, [source])).toContain('DEFINITION_ANSWER_MISSING_TERM_MEANING');
  });

  it('detects duplicate nonresponsive answers for distinct definition objectives', () => {
    const source = component({
      sourceKey: 'section:1',
      label: '1',
      text: '"coordinate monument" means a brass cap. "surveyor" means a member of the Association.',
    });
    const proposal = proposalFor({
      source,
      answer: 'Definitions 1 The following definitions apply in this Act.',
      evidence: source.text,
      question: 'What does coordinate monument mean?',
    });
    proposal.approvedGroup!.focusSelections = [{ sourceKey: source.sourceKey, definedTerms: ['coordinate monument', 'surveyor'] }];
    proposal.objectives = [
      { ...proposal.objectives[0], id: 'obj-1', type: 'definition', guidedQuestion: 'What does coordinate monument mean?' },
      { ...proposal.objectives[0], id: 'obj-2', type: 'definition', guidedQuestion: 'What does surveyor mean?' },
    ];

    const codes = codesFor(proposal, [source]);

    expect(codes).toContain('DUPLICATE_NONRESPONSIVE_ANSWER');
    expect(codes).toContain('DEFINITION_ANSWER_MISSING_TERM_MEANING');
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

  it('flags unsupported retroactive-effect map revision suggestions for Community Planning 125', () => {
    const source = component({
      sourceKey: 'section:125',
      label: '125',
      text: '125(15) The Minister may deliver a written summary. 125(16) The Director shall file a copy, but filing is not a condition precedent to coming into force.',
    });
    const broad = proposalFor({
      source,
      answer: 'The group is too broad.',
      evidence: source.text,
      warnings: ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'],
    });
    broad.authoringStatus = 'needs-map-revision';
    broad.mapRevisionSuggestion = {
      reason: 'Split distinct rules.',
      proposedGroups: [
        {
          title: 'Filing and retroactive effect',
          sourceKeys: ['section:125'],
          focusSelections: [{ sourceKey: 'section:125', childLabels: ['125(15)', '125(16)'] }],
          approximateLearningGoal: 'Recall filing duties and retroactive effect.',
        },
        {
          title: 'Written summary alternative',
          sourceKeys: ['section:125'],
          focusSelections: [{ sourceKey: 'section:125', childLabels: ['125(15)'] }],
          approximateLearningGoal: 'Recall the written summary alternative.',
        },
      ],
    };

    expect(codesFor(broad, [source])).toContain('MAP_REVISION_UNSUPPORTED_CONCEPT');
  });
});

describe('unit-authoring-v5 revision contract', () => {
  const V5_KEYS = ['section:10', 'section:11', 'section:12'];
  const NEW_REVISION_CODES = [
    'GENERATED_UNIT_HAS_BROAD_GROUP_WARNING',
    'GENERATED_UNIT_HAS_REVISION_SUGGESTION',
    'MAP_REVISION_STATUS_REQUIRES_BROAD_WARNING',
    'MAP_REVISION_RATIONALE_CONTRADICTORY',
    'MAP_REVISION_OUTSIDE_APPROVED_FOCUS',
  ];
  const COHERENT_REASON =
    'The approved focus spans distinct legal propositions that cannot form one coherent unit.';
  const BROAD = 'MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT';

  const v5Sources: ImportedLegalComponent[] = [
    component({
      sourceKey: 'section:10',
      label: '10',
      text: '10(1) A person shall file an instrument with the Registrar General. 10(2) The Registrar General may reject an incomplete instrument.',
    }),
    component({
      sourceKey: 'section:11',
      label: '11',
      text: '11 In this Act, "registered instrument" means an instrument registered under this Act.',
    }),
    component({
      sourceKey: 'section:12',
      label: '12',
      text: '12 Land vested in the Crown shall be held for public purposes.',
    }),
  ];

  const revisionProposal = ({
    promptSpecVersion = 'unit-authoring-v5',
    authoringStatus = 'generated',
    warnings = [],
    suggestion,
    approvedFocusSelections = [
      { sourceKey: 'section:10', childLabels: ['10(1)', '10(2)'] },
      { sourceKey: 'section:11', definedTerms: ['registered instrument'] },
      { sourceKey: 'section:12' },
    ],
  }: {
    promptSpecVersion?: string;
    authoringStatus?: 'generated' | 'needs-map-revision';
    warnings?: string[];
    suggestion?: AiMapRevisionSuggestion;
    approvedFocusSelections?: Array<{
      sourceKey: string;
      childLabels?: string[];
      definedTerms?: string[];
    }>;
  }): AiStudyUnitProposal => ({
    schemaVersion: 1,
    proposalId: 'proposal-v5-revision',
    runId: 'run-v5-revision',
    corpusContentHash: 'corpus-hash',
    sourceDocumentId: 'doc-test',
    sourceKeys: V5_KEYS,
    sourceHashes: {
      'section:10': 'hash-section:10',
      'section:11': 'hash-section:11',
      'section:12': 'hash-section:12',
    },
    approvedGroup: {
      groupId: 'group-v5',
      titleSuggestion: 'Registered instruments and Crown land',
      sourceKeys: V5_KEYS,
      focusSelections: approvedFocusSelections,
      reason: 'Approved focus.',
      approximateLearningGoal: 'Recall the registration and Crown land rules.',
    },
    title: 'Registered instruments and Crown land',
    mainQuestion: 'What filing duty applies to instruments and how is Crown land held?',
    studySummary: 'An instrument must be filed and Crown land held for public purposes.',
    objectives: [
      {
        id: 'obj-1',
        type: 'procedure',
        objective: 'Recall the instrument filing duty.',
        guidedQuestion: 'How is an instrument submitted for registration?',
        studyAnswer: 'A person shall file an instrument with the Registrar General.',
        required: true,
        sourceKeys: ['section:10'],
        evidence: [
          {
            sourceKey: 'section:10',
            evidenceText: 'A person shall file an instrument with the Registrar General.',
          },
        ],
        confidence: 'high',
      },
      {
        id: 'obj-2',
        type: 'definition',
        objective: 'Recall the meaning of registered instrument.',
        guidedQuestion: 'What does "registered instrument" mean under the Act?',
        studyAnswer: 'A registered instrument is an instrument registered under this Act.',
        required: true,
        sourceKeys: ['section:11'],
        evidence: [
          {
            sourceKey: 'section:11',
            evidenceText: '"registered instrument" means an instrument registered under this Act.',
          },
        ],
        confidence: 'high',
      },
      {
        id: 'obj-3',
        type: 'legal-effect',
        objective: 'Recall the Crown land holding rule.',
        guidedQuestion: 'How must land vested in the Crown be held?',
        studyAnswer: 'Land vested in the Crown is held for public purposes.',
        required: true,
        sourceKeys: ['section:12'],
        evidence: [
          {
            sourceKey: 'section:12',
            evidenceText: 'Land vested in the Crown shall be held for public purposes.',
          },
        ],
        confidence: 'high',
      },
    ],
    confidence: 'high',
    warnings,
    authoringStatus,
    mapRevisionSuggestion: suggestion,
    generationMetadata: {
      providerKind: 'external-codex',
      promptSpecVersion,
      generatedAt: '2026-09-02T10:00:00.000Z',
    },
  });

  const validSuggestion = (reason: string): AiMapRevisionSuggestion => ({
    reason,
    proposedGroups: [
      {
        title: 'Instrument filing rule',
        sourceKeys: ['section:10'],
        focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(1)'] }],
        approximateLearningGoal: 'Recall when an instrument must be filed.',
      },
      {
        title: 'Definition and Crown land',
        sourceKeys: ['section:11', 'section:12'],
        focusSelections: [
          { sourceKey: 'section:11', definedTerms: ['registered instrument'] },
          { sourceKey: 'section:12' },
        ],
        approximateLearningGoal: 'Recall the definition and the Crown land holding rule.',
      },
    ],
  });

  const newCodePresent = (proposal: AiStudyUnitProposal, code: string): boolean =>
    validateAiStudyUnitProposal({ proposal, sourceComponents: v5Sources }).issues.some(
      (issue) => issue.code === code,
    );

  it('allows a generated unit with no broad warning and no suggestion', () => {
    NEW_REVISION_CODES.forEach((code) => {
      expect(newCodePresent(revisionProposal({}), code)).toBe(false);
    });
  });

  it('rejects a generated unit that carries the broad-group warning', () => {
    const proposal = revisionProposal({ warnings: [BROAD] });
    expect(newCodePresent(proposal, 'GENERATED_UNIT_HAS_BROAD_GROUP_WARNING')).toBe(true);
    expect(newCodePresent(proposal, 'GENERATED_UNIT_HAS_REVISION_SUGGESTION')).toBe(false);
  });

  it('rejects a generated unit that includes a mapRevisionSuggestion', () => {
    const proposal = revisionProposal({ suggestion: validSuggestion(COHERENT_REASON) });
    expect(newCodePresent(proposal, 'GENERATED_UNIT_HAS_REVISION_SUGGESTION')).toBe(true);
    expect(newCodePresent(proposal, 'GENERATED_UNIT_HAS_BROAD_GROUP_WARNING')).toBe(false);
  });

  it('requires the broad-group warning for needs-map-revision status', () => {
    const proposal = revisionProposal({
      authoringStatus: 'needs-map-revision',
      suggestion: validSuggestion(COHERENT_REASON),
    });
    expect(newCodePresent(proposal, 'MAP_REVISION_STATUS_REQUIRES_BROAD_WARNING')).toBe(true);
  });

  it('stops needs-map-revision checks when no suggestion is provided', () => {
    const proposal = revisionProposal({ authoringStatus: 'needs-map-revision', warnings: [BROAD] });
    const codes = codesFor(proposal, v5Sources);
    expect(codes).toContain('MAP_REVISION_SUGGESTION_REQUIRED');
    expect(codes).not.toContain('MAP_REVISION_GROUP_INVALID');
    expect(codes).not.toContain('MAP_REVISION_OUTSIDE_SOURCE');
    expect(codes).not.toContain('MAP_REVISION_OUTSIDE_APPROVED_FOCUS');
    expect(codes).not.toContain('MAP_REVISION_RATIONALE_CONTRADICTORY');
    expect(codes).not.toContain('MAP_REVISION_UNSUPPORTED_CONCEPT');
  });

  it('accepts a valid needs-map-revision triplet inside the approved focus', () => {
    const proposal = revisionProposal({
      authoringStatus: 'needs-map-revision',
      warnings: [BROAD],
      suggestion: validSuggestion(COHERENT_REASON),
    });
    const codes = codesFor(proposal, v5Sources);
    NEW_REVISION_CODES.forEach((code) => expect(codes).not.toContain(code));
    expect(codes).not.toContain('MAP_REVISION_SUGGESTION_REQUIRED');
    expect(codes).not.toContain('MAP_REVISION_GROUP_INVALID');
    expect(codes).not.toContain('MAP_REVISION_OUTSIDE_SOURCE');
    expect(codes).not.toContain('MAP_REVISION_UNSUPPORTED_CONCEPT');
  });

  it('flags a needs-map-revision reason that says no revision is needed', () => {
    const proposal = revisionProposal({
      authoringStatus: 'needs-map-revision',
      warnings: [BROAD],
      suggestion: validSuggestion(
        'The approved focus covers one coherent topic. No revision needed, the unit is appropriately scoped.',
      ),
    });
    const issue = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: v5Sources,
    }).issues.find((entry) => entry.code === 'MAP_REVISION_RATIONALE_CONTRADICTORY');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"no revision needed"');
    expect(issue?.severity).toBe('error');
  });

  it('rejects a suggested childLabel outside the approved selection', () => {
    const proposal = revisionProposal({
      authoringStatus: 'needs-map-revision',
      warnings: [BROAD],
      suggestion: {
        reason: COHERENT_REASON,
        proposedGroups: [
          {
            title: 'Whole instrument rules',
            sourceKeys: ['section:10'],
            focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(1)', '10(9)'] }],
            approximateLearningGoal: 'Recall all instrument rules.',
          },
          {
            title: 'Definition and Crown land',
            sourceKeys: ['section:11', 'section:12'],
            focusSelections: [
              { sourceKey: 'section:11', definedTerms: ['registered instrument'] },
              { sourceKey: 'section:12' },
            ],
            approximateLearningGoal: 'Recall the definition and the Crown land holding rule.',
          },
        ],
      },
    });
    const issue = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: v5Sources,
    }).issues.find((entry) => entry.code === 'MAP_REVISION_OUTSIDE_APPROVED_FOCUS');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('10(9) is not in the approved focus selection for section:10');
  });

  it('rejects a selection whose sourceKey has no approved focus entry', () => {
    const proposal = revisionProposal({
      authoringStatus: 'needs-map-revision',
      warnings: [BROAD],
      approvedFocusSelections: [
        { sourceKey: 'section:10', childLabels: ['10(1)', '10(2)'] },
        { sourceKey: 'section:11', definedTerms: ['registered instrument'] },
      ],
      suggestion: {
        reason: COHERENT_REASON,
        proposedGroups: [
          {
            title: 'Instrument filing rule',
            sourceKeys: ['section:10'],
            focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(1)'] }],
            approximateLearningGoal: 'Recall when an instrument must be filed.',
          },
          {
            title: 'Crown land holding',
            sourceKeys: ['section:12'],
            focusSelections: [{ sourceKey: 'section:12' }],
            approximateLearningGoal: 'Recall the Crown land holding rule.',
          },
        ],
      },
    });
    const issue = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: v5Sources,
    }).issues.find((entry) => entry.code === 'MAP_REVISION_OUTSIDE_APPROVED_FOCUS');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('section:12 is not an approved focus selection');
  });

  it('rejects a suggested selection that widens beyond approved childLabels', () => {
    const proposal = revisionProposal({
      authoringStatus: 'needs-map-revision',
      warnings: [BROAD],
      suggestion: {
        reason: COHERENT_REASON,
        proposedGroups: [
          {
            title: 'Whole section instrument rule',
            sourceKeys: ['section:10'],
            focusSelections: [{ sourceKey: 'section:10' }],
            approximateLearningGoal: 'Recall all instrument rules in section 10.',
          },
          {
            title: 'Definition and Crown land',
            sourceKeys: ['section:11', 'section:12'],
            focusSelections: [
              { sourceKey: 'section:11', definedTerms: ['registered instrument'] },
              { sourceKey: 'section:12' },
            ],
            approximateLearningGoal: 'Recall the definition and the Crown land holding rule.',
          },
        ],
      },
    });
    const issue = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: v5Sources,
    }).issues.find((entry) => entry.code === 'MAP_REVISION_OUTSIDE_APPROVED_FOCUS');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('widens section:10 beyond the approved childLabels');
  });

  it('rejects a suggested definedTerm outside the approved selection', () => {
    const proposal = revisionProposal({
      authoringStatus: 'needs-map-revision',
      warnings: [BROAD],
      suggestion: {
        reason: COHERENT_REASON,
        proposedGroups: [
          {
            title: 'Definition split',
            sourceKeys: ['section:11'],
            focusSelections: [{ sourceKey: 'section:11', definedTerms: ['surveyor'] }],
            approximateLearningGoal: 'Recall the surveyor definition.',
          },
          {
            title: 'Instrument filing rule',
            sourceKeys: ['section:10'],
            focusSelections: [{ sourceKey: 'section:10', childLabels: ['10(1)'] }],
            approximateLearningGoal: 'Recall when an instrument must be filed.',
          },
        ],
      },
    });
    const issue = validateAiStudyUnitProposal({
      proposal,
      sourceComponents: v5Sources,
    }).issues.find((entry) => entry.code === 'MAP_REVISION_OUTSIDE_APPROVED_FOCUS');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain(
      'surveyor is not in the approved focus selection for section:11',
    );
  });

  it('keeps the v4 broad-group contract unchanged for identical fixtures', () => {
    const generated = revisionProposal({
      promptSpecVersion: 'unit-authoring-v4',
      warnings: [BROAD],
    });
    const generatedIssues = validateAiStudyUnitProposal({
      proposal: generated,
      sourceComponents: v5Sources,
    }).issues;
    const statusWarning = generatedIssues.find(
      (entry) => entry.code === 'BROAD_GROUP_MUST_NEED_MAP_REVISION',
    );
    expect(statusWarning).toBeDefined();
    expect(statusWarning?.severity).toBe('warning');
    expect(generatedIssues.some((entry) => entry.code === 'MAP_REVISION_SUGGESTION_REQUIRED')).toBe(
      true,
    );
    NEW_REVISION_CODES.forEach((code) =>
      expect(generatedIssues.some((entry) => entry.code === code)).toBe(false),
    );

    const needsRevision = revisionProposal({
      promptSpecVersion: 'unit-authoring-v4',
      authoringStatus: 'needs-map-revision',
      warnings: [BROAD],
      suggestion: validSuggestion(COHERENT_REASON),
    });
    const needsIssues = validateAiStudyUnitProposal({
      proposal: needsRevision,
      sourceComponents: v5Sources,
    }).issues;
    NEW_REVISION_CODES.forEach((code) =>
      expect(needsIssues.some((entry) => entry.code === code)).toBe(false),
    );
    expect(needsIssues.some((entry) => entry.code === 'MAP_REVISION_SUGGESTION_REQUIRED')).toBe(
      false,
    );
  });
});
