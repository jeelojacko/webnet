import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { __studyAiAuthoringTest } from '../../scripts/studyAiAuthoring';
import {
  __studyAiLocalMapAuthorTest,
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
    expect(standaloneWithTwo.issues.map((issue) => issue.code)).toContain(
      'STANDALONE_GROUP_COUNT',
    );

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

  it('sends the canonical Study Map V3 spec in the local runner system prompt', async () => {
    const job = jobFixture();
    writeJobRun(job);
    const bodies: unknown[] = [];
    const fetchMock: Parameters<typeof runLocalMapAuthoring>[1] = async (_input, init) => {
      bodies.push(JSON.parse(init.body));
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
        ...__studyAiLocalMapAuthorTest.optionsFromArgs(
          { run: job.runId, model: 'mock-model' },
          {},
        ),
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
      bodies.push(JSON.parse(init.body));
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
        ...__studyAiLocalMapAuthorTest.optionsFromArgs(
          { run: job.runId, model: 'mock-model' },
          {},
        ),
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
      bodies.push(JSON.parse(init.body));
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
    expect(result.failed).toBe(0);
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

  it('records transport/provider failures separately and retries without schema-validation issues', async () => {
    const job = jobFixture();
    writeJobRun(job);
    let calls = 0;
    const logs: string[] = [];

    const result = await runLocalMapAuthoring(
      {
        runId: job.runId,
        model: 'mock-model',
        baseUrl: 'http://mock/v1',
        resume: true,
        concurrency: 1,
        maxRetries: 1,
        timeoutMs: 50,
        dryRun: false,
        unsafeUnstructured: false,
        log: (message) => logs.push(message),
      },
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('provider timeout');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(resultFixture(job)) } }],
          }),
          text: async () => '',
        };
      },
    );

    const rawFailure = JSON.parse(
      readFileSync(
        join(
          'study-content',
          'ai',
          'runs',
          job.runId,
          'local-failures',
          job.jobId,
          'attempt-1.raw.json',
        ),
        'utf8',
      ),
    ) as { failureKind: string; message: string };
    const validationFailure = JSON.parse(
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
    ) as { failureKind: string; errorMessage: string; issues: string[] };

    expect(result.accepted).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls).toBe(2);
    expect(rawFailure).toEqual({ failureKind: 'transport/provider', message: 'provider timeout' });
    expect(validationFailure.failureKind).toBe('transport/provider');
    expect(validationFailure.errorMessage).toBe('provider timeout');
    expect(validationFailure.issues).toEqual([]);
    expect(logs).toContain('[1/1] map-test-local');
    expect(logs).toContain('attempt 1/2 started');
    expect(logs).toContain('attempt 2/2 started');
    expect(
      logs.some((line) =>
        /^transport\/provider failure after \d+ ms: provider timeout$/.test(line),
      ),
    ).toBe(true);
    expect(logs.some((line) => /^HTTP response arrived after \d+ ms$/.test(line))).toBe(true);
    expect(logs).not.toContain('validation rejected');
    expect(logs).toContain('validation accepted');
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
    expect(result.failed).toBe(0);
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
