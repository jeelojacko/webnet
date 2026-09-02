import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiUnitAuthoringJob } from '../../src/study/ai/studyAiTypes';
import type { NbLawContentPackage, NbLawNormalizedDocument, NbLawSection } from '../../src/study/content/nbLawTypes';
import {
  LOCAL_UNIT_RESULTS_FILE,
  LOCAL_UNIT_AUTHOR_HELP,
  UNIT_AUTHORING_V4_SPEC_PATH,
  UNIT_AUTHORING_V4_SPEC_VERSION,
  UNIT_AUTHORING_V5_SPEC_PATH,
  UNIT_AUTHORING_V5_SPEC_VERSION,
  runLocalUnitAuthoring,
  optionsFromArgs,
  hashText,
} from '../../scripts/studyAiLocalUnitAuthor';
import {
  UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA,
  UNIT_AUTHORING_V4_MODEL_FIELDS,
} from '../../src/study/ai/studyAiUnitLocalSchema';

const RUN_ID = 'ai-unit-local-test-run';
const JOB_71 = 'unit-test-71';
const JOB_72 = 'unit-test-72';
const MODEL = 'mock-model';
const SOURCE_71 = 'section:71';
const SOURCE_72 = 'section:72';

const TEXT_71 =
  '71(1) A surveyor shall deliver a written objection to the Registrar General before the hearing.\n71(2) The Registrar General may waive a prescribed form requirement for the written objection.';
const TEXT_72 =
  '72 A surveyor shall not commence a survey before the Registrar General approves the plan.';

const SENTENCE_71_1 = 'A surveyor shall deliver a written objection to the Registrar General before the hearing.';
const SENTENCE_71_2 = 'The Registrar General may waive a prescribed form requirement for the written objection.';
const SENTENCE_72 = 'A surveyor shall not commence a survey before the Registrar General approves the plan.';

type Fixture = { root: string; runId: string; runDir: string; packagePath: string };
const tempDirs: string[] = [];

const useFixture = (): Fixture => {
  const root = mkdtempSync(join(tmpdir(), 'study-ai-unit-local-'));
  tempDirs.push(root);
  return { root, runId: RUN_ID, runDir: join(root, RUN_ID), packagePath: join(root, 'corpus.content-package.json') };
};

afterEach(() => {
  tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  tempDirs.length = 0;
});

/* ------------------------------ corpus package ------------------------------ */

const componentFor = (sourceKey: string, text: string): NbLawSection => ({
  id: `section-${sourceKey.split(':')[1]}`,
  sourceKey,
  componentType: 'section',
  label: sourceKey.split(':')[1],
  text,
  subsections: [],
  contentHash: hashText(text),
});

const buildPackage = (): NbLawContentPackage => {
  const component71 = componentFor(SOURCE_71, TEXT_71);
  const component72 = componentFor(SOURCE_72, TEXT_72);
  const document: NbLawNormalizedDocument = {
    schemaVersion: 1,
    id: 'doc-registry-act',
    officialTitle: 'Registry Act',
    documentType: 'act',
    sourceUrl: 'https://example.invalid/registry-act',
    fetchDate: '2026-01-01',
    contentHash: 'doc-hash',
    tableOfContents: [],
    components: [component71, component72],
    sections: [component71, component72],
    notes: [],
  };
  return {
    schemaVersion: 1,
    id: 'nb-test-corpus',
    manifestId: 'nb-test-corpus-manifest',
    createdAt: '2026-01-01T00:00:00.000Z',
    documents: [document],
    relationships: [],
    sourceHashes: { 'doc-registry-act': 'doc-hash' },
  };
};

/* ------------------------------- unit jobs ------------------------------- */

