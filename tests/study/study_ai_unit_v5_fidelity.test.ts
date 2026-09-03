import { describe, expect, it } from 'vitest';
import { validateAiStudyUnitProposal } from '../../src/study/ai/studyAiValidation';
import { validateUnitV5Fidelity } from '../../src/study/ai/studyAiUnitV5Fidelity';
import type {
  AiLearningObjective,
  AiSourceCoverage,
  AiStudyNote,
  AiStudyUnitProposal,
  AiValidationIssue,
} from '../../src/study/ai/studyAiTypes';
import type {
  ImportedLegalComponent,
  ImportedLegalSubsection,
} from '../../src/study/studyTypes';

// ---------------------------------------------------------------------------
// Regression coverage for the V5-only fidelity gate (studyAiUnitV5Fidelity.ts).
// Each scenario mirrors a named external-QC defect from the frozen V5 cal80
// cohort (registry36, cw13, lt73, assess28, anb222, cp84, muni184). The V5
// gate must invalidate those defects while leaving faithful variants clean,
// and it must stay dormant for V4 proposals.
// ---------------------------------------------------------------------------

const component = ({
  sourceKey,
  label,
  text,
  subsections,
}: {
  sourceKey: string;
  label: string;
  text: string;
  subsections?: Array<Pick<ImportedLegalSubsection, 'label' | 'text'>>;
}): ImportedLegalComponent => ({
  documentId: 'doc-test',
  id: sourceKey.replace(/[^a-z0-9]+/gi, '-'),
  sourceKey,
  componentType: 'section',
  label,
  text,
  contentHash: `hash-${sourceKey}`,
  subsections: subsections?.map(({ label: subLabel, text: subText }) => ({
    id: `${sourceKey}-${subLabel}`.replace(/[^a-z0-9]+/gi, '-'),
    sourceKey,
    label: subLabel,
    text: subText,
    contentHash: `hash-${sourceKey}-${subLabel}`,
  })),
  extractionStatus: 'complete',
});

const objective = (
  overrides: Partial<AiLearningObjective> & Pick<AiLearningObjective, 'id' | 'studyAnswer'>,
): AiLearningObjective => ({
  type: 'duty',
  objective: 'Recall the rule.',
  guidedQuestion: 'What does the provision require?',
  required: true,
  sourceKeys: ['section:36'],
  evidence: [{ sourceKey: 'section:36', evidenceText: 'evidence' }],
  confidence: 'high',
  ...overrides,
});

const proposal = (
  overrides: Partial<AiStudyUnitProposal> & Pick<AiStudyUnitProposal, 'approvedGroup'>,
): AiStudyUnitProposal => ({
  schemaVersion: 1,
  proposalId: 'proposal-v5',
  runId: 'run-v5',
  corpusContentHash: 'corpus-hash',
  sourceDocumentId: 'doc-test',
  sourceKeys: ['section:36'],
  sourceHashes: { 'section:36': 'hash-section-36' },
  generationMetadata: {
    providerKind: 'local-openai-compatible',
    promptSpecVersion: 'unit-authoring-v5',
    generatedAt: '2026-09-02T00:00:00.000Z',
  },
  title: 'Focused rule',
  mainQuestion: 'What is the rule?',
  studySummary: 'The provision sets a rule.',
  objectives: [objective({ id: 'obj-1', studyAnswer: 'The rule applies.' })],
  authoringStatus: 'generated',
  confidence: 'high',
  warnings: [],
  ...overrides,
});

const runGate = (
  proposal: AiStudyUnitProposal,
  components: ImportedLegalComponent[],
): AiValidationIssue[] => {
  const issues: AiValidationIssue[] = [];
  validateUnitV5Fidelity(proposal, components, issues);
  return issues;
};

const codes = (issues: AiValidationIssue[]): string[] => issues.map((issue) => issue.code);

const SUBSECTION_TEXT_36_1 =
  '36(1)No party to an instrument shall\n\n(a)\nwitness the execution of the instrument by another party, or\n\n(b)\ntake an affidavit or acknowledgment of the execution of the instrument.';
const SUBSECTION_TEXT_36_2 =
  '36(2)No affidavit or proof of the execution of an instrument shall be taken from a witness unless the witness has subscribed his signature to the instrument by hand as a witness to its due execution.';
const SUBSECTION_TEXT_36_3 =
  '36(3)This section only applies in respect of instruments executed after it comes into force.';

const registryComponent = component({
  sourceKey: 'section:36',
  label: '36',
  text: [SUBSECTION_TEXT_36_1, SUBSECTION_TEXT_36_2, SUBSECTION_TEXT_36_3, 'R.S., c.195, s.42; 1986, c.69, s.6'].join(
    '\n\n',
  ),
  subsections: [
    { label: '36(1)', text: SUBSECTION_TEXT_36_1 },
    { label: '36(2)', text: SUBSECTION_TEXT_36_2 },
    { label: '36(3)', text: SUBSECTION_TEXT_36_3 },
  ],
});

