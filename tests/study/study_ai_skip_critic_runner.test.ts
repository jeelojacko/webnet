import { describe, expect, it } from 'vitest';
import type { AiStudyMapJob } from '../../src/study/ai/studyAiTypes';
import {
  buildSkipCriticInput,
  SKIP_CRITIC_SYSTEM_PROMPT,
} from '../../src/study/ai/studyAiSkipCriticInput';
import { SKIP_CRITIC_RESULT_SCHEMA } from '../../src/study/ai/studyAiSkipCriticContract';
import {
  runSkipCriticInference,
  type SkipCriticTransport,
  type SkipCriticTransportResponse,
} from '../../src/study/ai/studyAiSkipCriticRunner';
import type { SkipCriticResult } from '../../src/study/ai/studyAiSkipCriticTypes';

const jobFixture = (): AiStudyMapJob => {
  const text = '10 A person shall file a notice within 30 days.';
  return {
    schemaVersion: 1,
    jobId: 'critic-test-job',
    runId: 'critic-test-run',
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
  };
};

const options = { model: 'mock-critic-model', baseUrl: 'http://mock/v1' };

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

const groundedItem = (overrides: Partial<SkipCriticResult['detectedStudyValue'][number]> = {}) => ({
  category: 'duty' as const,
  sourceKey: 'section:10',
  childLabels: ['10(1)'],
  summary: 'Requires filing a notice within 30 days.',
  ...overrides,
});

const completedResponse = (content: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => '',
});

type CapturedRequest = { url: string; body: unknown };

const recordingTransport = (
  response: () => Promise<SkipCriticTransportResponse>,
): { calls: CapturedRequest[]; transport: SkipCriticTransport } => {
  const calls: CapturedRequest[] = [];
  const transport: SkipCriticTransport = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return response();
  };
  return { calls, transport };
};