const approvedGroupFor = (sourceKey: string) => {
  const evidenceText = sourceKey === SOURCE_71 ? [SENTENCE_71_1, SENTENCE_71_2] : [SENTENCE_72];
  const title =
    sourceKey === SOURCE_71
      ? 'Surveyor written-objection delivery to the Registrar General'
      : 'Surveyor survey-commencement approval condition';
  return {
    groupId: `group-${sourceKey}`,
    titleSuggestion: title,
    sourceKeys: [sourceKey],
    focusSelections: [{ sourceKey, evidenceText }],
    reason: 'The source states the authoring rule for this unit.',
    approximateLearningGoal: `State the rule in ${sourceKey}.`,
  };
};

const unitJobFor = (runId: string, sourceKey: string): AiUnitAuthoringJob => {
  const text = sourceKey === SOURCE_71 ? TEXT_71 : TEXT_72;
  const group = approvedGroupFor(sourceKey);
  return {
    schemaVersion: 1,
    jobId: sourceKey === SOURCE_71 ? JOB_71 : JOB_72,
    runId,
    promptSpecVersion: UNIT_AUTHORING_V4_SPEC_VERSION,
    sourceMapRunId: 'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342',
    sourceMapProposalId: 'ai-map-2026-08-29T12-23-57-891Z:map-test',
    corpusContentHash: 'job-corpus-hash-71',
    frozenMapPriority: 'P3',
    inputHash: sourceKey === SOURCE_71 ? 'input-hash-71' : 'input-hash-72',
    document: {
      documentId: 'doc-registry-act',
      title: 'Registry Act',
      citation: 'Chapter R-6',
      type: 'act',
    },
    approvedGroup: group,
    mapDisposition: 'standalone',
    mapReason: 'One self-contained rule.',
    approximateLearningGoal: group.approximateLearningGoal,
    group,
    sourceHashes: { [sourceKey]: hashText(text) },
    sourceStatuses: { [sourceKey]: 'current' },
    contentFlagsBySourceKey: { [sourceKey]: {} },
    exactSourceText: text,
    operativeSourceText: text,
    sourceMetadata: {},
    context: { omittedContextWarnings: [] },
  };
};

/* ------------------------------ model payloads ------------------------------ */

const validPayloadFor = (sourceKey: string): Record<string, unknown> => {
  if (sourceKey === SOURCE_71) {
    return {
      title: 'Surveyor written-objection delivery to the Registrar General',
      mainQuestion:
        'What written-objection delivery duty does a surveyor owe to the Registrar General before a hearing?',
      studySummary:
        'This unit covers the surveyor duty to deliver a written objection to the Registrar General before the hearing, and the Registrar General discretion to waive a prescribed form requirement for that objection.',
      objectives: [
        {
          id: 'obj-71-1',
          type: 'duty',
          objective: 'Recall the surveyor written-objection delivery duty before the hearing.',
          guidedQuestion:
            'By when must a surveyor deliver a written objection to the Registrar General?',
          studyAnswer: SENTENCE_71_1,
          required: true,
          sourceKeys: [SOURCE_71],
          evidence: [{ sourceKey: SOURCE_71, evidenceText: SENTENCE_71_1 }],
          confidence: 'high',
        },
        {
          id: 'obj-71-2',
          type: 'duty',
          objective:
            'Recall the Registrar General discretion to waive a prescribed form requirement for the written objection.',
          guidedQuestion:
            'When may the Registrar General waive a prescribed form requirement for the written objection?',
          studyAnswer: SENTENCE_71_2,
          required: true,
          sourceKeys: [SOURCE_71],
          evidence: [{ sourceKey: SOURCE_71, evidenceText: SENTENCE_71_2 }],
          confidence: 'high',
        },
      ],
      relatedSourceKeys: [],
      studyNotes: [],
      sourceCoverage: [],
      authoringStatus: 'generated',
      confidence: 'high',
      warnings: [],
    };
  }
  return {
    title: 'Surveyor survey-commencement approval condition',
    mainQuestion: 'What condition must be satisfied before a surveyor commences a survey?',
    studySummary:
      'This unit covers the prohibition on commencing a survey before the Registrar General approves the plan.',
    objectives: [
      {
        id: 'obj-72-1',
        type: 'prohibition',
        objective:
          'Recall that a surveyor must not commence a survey before the Registrar General approves the plan.',
        guidedQuestion: 'Before what approval must a surveyor wait to commence a survey?',
        studyAnswer: SENTENCE_72,
        required: true,
        sourceKeys: [SOURCE_72],
        evidence: [{ sourceKey: SOURCE_72, evidenceText: SENTENCE_72 }],
        confidence: 'high',
      },
    ],
    relatedSourceKeys: [],
    studyNotes: [],
    sourceCoverage: [],
    authoringStatus: 'generated',
    confidence: 'high',
    warnings: [],
  };
};

