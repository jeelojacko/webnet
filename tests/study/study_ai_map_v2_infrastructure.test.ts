import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { __studyAiAuthoringTest } from '../../scripts/studyAiAuthoring';
import {
  LOCAL_MAP_AUTHOR_HELP,
  __studyAiLocalMapAuthorTest,
  buildValidationRetryNote,
  loadStudyMapV3Spec,
  runLocalMapAuthoring,
  STUDY_MAP_V3_LOCAL_RESULT_SCHEMA,
} from '../../scripts/studyAiLocalMapAuthor';
import { validateAiStudyMapResult } from '../../src/study/ai/studyAiValidation';
import { STUDY_MAP_V3_RESULT_SCHEMA } from '../../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from '../../scripts/studyAiFingerprint';
import type { AiStudyMapJob, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import type {
  NbLawContentPackage,
  NbLawDocumentComponent,
} from '../../src/study/content/nbLawTypes';

const testRuns = ['ai-test-local-map-runner'];

afterEach(() => {
  testRuns.forEach((runId) =>
    rmSync(join('study-content', 'ai', 'runs', runId), { recursive: true, force: true }),
  );
});

const readCorpusPackage = (): NbLawContentPackage =>
  JSON.parse(
    readFileSync('study-content/packages/nb-sit-statute-corpus.content-package.json', 'utf8'),
  ) as NbLawContentPackage;

const corpusComponent = (
  pkg: NbLawContentPackage,
  documentId: string,
  sourceKey: string,
): NbLawDocumentComponent => {
  const document = pkg.documents.find((entry) => entry.id === documentId);
  const component = document?.components.find((entry) => entry.sourceKey === sourceKey);
  if (!component) throw new Error(`Missing fixture component ${documentId} ${sourceKey}`);
  return component;
};

const focusChildLabels = (component: NbLawDocumentComponent): string[] =>
  __studyAiAuthoringTest.sourceFocusOptionsFromComponent(component)?.[0]?.childLabels ?? [];

const jobFixture = (): AiStudyMapJob => {
  const text = '10 A person shall file a notice.';
  const base: AiStudyMapJob = {
    schemaVersion: 1,
    jobId: 'map-test-local',
    runId: 'ai-test-local-map-runner',
    promptSpecVersion: 'study-map-v3',
    corpusContentHash: 'corpus-hash',
    inputHash: 'input-hash',
    document: { documentId: 'doc-test', title: 'Test Act', type: 'act' },
    target: {
      sourceKeys: ['section:10'],
      sectionLabels: ['10'],
      componentType: 'section',
      exactSourceText: text,
      operativeSourceText: text,
      sourceMetadata: {},
      sourceStatus: 'current',
      approximateInputSize: {
        exactCharacters: text.length,
        operativeCharacters: text.length,
        largeSection: false,
      },
      sourceFocusOptions: [{ sourceKey: 'section:10', label: '10' }],
      sourceHashes: { 'section:10': 'source-hash' },
    },
    context: {},
  };
  return { ...base, authoringInputFingerprint: authoringInputFingerprint(base) };
};

const resultFixture = (job = jobFixture()): AiStudyMapResult => ({
  schemaVersion: 1,
  jobId: job.jobId,
  runId: job.runId,
  corpusContentHash: job.corpusContentHash,
  inputHash: job.inputHash,
  authoringInputFingerprint: authoringInputFingerprint(job),
  promptSpecVersion: job.promptSpecVersion,
  disposition: 'standalone',
  confidence: 'high',
  reason: 'The source contains one focused filing duty.',
  suggestedPriority: 'P2',
  proposedGroups: [
    {
      groupId: 'group-1',
      titleSuggestion: 'Notice filing duty',
      sourceKeys: ['section:10'],
      focusSelections: [{ sourceKey: 'section:10', evidenceText: ['shall file a notice'] }],
      reason: 'One duty is stated in the target source.',
      approximateLearningGoal: 'Know that notice filing is required.',
    },
  ],
  warnings: [],
});

const writeJobRun = (job: AiStudyMapJob): void => {
  const runDir = join('study-content', 'ai', 'runs', job.runId);
  mkdirSync(join(runDir, 'jobs'), { recursive: true });
  mkdirSync(join(runDir, 'reports'), { recursive: true });
  writeFileSync(join(runDir, 'jobs', 'batch-001.jobs.jsonl'), `${JSON.stringify(job)}\n`);
  writeFileSync(join(runDir, 'reports', 'batch-manifest.json'), '{"batchCount":1}\n');
};

const runDirFor = (job: AiStudyMapJob): string =>
  join('study-content', 'ai', 'runs', job.runId);
const resultsFileFor = (job: AiStudyMapJob): string =>
  join(runDirFor(job), 'results', 'local-map.results.jsonl');
const failuresDirFor = (job: AiStudyMapJob): string =>
  join(runDirFor(job), 'local-failures', job.jobId);

const readProviderEvents = (runId: string): Array<Record<string, unknown>> => {
  const path = join('study-content', 'ai', 'runs', runId, 'reports', 'provider-events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter((line) => line)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const successResponseFor = (job: AiStudyMapJob) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify(resultFixture(job)) } }],
  }),
  text: async () => '',
});

const healthyModelsResponse = {
  ok: true,
  status: 200,
  json: async () => ({ data: [] }),
  text: async () => '',
};

type LocalAuthorTestOptions = Partial<Parameters<typeof runLocalMapAuthoring>[0]>;

const localAuthorOptions = (job: AiStudyMapJob, extra: LocalAuthorTestOptions = {}) => ({
  runId: job.runId,
  model: 'mock-model',
  baseUrl: 'http://mock/v1',
  resume: true,
  concurrency: 1,
  maxRetries: 1,
  timeoutMs: 50,
  providerRecoveryTimeoutMs: 100,
  providerRecoveryPollMs: 5,
  dryRun: false,
  unsafeUnstructured: false,
  ...extra,
});

