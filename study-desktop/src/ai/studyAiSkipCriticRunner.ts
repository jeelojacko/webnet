// Standalone Skip Critic V1 runner: exactly one independent inference per
// AiStudyMapJob. Builds the source-grounded critic input, sends one
// OpenAI-compatible chat request with the strict critic schema, and validates
// the parsed result against the existing Skip Critic validator using the
// input builder's permittedEvidence.
//
// Deliberately separate from the normal authoring runner:
// - never accepts or forwards the author's disposition/reason/proposedGroups;
// - performs exactly one attempt (no retry);
// - writes no artifacts or provenance.

import type { AiStudyMapJob } from './studyAiTypes';
import { buildSkipCriticInput, SKIP_CRITIC_SYSTEM_PROMPT } from './studyAiSkipCriticInput';
import { SKIP_CRITIC_RESULT_SCHEMA } from './studyAiSkipCriticContract';
import { validateSkipCriticResult } from './studyAiSkipCriticValidation';
import type { SkipCriticResult, SkipCriticValidationIssue } from './studyAiSkipCriticTypes';

const DEFAULT_TIMEOUT_MS = 600_000;

export type SkipCriticTransportInit = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

export type SkipCriticTransportResponse = Pick<Response, 'ok' | 'status' | 'json' | 'text'>;

export type SkipCriticTransport = (
  _input: string,
  _init: SkipCriticTransportInit,
) => Promise<SkipCriticTransportResponse>;

export type SkipCriticRunnerOptions = {
  model: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type SkipCriticRunnerOutcome =
  | { status: 'accepted'; result: SkipCriticResult }
  | { status: 'invalid-result'; raw: string; issues: SkipCriticValidationIssue[] }
  | { status: 'transport-failure'; message: string };

type ChatMessage = { role: 'system' | 'user'; content: string };

type SkipCriticRequestBody = {
  model: string;
  messages: ChatMessage[];
  response_format: {
    type: 'json_schema';
    json_schema: {
      name: 'skip_critic_v1_result';
      strict: true;
      schema: typeof SKIP_CRITIC_RESULT_SCHEMA;
    };
  };
};

/** Model content that is present but not parseable as one JSON object. */
class MalformedCriticJson extends Error {
  readonly raw: string;

  constructor(raw: string, parseMessage: string) {
    super(parseMessage);
    this.raw = raw;
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const skipCriticMessages = (job: AiStudyMapJob): ChatMessage[] => {
  const input = buildSkipCriticInput(job);
  return [
    { role: 'system', content: SKIP_CRITIC_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ];
};

const parseCriticContent = async (
  response: SkipCriticTransportResponse,
): Promise<{ raw: string; parsed: unknown }> => {
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | object } }>;
    output_text?: string;
  };
  const content = body.choices?.[0]?.message?.content ?? body.output_text;
  if (typeof content === 'object' && content !== null)
    return { raw: JSON.stringify(content), parsed: content };
  if (typeof content !== 'string')
    throw new Error('Provider response did not contain JSON content.');
  try {
    return { raw: content, parsed: JSON.parse(content) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MalformedCriticJson(content, `Invalid JSON in critic response: ${message}`);
  }
};

export const runSkipCriticInference = async (
  job: AiStudyMapJob,
  options: SkipCriticRunnerOptions,
  transport: SkipCriticTransport = fetch,
): Promise<SkipCriticRunnerOutcome> => {
  const input = buildSkipCriticInput(job);
  const body: SkipCriticRequestBody = {
    model: options.model,
    messages: skipCriticMessages(job),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'skip_critic_v1_result',
        strict: true,
        schema: SKIP_CRITIC_RESULT_SCHEMA,
      },
    },
  };
  let response: SkipCriticTransportResponse;
  try {
    response = await transport(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
  } catch (error) {
    return { status: 'transport-failure', message: errorMessage(error) };
  }
  let raw: string;
  let parsed: unknown;
  try {
    ({ raw, parsed } = await parseCriticContent(response));
  } catch (error) {
    if (error instanceof MalformedCriticJson)
      return {
        status: 'invalid-result',
        raw: error.raw,
        issues: [{ code: 'SKIP_CRITIC_JSON_INVALID', message: errorMessage(error) }],
      };
    return { status: 'transport-failure', message: errorMessage(error) };
  }
  const report = validateSkipCriticResult(parsed, {
    permittedEvidence: input.permittedEvidence,
  });
  if (!report.valid) return { status: 'invalid-result', raw, issues: report.issues };
  return { status: 'accepted', result: parsed as SkipCriticResult };
};