/* --------------------------------- fixtures --------------------------------- */

const writeText = (path: string, text: string): void => {
  mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  writeFileSync(path, text);
};

const writePackage = (fixture: Fixture): void => {
  writeText(fixture.packagePath, `${JSON.stringify(buildPackage(), null, 2)}\n`);
};

const writeUnitRun = (
  fixture: Fixture,
  jobs: AiUnitAuthoringJob[],
  runOverrides: Record<string, unknown> = {},
): void => {
  const runDir = fixture.runDir;
  mkdirSync(join(runDir, 'jobs'), { recursive: true });
  writeFileSync(
    join(runDir, 'run.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId: fixture.runId,
        createdAt: '2026-09-02T00:00:00.000Z',
        updatedAt: '2026-09-02T00:00:00.000Z',
        providerKind: 'local-openai-compatible',
        jobType: 'unit-authoring',
        promptSpecVersion: UNIT_AUTHORING_V4_SPEC_VERSION,
        corpusContentHash: 'run-corpus-hash',
        sourcePackageId: 'nb-test-corpus',
        status: 'prepared',
        jobCount: jobs.length,
        completedCount: 0,
        invalidCount: 0,
        ...runOverrides,
      },
      null,
      2,
    )}\n`,
  );
  jobs.forEach((job, index) => {
    const file = join(runDir, 'jobs', `batch-${String(index + 1).padStart(3, '0')}.jobs.jsonl`);
    mkdirSync(join(runDir, 'jobs'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(job)}\n`);
  });
};

const okResponse = (value: unknown): Pick<Response, 'ok' | 'status' | 'json' | 'text'> => ({
  ok: true,
  status: 200,
  json: async () => value,
  text: async () => '',
});

type FetchLike = NonNullable<Parameters<typeof runLocalUnitAuthoring>[1]>;

const chatResponseFor = (job: AiUnitAuthoringJob): ReturnType<FetchLike> =>
  Promise.resolve(okResponse({ choices: [{ message: { content: JSON.stringify(validPayloadFor(job.approvedGroup.sourceKeys[0] ?? '')) } }] }));

const resultsFileFor = (fixture: Fixture): string =>
  join(fixture.runDir, 'results', LOCAL_UNIT_RESULTS_FILE);

const readResults = (fixture: Fixture): Array<Record<string, unknown>> => {
  const path = resultsFileFor(fixture);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const readJsonLines = (path: string): Array<Record<string, unknown>> =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];

type UnitTestOptions = Partial<Parameters<typeof runLocalUnitAuthoring>[0]>;

const unitOptions = (fixture: Fixture, extra: UnitTestOptions = {}): Parameters<typeof runLocalUnitAuthoring>[0] => ({
  runId: fixture.runId,
  model: MODEL,
  baseUrl: 'http://mock/v1',
  package: fixture.packagePath,
  resume: true,
  concurrency: 1,
  maxRetries: 1,
  timeoutMs: 2000,
  maxProviderAttempts: 3,
  providerRecoveryTimeoutMs: 100,
  providerRecoveryPollMs: 5,
  noHealthPreflight: true,
  unsafeUnstructured: false,
  dryRun: false,
  runsDir: fixture.root,
  ...extra,
});