describe('Study Map V2 infrastructure repairs', () => {
  it('keeps only parsed direct structural child labels and preserves definition terms', () => {
    const pkg = readCorpusPackage();

    expect(
      focusChildLabels(
        corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-act', 'section:18(2)'),
      ),
    ).not.toContain('18(2)(2)');
    expect(
      focusChildLabels(
        corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-act', 'section:31(1)'),
      ),
    ).not.toContain('31(1)(2)');
    expect(
      focusChildLabels(
        corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-bylaws', 'section:2.2.6'),
      ),
    ).not.toContain('2.2.6(5)');
    expect(
      focusChildLabels(
        corpusComponent(pkg, 'doc-new-brunswick-land-surveyors-bylaws', 'section:8.2.4.1'),
      ),
    ).not.toContain('8.2.4.1(14)');
    expect(
      focusChildLabels(corpusComponent(pkg, 'doc-boundaries-confirmation-act', 'section:10')),
    ).toEqual(['10(1)', '10(2)', '10(3)', '10(4)', '10(5)', '10(6)']);
    expect(
      __studyAiAuthoringTest.sourceFocusOptionsFromComponent(
        corpusComponent(pkg, 'doc-surveys-act', 'section:1'),
      )?.[0]?.definedTerms,
    ).toContain('surveyor');
    expect(
      __studyAiAuthoringTest.sourceFocusOptionsFromComponent(
        corpusComponent(pkg, 'doc-community-planning-act', 'schedule:schedule-a'),
      )?.[0]?.sourceKey,
    ).toBe('schedule:schedule-a');
  });

  it('exposes "highway" in Highway Act s.44.1 defined terms (includes verb + multi-paragraph definition)', () => {
    const pkg = readCorpusPackage();
    const definedTerms =
      __studyAiAuthoringTest.sourceFocusOptionsFromComponent(
        corpusComponent(pkg, 'doc-highway-act', 'section:44.1'),
      )?.[0]?.definedTerms ?? [];
    // "highway" is introduced with "includes" (not "means") and spans (a)/(b) exclusions;
    // the extractor must still surface it alongside the "means" terms, in document order.
    expect(definedTerms).toEqual([
      'exemption',
      'highway',
      'person',
      'roadway',
      'usage agreement',
    ]);
  });

  it('flags consequential-amendment machinery (Limitation of Actions Act s.33) without flagging ordinary provisions', () => {
    const pkg = readCorpusPackage();
    const s33 = corpusComponent(pkg, 'doc-limitation-of-actions-act', 'section:33');
    const highway44 = corpusComponent(pkg, 'doc-highway-act', 'section:44.1');
    // Positive: s.33 amends/repeals/substitutes text in the Fatal Accidents Act,
    // so it is amendment machinery, not an independent operative rule.
    expect(__studyAiAuthoringTest.isConsequentialAmendmentText(s33.text)).toBe(true);
    // Negative: an ordinary operative definition provision with cross-references
    // but no amendment machinery is not a consequential amendment.
    expect(__studyAiAuthoringTest.isConsequentialAmendmentText(highway44.text)).toBe(false);
    // Negative: a pure self-repeal is repealOnly territory, not consequential.
    expect(__studyAiAuthoringTest.isConsequentialAmendmentText('18 Repealed.')).toBe(false);
    // Negative: a cross-reference that names a section but carries no amendment
    // machinery (no "is amended/repealed/substituted/struck out") stays unflagged.
    expect(
      __studyAiAuthoringTest.isConsequentialAmendmentText(
        'A person shall comply with section 12 of the Act before proceeding.',
      ),
    ).toBe(false);
  });

  it('exposes only top-level subsection labels for Limitation of Actions Act s.33, not inline amendment letters or amended-Act labels', () => {
    const pkg = readCorpusPackage();
    const s33 = corpusComponent(pkg, 'doc-limitation-of-actions-act', 'section:33');
    // s.33 is consequential-amendment machinery with three parsed subsections.
    // The inline (a)/(b)/(c) clauses nested inside 33(3) and the embedded Fatal
    // Accidents Act labels (8(3.1), 8(4), 5(4)) are amendment wording, not
    // structural subsections of s.33, so they must NOT be exposed as focus child
    // labels. Grounding validation therefore correctly rejects a group focused on
    // them; the fix is to treat the provision as skip/reference-only (Task 4), not
    // to loosen label validation.
    const childLabels = focusChildLabels(s33);
    expect(childLabels).toEqual(['33(1)', '33(2)', '33(3)']);
    for (const absent of ['33(3)(a)', '33(3)(b)', '33(3)(c)', '8(3.1)', '8(4)', '5(4)']) {
      expect(childLabels).not.toContain(absent);
    }
  });

  it('requires promptSpecVersion in the strict Study Map V3 result schema', () => {
    expect(STUDY_MAP_V3_RESULT_SCHEMA.properties.promptSpecVersion).toEqual({
      type: 'string',
      minLength: 1,
    });
    expect(STUDY_MAP_V3_RESULT_SCHEMA.required).toContain('promptSpecVersion');
  });

  it('fails closed on malformed Study Map V3 result shapes before grounding', () => {
    const job = jobFixture();
    const invalidCases = [
      {
        ...resultFixture(job),
        proposedGroups: [
          {
            ...resultFixture(job).proposedGroups[0],
            focusSelections: [{ sourceKey: 'section:10', evidenceText: 'shall file' }],
          },
        ],
      },
      {
        ...resultFixture(job),
        proposedGroups: [{ ...resultFixture(job).proposedGroups[0], groupId: undefined }],
      },
      {
        ...resultFixture(job),
        proposedGroups: [
          { ...resultFixture(job).proposedGroups[0], title: 'Wrong', titleSuggestion: undefined },
        ],
      },
      { ...resultFixture(job), disposition: 'other' },
      { ...resultFixture(job), confidence: 'certain' },
      {
        ...resultFixture(job),
        proposedGroups: [{ ...resultFixture(job).proposedGroups[0], sourceKeys: 'section:10' }],
      },
      {
        ...resultFixture(job),
        proposedGroups: [{ ...resultFixture(job).proposedGroups[0], focusSelections: null }],
      },
      { ...resultFixture(job), warnings: null },
    ];

    invalidCases.forEach((value) => {
      const report = validateAiStudyMapResult(value, job);
      expect(report.valid).toBe(false);
      expect(report.issues.map((issue) => issue.code)).not.toContain(
        'FOCUS_EVIDENCE_NOT_IN_SOURCE',
      );
    });
  });

  it('flags skip results with proposed groups and leaves skip/standalone/split otherwise valid', () => {
    const job = jobFixture();
    const base = resultFixture(job);
    const skipResult = (groupCount: number) => ({
      ...base,
      disposition: 'skip',
      reason: 'The source has no substantive learning goal.',
      suggestedPriority: undefined,
      proposedGroups: Array.from({ length: groupCount }, (_, index) => ({
        ...base.proposedGroups[0],
        groupId: `group-${index + 1}`,
      })),
    });

    expect(validateAiStudyMapResult(skipResult(0), job).valid).toBe(true);

    [1, 2].forEach((groupCount) => {
      const report = validateAiStudyMapResult(skipResult(groupCount), job);
      expect(report.valid).toBe(false);
      expect(report.issues.map((issue) => issue.code)).toContain('SKIP_WITH_GROUPS');
    });

    expect(validateAiStudyMapResult(base, job).valid).toBe(true);
    expect(
      validateAiStudyMapResult(
        {
          ...base,
          disposition: 'split',
          reason: 'The source covers two distinct duties.',
          proposedGroups: [
            base.proposedGroups[0],
            { ...base.proposedGroups[0], groupId: 'group-2' },
          ],
        },
        job,
      ).valid,
    ).toBe(true);
    const splitWithOneGroup = validateAiStudyMapResult(
      { ...base, disposition: 'split', reason: 'The source covers two distinct duties.' },
      job,
    );
    expect(splitWithOneGroup.valid).toBe(false);
    expect(splitWithOneGroup.issues.map((issue) => issue.code)).toContain('SPLIT_GROUP_COUNT');
  });

  it('enforces disposition/group-count consistency and required suggestedPriority', () => {
    const job = jobFixture();
    const base = resultFixture(job);
    const group = (id: string, focus?: unknown) => ({
      ...base.proposedGroups[0],
      groupId: id,
      ...(focus !== undefined ? { focusSelections: [focus] } : {}),
    });

    const standaloneWithTwo = validateAiStudyMapResult(
      { ...base, proposedGroups: [base.proposedGroups[0], group('group-2')] },
      job,
    );
    expect(standaloneWithTwo.valid).toBe(false);
    expect(standaloneWithTwo.issues.map((issue) => issue.code)).toContain('STANDALONE_GROUP_COUNT');

    const referenceOnlyWithGroup = validateAiStudyMapResult(
      {
        ...base,
        disposition: 'reference-only',
        suggestedPriority: undefined,
        proposedGroups: [base.proposedGroups[0]],
      },
      job,
    );
    expect(referenceOnlyWithGroup.valid).toBe(false);
    expect(referenceOnlyWithGroup.issues.map((issue) => issue.code)).toContain(
      'REFERENCE_ONLY_WITH_GROUPS',
    );

    const groupsWithoutPriority = validateAiStudyMapResult(
      { ...base, suggestedPriority: undefined },
      job,
    );
    expect(groupsWithoutPriority.valid).toBe(false);
    expect(groupsWithoutPriority.issues.map((issue) => issue.code)).toContain(
      'SUGGESTED_PRIORITY_REQUIRED',
    );

    const referenceOnlyNoPriority = validateAiStudyMapResult(
      {
        ...base,
        disposition: 'reference-only',
        reason: 'The provision is citation-only.',
        suggestedPriority: undefined,
        proposedGroups: [],
      },
      job,
    );
    expect(referenceOnlyNoPriority.valid).toBe(true);

    const skipNoPriority = validateAiStudyMapResult(
      {
        ...base,
        disposition: 'skip',
        reason: 'The source has no substantive learning goal.',
        suggestedPriority: undefined,
        proposedGroups: [],
      },
      job,
    );
    expect(skipNoPriority.valid).toBe(true);

    const skipWithNullPriority = validateAiStudyMapResult(
      {
        ...base,
        disposition: 'skip',
        reason: 'The source has no substantive learning goal.',
        suggestedPriority: null,
        proposedGroups: [],
      },
      job,
    );
    expect(skipWithNullPriority.valid).toBe(true);

    const zeroGroupWithPriority = validateAiStudyMapResult(
      {
        ...base,
        disposition: 'reference-only',
        reason: 'The provision is citation-only.',
        suggestedPriority: 'P3',
        proposedGroups: [],
      },
      job,
    );
    expect(zeroGroupWithPriority.valid).toBe(false);
    expect(zeroGroupWithPriority.issues.map((issue) => issue.code)).toContain(
      'SUGGESTED_PRIORITY_FORBIDDEN_WITHOUT_GROUPS',
    );

    const groupsWithNullPriority = validateAiStudyMapResult(
      { ...base, suggestedPriority: null },
      job,
    );
    expect(groupsWithNullPriority.valid).toBe(false);
    expect(groupsWithNullPriority.issues.map((issue) => issue.code)).toContain(
      'SUGGESTED_PRIORITY_REQUIRED',
    );
  });

  it('canonicalizes suggestedPriority serialization in runner-stamped results', () => {
    const job = jobFixture();
    const zeroGroupRaw: Record<string, unknown> = {
      disposition: 'skip',
      confidence: 'high',
      reason: 'The source has no substantive learning goal.',
      proposedGroups: [],
      warnings: [],
    };
    const stampedZero = __studyAiLocalMapAuthorTest.withRunnerIdentity(zeroGroupRaw, job);
    expect(stampedZero.suggestedPriority).toBeNull();
    expect(JSON.parse(JSON.stringify(stampedZero))).toHaveProperty('suggestedPriority', null);

    const groupedRaw: Record<string, unknown> = {
      disposition: 'standalone',
      confidence: 'high',
      reason: 'The source contains one focused filing duty.',
      suggestedPriority: 'P2',
      proposedGroups: resultFixture().proposedGroups,
      warnings: [],
    };
    const stampedGrouped = __studyAiLocalMapAuthorTest.withRunnerIdentity(groupedRaw, job);
    expect(stampedGrouped.suggestedPriority).toBe('P2');
  });

  it('warns on structured field labels embedded in prose fields without rejecting ordinary prose', () => {
    const job = jobFixture();
    const leaked = {
      ...resultFixture(job),
      proposedGroups: [
        {
          ...resultFixture(job).proposedGroups[0],
          approximateLearningGoal: 'Know that notice filing is required. SuggestedPriority: P2.',
        },
      ],
    };
    const report = validateAiStudyMapResult(leaked, job);
    expect(report.valid).toBe(true);
    expect(report.issues.map((issue) => issue.code)).toContain('STRUCTURED_FIELD_LABEL_LEAKAGE');

    const clean = resultFixture(job);
    expect(validateAiStudyMapResult(clean, job).issues.map((issue) => issue.code)).not.toContain(
      'STRUCTURED_FIELD_LABEL_LEAKAGE',
    );

    const ordinaryProse = {
      ...clean,
      reason: 'The duty is of moderate priority and the grouping is sound.',
      proposedGroups: [
        {
          ...clean.proposedGroups[0],
          reason: 'The filing requirement is the operative focus of the source.',
        },
      ],
    };
    expect(
      validateAiStudyMapResult(ordinaryProse, job).issues.map((issue) => issue.code),
    ).not.toContain('STRUCTURED_FIELD_LABEL_LEAKAGE');
  });

  it('blocks overlapping split focus and accepts disjoint split focus', () => {
    const job = jobFixture();
    const base = resultFixture(job);
    const splitOf = (focusA: unknown, focusB: unknown) => ({
      ...base,
      disposition: 'split',
      reason: 'The source covers two distinct duties.',
      proposedGroups: [
        { ...base.proposedGroups[0], groupId: 'group-1', focusSelections: [focusA] },
        {
          ...base.proposedGroups[0],
          groupId: 'group-2',
          focusSelections: [focusB],
        },
      ],
    });

    const overlapping = validateAiStudyMapResult(
      splitOf(
        { sourceKey: 'section:10', childLabels: ['10(1)', '10(2)'] },
        { sourceKey: 'section:10', childLabels: ['10(2)', '10(3)'] },
      ),
      job,
    );
    expect(overlapping.valid).toBe(false);
    expect(overlapping.issues.map((issue) => issue.code)).toContain('DUPLICATE_FOCUS_CHILD_LABEL');

    const overlappingTerm = validateAiStudyMapResult(
      splitOf(
        { sourceKey: 'section:10', definedTerms: ['notice'] },
        { sourceKey: 'section:10', definedTerms: ['notice', 'person'] },
      ),
      job,
    );
    expect(overlappingTerm.valid).toBe(false);
    expect(overlappingTerm.issues.map((issue) => issue.code)).toContain(
      'DUPLICATE_FOCUS_DEFINED_TERM',
    );

    const disjoint = validateAiStudyMapResult(
      splitOf(
        { sourceKey: 'section:10', childLabels: ['10(1)'] },
        { sourceKey: 'section:10', childLabels: ['10(2)'] },
      ),
      job,
    );
    expect(disjoint.valid).toBe(true);
  });

  it('rejects opaque machine warning codes from the local model', () => {
    const job = jobFixture();
    const base = resultFixture(job);

    ['G1', 'S5001', 'AB12'].forEach((opaque) => {
      const report = validateAiStudyMapResult({ ...base, warnings: [opaque] }, job);
      expect(report.valid).toBe(false);
      expect(report.issues.map((issue) => issue.code)).toContain('OPAQUE_WARNING_CODE');
    });

    const descriptive = validateAiStudyMapResult(
      { ...base, warnings: ['TARGET_PARSE_LOOKS_DAMAGED'] },
      job,
    );
    expect(descriptive.valid).toBe(true);
  });

  it('loads the canonical Study Map V3 spec and fails closed when missing', () => {
    expect(loadStudyMapV3Spec()).toContain('curriculum mapping, not legal analysis');
    expect(() => loadStudyMapV3Spec('study-content/ai/specs/does-not-exist.md')).toThrow(
      /spec not found/,
    );
  });

  it('guards historic-applicability source discipline in the Study Map V3 spec', () => {
    const spec = loadStudyMapV3Spec();
    // A historical date or applicability clause alone must not establish obsolescence.
    expect(spec).toContain('obsolescence, non-operation, "has no current legal rule"');
    expect(spec).toContain(
      'it does not prove the provision is obsolete or inoperative',
    );
    // Neutral rationale vocabulary and the established warning code.
    expect(spec).toContain('historic temporal applicability, an old cutoff date, low independent recall value');
    expect(spec).toContain('Prefer the warning code HISTORIC_TEMPORAL_APPLICABILITY over any "obsolete" wording');
    expect(spec).toContain(
      'COMMENCEMENT_OR_CITATION_REFERENCE_ONLY, or HISTORIC_TEMPORAL_APPLICABILITY for transitional/historic-applicability material',
    );
    // The skip guidance uses neutral wording, not "obsolete transitional material".
    expect(spec).not.toContain('obsolete transitional material');
    expect(spec).toContain('purely transitional or historic-applicability material');
  });

  it('guards statutory actor/institution names against invented shorthand', () => {
    const spec = loadStudyMapV3Spec();
    expect(spec).toContain(
      'Statutory actor names and institution names are written exactly as the source writes them',
    );
    expect(spec).toContain('never compressed to hyphenated single letters');
    expect(spec).toContain('Lieutenant-Governor in Council');
    expect(spec).toContain('L-G in C');
  });

  it('sends the canonical Study Map V3 spec in the local runner system prompt', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const bodies: unknown[] = [];
    const fetchMock: Parameters<typeof runLocalMapAuthoring>[1] = async (_input, init) => {
      bodies.push(JSON.parse(init.body ?? ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(resultFixture(job)) } }],
        }),
        text: async () => '',
      };
    };

    await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs({ run: job.runId, model: 'mock-model' }, {}),
        baseUrl: 'http://mock/v1',
        resume: true,
        maxRetries: 0,
      },
      fetchMock,
    );

    const system = (bodies[0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(system).toContain('## Disposition, group count, and focus');
    expect(system).toContain('curriculum mapping, not legal analysis');
    expect(system).toContain('useful independent study value');
    expect(system).toContain('Allowed confidence values: high, medium, low.');
    expect(system).toContain('RUNNER NOTES (local run only)');
    expect(system.length).toBeGreaterThan(loadStudyMapV3Spec().length);
  });

  it('feeds failed validation issues back into the retry prompt', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchMock: Parameters<typeof runLocalMapAuthoring>[1] = async (_input, init) => {
      calls += 1;
      bodies.push(JSON.parse(init.body ?? ''));
      const invalid = {
        ...resultFixture(job),
        proposedGroups: [
          resultFixture(job).proposedGroups[0],
          { ...resultFixture(job).proposedGroups[0], groupId: 'group-2' },
        ],
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: JSON.stringify(calls === 1 ? invalid : resultFixture(job)) },
            },
          ],
        }),
        text: async () => '',
      };
    };

    await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs({ run: job.runId, model: 'mock-model' }, {}),
        baseUrl: 'http://mock/v1',
        resume: true,
        maxRetries: 1,
      },
      fetchMock,
    );

    expect(bodies).toHaveLength(2);
    const retryMessage = (bodies[1] as { messages: Array<{ content: string }> }).messages
      .map((message) => message.content)
      .find((content) => content.includes('STANDALONE_GROUP_COUNT'));
    expect(retryMessage).toBeDefined();
    expect(retryMessage).toContain('failed validation');
  });

  it('retries a missing suggestedPriority against the previous invalid response and accepts the corrected result', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const invalid = { ...resultFixture(job) };
    delete invalid.suggestedPriority;
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchMock: Parameters<typeof runLocalMapAuthoring>[1] = async (_input, init) => {
      calls += 1;
      bodies.push(JSON.parse(init.body ?? ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify(calls === 1 ? invalid : resultFixture(job)) } },
          ],
        }),
        text: async () => '',
      };
    };

    const result = await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs({ run: job.runId, model: 'mock-model' }, {}),
        baseUrl: 'http://mock/v1',
        resume: true,
        maxRetries: 1,
      },
      fetchMock,
    );

    expect(result.accepted).toBe(1);
    expect(result.semanticFailed).toBe(0);
    expect(calls).toBe(2);

    const retryMessage = (bodies[1] as { messages: Array<{ content: string }> }).messages
      .map((message) => message.content)
      .find((content) => content.includes('SUGGESTED_PRIORITY_REQUIRED'));
    expect(retryMessage).toBeDefined();
    expect(retryMessage).toContain('Correct the previous response');
    expect(retryMessage).toContain('Preserve valid semantic decisions');
    expect(retryMessage).toContain('exactly one of P1, P2, P3, or P4');
    // The bounded previous response is echoed so the valid semantic content
    // does not have to be regenerated; the missing field was absent there.
    expect(retryMessage).toContain('Previous invalid response (JSON only):');
    expect(retryMessage).toContain('"groupId":"group-1"');
    expect(retryMessage).not.toContain('"suggestedPriority"');

    const line = readFileSync(
      join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'),
      'utf8',
    ).trim();
    expect(JSON.parse(line)).toEqual(resultFixture(job));
  });

  it('restates a repeated validation error as mandatory before the next retry', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const invalid = { ...resultFixture(job) };
    delete invalid.suggestedPriority;
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchMock: Parameters<typeof runLocalMapAuthoring>[1] = async (_input, init) => {
      calls += 1;
      bodies.push(JSON.parse(init.body ?? ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify(calls < 3 ? invalid : resultFixture(job)) } },
          ],
        }),
        text: async () => '',
      };
    };

    const result = await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs({ run: job.runId, model: 'mock-model' }, {}),
        baseUrl: 'http://mock/v1',
        resume: true,
        maxRetries: 2,
      },
      fetchMock,
    );

    expect(result.accepted).toBe(1);
    expect(calls).toBe(3);
    const retryNote = (body: unknown) =>
      (body as { messages: Array<{ content: string }> }).messages
        .map((message) => message.content)
        .find((content) => content.includes('SUGGESTED_PRIORITY_REQUIRED'));
    expect(retryNote(bodies[1] as unknown)).not.toContain('previous attempt also produced');
    expect(retryNote(bodies[2] as unknown)).toContain(
      'previous attempt also produced SUGGESTED_PRIORITY_REQUIRED',
    );
    expect(retryNote(bodies[2] as unknown)).toContain('mandatory for this result');
  });

  it('keeps max-retry semantics: an always-invalid result exhausts initial plus maxRetries attempts', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const invalid = { ...resultFixture(job), confidence: 'certain' };
    let calls = 0;

    const result = await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs({ run: job.runId, model: 'mock-model' }, {}),
        baseUrl: 'http://mock/v1',
        resume: true,
        maxRetries: 1,
      },
      async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(invalid) } }],
          }),
          text: async () => '',
        };
      },
    );

    expect(result.accepted).toBe(0);
    expect(result.semanticFailed).toBe(1);
    expect(calls).toBe(2);
  });

  it('bounds pathological previous responses in validation retry notes', () => {
    const issue = {
      code: 'SUGGESTED_PRIORITY_REQUIRED',
      severity: 'error' as const,
      message: 'suggestedPriority is required when proposedGroups is non-empty.',
    };
    const noteAllowance = 13_000; // 12k response cap + bounded note overhead
    const bounded = buildValidationRetryNote([issue], { reason: 'a'.repeat(50_000) });
    expect(bounded.length).toBeLessThan(noteAllowance);
    expect(bounded).toContain('truncated for retry context');

    const small = buildValidationRetryNote([issue], { reason: 'A focused filing duty.' });
    expect(small).not.toContain('truncated for retry context');
    expect(small).toContain('{"reason":"A focused filing duty."}');
  });

  it('parses local author timeout from CLI, env fallback, and default', () => {
    expect(
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        { run: 'run-1', model: 'model-1', 'timeout-ms': '1234' },
        {},
      ).timeoutMs,
    ).toBe(1234);
    expect(
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        { run: 'run-1', model: 'model-1' },
        { STUDY_AI_TIMEOUT_MS: '2345' },
      ).timeoutMs,
    ).toBe(2345);
    expect(
      __studyAiLocalMapAuthorTest.optionsFromArgs({ run: 'run-1', model: 'model-1' }, {}).timeoutMs,
    ).toBe(600_000);
    expect(() =>
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        { run: 'run-1', model: 'model-1', 'timeout-ms': '0' },
        {},
      ),
    ).toThrow('--timeout-ms');
    expect(
      __studyAiLocalMapAuthorTest.parseRawArgs([
        '--run',
        'run-1',
        '--model',
        'model-1',
        '--timeout-ms',
      ])['timeout-ms'],
    ).toBe(true);
    expect(() =>
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        __studyAiLocalMapAuthorTest.parseRawArgs([
          '--run',
          'run-1',
          '--model',
          'model-1',
          '--timeout-ms',
        ]),
        {},
      ),
    ).toThrow('--timeout-ms');
    expect(() =>
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        { run: 'run-1', model: 'model-1', 'timeout-ms': true },
        {},
      ),
    ).toThrow('--timeout-ms');
  });

  it('parses local author reasoning effort from CLI, env fallback, and default', () => {
    expect(
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        { run: 'run-1', model: 'model-1', 'reasoning-effort': 'none' },
        {},
      ).reasoningEffort,
    ).toBe('none');
    expect(
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        { run: 'run-1', model: 'model-1' },
        { STUDY_AI_REASONING_EFFORT: 'none' },
      ).reasoningEffort,
    ).toBe('none');
    expect(
      __studyAiLocalMapAuthorTest.optionsFromArgs({ run: 'run-1', model: 'model-1' }, {})
        .reasoningEffort,
    ).toBeUndefined();
    expect(() =>
      __studyAiLocalMapAuthorTest.optionsFromArgs(
        __studyAiLocalMapAuthorTest.parseRawArgs([
          '--run',
          'run-1',
          '--model',
          'model-1',
          '--reasoning-effort',
        ]),
        {},
      ),
    ).toThrow('--reasoning-effort');
  });

  it('sends optional reasoning effort without changing strict JSON Schema response format', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const bodies: unknown[] = [];
    const fetchMock: Parameters<typeof runLocalMapAuthoring>[1] = async (_input, init) => {
      bodies.push(JSON.parse(init.body ?? ''));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(resultFixture(job)) } }],
        }),
        text: async () => '',
      };
    };

    await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs({ run: job.runId, model: 'mock-model' }, {}),
        baseUrl: 'http://mock/v1',
        resume: true,
        maxRetries: 0,
      },
      fetchMock,
    );

    rmSync(join('study-content', 'ai', 'runs', job.runId), { recursive: true, force: true });
    writeJobRun(job);

    await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs(
          { run: job.runId, model: 'mock-model', 'reasoning-effort': 'none' },
          {},
        ),
        baseUrl: 'http://mock/v1',
        resume: true,
        maxRetries: 0,
      },
      fetchMock,
    );

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[1]).toHaveProperty('reasoning_effort', 'none');
    bodies.forEach((body) => {
      expect(body).toHaveProperty('response_format.type', 'json_schema');
      expect(body).toHaveProperty('response_format.json_schema.strict', true);
      expect(body).toHaveProperty(
        'response_format.json_schema.schema',
        STUDY_MAP_V3_LOCAL_RESULT_SCHEMA,
      );
    });
  });

  it('sends a local result schema without runner-owned identity fields', () => {
    expect(STUDY_MAP_V3_LOCAL_RESULT_SCHEMA.required).toEqual([
      'disposition',
      'confidence',
      'reason',
      'suggestedPriority',
      'proposedGroups',
      'warnings',
    ]);
    expect(STUDY_MAP_V3_LOCAL_RESULT_SCHEMA.additionalProperties).toBe(false);
    const properties = STUDY_MAP_V3_LOCAL_RESULT_SCHEMA.properties as Record<string, unknown>;
    for (const field of [
      'schemaVersion',
      'jobId',
      'runId',
      'corpusContentHash',
      'inputHash',
      'authoringInputFingerprint',
      'promptSpecVersion',
    ]) {
      expect(properties).not.toHaveProperty(field);
    }
    expect(Object.keys(properties).sort()).toEqual([
      'confidence',
      'disposition',
      'proposedGroups',
      'reason',
      'suggestedPriority',
      'warnings',
    ]);
  });

  it('structurally requires a nullable suggestedPriority (P1-P4 or null) in the local schema', () => {
    expect(STUDY_MAP_V3_LOCAL_RESULT_SCHEMA.required).toContain('suggestedPriority');
    const properties = STUDY_MAP_V3_LOCAL_RESULT_SCHEMA.properties as Record<
      string,
      { enum?: unknown[] }
    >;
    expect(properties.suggestedPriority?.enum).toEqual(['P1', 'P2', 'P3', 'P4', null]);
  });

  it('records resolved inference config provenance for accepted and rejected attempts', async () => {
    const job = jobFixture();
    writeJobRun(job);
    let calls = 0;

    await runLocalMapAuthoring(
      {
        ...__studyAiLocalMapAuthorTest.optionsFromArgs(
          {
            run: job.runId,
            model: 'mock-model',
            'base-url': 'http://mock/v1',
            'reasoning-effort': 'none',
            'timeout-ms': '50',
            'max-retries': '1',
            concurrency: '1',
          },
          {},
        ),
        resume: true,
      },
      async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    calls === 1
                      ? { ...resultFixture(job), confidence: 'certain' }
                      : resultFixture(job),
                  ),
                },
              },
            ],
          }),
          text: async () => '',
        };
      },
    );

    const rejected = JSON.parse(
      readFileSync(
        join(
          'study-content',
          'ai',
          'runs',
          job.runId,
          'local-failures',
          job.jobId,
          'attempt-1.validation.json',
        ),
        'utf8',
      ),
    );
    const accepted = JSON.parse(
      readFileSync(
        join('study-content', 'ai', 'runs', job.runId, 'results', `${job.jobId}.provenance.json`),
        'utf8',
      ),
    );

    [rejected, accepted].forEach((provenance) => {
      expect(provenance).toHaveProperty(
        'resolvedInferenceConfig.provider.kind',
        'local-openai-compatible',
      );
      expect(provenance).toHaveProperty(
        'resolvedInferenceConfig.provider.baseUrl',
        'http://mock/v1',
      );
      expect(provenance).toHaveProperty('resolvedInferenceConfig.model', {
        id: 'mock-model',
        source: 'cli',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.reasoningEffort', {
        value: 'none',
        source: 'cli',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.temperature', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.topP', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.topK', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.minP', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.presencePenalty', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.repetitionPenalty', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.repeatPenalty', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.sampler.maxTokens', {
        value: null,
        source: 'omitted-request',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.execution.timeoutMs', {
        value: 50,
        source: 'cli',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.execution.maxRetries', {
        value: 1,
        source: 'cli',
      });
      expect(provenance).toHaveProperty('resolvedInferenceConfig.execution.concurrency', {
        value: 1,
        source: 'cli',
      });
      expect(provenance).toHaveProperty(
        'resolvedInferenceConfig.structuredOutput.mode',
        'strict-json-schema',
      );
      expect(provenance).toHaveProperty('resolvedInferenceConfig.structuredOutput.strict', true);
      expect(provenance.resolvedInferenceConfig.structuredOutput.responseSchemaSha256).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(provenance.resolvedInferenceConfig.prompts.systemPromptSha256).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(provenance).toHaveProperty(
        'resolvedInferenceConfig.prompts.promptSpecVersion',
        'study-map-v3',
      );
    });
  });

  it('writes accepted local results canonically and leaves invalid results outside canonical output', async () => {
    const job = jobFixture();
    writeJobRun(job);
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  calls === 1
                    ? { ...resultFixture(job), confidence: 'certain' }
                    : resultFixture(job),
                ),
              },
            },
          ],
        }),
        text: async () => '',
      };
    };

    const result = await runLocalMapAuthoring(
      {
        runId: job.runId,
        model: 'mock-model',
        baseUrl: 'http://mock/v1',
        resume: true,
        concurrency: 1,
        maxRetries: 2,
        dryRun: false,
        unsafeUnstructured: false,
      },
      fetchMock,
    );

    expect(result.accepted).toBe(1);
    expect(result.semanticFailed).toBe(0);
    expect(calls).toBe(2);
    expect(
      readFileSync(
        join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'),
        'utf8',
      )
        .trim()
        .split(/\r?\n/),
    ).toHaveLength(1);
    expect(
      existsSync(
        join(
          'study-content',
          'ai',
          'runs',
          job.runId,
          'local-failures',
          job.jobId,
          'attempt-1.validation.json',
        ),
      ),
    ).toBe(true);
  });

  it('skips already accepted local results on resume without duplicate lines', async () => {
    const job = jobFixture();
    writeJobRun(job);
    mkdirSync(join('study-content', 'ai', 'runs', job.runId, 'results'), { recursive: true });
    writeFileSync(
      join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'),
      `${JSON.stringify(resultFixture(job))}\n`,
    );

    const result = await runLocalMapAuthoring(
      {
        runId: job.runId,
        model: 'mock-model',
        baseUrl: 'http://mock/v1',
        resume: true,
        concurrency: 1,
        maxRetries: 2,
        dryRun: false,
        unsafeUnstructured: false,
      },
      async () => {
        throw new Error('fetch should not be called on resume');
      },
    );

    expect(result.skipped).toBe(1);
    expect(
      readFileSync(
        join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'),
        'utf8',
      )
        .trim()
        .split(/\r?\n/),
    ).toHaveLength(1);
  });

  it('validates resume results against job identity, not the run directory name', () => {
    const { validateExistingResults } = __studyAiLocalMapAuthorTest;
    const job = jobFixture();
    const result = resultFixture(job);
    const warmOptions = { runId: 'ai-warm-started-run-dir' } as Parameters<
      typeof validateExistingResults
    >[2];
    // Warm start: results keep the source run's runId (the job's prepared identity).
    expect(() => validateExistingResults([result], [job], warmOptions)).not.toThrow();
    // A result whose runId matches neither the job nor this run is foreign.
    const foreign = { ...result, runId: 'ai-some-other-run' };
    expect(() => validateExistingResults([foreign], [job], warmOptions)).toThrow(/runId/);
    // A result with no matching job file is still rejected.
    expect(() => validateExistingResults([result], [], warmOptions)).toThrow(
      /no matching job file/,
    );
  });

  it('recovers from a provider failure within the same semantic attempt', async () => {
    const job = jobFixture();
    writeJobRun(job);
    let chatCalls = 0;
    let healthCalls = 0;
    const logs: string[] = [];

    const result = await runLocalMapAuthoring(
      localAuthorOptions(job, { log: (message) => logs.push(message) }),
      async (input) => {
        if (input.endsWith('/models')) {
          healthCalls += 1;
          return healthyModelsResponse;
        }
        chatCalls += 1;
        if (chatCalls === 1) throw new Error('provider timeout');
        return successResponseFor(job);
      },
    );

    const rawFailure = JSON.parse(
      readFileSync(join(failuresDirFor(job), 'attempt-1.raw.json'), 'utf8'),
    ) as Record<string, unknown>;
    const validationFailure = JSON.parse(
      readFileSync(join(failuresDirFor(job), 'attempt-1.validation.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(result.accepted).toBe(1);
    expect(result.semanticFailed).toBe(0);
    expect(result.providerIncomplete).toBe(0);
    expect(result.providerAbort).toBeUndefined();
    expect(chatCalls).toBe(2);
    expect(healthCalls).toBe(1);
    expect(rawFailure).toEqual({
      failureKind: 'transport/provider',
      failureCode: 'PROVIDER_TIMEOUT',
      message: 'provider timeout',
    });
    expect(validationFailure.failureKind).toBe('transport/provider');
    expect(validationFailure.failureCode).toBe('PROVIDER_TIMEOUT');
    expect(validationFailure.errorMessage).toBe('provider timeout');
    expect(validationFailure.issues).toEqual([]);
    const events = readProviderEvents(job.runId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      jobId: job.jobId,
      semanticAttempt: 1,
      providerAttempt: 1,
      code: 'PROVIDER_TIMEOUT',
      message: 'provider timeout',
      baseUrl: 'http://mock/v1',
      recovered: true,
    });
    expect(logs).toContain('[1/1] map-test-local');
    expect(logs).toContain('attempt 1/2 started');
    expect(logs).not.toContain('attempt 2/2 started');
    expect(
      logs.some((line) =>
        /^provider failure \(PROVIDER_TIMEOUT\) after \d+ ms: provider timeout$/.test(line),
      ),
    ).toBe(true);
    expect(logs.some((line) => /^HTTP response arrived after \d+ ms$/.test(line))).toBe(true);
    expect(logs).toContain('validation accepted');
  });

  it('aborts the run when provider health does not recover within the timeout', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const logs: string[] = [];

    const result = await runLocalMapAuthoring(
      localAuthorOptions(job, {
        providerRecoveryTimeoutMs: 20,
        log: (message) => logs.push(message),
      }),
      async (input) => {
        if (input.endsWith('/models')) throw new Error('connect refused');
        throw new Error('fetch failed');
      },
    );

    expect(result.accepted).toBe(0);
    expect(result.semanticFailed).toBe(0);
    expect(result.providerIncomplete).toBe(1);
    expect(result.providerAbort).toEqual(
      expect.objectContaining({ jobId: job.jobId, code: 'PROVIDER_RECOVERY_TIMEOUT' }),
    );
    const events = readProviderEvents(job.runId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: 'PROVIDER_SOCKET_ERROR',
      recovered: false,
      runAborted: true,
    });
    expect(existsSync(join(failuresDirFor(job), 'attempt-1.raw.json'))).toBe(true);
    expect(logs.some((line) => line.startsWith('RUN INCOMPLETE: '))).toBe(true);
  });

  it('aborts the run after the maximum provider attempts when the chat call keeps failing', async () => {
    const job = jobFixture();
    writeJobRun(job);
    let chatCalls = 0;

    const result = await runLocalMapAuthoring(
      localAuthorOptions(job, { maxProviderAttempts: 2 }),
      async (input) => {
        if (input.endsWith('/models')) return healthyModelsResponse;
        chatCalls += 1;
        throw new Error('fetch failed');
      },
    );

    expect(chatCalls).toBe(2);
    expect(result.accepted).toBe(0);
    expect(result.providerIncomplete).toBe(1);
    expect(result.providerAbort).toEqual(
      expect.objectContaining({ jobId: job.jobId, code: 'PROVIDER_SOCKET_ERROR' }),
    );
    const events = readProviderEvents(job.runId);
    expect(events.map((event) => [event.providerAttempt, event.recovered])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(existsSync(join(failuresDirFor(job), 'attempt-2.raw.json'))).toBe(true);
  });

  it('aborts immediately when the provider rejects the structured output contract', async () => {
    const job = jobFixture();
    writeJobRun(job);

    const result = await runLocalMapAuthoring(
      localAuthorOptions(job),
      async () => ({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'JSON Schema response_format is not supported by this server',
      }),
    );

    expect(result.accepted).toBe(0);
    expect(result.providerIncomplete).toBe(1);
    expect(result.providerAbort).toEqual(
      expect.objectContaining({
        jobId: job.jobId,
        code: 'PROVIDER_HTTP_ERROR',
        message: expect.stringContaining('Structured output is the safe default'),
      }),
    );
    const events = readProviderEvents(job.runId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ code: 'PROVIDER_HTTP_ERROR', runAborted: true });
    expect(existsSync(join(failuresDirFor(job), 'attempt-1.raw.json'))).toBe(true);
  });

  it('continues failure artifact numbering after pre-existing attempt artifacts', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const jobFailuresDir = failuresDirFor(job);
    mkdirSync(jobFailuresDir, { recursive: true });
    const prior = (index: number, message: string) => {
      writeFileSync(
        join(jobFailuresDir, `attempt-${index}.raw.json`),
        `${JSON.stringify({
          failureKind: 'transport/provider',
          failureCode: 'PROVIDER_SOCKET_ERROR',
          message,
        })}\n`,
      );
      writeFileSync(
        join(jobFailuresDir, `attempt-${index}.validation.json`),
        `${JSON.stringify({
          failureKind: 'transport/provider',
          failureCode: 'PROVIDER_SOCKET_ERROR',
          errorMessage: message,
          issues: [],
        })}\n`,
      );
    };
    prior(1, 'earlier crash');
    prior(2, 'earlier crash 2');

    let chatCalls = 0;
    const result = await runLocalMapAuthoring(
      localAuthorOptions(job),
      async (input) => {
        if (input.endsWith('/models')) return healthyModelsResponse;
        chatCalls += 1;
        if (chatCalls === 1) throw new Error('fetch failed');
        return successResponseFor(job);
      },
    );

    expect(result.accepted).toBe(1);
    expect(chatCalls).toBe(2);
    expect(existsSync(join(jobFailuresDir, 'attempt-3.raw.json'))).toBe(true);
    const newArtifact = JSON.parse(
      readFileSync(join(jobFailuresDir, 'attempt-3.validation.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(newArtifact.failureCode).toBe('PROVIDER_SOCKET_ERROR');
    expect(newArtifact.failureKind).toBe('transport/provider');
  });

  it('refuses to resume when the recorded model identity no longer matches', async () => {
    const job = jobFixture();
    writeJobRun(job);
    await runLocalMapAuthoring(localAuthorOptions(job), async () => successResponseFor(job));
    const metadataPath = join(runDirFor(job), 'reports', 'local-run-metadata.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as { model: string };
    metadata.model = 'other-model';
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

    await expect(
      runLocalMapAuthoring(localAuthorOptions(job), async () => successResponseFor(job)),
    ).rejects.toThrow('metadata model other-model does not match current model mock-model');
  });

  it('refuses to resume when the comparison set identity changed', async () => {
    const job = jobFixture();
    writeJobRun(job);
    await runLocalMapAuthoring(localAuthorOptions(job), async () => successResponseFor(job));
    const setPath = join(runDirFor(job), 'reports', 'comparison-set.json');
    writeFileSync(setPath, `${JSON.stringify({ jobs: [{ v2JobId: job.jobId }] })}\n`);

    await expect(
      runLocalMapAuthoring(
        localAuthorOptions(job, { comparisonSet: setPath }),
        async () => successResponseFor(job),
      ),
    ).rejects.toThrow('comparison set');
  });

  it('refuses to resume when the result file contains a duplicate accepted job', async () => {
    const job = jobFixture();
    writeJobRun(job);
    await runLocalMapAuthoring(localAuthorOptions(job), async () => successResponseFor(job));
    const line = readFileSync(resultsFileFor(job), 'utf8').trim();
    writeFileSync(resultsFileFor(job), `${line}\n${line}\n`);

    await expect(
      runLocalMapAuthoring(localAuthorOptions(job), async () => successResponseFor(job)),
    ).rejects.toThrow('duplicate accepted result');
  });

  it('refuses to resume when an accepted result fingerprint no longer matches its job', async () => {
    const job = jobFixture();
    writeJobRun(job);
    await runLocalMapAuthoring(localAuthorOptions(job), async () => successResponseFor(job));
    const tampered = JSON.parse(readFileSync(resultsFileFor(job), 'utf8').trim());
    tampered.authoringInputFingerprint = 'tampered';
    writeFileSync(resultsFileFor(job), `${JSON.stringify(tampered)}\n`);

    await expect(
      runLocalMapAuthoring(localAuthorOptions(job), async () => successResponseFor(job)),
    ).rejects.toThrow('fingerprint tampered does not match job hash');
  });

  it('documents provider recovery, resume, and telemetry in the CLI help', () => {
    expect(LOCAL_MAP_AUTHOR_HELP).toContain('--resume');
    expect(LOCAL_MAP_AUTHOR_HELP).toContain('--max-provider-attempts');
    expect(LOCAL_MAP_AUTHOR_HELP).toContain('--provider-recovery-timeout-ms');
    expect(LOCAL_MAP_AUTHOR_HELP).toContain('provider-events.jsonl');
    expect(LOCAL_MAP_AUTHOR_HELP).toContain('local-run-metadata.json');
    expect(LOCAL_MAP_AUTHOR_HELP).toContain('never consume --max-retries');
  });

  it('normalizes wrong local result identity to runner-owned job identity', async () => {
    const job = jobFixture();
    writeJobRun(job);

    const result = await runLocalMapAuthoring(
      {
        runId: job.runId,
        model: 'mock-model',
        baseUrl: 'http://mock/v1',
        resume: true,
        concurrency: 1,
        maxRetries: 0,
        dryRun: false,
        unsafeUnstructured: false,
      },
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...resultFixture(job),
                  jobId: 'wrong-job',
                  runId: 'wrong-run',
                  authoringInputFingerprint: 'wrong-fingerprint',
                }),
              },
            },
          ],
        }),
        text: async () => '',
      }),
    );

    expect(result.accepted).toBe(1);
    expect(result.semanticFailed).toBe(0);
    const line = readFileSync(
      join('study-content', 'ai', 'runs', job.runId, 'results', 'local-map.results.jsonl'),
      'utf8',
    )
      .split('\n')
      .filter((entry) => entry)
      .pop() as string;
    expect(JSON.parse(line)).toEqual(resultFixture(job));
  });
});
