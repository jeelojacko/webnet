/**
 * Tests for the deterministic V4 coverage-warning audit
 * (src/study/ai/studyAiUnitCoverageAudit.ts).
 *
 * Synthetic in-memory fixtures only — no files, no provider, no wall clock.
 * Exercises the mirrored checker predicates (UNCOVERED_SUBSTANTIVE_SOURCE /
 * APPROVED_FOCUS_NOT_COVERED), the twin pairing, the A/B/C classifier and
 * the exact classification + twin field output, including:
 *   - a childLabel missing from coverage with both checkers firing: C on the
 *     APPROVED side, A on the UNCOVERED side (duplicate presentation);
 *   - a non-approved uncovered label (source without a focus selection): A;
 *   - an uncovered approved label whose APPROVED twin is *satisfied* by a
 *     sibling label's covered key via the validator's raw startsWith prefix
 *     match (no APPROVED instance at all, hence no C);
 *   - an unmet defined term: A;
 *   - a stored instance whose raw predicate no longer fires: B
 *     ('predicate recompute: no warning expected');
 *   - the 'covered' objectiveIds quirk: undefined counts as covered, an
 *     empty array does not.
 */
import { describe, expect, it } from 'vitest';
import type { ImportedLegalComponent } from '../../src/study/studyTypes';
import type { AiStudyUnitProposal } from '../../src/study/ai/studyAiTypes';
import {
  APPROVED_FOCUS_NOT_COVERED,
  UNCOVERED_SUBSTANTIVE_SOURCE,
  classifyInstances,
  collectCoverageInstances,
  assessSubstantiveCoverage,
} from '../../src/study/ai/studyAiUnitCoverageAudit';
import type { CoverageWarningInstance } from '../../src/study/ai/studyAiUnitCoverageAudit';

/* ------------------------------------------------------------------ *
 * Synthetic fixture builders                                        *
 * ------------------------------------------------------------------ */

const component = (
  sourceKey: string,
  subsections: Array<{ label: string; text: string }>,
): ImportedLegalComponent => ({
  documentId: 'doc-1',
  id: `id-${sourceKey}`,
  sourceKey,
  componentType: 'section',
  label: sourceKey.replace('section:', ''),
  text: subsections.map((s) => `${s.label}${s.text}`).join(''),
  contentHash: `hash-${sourceKey}`,
  subsections: subsections.map((s, index) => ({
    id: `sub-${sourceKey}-${index}`,
    sourceKey,
    label: s.label,
    text: s.text,
    contentHash: `sub-hash-${s.label}`,
  })),
  extractionStatus: 'complete',
});

const SECTION_9_TEXT: Record<string, string> = {
  '9(1)': 'Every instrument offered for registration must be in the prescribed form.',
  '9(2)': 'A registrar may refuse to register an instrument that is not duly executed.',
  '9(3)': 'The Director of Surveys maintains the official cadastral plan records.',
};

const makeProposal = (overrides: Partial<AiStudyUnitProposal>): AiStudyUnitProposal => ({
  schemaVersion: 1,
  proposalId: 'unit-audit-fixture',
  runId: 'ai-units-fixture',
  corpusContentHash: 'corpus-hash',
  sourceDocumentId: 'doc-1',
  sourceKeys: ['section:9'],
  sourceHashes: { 'section:9': 'hash-section:9' },
  title: 'Fixture unit',
  mainQuestion: 'Fixture main question.',
  studySummary: 'Fixture summary.',
  objectives: [],
  confidence: 'high',
  warnings: [],
  generationMetadata: {
    providerKind: 'local-openai-compatible',
    promptSpecVersion: 'unit-authoring-v4',
    generatedAt: '2026-09-02T00:00:00.000Z',
  },
  ...overrides,
});

const coverageFor = (
  sourceKey: string,
  children: Array<{ label: string; status: 'covered' | 'intentionally-omitted' | 'context-only' | 'not-assessed'; objectiveIds?: string[]; reason?: string }>,
) => [{ sourceKey, childLabels: children }];

const groupFor = (sourceKey: string, childLabels: string[], definedTerms: string[] = []) => ({
  groupId: 'g-1',
  titleSuggestion: 'Fixture group',
  sourceKeys: [sourceKey],
  focusSelections: [{ sourceKey, childLabels, definedTerms }],
  reason: 'Fixture reason',
  approximateLearningGoal: 'Fixture goal',
});