describe('study_ai_local_unit_author runner', () => {
  it('accepts a valid unit proposal end to end and stamps every runner-owned field', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job = unitJobFor(RUN_ID, SOURCE_71);
    writeUnitRun(fixture, [job]);
    const calls: string[] = [];
    const fetchMock: FetchLike = async (input) => {
      calls.push(input);
      if (input.endsWith('/models')) return okResponse({ data: [{ id: MODEL }] });
      return chatResponseFor(job);
    };
    const result = await runLocalUnitAuthoring(
      unitOptions(fixture, { noHealthPreflight: false }),
      fetchMock,
    );
    expect(result).toMatchObject({ accepted: 1, semanticFailed: 0, skipped: 0, providerIncomplete: 0 });
    expect(calls[0]).toContain('/models');
    expect(calls[1]).toContain('/chat/completions');

    const rows = readResults(fixture);
    expect(rows).toHaveLength(1);
    const stored = rows[0];
    expect(stored.proposalId).toBe(job.jobId);
    expect(stored.runId).toBe(RUN_ID);
    expect(stored.suggestedPriority).toBe('P3');
    expect(stored.corpusContentHash).toBe(job.corpusContentHash);
    expect(stored.sourceDocumentId).toBe('doc-registry-act');
    expect(stored.sourceKeys).toEqual([SOURCE_71]);
    expect(stored.sourceHashes).toEqual({ [SOURCE_71]: hashText(TEXT_71) });
    expect(stored.approvedGroup).toEqual(job.approvedGroup);
    expect(stored.mapDisposition).toBe(job.mapDisposition);
    expect(stored.mapReason).toBe(job.mapReason);
    expect(stored.approximateLearningGoal).toBe(job.approximateLearningGoal);
    const generation = stored.generationMetadata as Record<string, unknown>;
    expect(generation).toMatchObject({
      providerKind: 'local-openai-compatible',
      promptSpecVersion: UNIT_AUTHORING_V4_SPEC_VERSION,
      sourceJobId: job.jobId,
      sourceJobInputHash: job.inputHash,
      rawResultFile: LOCAL_UNIT_RESULTS_FILE,
    });
    expect(typeof generation.generatedAt).toBe('string');
    expect(stored.objectives).toHaveLength(2);
    expect(stored.title).toBe(validPayloadFor(SOURCE_71).title);

    expect(existsSync(join(fixture.runDir, 'results', `${job.jobId}.provenance.json`))).toBe(true);
    expect(existsSync(join(fixture.runDir, 'reports', 'local-run-metadata.json'))).toBe(true);
    const provenance = JSON.parse(
      readFileSync(join(fixture.runDir, 'results', `${job.jobId}.provenance.json`), 'utf8'),
    ) as Record<string, unknown>;
    expect(provenance.accepted).toBe(true);
    expect(provenance.proposalId).toBe(job.jobId);
  });

  it('overrides bogus runner-owned identity the model payload may carry', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job = unitJobFor(RUN_ID, SOURCE_71);
    writeUnitRun(fixture, [job]);
    const payload = {
      ...validPayloadFor(SOURCE_71),
      schemaVersion: 99,
      proposalId: 'bogus-proposal-id',
      runId: 'bogus-run-id',
      corpusContentHash: 'bogus-corpus',
      sourceKeys: ['section:999'],
      sourceHashes: { 'section:999': 'bogus-hash' },
      suggestedPriority: 'P1',
      generationMetadata: { providerKind: 'external-codex', sourceJobId: 'bogus-job' },
    };
    const fetchMock: FetchLike = async (_input) =>
      Promise.resolve(okResponse({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
    const result = await runLocalUnitAuthoring(unitOptions(fixture, { unsafeUnstructured: true }), fetchMock);
    expect(result.accepted).toBe(1);
    const [stored] = readResults(fixture);
    expect(stored.proposalId).toBe(job.jobId);
    expect(stored.runId).toBe(RUN_ID);
    expect(stored.suggestedPriority).toBe('P3');
    expect(stored.corpusContentHash).toBe(job.corpusContentHash);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.sourceKeys).toEqual([SOURCE_71]);
    expect((stored.generationMetadata as Record<string, unknown>).providerKind).toBe(
      'local-openai-compatible',
    );
  });

  it('marks a job semantically failed after all attempts with numbered failure artifacts', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job = unitJobFor(RUN_ID, SOURCE_71);
    writeUnitRun(fixture, [job]);
    const bodies: Array<{ messages: Array<{ content: string }> }> = [];
    const fetchMock: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(init.body ?? '') as { messages: Array<{ content: string }> });
      return Promise.resolve(
        okResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'only a title',
                  mainQuestion: '',
                  objectives: [],
                  confidence: 'high',
                  warnings: [],
                }),
              },
            },
          ],
        }),
      );
    };
    const result = await runLocalUnitAuthoring(unitOptions(fixture, { maxRetries: 1 }), fetchMock);
    expect(result.semanticFailed).toBe(1);
    expect(result.accepted).toBe(0);
    expect(bodies).toHaveLength(2);
    const retryMessage = bodies[1].messages.map((message) => message.content).join(' ');
    expect(retryMessage).toContain('OBJECTIVES_REQUIRED');
    expect(readResults(fixture)).toHaveLength(0);
    const failureDir = join(fixture.runDir, 'local-failures', job.jobId);
    expect(existsSync(join(failureDir, 'attempt-1.raw.json'))).toBe(true);
    expect(existsSync(join(failureDir, 'attempt-1.validation.json'))).toBe(true);
    expect(existsSync(join(failureDir, 'attempt-2.raw.json'))).toBe(true);
    const validation = JSON.parse(
      readFileSync(join(failureDir, 'attempt-2.validation.json'), 'utf8'),
    ) as { issues: string[]; accepted: boolean };
    expect(validation.issues.length).toBeGreaterThan(0);
    expect(validation.accepted).toBe(false);
  });

  it('aborts the run on an unrecoverable provider failure and preserves prior accepted results', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job71 = unitJobFor(RUN_ID, SOURCE_71);
    const job72 = unitJobFor(RUN_ID, SOURCE_72);
    writeUnitRun(fixture, [job71, job72]);
    let chatCalls = 0;
    const fetchMock: FetchLike = async (_input, init) => {
      if (init.method === 'GET') return okResponse({ data: [{ id: MODEL }] });
      chatCalls += 1;
      if (chatCalls === 1) return chatResponseFor(job71);
      throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
    };
    const result = await runLocalUnitAuthoring(
      unitOptions(fixture, { maxProviderAttempts: 1 }),
      fetchMock,
    );
    expect(result.accepted).toBe(1);
    expect(result.providerIncomplete).toBe(1);
    expect(result.semanticFailed).toBe(0);
    expect(result.providerAbort).toBeDefined();
    expect(result.providerAbort?.code).toBe('PROVIDER_SOCKET_ERROR');
    expect(result.providerAbort?.jobId).toBe(job72.jobId);
    const rows = readResults(fixture);
    expect(rows).toHaveLength(1);
    expect(rows[0].proposalId).toBe(job71.jobId);
    const events = readJsonLines(join(fixture.runDir, 'reports', 'provider-events.jsonl'));
    expect(events.length).toBeGreaterThan(0);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.runAborted).toBe(true);
    expect(lastEvent.recovered).toBe(false);
    expect(lastEvent.jobId).toBe(job72.jobId);
    expect(lastEvent.code).toBe('PROVIDER_SOCKET_ERROR');
  });

  it('skips an already accepted job on resume without any provider call', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job = unitJobFor(RUN_ID, SOURCE_71);
    writeUnitRun(fixture, [job]);
    const firstFetch: FetchLike = async () => chatResponseFor(job);
    const first = await runLocalUnitAuthoring(unitOptions(fixture), firstFetch);
    expect(first.accepted).toBe(1);
    expect(readResults(fixture)).toHaveLength(1);

    const calls: string[] = [];
    const neverFetch: FetchLike = async (input) => {
      calls.push(input);
      throw new Error('provider must not be called during resume skip');
    };
    const second = await runLocalUnitAuthoring(unitOptions(fixture), neverFetch);
    expect(second.skipped).toBe(1);
    expect(second.accepted).toBe(0);
    expect(calls).toHaveLength(0);
    expect(readResults(fixture)).toHaveLength(1);
  });

  it('hard-aborts resume when a persisted accepted proposal no longer matches its job', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job = unitJobFor(RUN_ID, SOURCE_71);
    writeUnitRun(fixture, [job]);
    const acceptFetch: FetchLike = async () => chatResponseFor(job);
    await runLocalUnitAuthoring(unitOptions(fixture), acceptFetch);

    const path = resultsFileFor(fixture);
    const row = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>;
    row.suggestedPriority = 'P1';
    writeFileSync(path, `${JSON.stringify(row)}\n`);

    const neverFetch: FetchLike = async () => {
      throw new Error('provider must not be called');
    };
    await expect(runLocalUnitAuthoring(unitOptions(fixture), neverFetch)).rejects.toThrow(
      /suggestedPriority/,
    );
  });

  it('restricts the job list via --batch and --job in dry run', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job71 = unitJobFor(RUN_ID, SOURCE_71);
    const job72 = unitJobFor(RUN_ID, SOURCE_72);
    writeUnitRun(fixture, [job71, job72]);

    const neverFetch: FetchLike = async () => {
      throw new Error('dry run must not call the provider');
    };
    const batched = await runLocalUnitAuthoring(
      unitOptions(fixture, { batch: '002', dryRun: true }),
      neverFetch,
    );
    expect(batched.dryRunSummary?.selectedJobs).toBe(1);
    expect(batched.dryRunSummary?.firstJobIds).toEqual([job72.jobId]);

    const single = await runLocalUnitAuthoring(
      unitOptions(fixture, { jobId: job71.jobId, dryRun: true }),
      neverFetch,
    );
    expect(single.dryRunSummary?.selectedJobs).toBe(1);
    expect(single.dryRunSummary?.firstJobIds).toEqual([job71.jobId]);
  });

  it('dry run makes zero fetch calls and writes zero files', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    writeUnitRun(fixture, [unitJobFor(RUN_ID, SOURCE_71)]);
    let fetchCalls = 0;
    const fetchMock: FetchLike = async (_input, _init) => {
      fetchCalls += 1;
      return okResponse({ data: [] });
    };
    const result = await runLocalUnitAuthoring(unitOptions(fixture, { dryRun: true }), fetchMock);
    expect(result.dryRunSummary).toBeDefined();
    expect(result.dryRunSummary?.runId).toBe(RUN_ID);
    expect(result.dryRunSummary?.selectedJobs).toBe(1);
    expect(result.dryRunSummary?.firstJobIds).toHaveLength(1);
    expect(result.dryRunSummary?.promptSpecVersion).toBe(UNIT_AUTHORING_V4_SPEC_VERSION);
    expect(result.dryRunSummary?.promptSha256).toHaveLength(64);
    expect(fetchCalls).toBe(0);
    expect(existsSync(join(fixture.runDir, 'results'))).toBe(false);
    expect(existsSync(join(fixture.runDir, 'local-failures'))).toBe(false);
    expect(existsSync(join(fixture.runDir, 'reports'))).toBe(false);
    const before = [join(fixture.runDir, 'run.json'), join(fixture.runDir, 'jobs')];
    before.forEach((path) => expect(existsSync(path)).toBe(true));
  });

  it('fails closed on a study-map run.json before any provider call or write', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    writeUnitRun(fixture, [unitJobFor(RUN_ID, SOURCE_71)], { jobType: 'study-map' });
    let fetchCalls = 0;
    const fetchMock: FetchLike = async () => {
      fetchCalls += 1;
      return okResponse({ data: [] });
    };
    await expect(runLocalUnitAuthoring(unitOptions(fixture), fetchMock)).rejects.toThrow(/jobType/);
    expect(fetchCalls).toBe(0);
    expect(existsSync(join(fixture.runDir, 'reports'))).toBe(false);
    expect(existsSync(join(fixture.runDir, 'results'))).toBe(false);
  });
});

