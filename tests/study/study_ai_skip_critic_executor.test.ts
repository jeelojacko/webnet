import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AiStudyMapJob } from '../../src/study/ai/studyAiTypes';
import { runSkipCriticJob, runSkipCriticJobs } from '../../src/study/ai/studyAiSkipCriticExecutor';
import type {
  SkipCriticTransport,
  SkipCriticTransportResponse,
} from '../../src/study/ai/studyAiSkipCriticRunner';
import type { SkipCriticResult } from '../../src/study/ai/studyAiSkipCriticTypes';

const jobFixture = (overrides: Partial<AiStudyMapJob> = {}): AiStudyMapJob => {
  const text = '10 A person shall file a notice within 30 days.';
  return {
    schemaVersion: 1,
    jobId: 'critic-exec-job',
    runId: 'critic-exec-run',
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
      sourceFocusOptions: [
        { sourceKey: 'section:10', label: '10', childLabels: ['10(1)', '10(2)'] },
      ],
      sourceHashes: { 'section:10': 'source-hash' },
    },
    context: {},
    authoringInputFingerprint: 'fingerprint',
    ...overrides,
  };
};

const options = {
  model: 'mock-critic-model',
  baseUrl: 'http://mock/v1',
  timeoutMs: 1234,
};

const resultFixture = (
  overrides: Partial<SkipCriticResult> & Pick<SkipCriticResult, 'decision'>,
): SkipCriticResult => ({
  schemaVersion: 1,
  confidence: 'high',
  detectedStudyValue: [],
  reason: 'The target contains no useful study value.',
  warnings: [],
  ...overrides,
});

const acceptedResult = resultFixture({ decision: 'skip-supported' });

const completedResponse = (content: unknown): SkipCriticTransportResponse => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => '',
});

type ScriptedStep = { kind: 'result'; content?: unknown } | { kind: 'throw'; message: string };

const scriptedTransport = (steps: ScriptedStep[]) => {
  const calls: { url: string; body: string }[] = [];
  let next = 0;
  const transport: SkipCriticTransport = async (url: string, init: { body: string }) => {
    const step = steps[Math.min(next, steps.length - 1)];
    next += 1;
    calls.push({ url, body: init.body });
    if (step.kind === 'throw') throw new Error(step.message);
    return completedResponse(step.content ?? JSON.stringify(acceptedResult));
  };
  return { calls, transport, count: () => next };
};

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const makeRunDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'skip-critic-exec-'));
  tempDirs.push(dir);
  return dir;
};

const criticResultsPath = (runsDir: string): string =>
  join(runsDir, 'critic-exec-run', 'critic', 'skip-critic.results.jsonl');
const criticProvenancePath = (runsDir: string): string =>
  join(runsDir, 'critic-exec-run', 'critic', 'critic-exec-job.provenance.json');
const criticTerminalFailurePath = (runsDir: string): string =>
  join(runsDir, 'critic-exec-run', 'critic', 'critic-exec-job.terminal-failure.json');
const criticFailureAttemptPaths = (runsDir: string, attempt: number): [string, string] => [
  join(
    runsDir,
    'critic-exec-run',
    'critic',
    'failures',
    'critic-exec-job',
    `attempt-${attempt}.raw.json`,
  ),
  join(
    runsDir,
    'critic-exec-run',
    'critic',
    'failures',
    'critic-exec-job',
    `attempt-${attempt}.validation.json`,
  ),
];
const normalResultsPath = (runsDir: string): string =>
  join(runsDir, 'critic-exec-run', 'results', 'local-map.results.jsonl');
const normalProvenancePath = (runsDir: string): string =>
  join(runsDir, 'critic-exec-run', 'results', 'critic-exec-job.provenance.json');