describe('V5 fidelity gate: registry36 polarity and coverage', () => {
  const group = {
    groupId: 'registry-36',
    titleSuggestion: 'Execution acknowledgment rules',
    sourceKeys: ['section:36'],
    focusSelections: [
      { sourceKey: 'section:36', childLabels: ['36(1)', '36(2)', '36(3)'] },
    ],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the execution rules.',
  };

  it('flags an affirmative duty answer to a source prohibition', () => {
    const faulty = proposal({
      approvedGroup: group,
      objectives: [
        objective({
          id: 'obj-party',
          objective: 'State what a party to an instrument is prohibited from doing under section 36(1).',
          guidedQuestion: 'What two things is a party to an instrument prohibited from doing under section 36(1)?',
          studyAnswer:
            'A party to an instrument shall (a) witness the execution of the instrument by another party, or (b) take an affidavit or acknowledgment of the execution of the instrument.',
        }),
      ],
    });
    const issues = runGate(faulty, [registryComponent]);
    expect(codes(issues)).toContain('POLARITY_REVERSAL');
  });

  it('flags each missing selected childLabel when sourceCoverage is absent', () => {
    const missing = proposal({
      approvedGroup: group,
      objectives: [
        objective({
          id: 'obj-party',
          studyAnswer: 'No party to an instrument shall witness the execution of the instrument by another party or take an affidavit of its execution.',
        }),
      ],
    });
    const issues = runGate(missing, [registryComponent]);
    const missingLabels = codes(issues).filter((code) => code === 'SOURCE_COVERAGE_MISSING_SELECTED_LABEL');
    expect(missingLabels.length).toBe(3);
  });

  it('accepts a faithful prohibition restatement with complete coverage', () => {
    const clean = proposal({
      approvedGroup: group,
      sourceCoverage: [
        {
          sourceKey: 'section:36',
          childLabels: [
            { label: '36(1)', status: 'covered', objectiveIds: ['obj-party'] },
            { label: '36(2)', status: 'covered', objectiveIds: ['obj-party'] },
            { label: '36(3)', status: 'covered', objectiveIds: ['obj-party'] },
          ],
        },
      ],
      objectives: [
        objective({
          id: 'obj-party',
          evidence: [{ sourceKey: 'section:36', evidenceText: SUBSECTION_TEXT_36_1.slice(0, 60) }],
          studyAnswer:
            'No party to an instrument shall witness the execution of the instrument by another party or take an affidavit or acknowledgment of its execution, and a witness must have subscribed his signature by hand before proof is taken.',
        }),
      ],
    });
    const issues = runGate(clean, [registryComponent]);
    expect(codes(issues)).toEqual([]);
  });
});