describe('study_ai_local_unit_author configuration', () => {
  it('exposes the model-owned schema fields and excludes runner-owned identity fields', () => {
    const properties = Object.keys(UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA.properties as Record<string, unknown>).sort();
    expect(properties).toEqual([...UNIT_AUTHORING_V4_MODEL_FIELDS].sort());
    expect(UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA.required).toEqual(
      expect.arrayContaining([
        'title',
        'mainQuestion',
        'studySummary',
        'objectives',
        'authoringStatus',
        'confidence',
        'warnings',
      ]),
    );
    const runnerOwned = [
      'schemaVersion',
      'proposalId',
      'runId',
      'corpusContentHash',
      'sourceDocumentId',
      'sourceKeys',
      'sourceHashes',
      'approvedGroup',
      'mapDisposition',
      'mapReason',
      'approximateLearningGoal',
      'suggestedPriority',
      'generationMetadata',
    ];
    runnerOwned.forEach((field) => expect(properties).not.toContain(field));
    expect(UNIT_AUTHORING_V4_LOCAL_RESULT_SCHEMA.additionalProperties).toBe(false);
  });

  it('parses CLI/env configuration with the local-unit defaults', () => {
    const fromCli = optionsFromArgs(
      { run: 'run-a', model: 'cli-model' },
      {},
    );
    expect(fromCli.runId).toBe('run-a');
    expect(fromCli.model).toBe('cli-model');
    expect(fromCli.baseUrl).toBe('http://127.0.0.1:8080/v1');
    expect(fromCli.maxRetries).toBe(2);
    expect(fromCli.concurrency).toBe(1);
    expect(fromCli.package).toContain('nb-sit-statute-corpus.content-package.json');
    expect(fromCli.noHealthPreflight).toBe(false);

    const fromEnv = optionsFromArgs({}, {
      STUDY_AI_MODEL: 'env-model',
      STUDY_AI_BASE_URL: 'http://127.0.0.1:9000/v1',
    });
    expect(fromEnv.model).toBe('env-model');
    expect(fromEnv.baseUrl).toBe('http://127.0.0.1:9000/v1');
    expect(fromEnv.modelSource).toBe('env');
    expect(fromEnv.baseUrlSource).toBe('env');
  });

  it('documents the runner surface in the help text', () => {
    expect(LOCAL_UNIT_AUTHOR_HELP).toContain('--dry-run');
    expect(LOCAL_UNIT_AUTHOR_HELP).toContain('--no-health-preflight');
    expect(LOCAL_UNIT_AUTHOR_HELP).toContain(LOCAL_UNIT_RESULTS_FILE);
    expect(LOCAL_UNIT_AUTHOR_HELP).toContain('unit-authoring-v4');
    expect(UNIT_AUTHORING_V4_SPEC_PATH).toBe('study-content/ai/specs/unit-authoring-v4.md');
  });
});