const writeFile = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const jsonlRows = (runsDir: string): Record<string, unknown>[] =>
  readFileSync(criticResultsPath(runsDir), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const TIMESTAMP = '2026-01-01T00:00:00.000Z';

describe('Skip Critic V1 executor: artifacts and provenance', () => {
  it('persists result and provenance on an accepted result', async () => {
    const runsDir = makeRunDir();
    const { transport, count } = scriptedTransport([{ kind: 'result' }]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(1);
    expect(report.outcome).toEqual({
      status: 'success',
      reused: false,
      result: acceptedResult,
      attempts: 1,
    });
    expect(report.previouslyTerminalFailed).toBe(false);
    const rows = jsonlRows(runsDir);
    expect(rows).toHaveLength(1);
    expect(rows[0].jobId).toBe('critic-exec-job');
    expect(rows[0].result).toEqual(acceptedResult);
    const provenance = readJson<Record<string, unknown>>(criticProvenancePath(runsDir));
    expect(provenance).toMatchObject({
      schemaVersion: 1,
      artifactKind: 'skip-critic-v1-provenance',
      status: 'success',
      attempts: 1,
      maxAttempts: 3,
      timestamp: TIMESTAMP,
    });
    expect(provenance).not.toHaveProperty('terminalFailure');
  });

  it('keeps the model-authored result free of runner metadata', async () => {
    const runsDir = makeRunDir();
    const { transport } = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    const stored = jsonlRows(runsDir)[0].result as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      'confidence',
      'decision',
      'detectedStudyValue',
      'reason',
      'schemaVersion',
      'warnings',
    ]);
    expect(stored).not.toHaveProperty('jobId');
    expect(stored).not.toHaveProperty('runId');
    expect(stored).not.toHaveProperty('attempts');
    expect(stored).not.toHaveProperty('timestamp');
  });

  it('records stable job/input/model identity in provenance', async () => {
    const runsDir = makeRunDir();
    const { transport } = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    const provenance = readJson<Record<string, unknown>>(criticProvenancePath(runsDir));
    expect(provenance.runId).toBe('critic-exec-run');
    expect(provenance.jobId).toBe('critic-exec-job');
    expect(provenance.corpusContentHash).toBe('corpus-hash');
    expect(provenance.inputHash).toBe('input-hash');
    expect(typeof provenance.authoringInputFingerprint).toBe('string');
    expect((provenance.authoringInputFingerprint as string).length).toBe(64);
    expect(provenance.promptSpecVersion).toBe('study-map-v3');
    expect(provenance.criticSchemaVersion).toBe(1);
    expect((provenance.responseSchemaSha256 as string).length).toBe(64);
    expect((provenance.systemPromptSha256 as string).length).toBe(64);
    expect(provenance.modelId).toBe('mock-critic-model');
    expect(provenance.baseUrl).toBe('http://mock/v1');
    expect(provenance.providerKind).toBe('local-openai-compatible');
    expect(provenance.timeoutMs).toBe(1234);
  });

  it('never persists the API key or Authorization value', async () => {
    const runsDir = makeRunDir();
    const { transport } = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, apiKey: 'super-secret-key-123' },
      transport,
      () => TIMESTAMP,
    );
    const written = [
      readFileSync(criticResultsPath(runsDir), 'utf8'),
      readFileSync(criticProvenancePath(runsDir), 'utf8'),
    ].join('\n');
    expect(written).not.toContain('super-secret-key-123');
    expect(written).not.toContain('Authorization');
  });

  it('does not modify normal Study Map result/provenance artifacts', async () => {
    const runsDir = makeRunDir();
    const normalResults = normalResultsPath(runsDir);
    const normalProvenance = normalProvenancePath(runsDir);
    writeFile(
      normalResults,
      `${JSON.stringify({ schemaVersion: 1, jobId: 'critic-exec-job', disposition: 'skip' })}\n`,
    );
    writeFile(normalProvenance, `${JSON.stringify({ modelId: 'normal-author-model' })}\n`);
    const beforeResults = readFileSync(normalResults, 'utf8');
    const beforeProvenance = readFileSync(normalProvenance, 'utf8');
    const { transport } = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    expect(readFileSync(normalResults, 'utf8')).toBe(beforeResults);
    expect(readFileSync(normalProvenance, 'utf8')).toBe(beforeProvenance);
  });
});