describe('V5 fidelity gate: cw13 conditional modality', () => {
  const SUB_13_5 =
    '13(5)Subject to subsection 12(3), if the Minister of Health determines upon testing or believes, on other reasonable and probable grounds, that water in a well, public water supply system or water supply system, except a private well, may in the circumstances pose a significant health risk in the future\n\n(a)\nat the source, the Minister may make such order and take such measures as the Minister considers advisable and necessary in order to ensure that the possible future significant health risk is prevented, eliminated, minimized or otherwise appropriately dealt with and the quality of the water is improved if necessary, and\n\n(b)\nat the point of consumption, the Minister of Health may make such order as the Minister considers advisable and necessary.';
  const cwComponent = component({
    sourceKey: 'section:13',
    label: '13',
    text: SUB_13_5,
    subsections: [{ label: '13(5)', text: SUB_13_5 }],
  });
  const group = {
    groupId: 'cw-13-5',
    titleSuggestion: 'Future significant health risk orders',
    sourceKeys: ['section:13'],
    focusSelections: [{ sourceKey: 'section:13', childLabels: ['13(5)'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the conditional order power.',
  };

  it('flags a mandatory answer to a conditional source trigger', () => {
    const faulty = proposal({
      sourceKeys: ['section:13'],
      approvedGroup: group,
      objectives: [
        objective({
          id: 'obj-trigger',
          sourceKeys: ['section:13'],
          evidence: [{ sourceKey: 'section:13', evidenceText: SUB_13_5.slice(0, 120) }],
          studyAnswer:
            'The Minister of Health must determine upon testing or believe, on other reasonable and probable grounds, that the water may in the circumstances pose a significant health risk in the future.',
        }),
      ],
    });
    const issues = runGate(faulty, [cwComponent]);
    expect(codes(issues)).toContain('LEGAL_MODALITY_REVERSAL');
  });

  it('accepts an answer that preserves the conditional trigger and permissive order power', () => {
    const clean = proposal({
      sourceKeys: ['section:13'],
      approvedGroup: group,
      objectives: [
        objective({
          id: 'obj-trigger',
          sourceKeys: ['section:13'],
          evidence: [{ sourceKey: 'section:13', evidenceText: SUB_13_5.slice(0, 120) }],
          studyAnswer:
            'If the Minister of Health determines upon testing or believes, on other reasonable and probable grounds, that the water may pose a significant health risk in the future, the Minister may make such order as the Minister considers advisable at the source or point of consumption.',
        }),
      ],
    });
    const issues = runGate(clean, [cwComponent]);
    expect(codes(issues).filter((code) => code === 'LEGAL_MODALITY_REVERSAL')).toEqual([]);
  });
});

describe('V5 fidelity gate: lt73 unsupported legal effects', () => {
  const SUB_73_1 =
    '73(1)A person who suffers damage as a result of (a) the rectification of the register, (b) an error or omission in the register that is not rectified, (c) an error or omission in a certificate, or (d) a lodged document that is lost or destroyed, is entitled to indemnification, except where the damage results from fraud by the person or from the person having acted in bad faith.';
  const SUB_73_2 =
    '73(2)Where the register has been rectified, a person who claims for valuable consideration under a forged disposition and who acted in good faith is deemed to have suffered damage for the purposes of subsection (1) only.';
  const ltComponent = component({
    sourceKey: 'section:73',
    label: '73',
    text: [SUB_73_1, SUB_73_2].join('\n\n'),
    subsections: [
      { label: '73(1)', text: SUB_73_1 },
      { label: '73(2)', text: SUB_73_2 },
    ],
  });
  const group = {
    groupId: 'lt-73',
    titleSuggestion: 'Indemnification',
    sourceKeys: ['section:73'],
    focusSelections: [{ sourceKey: 'section:73', childLabels: ['73(1)', '73(2)'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall indemnification entitlement and exceptions.',
  };

  it('flags ungrounded legal-effect claims in the summary and source-derived notes', () => {
    const faulty = proposal({
      sourceKeys: ['section:73'],
      approvedGroup: group,
      studySummary:
        'Section 73(1) grants indemnification for four damage categories and the six statutory exceptions do not bar a claim that would otherwise lie under the Act.',
      objectives: [
        objective({
          id: 'obj-entitlement',
          sourceKeys: ['section:73'],
          evidence: [{ sourceKey: 'section:73', evidenceText: SUB_73_1.slice(0, 120) }],
          studyAnswer: 'A person who suffers damage from a rectification of the register is entitled to indemnification, subject to the statutory exceptions.',
        }),
      ],
      studyNotes: [
        {
          id: 'note-scope',
          kind: 'relationship',
          basis: 'source-derived',
          sourceKeys: ['section:73'],
          text: 'Subsection 73(2) deems the good-faith valuable-consideration owner to have suffered damage for subsection (1) purposes only and does not create a free-standing cause of action.',
        },
      ],
    });
    const issues = runGate(faulty, [ltComponent]);
    const effectCodes = codes(issues).filter((code) => code === 'UNSUPPORTED_LEGAL_EFFECT');
    expect(effectCodes.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts a summary that only restates the deeming scope', () => {
    const clean = proposal({
      sourceKeys: ['section:73'],
      approvedGroup: group,
      studySummary:
        'Subsection 73(2) deems the good-faith valuable-consideration owner under a forged disposition to have suffered damage for the purposes of subsection (1) only, once the register is rectified.',
      sourceCoverage: [
        {
          sourceKey: 'section:73',
          childLabels: [
            { label: '73(1)', status: 'covered', objectiveIds: ['obj-entitlement'] },
            { label: '73(2)', status: 'covered', objectiveIds: ['obj-entitlement'] },
          ],
        },
      ],
      objectives: [
        objective({
          id: 'obj-entitlement',
          sourceKeys: ['section:73'],
          evidence: [{ sourceKey: 'section:73', evidenceText: SUB_73_1.slice(0, 120) }],
          studyAnswer: 'A person who suffers damage from a rectification of the register is entitled to indemnification, subject to the statutory exceptions.',
        }),
      ],
    });
    const issues = runGate(clean, [ltComponent]);
    expect(codes(issues)).toEqual([]);
  });
});

describe('V5 fidelity gate: assess28 context reference leakage', () => {
  const S28 =
    '28Within 21 days after the Director mails a notice to a local government or other taxing authority under subsection 25(5), the local government or other taxing authority may appeal to the Board for the local government or other taxing authority to vary the assessment of real property located within its boundaries and affected by the request for review of assessment.\n1965-66, c.110, s.27; 1975, c.8, s.6; 1983, c.12, s.28; 1989, c.N-5.01, s.31';
  const assessComponent = component({ sourceKey: 'section:28', label: '28', text: S28 });
  const group = {
    groupId: 'assess-28',
    titleSuggestion: 'Taxing authority appeal',
    sourceKeys: ['section:28'],
    focusSelections: [{ sourceKey: 'section:28' }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the 21-day appeal window.',
  };

  it('flags a summary contrast with a provision the focus never cites', () => {
    const faulty = proposal({
      sourceKeys: ['section:28'],
      approvedGroup: group,
      studySummary:
        'Section 28 lets a local government or other taxing authority appeal to the Board within 21 days after the Director mails a subsection 25(5) notice to vary the assessment. This contrasts with the owner\u2019s appeal under section 27, which also permits vacation of the assessment.',
      objectives: [
        objective({
          id: 'obj-window',
          sourceKeys: ['section:28'],
          evidence: [{ sourceKey: 'section:28', evidenceText: S28.slice(0, 120) }],
          studyAnswer: 'The local government or other taxing authority may appeal within 21 days after the Director mails the subsection 25(5) notice.',
        }),
      ],
    });
    const issues = runGate(faulty, [assessComponent]);
    expect(codes(issues)).toContain('CONTEXT_REF_LEAKAGE');
  });

  it('accepts references to the approved section and subsections it cites, including citation-year lookalikes', () => {
    const clean = proposal({
      sourceKeys: ['section:28'],
      approvedGroup: group,
      studySummary:
        'Under section 28 a local government or other taxing authority may appeal to the Board within 21 days after the Director mails the subsection 25(5) notice, and the appeal may only vary the affected assessment.',
      objectives: [
        objective({
          id: 'obj-window',
          sourceKeys: ['section:28'],
          evidence: [{ sourceKey: 'section:28', evidenceText: S28.slice(0, 120) }],
          studyAnswer: 'The local government or other taxing authority may appeal within 21 days after the Director mails the subsection 25(5) notice.',
        }),
      ],
    });
    const issues = runGate(clean, [assessComponent]);
    expect(codes(issues)).toEqual([]);
  });
});

describe('V5 fidelity gate: anb222 leakage, actor overreach, and note scoping', () => {
  const S222 =
    '2.2.2 Applicants who have been previously registered\nbut have resigned in good standing or have changed\nclassification may reapply in the manner prescribed for\nnew applicants.';
  const anbComponent = component({ sourceKey: 'section:2.2.2', label: '2.2.2', text: S222 });
  const group = {
    groupId: 'anb-222',
    titleSuggestion: 'Reapplication',
    sourceKeys: ['section:2.2.2'],
    focusSelections: [{ sourceKey: 'section:2.2.2', childLabels: ['2.2.2'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Identify who may reapply and how.',
  };

  it('flags a summary reference outside the bylaw focus', () => {
    const faulty = proposal({
      sourceKeys: ['section:2.2.2'],
      approvedGroup: group,
      studySummary:
        'Bylaw 2.2.2 lets applicants who resigned in good standing or changed classification reapply in the manner prescribed for new applicants, which is distinct from reinstatement under section 2.2.3.',
      objectives: [
        objective({
          id: 'obj-reapply',
          sourceKeys: ['section:2.2.2'],
          evidence: [{ sourceKey: 'section:2.2.2', evidenceText: S222.slice(0, 100) }],
          studyAnswer: 'Applicants previously registered who resigned in good standing or changed classification may reapply in the manner prescribed for new applicants.',
        }),
      ],
    });
    const issues = runGate(faulty, [anbComponent]);
    expect(codes(issues)).toContain('CONTEXT_REF_LEAKAGE');
  });

  it('flags a duty assigned to an actor the focus never names', () => {
    const faulty = proposal({
      sourceKeys: ['section:2.2.2'],
      approvedGroup: group,
      studySummary:
        'Under bylaw 2.2.2 a surveyor must follow the new-application manner when reapplying after resignation in good standing or a classification change.',
      objectives: [
        objective({
          id: 'obj-reapply',
          sourceKeys: ['section:2.2.2'],
          evidence: [{ sourceKey: 'section:2.2.2', evidenceText: S222.slice(0, 100) }],
          studyAnswer: 'Applicants previously registered who resigned in good standing or changed classification may reapply in the manner prescribed for new applicants.',
        }),
      ],
    });
    const issues = runGate(faulty, [anbComponent]);
    expect(codes(issues)).toContain('SUMMARY_ACTOR_OVERREACH');
  });

  it('flags notes citing source keys outside the approved group and ungrounded source-derived notes', () => {
    const faulty = proposal({
      sourceKeys: ['section:2.2.2'],
      approvedGroup: group,
      objectives: [
        objective({
          id: 'obj-reapply',
          sourceKeys: ['section:2.2.2'],
          evidence: [{ sourceKey: 'section:2.2.2', evidenceText: S222.slice(0, 100) }],
          studyAnswer: 'Applicants previously registered who resigned in good standing or changed classification may reapply in the manner prescribed for new applicants.',
        }),
      ],
      studyNotes: [
        {
          id: 'note-contrast',
          kind: 'relationship',
          basis: 'source-derived',
          sourceKeys: ['section:2.2.3'],
          text: 'This contrasts with reinstatement under bylaw 2.2.3.',
        },
        {
          id: 'note-procedure',
          kind: 'memory-aid',
          basis: 'source-derived',
          sourceKeys: ['section:2.2.1'],
          text: 'The new-application manner means the Council form, the Article 4 fees and dues, and submission to the Registrar.',
        },
      ],
    });
    const issues = runGate(faulty, [anbComponent]);
    expect(codes(issues)).toContain('STUDY_NOTE_OUTSIDE_APPROVED_SOURCE');
    expect(codes(issues)).toContain('SOURCE_DERIVED_NOTE_UNGROUNDED');
  });
});

describe('V5 fidelity gate: cp84 actor overreach and verbatim evidence', () => {
  const SUB_84_3 =
    '84(3)A plan of subdivision must be in a form that shows (a) the title to the land, (b) the name and address of the owner, and (c) a north point, a survey monument, and the boundaries of the land.';
  const SUB_84_4 =
    '84(4)The boundaries of a lot shown on a plan of subdivision must be shown as solid black lines, and a boundary described by a circular curve must show the azimuth, distance, radius, central angle and arc of the curve.';
  const cpComponent = component({
    sourceKey: 'section:84',
    label: '84',
    text: [SUB_84_3, SUB_84_4].join('\n\n'),
    subsections: [
      { label: '84(3)', text: SUB_84_3 },
      { label: '84(4)', text: SUB_84_4 },
    ],
  });
  const group = {
    groupId: 'cp-84',
    titleSuggestion: 'Subdivision plan contents',
    sourceKeys: ['section:84'],
    focusSelections: [{ sourceKey: 'section:84', childLabels: ['84(3)', '84(4)'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the required plan contents.',
  };

  it('flags a duty assigned to an actor absent from the focused subsections', () => {
    const faulty = proposal({
      sourceKeys: ['section:84'],
      approvedGroup: group,
      studySummary:
        'Section 84(3) lists the required plan contents and section 84(4) adds boundary-line details; together they define the full content specification a surveyor must satisfy before the development officer can approve the plan.',
      objectives: [
        objective({
          id: 'obj-contents',
          sourceKeys: ['section:84'],
          evidence: [{ sourceKey: 'section:84', evidenceText: SUB_84_3.slice(0, 120) }],
          studyAnswer: 'A plan of subdivision must show the title, the owner\u2019s name and address, a north point, a survey monument, and the boundaries.',
        }),
      ],
    });
    const issues = runGate(faulty, [cpComponent]);
    expect(codes(issues)).toContain('SUMMARY_ACTOR_OVERREACH');
  });

  it('flags evidence that is only whitespace-normalized against the exact source text', () => {
    const faulty = proposal({
      sourceKeys: ['section:84'],
      approvedGroup: group,
      objectives: [
        objective({
          id: 'obj-contents',
          sourceKeys: ['section:84'],
          evidence: [
            {
              sourceKey: 'section:84',
              // Collapsed double spaces and newlines: not a verbatim substring.
              evidenceText:
                '84(3)A plan of subdivision must be in a form that shows (a) the title to the land, (b) the name and address of the owner.',
            },
          ],
          studyAnswer: 'A plan of subdivision must show the title, the owner\u2019s name and address, a north point, a survey monument, and the boundaries.',
        }),
      ],
    });
    const issues = runGate(faulty, [cpComponent]);
    expect(codes(issues)).toContain('EVIDENCE_NOT_EXACT_VERBATIM');
  });
});

describe('V5 fidelity gate: muni184 source-derived note grounding', () => {
  const S184 = '184A municipality may enter into agreements with any person to develop a public beach.';
  const muniComponent = component({ sourceKey: 'section:184', label: '184', text: S184 });
  const group = {
    groupId: 'muni-184',
    titleSuggestion: 'Public beach agreements',
    sourceKeys: ['section:184'],
    focusSelections: [{ sourceKey: 'section:184', childLabels: ['184'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the permissive agreement power.',
  };
  const baseObjectives = [
    objective({
      id: 'obj-beach',
      sourceKeys: ['section:184'],
      evidence: [{ sourceKey: 'section:184', evidenceText: S184.slice(0, 80) }],
      studyAnswer: 'A municipality may enter into agreements with any person to develop a public beach.',
    }),
  ];

  it('accepts a note that explains the permissive modality in meta terms', () => {
    const clean = proposal({
      sourceKeys: ['section:184'],
      approvedGroup: group,
      sourceCoverage: [
        {
          sourceKey: 'section:184',
          childLabels: [{ label: '184', status: 'covered', objectiveIds: ['obj-beach'] }],
        },
      ],
      objectives: baseObjectives,
      studyNotes: [
        {
          id: 'note-may',
          kind: 'memory-aid',
          basis: 'source-derived',
          sourceKeys: ['section:184'],
          text: 'The word may gives the municipality a permissive power, not an obligation, to enter into the agreement.',
        },
      ],
    });
    const issues = runGate(clean, [muniComponent]);
    expect(codes(issues)).toEqual([]);
  });

  it('flags a note that invents concrete counterparties the source never names', () => {
    const faulty = proposal({
      sourceKeys: ['section:184'],
      approvedGroup: group,
      objectives: baseObjectives,
      studyNotes: [
        {
          id: 'note-any-person',
          kind: 'memory-aid',
          basis: 'source-derived',
          sourceKeys: ['section:184'],
          text: 'Any person includes private individuals or corporations as counterparties to the beach development agreement.',
        },
      ],
    });
    const issues = runGate(faulty, [muniComponent]);
    expect(codes(issues)).toContain('SOURCE_DERIVED_NOTE_UNGROUNDED');
  });
});

describe('V5 fidelity gate: conditional and disjunctive polarity regressions', () => {
  // Land Titles s.80(9)-style conditional consequence: "if no provision is
  // made, then payments shall ..." is not a prohibition and a faithful
  // answer restating the consequence must not be flagged.
  const SUB_80_7 =
    '80(7)Every registrar shall keep a correct account of all money received and paid by the registrar and shall pay all such money into an account or fund established for that purpose by or under another Act of the legislature.';
  const SUB_80_8 =
    '80(8)Any indemnity, cost or expense awarded under this Act and any interest on it shall be paid out of the account or fund established pursuant to subsection (7).';
  const SUB_80_9 =
    '80(9)If the account or fund established pursuant to subsection (8) is insufficient to make the payment required, or if no provision is made, then payments shall be paid out of the Consolidated Fund.';
  const lt80Component = component({
    sourceKey: 'section:80',
    label: '80',
    text: [SUB_80_7, SUB_80_8, SUB_80_9].join('\n\n'),
    subsections: [
      { label: '80(7)', text: SUB_80_7 },
      { label: '80(8)', text: SUB_80_8 },
      { label: '80(9)', text: SUB_80_9 },
    ],
  });
  const lt80Group = {
    groupId: 'lt-80',
    titleSuggestion: 'Indemnification funding',
    sourceKeys: ['section:80'],
    focusSelections: [{ sourceKey: 'section:80', childLabels: ['80(7)', '80(8)', '80(9)'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the funding sources for indemnification payments.',
  };

  it('does not flag a faithful conditional consequence ("if no provision is made, then payments shall ...")', () => {
    const clean = proposal({
      sourceKeys: ['section:80'],
      approvedGroup: lt80Group,
      sourceCoverage: [
        {
          sourceKey: 'section:80',
          childLabels: [
            { label: '80(7)', status: 'covered', objectiveIds: ['obj-backstop'] },
            { label: '80(8)', status: 'covered', objectiveIds: ['obj-backstop'] },
            { label: '80(9)', status: 'covered', objectiveIds: ['obj-backstop'] },
          ],
        },
      ],
      objectives: [
        objective({
          id: 'obj-backstop',
          sourceKeys: ['section:80'],
          evidence: [{ sourceKey: 'section:80', evidenceText: SUB_80_9.slice(0, 120) }],
          studyAnswer:
            'If the account or fund is insufficient to make the payment required, or if no provision is made, payments shall be paid out of the Consolidated Fund.',
        }),
      ],
    });
    const issues = runGate(clean, [lt80Component]);
    expect(codes(issues)).toEqual([]);
  });

  // REG 83-130 Schedule D clause 32-style disjunction: "shall ... do no damage
  // ... or shall make good ..." — the "or shall" clause is a separate duty.
  const S32 =
    '32. Fixtures includes any fixture that is the tenant\u2019s property and any other fixture the tenant has affixed to the premises, but the tenant may remove the fixtures at the end of the lease term provided that the tenant shall in such removal do no damage to the premises or shall make good any damage which he may occasion thereto.';
  const regComponent = component({
    sourceKey: 'schedule:schedule-d',
    label: 'Schedule D',
    text: S32,
    subsections: [{ label: '32', text: S32 }],
  });
  const regGroup = {
    groupId: 'reg-83-130-sd',
    titleSuggestion: 'End-of-lease fixture removal',
    sourceKeys: ['schedule:schedule-d'],
    focusSelections: [{ sourceKey: 'schedule:schedule-d', childLabels: ['32'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the fixture removal conditions.',
  };
  const regCoverage: AiSourceCoverage[] = [
    {
      sourceKey: 'schedule:schedule-d',
      childLabels: [{ label: '32', status: 'covered', objectiveIds: ['obj-32'] }],
    },
  ];

  it('does not flag a sentence quoted verbatim from the source, even with an embedded no...or shall', () => {
    const clean = proposal({
      sourceKeys: ['schedule:schedule-d'],
      approvedGroup: regGroup,
      sourceCoverage: regCoverage,
      objectives: [
        objective({
          id: 'obj-32',
          sourceKeys: ['schedule:schedule-d'],
          evidence: [{ sourceKey: 'schedule:schedule-d', evidenceText: S32.slice(60, 220) }],
          studyAnswer:
            'The tenant shall in such removal do no damage to the premises or shall make good any damage which he may occasion thereto.',
        }),
      ],
    });
    const issues = runGate(clean, [regComponent]);
    expect(codes(issues)).toEqual([]);
  });

  it('does not flag a paraphrase whose "or shall" clause is a separate duty, not a restatement', () => {
    const clean = proposal({
      sourceKeys: ['schedule:schedule-d'],
      approvedGroup: regGroup,
      sourceCoverage: regCoverage,
      objectives: [
        objective({
          id: 'obj-32',
          sourceKeys: ['schedule:schedule-d'],
          evidence: [{ sourceKey: 'schedule:schedule-d', evidenceText: S32.slice(60, 220) }],
          studyAnswer:
            'At the end of the lease term, the tenant shall in such removal do no damage to the premises or shall make good any damage occasioned thereto.',
        }),
      ],
    });
    const issues = runGate(clean, [regComponent]);
    expect(codes(issues)).toEqual([]);
  });
});

describe('V5 fidelity gate: defined-term coverage', () => {
  const S1 =
    '1. In this Act "development" (aménagement) means (a) erecting, placing, relocating, removing or demolishing a structure, and (b) cutting or filling land by more than one metre.';
  const cp1Component = component({ sourceKey: 'section:1', label: '1', text: S1 });
  const group = {
    groupId: 'cp-dev-term',
    titleSuggestion: 'Defined term: development',
    sourceKeys: ['section:1'],
    focusSelections: [{ sourceKey: 'section:1', definedTerms: ['development'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the defined term development.',
  };
  const devObjective = () =>
    objective({
      id: 'obj-dev',
      sourceKeys: ['section:1'],
      evidence: [{ sourceKey: 'section:1', evidenceText: S1.slice(0, 80) }],
      studyAnswer:
        '"development" means erecting, placing, relocating, removing or demolishing a structure, or cutting or filling land by more than one metre.',
    });

  it('accepts sourceCoverage that declares an approved definedTerm', () => {
    const clean = proposal({
      sourceKeys: ['section:1'],
      approvedGroup: group,
      sourceCoverage: [
        {
          sourceKey: 'section:1',
          childLabels: [{ label: 'development', status: 'covered', objectiveIds: ['obj-dev'] }],
        },
      ],
      objectives: [devObjective()],
    });
    const issues = runGate(clean, [cp1Component]);
    expect(codes(issues)).toEqual([]);
  });

  it('still rejects invented sublabels of a definedTerm', () => {
    const faulty = proposal({
      sourceKeys: ['section:1'],
      approvedGroup: group,
      sourceCoverage: [
        {
          sourceKey: 'section:1',
          childLabels: [
            { label: 'development', status: 'covered', objectiveIds: ['obj-dev'] },
            { label: 'development (a)', status: 'covered', objectiveIds: ['obj-dev'] },
          ],
        },
      ],
      objectives: [devObjective()],
    });
    const issues = runGate(faulty, [cp1Component]);
    expect(codes(issues)).toContain('SOURCE_COVERAGE_EXTRA_LABEL');
    expect(codes(issues)).not.toContain('SOURCE_COVERAGE_MISSING_SELECTED_LABEL');
  });
});

describe('V5 fidelity gate: schedule focus reference leakage', () => {
  const S16 = '16. The lessee shall not assign the premises or part of them without the consent of the lessor.';
  const S18 = '18. The lessee shall surrender the premises in the same condition as when received, reasonable wear and tear excepted.';
  const S19 = '19. The lessee shall permit the lessor to enter the premises to show them to prospective tenants.';
  const S32L = '32. The lessee may remove fixtures at the end of the lease provided that the lessee leaves the premises undamaged.';
  const scheduleComponent = component({
    sourceKey: 'schedule:schedule-d',
    label: 'Schedule D',
    text: [S16, S18, S19, S32L].join('\n\n'),
    subsections: [
      { label: '16', text: S16 },
      { label: '18', text: S18 },
      { label: '19', text: S19 },
      { label: '32', text: S32L },
    ],
  });
  const schedGroup = {
    groupId: 'reg-83-130-sd-focus',
    titleSuggestion: 'Statutory lease covenants',
    sourceKeys: ['schedule:schedule-d'],
    focusSelections: [{ sourceKey: 'schedule:schedule-d', childLabels: ['16', '18', '19', '32'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the statutory lease covenants.',
  };
  const schedCoverage: AiSourceCoverage[] = [
    {
      sourceKey: 'schedule:schedule-d',
      childLabels: [
        { label: '16', status: 'covered', objectiveIds: ['obj-covenants'] },
        { label: '18', status: 'covered', objectiveIds: ['obj-covenants'] },
        { label: '19', status: 'covered', objectiveIds: ['obj-covenants'] },
        { label: '32', status: 'covered', objectiveIds: ['obj-covenants'] },
      ],
    },
  ];
  const covenantObjective = (answer: string) =>
    objective({
      id: 'obj-covenants',
      sourceKeys: ['schedule:schedule-d'],
      evidence: [
        {
          sourceKey: 'schedule:schedule-d',
          evidenceText: 'The lessee shall not assign the premises or part of them without the consent of the lessor.',
        },
      ],
      studyAnswer: answer,
    });

  it('accepts summary references to schedule clause labels inside the approved focus', () => {
    const clean = proposal({
      sourceKeys: ['schedule:schedule-d'],
      approvedGroup: schedGroup,
      sourceCoverage: schedCoverage,
      studySummary:
        'Clause 16 requires the lessor\u2019s consent to any assignment, clause 19 allows showings to prospective tenants, and clause 32 conditions fixture removal on leaving the premises undamaged.',
      objectives: [
        covenantObjective(
          'The lessee shall not assign the premises without the lessor\u2019s consent, must surrender them in the condition received, and may remove fixtures at the end of the lease if the premises are left undamaged.',
        ),
      ],
    });
    const issues = runGate(clean, [scheduleComponent]);
    expect(codes(issues)).toEqual([]);
  });

  it('still flags a summary reference to a schedule clause outside the approved focus', () => {
    const faulty = proposal({
      sourceKeys: ['schedule:schedule-d'],
      approvedGroup: schedGroup,
      sourceCoverage: schedCoverage,
      studySummary:
        'Clause 16 requires the lessor\u2019s consent to any assignment, while clause 21 limits the rent the lessor may set.',
      objectives: [covenantObjective('The lessee shall not assign the premises without the lessor\u2019s consent.')],
    });
    const issues = runGate(faulty, [scheduleComponent]);
    expect(codes(issues)).toContain('CONTEXT_REF_LEAKAGE');
  });
});

describe('V5 fidelity gate: evidence divergence diagnostics', () => {
  const S75K =
    '75(1)(k)A plan of subdivision shall not be approved if, in the development officer\u2019s opinion, the subdivision is not suited to the purpose for which the land is zoned.';
  const cp75Component = component({
    sourceKey: 'section:75',
    label: '75',
    text: S75K,
    subsections: [{ label: '75(1)(k)', text: S75K }],
  });
  const group = {
    groupId: 'cp-75-1-k',
    titleSuggestion: 'Non-approval grounds',
    sourceKeys: ['section:75'],
    focusSelections: [{ sourceKey: 'section:75', childLabels: ['75(1)(k)'] }],
    reason: 'Focused.',
    approximateLearningGoal: 'Recall the non-approval grounds.',
  };

  it('reports the first divergent code point when evidence normalizes a typographic character', () => {
    const faulty = proposal({
      sourceKeys: ['section:75'],
      approvedGroup: group,
      objectives: [
        objective({
          id: 'obj-k',
          sourceKeys: ['section:75'],
          evidence: [
            {
              sourceKey: 'section:75',
              // Straight apostrophe where the source uses U+2019: the common
              // local-model normalization that previously failed opaquely.
              evidenceText:
                '75(1)(k)A plan of subdivision shall not be approved if, in the development officer\'s opinion, the subdivision is not suited to the purpose for which the land is zoned.',
            },
          ],
          studyAnswer: 'A plan of subdivision shall not be approved if it is not suited to the purpose for which the land is zoned.',
        }),
      ],
    });
    const issues = runGate(faulty, [cp75Component]);
    const evidence = issues.filter((issue) => issue.code === 'EVIDENCE_NOT_EXACT_VERBATIM');
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.message).toContain('First mismatch at evidence character');
    expect(evidence[0]?.message).toContain('(U+2019)');
    expect(evidence[0]?.message).toContain('(U+0027)');
  });
});

describe('V5 fidelity gate: version gating', () => {
  it('leaves V4 proposals untouched by the V5 gate', () => {
    const v4 = proposal({
      sourceKeys: ['section:36'],
      generationMetadata: {
        providerKind: 'local-openai-compatible',
        promptSpecVersion: 'unit-authoring-v4',
        generatedAt: '2026-09-02T00:00:00.000Z',
      },
      approvedGroup: {
        groupId: 'registry-36',
        titleSuggestion: 'Execution acknowledgment rules',
        sourceKeys: ['section:36'],
        focusSelections: [{ sourceKey: 'section:36', childLabels: ['36(1)', '36(2)', '36(3)'] }],
        reason: 'Focused.',
        approximateLearningGoal: 'Recall the execution rules.',
      },
      objectives: [
        objective({
          id: 'obj-party',
          objective: 'State what a party to an instrument is prohibited from doing under section 36(1).',
          studyAnswer:
            'A party to an instrument shall (a) witness the execution of the instrument by another party, or (b) take an affidavit or acknowledgment of the execution of the instrument.',
        }),
      ],
    });
    const report = validateAiStudyUnitProposal({
      proposal: v4,
      sourceComponents: [registryComponent],
    });
    const v5Codes = report.issues
      .map((issue) => issue.code)
      .filter((code) =>
        [
          'EVIDENCE_NOT_EXACT_VERBATIM',
          'SOURCE_COVERAGE_EXTRA_SOURCE',
          'SOURCE_COVERAGE_EXTRA_LABEL',
          'SOURCE_COVERAGE_DUPLICATE_LABEL',
          'SOURCE_COVERAGE_MISSING_SELECTED_LABEL',
          'SOURCE_COVERAGE_INVALID_STATUS',
          'SOURCE_COVERAGE_COVERED_WITHOUT_OBJECTIVES',
          'SOURCE_COVERAGE_UNKNOWN_OBJECTIVE',
          'SOURCE_COVERAGE_OMISSION_WITHOUT_REASON',
          'POLARITY_REVERSAL',
          'LEGAL_MODALITY_REVERSAL',
          'UNSUPPORTED_LEGAL_EFFECT',
          'CONTEXT_REF_LEAKAGE',
          'SUMMARY_ACTOR_OVERREACH',
          'STUDY_NOTE_OUTSIDE_APPROVED_SOURCE',
          'SOURCE_DERIVED_NOTE_UNGROUNDED',
        ].includes(code),
      );
    expect(v5Codes).toEqual([]);
  });
});
