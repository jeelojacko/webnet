/**
 * Shared provider-I/O helpers for the local Study Map authoring runner and the
 * run auditor.
 *
 * A provider failure is a transport/infrastructure failure between the runner
 * and the local inference server (HTTP error, socket/connection error, timeout,
 * unusable response envelope). Provider failures are NOT Study Map semantic
 * validation issues: they must not consume semantic corrective retries and
 * must not surface as study-map error codes. The runner writes these codes
 * into failure artifacts and `reports/provider-events.jsonl` telemetry; the
 * auditor reads the same codes back. This module is the single source of truth
 * for that taxonomy.
 */

export const PROVIDER_FAILURE_CODES = [
  'PROVIDER_HTTP_ERROR',
  'PROVIDER_RESPONSE_ERROR',
  'PROVIDER_SOCKET_ERROR',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RECOVERY_TIMEOUT',
] as const;

export type ProviderFailureCode = (typeof PROVIDER_FAILURE_CODES)[number];

export type ProviderFailure = {
  code: ProviderFailureCode;
  message: string;
  httpStatus?: number;
};

/** Error the runner throws for non-2xx HTTP responses; carries the status. */
type HttpStatusError = Error & { providerHttpStatus?: number };

const chainParts = (error: unknown): string[] => {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    parts.push(current.name, current.message);
    const code = (current as { code?: unknown }).code;
    if (code !== undefined) parts.push(String(code));
    const cause: unknown = (current as { cause?: unknown }).cause;
    if (cause === current) break;
    current = cause;
  }
  return parts;
};

/**
 * Classify a failure observed while calling the local provider.
 *
 * The runner MUST attach `providerHttpStatus` (number) to errors it throws for
 * non-2xx HTTP responses (e.g. via Object.assign(new Error(...), {
 * providerHttpStatus: status })) so HTTP failures classify deterministically.
 * Content problems thrown by `parseModelContent` after a 2xx response carry
 * their recognizable messages and classify as PROVIDER_RESPONSE_ERROR.
 * Everything else (ECONNREFUSED, ECONNRESET, "fetch failed", DNS, ...) walks
 * the error/cause chain and falls back to PROVIDER_SOCKET_ERROR; timeout
 * markers classify as PROVIDER_TIMEOUT.
 *
 * Also used by the auditor to derive codes for legacy failure artifacts that
 * predate the `failureCode` field: call it with `new Error(storedMessage)`.
 */
export const classifyProviderFailure = (error: unknown): ProviderFailure => {
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = (error as HttpStatusError | null)?.providerHttpStatus;
  if (typeof httpStatus === 'number')
    return { code: 'PROVIDER_HTTP_ERROR', message, httpStatus };
  if (
    /^Provider response did not contain JSON content|^Invalid JSON in provider response content/i.test(
      message,
    )
  ) {
    return { code: 'PROVIDER_RESPONSE_ERROR', message };
  }
  const text = chainParts(error).join(' ');
  if (/TimeoutError|aborted due to timeout|ETIMEDOUT|timeout/i.test(text))
    return { code: 'PROVIDER_TIMEOUT', message };
  return { code: 'PROVIDER_SOCKET_ERROR', message };
};

/**
 * Strip a single leading UTF-8 BOM (U+FEFF) from decoded text, if present.
 * Some legacy/V1 JSONL artifacts carry a BOM on line 1; JSON parsing of the
 * BOM-prefixed first line otherwise fails.
 */
export const stripUtf8Bom = (text: string): string => text.replace(/^\uFEFF/, '');