describe('Skip Critic V1 executor: resume', () => {
  it('reuses a valid completed result without another transport call', async () => {
    const runsDir = makeRunDir();
    const first = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      first.transport,
      () => TIMESTAMP,
    );
    const second = scriptedTransport([{ kind: 'result' }]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      second.transport,
      () => TIMESTAMP,
    );
    expect(second.count()).toBe(0);
    expect(report.outcome).toEqual({
      status: 'success',
      reused: true,
      result: acceptedResult,
      attempts: 0,
    });
  });

  it('makes zero model calls when resuming a valid completed job via the batch API', async () => {
    const runsDir = makeRunDir();
    const first = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJobs(
      [jobFixture()],
      { ...options, runsDir: runsDir },
      first.transport,
      () => TIMESTAMP,
    );
    const second = scriptedTransport([{ kind: 'result' }]);
    const summary = await runSkipCriticJobs(
      [jobFixture()],
      { ...options, runsDir: runsDir },
      second.transport,
      () => TIMESTAMP,
    );
    expect(second.count()).toBe(0);
    expect(summary).toEqual({
      total: 1,
      success: 1,
      reused: 1,
      failed: 0,
      reports: summary.reports,
    });
    expect(summary.reports[0].outcome.status).toBe('success');
  });

  it('does not reuse a result row missing provenance', async () => {
    const runsDir = makeRunDir();
    writeFile(
      criticResultsPath(runsDir),
      `${JSON.stringify({ jobId: 'critic-exec-job', result: acceptedResult })}\n`,
    );
    const { transport, count } = scriptedTransport([{ kind: 'result' }]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(1);
    expect(report.outcome.status).toBe('success');
    if (report.outcome.status === 'success') expect(report.outcome.reused).toBe(false);
  });

  it('does not reuse a malformed result artifact as success', async () => {
    const runsDir = makeRunDir();
    writeFile(criticResultsPath(runsDir), 'not-json-at-all');
    const { transport, count } = scriptedTransport([{ kind: 'result' }]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(1);
    expect(report.outcome.status).toBe('success');
    if (report.outcome.status === 'success') expect(report.outcome.reused).toBe(false);
  });

  it('does not reuse a result row whose stored result fails validation', async () => {
    const runsDir = makeRunDir();
    const invalid = resultFixture({
      decision: 'skip-supported',
      detectedStudyValue: [
        { category: 'duty', sourceKey: 'section:99', childLabels: ['x'], summary: 's' },
      ],
    });
    writeFile(
      criticResultsPath(runsDir),
      `${JSON.stringify({ jobId: 'critic-exec-job', result: invalid })}\n`,
    );
    const { transport, count } = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(1);
  });

  it('does not reuse when the job/input identity mismatches', async () => {
    const runsDir = makeRunDir();
    const first = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      first.transport,
      () => TIMESTAMP,
    );
    const changed = jobFixture({ corpusContentHash: 'other-corpus-hash' });
    const second = scriptedTransport([{ kind: 'result' }]);
    const report = await runSkipCriticJob(
      changed,
      { ...options, runsDir: runsDir },
      second.transport,
      () => TIMESTAMP,
    );
    expect(second.count()).toBe(1);
    expect(report.outcome.status).toBe('success');
    if (report.outcome.status === 'success') expect(report.outcome.reused).toBe(false);
  });

  it('does not treat an interrupted state (provenance without result row) as complete', async () => {
    const runsDir = makeRunDir();
    const done = scriptedTransport([{ kind: 'result' }]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      done.transport,
      () => TIMESTAMP,
    );
    // Simulate an interrupt: the results file is gone but the provenance remains.
    rmSync(criticResultsPath(runsDir));
    const second = scriptedTransport([{ kind: 'result' }]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      second.transport,
      () => TIMESTAMP,
    );
    expect(second.count()).toBe(1);
    expect(report.outcome.status).toBe('success');
    if (report.outcome.status === 'success') expect(report.outcome.reused).toBe(false);
  });
});