/* ------------------------------------------------------------------ *
 * Scenario 1: twins — childLabel missing from coverage               *
 * ------------------------------------------------------------------ */

describe('coverage-warning audit classifier', () => {
  it('flags duplicate presentation C on APPROVED and A on UNCOVERED when the coverage child entry is absent for an approved childLabel', () => {
    const proposal = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', ['9(1)', '9(2)']),
      sourceCoverage: [],
    });
    const components = [component('section:9', [
      { label: '9(1)', text: SECTION_9_TEXT['9(1)'] },
      { label: '9(2)', text: SECTION_9_TEXT['9(2)'] },
    ])];

    const instances = collectCoverageInstances(proposal, components);
    const classified = classifyInstances(proposal, instances, components);

    // Both checkers fire for both approved childLabels (2 + 2).
    expect(instances).toHaveLength(4);
    expect(instances.filter((i) => i.code === UNCOVERED_SUBSTANTIVE_SOURCE)).toHaveLength(2);
    expect(instances.filter((i) => i.code === APPROVED_FOCUS_NOT_COVERED)).toHaveLength(2);

    const approved9_1 = classified.find(
      (i) => i.code === APPROVED_FOCUS_NOT_COVERED && i.label === '9(1)',
    );
    const uncovered9_1 = classified.find(
      (i) => i.code === UNCOVERED_SUBSTANTIVE_SOURCE && i.label === '9(1)',
    );
    expect(approved9_1).toMatchObject({
      code: APPROVED_FOCUS_NOT_COVERED,
      sourceKey: 'section:9',
      category: 'child-label',
      label: '9(1)',
      approved: true,
      classification: 'C',
      twin: { code: UNCOVERED_SUBSTANTIVE_SOURCE, present: true },
    });
    expect(approved9_1?.classificationBasis).toContain('duplicate presentation');
    expect(approved9_1?.classificationBasis).toContain(UNCOVERED_SUBSTANTIVE_SOURCE);

    expect(uncovered9_1).toMatchObject({
      code: UNCOVERED_SUBSTANTIVE_SOURCE,
      category: 'child-label',
      label: '9(1)',
      approved: true,
      classification: 'A',
      twin: { code: APPROVED_FOCUS_NOT_COVERED, present: true },
    });
    expect(uncovered9_1?.classificationBasis).toContain('primary diagnostic');
    // No B/C on the uncovered side.
    expect(classified.filter((i) => i.code === UNCOVERED_SUBSTANTIVE_SOURCE).map((i) => i.classification)).toEqual(['A', 'A']);
  });

  it('satisfied approved twin: prefix-covered sibling leaves an UNCOVERED label with A and no APPROVED instance and no C', () => {
    // APPROVED checker prefix-matches raw `${sk}::${label}` against covered
    // keys, so a covered sibling childLabel '9(1)(a)' satisfies approved
    // label '9(1)' while the coverage child entry for '9(1)' is absent —
    // exactly the case where UNCOVERED fires with no APPROVED twin.
    const proposal = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', ['9(1)', '9(1)(a)']),
      sourceCoverage: coverageFor('section:9', [
        { label: '9(1)(a)', status: 'covered', objectiveIds: ['obj-9-1-a'] },
      ]),
    });
    const components = [component('section:9', [
      { label: '9(1)', text: SECTION_9_TEXT['9(1)'] },
      { label: '9(1)(a)', text: 'An instrument must be executed under seal.' },
    ])];

    const instances = collectCoverageInstances(proposal, components);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      code: UNCOVERED_SUBSTANTIVE_SOURCE,
      sourceKey: 'section:9',
      label: '9(1)',
      approved: true,
    });

    const classified = classifyInstances(proposal, instances, components);
    expect(classified).toHaveLength(1);
    expect(classified[0]).toMatchObject({
      classification: 'A',
      twin: { code: APPROVED_FOCUS_NOT_COVERED, present: false },
    });
    expect(classified[0].classificationBasis).toContain('no APPROVED_FOCUS_NOT_COVERED twin');
    expect(classified[0].classificationBasis).toContain('sibling prefix-covered');
  });

  it('non-approved uncovered label from a source without a focus selection classifies A with no twin', () => {
    // 'section:2' has no approved focus selection, so validateCoverage runs
    // in the all-subsections scope and the label is not approved.
    const proposal = makeProposal({
      sourceKeys: ['section:9', 'section:2'],
      sourceHashes: { 'section:9': 'h9', 'section:2': 'h2' },
      approvedGroup: {
        groupId: 'g-1',
        titleSuggestion: 'Fixture group',
        sourceKeys: ['section:9', 'section:2'],
        focusSelections: [
          {
            sourceKey: 'section:9',
            childLabels: ['9(1)'],
            evidenceText: [],
          },
        ],
        reason: 'Fixture reason',
        approximateLearningGoal: 'Fixture goal',
      },
      sourceCoverage: coverageFor('section:9', [
        { label: '9(1)', status: 'covered', objectiveIds: ['obj-9-1'] },
      ]),
    });
    const components = [
      component('section:9', [{ label: '9(1)', text: SECTION_9_TEXT['9(1)'] }]),
      component('section:2', [
        { label: '2(1)', text: 'This Act binds the Crown.' },
        { label: '2(2)', text: 'A reference to the Minister means the Minister of Natural Resources.' },
      ]),
    ];

    const instances = collectCoverageInstances(proposal, components);
    expect(instances).toHaveLength(2);
    expect(instances.every((i) => i.code === UNCOVERED_SUBSTANTIVE_SOURCE && !i.approved)).toBe(true);

    const classified = classifyInstances(proposal, instances, components);
    expect(classified.map((i) => i.classification)).toEqual(['A', 'A']);
    expect(classified.every((i) => !i.twin.present)).toBe(true);
    expect(classified[0].classificationBasis).toContain('non-approved');
  });

  it('defined term not taught by any objective classifies A', () => {
    const proposal = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', [], ['prescribed form']),
      sourceCoverage: coverageFor('section:9', []),
      objectives: [
        {
          id: 'obj-9-1',
          type: 'scope',
          objective: 'Identify who must register instruments.',
          guidedQuestion: 'Who must register an instrument?',
          studyAnswer: 'A person who presents an instrument must tender it to the registrar.',
          required: true,
          sourceKeys: ['section:9'],
          evidence: [],
          confidence: 'high',
        },
      ],
    });
    const components = [component('section:9', [{ label: '9(1)', text: SECTION_9_TEXT['9(1)'] }])];

    const instances = collectCoverageInstances(proposal, components);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      code: APPROVED_FOCUS_NOT_COVERED,
      sourceKey: 'section:9',
      category: 'defined-term',
      label: 'prescribed form',
      approved: true,
    });

    const classified = classifyInstances(proposal, instances, components);
    expect(classified[0]).toMatchObject({
      classification: 'A',
      twin: { code: UNCOVERED_SUBSTANTIVE_SOURCE, present: false },
    });
    expect(classified[0].classificationBasis).toContain('defined term');

    const assessment = assessSubstantiveCoverage(proposal, classified[0], components);
    expect(assessment.method).toBe('term-containment');
    expect(assessment.teachingObjectiveIds).toEqual([]);
  });

  it('defined term taught by an objective does not warn', () => {
    const proposal = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', [], ['prescribed form']),
      sourceCoverage: coverageFor('section:9', []),
      objectives: [
        {
          id: 'obj-9-1',
          type: 'definition',
          objective: 'State what the prescribed form of an instrument requires.',
          guidedQuestion: 'What does the prescribed form require?',
          studyAnswer: 'The prescribed form is set by regulation under this Act.',
          required: true,
          sourceKeys: ['section:9'],
          evidence: [],
          confidence: 'high',
        },
      ],
    });
    const components = [component('section:9', [{ label: '9(1)', text: SECTION_9_TEXT['9(1)'] }])];
    expect(collectCoverageInstances(proposal, components)).toHaveLength(0);
  });

  it('B: a stored instance whose raw predicate no longer fires is flagged as a false positive', () => {
    // Proposal is fully clean: the coverage child entry exists, is 'covered'
    // and names an objectiveId, so neither checker fires for '9(1)'.
    const proposal = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', ['9(1)']),
      sourceCoverage: coverageFor('section:9', [
        { label: '9(1)', status: 'covered', objectiveIds: ['obj-9-1'] },
      ]),
    });
    const components = [component('section:9', [{ label: '9(1)', text: SECTION_9_TEXT['9(1)'] }])];
    expect(collectCoverageInstances(proposal, components)).toHaveLength(0);

    // The audit's stored instance list still contains the stale warning.
    const stored: CoverageWarningInstance[] = [
      {
        code: APPROVED_FOCUS_NOT_COVERED,
        sourceKey: 'section:9',
        category: 'child-label',
        label: '9(1)',
        approved: true,
      },
    ];
    const classified = classifyInstances(proposal, stored, components);
    expect(classified).toHaveLength(1);
    expect(classified[0]).toMatchObject({
      code: APPROVED_FOCUS_NOT_COVERED,
      classification: 'B',
      classificationBasis: 'predicate recompute: no warning expected',
      twin: { code: UNCOVERED_SUBSTANTIVE_SOURCE, present: false },
    });
  });

  it("covered-without-objectiveIds counts as covered but an empty objectiveIds array warns (validator quirk mirrored)", () => {
    const withUndefined = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', ['9(1)']),
      sourceCoverage: coverageFor('section:9', [{ label: '9(1)', status: 'covered' }]),
    });
    const withEmpty = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', ['9(1)']),
      sourceCoverage: coverageFor('section:9', [{ label: '9(1)', status: 'covered', objectiveIds: [] }]),
    });
    const components = [component('section:9', [{ label: '9(1)', text: SECTION_9_TEXT['9(1)'] }])];

    expect(collectCoverageInstances(withUndefined, components)).toHaveLength(0);
    const emptyInstances = collectCoverageInstances(withEmpty, components);
    expect(emptyInstances).toHaveLength(1);
    expect(emptyInstances[0]).toMatchObject({
      code: APPROVED_FOCUS_NOT_COVERED,
      label: '9(1)',
      approved: true,
    });
    const classified = classifyInstances(withEmpty, emptyInstances, components);
    expect(classified[0].classification).toBe('A');
    expect(classified[0].classificationBasis).toContain('empty objectiveIds');
    expect(classified[0].twin.present).toBe(false);
  });

  it('child-label coverage entry intentionally-omitted without a reason warns as A without a twin', () => {
    const proposal = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', ['9(3)']),
      sourceCoverage: coverageFor('section:9', [
        { label: '9(3)', status: 'intentionally-omitted' },
      ]),
    });
    const components = [component('section:9', [{ label: '9(3)', text: SECTION_9_TEXT['9(3)'] }])];
    const instances = collectCoverageInstances(proposal, components);
    expect(instances).toHaveLength(1);
    expect(instances[0].code).toBe(APPROVED_FOCUS_NOT_COVERED);
    const classified = classifyInstances(proposal, instances, components);
    expect(classified[0].classification).toBe('A');
    expect(classified[0].classificationBasis).toContain('intentionally-omitted');
    expect(classified[0].twin.present).toBe(false);
  });

  it('short-subsection evidence-containment assessment lists teaching objectives', () => {
    const proposal = makeProposal({
      sourceKeys: ['section:9'],
      approvedGroup: groupFor('section:9', ['9(1)']),
      sourceCoverage: coverageFor('section:9', [
        { label: '9(1)', status: 'intentionally-omitted' },
      ]),
      objectives: [
        {
          id: 'obj-9-1',
          type: 'procedure',
          objective: 'State the form requirement.',
          guidedQuestion: 'What form must an instrument take?',
          studyAnswer: 'The prescribed form.',
          required: true,
          sourceKeys: ['section:9'],
          evidence: [
            {
              sourceKey: 'section:9',
              evidenceText: '9(1)Every instrument offered for registration must be in the prescribed form.',
            },
          ],
          confidence: 'high',
        },
      ],
    });
    const components = [component('section:9', [{ label: '9(1)', text: SECTION_9_TEXT['9(1)'] }])];
    const [row] = classifyInstances(proposal, collectCoverageInstances(proposal, components), components);
    const assessment = assessSubstantiveCoverage(proposal, row, components);
    expect(assessment.method).toBe('evidence-containment');
    expect(assessment.teachingObjectiveIds).toEqual(['obj-9-1']);
    // The evidence excerpt includes the subsection's text verbatim.
  });
});