type ChatRequestBody = { messages: Array<{ role: string; content: string }> };

/** sha256 of the v4 system prompt as composed before v5 support (byte pin). */
const LEGACY_V4_SYSTEM_PROMPT_SHA256 =
  '7b0360e62d285282d7bf87d428628be629ffb8d73823d1e1dbcd58ffe4dff51c';

const specSha256Of = (path: string): string => hashText(readFileSync(path, 'utf8'));

describe('study_ai_local_unit_author v5 support', () => {
  it('accepts a synthetic unit-authoring-v5 run end to end and pins v5 spec provenance', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job = {
      ...unitJobFor(RUN_ID, SOURCE_71),
      jobId: 'unit-test-v5-1',
      promptSpecVersion: UNIT_AUTHORING_V5_SPEC_VERSION,
    };
    writeUnitRun(fixture, [job], { promptSpecVersion: UNIT_AUTHORING_V5_SPEC_VERSION });
    const bodies: ChatRequestBody[] = [];
    const fetchMock: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(init.body ?? '{}') as ChatRequestBody);
      return chatResponseFor(job);
    };
    const result = await runLocalUnitAuthoring(unitOptions(fixture), fetchMock);
    expect(result).toMatchObject({ accepted: 1, semanticFailed: 0, skipped: 0, providerIncomplete: 0 });

    const system = bodies[0]?.messages.find((message) => message.role === 'system')?.content ?? '';
    const v5Sha = specSha256Of(UNIT_AUTHORING_V5_SPEC_PATH);
    const v4Sha = specSha256Of(UNIT_AUTHORING_V4_SPEC_PATH);
    expect(system).toContain(UNIT_AUTHORING_V5_SPEC_PATH);
    expect(system).toContain(v5Sha);
    expect(system).not.toContain(v4Sha);

    const [stored] = readResults(fixture);
    expect((stored.generationMetadata as Record<string, unknown>).promptSpecVersion).toBe(
      UNIT_AUTHORING_V5_SPEC_VERSION,
    );
    const metadata = JSON.parse(
      readFileSync(join(fixture.runDir, 'reports', 'local-run-metadata.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(metadata.promptSpecVersion).toBe(UNIT_AUTHORING_V5_SPEC_VERSION);
    expect(metadata.promptSha256).toBe(v5Sha);
    expect(UNIT_AUTHORING_V5_SPEC_PATH).toBe('study-content/ai/specs/unit-authoring-v5.md');
  });

  it('keeps the v4 system prompt byte-identical (legacy prompt sha pinned)', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const job = unitJobFor(RUN_ID, SOURCE_71);
    writeUnitRun(fixture, [job]);
    const bodies: ChatRequestBody[] = [];
    const fetchMock: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(init.body ?? '{}') as ChatRequestBody);
      return chatResponseFor(job);
    };
    const result = await runLocalUnitAuthoring(unitOptions(fixture), fetchMock);
    expect(result.accepted).toBe(1);
    const system = bodies[0]?.messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system.length).toBeGreaterThan(0);
    expect(hashText(system)).toBe(LEGACY_V4_SYSTEM_PROMPT_SHA256);
  });

  it('fails closed on an unsupported run promptSpecVersion, naming the offending value', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    writeUnitRun(fixture, [unitJobFor(RUN_ID, SOURCE_71)], {
      promptSpecVersion: 'unit-authoring-v6',
    });
    const neverFetch: FetchLike = async () => {
      throw new Error('provider must not be called');
    };
    const error = await runLocalUnitAuthoring(unitOptions(fixture, { dryRun: true }), neverFetch)
      .then(() => null)
      .catch((caught: unknown) => caught as Error);
    expect(error?.message).toContain('unit-authoring-v6');
    expect(error?.message).toContain('unit-authoring-v4 | unit-authoring-v5');
  });

  it('fails closed when a v5 run carries a v4 job, naming the offending job', async () => {
    const fixture = useFixture();
    writePackage(fixture);
    const v4Job = unitJobFor(RUN_ID, SOURCE_71);
    writeUnitRun(fixture, [v4Job], { promptSpecVersion: UNIT_AUTHORING_V5_SPEC_VERSION });
    const neverFetch: FetchLike = async () => {
      throw new Error('provider must not be called');
    };
    const error = await runLocalUnitAuthoring(unitOptions(fixture, { dryRun: true }), neverFetch)
      .then(() => null)
      .catch((caught: unknown) => caught as Error);
    expect(error?.message).toContain(JOB_71);
    expect(error?.message).toContain('unit-authoring-v4');
    expect(error?.message).toContain('unit-authoring-v5');
  });

  it('documents both supported spec versions in the help text', () => {
    expect(LOCAL_UNIT_AUTHOR_HELP).toContain('unit-authoring-v4 | unit-authoring-v5');
  });
});