describe('Skip Critic V1 standalone runner', () => {
  it('makes exactly one request with the critic system prompt and grounded input', async () => {
    const { calls, transport } = recordingTransport(async () =>
      completedResponse(JSON.stringify(resultFixture({ decision: 'skip-supported' }))),
    );
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('accepted');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://mock/v1/chat/completions');
    const body = calls[0].body as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string; json_schema: { strict: boolean; schema: unknown } };
    };
    expect(body.model).toBe('mock-critic-model');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: SKIP_CRITIC_SYSTEM_PROMPT });
    expect(JSON.parse(body.messages[1].content)).toEqual(buildSkipCriticInput(jobFixture()));
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toEqual(SKIP_CRITIC_RESULT_SCHEMA);
  });

  it('keeps the original author output out of the runner API and request', async () => {
    const { calls, transport } = recordingTransport(async () =>
      completedResponse(JSON.stringify(resultFixture({ decision: 'uncertain' }))),
    );
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('accepted');
    const userMessage = (calls[0].body as { messages: Array<{ content: string }> }).messages[1]
      .content;
    const parsed = JSON.parse(userMessage) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['context', 'permittedEvidence', 'schemaVersion', 'target'].sort(),
    );
    expect(userMessage).not.toContain('disposition');
    expect(userMessage).not.toContain('proposedGroups');
  });

  it('accepts a valid skip-supported result', async () => {
    const { transport } = recordingTransport(async () =>
      completedResponse(
        JSON.stringify(resultFixture({ decision: 'skip-supported', reason: 'Definitions only.' })),
      ),
    );
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome).toEqual({
      status: 'accepted',
      result: resultFixture({ decision: 'skip-supported', reason: 'Definitions only.' }),
    });
  });

  it('accepts a valid skip-not-supported result with a grounded study value', async () => {
    const expected = resultFixture({
      decision: 'skip-not-supported',
      detectedStudyValue: [
        groundedItem(),
        groundedItem({ sourceKey: 'section:10', childLabels: ['10(2)'] }),
      ],
    });
    const { transport } = recordingTransport(async () =>
      completedResponse(JSON.stringify(expected)),
    );
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome).toEqual({ status: 'accepted', result: expected });
  });

  it('accepts a valid uncertain result', async () => {
    const { transport } = recordingTransport(async () =>
      completedResponse(JSON.stringify(resultFixture({ decision: 'uncertain' }))),
    );
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('accepted');
    if (outcome.status === 'accepted') expect(outcome.result.decision).toBe('uncertain');
  });

  it('fails on malformed JSON', async () => {
    const { transport } = recordingTransport(async () => completedResponse('{"decision":'));
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('invalid-result');
    if (outcome.status === 'invalid-result') {
      expect(outcome.raw).toBe('{"decision":');
      expect(outcome.issues.map((issue) => issue.code)).toContain('SKIP_CRITIC_JSON_INVALID');
    }
  });

  it('fails on an empty model response', async () => {
    const { transport } = recordingTransport(async () => completedResponse(''));
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('invalid-result');
    if (outcome.status === 'invalid-result') {
      expect(outcome.raw).toBe('');
      expect(outcome.issues.map((issue) => issue.code)).toContain('SKIP_CRITIC_JSON_INVALID');
    }
  });

  it('fails on a structurally invalid critic object', async () => {
    const broken = resultFixture({ decision: 'skip-supported' });
    delete (broken as { schemaVersion?: number }).schemaVersion;
    const { transport } = recordingTransport(async () => completedResponse(broken));
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('invalid-result');
    if (outcome.status === 'invalid-result') {
      expect(outcome.issues.map((issue) => issue.code)).toContain('SKIP_CRITIC_SCHEMA_VERSION');
    }
  });

  it('fails on an unknown sourceKey', async () => {
    const broken = resultFixture({
      decision: 'skip-not-supported',
      detectedStudyValue: [groundedItem({ sourceKey: 'section:99' })],
    });
    const { transport } = recordingTransport(async () => completedResponse(broken));
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('invalid-result');
    if (outcome.status === 'invalid-result') {
      expect(outcome.issues.map((issue) => issue.code)).toContain(
        'SKIP_CRITIC_SOURCE_NOT_PERMITTED',
      );
    }
  });

  it('fails on an unknown childLabel', async () => {
    const broken = resultFixture({
      decision: 'skip-not-supported',
      detectedStudyValue: [groundedItem({ childLabels: ['10(7)'] })],
    });
    const { transport } = recordingTransport(async () => completedResponse(broken));
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('invalid-result');
    if (outcome.status === 'invalid-result') {
      expect(outcome.issues.map((issue) => issue.code)).toContain(
        'SKIP_CRITIC_CHILD_LABEL_NOT_FOUND',
      );
    }
  });

  it('fails on semantic contract violations without repair', async () => {
    const broken = resultFixture({ decision: 'skip-not-supported' });
    const { transport } = recordingTransport(async () => completedResponse(broken));
    const outcome = await runSkipCriticInference(jobFixture(), options, transport);
    expect(outcome.status).toBe('invalid-result');
    if (outcome.status === 'invalid-result') {
      expect(outcome.issues.map((issue) => issue.code)).toContain(
        'SKIP_CRITIC_CROSS_ITEMS_REQUIRED',
      );
    }
  });

  it('keeps transport and provider failures as explicit failures', async () => {
    const failing: SkipCriticTransport = async () => {
      throw new Error('connection refused');
    };
    const thrown = await runSkipCriticInference(jobFixture(), options, failing);
    expect(thrown).toEqual({ status: 'transport-failure', message: 'connection refused' });
    const httpError: SkipCriticTransport = async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('no body');
      },
      text: async () => 'bad gateway',
    });
    const rejected = await runSkipCriticInference(jobFixture(), options, httpError);
    expect(rejected.status).toBe('transport-failure');
    if (rejected.status === 'transport-failure') {
      expect(rejected.message).toContain('502');
      expect(rejected.message).toContain('bad gateway');
    }
  });

  it('performs no retry after a validation or transport failure', async () => {
    const { calls, transport } = recordingTransport(async () => completedResponse('not json'));
    await runSkipCriticInference(jobFixture(), options, transport);
    expect(calls).toHaveLength(1);
    const failingCalls: number[] = [];
    const failing: SkipCriticTransport = async (_url, _init) => {
      failingCalls.push(1);
      throw new Error('connection reset');
    };
    await runSkipCriticInference(jobFixture(), options, failing);
    expect(failingCalls).toHaveLength(1);
  });

  it('validates against the input builder permittedEvidence boundary', async () => {
    const input = buildSkipCriticInput(jobFixture());
    expect(input.permittedEvidence).toEqual({ 'section:10': ['10(1)', '10(2)'] });
    const permitted: SkipCriticResult = resultFixture({
      decision: 'skip-not-supported',
      detectedStudyValue: [groundedItem({ childLabels: ['10(1)', '10(2)'] })],
    });
    const { calls, transport } = recordingTransport(async () => completedResponse(permitted));
    const accepted = await runSkipCriticInference(jobFixture(), options, transport);
    expect(
      JSON.parse((calls[0].body as { messages: Array<{ content: string }> }).messages[1].content)
        .permittedEvidence,
    ).toEqual(input.permittedEvidence);
    expect(accepted.status).toBe('accepted');
    const outsideBoundary: SkipCriticResult = resultFixture({
      decision: 'skip-not-supported',
      detectedStudyValue: [
        groundedItem({ sourceKey: 'section:10', childLabels: ['10(1)', '10(9)'] }),
      ],
    });
    const { transport: second } = recordingTransport(async () =>
      completedResponse(outsideBoundary),
    );
    const rejected = await runSkipCriticInference(jobFixture(), options, second);
    expect(rejected.status).toBe('invalid-result');
    if (rejected.status === 'invalid-result') {
      expect(rejected.issues.map((issue) => issue.code)).toContain(
        'SKIP_CRITIC_CHILD_LABEL_NOT_FOUND',
      );
    }
  });
});