describe('Skip Critic V1 executor: bounded retry and terminal failure', () => {
  it('retries a transport failure exactly maxRetries more times', async () => {
    const runsDir = makeRunDir();
    const { transport, count } = scriptedTransport([
      { kind: 'throw', message: 'connection refused' },
      { kind: 'throw', message: 'connection refused' },
      { kind: 'result' },
    ]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, maxRetries: 2 },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(3);
    expect(report.outcome.status).toBe('success');
    if (report.outcome.status === 'success') {
      expect(report.outcome.attempts).toBe(3);
      expect(report.outcome.result).toEqual(acceptedResult);
    }
    const [rawPath, validationPath] = criticFailureAttemptPaths(runsDir, 1);
    expect(readFileSync(rawPath, 'utf8')).toContain('connection refused');
    expect(
      readJson<{ attempt: number; failure: { kind: string; message: string } }>(validationPath),
    ).toEqual({
      schemaVersion: 1,
      artifactKind: 'skip-critic-v1-attempt-failure',
      attempt: 1,
      failure: { kind: 'transport/provider', message: 'connection refused' },
    });
  });

  it('persists the accepted result with the total attempt count after later success', async () => {
    const runsDir = makeRunDir();
    const { transport } = scriptedTransport([
      { kind: 'throw', message: 'connection reset' },
      { kind: 'result' },
    ]);
    await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, maxRetries: 2 },
      transport,
      () => TIMESTAMP,
    );
    const rows = jsonlRows(runsDir);
    expect(rows[0].result).toEqual(acceptedResult);
    const provenance = readJson<{ attempts: number; maxAttempts: number; status: string }>(
      criticProvenancePath(runsDir),
    );
    expect(provenance.attempts).toBe(2);
    expect(provenance.maxAttempts).toBe(3);
    expect(provenance.status).toBe('success');
    expect(existsSync(criticTerminalFailurePath(runsDir))).toBe(false);
  });

  it('terminates explicitly on repeated transport failure and writes no fabricated result', async () => {
    const runsDir = makeRunDir();
    const { transport, count } = scriptedTransport([
      { kind: 'throw', message: 'connection refused' },
    ]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, maxRetries: 1 },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(2);
    expect(report.outcome).toEqual({
      status: 'failed',
      attempts: 2,
      lastFailure: { kind: 'transport/provider', message: 'connection refused' },
    });
    expect(existsSync(criticResultsPath(runsDir))).toBe(false);
    const terminal = readJson<Record<string, unknown>>(criticTerminalFailurePath(runsDir));
    expect(terminal.status).toBe('failed');
    expect(terminal.attempts).toBe(2);
    expect(terminal.maxAttempts).toBe(2);
    expect(terminal).not.toHaveProperty('result');
    expect(terminal.terminalFailure).toEqual({
      kind: 'transport/provider',
      message: 'connection refused',
    });
  });

  it('retries an invalid model result under the same bounded policy without repair', async () => {
    const runsDir = makeRunDir();
    const broken = resultFixture({ decision: 'skip-not-supported' });
    const { transport, count } = scriptedTransport([
      { kind: 'result', content: JSON.stringify(broken) },
      { kind: 'result', content: JSON.stringify(broken) },
      { kind: 'result' },
    ]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, maxRetries: 2 },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(3);
    expect(report.outcome.status).toBe('success');
    if (report.outcome.status === 'success') expect(report.outcome.attempts).toBe(3);
    const [, validationPath] = criticFailureAttemptPaths(runsDir, 1);
    const validation = readJson<{ failure: { kind: string; issues: string[] } }>(validationPath);
    expect(validation.failure.kind).toBe('invalid-result');
    expect(validation.failure.issues).toContain('SKIP_CRITIC_CROSS_ITEMS_REQUIRED');
  });

  it('terminates explicitly on repeated invalid results', async () => {
    const runsDir = makeRunDir();
    const broken = resultFixture({ decision: 'skip-not-supported' });
    const { transport, count } = scriptedTransport([
      { kind: 'result', content: JSON.stringify(broken) },
    ]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, maxRetries: 2 },
      transport,
      () => TIMESTAMP,
    );
    expect(count()).toBe(3);
    expect(report.outcome).toEqual({
      status: 'failed',
      attempts: 3,
      lastFailure: { kind: 'invalid-result', issues: ['SKIP_CRITIC_CROSS_ITEMS_REQUIRED'] },
    });
  });

  it('never interprets a terminal failure as skip-supported and re-executes on resume', async () => {
    const runsDir = makeRunDir();
    const broken = resultFixture({ decision: 'skip-not-supported' });
    const first = scriptedTransport([{ kind: 'result', content: JSON.stringify(broken) }]);
    const failedReport = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, maxRetries: 0 },
      first.transport,
      () => TIMESTAMP,
    );
    expect(failedReport.outcome.status).toBe('failed');
    expect(failedReport.outcome.status).not.toBe('success');
    const second = scriptedTransport([{ kind: 'result' }]);
    const retried = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir, maxRetries: 0 },
      second.transport,
      () => TIMESTAMP,
    );
    expect(second.count()).toBe(1);
    expect(retried.outcome.status).toBe('success');
    if (retried.outcome.status === 'success') {
      expect(retried.outcome.result.decision).toBe('skip-supported');
      expect(retried.outcome.reused).toBe(false);
    }
    expect(retried.previouslyTerminalFailed).toBe(true);
    expect(existsSync(criticTerminalFailurePath(runsDir))).toBe(false);
  });

  it('records a pre-existing terminal failure in the report without failing on it', async () => {
    const runsDir = makeRunDir();
    writeFile(criticTerminalFailurePath(runsDir), JSON.stringify({ status: 'failed' }));
    const { transport } = scriptedTransport([{ kind: 'result' }]);
    const report = await runSkipCriticJob(
      jobFixture(),
      { ...options, runsDir: runsDir },
      transport,
      () => TIMESTAMP,
    );
    expect(report.previouslyTerminalFailed).toBe(true);
    expect(report.outcome.status).toBe('success');
    expect(existsSync(criticTerminalFailurePath(runsDir))).toBe(false);
  });
});
